import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSegmentIndex } from '../../Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js';
import { polyLength } from '../../Games.Client/wwwroot/games/delivery-driver/world/geom.js';
import {
    findCrossings, structureZones, levelAt, zoneAt, spansOf, halfWidthOf, STRIP_MARGIN,
} from '../../Games.Client/wwwroot/games/delivery-driver/world/crossings.js';

/** A fixture graph: edges [{cls, pts:[x,y,...], spans?:[{from,to,level}]}] (nodes are not needed for crossings). */
function graphOf(list) {
    const edges = list.map((e, id) => {
        const pts = Float64Array.from(e.pts);
        return { id, a: 2 * id, b: 2 * id + 1, cls: e.cls, pts, len: polyLength(pts), spans: e.spans ?? [], upgrades: [], ...(e.extra ?? {}) };
    });
    const g = { edges, nodes: [] };
    g.index = createSegmentIndex(g);
    return g;
}

test('an overpass of a street: one crossing, the bridge above, the deck zone covers the street and its pavements', () => {
    const g = graphOf([
        { cls: 'A', pts: [-200, 0, 200, 0], spans: [{ from: 190, to: 210, level: 1 }] },
        { cls: 'street', pts: [0, -100, 0, 100] },
    ]);
    const cr = findCrossings(g);
    assert.equal(cr.length, 1);
    const c = cr[0];
    assert.equal(c.upper.edge, 0);
    assert.equal(c.lower.edge, 1);
    assert.deepEqual(c.levels, [1, 0]);
    assert.ok(Math.abs(c.x) < 1e-9 && Math.abs(c.y) < 1e-9);
    assert.ok(Math.abs(c.upper.d - 200) < 1e-9 && Math.abs(c.lower.d - 100) < 1e-9);
    assert.ok(Math.abs(c.sin - 1) < 1e-9);
    // square crossing: the deck must reach over the street's half width plus the margin
    assert.ok(Math.abs(c.upper.half - (halfWidthOf(g.edges[1]) + STRIP_MARGIN)) < 1e-9);
    const zones = structureZones(g, cr);
    const z = zones.get(0);
    assert.equal(z.length, 1, 'the span and the crossing stretch merge into one deck');
    assert.equal(z[0].kind, 'deck');
    assert.ok(z[0].from <= 190 && z[0].to >= 210);
    assert.ok(z[0].from <= 200 - c.upper.half && z[0].to >= 200 + c.upper.half);
    assert.equal(zones.get(1), undefined, 'the street below stays on the ground');
    assert.equal(zoneAt(z, 200).kind, 'deck');
    assert.equal(zoneAt(z, 100), null);
});

test('a motorway over a lane at a skew: the claimed stretches grow with the skew and the wider road', () => {
    const s = Math.sin(Math.PI / 4);
    const g = graphOf([
        { cls: 'lane', pts: [-100, 0, 100, 0] },
        { cls: 'M', pts: [-100, -100, 100, 100], spans: [{ from: 130, to: 155, level: 1 }] },
    ]);
    const [c] = findCrossings(g);
    assert.equal(c.upper.edge, 1, 'the motorway is the upper road');
    assert.ok(Math.abs(c.sin - s) < 1e-9);
    const hM = halfWidthOf(g.edges[1]), hL = halfWidthOf(g.edges[0]);
    assert.ok(Math.abs(c.upper.half - ((hL + STRIP_MARGIN) / s + (hM * s) / s)) < 1e-9);
    assert.ok(Math.abs(c.lower.half - ((hM + STRIP_MARGIN) / s + (hL * s) / s)) < 1e-9);
    // the motorway's deck zone reaches beyond its short OSM span to cover the whole lane strip
    const z = structureZones(g, [c]).get(1)[0];
    assert.ok(z.from <= c.upper.d - c.upper.half + 1e-9 && z.to >= c.upper.d + c.upper.half - 1e-9);
});

test('bridges over water and over a valley: no crossing record, a deck zone from the span alone', () => {
    const g = graphOf([
        { cls: 'B', pts: [0, 0, 300, 0], spans: [{ from: 120, to: 180, level: 1 }] },
        { cls: 'A', pts: [0, 500, 900, 500], spans: [{ from: 200, to: 700, level: 1 }] },
    ]);
    assert.equal(findCrossings(g).length, 0);
    const zones = structureZones(g, []);
    assert.deepEqual(zones.get(0), [{ from: 120, to: 180, kind: 'deck' }]);
    assert.deepEqual(zones.get(1), [{ from: 200, to: 700, kind: 'deck' }]);
    assert.equal(levelAt(g.edges[1], 450), 1);
    assert.equal(levelAt(g.edges[1], 100), 0);
    assert.equal(levelAt(g.edges[1], 197), 1, 'the abutment margin counts as on the span');
});

test('a tunnel under a hill with a road over it: the tunnel is the lower road and gets a tunnel zone', () => {
    const g = graphOf([
        { cls: 'A', pts: [-300, 0, 300, 0], spans: [{ from: 200, to: 400, level: -1 }] },
        { cls: 'lane', pts: [0, -200, 0, 200] },
    ]);
    const cr = findCrossings(g);
    assert.equal(cr.length, 1);
    assert.equal(cr[0].upper.edge, 1);
    assert.equal(cr[0].lower.edge, 0);
    assert.deepEqual(cr[0].levels, [0, -1]);
    const zones = structureZones(g, cr);
    assert.equal(zones.get(1), undefined, 'the lane over the tunnel stays on the ground');
    assert.deepEqual(zones.get(0).map(z => z.kind), ['tunnel']);
    assert.ok(zones.get(0)[0].from <= 200 && zones.get(0)[0].to >= 400);
});

test('same-level crossings, ferries and stacked levels', () => {
    const g = graphOf([
        { cls: 'B', pts: [-100, 0, 100, 0] },
        { cls: 'lane', pts: [0, -100, 0, 100] }, // same level: not a grade separation
        { cls: 'ferry', pts: [-50, -50, 50, 50], spans: [{ from: 0, to: 141, level: 1 }] },
        { cls: 'A', pts: [-100, 10, 100, 10], spans: [{ from: 80, to: 120, level: 2 }] },
        { cls: 'dual', pts: [20, -100, 20, 100], spans: [{ from: 95, to: 125, level: 1 }] },
    ]);
    const cr = findCrossings(g);
    const pairs = cr.map(c => [c.upper.edge, c.lower.edge, ...c.levels]);
    // the A road at level 2 crosses the dual at level 1 (stacked) and the lane at 0; the dual crosses the B road
    assert.deepEqual(pairs, [[3, 1, 2, 0], [3, 4, 2, 1], [4, 0, 1, 0]]);
    assert.equal(spansOf(g.edges[2]).length, 0, 'ferries have no structures');
    // deterministic
    assert.deepEqual(findCrossings(g), cr);
});

test('fixture edges flagged whole (no spans array) take their level from the flags', () => {
    assert.equal(levelAt({ cls: 'A', bridge: true, len: 10 }, 5), 1);
    assert.equal(levelAt({ cls: 'A', tunnel: true, len: 10 }, 5), -1);
    assert.equal(levelAt({ cls: 'A', level: 3, len: 10 }, 5), 3);
    assert.deepEqual(spansOf({ cls: 'A', bridge: true, len: 10 }), [{ from: 0, to: 10, level: 1 }]);
});
