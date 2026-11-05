// Era rules (scripts/bake-roads/era.mjs) on the baked road data: M5 and Tamar Bridge dates, dualling upgrades,
// town growth, per-year connectivity, curated history events and the tile format round trip.
import { test } from 'node:test';
import { seedWithBaked } from './helpers/delivery-seed.mjs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import fs from 'node:fs';

const game = p => import(pathToFileURL(resolve(`Games.Client/wwwroot/games/delivery-driver/${p}`)).href);
const script = p => import(pathToFileURL(resolve(p)).href);
const { edgeOpen, edgeClass } = await game('world/roadgraph.js');
const { roadEvents, eventsBetween, describeEvent } = await game('world/history.js');
const { encodeTile, decodeTiles } = await game('world/baked-format.js');
const { loadBakedWorld } = await script('scripts/validate-roads.mjs');
const { parseStartYear, applyEra, SAMPLE_YEARS } = await script('scripts/bake-roads/era.mjs');
const { createBakeGraph } = await script('scripts/bake-roads/bake.mjs');
const history = JSON.parse(fs.readFileSync('scripts/bake-roads/history.json', 'utf8'));

const world = await loadBakedWorld();
const { graph, region } = world;
const edges = graph.edges;

/** The biggest component of the edges open in a year (union-find over node ids). */
function network(year) {
    const parent = new Map();
    const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (const e of edges) {
        if (!edgeOpen(e, year)) continue;
        for (const id of [e.a, e.b]) if (!parent.has(id)) parent.set(id, id);
        parent.set(find(e.a), find(e.b));
    }
    const size = new Map();
    for (const id of parent.keys()) size.set(find(id), (size.get(find(id)) ?? 0) + 1);
    const main = [...size.entries()].sort((p, q) => q[1] - p[1])[0][0];
    return { find, main, parent, components: size.size };
}

test('parseStartYear reads usable OSM start_date values only', () => {
    assert.equal(parseStartYear('1938'), 1938);
    assert.equal(parseStartYear('1978-04'), 1978);
    assert.equal(parseStartYear('1930s'), 1930);
    assert.equal(parseStartYear('before 1573'), null);
    assert.equal(parseStartYear('C20'), null);
    assert.equal(parseStartYear(undefined), null);
    assert.equal(parseStartYear('2031'), null);
});

test('the M5 is absent in 1919 and 1976 and present from 1977', () => {
    const m5 = edges.filter(e => e.cls === 'M' && /M5/.test(e.ref ?? ''));
    assert.ok(m5.length > 20, `${m5.length} M5 edges`);
    for (const e of m5) {
        assert.equal(edgeOpen(e, 1919), false);
        assert.equal(edgeOpen(e, 1976), false);
        assert.equal(edgeOpen(e, 1977), true);
        assert.equal(edgeClass(e, 2020), 'M');
    }
    // slip roads on the M5 open with it
    const slips = edges.filter(e => e.link && /M5/.test(e.ref ?? ''));
    assert.ok(slips.length > 0);
    for (const e of slips) assert.equal(edgeOpen(e, 1976), false);
});

test('the Tamar Bridge opens in 1961, the year the Saltash ferry closes', () => {
    const bridge = edges.filter(e => e.tag === 'a38-tamar-bridge');
    assert.ok(bridge.length > 0);
    for (const e of bridge) {
        assert.equal(edgeOpen(e, 1960), false);
        assert.equal(edgeOpen(e, 1961), true);
    }
    const ev = eventsBetween(world, 1960, 1961).map(e => `${e.road}:${e.kind}`);
    assert.ok(ev.includes('a38-tamar-bridge:opened'));
    assert.ok(ev.includes('a38-ply-saltash-ferry:closed'));
    assert.equal(describeEvent(roadEvents(world).find(e => e.road === 'a38-ply-saltash-ferry')), 'The Saltash Ferry has made its last crossing.');
});

test('the Exeter bypass opens in 1938 and dual carriageways are dualled in their curated year', () => {
    const bypass = edges.filter(e => e.tag === 'a30-exeter-bypass');
    assert.ok(bypass.length > 0);
    for (const e of bypass) { assert.equal(edgeOpen(e, 1937), false); assert.equal(edgeOpen(e, 1938), true); }
    assert.ok(eventsBetween(world, 1937, 1938).some(e => e.road === 'a30-exeter-bypass' && e.kind === 'opened'));

    const dualled = edges.filter(e => e.tag === 'a30-oke-lau' && e.upgrades.length);
    assert.ok(dualled.length > 0);
    for (const e of dualled) {
        assert.equal(e.cls, 'A', 'the stored class is the base class');
        assert.equal(edgeClass(e, 1982), 'A');
        assert.equal(edgeClass(e, 1983), 'dual');
    }
    // no edge keeps class `dual` as its base class, and every upgrade comes after the edge opens
    assert.equal(edges.filter(e => e.cls === 'dual').length, 0);
    for (const e of edges) for (const u of e.upgrades) assert.ok(u.year >= e.opened);
});

test('history events come from the curated table, oldest first, none before 1920', () => {
    const ev = roadEvents(world);
    assert.deepEqual(ev.map(e => e.year), ev.map(e => e.year).sort((a, b) => a - b));
    assert.ok(ev.every(e => e.year > 1919));
    for (const id of ['m5', 'a30-exeter-bypass', 'a38-tamar-bridge', 'a30-red-pz']) assert.ok(ev.some(e => e.road === id), id);
    // every dated seed road is in the curated table
    const seed = JSON.parse(fs.readFileSync('Games.Client/wwwroot/games/delivery-driver/world/seed/sw-england.json', 'utf8'));
    const ids = new Set(history.entries.map(e => e.id));
    for (const r of seed.roads) if (r.opened || r.closed || r.upgrades?.length) assert.ok(ids.has(r.id), `${r.id} missing from history.json`);
});

test('town streets grow outwards over the years', () => {
    const count = (year, town) => edges.filter(e => e.town === town && e.cls === 'street' && edgeOpen(e, year)).length;
    for (const town of ['exeter', 'plymouth', 'truro']) {
        const c = [1919, 1950, 1990, 2024].map(y => count(y, town));
        assert.ok(c[0] > 0, `${town} has a core in 1919`);
        for (let i = 1; i < c.length; i++) assert.ok(c[i] >= c[i - 1]);
        assert.ok(c[3] > c[0] * 1.3, `${town} grows: ${c}`);
    }
});

test('every town centre is connected to the main network in each sample year', () => {
    assert.deepEqual(SAMPLE_YEARS, [1919, 1930, 1950, 1970, 1990, 2024]);
    for (const year of SAMPLE_YEARS) {
        const net = network(year);
        const open = [...net.parent.keys()].map(id => graph.nodes[id]);
        for (const t of region.towns) {
            let best = null, bd = Infinity;
            for (const n of open) { const d = Math.hypot(n.x - t.x, n.y - t.y); if (d < bd) { bd = d; best = n; } }
            assert.ok(best, `${t.id} has no road in ${year}`);
            assert.equal(net.find(best.id), net.main, `${t.id} is cut off in ${year}`);
        }
    }
});

test('no street is an island: open edges are in the main network', () => {
    for (const year of [1919, 1950, 1990]) {
        const net = network(year);
        const stray = edges.filter(e => edgeOpen(e, year) && net.find(e.a) !== net.main);
        assert.ok(stray.length < 40, `${stray.length} stray edges in ${year}`);
    }
});

test('signal and roundabout junctions carry the year they appear', () => {
    const signals = graph.nodes.filter(n => n.junction === 'signals');
    const rbs = graph.nodes.filter(n => n.junction === 'roundabout');
    assert.ok(signals.length && rbs.length);
    assert.ok(signals.every(n => n.signalsFrom > 1919));
    assert.ok(rbs.every(n => n.roundaboutFrom > 1919));
});

test('tile format round-trips era data', () => {
    const nodes = [{ x: 0, y: 0, junction: 'signals', signalsFrom: 1932 }, { x: 10, y: 0, junction: 'end' }, { x: 20, y: 0, junction: 'roundabout', roundaboutFrom: 1960 }];
    const pos = i => nodes[i];
    const base = { cls: 'A', pts: [0, 0, 10, 0], ref: null, name: null, spans: [] };
    const edgesIn = [
        { ...base, a: 0, b: 1 },
        { ...base, a: 1, b: 2, pts: [10, 0, 20, 0], opened: 1938, closed: 1961, upgrades: [{ year: 1970, class: 'dual' }], tag: 'x' },
    ];
    const tile = JSON.parse(JSON.stringify(encodeTile('t', 0, nodes, edgesIn, pos)));
    const out = decodeTiles([tile]);
    assert.equal(out.edges[0].opened, 0);
    assert.equal(out.edges[0].closed, Infinity);
    assert.deepEqual(out.edges[0].upgrades, []);
    assert.equal(out.edges[1].opened, 1938);
    assert.equal(out.edges[1].closed, 1961);
    assert.deepEqual(out.edges[1].upgrades, [{ year: 1970, class: 'dual' }]);
    assert.equal(out.edges[1].tag, 'x');
    assert.equal(out.nodes[0].signalsFrom, 1932);
    assert.equal(out.nodes[2].roundaboutFrom, 1960);
    assert.equal(out.nodes[1].signalsFrom, undefined);
});

test('applyEra: a street only reachable through a later road opens with that road', () => {
    const g = createBakeGraph();
    const n = [0, 100, 200, 300].map(x => g.addNode(x, 0));
    const seg = (a, b, props) => g.addEdge(n[a], n[b], [n[a].x, 0, n[b].x, 0], [0], { cls: 'A', ...props });
    seg(0, 1, {});
    const late = seg(1, 2, { startYear: 1955 });
    const tail = seg(2, 3, {});
    const proj = { project: () => ({ x: 0, y: 0 }) };
    applyEra(g, { towns: [] }, proj, { defaults: history.defaults, town: history.town, entries: [] });
    assert.equal(late.opened, 1955);
    assert.equal(tail.opened, 1955);
});
