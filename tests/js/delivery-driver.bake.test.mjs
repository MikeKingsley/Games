// Road bake (scripts/bake-roads/bake.mjs) on small hand-built OSM fixtures: dual carriageway collapse, roundabout
// collapse, T-junction snapping, a bridge over a road (no junction), degree-2 merging and one-way tags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const game = p => import(pathToFileURL(resolve(`Games.Client/wwwroot/games/delivery-driver/${p}`)).href);
const { realToLatLon, createProjection, TOWN_RADIUS, TOWN_FOOTPRINT, townFootprint } = await game('world/projection.js');
const { decodeTiles, encodeTile, BAKE_FORMAT } = await game('world/baked-format.js');
const { bake, toTiles, findCrossings } = await import(pathToFileURL(resolve('scripts/bake-roads/bake.mjs')).href);

const SEED = { id: 'fixture', origin: { lat: 50.5, lon: -4.5 }, bounds: { north: 50.6, south: 50.4, west: -4.7, east: -4.3 }, towns: [] };
const { WORLD_SCALE: SCALE } = await game('config.js'); // world metres per real metre (1:4)

/** OSM-like elements from real-metre polylines (+x east, +y south of the origin); equal points share a node. */
function osm() {
    let id = 1;
    const elements = [];
    return {
        elements,
        way(pts, tags) { elements.push({ type: 'way', id: id++, tags, geometry: pts.map(([x, y]) => realToLatLon(x, y, SEED.origin)) }); },
        node([x, y], tags) { const p = realToLatLon(x, y, SEED.origin); elements.push({ type: 'node', id: id++, lat: p.lat, lon: p.lon, tags }); },
    };
}
const run = elements => bake(elements, SEED).graph;
const edges = g => [...g.edges.values()];
const nodes = g => [...g.nodes.values()];
const nearest = (g, x, y) => nodes(g).reduce((b, n) => (Math.hypot(n.x - x * SCALE, n.y - y * SCALE) < Math.hypot(b.x - x * SCALE, b.y - y * SCALE) ? n : b));

test('parallel one-way carriageways with the same ref collapse into one two-way dual centreline', () => {
    const o = osm();
    const along = (y, from, to) => { const pts = []; for (let x = from; from < to ? x <= to : x >= to; x += from < to ? 100 : -100) pts.push([x, y]); return pts; };
    o.way([[-1500, 0], [-1000, 0]], { highway: 'trunk', ref: 'A30' });
    o.way([[-1000, 0], ...along(10, -900, 900), [1000, 0]], { highway: 'trunk', ref: 'A30', oneway: 'yes' });  // eastbound
    o.way([[1000, 0], ...along(-10, 900, -900), [-1000, 0]], { highway: 'trunk', ref: 'A30', oneway: 'yes' }); // westbound
    o.way([[1000, 0], [1500, 0]], { highway: 'trunk', ref: 'A30' });
    o.way([[0, 10], [0, 800]], { highway: 'unclassified', name: 'Side Lane' }); // joins the eastbound carriageway
    const g = run(o.elements);
    const a30 = edges(g).filter(e => e.ref === 'A30');
    const dual = a30.filter(e => e.dual);
    assert.ok(dual.length >= 1, 'a dual centreline exists');
    assert.ok(dual.every(e => e.cls === 'dual' && !e.oneway), 'collapsed edges are two-way dual class');
    assert.equal(a30.filter(e => e.oneway).length, 0, 'no one-way carriageway is left');
    const total = dual.reduce((s, e) => s + e.len, 0);
    assert.ok(Math.abs(total - 2000 * SCALE) < 0.1 * 2000 * SCALE, `one centreline, not two (${total.toFixed(1)} m)`);
    // the centreline runs between the carriageways, and the side road still joins it
    for (const e of dual) for (let i = 1; i < e.pts.length; i += 2) assert.ok(Math.abs(e.pts[i]) < 10 * SCALE + 0.2);
    const lane = edges(g).find(e => e.name === 'Side Lane');
    const top = g.nodes.get(lane.a).y < g.nodes.get(lane.b).y ? g.nodes.get(lane.a) : g.nodes.get(lane.b);
    assert.ok(top.edges.size >= 3, 'side road meets the dual at a junction');
    assert.ok([...top.edges].some(id => g.edges.get(id).dual));
});

test('a roundabout ring collapses into one roundabout node joining its arms', () => {
    const o = osm();
    const ring = [];
    for (let k = 0; k <= 16; k++) { const a = (k % 16) * Math.PI / 8; ring.push([Math.round(30 * Math.cos(a) * 1000) / 1000, Math.round(30 * Math.sin(a) * 1000) / 1000]); }
    o.way(ring, { highway: 'primary', junction: 'roundabout' });
    for (const k of [0, 4, 8, 12]) {
        const [x, y] = ring[k];
        o.way([[x, y], [x * 30, y * 30]], { highway: 'primary', ref: 'A38' });
    }
    const g = run(o.elements);
    const rb = nodes(g).filter(n => n.junction === 'roundabout');
    assert.equal(rb.length, 1);
    assert.equal(rb[0].edges.size, 4);
    assert.ok(Math.hypot(rb[0].x, rb[0].y) < 1, 'the node sits at the ring centre');
    assert.equal(edges(g).filter(e => e.rb).length, 0, 'no ring edges remain');
});

test('a mini-roundabout node marks its junction', () => {
    const o = osm();
    o.way([[-1000, 0], [0, 0], [1000, 0]], { highway: 'tertiary' });
    o.way([[0, 0], [0, 1000]], { highway: 'tertiary' });
    o.node([0, 0], { highway: 'mini_roundabout' });
    const n = nearest(run(o.elements), 0, 0);
    assert.equal(n.junction, 'roundabout');
    assert.equal(n.mini, true);
});

test('a road ending just short of another is snapped into a T-junction', () => {
    const o = osm();
    o.way([[-1000, 0], [1000, 0]], { highway: 'tertiary', name: 'Main Road' });
    o.way([[0, 1.5], [0, 1000]], { highway: 'unclassified', name: 'Spur Road' });
    const g = run(o.elements);
    const t = nearest(g, 0, 0);
    assert.equal(t.edges.size, 3, 'a junction at the meeting point');
    assert.equal(g.nodes.size, 4);
    assert.ok(Math.hypot(t.x, t.y) < 0.2);
});

test('a bridge over a road makes no junction and keeps its bridge span', () => {
    const o = osm();
    o.way([[-1000, 0], [1000, 0]], { highway: 'tertiary', name: 'Low Road' });
    o.way([[0, 1000], [0, 20]], { highway: 'tertiary', name: 'High Road' });
    o.way([[0, 20], [0, -20]], { highway: 'tertiary', name: 'High Road', bridge: 'yes', layer: '1' });
    o.way([[0, -20], [0, -1000], [1000, -1000], [1000, 0]], { highway: 'tertiary', name: 'High Road' }); // joins up elsewhere
    const g = run(o.elements);
    for (const n of nodes(g)) assert.ok(Math.hypot(n.x, n.y) > 5 * SCALE, 'no node at the crossing');
    const high = edges(g).filter(e => e.name === 'High Road' && e.pts.some((v, i) => i % 2 === 0 && Math.abs(v) < 0.01));
    assert.ok(high.some(e => e.segs.includes(1)), 'the bridge survives as a span on the merged edge');
    assert.equal(findCrossings(g).length, 0);
    // and it is written as a bridge span
    const decoded = decodeTiles(toTiles(g, SEED).map(t => t.encoded));
    const bridged = decoded.edges.filter(e => e.bridge);
    assert.equal(bridged.length, 1);
    assert.ok(bridged[0].spans.length === 1 && bridged[0].spans[0].type === 'bridge');
    assert.equal(bridged[0].spans[0].level, 1, 'a bridge on layer 1 is level 1');
});

test('spans carry levels from the OSM layer tag, defaulting to +1 for bridges and -1 for tunnels', () => {
    const o = osm();
    o.way([[-1000, 0], [-300, 0]], { highway: 'tertiary', name: 'East Road' });
    o.way([[-300, 0], [-200, 0]], { highway: 'tertiary', name: 'East Road', bridge: 'yes', layer: '2' });
    o.way([[-200, 0], [400, 0]], { highway: 'tertiary', name: 'East Road' });
    o.way([[400, 0], [500, 0]], { highway: 'tertiary', name: 'East Road', tunnel: 'yes', layer: '-1' });
    o.way([[500, 0], [900, 0]], { highway: 'tertiary', name: 'East Road' });
    o.way([[0, 300], [0, 500]], { highway: 'tertiary', name: 'Cut Road', tunnel: 'yes' }); // untagged layer
    o.way([[0, 500], [600, 900]], { highway: 'tertiary', name: 'Cut Road' });
    o.way([[0, 1], [0, 300]], { highway: 'tertiary', name: 'Cut Road' });
    const decoded = decodeTiles(toTiles(run(o.elements), SEED).map(t => t.encoded));
    const levels = decoded.edges.flatMap(e => e.spans.map(sp => [sp.type, sp.level]));
    assert.deepEqual(levels.map(l => l.join(':')).sort(), ['bridge:2', 'tunnel:-1', 'tunnel:-1']);
    for (const e of decoded.edges) for (const sp of e.spans) assert.ok(sp.type === 'bridge' ? sp.level >= 1 : sp.level <= -1);
    assert.equal(BAKE_FORMAT, 3);
});

test('tile format 3 round-trips span levels and roundabout ring radii', () => {
    const nodes = [{ x: 0, y: 0, junction: 'roundabout', ringRadius: 3.4, roundaboutFrom: 1960 }, { x: 40, y: 0, junction: 'end' }, { x: 80, y: 0, junction: 'end' }];
    const pos = i => nodes[i];
    const base = { cls: 'A', ref: null, name: null };
    const edgesIn = [
        { ...base, a: 0, b: 1, pts: [0, 0, 20, 0, 40, 0], spans: [{ i0: 0, i1: 1, type: 'bridge', level: 2 }, { i0: 1, i1: 2, type: 'tunnel', level: -2 }], bridge: true, tunnel: true },
        { ...base, a: 1, b: 2, pts: [40, 0, 80, 0], spans: [{ i0: 0, i1: 1, type: 'bridge' }] }, // no explicit level: +1
    ];
    const out = decodeTiles([JSON.parse(JSON.stringify(encodeTile('t', 0, nodes, edgesIn, pos)))]);
    assert.deepEqual(out.edges[0].spans.map(sp => [sp.type, sp.level]), [['bridge', 2], ['tunnel', -2]]);
    assert.deepEqual(out.edges[1].spans.map(sp => [sp.type, sp.level]), [['bridge', 1]]);
    assert.equal(out.nodes[0].ringRadius, 3.4);
    assert.equal(out.nodes[1].ringRadius, undefined);
});

test('ways meeting end to end with matching tags merge into one edge', () => {
    const o = osm();
    o.way([[-1000, 0], [-300, 0]], { highway: 'unclassified', name: 'Long Lane' });
    o.way([[-300, 0], [300, 20]], { highway: 'unclassified', name: 'Long Lane' });
    o.way([[300, 20], [1000, 0]], { highway: 'unclassified', name: 'Long Lane' });
    const g = run(o.elements);
    assert.equal(g.edges.size, 1);
    assert.equal(g.nodes.size, 2);
    const e = edges(g)[0];
    assert.equal(e.cls, 'lane');
    assert.ok(Math.abs(e.len - 2000 * SCALE) < 2);
});

test('one-way tags are carried through, including oneway=-1', () => {
    for (const [tag, eastward] of [['yes', true], ['-1', false]]) {
        const o = osm();
        o.way([[-1000, 0], [1000, 0]], { highway: 'tertiary', oneway: tag });
        const g = run(o.elements);
        const [e] = edges(g);
        assert.equal(e.oneway, true);
        // the edge runs a -> b in the direction of travel
        assert.equal(g.nodes.get(e.a).x < g.nodes.get(e.b).x, eastward, `oneway=${tag}`);
    }
    const o = osm();
    o.way([[-1000, 0], [1000, 0]], { highway: 'tertiary' });
    assert.equal(edges(run(o.elements))[0].oneway, false);
});

test('the projection is plain equirectangular at WORLD_SCALE and invertible (no town lens)', () => {
    const seed = { origin: { lat: 50.5, lon: -4.5 }, towns: [{ id: 'a', lat: 50.5, lon: -4.5, size: 'city' }, { id: 'b', lat: 50.52, lon: -4.45, size: 'village' }] };
    const proj = createProjection(seed);
    assert.equal(proj.worldScale, SCALE);
    for (const [lat, lon] of [[50.5, -4.5], [50.505, -4.49], [50.52, -4.45], [50.6, -4.2]]) {
        const p = proj.project(lat, lon), back = proj.unproject(p.x, p.y);
        assert.ok(Math.abs(back.lat - lat) < 1e-7 && Math.abs(back.lon - lon) < 1e-7);
    }
    // 1000 real metres east is exactly 1000 * scale world metres anywhere: the same scale at a town centre and far away
    for (const [x, y] of [[0, 0], [20000, -9000]]) {
        const a = proj.fromReal(x, y), b = proj.fromReal(x + 1000, y);
        assert.ok(Math.abs(b.x - a.x - 1000 * SCALE) < 1e-9 && Math.abs(b.y - a.y) < 1e-9);
        assert.equal(proj.localScale(a.x, a.y), SCALE);
    }
});

test('town game radius is the baked street footprint times the world scale', () => {
    for (const size of Object.keys(TOWN_FOOTPRINT)) {
        assert.ok(Math.abs(TOWN_RADIUS[size] - TOWN_FOOTPRINT[size] * SCALE) < 1e-9, size);
        assert.equal(townFootprint({ size }), TOWN_FOOTPRINT[size]);
    }
    assert.ok(TOWN_FOOTPRINT.city > TOWN_FOOTPRINT.town && TOWN_FOOTPRINT.town > TOWN_FOOTPRINT.small && TOWN_FOOTPRINT.small > TOWN_FOOTPRINT.village);
});

test('elevation.bin round-trips: predicted residuals, varints and zero runs decode to the same grid', async () => {
    const { encodeElevation, decodeElevation, sampleElevation } = await game('world/elevation-format.js');
    const width = 41, height = 29;
    const data = new Int16Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        // sea (0) on the left third, a ridge with a steep step (multi-byte residual) and a long flat top
        data[y * width + x] = x < 14 ? 0 : x === 20 && y % 2 ? 7000 : Math.round(300 + 200 * Math.sin(x / 3) * Math.cos(y / 4));
    }
    const buf = encodeElevation({ width, height, minX: -100, minY: 50, cell: 24, unit: 0.25, data });
    const dem = decodeElevation(buf);
    assert.deepEqual([dem.width, dem.height, dem.minX, dem.minY, dem.cell, dem.unit], [width, height, -100, 50, 24, 0.25]);
    assert.deepEqual([...dem.data], [...data]);
    assert.ok(buf.byteLength < 24 + width * height * 2, 'smaller than raw Int16');
    // bilinear sampling at a cell centre returns the stored height in world metres
    assert.equal(sampleElevation(dem, -100 + 20 * 24, 50 + 5 * 24), data[5 * width + 20] * 0.25);
});

// ---- plan 0009 phase 4: separation, junction consolidation, roundabout arms ----------------------------------------

const sep = await import(pathToFileURL(resolve('scripts/bake-roads/bake.mjs')).href);

/** Bake graph from nodes [[x, y, props?], ...] and edges [[a, b, flatPts, cls, props?], ...] in world metres. */
function bakeGraph(nodeList, edgeList) {
    const g = sep.createBakeGraph();
    const ns = nodeList.map(([x, y, props]) => g.addNode(x, y, { rawDeg: 3, ...props }));
    const es = edgeList.map(([a, b, pts, cls = 'lane', props = {}]) => g.addEdge(ns[a], ns[b], pts, new Array(pts.length / 2 - 1).fill(props.flag ?? 0), { cls, ...props }));
    return { g, ns, es };
}

test('strip overlaps: a street 6 m beside an A road overlaps, 20 m beside it does not', () => {
    const build = dy => bakeGraph([[-300, 0], [-100, 0], [100, 0], [300, 0], [-100, dy], [100, dy]],
        [[0, 1, [-300, 0, -100, 0], 'A'], [1, 2, [-100, 0, 100, 0], 'A'], [2, 3, [100, 0, 300, 0], 'A'], [4, 5, [-100, dy, 100, dy], 'street']]);
    assert.ok(sep.findStripOverlaps(build(6).g).length >= 1);
    assert.equal(sep.findStripOverlaps(build(20).g).length, 0);
});

test('generaliseSeparation drops the lower-ranked road when the network stays connected and never the higher one', () => {
    // a lane loop beside an A road, joined to it at both ends: the lane can go, the A road stays
    const { g, es } = bakeGraph([[-500, 0], [-100, 0], [100, 0], [500, 0], [-100, 4], [100, 4]],
        [[0, 1, [-500, 0, -100, 0], 'A'], [1, 2, [-100, 0, 100, 0], 'A'], [2, 3, [100, 0, 500, 0], 'A'], [1, 4, [-100, 0, -100, 4], 'lane'], [4, 5, [-100, 4, 100, 4], 'lane'], [5, 2, [100, 4, 100, 0], 'lane']]);
    const stats = sep.generaliseSeparation(g);
    assert.equal(stats.after, 0);
    assert.ok(stats.dropped + stats.contracted + stats.snapped + stats.nudged >= 1);
    for (const e of es.slice(0, 3)) assert.ok(g.edges.has(e.id), 'the A road survives');
    const lane = es[4];
    assert.ok(!g.edges.has(lane.id) || lane.pts.some((v, i) => i % 2 === 1 && Math.abs(v) > 9), 'the parallel lane is gone or has moved clear');
});

test('generaliseSeparation moves apart a road it cannot drop (the only link between two big halves)', () => {
    // two long lanes joined only by a street that bends to run 5 m beside an A road
    const { g, es } = bakeGraph([[-3000, 400], [-300, 400], [-300, 14], [20, 14], [900, 14], [3000, 400], [-500, 0], [-140, 0], [300, 0], [800, 0]],
        [[0, 1, [-3000, 400, -300, 400], 'lane'], [1, 2, [-300, 400, -300, 14], 'lane'],
            [2, 3, [-300, 14, -140, 14, -100, 6, 0, 6, 20, 14], 'street'],
            [3, 4, [20, 14, 900, 14], 'lane'], [4, 5, [900, 14, 3000, 400], 'lane'],
            [6, 7, [-500, 0, -140, 0], 'A'], [7, 8, [-140, 0, 300, 0], 'A'], [8, 9, [300, 0, 800, 0], 'A']]);
    const street = es[2];
    const first = street.pts.slice(0, 2), last = street.pts.slice(-2);
    assert.ok(sep.findStripOverlaps(g).length >= 1, 'overlapping to start with');
    const stats = sep.generaliseSeparation(g);
    assert.equal(stats.after, 0, 'cleared');
    assert.ok(g.edges.has(street.id), 'the street is the only way through, so it stays');
    assert.deepEqual([street.pts[0], street.pts[1]], first, 'its end nodes have not moved');
    assert.deepEqual(street.pts.slice(-2), last);
    assert.ok(stats.nudged >= 1);
});

test('generaliseSeparation never removes a long bridge', () => {
    // a 400 m bridge carrying a B road beside an A road: it is not dropped (and is a structure throughout)
    const { g, es } = bakeGraph([[-2000, 0], [-200, 0], [200, 0], [2000, 0], [-200, 6], [200, 6]],
        [[0, 1, [-2000, 0, -200, 0], 'A'], [1, 2, [-200, 0, 200, 0], 'A'], [2, 3, [200, 0, 2000, 0], 'A'], [4, 5, [-200, 6, 200, 6], 'B', { flag: 1 }]]);
    const bridge = es[3];
    sep.generaliseSeparation(g);
    assert.ok(g.edges.has(bridge.id), 'the bridge edge stays');
    assert.equal(bridge.segs.filter(Boolean).length, bridge.segs.length, 'and is still a bridge throughout');
});

test('consolidateJunctions merges two close T-junctions into one crossroads and leaves distant ones', () => {
    const tees = gap => bakeGraph([[-200, 0], [0, 0], [gap, 0], [200, 0], [0, 100], [gap, -100]],
        [[0, 1, [-200, 0, 0, 0], 'B'], [1, 2, [0, 0, gap, 0], 'B'], [2, 3, [gap, 0, 200, 0], 'B'], [1, 4, [0, 0, 0, 100], 'B'], [2, 5, [gap, 0, gap, -100], 'B']]);
    const close = tees(8);
    assert.equal(sep.consolidateJunctions(close.g).merged, 1);
    assert.equal([...close.g.nodes.values()].filter(n => n.edges.size === 4).length, 1, 'one four-way node');
    assert.equal(sep.consolidateJunctions(tees(60).g).merged, 0);
});

test('absorbIntoRoundabouts pulls a junction inside the ring into the roundabout', () => {
    // ring: island 7.2 + A width 8 = 15.2 m; a side road joins 10 m out, the other arms are long
    const { g, ns } = bakeGraph([[0, 0, { junction: 'roundabout' }], [-300, 0], [300, 0], [0, 300], [10, 0], [10, 200]],
        [[0, 1, [0, 0, -300, 0], 'A'], [0, 2, [0, 0, 300, 0], 'A'], [0, 3, [0, 0, 0, 300], 'A'], [0, 4, [0, 0, 10, 0], 'A'], [4, 5, [10, 0, 10, 200], 'A']]);
    const r = sep.absorbIntoRoundabouts(g);
    assert.equal(r.absorbed, 1);
    assert.equal(r.left, 0);
    assert.ok(!g.nodes.has(ns[4].id), 'the inner junction is gone');
    assert.equal(ns[0].edges.size, 4, 'its road now joins the roundabout node');
    assert.equal(ns[0].junction, 'roundabout');
});

test('a baked roundabout keeps its ring radius (world metres) on the node and in the tile', () => {
    const o = osm();
    const ring = [];
    for (let k = 0; k <= 16; k++) { const a = (k % 16) * Math.PI / 8; ring.push([Math.round(40 * Math.cos(a) * 1000) / 1000, Math.round(40 * Math.sin(a) * 1000) / 1000]); }
    o.way(ring, { highway: 'primary', junction: 'roundabout' });
    for (const k of [0, 4, 8, 12]) { const a = k * Math.PI / 8; o.way([[40 * Math.cos(a), 40 * Math.sin(a)], [400 * Math.cos(a), 400 * Math.sin(a)]], { highway: 'primary', name: `Arm ${k}` }); }
    const g = run(o.elements);
    const rb = nodes(g).find(n => n.junction === 'roundabout');
    assert.ok(Math.abs(rb.ringRadius - 40 * SCALE) < 0.5, `ring radius ${rb.ringRadius} ~ ${40 * SCALE}`);
    const decoded = decodeTiles(toTiles(g, SEED).map(t => t.encoded));
    const out = decoded.nodes.find(n => n.junction === 'roundabout');
    assert.ok(Math.abs(out.ringRadius - rb.ringRadius) < 0.06);
});
