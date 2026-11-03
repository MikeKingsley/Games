// The running game: owns the player vehicle, the world, the clock and the career state, and steps them each tick.
// DOM-free apart from what it is handed in attach(), so the step logic can be driven from tests.
import { createVehicle, stepVehicle, vehicleObb, collideVehicle, bodyCentre } from '../sim/vehicle.js';
import { shift } from '../sim/gearbox.js';
import { vehicleById, trailerById } from './catalogue.js';
import { createWorld } from '../world/world.js';
import { loadRegion, waterAt } from '../world/region.js';
import { nearestEdge, edgeWidth } from '../world/roadgraph.js';
import { findRoute } from '../world/pathfind.js';
import { QUALITY } from '../config.js';
import { createCareer, refreshOffers, acceptOffer, abandonJob, completeJob, activeFleetVehicle, cannotTake } from './career.js';
import { currentStop, updateJob, finishStop, cargoOnBoard, impactDamage, jobStage } from './contracts.js';
import { advance, advanceHours, dateOf } from './calendar.js';
import { bayCheck, doorCheck, bayHint, parkingSpots, trailerSpots } from './depots.js';
import { buyVehicle, buyTrailer, sellVehicle, sellTrailer, showroom } from './dealer.js';
import { updateDrivers, aiPosition, hirePool, hireDriver, fireDriver, assignVehicle, startAiJob, relocate, buyDepot } from './fleet.js';
import { takeLoan, repayLoan } from './economy.js';
import { createTraffic, agentDrawSpec } from '../traffic/traffic.js';
import { obb, sat } from '../sim/collision.js';
import { stepTrailer, trailerObb, createTrailer, attach, underRun } from '../sim/trailer.js';
import { couple, uncouple, nearestTrailer, couplingCheck, couplingHint } from '../sim/coupling.js';
import { drawVehicle } from '../render/draw-vehicles.js';
import { lerpPose } from '../render/renderer.js';
import { drawGuideLines } from '../render/draw-vehicles.js';
import { rearPoint } from './depots.js';
import { hashSeed } from '../engine/rng.js';
import { slipNear, crossingMinutes, eventsBetween, describeEvent } from '../world/history.js';
import { post, fuelBurn, WEAR_PER_MILE, impactToDamage, performanceFactor, weeklyTick, refuelCost, repairCost, formatMoney } from './economy.js';
import { worldToMiles } from '../config.js';
import { tierOf } from './reputation.js';
import { daylight, weatherFor, gripFor, visibilityFor } from './environment.js';
import { makeSave } from './save.js';
import { moorAt } from '../world/region.js';

const PERF_SAMPLES = 300;

export function createSession({ options = {}, sound, regionId = 'sw-england', world = null } = {}) {
    const session = {
        settings: { quality: 'medium', renderer: 'auto', camera: 'chase', manualGears: false, touchLayout: 'slider' },
        player: null,
        controls: null,
        world: null,
        career: createCareer(),
        year: 1919,
        route: null,
        jobHint: null,
        activeYard: null,
        stopCheck: null,
        light: 1,
        menuOpen: false,
        paused: false,
        time: 0,
        onMenuChange: null,
        input: null,
        offRoad: false,
        lastImpact: 0,
        perf: [],
        loadingText: 'Loading Devon & Cornwall…',
        vehicles: [],
    };
    let surfaceTimer = 0;
    let routeTimer = 0;
    const listeners = new Map();
    /** Game events for the HUD and audio: toast, startWork, stopDone, complete, impact, newDay, newYear. */
    session.on = (name, fn) => { (listeners.get(name) ?? listeners.set(name, new Set()).get(name)).add(fn); return () => listeners.get(name).delete(fn); };
    session.emit = (name, data) => listeners.get(name)?.forEach(fn => fn(data));
    session.year = dateOf(session.career.calendar.minutes).year;
    Object.defineProperty(session, 'livery', { get: () => session.career.livery });
    session.player = vehicleFor(activeFleetVehicle(session.career));

    /** A sim vehicle for a fleet record (its wear, damage and fuel live on the record). */
    function vehicleFor(rec) {
        const v = createVehicle(vehicleById(rec.model), { x: 0, y: 0, heading: -Math.PI / 2 });
        v.rec = rec;
        v.fuel = rec.fuel;
        v.damage = rec.damage;
        v.power = performanceFactor(rec.wear, rec.damage);
        return v;
    }

    /** Swaps the vehicle the player drives (the old one stays parked where it is). */
    session.useVehicle = (id, pose = null) => {
        const rec = session.career.fleet.find(v => v.id === id);
        if (!rec) return false;
        const old = session.player;
        if (old?.rec && old.rec !== rec) old.rec.pose = { x: old.x, y: old.y, heading: old.heading };
        session.career.activeVehicle = id;
        const v = vehicleFor(rec);
        session.player = v;
        const at = pose ?? rec.pose ?? { x: old.x, y: old.y, heading: old.heading };
        teleport(at.x, at.y, at.heading);
        rec.pose = null;
        return true;
    };

    function setWorld(w) {
        session.world = w;
        w.chunks.cap = Math.max(60, (QUALITY[session.settings.quality]?.spriteCache ?? 48) * 3);
        session.traffic = createTraffic(w.graph, { seed: hashSeed(w.region.seed, 'traffic'), cap: QUALITY[session.settings.quality]?.traffic ?? 16 });
        session.vehicles = session.traffic.agents;
        session.applyQuality(session.settings.quality);
        spawnAtDepot();
        buildTrailers();
    }

    /** Puts the player at the home depot's loading bay, nose out of the yard. */
    function spawnAtDepot(depot = session.world.depots.find(d => d.home)) {
        const m = depot.yard.marker;
        const spec = session.player.spec;
        // the marker is where the vehicle's rear goes: the rear axle sits rearOverhang ahead of it
        const x = m.x + Math.cos(m.heading) * (spec.rearOverhang + 4), y = m.y + Math.sin(m.heading) * (spec.rearOverhang + 4);
        teleport(x, y, m.heading);
        session.homeDepot = depot;
    }

    function teleport(x, y, heading = session.player.heading) {
        Object.assign(session.player, { x, y, heading, speed: 0, steer: 0, prevX: x, prevY: y, prevHeading: heading });
        session.world?.chunks.around(x, y, 260);
    }

    session.attach = ({ input, camera }) => {
        session.input = input;
        input.onAction(name => {
            if (name === 'camera') camera.toggleMode();
            else if (name === 'zoomIn') camera.zoomIn();
            else if (name === 'zoomOut') camera.zoomOut();
            else if (name === 'couple') session.toggleCoupling();
            else if (name === 'gearMode') session.player.gearbox.manual = !session.player.gearbox.manual;
            else if (name === 'gearUp' && session.player.gearbox.manual) shift(session.player.gearbox, session.player.spec, +1);
            else if (name === 'gearDown' && session.player.gearbox.manual) shift(session.player.gearbox, session.player.spec, -1);
        });
    };

    session.setPaused = paused => { session.paused = paused; };

    session.step = dt => {
        if (session.paused || !session.world) return;
        const p = session.player;
        session.controls = session.input.update(dt, p.speed);
        const rec = p.rec;
        session.inPractice = !!session.practiceReturn;
        const moved = stepVehicle(p, session.controls, dt, { rolling: session.offRoad ? 3.5 : 1, drive: rec.fuel > 0, grip: session.grip ?? 1 });
        if (p.trailer) stepRig(p, moved.yawRate, dt);
        runningCosts(p, rec, dt);
        collide(p);
        if (session.inPractice) stepPractice(dt);
        else { stepTraffic(dt); tickClock(dt); stepJob(dt); }
        // indicators cancel themselves once a turn is done and the wheel straightens
        if (session.indicator) {
            const turned = Math.abs(Math.atan2(Math.sin(p.heading - session.indicatorHeading), Math.cos(p.heading - session.indicatorHeading)));
            if (turned > 1.0 && Math.abs(session.controls.steer) < 0.15) session.indicator = null;
        }
        // what's under the wheels (checked a few times a second)
        surfaceTimer -= dt;
        if (surfaceTimer <= 0) {
            surfaceTimer = 0.2;
            // ferry approaches count as road on land; their crossing over the water does not
            const near = nearestEdge(session.world.graph, p.x, p.y, 40, session.year, () => true);
            const onRoad = near && near.d <= edgeWidth(near.edge, session.year) / 2 + 1.5 && !(near.edge.cls === 'ferry' && waterAt(session.world.region, p.x, p.y));
            session.offRoad = !onRoad && !session.world.yardAt(p.x, p.y);
            session.world.chunks.around(p.x, p.y, 220, 1);
            prefetchTown(p);
        }
        updateEnvironment(dt);
        session.time += dt;
        session.emit('step', p);
    };

    let envTimer = 0;
    let weatherOverride = null;
    /** Light, weather, grip and visibility, refreshed about once a second. */
    function updateEnvironment(dt, force = false) {
        envTimer -= dt;
        if (envTimer > 0 && !force) return;
        envTimer = 1;
        const minutes = session.career.calendar.minutes;
        const d = daylight(minutes);
        session.light = session.inPractice ? 1 : d.light;
        session.dusk = session.inPractice ? 0 : d.dusk;
        session.night = d.night;
        const p = session.player;
        const before = session.weather?.kind;
        session.weather = weatherOverride ?? (session.inPractice ? { kind: 'clear', intensity: 0 } : null) ?? weatherFor(session.world.region.seed, minutes, !!moorAt(session.world.region, p.x, p.y));
        session.grip = gripFor(session.weather);
        session.visibility = visibilityFor(session.weather);
        if (before && before !== session.weather.kind) session.emit('weather', session.weather);
    }
    session.updateEnvironment = () => updateEnvironment(0, true);

    /** Undoes the last step of the tractor and its trailer (blocked by a jack-knife or an obstacle). */
    function undoStep(p) {
        p.x = p.prevX; p.y = p.prevY; p.heading = p.prevHeading; p.speed = 0;
        const t = p.trailer;
        if (t) { t.x = t.prevX; t.y = t.prevY; t.heading = t.prevHeading; }
    }

    /** Trailer follows the fifth wheel; folding past the limit is a jack-knife; the trailer body hits things too. */
    function stepRig(p, yawRate, dt) {
        const t = p.trailer;
        const fold = stepTrailer(p, t, dt, p.speed, yawRate);
        if (fold) {
            const speed = Math.abs(p.speed);
            undoStep(p);
            if (fold === 'jackknife') {
                p.rec.damage = Math.min(100, p.rec.damage + 4 + speed * 2);
                session.emit('jackknife', speed);
            }
            return;
        }
        const box = trailerObb(t);
        for (const col of session.world.colliders.query(box)) {
            if (!sat(box, col.box)) continue;
            if (col.kind === 'cone') { knockCone(col.ref); continue; }
            const impact = Math.abs(p.speed);
            undoStep(p);
            if (impact > 0.5) { session.lastImpact = impact; session.onImpact?.(impact, col); }
            return;
        }
        for (const other of session.looseTrailers?.() ?? []) {
            if (other === t || !sat(box, trailerObb(other))) continue;
            const impact = Math.abs(p.speed);
            undoStep(p);
            if (impact > 0.5) session.onImpact?.(impact, { kind: 'trailer' });
            return;
        }
    }

    /** Fuel, mileage and wear for the distance just driven; wear and damage sap the engine's power. */
    function runningCosts(p, rec, dt) {
        const ds = Math.abs(p.speed * dt);
        if (ds > 0) {
            const load = (p.cargoMass + (p.trailer?.cargoMass ?? 0)) / Math.max(1, p.spec.payload || p.spec.trailerMax || 1);
            rec.fuel = Math.max(0, rec.fuel - fuelBurn(p.spec, ds, load, session.controls.throttle));
            const miles = worldToMiles(ds);
            rec.mileage += miles;
            rec.wear = Math.min(100, rec.wear + miles * WEAR_PER_MILE);
        }
        p.fuel = rec.fuel;
        p.damage = rec.damage;
        p.power = performanceFactor(rec.wear, rec.damage);
        if (rec.fuel <= 0 && !session.outOfFuel) { session.outOfFuel = true; session.emit('toast', 'Out of fuel! Press F to call a tow.'); }
        if (rec.fuel > 0) session.outOfFuel = false;
    }

    /** The nearest owned depot to a point. */
    function nearestOwnedDepot(x, y) {
        const owned = session.world.depots.filter(d => session.career.depots.includes(d.id));
        return owned.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    }

    /** A tow to the nearest depot: costly (a call-out plus a charge per mile), and a quarter of a tank. */
    session.callTow = () => {
        const p = session.player;
        const depot = nearestOwnedDepot(p.x, p.y);
        const miles = worldToMiles(Math.hypot(depot.x - p.x, depot.y - p.y));
        const cost = Math.round(15 + miles * 1.5);
        post(session.career.ledger, session.career.calendar.minutes, 'Breakdown tow', -cost, 'tow');
        handleClock(advanceHours(session.career.calendar, 1 + miles / 15));
        p.rec.fuel = Math.max(p.rec.fuel, p.spec.fuelTank * 0.25);
        spawnAtDepot(depot);
        session.emit('toast', `Towed to ${depot.name} for ${formatMoney(cost)}`);
        if (session.career.job) updateRoute();
        return cost;
    };

    // ---- trailers ----------------------------------------------------------------------------------------------

    /** Sim trailers in the world, by id: the company's (rec) and any client trailers on a job. */
    session.trailerObjs = new Map();
    session.looseTrailers = () => [...session.trailerObjs.values()].filter(t => !t.coupled);

    /** A free trailer spot in a depot yard. */
    function trailerSpotAt(depot, spec) {
        const spots = trailerSpots(depot, spec);
        for (const s of spots) {
            const free = ![...session.trailerObjs.values()].some(t => Math.hypot(t.x - s.x, t.y - s.y) < 3);
            if (free) return s;
        }
        return spots[0];
    }

    /** Puts a trailer into the world (a company trailer from its record, or a client's). */
    function spawnTrailer(id, spec, pose, extra = {}) {
        const t = createTrailer(spec, pose);
        t.id = id;
        t.legsDown = true;
        Object.assign(t, extra);
        session.trailerObjs.set(id, t);
        return t;
    }

    /** Rebuilds the company's trailers from the career (on load). */
    function buildTrailers() {
        for (const rec of session.career.trailers ?? []) {
            const spec = trailerById(rec.model);
            const depot = session.world.depots.find(d => d.id === rec.depot) ?? session.world.depots.find(d => d.home);
            const t = spawnTrailer(rec.id, spec, rec.pose ?? trailerSpotAt(depot, spec), { rec, cargoMass: rec.cargoMass ?? 0 });
            if (rec.coupledTo === session.career.activeVehicle && session.player.spec.tags.includes('tractor-unit')) {
                session.player.trailer = t; t.coupled = true; t.legsDown = false; attach(session.player, t);
            }
        }
    }
    session.on('trailerBought', ({ rec, depot }) => {
        const spec = trailerById(rec.model);
        rec.pose = trailerSpotAt(depot, spec);
        spawnTrailer(rec.id, spec, rec.pose, { rec });
    });

    /** C: couple to the trailer behind, or drop the one you have. */
    session.toggleCoupling = () => {
        const p = session.player;
        if (!p.spec.tags.includes('tractor-unit')) return null;
        if (p.trailer) {
            const t = uncouple(p);
            if (!t) { session.emit('toast', 'Stop to uncouple'); return null; }
            if (t.rec) { t.rec.coupledTo = null; t.rec.pose = { x: t.x, y: t.y, heading: t.heading }; t.rec.cargoMass = t.cargoMass; }
            p.rec.trailer = null;
            session.emit('uncoupled', t);
            return 'uncoupled';
        }
        const t = nearestTrailer(p, session.looseTrailers());
        if (!t) { session.emit('toast', 'No trailer behind you'); return null; }
        const why = couplingCheck(p, t);
        if (why) { session.emit('toast', couplingHint(why) ?? 'Line up under the trailer'); return null; }
        couple(p, t);
        if (t.rec) { t.rec.coupledTo = p.rec.id; t.rec.pose = null; }
        p.rec.trailer = t.id;
        session.emit('coupled', t);
        return 'coupled';
    };

    function couplingPrompt(p) {
        if (!p.spec.tags.includes('tractor-unit') || p.trailer) return null;
        const t = nearestTrailer(p, session.looseTrailers(), 14);
        return t ? couplingHint(couplingCheck(p, t)) : null;
    }

    // ---- reversing practice yard -------------------------------------------------------------------------------

    /** Goes to the practice yard from a depot (with a practice trailer for an artic). */
    session.enterPractice = depot => {
        if (session.career.job) { session.emit('toast', 'Finish your job first'); return false; }
        const p = session.player;
        if (p.trailer) session.toggleCoupling(); // your own trailer waits in the depot yard
        session.practiceReturn = { depot: depot.id };
        const pr = session.world.practice;
        for (const c of pr.cones) c.knocked = false;
        session.practiceBay = 1;
        session.practiceScore = { knocks: 0, bays: 0 };
        teleport(pr.x, pr.y + 20, -Math.PI / 2);
        if (p.spec.tags.includes('tractor-unit')) {
            const spec = trailerById(session.year >= 1956 ? 'box-12' : 'box-light');
            spawnTrailer('practice-trailer', spec, { x: pr.x + 46, y: pr.y + 22, heading: -Math.PI / 2 }, { client: true, livery: { livery1: '#c9c4b8', livery2: '#f2b33d' } });
        }
        session.emit('toast', 'Reversing practice: back into the yellow bay. F for the menu.');
        return true;
    };

    session.leavePractice = () => {
        const back = session.practiceReturn;
        if (!back) return false;
        const p = session.player;
        if (p.trailer?.id === 'practice-trailer') uncouple(p);
        session.trailerObjs.delete('practice-trailer');
        session.practiceReturn = null;
        session.inPractice = false;
        const depot = session.world.depots.find(d => d.id === back.depot);
        spawnAtDepot(depot);
        return true;
    };

    session.nextPracticeBay = () => { session.practiceBay = ((session.practiceBay ?? 1) + 1) % 3; };

    function knockCone(cone) {
        if (cone.knocked) return;
        cone.knocked = true;
        if (session.practiceScore) session.practiceScore.knocks++;
        session.emit('toast', 'Cone!');
    }

    function stepPractice() {
        const p = session.player;
        const bay = session.world.practice.bays[session.practiceBay ?? 1];
        const check = bayCheck(p, bay);
        session.stopCheck = check;
        session.jobHint = check.ok ? 'Perfect! Press F for the next bay' : bayHint(check) ?? 'Reverse into the yellow bay';
        if (check.ok && !session.practiceDone) { session.practiceDone = true; session.practiceScore.bays++; session.emit('toast', 'Perfect! Spot on.'); }
        if (!check.ok) session.practiceDone = false;
    }

    // ---- drivers, depots and the wider fleet ----------------------------------------------------------------------

    /** Positions of company vehicles out on drivers' jobs (for the minimap and the map). */
    session.fleetMarkers = () => session.career.drivers.filter(d => d.job).map(d => aiPosition(d, session.career.calendar.minutes)).filter(Boolean);
    session.hirePool = () => hirePool(session.career, session.world.region.seed);
    session.hire = (applicantId, depot) => {
        const a = session.hirePool().find(x => x.id === applicantId);
        return a ? hireDriver(session.career, a, depot.id) : null;
    };
    session.fire = id => fireDriver(session.career, id);
    session.assign = (driverId, vehicleId) => assignVehicle(session.career, driverId, vehicleId || null);
    session.toggleAuto = driverId => { const d = session.career.drivers.find(x => x.id === driverId); if (d) d.auto = !d.auto; updateFleet(true); };
    /** Gives one of a depot's offers to a driver. */
    session.giveJob = (driverId, offerId, depot) => {
        const d = session.career.drivers.find(x => x.id === driverId);
        const offer = refreshOffers(session.career, session.world, depot, session.player, session.year).find(o => o.id === offerId);
        if (!d || !offer) return null;
        const job = startAiJob(session.career, session.world, d, offer, session.year);
        if (job) session.emit('aiStarted', { driver: d.name, title: offer.title });
        return job;
    };
    session.sendTo = (driverId, depotId) => {
        const d = session.career.drivers.find(x => x.id === driverId);
        return d ? relocate(session.career, session.world, d, depotId, session.year) : null;
    };
    session.buyDepot = id => {
        const r = buyDepot(session.career, session.world, id);
        session.emit('toast', r.error ?? `Bought ${session.world.depots.find(d => d.id === id).name}`);
        return r;
    };

    // ---- the office: dealer, bank and company -------------------------------------------------------------------

    /** A free parking spot in a depot yard for a spare vehicle. */
    function parkAt(depot) {
        const taken = session.career.fleet.filter(v => v.depot === depot.id && v.pose).length;
        const spots = parkingSpots(depot, 8);
        return spots[taken % spots.length];
    }

    /** Buys a new vehicle (model) or a used one (usedId), optionally part-exchanging the one being driven. */
    session.buyVehicle = ({ model, usedId, depot, tradeIn = false }) => {
        const c = session.career;
        const used = usedId ? showroom(c, session.world.region.seed).used.find(u => u.id === usedId) : null;
        const swapping = tradeIn && !c.job;
        const result = buyVehicle(c, { model, used, depot: depot.id, tradeIn: swapping ? c.activeVehicle : null });
        if (result.error) { session.emit('toast', result.error); return result; }
        if (swapping) {
            // the part-exchanged vehicle has gone: drive the new one from the loading bay
            session.player.rec = null;
            const m = depot.yard.marker;
            c.activeVehicle = result.rec.id;
            session.player = vehicleFor(result.rec);
            const off = session.player.spec.rearOverhang + 4;
            teleport(m.x + Math.cos(m.heading) * off, m.y + Math.sin(m.heading) * off, m.heading);
        } else {
            result.rec.pose = parkAt(depot);
        }
        session.emit('toast', `Bought: ${vehicleById(result.rec.model).name}`);
        return result;
    };

    session.buyTrailer = (model, depot) => {
        const r = buyTrailer(session.career, model, depot.id);
        if (r.error) session.emit('toast', r.error);
        else session.emit('trailerBought', { rec: r.rec, depot });
        return r;
    };
    session.sellVehicle = id => { const r = sellVehicle(session.career, id); session.emit('toast', r.error ?? 'Sold'); return r; };
    session.sellTrailer = id => { const r = sellTrailer(session.career, id); session.emit('toast', r.error ?? 'Sold'); return r; };

    /** Swaps to a vehicle parked at this depot; the current one parks in the yard. */
    session.driveFrom = (id, depot) => {
        const c = session.career;
        if (c.job) return false;
        const rec = c.fleet.find(v => v.id === id);
        if (!rec || rec.depot !== depot.id) return false;
        const old = session.player.rec;
        const m = depot.yard.marker;
        const spot = parkAt(depot);
        const target = vehicleById(rec.model);
        const off = target.rearOverhang + 4;
        session.useVehicle(id, { x: m.x + Math.cos(m.heading) * off, y: m.y + Math.sin(m.heading) * off, heading: m.heading });
        if (old) { old.depot = depot.id; old.pose = spot; }
        return true;
    };

    session.takeLoan = amount => takeLoan(session.career, amount);
    session.repayLoan = id => { const l = session.career.loans.find(x => x.id === id); return l ? repayLoan(session.career, id, l.balance) : 0; };
    session.renameCompany = (name, livery) => {
        const c = session.career;
        if (name?.trim()) c.company = name.trim().slice(0, 32);
        if (/^#[0-9a-f]{6}$/i.test(livery?.livery1 ?? '')) c.livery.livery1 = livery.livery1;
        if (/^#[0-9a-f]{6}$/i.test(livery?.livery2 ?? '')) c.livery.livery2 = livery.livery2;
    };

    session.refuel = () => {
        const p = session.player;
        const cost = Math.round(refuelCost(p.spec, p.rec.fuel) * 100) / 100;
        if (cost <= 0) return 0;
        post(session.career.ledger, session.career.calendar.minutes, p.spec.electric ? 'Charging' : 'Fuel', -cost, 'fuel');
        p.rec.fuel = p.spec.fuelTank;
        p.fuel = p.rec.fuel;
        return cost;
    };

    session.repair = () => {
        const p = session.player;
        const cost = repairCost(p.spec, p.rec.wear, p.rec.damage);
        if (cost <= 0) return 0;
        post(session.career.ledger, session.career.calendar.minutes, `Repairs: ${p.spec.name}`, -cost, 'repairs');
        p.rec.wear = 0;
        p.rec.damage = 0;
        p.damage = 0;
        p.power = 1;
        return cost;
    };

    /**
     * Town buildings are generated a whole town at a time (~5-20 ms). Do it for the next town ahead while it is
     * still off screen, one town per tick, so it never lands in the same frame as lots of chunk generation.
     */
    function prefetchTown(p) {
        const w = session.world;
        for (const t of w.region.towns) {
            if (w.townBuildings.has(t.id)) continue;
            if (Math.hypot(t.x - p.x, t.y - p.y) < t.radius + 700) { w.buildingsOfTown(t); return; }
        }
    }

    /** Applies a quality preset: chunk cache size (and so cached ground paths) and the traffic cap. */
    session.applyQuality = name => {
        session.settings.quality = QUALITY[name] ? name : 'medium';
        const q = QUALITY[session.settings.quality];
        if (session.world) session.world.chunks.cap = Math.max(60, q.spriteCache * 3);
        if (session.traffic) session.traffic.cap = q.traffic;
        session.chunkBudget = q.drawChunks;
    };

    const playerBody = { x: 0, y: 0, heading: 0, speed: 0, len: 4, width: 2 };
    function stepTraffic(dt) {
        const p = session.player;
        const c = bodyCentre(p);
        Object.assign(playerBody, { x: c.x, y: c.y, heading: p.heading, speed: p.speed, len: p.spec.length, width: p.spec.width });
        session.traffic.step(dt, { year: session.year, player: playerBody, grip: session.grip ?? 1 });
        session.vehicles = session.traffic.agents;
        // bumping into traffic: the other vehicle stops for a moment; the player is pushed back
        for (const a of session.traffic.agents) {
            if (Math.abs(a.x - c.x) > 14 || Math.abs(a.y - c.y) > 14) continue;
            const box = obb(a.x, a.y, a.spec.len, a.spec.width, a.heading);
            if (!sat(box, obb(c.x, c.y, p.spec.length, p.spec.width, p.heading))) continue;
            const impact = collideVehicle(p, { ...box, vx: Math.cos(a.heading) * a.speed, vy: Math.sin(a.heading) * a.speed, invMass: 0 });
            a.stunned = 2.5;
            a.speed = 0;
            if (impact > 0.5) { session.lastImpact = impact; session.onImpact?.(impact, { kind: 'vehicle', ref: a }); }
        }
    }

    const agentPose = { x: 0, y: 0, heading: 0 };
    /** Draws a traffic vehicle (positions are lane centres = body centres; the drawer wants the rear axle). */
    session.drawTraffic = (ctx, proj, a, alpha, light) => {
        const spec = agentDrawSpec(a);
        lerpPose(a, alpha, agentPose);
        const off = spec.length / 2 - spec.rearOverhang;
        agentPose.x -= Math.cos(agentPose.heading) * off;
        agentPose.y -= Math.sin(agentPose.heading) * off;
        drawVehicle(ctx, proj, spec, agentPose, { light, lamps: light < 0.6, brake: a.speed < 0.5 && a.waiting > 0 });
    };

    function tickClock(dt) {
        handleClock(advance(session.career.calendar, dt));
        updateFleet();
    }

    let lastDriverUpdate = -Infinity;
    /** Hired drivers move on whenever the clock does (every game quarter-hour or so). */
    function updateFleet(force = false) {
        const c = session.career;
        if (!c.drivers.length || (!force && c.calendar.minutes - lastDriverUpdate < 10)) return;
        lastDriverUpdate = c.calendar.minutes;
        const events = updateDrivers(c, {
            world: session.world, year: session.year,
            offersFor: depot => refreshOffers(c, session.world, depot, session.player, session.year),
        });
        for (const e of events) session.emit(e.kind, e);
    }

    function handleClock(ev) {
        if (ev.newYear) {
            const before = session.year;
            session.year = ev.year;
            session.emit('newYear', ev.year);
            // vehicles from a bygone era leave the roads
            if (session.traffic) session.traffic.agents = session.traffic.agents.filter(t => ev.year >= t.spec.from && ev.year < t.spec.to);
            for (const e of eventsBetween(session.world, before, ev.year)) session.emit('news', describeEvent(e));
            if (session.career.job) updateRoute();
        }
        if (ev.newDay) session.emit('newDay', ev);
        for (let k = 0; k < ev.newWeek; k++) {
            for (const e of weeklyTick(session.career, { year: session.year, tier: session.tier?.() ?? 0 })) session.emit('weekly', e);
            session.emit('newWeek', ev);
        }
    }

    // ---- jobs -------------------------------------------------------------------------------------------------

    /** F away from a depot: take a ferry when stopped at its slip. */
    session.interact = () => {
        const p = session.player;
        if (session.outOfFuel && Math.abs(p.speed) < 0.5) { session.callTow(); return true; }
        const slip = slipNear(session.world, p.x, p.y, session.year);
        if (!slip) return false;
        if (Math.abs(p.speed) > 0.5) { session.emit('toast', 'Stop at the slipway to board the ferry'); return true; }
        const minutes = crossingMinutes(slip);
        post(session.career.ledger, session.career.calendar.minutes, `${slip.name} fare`, -slip.fee, 'ferry');
        handleClock(advanceHours(session.career.calendar, minutes / 60));
        const t = slip.to;
        teleport(t.x, t.y, t.heading);
        session.emit('ferry', { slip, minutes });
        if (session.career.job) updateRoute();
        return true;
    };

    /** Prompts for the yard the player is stopped in (depot office, garage) or for a tow. */
    function placeHint(p) {
        if (session.outOfFuel) return 'Out of fuel: press F to call a tow';
        const c = couplingPrompt(p);
        if (c) return c;
        if (Math.abs(p.speed) > 0.3) return null;
        const yard = session.world.yardAt(p.x, p.y);
        if (yard?.type === 'depot') return session.career.depots.includes(yard.id) ? 'Press F for the depot office' : `${yard.name}: for sale (visit your own depot office to buy)`;
        if (yard?.type === 'garage') return 'Press F for fuel and repairs';
        return null;
    }

    function ferryHint() {
        const p = session.player;
        const slip = slipNear(session.world, p.x, p.y, session.year, 14);
        return slip ? `Press F to take the ${slip.name} (£${slip.fee})` : null;
    }

    function stepJob(dt) {
        const job = session.career.job;
        const p = session.player;
        if (!job) {
            session.activeYard = null;
            session.stopCheck = null;
            session.jobHint = placeHint(p) ?? ferryHint();
            return;
        }
        const stop = currentStop(job);
        let check;
        if (stop.kind === 'trailer') check = { ok: p.trailer?.id === stop.trailer, reason: 'trailer' };
        else if (stop.action === 'drop' && p.trailer?.id !== stop.trailer) check = { ok: false, reason: 'noTrailer' };
        else check = stop.kind === 'bay' ? bayCheck(p, stop) : doorCheck(p, stop);
        session.stopCheck = check;
        session.activeYard = stop.kind === 'bay' ? session.world.yards.find(y => y.id === stop.yard) ?? null : null;
        const ev = updateJob(job, check, dt);
        if (ev === 'startWork') session.emit('startWork', stop);
        else if (ev) afterStop(ev);
        let hint = bayHint(check, stop.kind);
        if (check.reason === 'trailer') hint = 'Reverse under the client\u2019s trailer and press C';
        if (check.reason === 'noTrailer') hint = 'Couple the job\u2019s trailer first';
        session.jobHint = job.working ? `${stop.action === 'load' ? 'Loading' : 'Unloading'}… ${Math.ceil(job.timer)} s` : hint ?? placeHint(p) ?? ferryHint();
        routeTimer -= dt;
        if (routeTimer <= 0) updateRoute();
    }

    function afterStop(ev) {
        const job = session.career.job;
        const done = job.contract.stops[job.stop - 1];
        // dropping a client trailer: uncouple it and the client takes it away
        if (done?.action === 'drop' && session.player.trailer?.id === done.trailer) {
            const t = uncouple(session.player);
            if (t) { session.trailerObjs.delete(t.id); session.player.rec.trailer = null; }
        }
        // an artic carries its load on the trailer
        if (session.player.trailer) session.player.trailer.cargoMass = cargoOnBoard(job);
        else session.player.cargoMass = cargoOnBoard(job);
        session.emit('stopDone', job);
        if (ev === 'complete') {
            const contract = job.contract;
            const result = completeJob(session.career);
            session.player.cargoMass = 0;
            session.route = null;
            session.activeYard = null;
            session.emit('complete', { contract, result });
            if (result.newTier) session.emit('tier', result.newTier);
        } else {
            updateRoute();
        }
    }

    function updateRoute() {
        routeTimer = 2;
        const stop = session.career.job && currentStop(session.career.job);
        if (!stop) { session.route = null; return; }
        const p = session.player;
        session.route = findRoute(session.world.graph, { x: p.x, y: p.y }, stop, { year: session.year, vmax: p.spec.topSpeedMph * 0.44704 });
    }

    /** Drawn under the ground transform: a faint route line and the ring at a kerbside drop. */
    session.drawGroundOverlay = ctx => {
        const route = session.route;
        if (route?.pts.length >= 4) {
            ctx.strokeStyle = 'rgba(255, 63, 180, 0.45)';
            ctx.lineWidth = 1.2;
            ctx.setLineDash([4, 5]);
            ctx.beginPath();
            ctx.moveTo(route.pts[0], route.pts[1]);
            for (let i = 2; i < route.pts.length; i += 2) ctx.lineTo(route.pts[i], route.pts[i + 1]);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        // reversing guide lines from the 1990s
        const pl = session.player;
        if (session.year >= 1990 && pl.speed < -0.1) {
            const body = pl.trailer ?? pl;
            drawGuideLines(ctx, rearPoint(pl), body.heading, body.spec.width);
        }
        const stop = session.career.job && currentStop(session.career.job);
        if (stop?.kind === 'door') {
            const pulse = 1 + 0.15 * Math.sin(session.time * 4);
            ctx.strokeStyle = session.stopCheck?.ok ? '#6fd26f' : '#f2b33d';
            ctx.lineWidth = 0.45;
            ctx.beginPath(); ctx.arc(stop.x, stop.y, 2.2 * pulse, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = 'rgba(242, 179, 61, 0.25)';
            ctx.fill();
        }
    };

    session.acceptOffer = id => {
        const offer = session.career.offers.find(o => o.id === id);
        if (!offer || !session.canTake(offer)) return null;
        const job = acceptOffer(session.career, id);
        if (job) for (const ct of offer.trailers ?? []) placeClientTrailer(ct);
        if (job) { session.player.cargoMass = 0; updateRoute(); session.emit('accepted', job); }
        return job;
    };
    /** A client's trailer waiting in a yard for a trailer job (in the client's own colours). */
    function placeClientTrailer(ct) {
        const yard = session.world.yards.find(y => y.id === ct.at);
        const spec = trailerById(ct.model);
        const spot = trailerSpots(yard, spec)[1];
        const t = spawnTrailer(ct.id, spec, spot, { client: true, cargoMass: ct.weight, livery: { livery1: '#7a2b2b', livery2: '#e8e2d0' } });
        return t;
    }

    session.abandonJob = () => {
        const job = session.career.job;
        for (const ct of job?.contract.trailers ?? []) {
            if (session.player.trailer?.id === ct.id) { uncouple(session.player); session.player.rec.trailer = null; }
            session.trailerObjs.delete(ct.id);
        }
        const fee = abandonJob(session.career);
        session.player.cargoMass = 0;
        session.route = null;
        return fee;
    };
    session.tier = () => tierOf(session.career.reputation.points);
    session.whyNot = offer => cannotTake(offer, session.player.spec, session.player.trailer?.spec ?? null) ?? '';
    session.canTake = offer => !session.whyNot(offer);
    session.offersAt = depot => refreshOffers(session.career, session.world, depot, session.player, session.year);
    session.jobStage = () => (session.career.job ? jobStage(session.career.job) : null);
    session.onImpact = impact => {
        const rec = session.player.rec;
        if (rec) rec.damage = Math.min(100, rec.damage + impactToDamage(impact));
        const job = session.career.job;
        if (job && cargoOnBoard(job) > 0) job.cargoDamage = Math.min(100, job.cargoDamage + impactDamage(impact));
        session.emit('impact', impact);
    };

    /** Fleet vehicles parked in yards (not the one being driven, not out with a driver): {rec, spec, pose}. */
    session.parked = () => session.career.fleet
        .filter(v => v.pose && v.id !== session.career.activeVehicle && !session.career.drivers.some(d => d.vehicle === v.id && d.job))
        .map(v => ({ rec: v, spec: vehicleById(v.model), pose: v.pose }));

    /** Static obstacles (buildings, trees, rocks) and the sea/estuaries (wide water is a wall unless on a road). */
    function collide(p) {
        const box = vehicleObb(p);
        for (const col of session.world.colliders.query(box)) {
            if (col.kind === 'cone') { if (sat(box, col.box)) knockCone(col.ref); continue; }
            const impact = collideVehicle(p, col.box);
            if (impact > 0.5) { session.lastImpact = impact; session.onImpact?.(impact, col); }
        }
        for (const t of session.looseTrailers()) {
            if (Math.abs(t.x - p.x) > 25 || Math.abs(t.y - p.y) > 25) continue;
            const impact = collideVehicle(p, trailerObb(t, p.spec.tags.includes('tractor-unit') ? underRun(t.spec) : 0));
            if (impact > 0.5) { session.lastImpact = impact; session.onImpact?.(impact, { kind: 'trailer' }); }
        }
        for (const pv of session.parked()) {
            if (Math.abs(pv.pose.x - p.x) > 20 || Math.abs(pv.pose.y - p.y) > 20) continue;
            const off = pv.spec.length / 2 - pv.spec.rearOverhang;
            const pb = obb(pv.pose.x + Math.cos(pv.pose.heading) * off, pv.pose.y + Math.sin(pv.pose.heading) * off, pv.spec.length, pv.spec.width, pv.pose.heading);
            const impact = collideVehicle(p, pb);
            if (impact > 0.5) { session.lastImpact = impact; session.onImpact?.(impact, { kind: 'vehicle' }); }
        }
        const c = bodyCentre(p);
        const ahead = { x: c.x + Math.cos(p.heading) * Math.sign(p.speed) * p.spec.length / 2, y: c.y + Math.sin(p.heading) * Math.sign(p.speed) * p.spec.length / 2 };
        if (p.speed !== 0 && waterAt(session.world.region, ahead.x, ahead.y) >= 30 && session.offRoad) {
            p.x = p.prevX; p.y = p.prevY; p.heading = p.prevHeading;
            if (Math.abs(p.speed) > 0.5) { session.lastImpact = Math.abs(p.speed); session.onImpact?.(Math.abs(p.speed), { kind: 'water' }); }
            p.speed = 0;
        }
    }

    session.updateCamera = (camera, view) => {
        const p = session.player;
        const now = performance.now() / 1000;
        const dt = Math.min(0.1, now - (session._camT ?? now));
        session._camT = now;
        const c = bodyCentre(p);
        // with a trailer the reversing view zooms out to the whole rig, centred between tractor and trailer
        const t = p.trailer;
        const len = p.spec.length + (t ? t.spec.length - 1.5 : 0);
        const rev = p.speed < -0.2;
        const cx = t && rev ? (c.x + t.x) / 2 : c.x, cy = t && rev ? (c.y + t.y) / 2 : c.y;
        camera.update({ x: cx, y: cy, heading: p.heading, speed: p.speed, reversing: rev, length: len }, view, dt);
    };

    session.recordFrame = ms => {
        session.perf.push(ms);
        if (session.perf.length > PERF_SAMPLES) session.perf.shift();
    };

    session.debugHook = () => ({
        get state() { return session; },
        teleport,
        spawnAtDepot: () => spawnAtDepot(),
        setControls(controls) { session.input.setOverride(controls); },
        /** Completes the current stop of the active job at once (as if the timer ran out). */
        completeDrop() {
            const job = session.career.job;
            if (!job) return null;
            const ev = finishStop(job);
            afterStop(ev);
            return ev;
        },
        /** Jumps the clock (in day-sized steps so drivers' jobs and weekly bills happen in order). */
        advanceClock(hours) {
            let left = hours;
            while (left > 0) {
                const h = Math.min(24, left);
                handleClock(advanceHours(session.career.calendar, h));
                updateFleet(true);
                left -= h;
            }
            updateEnvironment(0, true);
        },
        /** Forces the weather (for screenshots and tests): {kind, intensity}. */
        setWeather(w) { weatherOverride = w; updateEnvironment(0, true); },
        /** {buildings, chunks, frameMs (average CPU ms per frame over the last samples)} */
        stats() {
            const r = session.renderStats ?? {};
            const perf = session.perf;
            const loadedBuildings = session.world ? session.world.chunks.loaded().reduce((n, c) => n + c.buildings.length, 0) : 0;
            return { ...r, loadedBuildings, frameMs: perf.length ? perf.reduce((a, b) => a + b, 0) / perf.length : 0, samples: perf.length };
        },
        resetPerf() { session.perf.length = 0; },
        newGame: opts => { session.newGame(opts); session.emit('debugStart'); },
    });

    // ---- new games and saves ----------------------------------------------------------------------------------

    /** Clears the world of the old career's things (trailers, traffic, route, practice). */
    function resetWorldState() {
        session.trailerObjs.clear();
        if (session.traffic) session.traffic.agents = [];
        session.vehicles = session.traffic?.agents ?? [];
        session.route = null;
        session.practiceReturn = null;
        session.inPractice = false;
        session.outOfFuel = false;
        session.indicator = null;
    }

    /** Starts a fresh company at the Exeter depot on 1 January 1919. */
    session.newGame = ({ company, livery } = {}) => {
        session.career = createCareer({ company: company?.trim() || undefined, livery: livery ?? undefined });
        session.year = dateOf(session.career.calendar.minutes).year;
        resetWorldState();
        session.player = vehicleFor(activeFleetVehicle(session.career));
        if (session.settings.manualGears) session.player.gearbox.manual = true;
        spawnAtDepot();
        buildTrailers();
        updateEnvironment(0, true);
        session.emit('newGame', session.career);
    };

    /** Restores a (migrated) save. */
    session.loadSave = data => {
        session.career = data.career;
        session.year = dateOf(session.career.calendar.minutes).year;
        resetWorldState();
        session.player = vehicleFor(activeFleetVehicle(session.career) ?? session.career.fleet[0]);
        if (session.settings.manualGears) session.player.gearbox.manual = true;
        const at = data.player;
        const depot = at?.atDepot ? session.world.depots.find(d => d.id === at.atDepot) : null;
        if (depot) spawnAtDepot(depot); else if (at) teleport(at.x, at.y, at.heading); else spawnAtDepot();
        session.player.cargoMass = data.cargoMass ?? 0;
        buildTrailers();
        for (const ct of data.clientTrailers ?? []) {
            const t = spawnTrailer(ct.id, trailerById(ct.model), { x: ct.x, y: ct.y, heading: ct.heading }, { client: true, cargoMass: ct.cargoMass, livery: { livery1: '#7a2b2b', livery2: '#e8e2d0' } });
            if (ct.coupled && session.player.spec.tags.includes('tractor-unit')) { session.player.trailer = t; t.coupled = true; t.legsDown = false; attach(session.player, t); }
        }
        if (session.career.job) updateRoute();
        updateEnvironment(0, true);
        session.emit('loaded', session.career);
    };

    session.makeSave = () => makeSave(session);

    session.teleport = teleport;
    session.dispose = () => {};

    if (world) setWorld(world);
    session.ready = world
        ? Promise.resolve()
        : loadRegion(regionId).then(region => setWorld(createWorld(region))).catch(err => {
            session.loadingText = 'Could not load the map. Check your connection and reload.';
            console.error(err);
        });
    return session;
}
