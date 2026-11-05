import test from 'node:test';
import assert from 'node:assert/strict';
import { seedWithBaked } from './helpers/delivery-seed.mjs';
import { createWorld } from '../../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { createGraph, createSegmentIndex, edgeSpeed, laneOffset, lanePoint, coreNodes } from '../../Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js';
import { findRoute } from '../../Games.Client/wwwroot/games/delivery-driver/world/pathfind.js';
import { createTraffic } from '../../Games.Client/wwwroot/games/delivery-driver/traffic/traffic.js';
import { obb, sat } from '../../Games.Client/wwwroot/games/delivery-driver/sim/collision.js';
import { MPH } from '../../Games.Client/wwwroot/games/delivery-driver/config.js';
import { soak } from '../../scripts/traffic-soak.mjs';

/** A T: a south arm into the centre, an east arm out of it (one-way away) and a west arm (one-way into it). */
function tee() {
    const g = createGraph();
    const c = g.addNode(0, 0), s = g.addNode(0, 120), e = g.addNode(120, 0), w = g.addNode(-120, 0);
    const south = g.addEdge(s, c, [0, 120, 0, 0], { cls: 'street' });
    const east = g.addEdge(c, e, [0, 0, 120, 0], { cls: 'street', oneway: true });  // a -> b leaves the centre
    const west = g.addEdge(w, c, [-120, 0, 0, 0], { cls: 'street', oneway: true }); // a -> b enters the centre
    for (const n of g.nodes) n.junction = n.edges.length >= 3 ? 'giveway' : 'end';
    g.index = createSegmentIndex(g);
    return { g, south, east, west };
}

test('one-way streets: traffic never enters against them, spawns only forward, and leaves at a one-way dead end', () => {
    const { g, south, east, west } = tee();
    const tr = createTraffic(g, { seed: 3, cap: 0 });
    let onEast = 0;
    for (let step = 0; step < 6000; step++) {
        if (step % 90 === 0) tr.spawnOn(south, true, 5, 1990, 'car2k');
        if (step === 10) assert.equal(tr.spawnOn(west, false, 20, 1990, 'car2k').forward, true, 'a one-way spawn is forced forward');
        tr.step(1 / 60, { year: 1990, player: null });
        for (const a of tr.agents) {
            if (a.edge === west.id) assert.ok(a.forward, 'never against the west one-way');
            if (a.edge === east.id) { assert.ok(a.forward); onEast++; }
        }
    }
    assert.ok(onEast > 50, `${onEast} vehicle steps on the east arm`);
    assert.ok(tr.agents.length < 12, 'vehicles leave at the one-way dead end instead of piling up');
});

test('the router honours one-way streets', () => {
    // a square: the direct edge from (200,0) to (0,0) is one-way, so going the other way must take the long way round
    const g = createGraph();
    const n = [[0, 0], [200, 0], [200, 200], [0, 200]].map(([x, y]) => g.addNode(x, y));
    g.addEdge(n[1], n[0], [200, 0, 0, 0], { cls: 'A', oneway: true });
    g.addEdge(n[0], n[3], [0, 0, 0, 200], { cls: 'A' });
    g.addEdge(n[3], n[2], [0, 200, 200, 200], { cls: 'A' });
    g.addEdge(n[2], n[1], [200, 200, 200, 0], { cls: 'A' });
    for (const x of g.nodes) x.junction = 'through';
    g.index = createSegmentIndex(g);
    const there = findRoute(g, { x: 0, y: 0 }, { x: 200, y: 0 }, { year: 2000, vmax: 30, maxSnap: 5 });
    assert.ok(there, 'a route exists');
    assert.ok(there.steps.every(s => !(s.edge.oneway && !s.forward)), 'no step against a one-way');
    assert.ok(there.length > 500, `the long way round (${there.length.toFixed(0)} m)`);
    const back = findRoute(g, { x: 200, y: 0 }, { x: 0, y: 0 }, { year: 2000, vmax: 30, maxSnap: 5 });
    assert.ok(back.length < 250, 'the one-way is used with its direction');
});

test('baked speed limits cap cruising speed from their era', () => {
    assert.ok(edgeSpeed({ cls: 'street', maxspeed: 20 }, 2000) <= 20 * MPH + 1e-9);
    assert.equal(edgeSpeed({ cls: 'street', maxspeed: 20 }, 1920), edgeSpeed({ cls: 'street' }, 1920), 'no limit before 1935');
    assert.equal(edgeSpeed({ cls: 'B', maxspeed: 60 }, 1950), edgeSpeed({ cls: 'B' }, 1950), 'a 60 limit is not a limit before 1965');
    assert.ok(edgeSpeed({ cls: 'A', maxspeed: 30 }, 2000) < edgeSpeed({ cls: 'A' }, 2000));
});

test('a roundabout lets one vehicle through at a time', () => {
    const g = createGraph();
    const c = g.addNode(0, 0);
    const arms = [[100, 0], [0, 100], [-100, 0]].map(([x, y]) => { const n = g.addNode(x, y); return g.addEdge(n, c, [x, y, 0, 0], { cls: 'A' }); });
    c.junction = 'roundabout'; c.roundaboutFrom = 1960;
    for (const n of g.nodes) if (n !== c) n.junction = 'end';
    g.index = createSegmentIndex(g);
    const tr = createTraffic(g, { seed: 5, cap: 0 });
    let through = 0;
    for (let step = 0; step < 8000; step++) {
        if (step % 80 === 0) tr.spawnOn(arms[(step / 80) % 3], true, 5, 1990, 'car2k');
        const before = new Map(tr.agents.map(a => [a.id, a.edge]));
        tr.step(1 / 60, { year: 1990, player: null });
        for (const a of tr.agents) if (before.has(a.id) && before.get(a.id) !== a.edge) through++;
        tr.agents = tr.agents.filter(a => a.forward || a.along < 100);
        for (let i = 0; i < tr.agents.length; i++) for (let j = i + 1; j < tr.agents.length; j++) {
            const a = tr.agents[i], b = tr.agents[j];
            assert.equal(sat(obb(a.x, a.y, a.spec.len, a.spec.width, a.heading), obb(b.x, b.y, b.spec.len, b.spec.width, b.heading)), null, `step ${step}`);
        }
    }
    assert.ok(through > 10, `${through} crossings`);
});

test('dual carriageways: opposite directions use opposite sides of the central reservation', () => {
    const g = createGraph();
    const a = g.addNode(0, 0), b = g.addNode(300, 0);
    const e = g.addEdge(a, b, [0, 0, 300, 0], { cls: 'dual' });
    const fwd = lanePoint(e, 100, true, laneOffset(e, 2000), {}), back = lanePoint(e, 200, false, laneOffset(e, 2000), {});
    assert.ok(fwd.y * back.y < 0, `opposite sides (${fwd.y}, ${back.y})`);
    assert.ok(Math.abs(fwd.y) > 2 && Math.abs(back.y) > 2, 'clear of the centreline (the reservation)');
});

test('town centres are in the main one-way-aware network and the main routes exist', () => {
    const world = createWorld(seedWithBaked());
    const core = coreNodes(world.graph);
    for (const t of world.region.towns) assert.ok(core[t.centreNode], `${t.id} centre is in a one-way pocket`);
    const T = id => world.region.townById.get(id);
    for (const [x, y] of [['exeter', 'plymouth'], ['plymouth', 'exeter'], ['truro', 'penzance'], ['barnstaple', 'exeter']]) assert.ok(findRoute(world.graph, T(x), T(y), { year: 2020 }), `${x} -> ${y}`);
});

test('soak: seeded traffic around Exeter and Plymouth stays off closed and wrong-way edges, off roundabout islands and the wrong way round rings, and rarely overlaps on one level', () => {
    const world = createWorld(seedWithBaked());
    for (const town of ['exeter', 'plymouth']) for (const year of [1919, 1965, 2020]) {
        const r = soak(world, { town, year, steps: 2500 });
        const at = `${town} ${year}`;
        assert.equal(r.closed, 0, at);
        assert.equal(r.wrongWay, 0, at);
        assert.equal(r.inIsland, 0, `${at}: vehicles inside a roundabout island`);
        assert.equal(r.offRing, 0, `${at}: vehicles off a roundabout ring`);
        assert.equal(r.ringWrong, 0, `${at}: vehicles going anticlockwise round a ring`);
        // (known: Plymouth's signalled junction 12637 and its neighbour 12638 are 16 m apart; queues on their arms touch, a few percent of samples)
        assert.ok(r.overlaps <= r.samples * (town === 'plymouth' ? 0.06 : 0.015), `${at}: ${r.overlaps} overlapping samples of ${r.samples}`);
        assert.ok(r.maxAgents >= 4, `${at}: ${r.maxAgents} agents`);
        assert.ok(r.junctionSamples > 0, `${at}: vehicles drove through junction layouts`);
    }
});
