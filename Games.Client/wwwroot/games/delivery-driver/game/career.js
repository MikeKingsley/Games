// The player's career: company, calendar, money, today's offers and the active job. Pure state + functions,
// so the whole career can be saved and tested without the canvas.
import { createCalendar, hourIndex, dateOf, weekIndex } from './calendar.js';
import { createLedger, post } from './economy.js';
import { vehicleById, trailerById } from './catalogue.js';
import { tierInfo } from './reputation.js';
import { GENERAL_TAGS } from './contracts.js';
import { addReputation, jobPoints, ABANDON_POINTS } from './reputation.js';
import { generateOffers, startJob, settle } from './contracts.js';
import { START_MONEY } from '../config.js';
import { climbModel } from '../sim/slope.js';

export function createCareer({ company = 'Exe Valley Carriers', money = START_MONEY, minutes, livery = { livery1: '#2f5d8a', livery2: '#e8c547' }, homeDepot = 'depot-exeter' } = {}) {
    const calendar = createCalendar(minutes);
    const year = dateOf(calendar.minutes).year;
    const first = newFleetVehicle({ nextId: 1 }, 'tamar-t-ton', year, homeDepot, calendar.minutes);
    return {
        company,
        livery,
        calendar,
        ledger: createLedger(money),
        fleet: [first],
        nextId: 2,
        activeVehicle: first.id,
        trailers: [],
        drivers: [],
        loans: [],
        depots: [homeDepot],
        homeDepot,
        reputation: { points: 0 },
        bankruptcy: { stage: 0 },
        retired: false,
        lastWeek: weekIndex(calendar.minutes),
        job: null,
        offers: [],
        boards: {},
        clients: {},
        stats: { jobs: 0, onTime: 0, earned: 0 },
        /** One-off tips already shown to this company (game/tutorial.js HILL_TIPS). */
        tips: [],
    };
}

/**
 * The current offers at a depot (regenerated each game hour, or when forced after taking one).
 * vehicle gives the payload and speed the offers are sized for.
 */
export function refreshOffers(career, world, depot, vehicle, year, force = false) {
    const hour = hourIndex(career.calendar.minutes);
    const boards = (career.boards ??= {});
    let b = boards[depot.id];
    if (!b || b.hour !== hour || force) {
        const sameHour = b?.hour === hour;
        const refresh = sameHour ? b.refresh + (force ? 1 : 0) : 0;
        const taken = sameHour ? b.taken : [];
        const offers = generateOffers({
            world, depot, minutes: career.calendar.minutes, year,
            payload: carryFor(vehicle.spec, vehicle.trailer?.spec).capacity || 1000, vmax: vehicle.spec.topSpeedMph * 0.44704, refresh,
            climb: climbModel(vehicle.spec, vehicle.trailer?.spec.mass ?? 0), // each offer adds its own load
            tierInfo: tierInfo(career.reputation.points), fleet: fleetCapabilities(career),
            tractors: career.fleet.map(v => vehicleById(v.model)).filter(s => s.tags.includes('tractor-unit')).map(s => s.trailerMax),
        }).filter(o => !taken.includes(o.id));
        b = boards[depot.id] = { hour, refresh, taken, offers };
    }
    career.offers = b.offers; // the board last looked at (kept for the UI and tests)
    return b.offers;
}

/** Takes an offer off whichever depot board it is on (it can't be offered again that day). */
export function takeOffer(career, id) {
    for (const b of Object.values(career.boards ?? {})) {
        const i = b.offers.findIndex(o => o.id === id);
        if (i >= 0) { b.taken.push(id); return b.offers.splice(i, 1)[0]; }
    }
    const i = career.offers.findIndex(o => o.id === id);
    return i >= 0 ? career.offers.splice(i, 1)[0] : null;
}

export function acceptOffer(career, id) {
    if (career.job) return null;
    const contract = takeOffer(career, id);
    if (!contract) return null;
    career.job = startJob(contract, career.calendar.minutes);
    return career.job;
}

/** Abandoning costs a tenth of the pay as a cancellation charge. */
export function abandonJob(career) {
    const job = career.job;
    if (!job) return 0;
    const fee = Math.max(1, Math.round(job.contract.pay * 0.1));
    post(career.ledger, career.calendar.minutes, `Cancelled: ${job.contract.title}`, -fee, 'penalty');
    clientRecord(career, job.contract.client).abandoned++;
    addReputation(career, job.contract.client.id, ABANDON_POINTS);
    career.job = null;
    return fee;
}

/** Pays out a finished job and records it against the client. Returns the settlement. */
export function completeJob(career) {
    const job = career.job;
    const result = settle(job, career.calendar.minutes);
    post(career.ledger, career.calendar.minutes, job.contract.title, result.total, 'income');
    const rec = clientRecord(career, job.contract.client);
    rec.jobs++;
    if (result.onTime) rec.onTime++;
    if (job.cargoDamage > 0) rec.damaged++;
    career.stats.jobs++;
    if (result.onTime) career.stats.onTime++;
    career.stats.earned += result.total;
    result.points = jobPoints(result, job.cargoDamage, job.contract.stops.length);
    result.newTier = addReputation(career, job.contract.client.id, result.points);
    career.job = null;
    return result;
}

function clientRecord(career, client) {
    return (career.clients[client.id] ??= { name: client.name, jobs: 0, onTime: 0, damaged: 0, abandoned: 0 });
}

/** A vehicle record in the fleet (the driving state lives on the sim vehicle while it is being driven). */
export function newFleetVehicle(career, model, year, depot, minutes, { wear = 0, mileage = 0, built = year } = {}) {
    const spec = vehicleById(model);
    const id = `v${career.nextId++}`;
    return { id, model, built, bought: minutes, mileage, wear, damage: 0, fuel: spec.fuelTank, depot, driver: null, trailer: null, pose: null };
}

export const activeFleetVehicle = career => career.fleet.find(v => v.id === career.activeVehicle) ?? null;

/** What a vehicle (with an optional trailer) can carry: {tags, capacity}. Tractor units need a trailer. */
export function carryFor(spec, trailerSpec = null) {
    if (spec.tags.includes('tractor-unit')) {
        if (!trailerSpec) return { tags: [], capacity: 0 };
        return { tags: trailerSpec.tags, capacity: Math.min(trailerSpec.capacity, spec.trailerMax) };
    }
    const tags = [...spec.tags];
    return { tags, capacity: spec.payload };
}

/** Everything the fleet could carry: each rigid/van as it is, each tractor with each owned trailer. */
export function fleetCapabilities(career) {
    const out = [];
    const trailers = (career.trailers ?? []).map(t => trailerById(t.model)).filter(Boolean);
    for (const v of career.fleet) {
        const spec = vehicleById(v.model);
        if (spec.tags.includes('tractor-unit')) for (const t of trailers) out.push(carryFor(spec, t));
        else out.push(carryFor(spec));
    }
    return out;
}

/** Can this vehicle (and trailer) take a contract? Returns null if so, else the reason. */
export function cannotTake(contract, spec, trailerSpec = null) {
    if (contract.trailers?.length) {
        if (!spec.tags.includes('tractor-unit')) return 'Needs a tractor unit (artic)';
        if (trailerSpec) return 'Drop your own trailer first';
        if (contract.weight > spec.trailerMax) return `Too heavy for this tractor (${(spec.trailerMax / 1000).toFixed(0)} t)`;
        return null;
    }
    const c = carryFor(spec, trailerSpec);
    if (spec.tags.includes('tractor-unit') && !trailerSpec) return 'Couple a trailer first';
    const needs = contract.tags?.length ? contract.tags : null;
    if (needs && !needs.every(t => c.tags.includes(t))) return `Needs a vehicle with: ${needs.join(', ')}`;
    if (!needs && !GENERAL_TAGS.some(t => c.tags.includes(t))) return 'This vehicle can’t carry general goods';
    if (contract.weight > c.capacity) return `Too heavy: ${contract.weight} kg (you can carry ${c.capacity} kg)`;
    return null;
}
