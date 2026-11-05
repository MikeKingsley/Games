import test from 'node:test';
import { seedWithBaked } from './helpers/delivery-seed.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorld } from '../../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { roadHeightAt, groundZ } from '../../Games.Client/wwwroot/games/delivery-driver/world/terrain.js';
import { waterAt } from '../../Games.Client/wwwroot/games/delivery-driver/world/region.js';
import { edgeWidth, edgeClass, ROAD_CLASS, LANE_WIDTH } from '../../Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js';
import * as R from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/road-mesh.js';
import * as M from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/meshes.js';

const world = createWorld(seedWithBaked());
const { graph, region } = world;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const colourOf = (mesh, rgb, eps = 1e-3) => {
    let n = 0;
    for (let i = 0; i < M.vertexCount(mesh); i++) if ([0, 1, 2].every(k => Math.abs(mesh.colors[i * 3 + k] - rgb[k]) < eps)) n++;
    return n;
};
const firstEdge = pred => graph.edges.find(pred);

test('every open edge builds a mesh whose road vertices follow the graded profile (+ layer bias)', () => {
    // straight-ish edges only: the nearest-sample match below is ambiguous on edges that double back on themselves
    const straight = e => Math.hypot(e.pts[e.pts.length - 2] - e.pts[0], e.pts[e.pts.length - 1] - e.pts[1]) > 0.97 * e.len;
    const roadEdges = graph.edges.filter(e => e.cls === 'A' && e.len > 100 && straight(e) && !e.bridge).slice(0, 12);
    assert.ok(roadEdges.length > 5);
    for (const e of roadEdges) {
        const mesh = R.buildEdgeMesh(world, e, 2000);
        assert.ok(mesh && M.triangleCount(mesh) > 0);
        const surface = R.roadColours(2000).surface;
        for (let i = 0; i < M.vertexCount(mesh); i++) {
            if (![0, 1, 2].every(k => Math.abs(mesh.colors[i * 3 + k] - surface[k]) < 1e-4)) continue;
            // find the along-distance of this vertex from its nearest sample and compare the height there
            const x = mesh.positions[i * 3], y = mesh.positions[i * 3 + 1], z = mesh.positions[i * 3 + 2];
            let best = Infinity, bz = 0;
            for (const s of R.edgeSamples(e)) {
                const d = Math.hypot(s.x - x, s.y - y);
                if (d < best) { best = d; bz = roadHeightAt(e, s.d); }
            }
            near(z, bz + R.LAYER.surface, 1e-4);
        }
    }
});

test('road width: the surface strip is the class width, the kerb strip 1.6 m wider', () => {
    const e = firstEdge(x => x.cls === 'A' && x.len > 60);
    const mesh = R.buildEdgeMesh(world, e, 2000);
    const col = R.roadColours(2000);
    const widthOf = rgb => {
        // vertices come in left/right pairs along the strip
        const idx = [];
        for (let i = 0; i < M.vertexCount(mesh); i++) if ([0, 1, 2].every(k => Math.abs(mesh.colors[i * 3 + k] - rgb[k]) < 1e-4)) idx.push(i);
        const a = idx[0], b = idx[1];
        return Math.hypot(mesh.positions[a * 3] - mesh.positions[b * 3], mesh.positions[a * 3 + 1] - mesh.positions[b * 3 + 1]);
    };
    near(widthOf(col.surface), edgeWidth(e, 2000), 1e-3);
    near(widthOf(col.kerb), edgeWidth(e, 2000) + 1.6, 1e-3);
});

test('every triangle faces up (the winding convention holds for roads, junctions and bridges)', () => {
    const edges = [firstEdge(e => e.cls === 'A'), firstEdge(e => e.zBridges?.length && e.cls !== 'ferry'), firstEdge(e => e.cls === 'M')];
    for (const e of edges) {
        const mesh = R.buildEdgeMesh(world, e, 2000);
        const p = mesh.positions, n = mesh.normals;
        for (let t = 0; t < mesh.indices.length; t += 3) {
            const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]];
            const e1 = [0, 1, 2].map(k => p[b * 3 + k] - p[a * 3 + k]), e2 = [0, 1, 2].map(k => p[c * 3 + k] - p[a * 3 + k]);
            const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
            const dot = [0, 1, 2].reduce((s, k) => s + cr[k] * (n[a * 3 + k] + n[b * 3 + k] + n[c * 3 + k]), 0);
            assert.ok(dot >= -1e-9);
        }
    }
});

test('era: surfaces, markings and closures follow the year', () => {
    const e = firstEdge(x => x.cls === 'A' && x.len > 80 && (x.opened ?? 0) < 1919);
    const early = R.buildEdgeMesh(world, e, 1919), late = R.buildEdgeMesh(world, e, 2000), mid = R.buildEdgeMesh(world, e, 1935);
    assert.equal(colourOf(early, R.roadColours(1919).surface), colourOf(early, R.roadColours(1919).surface));
    assert.ok(colourOf(early, R.roadColours(1919).surface) > 0);
    assert.equal(R.roadColours(1919).centre, null, 'no lines before 1926');
    assert.ok(colourOf(mid, R.roadColours(1935).centre) > 0, 'dashed centre line from 1926');
    assert.ok(R.roadColours(2000).edge && colourOf(late, R.roadColours(2000).edge) > 0, 'edge lines from 1970');
    assert.equal(colourOf(mid, R.roadColours(1935).edge ?? [9, 9, 9]), 0, 'no edge lines in 1935');
    assert.ok(M.triangleCount(late) > M.triangleCount(early), 'later roads carry more markings');
    // closed or not yet opened edges build nothing
    const closed = firstEdge(x => x.closed != null && x.closed < Infinity);
    if (closed) assert.equal(R.buildEdgeMesh(world, closed, closed.closed + 1), null);
    const later = firstEdge(x => (x.opened ?? 0) > 1950);
    if (later) assert.equal(R.buildEdgeMesh(world, later, 1920), null);
});

test('roadKey changes exactly when an edge is upgraded, closed or opened', () => {
    const up = firstEdge(x => x.upgrades?.length);
    assert.ok(up, 'the seed has an upgraded road');
    const years = [1919, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000];
    const keys = years.map(y => R.roadKey(up, y));
    assert.ok(new Set(keys).size > 1, 'an upgraded road changes key at some point');
    const plain = firstEdge(x => x.cls === 'B' && !x.upgrades?.length && (x.opened ?? 0) === 0 && (x.closed ?? Infinity) === Infinity);
    assert.equal(new Set(years.map(y => R.roadKey(plain, y))).size, 1);
});

test('dual carriageways and motorways get a central reservation and lane dividers', () => {
    const e = firstEdge(x => x.cls === 'M' && x.len > 80 && !x.link && !x.bridge);
    const mesh = R.buildEdgeMesh(world, e, 2000);
    const col = R.roadColours(2000);
    assert.ok(colourOf(mesh, col.reservation.M) > 0, 'motorway reservation');
    assert.ok(colourOf(mesh, col.centre) > 0, 'lane dividers');
    const lanes = ROAD_CLASS.M.lanes;
    assert.ok(ROAD_CLASS.M.width - 2 * lanes * LANE_WIDTH > 0);
    assert.equal(edgeClass(e, 2000), 'M');
});

test('lanes and yard accesses have no markings; a lane keeps its own surface colour', () => {
    const lane = firstEdge(x => x.cls === 'lane' && x.len > 40);
    const mesh = R.buildEdgeMesh(world, lane, 1940);
    assert.equal(colourOf(mesh, R.roadColours(1940).centre), 0);
    assert.ok(colourOf(mesh, R.roadColours(1940).lane) > 0);
});

test('wet roads are darker', () => {
    const e = firstEdge(x => x.cls === 'A' && x.len > 60);
    const dry = R.roadColours(2000).surface, wet = R.roadColours(2000, true).surface;
    for (let k = 0; k < 3; k++) assert.ok(wet[k] < dry[k]);
    assert.ok(colourOf(R.buildEdgeMesh(world, e, 2000, { wet: true }), wet) > 0);
});

test('bridges: parapets, a slab and piers sit on the deck stretch; the deck itself is straight', () => {
    const e = firstEdge(x => x.zBridges?.length && x.cls !== 'ferry' && x.len > 60 && !x.opened && x.spans?.some(sp => sp.type === 'bridge' && sp.to - sp.from > 20));
    const plain = firstEdge(x => x.cls === x.cls && !x.zBridges?.length && x.cls === 'A' && x.len > 100);
    const mesh = R.buildEdgeMesh(world, e, 2000);
    const stone = colourOf(mesh, R.BRIDGE.concrete) + colourOf(mesh, R.BRIDGE.stone);
    assert.ok(stone > 0, 'parapets');
    assert.ok(colourOf(mesh, R.BRIDGE.under) > 0, 'slab and piers');
    assert.equal(colourOf(R.buildEdgeMesh(world, plain, 2000), R.BRIDGE.under), 0, 'no bridge parts on a plain road');
    // parapets stand about a metre above the deck, piers reach below the bed's water
    const bb = M.meshBounds(mesh);
    const zs = R.edgeSamples(e).map(s => s.z);
    assert.ok(bb.max[2] >= Math.min(...zs) + R.BRIDGE.parapet - 0.01);
    assert.ok(bb.min[2] < Math.min(...zs) - 0.5, 'piers drop below the deck');
    // the deck run is straight between the abutments
    const [ia, ib] = e.zBridges[0];
    const mid = Math.round((ia + ib) / 2);
    near(e.z[mid], e.z[ia] + ((e.z[ib] - e.z[ia]) * (mid - ia)) / (ib - ia), 1e-3);
});

test('ferries: dry approaches are road, the crossing is a dashed route on the water; a closed ferry is nothing', () => {
    // the Dartmouth crossing is dry in the baked coast (the Dart is not in it), so take an open ferry that crosses water
    const open = graph.edges.find(e => e.cls === 'ferry' && e.closed === Infinity && waterAt(world.region, (e.pts[0] + e.pts[e.pts.length - 2]) / 2, (e.pts[1] + e.pts[e.pts.length - 1]) / 2));
    assert.ok(open);
    const mesh = R.buildEdgeMesh(world, open, 2000);
    assert.ok(mesh && colourOf(mesh, [0xd8 / 255, 0xe6 / 255, 0xef / 255], 2e-3) > 0, 'dashes in the water colour');
    const gone = graph.edges.find(e => e.cls === 'ferry' && e.closed < 2000);
    if (gone) assert.equal(R.buildEdgeMesh(world, gone, 2000), null);
});

test('junctions: roundabouts get an island above the node, ordinary nodes with 3+ roads a patch, dead ends nothing', () => {
    const ra = graph.nodes.find(n => n.junction === 'roundabout');
    const mesh = R.buildNodeMesh(world, ra, 2020);
    assert.ok(mesh);
    const bb = M.meshBounds(mesh);
    assert.ok(bb.max[2] >= ra.z + R.LAYER.junction + 0.2);
    near((bb.min[0] + bb.max[0]) / 2, ra.x, 0.5);
    // before its year it is a plain give-way: no island
    const early = R.buildNodeMesh(world, ra, 1919);
    if (early) assert.ok(M.triangleCount(early) < M.triangleCount(mesh));
    const tee = graph.nodes.find(n => n.edges.length >= 3 && n.junction !== 'roundabout');
    assert.ok(R.buildNodeMesh(world, tee, 2000));
    const dead = graph.nodes.find(n => n.edges.length === 1);
    assert.equal(R.buildNodeMesh(world, dead, 2000), null);
});

test('yards: the pad sits just above the levelled ground and the bay box has the marked size', () => {
    const owner = world.depots[0];
    const pad = R.buildYardMesh(world, owner.yard);
    const bb = M.meshBounds(pad);
    const zone = owner.yard.zone;
    near(bb.min[2], groundZ(world, zone.x, zone.y) + R.LAYER.kerb, 0.05);
    const bay = R.buildBayMesh(world, owner.yard.marker);
    const b2 = M.meshBounds(bay);
    assert.ok(Math.max(b2.max[0] - b2.min[0], b2.max[1] - b2.min[1]) < 8.2);
    assert.ok(colourOf(R.buildBayMesh(world, owner.yard.marker, { active: true }), R.MARK.bay) > 0, 'active bay is highlighted');
    assert.equal(colourOf(bay, R.MARK.bay), 0);
});

test('practice yard and harbour quay build', () => {
    if (world.practice) assert.ok(M.triangleCount(R.buildPracticeMesh(world, world.practice, 1)) > 20);
    const h = world.harbours[0];
    if (h) assert.ok(M.triangleCount(R.buildQuayMesh(world, h)) >= 10);
});

test('building every edge in the region takes well under a second and stays within a vertex budget', () => {
    const t = Date.now();
    let tris = 0, built = 0;
    for (const e of graph.edges) {
        const m = R.buildEdgeMesh(world, e, 2000);
        if (m) { tris += M.triangleCount(m); built++; }
    }
    assert.ok(built > 1000);
    assert.ok(Date.now() - t < 3000, `took ${Date.now() - t} ms`);
    assert.ok(tris / built < 600, `${(tris / built) | 0} triangles per edge on average`);
    void region;
});

import { buildChunkRoads, edgeWindows } from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/road-mesh.js';
import { CHUNK_SIZE } from '../../Games.Client/wwwroot/games/delivery-driver/config.js';

test('chunk roads: the chunks\' windows tile every edge exactly, and the merge keeps the counts', () => {
    const exeter = region.townById.get('exeter');
    const ci = Math.floor(exeter.x / CHUNK_SIZE), cj = Math.floor(exeter.y / CHUNK_SIZE);
    let total = 0, edges = 0;
    const covered = new Map();
    for (let i = ci - 2; i <= ci + 2; i++) {
        for (let j = cj - 2; j <= cj + 2; j++) {
            const chunk = world.chunks.get(i, j), keys = {};
            const m = buildChunkRoads(world, chunk, 2000, { keys });
            if (m) total += M.triangleCount(m);
            for (const id of Object.keys(keys)) for (const [d0, d1] of edgeWindows(graph.edges[id], chunk)) {
                (covered.get(id) ?? covered.set(id, []).get(id)).push([d0, d1]);
            }
        }
    }
    // an edge lying wholly inside the 5 x 5 block is tiled with no gap and no overlap
    for (const [id, list] of covered) {
        const e = graph.edges[id];
        const inBlock = [0, e.pts.length - 2].every(k => Math.abs(Math.floor(e.pts[k] / CHUNK_SIZE) - ci) <= 1 && Math.abs(Math.floor(e.pts[k + 1] / CHUNK_SIZE) - cj) <= 1);
        if (!inBlock) continue;
        edges++;
        list.sort((p, q) => p[0] - q[0]);
        assert.ok(Math.abs(list[0][0]) < 1e-6 && Math.abs(list.at(-1)[1] - e.len) < 1e-6, `edge ${id} covered end to end`);
        for (let k = 1; k < list.length; k++) assert.ok(Math.abs(list[k][0] - list[k - 1][1]) < 1e-6, `edge ${id} has no gap or overlap`);
    }
    assert.ok(edges > 10);
    assert.ok(total > 1000);
});

test('chunk roads: the depot chunk includes the yard pad and the practice chunk the practice yard', () => {
    const depot = world.depots[0], z = depot.yard.zone;
    const chunk = world.chunks.get(Math.floor(z.x / CHUNK_SIZE), Math.floor(z.y / CHUNK_SIZE));
    const m = buildChunkRoads(world, chunk, 2000);
    assert.ok(colourOf(m, R.MARK.yard) > 0, 'yard pad colour present');
    const pz = world.practice.yard.zone;
    const pc = world.chunks.get(Math.floor(pz.x / CHUNK_SIZE), Math.floor(pz.y / CHUNK_SIZE));
    assert.ok(colourOf(buildChunkRoads(world, pc, 2000), R.MARK.practice) > 0);
});

import { chunkRoadSignature, eraOf, ERA_YEARS } from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/road-mesh.js';

test('eraOf steps exactly at the years roads change their look', () => {
    assert.equal(eraOf(1919), 0);
    for (let i = 0; i < ERA_YEARS.length; i++) {
        assert.equal(eraOf(ERA_YEARS[i] - 1), i);
        assert.equal(eraOf(ERA_YEARS[i]), i + 1);
    }
    assert.equal(eraOf(2100), ERA_YEARS.length);
});

test('road signature: constant within an era, changing at era years and when the wet flag flips', () => {
    // a chunk whose roads never change in the game (no openings, closings or upgrades), so only the era styling varies
    const plainEdge = x => !x.upgrades?.length && (x.opened ?? 0) === 0 && (x.closed ?? Infinity) === Infinity;
    let chunk = null;
    for (const e of graph.edges) {
        if (e.cls !== 'B' || !plainEdge(e) || e.len < 100) continue;
        const mid = e.pts.length / 4 | 0;
        const c = world.chunks.get(Math.floor(e.pts[mid * 2] / CHUNK_SIZE), Math.floor(e.pts[mid * 2 + 1] / CHUNK_SIZE));
        if (c.edges.every(id => plainEdge(graph.edges[id]))) { chunk = c; break; }
    }
    assert.ok(chunk, 'a chunk of unchanging B roads');
    const sig = y => chunkRoadSignature(world, chunk, y);
    assert.equal(sig(1919), sig(1925));
    assert.notEqual(sig(1925), sig(1926));
    assert.equal(sig(1926), sig(1934));
    assert.notEqual(sig(1934), sig(1935));
    assert.equal(sig(1971), sig(2030));
    assert.notEqual(chunkRoadSignature(world, chunk, 2000, true), chunkRoadSignature(world, chunk, 2000, false));
});

test('road signature: an upgrade, closure or opening changes only the chunk that owns the edge', () => {
    const up = graph.edges.find(x => x.upgrades?.length);
    const u = up.upgrades[0];
    const owner = world.chunks.get(...ownerOf(up));
    const other = world.chunks.get(owner.i + 6, owner.j + 6);
    // pick two years in the same era either side of the upgrade
    const before = Math.max(u.year - 1, 1919), after = u.year;
    const era = eraOf(before) === eraOf(after);
    if (era) assert.notEqual(chunkRoadSignature(world, owner, before), chunkRoadSignature(world, owner, after), 'the upgraded edge changes its chunk');
    assert.equal(chunkRoadSignature(world, other, before), chunkRoadSignature(world, other, after), 'a distant chunk is untouched');

    const closed = graph.edges.find(x => (x.closed ?? Infinity) < Infinity && x.cls !== 'ferry');
    if (closed) {
        const oc = world.chunks.get(...ownerOf(closed));
        assert.notEqual(chunkRoadSignature(world, oc, closed.closed - 1), chunkRoadSignature(world, oc, closed.closed + 1) , 'closure');
    }
});

function ownerOf(edge) {
    const p = edge.pts, k = (p.length / 4 | 0) * 2;
    // the middle of the edge by arc length lives in exactly one chunk
    const mid = { x: 0, y: 0 };
    let d = edge.len / 2;
    for (let i = 0; i < p.length - 2; i += 2) {
        const l = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
        if (d <= l) { mid.x = p[i] + (p[i + 2] - p[i]) * d / l; mid.y = p[i + 1] + (p[i + 3] - p[i + 1]) * d / l; break; }
        d -= l;
    }
    void k;
    return [Math.floor(mid.x / CHUNK_SIZE), Math.floor(mid.y / CHUNK_SIZE)];
}

test('junction patches stay within reach of their arms and have no NaN', () => {
    const nodes = graph.nodes.filter(n => n.edges.length >= 3 && n.z !== undefined && n.junction !== 'roundabout').slice(0, 60);
    assert.ok(nodes.length > 20);
    for (const n of nodes) {
        const mesh = R.buildNodeMesh(world, n, 2000);
        if (!mesh) continue;
        assert.ok(M.triangleCount(mesh) >= 3);
        const reach = R.junctionRadius(graph, n, 2000) * 3;
        for (let i = 0; i < M.vertexCount(mesh); i++) {
            const x = mesh.positions[i * 3], y = mesh.positions[i * 3 + 1];
            assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(mesh.positions[i * 3 + 2]));
            assert.ok(Math.hypot(x - n.x, y - n.y) <= reach + 1, 'corner reaches no further than the junction radius allows');
        }
    }
});

test('markings stop short of a junction patch', () => {
    const n = graph.nodes.find(x => x.edges.length >= 3 && x.z !== undefined && x.junction !== 'roundabout' && graph.edges[x.edges[0]].cls === 'A' && graph.edges[x.edges[0]].len > 60);
    assert.ok(n, 'a junction on a long A road');
    const e = graph.edges[n.edges[0]];
    const mesh = R.buildEdgeMesh(world, e, 2000);
    const mark = R.roadColours(2000).centre;
    const radius = R.junctionRadius(graph, n, 2000);
    for (let i = 0; i < M.vertexCount(mesh); i++) {
        if (![0, 1, 2].every(k => Math.abs(mesh.colors[i * 3 + k] - mark[k]) < 1e-4)) continue;
        assert.ok(Math.hypot(mesh.positions[i * 3] - n.x, mesh.positions[i * 3 + 1] - n.y) >= radius - 1.5, 'centre line starts outside the patch');
    }
});

test('the route ribbon and drop ring are finite, lie on the ground and use the self-lit colour', async () => {
    const P = await import('../../Games.Client/wwwroot/games/delivery-driver/render/gl/prop-mesh.js');
    const e = graph.edges.find(x => x.cls === 'A' && x.len > 100);
    const flat = [...e.pts];
    const mesh = P.buildRouteMesh(world, flat, flat[0], flat[1]);
    assert.ok(mesh && M.triangleCount(mesh) > 0);
    for (let i = 0; i < M.vertexCount(mesh); i++) {
        assert.ok(Number.isFinite(mesh.positions[i * 3 + 2]));
        assert.ok(mesh.colors[i * 3] < 0 && mesh.colors[i * 3 + 2] < 0, 'negative red and blue marks a self-lit surface');
        near(mesh.positions[i * 3 + 2] - groundZ(world, mesh.positions[i * 3], mesh.positions[i * 3 + 1]), 0.2, 0.5);
    }
    assert.equal(P.buildRouteMesh(world, flat, flat[0] + 1e6, flat[1]), null, 'nothing is built for a route far from the player');
    const ring = P.buildDynamicProps(world, { rings: [{ x: flat[0], y: flat[1], ok: true }] });
    assert.ok(ring && M.triangleCount(ring) > 20);
});

// ---- Phase 10: pavements, verges, stop lines, zebras, bends, splitter islands, kerb returns ------------------------

const insideRoad = (mesh, e, rgb, pad = 0.2) => {
    // every vertex of this colour lies within the carriageway (plus pad) of the edge
    for (let i = 0; i < M.vertexCount(mesh); i++) {
        if (![0, 1, 2].every(k => Math.abs(mesh.colors[i * 3 + k] - rgb[k]) < 1e-3)) continue;
        let d = Infinity;
        for (const s of R.edgeSamples(e, 1)) d = Math.min(d, Math.hypot(s.x - mesh.positions[i * 3], s.y - mesh.positions[i * 3 + 1]));
        if (d > edgeWidth(e, 2000) / 2 + pad) return false;
    }
    return true;
};

test('pavements: town streets get them beside the kerb, lanes and country roads do not; the colour changes in 1950', () => {
    const straight = e => Math.hypot(e.pts[e.pts.length - 2] - e.pts[0], e.pts[e.pts.length - 1] - e.pts[1]) > 0.99 * e.len;
    const street = graph.edges.find(e => e.cls === 'street' && e.town && !e.bridge && !e.link && e.len > 40 && e.opened === 0 && straight(e));
    const lane = graph.edges.find(e => e.cls === 'lane' && !e.town && e.len > 40 && e.opened === 0);
    const rural = graph.edges.find(e => e.cls === 'B' && !e.town && !e.bridge && e.len > 60 && e.opened === 0);
    const c1 = R.roadColours(1930).pavement, c2 = R.roadColours(2000).pavement;
    assert.notDeepEqual(c1, c2);
    assert.ok(colourOf(R.buildEdgeMesh(world, street, 2000), c2) > 0, 'pavement on a town street');
    assert.ok(colourOf(R.buildEdgeMesh(world, street, 1930), c1) > 0);
    assert.equal(colourOf(R.buildEdgeMesh(world, lane, 2000), c2), 0, 'no pavement on a lane');
    const col = R.roadColours(2000);
    assert.equal(colourOf(R.buildEdgeMesh(world, rural, 2000), col.pavement), 0, 'no pavement on a country road');
    assert.ok(colourOf(R.buildEdgeMesh(world, rural, 2000), col.verge) > 0, 'a verge strip instead');
    // pavements lie beside the kerb, so they stay a hair above the surface and clear of the carriageway
    const m = R.buildEdgeMesh(world, street, 2000);
    for (let i = 0; i < M.vertexCount(m); i++) {
        if ([0, 1, 2].every(k => Math.abs(m.colors[i * 3 + k] - c2[k]) < 1e-3)) {
            let d = Infinity;
            for (const s of R.edgeSamples(street, 1)) d = Math.min(d, Math.hypot(s.x - m.positions[i * 3], s.y - m.positions[i * 3 + 1]));
            assert.ok(d >= edgeWidth(street, 2000) / 2 + 0.7, 'outside the carriageway and kerb strip');
        }
    }
});

test('stop lines at signals from 1935, dashed give-way lines on minor arms from 1960, roundabout arms too', () => {
    const sig = graph.nodes.find(n => n.junction === 'signals' && n.signalsFrom <= 1960 && n.z !== undefined && n.edges.length >= 3);
    const white = R.roadColours(2000).centre;
    const tri = (n, y) => { const m = R.buildNodeMesh(world, n, y); return m ? M.triangleCount(m) : 0; };
    assert.ok(tri(sig, 2000) > tri(sig, 1934), 'signals gain stop lines');
    const give = graph.nodes.find(n => n.junction === 'giveway' && n.priority && n.edges.length === 3 && n.z !== undefined && n.edges.every(id => graph.edges[id].opened === 0 && !graph.edges[id].oneway && !graph.edges[id].link));
    assert.ok(tri(give, 2000) > tri(give, 1955), 'give-way lines appear in 1960');
    const ra = graph.nodes.find(n => n.junction === 'roundabout' && n.z !== undefined && n.edges.some(id => graph.edges[id].len > 60 && !graph.edges[id].oneway));
    assert.ok(colourOf(R.buildNodeMesh(world, ra, 2020), white) > 0, 'roundabout give-way lines');
});

test('roundabouts get splitter islands on their arms; kerb returns are rounded fans', () => {
    const ra = graph.nodes.find(n => n.junction === 'roundabout' && n.edges.length >= 3 && n.z !== undefined && n.edges.every(id => graph.edges[id].len > 12));
    const withArms = M.triangleCount(R.buildNodeMesh(world, ra, 2020));
    assert.ok(withArms > 80, `roundabout mesh has ${withArms} triangles`);
    const tee = graph.nodes.find(n => n.edges.length === 3 && n.junction === 'giveway' && n.z !== undefined);
    assert.ok(M.triangleCount(R.buildNodeMesh(world, tee, 2000)) >= 12, 'three rounded corners');
});

test('zebra crossings: none before 1950, bars lie within the carriageway from 1950', () => {
    const white = R.roadColours(1955).centre;
    let found = null;
    for (const e of graph.edges) {
        if (e.cls !== 'street' && e.cls !== 'B') continue;
        if (!e.town || e.opened || e.len < 50 || e.oneway || e.bridge || e.link) continue;
        const late = R.buildEdgeMesh(world, e, 1955), early = R.buildEdgeMesh(world, e, 1949);
        if (early && late && M.triangleCount(late) - M.triangleCount(early) >= 16) { found = { e, late }; break; }
    }
    assert.ok(found, 'some street has a zebra from 1950');
    assert.ok(colourOf(found.late, white) > 0);
});

test('double white lines on the bends of A roads from 1960, none on one-way roads', () => {
    const bendy = graph.edges.find(e => e.cls === 'A' && e.opened === 0 && !e.oneway && !e.bridge && e.len > 80 && e.pts.length > 12 && !e.town);
    assert.ok(bendy);
    // the centre line of a one-way copy has nothing
    const oneway = { ...bendy, oneway: true };
    oneway._smp = bendy._smp;
    const a = R.buildEdgeMesh(world, bendy, 2000), b = R.buildEdgeMesh(world, oneway, 2000);
    assert.ok(M.triangleCount(a) > M.triangleCount(b), 'a one-way road has no centre line');
});
