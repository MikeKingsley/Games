import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const game = p => import(pathToFileURL(resolve(`Games.Client/wwwroot/games/delivery-driver/${p}`)).href);
const { createGraph, createSegmentIndex } = await game('world/roadgraph.js');
const { validateGraph, validateFurniture, validateYards } = await import(pathToFileURL(resolve('scripts/validate-roads.mjs')).href);

/** Builds a graph from [[x1, y1, x2, y2, cls?], ...] straight edges, each with its own end nodes. */
function fixture(lines) {
    const g = createGraph();
    for (const [x1, y1, x2, y2, cls = 'street'] of lines) {
        const a = g.addNode(x1, y1), b = g.addNode(x2, y2);
        g.addEdge(a, b, [x1, y1, x2, y2], { cls });
    }
    g.index = createSegmentIndex(g);
    return { graph: g };
}

test('validator reports edges that cross without a node', () => {
    const crossing = validateGraph(fixture([[-50, 0, 50, 0], [0, -50, 0, 50]]));
    assert.equal(crossing.issues.filter(i => i.check === 'crossing-no-node').length, 1);
});

test('validator accepts a bridge crossing and a proper junction', () => {
    const g = createGraph();
    const a = g.addNode(-50, 0), b = g.addNode(50, 0), c = g.addNode(0, -50), d = g.addNode(0, 50);
    g.addEdge(a, b, [-50, 0, 50, 0], { cls: 'A' });
    g.addEdge(c, d, [0, -50, 0, 50], { cls: 'B', bridge: true });
    g.index = createSegmentIndex(g);
    assert.equal(validateGraph({ graph: g }).issues.filter(i => i.check === 'crossing-no-node').length, 0);
});

test('validator flags short edges and dead ends', () => {
    const { issues } = validateGraph(fixture([[0, 0, 1.5, 0]]));
    assert.ok(issues.some(i => i.check === 'short-edge'));
    assert.ok(issues.some(i => i.check === 'dead-end'));
});

test('validator detects a lamp planted on the road but not one on the verge', () => {
    const world = fixture([[-100, 0, 100, 0, 'street']]);
    const on = validateFurniture(world, [{ kind: 'lamp', x: 10, y: 1 }]);
    assert.equal(on.issues.filter(i => i.check === 'furniture-on-road').length, 1);
    const verge = validateFurniture(world, [{ kind: 'lamp', x: 10, y: 5 }]);
    assert.equal(verge.issues.length, 0);
});

test('validator detects a prop inside a building', () => {
    const world = fixture([[-100, 0, 100, 0, 'street']]);
    const box = { x: 0, y: 20, hx: 6, hy: 5, angle: 0 };
    const r = validateFurniture(world, [{ kind: 'sign', x: 1, y: 21 }], { buildings: [{ box }] });
    assert.equal(r.issues.filter(i => i.check === 'furniture-in-building').length, 1);
});

test('yard check flags a disconnected yard, a yard on a road and two overlapping yards, and accepts a clean one', async () => {
    const { obb } = await game('sim/collision.js');
    const g = createGraph();
    const a = g.addNode(-100, 0), b = g.addNode(100, 0), c = g.addNode(500, 500), d = g.addNode(600, 500);
    g.addEdge(a, b, [-100, 0, 100, 0], { cls: 'street' });
    g.addEdge(c, d, [500, 500, 600, 500], { cls: 'street' }); // a separate island
    const entry = g.addNode(0, 5);
    g.addEdge(g.nodes[a.id], entry, [-100, 0, 0, 5], { cls: 'access' });
    g.addEdge(entry, b, [0, 5, 100, 0], { cls: 'access' });
    g.index = createSegmentIndex(g);
    const yard = (id, node, x, y) => ({ id, name: id, type: 'depot', node, x, y, yard: { zone: obb(x, y, 28, 34, 0) } });
    const clean = yard('clean', entry.id, 40, 40);
    const island = yard('island', c.id, 550, 550);
    const onRoad = yard('onroad', entry.id, 0, 4); // lies across the street
    const twin = yard('twin', entry.id, 45, 40);   // overlaps `clean`
    const res = validateYards({ graph: g, yards: [clean, island, onRoad, twin] }, { years: [2024] });
    const checks = res.issues.map(i => `${i.check}:${i.detail.split(' ')[0]}`);
    assert.ok(checks.includes('yard-disconnected:island'), checks.join());
    assert.ok(checks.includes('yard-on-road:onroad'), checks.join());
    assert.ok(checks.some(c => c.startsWith('yard-overlap')), checks.join());
    assert.ok(!res.issues.some(i => i.detail.startsWith('clean (') && i.check !== 'yard-overlap'));
    assert.equal(validateYards({ graph: g, yards: [clean] }, { years: [2024] }).issues.length, 0);
});

// ---- plan 0009 layer checks --------------------------------------------------------------------------------------

/** Graph from [{pts: [x, y, ...], cls?, ...props}] edges, each with its own end nodes unless `nodes` shares them. */
function graphOf(specs, nodeAt = new Map()) {
    const g = createGraph();
    const node = (x, y, props) => {
        const k = `${x},${y}`;
        if (!nodeAt.has(k)) nodeAt.set(k, g.addNode(x, y, props));
        return nodeAt.get(k);
    };
    for (const { pts, cls = 'street', nodeProps, ...props } of specs) {
        const a = node(pts[0], pts[1], nodeProps?.a), b = node(pts[pts.length - 2], pts[pts.length - 1], nodeProps?.b);
        g.addEdge(a, b, pts, { cls, ...props });
    }
    g.index = createSegmentIndex(g);
    return { graph: g };
}
const count = (r, check) => r.issues.filter(i => i.check === check).length;

test('overlap-same-layer: two parallel streets 8 m apart overlap, 14 m apart do not, a bridge level separates them', () => {
    const near = validateGraph(graphOf([{ pts: [-100, 0, 100, 0] }, { pts: [-100, 8, 100, 8] }]));
    assert.equal(count(near, 'overlap-same-layer'), 1);
    assert.equal(near.issues.find(i => i.check === 'overlap-same-layer').hard, true);
    assert.equal(count(validateGraph(graphOf([{ pts: [-100, 0, 100, 0] }, { pts: [-100, 14, 100, 14] }])), 'overlap-same-layer'), 0);
    assert.equal(count(validateGraph(graphOf([{ pts: [-100, 0, 100, 0] }, { pts: [-100, 8, 100, 8], bridge: true }])), 'overlap-same-layer'), 0);
    // a motorway beside a street needs more room: 12 + 3.5 + 4 = 19.5 m
    assert.equal(count(validateGraph(graphOf([{ pts: [-100, 0, 100, 0], cls: 'M' }, { pts: [-100, 17, 100, 17] }])), 'overlap-same-layer'), 1);
});

test('overlap-same-layer ignores roads that meet at a node and reports only spans that overlap at the same level', () => {
    const tee = validateGraph(graphOf([{ pts: [-100, 0, 0, 0] }, { pts: [0, 0, 100, 0] }, { pts: [0, 0, 0, 100] }]));
    assert.equal(count(tee, 'overlap-same-layer'), 0);
    // a bridge span only over the first 50 m: the roads beside each other for the rest do overlap
    const spans = [{ from: 0, to: 50, type: 'bridge' }];
    const part = validateGraph(graphOf([{ pts: [0, 0, 200, 0] }, { pts: [0, 8, 200, 8], spans }]));
    assert.equal(count(part, 'overlap-same-layer'), 1);
    const whole = validateGraph(graphOf([{ pts: [0, 0, 200, 0] }, { pts: [0, 8, 200, 8], spans: [{ from: 0, to: 200, type: 'bridge' }] }]));
    assert.equal(count(whole, 'overlap-same-layer'), 0);
});

test('junction-cluster (soft) flags junctions closer than their footprints and accepts distant ones', () => {
    // two T nodes 8 m apart joined by the shared stretch of the through road
    const t = validateGraph(graphOf([{ pts: [-60, 0, 0, 0] }, { pts: [0, 0, 8, 0] }, { pts: [8, 0, 68, 0] }, { pts: [0, 0, 0, 80] }, { pts: [8, 0, 8, -80] }]));
    assert.equal(count(t, 'junction-cluster'), 1);
    assert.equal(t.issues.find(i => i.check === 'junction-cluster').hard, false);
    const far = validateGraph(graphOf([{ pts: [-60, 0, 0, 0] }, { pts: [0, 0, 60, 0] }, { pts: [0, 0, 0, 80] }, { pts: [60, 0, 120, 0] }, { pts: [60, 0, 60, -80] }]));
    assert.equal(count(far, 'junction-cluster'), 0);
});

test('roundabout-arm-gap: arms shorter than the ring, or ending off the centre, are hard failures', () => {
    const ring = len => [
        { pts: [0, 0, len, 0], nodeProps: { a: { junction: 'roundabout' } } },
        { pts: [0, 0, -len, 0] }, { pts: [0, 0, 0, len] },
    ];
    // outer ring radius = 7.2 + 2 * 3.5 = 14.2 m
    const short = validateGraph(graphOf(ring(10)));
    assert.equal(count(short, 'roundabout-arm-gap'), 3);
    assert.equal(short.issues.find(i => i.check === 'roundabout-arm-gap').hard, true);
    assert.equal(count(validateGraph(graphOf(ring(60))), 'roundabout-arm-gap'), 0);
    // an arm whose polyline stops 5 m short of the centre misses the ring entirely
    const miss = graphOf(ring(60));
    const e = miss.graph.edges[0];
    e.pts = [5, 0, 60, 0];
    const r = validateGraph(miss);
    assert.equal(count(r, 'roundabout-arm-gap'), 1);
    // a bridge arm passing over is not an arm; a mini-roundabout has no ring to reach
    const over = ring(10);
    over[0].bridge = true;
    assert.equal(count(validateGraph(graphOf(over)), 'roundabout-arm-gap'), 2);
    const mini = ring(10);
    mini[0].nodeProps = { a: { junction: 'roundabout', mini: true } };
    assert.equal(count(validateGraph(graphOf(mini)), 'roundabout-arm-gap'), 0);
});

test('bridge-clearance: a deck less than 5.5 m over the road below is a hard failure (soft on request)', () => {
    const cross = (deckZ, withZ = true) => {
        const w = graphOf([{ pts: [-100, 0, 100, 0], cls: 'A' }, { pts: [0, -100, 0, 100], cls: 'B', bridge: true }]);
        if (withZ) {
            const [low, up] = w.graph.edges;
            Object.assign(low, { z: [0, 0, 0, 0, 0], zStep: 50 });
            Object.assign(up, { z: Array(5).fill(deckZ), zStep: 50 });
        }
        return w;
    };
    const low = validateGraph(cross(4));
    assert.equal(count(low, 'bridge-clearance'), 1);
    assert.equal(low.issues.find(i => i.check === 'bridge-clearance').hard, true);
    assert.equal(validateGraph(cross(4), { hardClearance: false }).issues.find(i => i.check === 'bridge-clearance').hard, false);
    // a crossing the grading took at road level is the soft crossing-at-grade, not a clearance failure
    const atGrade = cross(4);
    atGrade.graph.crossings = [{ upper: { edge: 1 }, lower: { edge: 0 }, x: 0, y: 0, atGrade: true }];
    const ag = validateGraph(atGrade);
    assert.equal(count(ag, 'bridge-clearance'), 0);
    assert.equal(count(ag, 'crossing-at-grade'), 1);
    assert.equal(ag.issues.find(i => i.check === 'crossing-at-grade').hard, false);
    assert.equal(ag.counts.crossingsAtGrade, 1);
    assert.equal(count(validateGraph(cross(7)), 'bridge-clearance'), 0); // 7 - 0.6 slab = 6.4 m >= 5.5
    const unmeasured = validateGraph(cross(0, false));
    assert.equal(count(unmeasured, 'bridge-clearance'), 0);
    assert.equal(unmeasured.counts.gradeSeparatedCrossings, 1);
    assert.equal(unmeasured.counts.clearanceMeasured, 0);
    assert.equal(low.counts.clearanceMeasured, 1);
});

// ---- plan 0009 phase 4: ramps, junction patches, decks, bridge-end arms ----------------------------------------------

test('overlap-same-layer: a stretch within 30 m of a bridge is on its approach ramp, further along it overlaps again', () => {
    const spans = [{ from: 0, to: 50, type: 'bridge' }];
    // beside the bridge span (and its ramp, to 80 m) is not an overlap; 100 m further along it is
    const long = validateGraph(graphOf([{ pts: [0, 0, 400, 0] }, { pts: [0, 8, 400, 8], spans }]));
    assert.equal(count(long, 'overlap-same-layer'), 1);
    const short = validateGraph(graphOf([{ pts: [0, 0, 70, 0] }, { pts: [0, 8, 70, 8], spans }]));
    assert.equal(count(short, 'overlap-same-layer'), 0);
});

test('overlap-same-layer: the junction patch of a node beside the overlap covers it, a long parallel run starting there does not', () => {
    // a street ending 4 m beside a B road's T-junction (not at its node): inside the junction's patch
    const t = graphOf([{ pts: [-100, 0, 0, 0], cls: 'B' }, { pts: [0, 0, 100, 0], cls: 'B' }, { pts: [0, 0, 0, 100], cls: 'B' }, { pts: [3, 3, 40, 40] }]);
    assert.equal(count(validateGraph(t), 'overlap-same-layer'), 0);
    // the same street running 6 m beside the B road for 150 m is a real overlap
    const run = graphOf([{ pts: [-100, 0, 0, 0], cls: 'B' }, { pts: [0, 0, 160, 0], cls: 'B' }, { pts: [0, 0, 0, 100], cls: 'B' }, { pts: [6, 6, 160, 6] }]);
    assert.ok(count(validateGraph(run), 'overlap-same-layer') >= 1);
});

test('overlap-same-layer is judged the same whichever road is scanned first', () => {
    const lines = [{ pts: [-60, 0, 60, 0], cls: 'B' }, { pts: [60, 0, 160, 0], cls: 'B' }, { pts: [-60, 0, -60, 90], cls: 'B' }, { pts: [0, 7, 120, 7] }];
    const a = validateGraph(graphOf(lines)), b = validateGraph(graphOf([...lines].reverse()));
    assert.equal(count(a, 'overlap-same-layer'), count(b, 'overlap-same-layer'));
});

test('deck-overlap: parallel decks on a structure are soft, the same overlap on the ground is hard', () => {
    const decks = validateGraph(graphOf([{ pts: [0, 0, 300, 0], spans: [{ from: 0, to: 300, type: 'bridge', level: 1 }] }, { pts: [0, 8, 300, 8], spans: [{ from: 0, to: 300, type: 'bridge', level: 1 }] }]));
    assert.equal(count(decks, 'overlap-same-layer'), 0);
    assert.equal(count(decks, 'deck-overlap'), 1);
    assert.equal(decks.issues.find(i => i.check === 'deck-overlap').hard, false);
});

test('roundabout-arm-bridge: an arm whose far end starts a bridge is soft, a plain short arm stays hard', () => {
    const ring = bridgeAtFar => [
        { pts: [0, 0, 10, 0], nodeProps: { a: { junction: 'roundabout' } } },
        { pts: [0, 0, -60, 0] }, { pts: [0, 0, 0, 60] },
        ...(bridgeAtFar ? [{ pts: [10, 0, 80, 0], bridge: true }] : [{ pts: [10, 0, 80, 0] }]),
    ];
    const withBridge = validateGraph(graphOf(ring(true)));
    assert.equal(count(withBridge, 'roundabout-arm-gap'), 0);
    assert.equal(count(withBridge, 'roundabout-arm-bridge'), 1);
    assert.equal(withBridge.issues.find(i => i.check === 'roundabout-arm-bridge').hard, false);
    assert.equal(count(validateGraph(graphOf(ring(false))), 'roundabout-arm-gap'), 1);
});
