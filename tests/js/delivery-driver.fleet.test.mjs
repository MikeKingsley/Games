import { test } from 'node:test';
import { seedWithBaked } from './helpers/delivery-seed.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorld } from '../../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { createCareer, newFleetVehicle, refreshOffers } from '../../Games.Client/wwwroot/games/delivery-driver/game/career.js';
import { hirePool, hireDriver, fireDriver, assignVehicle, startAiJob, updateDrivers, aiCannotTake, buyDepot, relocate, routeCost } from '../../Games.Client/wwwroot/games/delivery-driver/game/fleet.js';
import { findRoute } from '../../Games.Client/wwwroot/games/delivery-driver/world/pathfind.js';
import { createGraph, createSegmentIndex } from '../../Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js';
import { climbModel } from '../../Games.Client/wwwroot/games/delivery-driver/sim/slope.js';
import { quote } from '../../Games.Client/wwwroot/games/delivery-driver/game/contracts.js';
import { MPH } from '../../Games.Client/wwwroot/games/delivery-driver/config.js';
import { weeklyTick } from '../../Games.Client/wwwroot/games/delivery-driver/game/economy.js';
import { advanceHours, minutesAt } from '../../Games.Client/wwwroot/games/delivery-driver/game/calendar.js';
import { createVehicle } from '../../Games.Client/wwwroot/games/delivery-driver/sim/vehicle.js';
import { vehicleById } from '../../Games.Client/wwwroot/games/delivery-driver/game/catalogue.js';
import { TIERS } from '../../Games.Client/wwwroot/games/delivery-driver/game/reputation.js';

const world = createWorld(seedWithBaked());
const home = world.depots.find(d => d.home);

/** A career with a second vehicle at the home depot and a driver assigned to it. */
function setup({ model = 'tamar-t-ton', year = 1919, skill } = {}) {
    const c = createCareer({ money: 1000, minutes: minutesAt(year, 2, 3, 8) });
    const v = newFleetVehicle(c, model, year, home.id, c.calendar.minutes);
    c.fleet.push(v);
    const applicant = hirePool(c, world.region.seed)[0];
    if (skill) applicant.skill = skill;
    const d = hireDriver(c, applicant, home.id);
    assert.ok(assignVehicle(c, d.id, v.id));
    return { c, v, d, year };
}
const offersAt = (c, depot, year) => refreshOffers(c, world, depot, createVehicle(vehicleById(c.fleet[0].model)), year);

test('an assigned driver job completes after its planned duration and pays once', () => {
    const { c, d, year } = setup({ skill: 5 });
    const offer = offersAt(c, home, year).find(o => !aiCannotTake(c, d, o));
    const job = startAiJob(c, world, d, offer, year);
    assert.ok(job && job.end > job.start);
    assert.ok(!c.boards[home.id].offers.some(o => o.id === offer.id), 'taken off the board');
    const income = () => c.ledger.entries.filter(e => e.category === 'income' && e.text.startsWith(d.name));
    // not done just before the end...
    advanceHours(c.calendar, (job.end - job.start - 1) / 60);
    updateDrivers(c, { world, year });
    assert.equal(income().length, 0);
    // ...done after it, and only once however often we look
    advanceHours(c.calendar, 2 / 60);
    const events = updateDrivers(c, { world, year });
    assert.equal(events.filter(e => e.kind === 'aiPaid').length, 1);
    for (let k = 0; k < 5; k++) { advanceHours(c.calendar, 1); updateDrivers(c, { world, year }); }
    assert.equal(income().length, 1);
    assert.equal(income()[0].amount, offer.pay + Math.round(offer.pay * 0.15)); // a top driver is early: bonus
    assert.equal(d.job, null);
    assert.ok(c.fleet.find(v => v.id === d.vehicle).mileage > 0);
});

test('a fired driver stops working and is not paid afterwards', () => {
    const { c, d, year } = setup();
    const offer = offersAt(c, home, year).find(o => !aiCannotTake(c, d, o));
    const job = startAiJob(c, world, d, offer, year);
    assert.ok(fireDriver(c, d.id));
    advanceHours(c.calendar, (job.end - job.start) / 60 + 24 * 8);
    const events = [...updateDrivers(c, { world, year }), ...weeklyTick(c, { year })];
    assert.ok(!events.some(e => e.kind === 'aiPaid'));
    assert.ok(!c.ledger.entries.some(e => e.text.startsWith(d.name) && e.category === 'income'));
    assert.ok(!events.some(e => e.kind === 'wages'), 'no wages with no drivers');
    assert.equal(c.fleet.find(v => v.driver === d.id), undefined);
});

test('with auto-take on, a driver only takes work their vehicle can carry', () => {
    const { c, d, year } = setup({ model: 'moorland-tipper', year: 1936 });
    c.reputation.points = TIERS[2].at; // specials and haulage on offer
    d.auto = true;
    let taken = 0;
    for (let day = 0; day < 12; day++) {
        c.calendar.minutes = minutesAt(1936, 3, 1 + day, 8);
        const events = updateDrivers(c, { world, year, offersFor: depot => offersAt(c, depot, year) });
        if (d.job) {
            taken++;
            const contract = d.job.contract;
            const spec = vehicleById('moorland-tipper');
            if (contract.tags.length) assert.ok(contract.tags.every(t => spec.tags.includes(t)), contract.title);
            else assert.fail(`a tipper took general goods: ${contract.title}`);
            assert.ok(contract.weight <= spec.payload);
            assert.ok(events.some(e => e.kind === 'aiStarted'));
            c.calendar.minutes = d.job.end + 1;
            updateDrivers(c, { world, year });
        }
    }
    assert.ok(taken > 0, 'the tipper found china clay or granite work');
});

test('contracts are offered around every owned depot', () => {
    const c = createCareer({ money: 50000, minutes: minutesAt(1950, 4, 2, 8) });
    c.reputation.points = TIERS[2].at;
    const plymouth = world.depots.find(d => d.town === 'plymouth');
    const truro = world.depots.find(d => d.town === 'truro');
    assert.ok(!buyDepot(c, world, plymouth.id).error);
    assert.ok(!buyDepot(c, world, truro.id).error);
    for (const id of c.depots) {
        const depot = world.depots.find(d => d.id === id);
        const offers = offersAt(c, depot, 1950);
        assert.ok(offers.length > 0, id);
        const town = world.region.townById.get(depot.town);
        assert.ok(offers.some(o => o.stops.some(s => Math.hypot(s.x - town.x, s.y - town.y) < town.radius * 1.5)), `${id}: work in ${town.name}`);
    }
    const poor = createCareer({ money: 50000 });
    assert.ok(buyDepot(poor, world, plymouth.id).error, 'tier-gated');
});

test('wages are deducted every week', () => {
    const { c, d } = setup();
    const before = c.ledger.money;
    weeklyTick(c, { year: 1919 });
    weeklyTick(c, { year: 1919 });
    const wages = c.ledger.entries.filter(e => e.category === 'wages' && e.amount < 0);
    assert.equal(wages.length, 2);
    assert.equal(wages[0].amount, -d.wage);
    assert.ok(c.ledger.money <= before - 2 * d.wage);
});

test('a driver can move a vehicle to another owned depot', () => {
    const { c, d, v, year } = setup();
    const ply = world.depots.find(x => x.town === 'plymouth');
    c.depots.push(ply.id);
    const job = relocate(c, world, d, ply.id, year);
    assert.ok(job);
    c.calendar.minutes = job.end + 1;
    updateDrivers(c, { world, year });
    assert.equal(v.depot, ply.id);
    assert.equal(d.depot, ply.id);
    assert.equal(d.job, null);
    assert.ok(!c.ledger.entries.some(e => e.text.startsWith(d.name) && e.category === 'income'), 'no pay for a move');
});

/** Two separate 600 m B-roads, one level and one over a 15 m hill (up and down, ~8% at the steepest). */
function hillGraph() {
    const g = createGraph();
    const nodes = [[0, 0], [600, 0], [0, 300], [600, 300]].map(([x, y]) => g.addNode(x, y));
    const level = g.addEdge(nodes[0], nodes[1], [0, 0, 600, 0], { cls: 'B' });
    const hilly = g.addEdge(nodes[2], nodes[3], [0, 300, 600, 300], { cls: 'B' });
    profile(level, () => 0);
    profile(hilly, s => 15 * Math.sin((Math.PI * s) / 600));
    for (const n of g.nodes) n.junction = 'end';
    g.index = createSegmentIndex(g);
    return { g, level, hilly };
}
function profile(e, f) {
    const n = Math.ceil(e.len / 4);
    e.zStep = e.len / n;
    e.z = Float32Array.from({ length: n + 1 }, (_, i) => f(i * e.zStep));
}

test('a hilly route takes strictly more game time and fuel than a level route of equal length', () => {
    const { g } = hillGraph();
    const spec = vehicleById('exe-two-tonner');
    const opts = { year: 1930, vmax: spec.topSpeedMph * MPH, climb: climbModel(spec, spec.payload) };
    const level = findRoute(g, { x: 0, y: 0 }, { x: 600, y: 0 }, opts);
    const hilly = findRoute(g, { x: 0, y: 300 }, { x: 600, y: 300 }, opts);
    assert.ok(Math.abs(level.length - hilly.length) < 1e-6);
    assert.equal(level.hill, 1);
    assert.ok(Math.abs(level.fuel - 1) < 1e-9);
    assert.ok(hilly.hill > 1.05 && hilly.fuel > 1.05, `hill ${hilly.hill}, fuel ${hilly.fuel}`);
    assert.ok(Math.abs(hilly.climb - 15) < 0.1, `climbed ${hilly.climb}`);
    const a = routeCost(spec, level, 1), b = routeCost(spec, hilly, 1);
    assert.ok(b.minutes > a.minutes && b.fuel > a.fuel, `${b.minutes} vs ${a.minutes} min, ${b.fuel} vs ${a.fuel} l`);
    // weaker vehicles feel the hill more: a 1995 7.5-tonne box loses less time over it than the 1924 two-tonner
    const modern = vehicleById('exe-75');
    const fast = findRoute(g, { x: 0, y: 300 }, { x: 600, y: 300 }, { ...opts, vmax: 9 * MPH * 2.5, climb: climbModel(modern, modern.payload) });
    assert.ok(fast.hill < hilly.hill, `${fast.hill} vs ${hilly.hill}`);
});

test('between the same two places the route planner takes the level road over an equally long hilly one', () => {
    // approach roads into a fork: a level road and an equally long hilly one, rejoining before the far approach road
    const g = createGraph();
    const start = g.addNode(-200, 0), from = g.addNode(0, 0), to = g.addNode(800, 0), end = g.addNode(1000, 0);
    const approaches = [g.addEdge(start, from, [-200, 0, 0, 0], { cls: 'B' }), g.addEdge(to, end, [800, 0, 1000, 0], { cls: 'B' })];
    const level = g.addEdge(from, to, [0, 0, 400, 300, 800, 0], { cls: 'B' });
    const hilly = g.addEdge(from, to, [0, 0, 400, -300, 800, 0], { cls: 'B' });
    for (const e of approaches) profile(e, () => 0);
    profile(level, () => 0);
    profile(hilly, s => 20 * Math.sin((Math.PI * s) / hilly.len));
    g.index = createSegmentIndex(g);
    for (const [a, b] of [[{ x: -150, y: 0 }, { x: 950, y: 0 }], [{ x: 950, y: 0 }, { x: -150, y: 0 }]]) {
        const r = findRoute(g, a, b, { year: 1930, vmax: 10, climb: climbModel(vehicleById('exe-two-tonner'), 2000) });
        assert.ok(r.steps.some(s => s.edge === level) && !r.steps.some(s => s.edge === hilly), r.steps.map(s => s.edge.id).join());
        assert.ok(r.climb < 0.01 && r.hill === 1, `climb ${r.climb}, hill ${r.hill}`);
    }
});

test('hilly real roads cost the off-screen fleet more, and contracts pay for the hills', () => {
    const tavistock = world.region.townById.get('tavistock'); // over the edge of Dartmoor
    const spec = vehicleById('exe-two-tonner');
    const r = findRoute(world.graph, home.yard.marker, tavistock, { year: 1930, vmax: spec.topSpeedMph * MPH, climb: climbModel(spec, spec.payload) });
    assert.ok(r && r.hill > 1.03 && r.fuel > 1.03 && r.climb > 30, `hill ${r?.hill}, fuel ${r?.fuel}, climb ${r?.climb}`);
    assert.ok(r.time > r.flatTime);
    assert.ok(routeCost(spec, r, 1).fuel > routeCost(spec, { ...r, fuel: 1 }, 1).fuel);
    assert.ok(quote(r.length, 1000, 2, 1, r.hill) > quote(r.length, 1000, 2, 1, 1));
});
