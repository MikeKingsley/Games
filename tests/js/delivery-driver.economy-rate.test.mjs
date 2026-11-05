// Plan 0009 phase 6: at 1:4 a real mile takes TRIP_RATE times longer to drive than at 1:13, so pay per mile, fuel per
// mile and wear per mile are times TRIP_RATE and income per minute of driving is what it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedWithBaked } from './helpers/delivery-seed.mjs';
import { createWorld } from '../../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { findRoute } from '../../Games.Client/wwwroot/games/delivery-driver/world/pathfind.js';
import { quote, generateOffers } from '../../Games.Client/wwwroot/games/delivery-driver/game/contracts.js';
import { fuelBurn, wearForMiles, WEAR_PER_MILE } from '../../Games.Client/wwwroot/games/delivery-driver/game/economy.js';
import { createCareer, newFleetVehicle } from '../../Games.Client/wwwroot/games/delivery-driver/game/career.js';
import { hirePool, hireDriver, assignVehicle, startAiJob, updateDrivers } from '../../Games.Client/wwwroot/games/delivery-driver/game/fleet.js';
import { climbModel } from '../../Games.Client/wwwroot/games/delivery-driver/sim/slope.js';
import { vehicleById } from '../../Games.Client/wwwroot/games/delivery-driver/game/catalogue.js';
import { GAME_MINUTES_PER_SECOND, advanceHours, minutesAt } from '../../Games.Client/wwwroot/games/delivery-driver/game/calendar.js';
import { WORLD_SCALE, LEGACY_SCALE, TRIP_RATE, MPH, worldToMiles } from '../../Games.Client/wwwroot/games/delivery-driver/config.js';
import { TIERS } from '../../Games.Client/wwwroot/games/delivery-driver/game/reputation.js';

const world = createWorld(seedWithBaked());
const home = world.depots.find(d => d.home);
const spec = vehicleById('exe-two-tonner');
const route = (a, b) => findRoute(world.graph, world.region.townById.get(a), world.region.townById.get(b), { year: 1930, vmax: spec.topSpeedMph * MPH, climb: climbModel(spec, spec.payload) });

/** What the same real route paid and burned at 1:13 (the pre-plan formulas; the route's drive time divided by TRIP_RATE). */
function atOldScale(r, weight, stops) {
    const miles = worldToMiles(r.length), hill = Math.max(1, r.hill);
    return {
        pay: Math.round(3 + miles * 0.9 * hill + (weight / 1000) * 4 + stops),
        driveMin: (r.time / TRIP_RATE) * GAME_MINUTES_PER_SECOND,
        fuel: (spec.fuelUse / 100) * (r.length / WORLD_SCALE / 1000) * (1 + 0.7 * 0.5) * (0.45 + 0.55 * 0.7) * r.fuel,
    };
}

test('TRIP_RATE is the ratio of the new to the 1:13 scale', () => {
    assert.ok(Math.abs(TRIP_RATE - 3.25) < 1e-12 && LEGACY_SCALE === 1 / 13);
});

test('pay and fuel per minute of driving are within 5% of the 1:13 game for the same job', () => {
    for (const [a, b] of [['exeter', 'tiverton'], ['exeter', 'plymouth'], ['barnstaple', 'okehampton'], ['exeter', 'penzance'], ['lynton', 'stives']]) {
        const r = route(a, b);
        assert.ok(r, `${a} to ${b}`);
        const old = atOldScale(r, 1000, 2);
        const driveMin = r.time * GAME_MINUTES_PER_SECOND;
        const pay = quote(r.length, 1000, 2, 1, r.hill);
        const fuel = fuelBurn(spec, r.length, 0.5, 0.7) * r.fuel;
        const payRatio = pay / driveMin / (old.pay / old.driveMin), fuelRatio = fuel / driveMin / (old.fuel / old.driveMin);
        assert.ok(Math.abs(payRatio - 1) < 0.05, `${a}-${b} pay per driving minute x${payRatio.toFixed(3)}`);
        assert.ok(Math.abs(fuelRatio - 1) < 0.05, `${a}-${b} fuel per driving minute x${fuelRatio.toFixed(3)}`);
    }
    // wear per minute of driving follows the same rule
    assert.ok(Math.abs(wearForMiles(10) - 10 * WEAR_PER_MILE * TRIP_RATE) < 1e-12);
});

test('a contract window grows with the distance and always covers the drive', () => {
    const seen = [];
    for (const depot of world.depots.slice(0, 6)) {
        for (let h = 0; h < 6; h++) {
            const offers = generateOffers({ world, depot, minutes: minutesAt(1930, 3, 3, 8 + h), year: 1930, vmax: 17, tierInfo: TIERS[3], count: 8, fleet: [{ tags: ['van', 'box', 'flatbed', 'tipper', 'reefer', 'milk', 'livestock', 'fuel', 'lowloader'], capacity: 12000 }] });
            for (const o of offers) seen.push(o);
        }
    }
    assert.ok(seen.length > 30, `${seen.length} offers`);
    seen.sort((a, b) => a.distance - b.distance);
    const third = Math.floor(seen.length / 3);
    const mean = list => list.reduce((s, o) => s + o.window, 0) / list.length;
    assert.ok(mean(seen.slice(-third)) > mean(seen.slice(0, third)) * 1.5, `long ${mean(seen.slice(-third))} vs short ${mean(seen.slice(0, third))}`);
    for (const o of seen) assert.ok(o.window >= (o.distance / (17 * 0.65)) * GAME_MINUTES_PER_SECOND * 2.2, `${o.title}: window ${o.window} for ${o.distance} m`);
});

test('an off-screen driver earns about what the same job paid per game day at 1:13 (within 10%)', () => {
    const year = 1930, start = minutesAt(year, 2, 3, 8);
    const to = world.depots.find(d => d.id !== home.id && Math.hypot(d.x - home.x, d.y - home.y) > 8000) ?? world.depots.find(d => d.id !== home.id);
    const c = createCareer({ money: 1000, minutes: start });
    const v = newFleetVehicle(c, 'exe-two-tonner', year, home.id, start);
    c.fleet.push(v);
    const driver = hireDriver(c, { ...hirePool(c, world.region.seed)[0], skill: 5 }, home.id);
    assert.ok(assignVehicle(c, driver.id, v.id));
    const at = d => ({ x: d.yard.marker.x, y: d.yard.marker.y, heading: d.yard.marker.heading });
    const opts = { year, vmax: spec.topSpeedMph * MPH, climb: climbModel(spec, 500) };
    const r1 = findRoute(world.graph, home.yard.marker, to.yard.marker, opts), r2 = findRoute(world.graph, to.yard.marker, home.yard.marker, opts);
    const length = r1.length + r2.length;
    const hill = Math.max(1, (r1.time + r2.time) / Math.max(1e-9, r1.flatTime + r2.flatTime));
    const contract = {
        id: 'rate-test', type: 'haul', title: 'Rate test', client: { id: 'rate-client', name: 'Rate' }, cargo: 'goods', cargoName: 'Goods', weight: 500, tags: [], factor: 1,
        pay: quote(length, 500, 2, 1, hill), window: 1e9,
        stops: [{ action: 'load', kind: 'bay', name: 'A', ...at(home), weight: 500 }, { action: 'unload', kind: 'bay', name: 'B', ...at(to), weight: 500 }],
    };
    const job = startAiJob(c, world, driver, contract, year);
    assert.ok(job, 'job started');
    const days = (job.end - job.start) / 1440;
    advanceHours(c.calendar, (job.end - job.start) / 60 + 1);
    updateDrivers(c, { world, year });
    // the same job at 1:13: pay from the old formula (0.5 t x 4 + 2 stops), the fuel bill and the duration divided by TRIP_RATE
    const oldPay = Math.round(3 + worldToMiles(length) * 0.9 * hill + 0.5 * 4 + 2);
    const paid = c.ledger.entries.find(e => e.category === 'income').amount;
    const fuelNew = -(c.ledger.entries.find(e => e.category === 'fuel')?.amount ?? 0);
    const oldNet = paid * (oldPay / contract.pay) - fuelNew / TRIP_RATE;
    const perDayNew = driver.earned / days, perDayOld = oldNet / (days / TRIP_RATE);
    assert.ok(Math.abs(perDayNew / perDayOld - 1) < 0.1, `income per game day ${perDayNew.toFixed(1)} vs ${perDayOld.toFixed(1)} at 1:13`);
});
