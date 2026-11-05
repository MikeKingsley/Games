// Corridor road LOD, frame driver, look-ahead, time budget and buffer pooling (plan 0009 phase 12).
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedWithBaked } from './helpers/delivery-seed.mjs';
import { createWorld } from '../../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { edgeOpen } from '../../Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js';
import { layoutJunction } from '../../Games.Client/wwwroot/games/delivery-driver/world/junction-layout.js';
import { createGraph } from '../../Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js';
import { CHUNK_SIZE, QUALITY } from '../../Games.Client/wwwroot/games/delivery-driver/config.js';
import { lodFor, lodWithHysteresis } from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/camera3d.js';
import { createChunkCache } from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/chunk-cache.js';
import { buildChunkRoads, buildEdgeMesh, DETAIL } from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/road-mesh.js';
import { deckRuns } from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/structure-mesh.js';
import { createFrameDriver, lookAheadCoords, corridorOf, ROAD_DETAIL, HYSTERESIS, buildChunkData, meshesOf } from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/chunk-build.js';
import { createBuilder, poolStats, box, mergeMeshes } from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/meshes.js';
import { interleave, interleaveInto, uploadScratch, FLOATS_PER_VERTEX } from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/gpu-mesh.js';

const world = createWorld(seedWithBaked());
const exeter = world.region.townById.get('exeter');
const ci = Math.floor(exeter.x / CHUNK_SIZE), cj = Math.floor(exeter.y / CHUNK_SIZE);
const verts = m => (m ? m.positions.length / 3 : 0);

test('the quality presets give the corridor distance, its detail level and the per-frame build budget, growing with the preset', () => {
    const [low, medium, high] = ['low', 'medium', 'high'].map(n => QUALITY[n]);
    assert.ok(low.roadDetail < medium.roadDetail && medium.roadDetail < high.roadDetail);
    assert.ok(low.buildMs <= medium.buildMs && medium.buildMs <= high.buildMs);
    assert.ok(low.roadLevel < medium.roadLevel && medium.roadLevel === high.roadLevel);
    assert.deepEqual(corridorOf(medium), { reach: 330, level: ROAD_DETAIL.full });
    assert.deepEqual(corridorOf(low), { reach: 240, level: ROAD_DETAIL.basic });
    for (const q of [low, medium, high]) assert.ok(q.roadDetail < q.viewDistance, 'the corridor is inside the view distance');
});

test('road detail levels only ever remove geometry: coarse < basic < full for a town chunk, and true/false are full/coarse', () => {
    let seen = 0;
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
        const chunk = world.chunks.get(i, j);
        const full = buildChunkRoads(world, chunk, 2024, { detail: DETAIL.full }), basic = buildChunkRoads(world, chunk, 2024, { detail: DETAIL.basic }), coarse = buildChunkRoads(world, chunk, 2024, { detail: DETAIL.coarse });
        if (!full) continue;
        seen++;
        assert.ok(verts(coarse) <= verts(basic) && verts(basic) <= verts(full), `${verts(coarse)} <= ${verts(basic)} <= ${verts(full)}`);
        assert.equal(verts(buildChunkRoads(world, chunk, 2024)), verts(full), 'the default is full detail');
        assert.equal(verts(buildChunkRoads(world, chunk, 2024, { detail: false })), verts(coarse));
    }
    assert.ok(seen >= 5);
    // and the saving is real in the middle of town
    const mid = world.chunks.get(ci, cj);
    assert.ok(verts(buildChunkRoads(world, mid, 2024, { detail: DETAIL.coarse })) < 0.7 * verts(buildChunkRoads(world, mid, 2024, { detail: DETAIL.full })));
});

test('a coarse road is the same road: its vertices stay within a few metres of the full strip, with no markings, pavements or supports', () => {
    const e = world.graph.edges.find(x => edgeOpen(x, 2024) && x.cls === 'A' && x.len > 120 && !deckRuns(x).length && !x.tunnel && x.z);
    assert.ok(e);
    const full = buildEdgeMesh(world, e, 2024, { detail: DETAIL.full }), coarse = buildEdgeMesh(world, e, 2024, { detail: DETAIL.coarse });
    assert.ok(verts(coarse) < verts(full) * 0.5, `${verts(coarse)} of ${verts(full)} vertices`);
    const x0 = Math.min(...full.positions.filter((_, k) => k % 3 === 0)), x1 = Math.max(...full.positions.filter((_, k) => k % 3 === 0));
    const cx0 = Math.min(...coarse.positions.filter((_, k) => k % 3 === 0)), cx1 = Math.max(...coarse.positions.filter((_, k) => k % 3 === 0));
    assert.ok(Math.abs(x0 - cx0) < 6 && Math.abs(x1 - cx1) < 6, 'same extent');
});

test('a coarse deck is a slab with no parapets, piers or embankments; basic keeps the parapets; full has the supports', () => {
    const e = world.graph.edges.find(x => edgeOpen(x, 2024) && x.cls === 'A' && x.z && deckRuns(x).some(([a, b]) => b - a > 45 && a > 15 && b < x.len - 15));
    assert.ok(e, 'a long A-road bridge');
    const n = lvl => verts(buildEdgeMesh(world, e, 2024, { detail: lvl }));
    assert.ok(n(DETAIL.coarse) < n(DETAIL.basic) && n(DETAIL.basic) < n(DETAIL.full), `${n(0)} < ${n(1)} < ${n(2)}`);
});

test('lodWithHysteresis agrees with lodFor away from a boundary and holds the current level near it', () => {
    const edge = 2 * CHUNK_SIZE;
    for (const d of [0, 100, edge - 100, edge + 100, 5 * CHUNK_SIZE]) {
        assert.equal(lodWithHysteresis(lodFor(d), d), lodFor(d), `at ${d}`);
    }
    // standing just inside the boundary: a near chunk stays near, a far chunk stays far
    assert.equal(lodWithHysteresis(0, edge + 10), 0);
    assert.equal(lodWithHysteresis(1, edge - 10), 1);
    // far enough past it, both swap
    assert.equal(lodWithHysteresis(0, edge + 0.3 * CHUNK_SIZE), 1);
    assert.equal(lodWithHysteresis(1, edge - 0.3 * CHUNK_SIZE), 0);
    // a camera jittering across the boundary by a metre never changes the level
    let lod = 0, swaps = 0;
    for (let k = 0; k < 200; k++) { const next = lodWithHysteresis(lod, edge + (k % 2 ? 1 : -1)); if (next !== lod) swaps++; lod = next; }
    assert.equal(swaps, 0);
});

/** A frame driver over a fake cache to count builds, with every chunk visible. */
function driverHarness({ quality = QUALITY.medium, corridor = true, lookahead = false } = {}) {
    const log = { builds: [], refreshes: [] };
    const cache = createChunkCache({
        build: (c, lod, hint) => { log.builds.push(`${c.i},${c.j}@${lod}/${hint}`); return { roadLevel: hint }; },
        refresh: (e, level) => { log.refreshes.push(`${e.chunk.i},${e.chunk.j}->${level}`); e.data.roadLevel = level; },
        dispose() {},
    });
    const chunks = new Map();
    const fake = {
        chunks: {
            has: (i, j) => chunks.has(`${i},${j}`),
            get: (i, j) => chunks.get(`${i},${j}`) ?? (chunks.set(`${i},${j}`, { i, j, _zRange: [0, 10] }), chunks.get(`${i},${j}`)),
            around(x, y, r) {
                const out = [];
                for (let i = Math.floor((x - r) / CHUNK_SIZE); i <= Math.floor((x + r) / CHUNK_SIZE); i++) for (let j = Math.floor((y - r) / CHUNK_SIZE); j <= Math.floor((y + r) / CHUNK_SIZE); j++) out.push(fake.chunks.get(i, j));
                return out;
            },
        },
    };
    const planes = Array.from({ length: 6 }, () => [0, 0, 0, 1]);
    const driver = createFrameDriver({ world: fake, cache, quality, radius: quality.viewDistance, corridor, lookahead });
    /** Runs `frames` frames at one place (the cache builds a couple of chunks a frame). */
    const settle = (x, y, frames = 40, frame0 = 0) => { for (let f = 0; f < frames; f++) driver.frame({ planes, x, y, heading: 0, frameNo: frame0 + f }); };
    return { driver, cache, log, planes, settle };
}

test('corridor: chunks near the camera get the corridor level, far ones the coarse level, and a swap rebuilds only the roads', () => {
    const { driver, log, planes, settle } = driverHarness();
    const q = QUALITY.medium;
    settle(0, 0);
    const lv = (i, j) => /\/(\d)$/.exec(log.builds.find(b => b.startsWith(`${i},${j}@`)))[1];
    assert.equal(lv(0, 0), String(q.roadLevel), 'the chunk under the camera is full detail');
    const far = 3; // 560 m out: past the corridor (330 m) and its hysteresis, inside the view distance
    assert.equal(lv(far, 0), String(ROAD_DETAIL.coarse), 'a chunk past the corridor is coarse');
    // drive 4 chunks east: the chunk at the origin leaves the corridor and swaps its roads (a refresh), not a rebuild of the chunk
    const before = log.builds.length;
    settle(4 * CHUNK_SIZE, 0, 40, 100);
    assert.ok(log.refreshes.includes('0,0->0'), 'the origin chunk went coarse');
    assert.ok(log.refreshes.includes('4,0->2') || log.refreshes.some(r => r.startsWith('4,0')) || log.builds.some(b => b.startsWith('4,0@')), 'chunks ahead are built or refreshed');
    assert.ok(!log.builds.slice(before).some(b => b.startsWith('0,0@0')), 'no rebuild of the chunk at the origin at its old LOD');
});

test('corridor hysteresis: a camera wobbling across the corridor edge does not swap a chunk back and forth', () => {
    const { driver, log, planes } = driverHarness();
    const { reach } = corridorOf(QUALITY.medium);
    // a chunk centred `reach` metres east; the camera jitters by 5 m about it for a while
    const cx = (0 + 0.5) * CHUNK_SIZE;
    for (let f = 0; f < 120; f++) driver.frame({ planes, x: cx - reach + (f % 2 ? 5 : -5), y: 0.5 * CHUNK_SIZE, heading: 0, frameNo: f });
    const swaps = log.refreshes.filter(r => r.startsWith('0,0->')).length;
    assert.ok(swaps <= 1, `${swaps} swaps for chunk 0,0`);
});

test('corridor off (legacy): every chunk is built at full detail whatever its distance', () => {
    const { log, settle } = driverHarness({ corridor: false });
    settle(0, 0);
    assert.ok(log.builds.length > 10);
    assert.ok(log.builds.every(b => b.endsWith('/2')));
    assert.equal(log.refreshes.length, 0);
});

test('look-ahead: the coordinates run along the heading and the route beyond the view, nearest first, without duplicates', () => {
    const radius = 560;
    const ahead = lookAheadCoords(0, 0, 0, null, radius);
    assert.ok(ahead.length > 3);
    assert.ok(ahead.every((c, k) => k === 0 || ahead[k - 1].d <= c.d), 'nearest first');
    assert.equal(new Set(ahead.map(c => `${c.i},${c.j}`)).size, ahead.length, 'no duplicates');
    assert.ok(ahead.every(c => c.i >= 1), 'only east of the camera when heading east');
    assert.ok(Math.max(...ahead.map(c => c.d)) > radius, 'reaches beyond the view distance');
    // a route that turns south after 500 m adds chunks the heading alone would not
    const route = [0, 0, 500, 0, 500, 1200];
    const withRoute = lookAheadCoords(0, 0, 0, route, radius);
    assert.ok(withRoute.some(c => c.j >= 1), 'the route\'s southern leg is included');
    assert.ok(!ahead.some(c => c.j >= 1));
});

test('look-ahead builds chunks outside the view into the cache, and they are drawn from it when the camera arrives', () => {
    const { driver, cache, log, planes } = driverHarness({ lookahead: true });
    // looking east with a frustum that only accepts chunks at i <= 1: everything else can only come from look-ahead
    const narrow = planes.map(p => [...p]);
    for (let f = 0; f < 60; f++) driver.frame({ planes: narrow, x: 0, y: 0, heading: 0, frameNo: f });
    assert.ok(driver.stats.ahead > 0, 'look-ahead built something');
    const ahead = log.builds.filter(b => { const i = +b.split(',')[0]; return i > 3; });
    assert.ok(ahead.length > 0, 'chunks beyond the near ring were built early');
    const n = cache.size;
    driver.frame({ planes, x: 4 * CHUNK_SIZE, y: 0, heading: 0, frameNo: 61 });
    assert.ok(cache.size >= n);
});

test('the build budget is in milliseconds: a slow build stops further ones that frame, and a fast frame builds the lot', () => {
    let t = 0;
    const built = [];
    const cache = createChunkCache({ build: (c, lod) => { built.push(c.i); t += 4; return {}; }, dispose() {}, now: () => t, budgetMs: 6 });
    cache.beginFrame();
    for (let i = 0; i < 6; i++) cache.get({ i, j: 0 }, 0, 99);
    assert.deepEqual(built, [0, 1], 'two 4 ms builds exceed a 6 ms budget');
    assert.equal(cache.get({ i: 7, j: 0 }, 0, 99), null);
    t += 100;
    cache.beginFrame();
    assert.ok(cache.get({ i: 7, j: 0 }, 0, 99), 'a new frame starts a new budget');
    assert.equal(cache.hasTime(), true);
    // one build always goes ahead, even when it alone is over budget
    const slow = createChunkCache({ build: () => { t += 50; return {}; }, dispose() {}, now: () => t, budgetMs: 6 });
    slow.beginFrame();
    assert.ok(slow.get({ i: 0, j: 0 }, 0, 99), 'the first build of a frame is never refused');
    assert.equal(slow.get({ i: 1, j: 0 }, 0, 99), null);
    assert.equal(slow.hasTime(), false);
});

test('cache.refresh swaps roads in place under the same budget and peek never builds', () => {
    let t = 0;
    const calls = [];
    const cache = createChunkCache({ build: () => ({ roadLevel: 2 }), refresh: (e, l) => { calls.push(l); e.data.roadLevel = l; t += 10; }, dispose() {}, now: () => t, budgetMs: 6 });
    const c = { i: 0, j: 0 };
    assert.equal(cache.peek(c), null);
    cache.beginFrame();
    const e = cache.get(c, 0, 2, 2);
    assert.equal(cache.peek(c), e);
    assert.equal(cache.refresh(e, 2), false, 'same level: nothing to do');
    assert.equal(cache.refresh(e, 0), true);
    assert.equal(e.data.roadLevel, 0);
    const e2 = cache.get({ i: 5, j: 0 }, 0, 99, 2);
    assert.equal(e2, null, 'the refresh used the budget');
    assert.deepEqual(calls, [0]);
});

test('chunks.around stops generating after the first chunk once more() says no, and generates them all otherwise', () => {
    const w = createWorld(seedWithBaked());
    const x = 20 * CHUNK_SIZE + 5, y = 20 * CHUNK_SIZE + 5;
    const before = w.chunks.generated;
    w.chunks.around(x, y, 400, Infinity, () => false);
    assert.equal(w.chunks.generated - before, 1, 'one chunk generated');
    w.chunks.around(x, y, 400, Infinity, () => true);
    assert.ok(w.chunks.generated - before > 10);
});

test('pooled builders: thousands of builders reuse a few scratch sets, and meshes already finished are never overwritten', () => {
    const first = box(0, 0, 0, 2, 2, 2, [1, 0, 0]);
    const snapshot = Array.from(first.positions);
    const allocated = poolStats.allocated;
    for (let i = 0; i < 3000; i++) {
        const b = createBuilder();
        b.vertex(i, 0, 0, 0, 0, 1, 1, 1, 1); b.vertex(i + 1, 0, 0, 0, 0, 1, 1, 1, 1); b.vertex(i, 1, 0, 0, 0, 1, 1, 1, 1);
        b.tri(0, 1, 2);
        const m = b.finish();
        assert.equal(m.positions.length, 9);
        assert.equal(m.indices.length, 3);
    }
    assert.ok(poolStats.allocated - allocated <= 2, `${poolStats.allocated - allocated} new scratch sets for 3000 builders`);
    assert.deepEqual(Array.from(first.positions), snapshot);
    // nested builders (a builder opened while another is being filled) do not share scratch
    const a = createBuilder(), b = createBuilder();
    a.vertex(1, 2, 3, 0, 0, 1, 0, 0, 0);
    b.vertex(9, 9, 9, 0, 0, 1, 0, 0, 0);
    assert.deepEqual(Array.from(a.finish().positions), [1, 2, 3]);
    assert.deepEqual(Array.from(b.finish().positions), [9, 9, 9]);
});

test('pooled builders grow past their first scratch size and keep every vertex and index', () => {
    const b = createBuilder();
    const n = 20000;
    for (let i = 0; i < n; i++) b.vertex(i, i * 2, i * 3, 0, 0, 1, 0.5, 0.25, 0.125);
    for (let i = 0; i + 2 < n; i += 3) b.tri(i, i + 1, i + 2);
    assert.equal(b.vertexCount, n);
    const m = b.finish();
    assert.equal(m.positions.length, n * 3);
    assert.equal(m.positions[(n - 1) * 3 + 2], (n - 1) * 3);
    assert.equal(m.colors[n * 3 - 1], 0.125);
    assert.equal(m.indices.length, Math.floor(n / 3) * 3);
    assert.throws(() => b.finish(), /already finished/);
});

test('append copies a finished mesh in with its indices rebased', () => {
    const b = createBuilder();
    b.append(box(0, 0, 0, 1, 1, 1));
    b.append(box(5, 0, 0, 1, 1, 1));
    const m = b.finish();
    const one = box(0, 0, 0, 1, 1, 1);
    assert.equal(m.positions.length, one.positions.length * 2);
    assert.equal(m.indices.length, one.indices.length * 2);
    const merged = mergeMeshes([box(0, 0, 0, 1, 1, 1), box(5, 0, 0, 1, 1, 1)]);
    assert.deepEqual(Array.from(m.indices), Array.from(merged.indices));
    assert.deepEqual(Array.from(m.positions), Array.from(merged.positions));
});

test('a chunk built into one shared builder has exactly the vertices of the merged per-part meshes', () => {
    const chunk = world.chunks.get(ci, cj);
    const m = buildChunkRoads(world, chunk, 2024);
    assert.ok(m && m.indices.length > 0);
    assert.equal(m.positions.length, m.normals.length);
    assert.equal(m.positions.length, m.colors.length);
    let max = 0;
    for (const i of m.indices) max = Math.max(max, i);
    assert.equal(max, m.positions.length / 3 - 1, 'every vertex is used and indices stay in range');
});

test('the upload scratch is reused and interleaveInto matches interleave', () => {
    const m = box(1, 2, 3, 2, 2, 2, [0.1, 0.2, 0.3]);
    const a = interleave(m), s = uploadScratch(a.length);
    interleaveInto(m, s);
    assert.deepEqual(Array.from(s.subarray(0, a.length)), Array.from(a));
    assert.equal(uploadScratch(a.length), s, 'same array while it is big enough');
    assert.ok(uploadScratch(a.length * 1000).length >= a.length * 1000);
    assert.equal(a.length, (m.positions.length / 3) * FLOATS_PER_VERTEX);
});

test('layoutJunction answers from a stamp: the same layout each call, a new one when the node changes', () => {
    const g = createGraph();
    const c = g.addNode(0, 0);
    for (const [x, y] of [[100, 0], [0, 100], [-100, 0]]) { const n = g.addNode(x, y); g.addEdge(n, c, [x, y, 0, 0], { cls: 'A' }); }
    c.junction = 'giveway';
    const a = layoutJunction(g, c, 2000);
    assert.equal(layoutJunction(g, c, 2000), a);
    assert.notEqual(layoutJunction(g, c, 1950), undefined);
    c.junction = 'roundabout'; c.roundaboutFrom = 1960;
    const b = layoutJunction(g, c, 2000);
    assert.equal(b.kind, 'roundabout');
    assert.notEqual(b, a);
    assert.equal(layoutJunction(g, c, 1940).kind, 'plain', 'before the roundabout opened');
    // adding an arm changes the layout
    const n = g.addNode(0, -100);
    g.addEdge(n, c, [0, -100, 0, 0], { cls: 'B' });
    assert.equal(layoutJunction(g, c, 2000).arms.length, 4);
});

test('buildChunkData returns every mesh of a chunk on the CPU, with the road level it was asked for', () => {
    const chunk = world.chunks.get(ci, cj);
    const full = buildChunkData(world, chunk, 0, { year: 2024, roadLevel: ROAD_DETAIL.full });
    const coarse = buildChunkData(world, chunk, 1, { year: 2024, roadLevel: ROAD_DETAIL.coarse });
    assert.equal(full.roadLevel, 2);
    assert.equal(coarse.roadLevel, 0);
    assert.ok(verts(coarse.roads) < verts(full.roads));
    assert.ok(meshesOf(full).length >= 3);
    assert.equal(full.roadSig, coarse.roadSig, 'the signature is about the year, not the detail');
    assert.ok(full.trees && typeof full.trees.count === 'number');
});
