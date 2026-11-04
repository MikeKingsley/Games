import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const game = p => import(pathToFileURL(resolve(`Games.Client/wwwroot/games/delivery-driver/${p}`)).href);
const { createGraph, createSegmentIndex } = await game('world/roadgraph.js');
const { validateGraph, validateFurniture } = await import(pathToFileURL(resolve('scripts/validate-roads.mjs')).href);

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
