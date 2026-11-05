import test from 'node:test';
import assert from 'node:assert/strict';
import { seedWithBaked } from './helpers/delivery-seed.mjs';
import { createWorld } from '../../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { edgeOpen, edgeWidth } from '../../Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js';
import { isLive, signalPolesOf, maxHalfWidth } from '../../Games.Client/wwwroot/games/delivery-driver/world/furniture.js';
import { closestOnPoly } from '../../Games.Client/wwwroot/games/delivery-driver/world/geom.js';
import { sat, obb } from '../../Games.Client/wwwroot/games/delivery-driver/sim/collision.js';
import { CHUNK_SIZE } from '../../Games.Client/wwwroot/games/delivery-driver/config.js';

const world = createWorld(seedWithBaked());
const { graph, region } = world;
const YEARS = [1919, 1965, 2024];

/** Chunks around the centres of the sampled towns. */
function chunksAround(id, r = 3) {
    const t = region.townById.get(id), ci = Math.floor(t.x / CHUNK_SIZE), cj = Math.floor(t.y / CHUNK_SIZE), out = [];
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) out.push(world.chunks.get(i, j));
    return out;
}
const sample = ['exeter', 'plymouth', 'truro', 'penzance'].flatMap(id => chunksAround(id));
const all = kind => sample.flatMap(c => c[kind]);

test('furniture: no prop stands on a carriageway (plus 0.5 m) in any sampled year', () => {
    for (const year of YEARS) {
        for (const kind of ['lamps', 'signs', 'signals']) {
            for (const p of all(kind)) {
                if (kind !== 'signals' && !isLive(p, year)) continue;
                for (const s of graph.index.near(p.x, p.y, 30)) {
                    const e = graph.edges[s.edge];
                    if (!edgeOpen(e, year) || e.cls === 'ferry') continue;
                    const d = closestOnPoly(e.pts, p.x, p.y).d;
                    assert.ok(d >= edgeWidth(e, year) / 2 + 0.5, `${kind} ${p.x.toFixed(1)},${p.y.toFixed(1)} is ${d.toFixed(2)} m from edge ${e.id} in ${year}`);
                }
            }
        }
    }
});

test('furniture: nothing stands inside a building, a yard or on water', () => {
    const buildings = [...new Set(sample.flatMap(c => c.buildings))];
    for (const p of [...all('lamps'), ...all('signs'), ...all('signals')]) {
        const probe = obb(p.x, p.y, 0.4, 0.4, 0);
        assert.ok(!buildings.some(b => sat(b.box, probe)), `prop at ${p.x.toFixed(1)},${p.y.toFixed(1)} is inside a building`);
    }
});

test('lamps: spacing along an edge keeps to the class gap, and only lit town roads have them', () => {
    const byEdge = new Map();
    for (const l of all('lamps')) if (l.edge !== undefined) (byEdge.get(l.edge) ?? byEdge.set(l.edge, []).get(l.edge)).push(l);
    assert.ok(byEdge.size > 50);
    for (const [id, list] of byEdge) {
        const e = graph.edges[id];
        assert.ok(e.lit || e.town, `edge ${id} (${e.cls}) is not lit`);
        assert.ok(!e.bridge && !e.link && e.cls !== 'lane' && e.cls !== 'M');
        const along = list.map(l => closestOnPoly(e.pts, l.x, l.y).d).length; // all lamps found the edge
        assert.equal(along, list.length);
        // consecutive lamps (by position along the edge) are never closer than half the smallest gap
        const t = list.map(l => { const c = closestOnPoly(e.pts, l.x, l.y); return c.along ?? 0; }).sort((a, b) => a - b);
        for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] > 0) assert.ok(t[i] - t[i - 1] >= 14, `lamps on edge ${id} only ${(t[i] - t[i - 1]).toFixed(1)} m apart`);
    }
});

test('lamps: rural lit roads are lit only from the 1950s, and a lamp stands only while its road is open', () => {
    for (const l of all('lamps')) {
        if (l.edge === undefined) continue;
        const e = graph.edges[l.edge];
        if (!e.town) assert.ok(l.from >= 1950);
        for (const year of YEARS) if (isLive(l, year)) assert.ok(edgeOpen(e, year), `lamp on edge ${l.edge} stands in ${year} but the road is closed`);
    }
});

test('signs: each stands on the left verge of its arm, facing oncoming traffic, beyond the kerb', () => {
    const signs = all('signs');
    assert.ok(signs.length > 20);
    const kinds = new Set(signs.map(s => s.kind));
    assert.ok(kinds.has('giveway'));
    for (const s of signs) {
        const n = graph.nodes[s.node], e = graph.edges[s.edge];
        const dx = s.x - n.x, dy = s.y - n.y;
        assert.ok(dx * Math.cos(s.angle) + dy * Math.sin(s.angle) > 0, 'out along the arm it faces');
        // the left of an approaching vehicle (heading angle + pi) is (sin h, -cos h)
        const h = s.angle + Math.PI;
        assert.ok(dx * Math.sin(h) - dy * Math.cos(h) > maxHalfWidth(e) - 0.5, 'on the left verge, beyond the kerb');
    }
});

test('signals: one pole per arm on the left of the approach, groups follow the arm direction', () => {
    const node = graph.nodes.find(n => n.junction === 'signals' && n.edges.length >= 3);
    const poles = signalPolesOf(world, node);
    assert.ok(poles.length >= 2);
    for (const p of poles) {
        const h = p.face + Math.PI;
        assert.equal(p.group, Math.abs(Math.cos(h)) > 0.707 ? 0 : 1);
        assert.ok((p.x - node.x) * Math.sin(h) - (p.y - node.y) * Math.cos(h) > 0, 'left of the approach');
    }
});

test('buildings: fronts keep clear of the widest carriageway of their street', () => {
    for (const b of [...new Set(sample.flatMap(c => c.buildings))].filter(b => b.edge !== undefined).slice(0, 400)) {
        const e = graph.edges[b.edge];
        const gap = closestOnPoly(e.pts, b.x, b.y).d - b.dep / 2;
        assert.ok(gap >= maxHalfWidth(e) + 1, `building ${b.id} is ${gap.toFixed(1)} m from the carriageway`);
    }
});
