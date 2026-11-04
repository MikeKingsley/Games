// Road bake (scripts/bake-roads/bake.mjs) on small hand-built OSM fixtures: dual carriageway collapse, roundabout
// collapse, T-junction snapping, a bridge over a road (no junction), degree-2 merging and one-way tags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const game = p => import(pathToFileURL(resolve(`Games.Client/wwwroot/games/delivery-driver/${p}`)).href);
const { realToLatLon, createProjection, createLens, TOWN_RADIUS, footprintM } = await game('world/projection.js');
const { decodeTiles } = await game('world/baked-format.js');
const { bake, toTiles, findCrossings } = await import(pathToFileURL(resolve('scripts/bake-roads/bake.mjs')).href);

const SEED = { id: 'fixture', origin: { lat: 50.5, lon: -4.5 }, bounds: { north: 50.6, south: 50.4, west: -4.7, east: -4.3 }, towns: [] };
const SCALE = 1 / 13; // world metres per real metre without town lenses

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
const run = elements => bake(elements, SEED, { lens: false }).graph;
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

test('town lenses are smooth, invertible and map the street footprint to the game radius', () => {
    const lens = createLens(0, 0, footprintM({ size: 'city' }) * SCALE, TOWN_RADIUS.city);
    const out = { x: 0, y: 0 };
    let prev = 0;
    for (let r = 1; r < lens.rOut + 20; r += 1) {
        lens.forward(r, 0, out);
        assert.ok(out.x > prev, 'monotonic');
        prev = out.x;
    }
    lens.forward(footprintM({ size: 'city' }) * SCALE, 0, out);
    assert.ok(Math.abs(out.x - TOWN_RADIUS.city) < 0.5);
    const seed = { origin: { lat: 50.5, lon: -4.5 }, towns: [{ id: 'a', lat: 50.5, lon: -4.5, size: 'city' }, { id: 'b', lat: 50.52, lon: -4.45, size: 'village' }] };
    const proj = createProjection(seed);
    for (const [lat, lon] of [[50.5, -4.5], [50.505, -4.49], [50.52, -4.45], [50.6, -4.2]]) {
        const p = proj.project(lat, lon), back = proj.unproject(p.x, p.y);
        assert.ok(Math.abs(back.lat - lat) < 1e-7 && Math.abs(back.lon - lon) < 1e-7);
    }
    assert.ok(Math.abs(proj.localScale(0, 0) - lens.magnification * SCALE) < 0.01, 'magnified at the centre');
});
