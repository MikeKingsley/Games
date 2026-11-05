import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraph, createSegmentIndex } from '../../Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js';
import { createTraffic, otherLayer } from '../../Games.Client/wwwroot/games/delivery-driver/traffic/traffic.js';
import { connectorLayout, connectorBetween, connectorPoint, connectorsConflict, turnSeconds } from '../../Games.Client/wwwroot/games/delivery-driver/world/connectors.js';
import { findRoute } from '../../Games.Client/wwwroot/games/delivery-driver/world/pathfind.js';
import { obb, sat } from '../../Games.Client/wwwroot/games/delivery-driver/sim/collision.js';

const YEAR = 1990;

/** Four street arms of 120 m meeting at a give-way crossroads at the origin. */
function crossroads() {
    const g = createGraph();
    const c = g.addNode(0, 0);
    const arms = [[120, 0], [0, 120], [-120, 0], [0, -120]].map(([x, y]) => { const n = g.addNode(x, y); return g.addEdge(n, c, [x, y, 0, 0], { cls: 'street' }); });
    c.junction = 'giveway';
    for (const n of g.nodes) if (n !== c) n.junction = 'end';
    g.index = createSegmentIndex(g);
    return { g, c, arms };
}

/** Three A-road arms of 100 m meeting at a roundabout (open from 1960). */
function roundabout() {
    const g = createGraph();
    const c = g.addNode(0, 0);
    const arms = [[100, 0], [0, 100], [-100, 0]].map(([x, y]) => { const n = g.addNode(x, y); return g.addEdge(n, c, [x, y, 0, 0], { cls: 'A' }); });
    c.junction = 'roundabout'; c.roundaboutFrom = 1960;
    for (const n of g.nodes) if (n !== c) n.junction = 'end';
    g.index = createSegmentIndex(g);
    return { g, c, arms };
}

/** Distance from a point to a connector's lane path. */
function distToPath(c, x, y) {
    let best = Infinity;
    const p = { x: 0, y: 0, angle: 0 };
    for (let s = 0; s <= c.len; s += 0.25) { connectorPoint(c, s, p); best = Math.min(best, Math.hypot(p.x - x, p.y - y)); }
    return best;
}

test('vehicles follow the layout connector through a junction, turn slowly and stay on the path', () => {
    const { g, arms } = crossroads();
    const tr = createTraffic(g, { seed: 4, cap: 0 });
    const seen = new Set();
    let onPath = 0, worst = 0;
    for (let step = 0; step < 9000; step++) {
        if (step % 150 === 0) tr.spawnOn(arms[(step / 150) % 4], true, 5, YEAR, 'car2k');
        tr.step(1 / 60, { year: YEAR, player: null });
        for (const a of tr.agents) {
            if (!a.conn) continue;
            const c = a.conn.c;
            seen.add(c.kind);
            const d = distToPath(c, a.x, a.y);
            worst = Math.max(worst, d);
            onPath++;
            // turning paths are taken at their cornering speed (the vehicle may still be slowing into it)
            if (c.kind !== 'straight') assert.ok(a.speed <= Math.max(c.vturn, 6) + 1.5, `${c.kind} taken at ${a.speed.toFixed(1)} m/s (limit ${c.vturn.toFixed(1)})`);
        }
    }
    assert.ok(onPath > 300, `${onPath} samples on a path`);
    assert.ok(seen.has('straight') && (seen.has('left') || seen.has('right')), `kinds seen: ${[...seen]}`);
    assert.ok(worst < 2.5, `within ${worst.toFixed(2)} m of the lane path`);
});

test('a roundabout is driven clockwise, never across the island, and vehicles on separate parts of the ring go together', () => {
    const { g, c, arms } = roundabout();
    const layout = connectorLayout(g, c.id, YEAR);
    assert.equal(layout.kind, 'roundabout');
    const tr = createTraffic(g, { seed: 5, cap: 0 });
    const lastAngle = new Map();
    let maxTogether = 0, ringSamples = 0;
    for (let step = 0; step < 9000; step++) {
        if (step % 200 === 0) tr.spawnOn(arms[(step / 200) % 3], true, 5, YEAR, 'car2k');
        tr.step(1 / 60, { year: YEAR, player: null });
        const inside = tr.agents.filter(a => a.conn);
        maxTogether = Math.max(maxTogether, inside.length);
        // no two vehicles on conflicting paths are ever in the junction together
        for (let i = 0; i < inside.length; i++) for (let j = i + 1; j < inside.length; j++) {
            const a = inside[i], b = inside[j];
            assert.equal(sat(obb(a.x, a.y, a.spec.len, a.spec.width, a.heading), obb(b.x, b.y, b.spec.len, b.spec.width, b.heading)), null, `step ${step}`);
        }
        for (const a of inside) {
            const r = Math.hypot(a.x - c.x, a.y - c.y), ang = Math.atan2(a.y - c.y, a.x - c.x);
            ringSamples++;
            assert.ok(r > layout.ring.ri, `inside the island (${r.toFixed(1)} m, island ${layout.ring.ri.toFixed(1)})`);
            const prev = lastAngle.get(a.id);
            if (prev !== undefined && a.speed > 0.5 && r < layout.ring.ro + 0.5) {
                const d = Math.atan2(Math.sin(ang - prev), Math.cos(ang - prev));
                assert.ok(d > -0.03, `anticlockwise by ${d.toFixed(3)} rad`); // y points south: clockwise on screen is an increasing angle
            }
            lastAngle.set(a.id, ang);
        }
    }
    assert.ok(ringSamples > 300, `${ringSamples} samples on the ring`);
    assert.ok(maxTogether >= 2, `${maxTogether} vehicles on the ring at once`);
});

test('a vehicle waiting to enter a roundabout gives way to circulating traffic on a conflicting path', () => {
    const { g, c, arms } = roundabout();
    const layout = connectorLayout(g, c.id, YEAR);
    const into = (k, j) => connectorBetween(layout, arms[k], 'b', arms[j], 'b');
    // paths that merge or cross conflict; those leaving the same arm (queueing) or on separate parts of the ring do not
    assert.equal(connectorsConflict(into(1, 0), into(2, 1)), true, 'a vehicle crossing the entry of arm 2 conflicts with one entering from it');
    assert.equal(connectorsConflict(into(0, 2), into(1, 2)), true, 'two entries into the same exit merge');
    assert.equal(connectorsConflict(into(0, 1), into(0, 2)), false, 'the same entry: one follows the other');
    assert.equal(connectorsConflict(into(1, 2), into(2, 1)), false, 'short hops on opposite parts of the ring');

    // a circulating vehicle (a stationary obstacle in the junction here) holds the way for the one entering
    const tr = createTraffic(g, { seed: 1, cap: 0 });
    const circ = tr.spawnOn(arms[1], true, 70, YEAR, 'car2k');
    const waiting = tr.spawnOn(arms[2], true, 40, YEAR, 'car2k');
    circ.next = { edge: arms[0].id, forward: false, turn: 0, conn: into(1, 0) };
    waiting.next = { edge: arms[1].id, forward: false, turn: 0, conn: into(2, 1) };
    circ.stunned = 1e9; // it sits where it claimed (on its approach), as a vehicle slowing for the ring would
    let entered = false;
    for (let step = 0; step < 1500 && !entered; step++) {
        tr.step(1 / 60, { year: YEAR, player: null });
        entered = !!waiting.conn;
    }
    assert.ok(!entered, 'the vehicle did not enter while a conflicting path was claimed');
    assert.ok(waiting.speed < 0.5, 'it waits at the line');
});

test('vehicles on a flyover and on the road beneath never block, yield to or hit each other', () => {
    // a low road east-west and a deck north-south crossing it with no node: B is stopped on the crossing
    const build = (deckHeight) => {
        const g = createGraph();
        const w = g.addNode(-150, 0), e = g.addNode(150, 0), s = g.addNode(0, 150), n = g.addNode(0, -150);
        const low = g.addEdge(w, e, [-150, 0, 150, 0], { cls: 'A' });
        const deck = g.addEdge(s, n, [0, 150, 0, -150], { cls: 'A' });
        for (const nd of g.nodes) nd.junction = 'end';
        low.z = new Float32Array([0, 0]); low.zStep = low.len;
        deck.z = new Float32Array([deckHeight, deckHeight]); deck.zStep = deck.len;
        g.index = createSegmentIndex(g);
        return { g, low, deck };
    };
    const drive = (deckHeight) => {
        const { g, low, deck } = build(deckHeight);
        const tr = createTraffic(g, { seed: 2, cap: 0 });
        const a = tr.spawnOn(low, true, 60, YEAR, 'car2k', true);
        const b = tr.spawnOn(deck, true, 150, YEAR, 'car2k');
        b.stunned = 1e9; // broken down on the crossing
        let minSpeed = Infinity, passed = false, planOverlap = false;
        for (let step = 0; step < 1500 && !passed; step++) {
            tr.step(1 / 60, { year: YEAR, player: null });
            if (a.along > 40 && a.edge === low.id) minSpeed = Math.min(minSpeed, a.speed);
            if (sat(obb(a.x, a.y, a.spec.len, a.spec.width, a.heading), obb(b.x, b.y, b.spec.len, b.spec.width, b.heading))) planOverlap = true;
            passed = a.along > 215 || a.edge !== low.id;
        }
        return { passed, minSpeed, planOverlap, a, b };
    };
    const over = drive(8);
    assert.ok(over.passed, 'the car under the deck drove through');
    assert.ok(over.minSpeed > 4, `it never slowed for the stopped car above (${over.minSpeed.toFixed(1)} m/s)`);
    assert.ok(over.planOverlap, 'they did overlap in plan (a real flyover test)');
    assert.equal(otherLayer(over.a, over.b, 0), true);
    const flat = drive(0);
    assert.ok(!flat.passed || flat.minSpeed < 1, 'at the same level the stopped car is in the way');
});

test('the router will not turn through a junction that has no legal path and pays for tight turns', () => {
    const { g, arms } = crossroads();
    const layout = connectorLayout(g, 0, YEAR);
    const right = connectorBetween(layout, arms[0], 'b', arms[1], 'b'), straight = connectorBetween(layout, arms[0], 'b', arms[2], 'b');
    assert.ok(right && straight);
    assert.equal(turnSeconds(straight, 12), 0, 'straight on costs nothing');
    assert.ok(turnSeconds(right, 12) > 0.2, `a corner costs time (${turnSeconds(right, 12).toFixed(2)} s)`);
    const route = findRoute(g, { x: 100, y: 0 }, { x: 0, y: 100 }, { year: YEAR, vmax: 12, maxSnap: 5 });
    assert.ok(route && route.steps.length >= 1);
    const straightRoute = findRoute(g, { x: 100, y: 0 }, { x: -100, y: 0 }, { year: YEAR, vmax: 12, maxSnap: 5 });
    const perMetre = r => r.time / r.length;
    assert.ok(perMetre(route) * route.length > perMetre(straightRoute) * route.length + 0.2, `the corner costs time (${perMetre(route).toFixed(4)} s/m against ${perMetre(straightRoute).toFixed(4)} straight)`);
    assert.equal(route.hill, 1, 'the corner is not counted as a hill');
});
