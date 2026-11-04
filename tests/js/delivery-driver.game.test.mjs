import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorld } from '../../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { createSession } from '../../Games.Client/wwwroot/games/delivery-driver/game/session.js';
import { createCalendar, advance, dateOf, formatDateTime, weekIndex, minutesAt } from '../../Games.Client/wwwroot/games/delivery-driver/game/calendar.js';
import { generateOffers, startJob, updateJob, jobStage, finishStop, settle, cargoOnBoard } from '../../Games.Client/wwwroot/games/delivery-driver/game/contracts.js';
import { bayCheck, rearPoint } from '../../Games.Client/wwwroot/games/delivery-driver/game/depots.js';
import { createVehicle } from '../../Games.Client/wwwroot/games/delivery-driver/sim/vehicle.js';
import { vehicleById } from '../../Games.Client/wwwroot/games/delivery-driver/game/catalogue.js';
import { createTraffic } from '../../Games.Client/wwwroot/games/delivery-driver/traffic/traffic.js';
import { createGraph, createSegmentIndex, laneOffset, lanePoint, edgeOpen } from '../../Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js';
import { obb, sat } from '../../Games.Client/wwwroot/games/delivery-driver/sim/collision.js';

const SEED = new URL('../../Games.Client/wwwroot/games/delivery-driver/world/seed/sw-england.json', import.meta.url);
const world = createWorld(JSON.parse(fs.readFileSync(SEED, 'utf8')));
const depot = world.depots.find(d => d.home);

function stubInput(controls = { throttle: 0, brake: 0, steer: 0 }) {
    return { update: () => controls, setOverride() {}, onAction() {} };
}

test('the calendar starts at 09:30 on 1 Jan 1919 and runs 15 game minutes per real minute', () => {
    const cal = createCalendar();
    assert.equal(formatDateTime(cal.minutes), 'Wed 1 Jan 1919, 09:30');
    advance(cal, 60);
    assert.equal(formatDateTime(cal.minutes), 'Wed 1 Jan 1919, 09:45');
    const ev = advance(cal, 4 * 60 * 14.5); // 14.5 game hours, to 00:15 the next day
    assert.equal(ev.newDay, 1);
    assert.equal(dateOf(cal.minutes).day, 2);
    assert.equal(weekIndex(minutesAt(1919, 0, 6)) - weekIndex(minutesAt(1919, 0, 5, 23, 59)), 1, 'weeks start on Monday');
});

test('the session clock only runs while driving, not while paused', () => {
    const s = createSession({ world });
    s.input = stubInput();
    const t0 = s.career.calendar.minutes;
    for (let i = 0; i < 60 * 60; i++) s.step(1 / 60); // one real minute
    assert.ok(Math.abs(s.career.calendar.minutes - t0 - 15) < 1e-6);
    s.setPaused(true);
    for (let i = 0; i < 60 * 60; i++) s.step(1 / 60);
    assert.ok(Math.abs(s.career.calendar.minutes - t0 - 15) < 1e-6);
});

const offers = generateOffers({ world, depot, minutes: 360, year: 1919 });

test('offers are deterministic per depot and game hour, and fit the van', () => {
    assert.ok(offers.length >= 3);
    assert.deepEqual(generateOffers({ world, depot, minutes: 400, year: 1919 }).map(o => o.id), offers.map(o => o.id));
    assert.notDeepEqual(generateOffers({ world, depot, minutes: 360 + 60, year: 1919 }).map(o => o.title + o.pay), offers.map(o => o.title + o.pay), 'a new board each game hour');
    for (const o of offers) {
        assert.ok(o.weight <= 1000 && o.pay > 0 && o.window >= 90);
        assert.equal(o.stops.filter(s => s.action === 'load').reduce((t, s) => t + s.weight, 0), o.stops.filter(s => s.action === 'unload').reduce((t, s) => t + s.weight, 0));
    }
    assert.ok(offers.some(o => o.type === 'multidrop'));
});

test('the job state machine goes load -> drops -> complete', () => {
    const contract = offers.find(o => o.type === 'multidrop');
    const job = startJob(contract, 360);
    const parked = { ok: true }, away = { ok: false };
    assert.equal(jobStage(job), 'toLoad');
    assert.equal(updateJob(job, away, 1), null);
    assert.equal(updateJob(job, parked, 0.1), 'startWork');
    assert.equal(jobStage(job), 'loading');
    // driving off part way resets the work
    updateJob(job, away, 0.1);
    assert.equal(jobStage(job), 'toLoad');
    updateJob(job, parked, 0.1);
    let ev = null;
    for (let i = 0; i < 1000 && ev !== 'stopDone'; i++) ev = updateJob(job, parked, 0.1);
    assert.equal(ev, 'stopDone');
    assert.equal(jobStage(job), 'toDrop');
    assert.equal(cargoOnBoard(job), contract.weight);
    const drops = contract.stops.length - 1;
    for (let d = 0; d < drops; d++) {
        updateJob(job, parked, 0.1);
        assert.equal(jobStage(job), 'unloading');
        ev = null;
        for (let i = 0; i < 1000 && !ev; i++) ev = updateJob(job, parked, 0.1);
        assert.equal(ev, d === drops - 1 ? 'complete' : 'stopDone');
    }
    assert.equal(jobStage(job), 'complete');
    assert.equal(cargoOnBoard(job), 0);
});

test('a late delivery pays less; an early undamaged one earns a bonus; damage is deducted', () => {
    const contract = offers[0];
    const done = (at, damage = 0) => {
        const job = startJob(contract, 1000);
        job.cargoDamage = damage;
        while (!job.done) finishStop(job);
        return settle(job, at);
    };
    const early = done(1000 + contract.window * 0.25);
    const onTime = done(1000 + contract.window * 0.9);
    const late = done(1000 + contract.window + 120);
    const damaged = done(1000 + contract.window * 0.25, 30);
    assert.ok(early.bonus > 0 && early.total > contract.pay);
    assert.equal(onTime.total, contract.pay);
    assert.ok(late.total < contract.pay && late.late > 0 && !late.onTime);
    assert.ok(damaged.total < contract.pay && damaged.bonus === 0);
});

test('the bay check needs the rear on the marker, the right heading and a standstill', () => {
    const m = depot.yard.marker;
    const v = createVehicle(vehicleById('tamar-t-ton'), { x: 0, y: 0, heading: m.heading });
    const place = (heading, offset = 0) => {
        v.heading = heading;
        v.x = m.x + Math.cos(heading) * v.spec.rearOverhang + offset;
        v.y = m.y + Math.sin(heading) * v.spec.rearOverhang;
    };
    place(m.heading);
    const r = rearPoint(v);
    assert.ok(Math.hypot(r.x - m.x, r.y - m.y) < 1e-6);
    assert.equal(bayCheck(v, m).ok, true);
    place(m.heading + 0.4);
    assert.equal(bayCheck(v, m).reason, 'angle');
    place(m.heading);
    v.speed = 1;
    assert.equal(bayCheck(v, m).reason, 'moving');
    v.speed = 0;
    place(m.heading, 2.5);
    assert.equal(bayCheck(v, m).reason, 'position');
});

test('traffic stays on open lanes over 10,000 seeded steps around Exeter', () => {
    const tr = createTraffic(world.graph, { seed: 42, cap: 24 });
    const ex = world.region.townById.get('exeter');
    const player = { x: ex.x, y: ex.y, heading: 0, speed: 0, len: 4, width: 1.8 };
    let seen = 0;
    for (const year of [1919, 1965]) {
        for (let i = 0; i < 5000; i++) {
            tr.step(1 / 60, { year, player });
            for (const a of tr.agents) {
                const e = world.graph.edges[a.edge];
                assert.ok(edgeOpen(e, year) && e.cls !== 'lane' && e.cls !== 'access' && e.cls !== 'ferry', `agent on ${e.cls}`);
                const p = lanePoint(e, a.along, a.forward, laneOffset(e, year), {});
                assert.ok(Math.hypot(p.x - a.x, p.y - a.y) < 6, 'agent off its lane'); // eased through junctions, never far from the lane
                assert.ok(a.along >= 0 && a.along <= e.len + 1e-6);
            }
            seen = Math.max(seen, tr.agents.length);
        }
    }
    assert.ok(seen >= 5, `${seen} agents`);
});

function crossroads(majorEastWest) {
    const g = createGraph();
    const c = g.addNode(0, 0);
    const arms = [[120, 0], [0, 120], [-120, 0], [0, -120]].map(([x, y]) => {
        const n = g.addNode(x, y);
        return g.addEdge(n, c, [x, y, 0, 0], { cls: majorEastWest && y === 0 ? 'A' : 'street' });
    });
    for (const n of g.nodes) n.junction = n.edges.length >= 3 ? 'giveway' : 'end';
    g.index = createSegmentIndex(g);
    return { g, arms };
}

for (const major of [false, true]) {
    test(`traffic gives way so no two vehicles overlap at a crossroads (${major ? 'major/minor' : 'equal'} roads)`, () => {
        const { g, arms } = crossroads(major);
        const tr = createTraffic(g, { seed: 7, cap: 0 });
        let through = 0;
        for (let step = 0; step < 10000; step++) {
            if (step % 75 === 0) tr.spawnOn(arms[(step / 75) % 4], true, 5, 1950, (step / 75) % 3 ? 'saloon30' : 'bus');
            const before = new Map(tr.agents.map(a => [a.id, a.edge]));
            tr.step(1 / 60, { year: 1950, player: null });
            for (const a of tr.agents) if (before.has(a.id) && before.get(a.id) !== a.edge) through++;
            tr.agents = tr.agents.filter(a => a.forward || a.along < 100); // leave the scene past the junction
            const list = tr.agents;
            for (let i = 0; i < list.length; i++) {
                for (let j = i + 1; j < list.length; j++) {
                    const a = list[i], b = list[j];
                    assert.equal(sat(obb(a.x, a.y, a.spec.len, a.spec.width, a.heading), obb(b.x, b.y, b.spec.len, b.spec.width, b.heading)), null, `step ${step}: ${a.id} overlaps ${b.id}`);
                }
            }
        }
        assert.ok(through > 20, `${through} vehicles crossed`);
    });
}
