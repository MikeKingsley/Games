// The fleet beyond the vehicle the player drives: hired drivers, their jobs (simulated off-screen on route time),
// extra depots and moving vehicles between depots. Pure functions on the career (+ the world for routes).
import { vehicleById, trailerById } from './catalogue.js';
import { post, fuelBurn, fuelPrice, WEAR_PER_MILE } from './economy.js';
import { findRoute } from '../world/pathfind.js';
import { seededRng, hashSeed, pick, range } from '../engine/rng.js';
import { weekIndex, GAME_MINUTES_PER_SECOND, dateOf } from './calendar.js';
import { workSeconds, settle } from './contracts.js';
import { carryFor, cannotTake, takeOffer } from './career.js';
import { worldToMiles } from '../config.js';
import { addReputation, jobPoints, tierInfo } from './reputation.js';
import { climbModel } from '../sim/slope.js';

const FIRST = ['Albert', 'Fred', 'Harry', 'Walter', 'Arthur', 'Percy', 'Stanley', 'Reg', 'Ernie', 'George', 'Edith', 'Doris', 'Ivy', 'Mabel', 'Ron', 'Jim', 'Bill', 'Sid', 'Len', 'Joan', 'Pat', 'Dave', 'Kevin', 'Tracy', 'Gary', 'Sharon', 'Darren', 'Lee', 'Kelly', 'Jade'];
const LAST = ['Trelawny', 'Penrose', 'Hext', 'Pascoe', 'Tremayne', 'Coombe', 'Luxton', 'Vosper', 'Nankivell', 'Kingdon', 'Snell', 'Endacott', 'Rowe', 'Jago', 'Hosking', 'Bartlett', 'Pengelly', 'Hockin', 'Yeo', 'Westaway', 'Northcott', 'Coaker', 'Symons', 'Rundle', 'Stephens'];

// ---- Roster ----------------------------------------------------------------------------------------------------

/** Vehicles standing at a depot (not driven, not out on a job). */
export const vehiclesAt = (career, depotId) => career.fleet.filter(v => v.depot === depotId && v.id !== career.activeVehicle && !busy(career, v));
const busy = (career, v) => (career.drivers ?? []).some(d => d.vehicle === v.id && d.job);

/** Where every vehicle is, for the Fleet screen: {rec, spec, where, status}. */
export function roster(career, depotName = id => id) {
    return career.fleet.map(rec => {
        const spec = vehicleById(rec.model);
        const driver = (career.drivers ?? []).find(d => d.vehicle === rec.id);
        let status = 'parked';
        if (rec.id === career.activeVehicle) status = 'you are driving';
        else if (driver?.job) status = `${driver.name}: ${driver.job.title}`;
        else if (driver) status = `${driver.name} (waiting)`;
        return { rec, spec, driver, where: depotName(rec.depot), status };
    });
}

// ---- Drivers ---------------------------------------------------------------------------------------------------

/** This week's drivers looking for work: skill 1-5 and a weekly wage that rises with it. */
export function hirePool(career, seed, count = 4) {
    const week = weekIndex(career.calendar.minutes);
    const rng = seededRng(hashSeed(seed, 'drivers', week));
    const out = [];
    for (let k = 0; k < count; k++) {
        const skill = 1 + Math.floor(rng() * 5);
        const id = `d${week}-${k}`;
        if ((career.drivers ?? []).some(d => d.id === id) || (career.hiredIds ?? []).includes(id)) continue;
        out.push({ id, name: `${pick(rng, FIRST)} ${pick(rng, LAST)}`, skill, wage: Math.round(2 + skill * 1.5 + rng() * 2) });
    }
    return out;
}

export function hireDriver(career, applicant, depot) {
    const d = { ...applicant, depot, vehicle: null, job: null, auto: false, hired: career.calendar.minutes, earned: 0 };
    (career.drivers ??= []).push(d);
    (career.hiredIds ??= []).push(applicant.id);
    post(career.ledger, career.calendar.minutes, `Hired ${d.name}`, 0, 'wages');
    return d;
}

/** Fires a driver: the current job is cancelled (no pay) and wages stop from the next Monday. */
export function fireDriver(career, id) {
    const d = (career.drivers ?? []).find(x => x.id === id);
    if (!d) return false;
    const v = career.fleet.find(x => x.id === d.vehicle);
    if (v) v.driver = null;
    career.drivers.splice(career.drivers.indexOf(d), 1);
    return true;
}

/** Puts a driver with a vehicle standing at the same depot (or takes them off it with null). */
export function assignVehicle(career, driverId, vehicleId) {
    const d = career.drivers.find(x => x.id === driverId);
    if (!d || d.job) return false;
    const old = career.fleet.find(x => x.id === d.vehicle);
    if (old) old.driver = null;
    d.vehicle = null;
    if (!vehicleId) return true;
    const v = career.fleet.find(x => x.id === vehicleId);
    if (!v || v.id === career.activeVehicle || v.driver) return false;
    v.driver = d.id;
    d.vehicle = v.id;
    d.depot = v.depot;
    return true;
}

// ---- Off-screen jobs -------------------------------------------------------------------------------------------

/** The trailer a driver's tractor would take: the depot's first loose trailer that fits the contract. */
function trailerFor(career, contract, depot) {
    return (career.trailers ?? []).find(t => t.depot === depot && !t.coupledTo && !t.withDriver && (!contract.tags?.length || contract.tags.every(tag => trailerById(t.model).tags.includes(tag))));
}

/** Can this driver's vehicle do the contract? null if yes, else the reason. */
export function aiCannotTake(career, driver, contract) {
    const v = career.fleet.find(x => x.id === driver.vehicle);
    if (!v) return 'No vehicle';
    if (contract.trailers?.length) return 'Trailer jobs need a driver at the wheel'; // client trailers are physical
    const spec = vehicleById(v.model);
    const t = spec.tags.includes('tractor-unit') ? trailerFor(career, contract, v.depot) : null;
    return cannotTake(contract, spec, t ? trailerById(t.model) : null);
}

/**
 * Game minutes and fuel (litres, or kWh) for a vehicle to drive a route from findRoute, hills included: the route's
 * time already has the climbs and steep descents, and its `fuel` multiplier the hills' extra fuel (1 if level).
 */
export function routeCost(spec, route, loadFraction = 0) {
    return { minutes: route.time * GAME_MINUTES_PER_SECOND, fuel: fuelBurn(spec, route.length, loadFraction, 0.7) * (route.fuel ?? 1) };
}

/**
 * Starts a contract for a driver: the vehicle drives depot -> stops -> depot on route time (era speeds, the
 * vehicle's top speed, and its power to weight up the hills with the load), plus loading time. Lower skill means
 * longer and a chance of damage, decided now from a seeded roll so the outcome is fixed. The hills' fuel multiplier
 * is kept on the job for the fuel bill. Returns the job or null.
 */
export function startAiJob(career, world, driver, contract, year) {
    if (aiCannotTake(career, driver, contract)) return null;
    const v = career.fleet.find(x => x.id === driver.vehicle);
    const spec = vehicleById(v.model);
    const depot = world.depots.find(d => d.id === v.depot);
    const vmax = spec.topSpeedMph * 0.44704;
    const trailer = spec.tags.includes('tractor-unit') ? trailerFor(career, contract, v.depot) : null;
    const climb = climbModel(spec, contract.weight + (trailer ? trailerById(trailer.model).mass : 0));
    const pts = [depot.yard.marker, ...contract.stops.map(s => ({ x: s.x, y: s.y })), depot.yard.marker];
    let length = 0, seconds = 0, fuelMetres = 0;
    const path = [];
    for (let i = 1; i < pts.length; i++) {
        const r = findRoute(world.graph, pts[i - 1], pts[i], { year, vmax, climb });
        if (!r) return null;
        length += r.length;
        seconds += r.time;
        fuelMetres += r.fuel * r.length;
        path.push(...r.pts);
    }
    seconds += contract.stops.reduce((t, s) => t + workSeconds(s.weight), 0);
    const rng = seededRng(hashSeed(contract.id, driver.id));
    const sloth = (5 - driver.skill) / 4; // 0 for the best driver, 1 for the worst
    const delay = 1 + rng() * 0.45 * sloth;
    const damage = rng() < 0.35 * sloth ? Math.round(range(rng, 5, 30)) : 0;
    const start = career.calendar.minutes;
    const duration = Math.max(15, seconds * delay * GAME_MINUTES_PER_SECOND);
    if (trailer) trailer.withDriver = driver.id;
    driver.job = {
        contract, title: contract.title, start, end: start + duration, length, damage, path,
        trailer: trailer?.id ?? null, deadline: start + contract.window, hillFuel: length > 0 ? fuelMetres / length : 1,
    };
    takeOffer(career, contract.id);
    return driver.job;
}

/** Where a driver's vehicle is now along its route (for the map), or null. */
export function aiPosition(driver, minutes) {
    const job = driver.job;
    if (!job || job.path.length < 4) return null;
    const f = Math.min(1, Math.max(0, (minutes - job.start) / (job.end - job.start)));
    const n = job.path.length / 2 - 1;
    const k = Math.min(n - 1, Math.floor(f * n));
    const t = f * n - k;
    return { x: job.path[2 * k] + (job.path[2 * k + 2] - job.path[2 * k]) * t, y: job.path[2 * k + 1] + (job.path[2 * k + 3] - job.path[2 * k + 1]) * t };
}

/**
 * Advances the drivers to `minutes`: finished jobs pay out once (the contract's settlement minus fuel), add
 * wear/damage and reputation, and idle drivers with auto-take pick suitable work from their depot's offers.
 * ctx = {world, year, offersFor(depot) -> offers}. Returns events [{kind: 'aiPaid', driver, amount, title}].
 */
export function updateDrivers(career, ctx) {
    const minutes = career.calendar.minutes;
    const events = [];
    finishRelocations(career);
    for (const d of career.drivers ?? []) {
        const job = d.job;
        if (job?.relocateTo) continue; // a move between depots, no pay
        if (job && minutes >= job.end) {
            const v = career.fleet.find(x => x.id === d.vehicle);
            const spec = v ? vehicleById(v.model) : null;
            const fakeJob = { contract: job.contract, startedAt: job.start, deadline: job.deadline, cargoDamage: job.damage };
            const result = settle(fakeJob, job.end);
            const load = spec ? job.contract.weight / Math.max(1, carryFor(spec, job.trailer ? trailerById((career.trailers ?? []).find(t => t.id === job.trailer)?.model) : null).capacity || 1) : 0;
            const fuel = spec ? routeCost(spec, { length: job.length, time: 0, fuel: job.hillFuel ?? 1 }, Math.min(1, load) / 2).fuel * fuelPrice(spec) : 0;
            const net = Math.round((result.total - fuel) * 100) / 100;
            post(career.ledger, minutes, `${d.name}: ${job.title}`, result.total, 'income');
            if (fuel > 0) post(career.ledger, minutes, `${d.name}: fuel`, -Math.round(fuel * 100) / 100, 'fuel');
            if (v) {
                const miles = worldToMiles(job.length);
                v.mileage += miles;
                v.wear = Math.min(100, v.wear + miles * WEAR_PER_MILE);
                v.damage = Math.min(100, v.damage + job.damage / 3);
            }
            const tr = (career.trailers ?? []).find(t => t.id === job.trailer);
            if (tr) tr.withDriver = null;
            addReputation(career, job.contract.client.id, jobPoints(result, job.damage, job.contract.stops.length));
            d.earned += net;
            d.job = null;
            events.push({ kind: 'aiPaid', driver: d.name, amount: net, title: job.title });
        }
        if (!d.job && d.auto && d.vehicle && ctx.offersFor) {
            const depot = ctx.world.depots.find(x => x.id === career.fleet.find(v => v.id === d.vehicle)?.depot);
            if (!depot) continue;
            const offer = ctx.offersFor(depot).find(o => !aiCannotTake(career, d, o));
            if (offer && startAiJob(career, ctx.world, d, offer, ctx.year)) events.push({ kind: 'aiStarted', driver: d.name, title: offer.title });
        }
    }
    return events;
}

// ---- Depots ----------------------------------------------------------------------------------------------------

/** Price of a depot plot by the size of its town. */
export function depotPrice(world, depot) {
    const size = world.region.townById.get(depot.town)?.size;
    return { city: 4000, town: 1500, small: 700 }[size] ?? 500;
}

/** Buys a depot (needs the Regional Haulier tier). Returns {error} or {price}. */
export function buyDepot(career, world, depotId) {
    const depot = world.depots.find(d => d.id === depotId);
    if (!depot) return { error: 'No such depot' };
    if (career.depots.includes(depotId)) return { error: 'Already yours' };
    if (!tierInfo(career.reputation.points).depots) return { error: 'Become a Regional Haulier to buy depots' };
    const price = depotPrice(world, depot);
    if (career.ledger.money < price) return { error: 'Not enough money' };
    post(career.ledger, career.calendar.minutes, `Bought ${depot.name}`, -price, 'depots');
    career.depots.push(depotId);
    return { price };
}

/**
 * Sends a parked vehicle to another depot with a driver: an off-screen run that takes route time (no pay).
 */
export function relocate(career, world, driver, toDepotId, year) {
    const v = career.fleet.find(x => x.id === driver.vehicle);
    if (!v || driver.job) return null;
    const from = world.depots.find(d => d.id === v.depot), to = world.depots.find(d => d.id === toDepotId);
    if (!from || !to || from === to) return null;
    const spec = vehicleById(v.model);
    const r = findRoute(world.graph, from.yard.marker, to.yard.marker, { year, vmax: spec.topSpeedMph * 0.44704, climb: climbModel(spec) });
    if (!r) return null;
    const start = career.calendar.minutes;
    driver.job = {
        contract: { id: `move-${v.id}-${start}`, title: `Moving to ${to.name}`, pay: 0, window: 1e9, client: { id: 'self', name: 'Own company' }, stops: [], weight: 0 },
        title: `Moving to ${to.name}`, start, end: start + r.time * GAME_MINUTES_PER_SECOND, length: r.length, damage: 0, path: r.pts, relocateTo: toDepotId, deadline: Infinity,
    };
    return driver.job;
}

/** Finishes relocations (the vehicle and driver now belong to the new depot). */
export function finishRelocations(career) {
    for (const d of career.drivers ?? []) {
        if (d.job?.relocateTo && career.calendar.minutes >= d.job.end) {
            const v = career.fleet.find(x => x.id === d.vehicle);
            if (v) { v.depot = d.job.relocateTo; v.pose = null; }
            d.depot = d.job.relocateTo;
            d.job = null;
        }
    }
}

export const yearNow = career => dateOf(career.calendar.minutes).year;
