// The road segment index (packed entries) and the "runs beside another road" check used when placing yards (plan 0009).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraph, createSegmentIndex, runsBesideRoad } from '../../Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js';

function line(g, ax, ay, bx, by, props = {}) {
    const a = g.addNode(ax, ay), b = g.addNode(bx, by);
    return g.addEdge(a, b, [ax, ay, bx, by], props);
}

test('the segment index returns edge and segment numbers for nearby segments and follows a split', () => {
    const g = createGraph();
    const e = line(g, 0, 0, 200, 0);
    const far = line(g, 0, 500, 200, 500);
    g.index = createSegmentIndex(g);
    const near = g.index.near(100, 5, 20);
    assert.ok(near.length > 0 && near.every(s => s.edge === e.id && s.seg === 0));
    assert.ok(!g.index.near(100, 5, 20).some(s => s.edge === far.id));
    g.splitEdge(e, 100);
    const after = g.index.near(150, 0, 5);
    assert.ok(after.length > 0 && after.every(s => s.edge !== e.id), 'the far half is the new edge');
    assert.ok(g.index.near(50, 0, 5).every(s => s.edge === e.id));
    assert.deepEqual([...g.index.edgesIn(-10, -10, 210, 10)].sort(), [e.id, g.edges.length - 1 === far.id ? e.id : g.edges[g.edges.length - 1].id].sort());
});

test('runsBesideRoad: parallel roads 8 m apart are flagged, 30 m apart or sharing a node nearby are not', () => {
    const g = createGraph();
    const e = line(g, 0, 0, 100, 0, { cls: 'street' });
    line(g, 0, 8, 100, 8, { cls: 'street' });
    line(g, 0, 300, 100, 300, { cls: 'street' });
    g.index = createSegmentIndex(g);
    assert.equal(runsBesideRoad(g, e), true);
    const h = createGraph();
    const a = line(h, 0, 0, 100, 0, { cls: 'street' });
    const n = h.nodes[a.a];
    const m = h.addNode(0, 60, {});
    h.addEdge(n, m, [0, 0, 0, 60], { cls: 'street' });
    h.index = createSegmentIndex(h);
    assert.equal(runsBesideRoad(h, a), false);
});
