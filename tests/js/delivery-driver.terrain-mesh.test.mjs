import test from 'node:test';
import { seedWithBaked } from './helpers/delivery-seed.mjs';
import assert from 'node:assert/strict';
import * as M from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/meshes.js';
import * as m4 from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/mat4.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

/** Every triangle's numeric cross product must agree with its vertex normals (the winding convention in meshes.js). */
function assertWinding(mesh, label = 'mesh') {
    const p = mesh.positions, n = mesh.normals;
    for (let t = 0; t < mesh.indices.length; t += 3) {
        const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]];
        const e1 = [0, 1, 2].map(k => p[b * 3 + k] - p[a * 3 + k]), e2 = [0, 1, 2].map(k => p[c * 3 + k] - p[a * 3 + k]);
        const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const dot = [0, 1, 2].reduce((s, k) => s + cr[k] * (n[a * 3 + k] + n[b * 3 + k] + n[c * 3 + k]), 0);
        assert.ok(dot >= -1e-12, `${label}: triangle ${t / 3} faces against its normals`);
    }
}

test('grid: counts, heights from the function, every triangle faces up', () => {
    const f = (x, y) => 3 + 0.05 * x - 0.02 * y + Math.sin(x / 7) * 0.5;
    const g = M.grid(100, -40, 60, 30, 6, 3, f);
    assert.equal(M.vertexCount(g), 7 * 4);
    assert.equal(M.triangleCount(g), 6 * 3 * 2);
    for (let i = 0; i < M.vertexCount(g); i++) near(g.positions[i * 3 + 2], f(g.positions[i * 3], g.positions[i * 3 + 1]), 1e-4);
    assertWinding(g, 'grid');
    for (let t = 0; t < g.indices.length; t += 3) {
        const [a, b, c] = [g.indices[t], g.indices[t + 1], g.indices[t + 2]];
        const e1 = [0, 1, 2].map(k => g.positions[b * 3 + k] - g.positions[a * 3 + k]), e2 = [0, 1, 2].map(k => g.positions[c * 3 + k] - g.positions[a * 3 + k]);
        assert.ok(e1[0] * e2[1] - e1[1] * e2[0] > 0, 'numeric cross z is positive: normals point up');
    }
    for (let i = 0; i < M.vertexCount(g); i++) {
        assert.ok(g.normals[i * 3 + 2] > 0.9, 'unit-ish upward normal');
        near(Math.hypot(g.normals[i * 3], g.normals[i * 3 + 1], g.normals[i * 3 + 2]), 1, 1e-5);
    }
});

test('grid: the normal tilts away from a slope (a plane rising to the east leans west)', () => {
    const g = M.grid(0, 0, 10, 10, 2, 2, x => 0.5 * x);
    assert.ok(g.normals[0] < 0 && Math.abs(g.normals[1]) < 1e-6);
});

test('grid: neighbouring grids agree on the normals along a shared edge', () => {
    const f = (x, y) => Math.sin(x * 0.3) * Math.cos(y * 0.2) * 4;
    const a = M.grid(0, 0, 10, 10, 5, 5, f), b = M.grid(10, 0, 10, 10, 5, 5, f);
    for (let j = 0; j <= 5; j++) {
        const ia = j * 6 + 5, ib = j * 6;
        for (let k = 0; k < 3; k++) near(a.normals[ia * 3 + k], b.normals[ib * 3 + k], 1e-6);
    }
});

test('box: 24 vertices, 12 triangles, exact bounds, winding follows the normals', () => {
    const b = M.box(5, 10, 2, 4, 6, 8);
    assert.equal(M.vertexCount(b), 24);
    assert.equal(M.triangleCount(b), 12);
    assert.deepEqual(M.meshBounds(b), { min: [3, 7, 2], max: [7, 13, 10] });
    assertWinding(b, 'box');
});

test('triangulate: a concave L-shape gives n-2 triangles whose areas add up to the polygon area', () => {
    const L = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 3 }, { x: 0, y: 3 }];
    const tris = M.triangulate(L);
    assert.equal(tris.length, L.length - 2);
    let area = 0;
    for (const [a, b, c] of tris) area += Math.abs((L[b].x - L[a].x) * (L[c].y - L[a].y) - (L[b].y - L[a].y) * (L[c].x - L[a].x)) / 2;
    near(area, Math.abs(M.polygonArea(L)));
    // clockwise input is fine too
    assert.equal(M.triangulate(L.slice().reverse()).length, 4);
});

test('prism: walls plus a roof, either winding, height and bounds right', () => {
    const sq = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }];
    for (const poly of [sq, sq.slice().reverse()]) {
        const p = M.prism(poly, 5, [1, 0, 0], { z0: 2, roofColor: [0, 1, 0] });
        assert.equal(M.triangleCount(p), 4 * 2 + 2);
        assert.deepEqual(M.meshBounds(p), { min: [0, 0, 2], max: [6, 4, 7] });
        assertWinding(p, 'prism');
        // wall normals point out of the footprint
        const cx = 3, cy = 2;
        for (let i = 0; i < M.vertexCount(p); i++) {
            const nz = p.normals[i * 3 + 2];
            if (Math.abs(nz) > 0.5) continue;
            const dx = p.positions[i * 3] - cx, dy = p.positions[i * 3 + 1] - cy;
            assert.ok(dx * p.normals[i * 3] + dy * p.normals[i * 3 + 1] > 0, 'outward wall normal');
        }
        // the roof is a flat +z face in the roof colour
        let roof = 0;
        for (let i = 0; i < M.vertexCount(p); i++) if (p.normals[i * 3 + 2] > 0.99) { roof++; assert.deepEqual([...p.colors.slice(i * 3, i * 3 + 3)], [0, 1, 0]); }
        assert.equal(roof, 4);
    }
    assert.equal(M.triangleCount(M.prism(sq, 3, [1, 1, 1], { cap: false })), 8);
});

test('cylinder and cone: bounds, radii and winding', () => {
    const c = M.cylinder(10, 20, 1, 2, 5, 12);
    const bb = M.meshBounds(c);
    near(bb.min[0], 8); near(bb.max[0], 12); near(bb.min[2], 1); near(bb.max[2], 6);
    assertWinding(c, 'cylinder');
    const cone = M.cylinder(0, 0, 0, 3, 4, 8, [0, 1, 0], { radiusTop: 0 });
    assertWinding(cone, 'cone');
    near(M.meshBounds(cone).max[2], 4);
    // side normals of a cone lean upwards
    let up = 0;
    for (let i = 0; i < M.vertexCount(cone); i++) if (cone.normals[i * 3 + 2] > 0.1 && cone.normals[i * 3 + 2] < 0.99) up++;
    assert.ok(up > 0);
});

test('extrudeStrip: width, heights from the profile, faces up, length reported', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 10 }];
    const z = [0, 1, 2.5, 4];
    const s = M.extrudeStrip(pts, 6, z, [0.3, 0.3, 0.3], { bias: 0.02 });
    assert.equal(M.vertexCount(s), 8);
    assert.equal(M.triangleCount(s), 6);
    for (let i = 0; i < 4; i++) {
        near(s.positions[i * 6 + 2], z[i] + 0.02, 1e-5);
        near(s.positions[i * 6 + 5], z[i] + 0.02, 1e-5);
        const l = [0, 1, 2].map(k => s.positions[i * 6 + k]), r = [0, 1, 2].map(k => s.positions[i * 6 + 3 + k]);
        near(Math.hypot(l[0] - r[0], l[1] - r[1]), 6, 1e-4);
        // the centre of the pair sits on the centreline
        near((l[0] + r[0]) / 2, pts[i].x, 1e-4); near((l[1] + r[1]) / 2, pts[i].y, 1e-4);
    }
    assertWinding(s, 'strip');
    for (let t = 0; t < s.indices.length; t += 3) {
        const [a, b, c] = [s.indices[t], s.indices[t + 1], s.indices[t + 2]];
        const e1 = [0, 1].map(k => s.positions[b * 3 + k] - s.positions[a * 3 + k]), e2 = [0, 1].map(k => s.positions[c * 3 + k] - s.positions[a * 3 + k]);
        assert.ok(Math.abs(e1[0] * e2[1] - e1[1] * e2[0]) > 1e-9, 'triangles have area in plan view');
    }
    near(s.length, 10 + 10 + Math.hypot(10, 10), 1e-9);
    // a climbing strip's normals tilt back against the slope
    assert.ok(s.normals[3 * 3 + 2] < 1 && s.normals[3 * 3 + 2] > 0.9);
    // width and height may be functions; points may carry z
    const w = M.extrudeStrip([{ x: 0, y: 0, z: 1 }, { x: 10, y: 0, z: 2 }], d => 2 + d / 10, undefined);
    near(Math.hypot(w.positions[0] - w.positions[3], w.positions[1] - w.positions[4]), 2, 1e-5);
    near(Math.hypot(w.positions[6] - w.positions[9], w.positions[7] - w.positions[10]), 3, 1e-5);
    near(w.positions[8], 2, 1e-5);
});

test('mergeMeshes: vertex and triangle counts add up, indices are rebased, transforms move the geometry', () => {
    const a = M.box(0, 0, 0, 2, 2, 2), b = M.cylinder(0, 0, 0, 1, 2, 6);
    const moved = m4.translation(m4.create(), 100, -50, 7);
    const merged = M.mergeMeshes([a, { mesh: b, matrix: moved }]);
    assert.equal(M.vertexCount(merged), M.vertexCount(a) + M.vertexCount(b));
    assert.equal(M.triangleCount(merged), M.triangleCount(a) + M.triangleCount(b));
    assert.ok(Math.max(...merged.indices) === M.vertexCount(merged) - 1);
    assert.ok(Math.min(...merged.indices.slice(a.indices.length)) >= M.vertexCount(a));
    const bb = M.meshBounds(M.transformMesh(b, moved));
    near(bb.min[0], 99); near(bb.max[1], -50 + Math.sin(Math.PI / 3), 1e-4); near(bb.min[2], 7);
    assertWinding(merged, 'merged');
});

test('transformMesh: a rotation turns the normals with the positions and keeps them unit length', () => {
    const quarter = m4.create(); // +90 degrees about z: (x, y) -> (-y, x)
    quarter[0] = 0; quarter[1] = 1; quarter[4] = -1; quarter[5] = 0;
    const t = M.transformMesh(M.box(0, 0, 0, 2, 2, 2), quarter);
    assertWinding(t, 'rotated');
    for (let i = 0; i < M.vertexCount(t); i++) near(Math.hypot(t.normals[i * 3], t.normals[i * 3 + 1], t.normals[i * 3 + 2]), 1, 1e-5);
});

test('compose adds several shapes into one builder', () => {
    const b = M.createBuilder();
    M.compose.box(b, 0, 0, 0, 2, 2, 2, [1, 0, 0]);
    M.compose.cylinder(b, 5, 0, 0, 1, 3, 8, [0, 1, 0]);
    M.compose.prism(b, [{ x: 9, y: 0 }, { x: 11, y: 0 }, { x: 10, y: 2 }], 2, [0, 0, 1]);
    const mesh = b.finish();
    assert.equal(M.vertexCount(mesh), b.vertexCount);
    assertWinding(mesh, 'composed');
});

// ---- terrain-mesh.js: chunk ground, water, surf and the far field -------------------------------------------------

import fs from 'node:fs';
import { createWorld } from '../../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { terrainHeight, GRID_N } from '../../Games.Client/wwwroot/games/delivery-driver/world/terrain.js';
import { buildChunkMesh, buildFarField, coastParts, GROUND, roadFloorNear } from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/terrain-mesh.js';
import { CHUNK_SIZE } from '../../Games.Client/wwwroot/games/delivery-driver/config.js';

const world = createWorld(seedWithBaked());
const region = world.region;
const chunkAt = (x, y) => world.chunks.get(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
const exeter = region.townById.get('exeter');
const meanColour = mesh => {
    const c = [0, 0, 0], n = M.vertexCount(mesh);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k] += mesh.colors[i * 3 + k] / n;
    return c;
};

test('chunk ground mesh: 16 x 16 cells, vertices on the height grid, every triangle faces up', () => {
    const chunk = chunkAt(exeter.x, exeter.y);
    const { ground } = buildChunkMesh(world, chunk);
    assert.equal(M.triangleCount(ground), 16 * 16 * 2);
    assert.equal(M.vertexCount(ground), 16 * 16 * 4);
    const g = chunk.terrain;
    for (let i = 0; i < M.vertexCount(ground); i++) {
        const x = ground.positions[i * 3], y = ground.positions[i * 3 + 1], z = ground.positions[i * 3 + 2];
        const gi = Math.round((x - g.x0) / g.step), gj = Math.round((y - g.y0) / g.step);
        near(x, g.x0 + gi * g.step, 1e-3); near(y, g.y0 + gj * g.step, 1e-3);
        // on the height grid, except that beside a road the ground is held just under the road's deck
        const deck = g.z[gj * GRID_N + gi] < 0 ? null : roadFloorNear(world, x, y, g.step * 1.45);
        if (deck === null) near(z, g.z[gj * GRID_N + gi], 1e-4);
        else assert.ok(z <= g.z[gj * GRID_N + gi] + 1e-4 && z <= deck - 0.1, 'ground stays under the road deck');
        assert.ok(ground.normals[i * 3 + 2] > 0, 'normals point up');
    }
    assertWinding(ground, 'ground');
    for (let t = 0; t < ground.indices.length; t += 3) {
        const [a, b, c] = [ground.indices[t], ground.indices[t + 1], ground.indices[t + 2]];
        const e1 = [0, 1].map(k => ground.positions[b * 3 + k] - ground.positions[a * 3 + k]), e2 = [0, 1].map(k => ground.positions[c * 3 + k] - ground.positions[a * 3 + k]);
        assert.ok(e1[0] * e2[1] - e1[1] * e2[0] > 0, 'plan-view orientation matches the grid builder');
    }
});

test('chunk ground mesh: in open country the grid heights equal terrainHeight', () => {
    let checked = 0;
    for (const t of region.towns) {
        if (checked >= 40) break;
        const chunk = chunkAt(t.x + 900, t.y + 900);
        if (chunk.edges.length || chunk.town) continue;
        const g = chunk.terrain;
        for (let k = 0; k < 20; k++) {
            const gi = (k * 7) % GRID_N, gj = (k * 5) % GRID_N;
            near(g.z[gj * GRID_N + gi], terrainHeight(region, g.x0 + gi * g.step, g.y0 + gj * g.step), 1e-3);
            checked++;
        }
    }
    assert.ok(checked >= 20, `only ${checked} samples compared`);
});

test('chunk meshes: lod 1 is 4 x 4 cells covering the same footprint as lod 0', () => {
    const chunk = chunkAt(exeter.x, exeter.y);
    const lo = buildChunkMesh(world, chunk, { lod: 1 }).ground, hi = buildChunkMesh(world, chunk, { lod: 0 }).ground;
    assert.equal(M.triangleCount(lo), 4 * 4 * 2);
    assert.ok(M.triangleCount(lo) < M.triangleCount(hi));
    const bl = M.meshBounds(lo), bh = M.meshBounds(hi);
    for (let k = 0; k < 2; k++) { near(bl.min[k], bh.min[k], 1e-3); near(bl.max[k], bh.max[k], 1e-3); }
});

test('chunk meshes: the sea has a flat water surface and a bluish floor; the moor is warm', () => {
    const seaChunk = chunkAt(region.bounds.minX + 200, region.bounds.minY + 200);
    const seaMesh = buildChunkMesh(world, seaChunk);
    assert.ok(seaMesh.water && M.triangleCount(seaMesh.water) > 0, 'open sea has a water surface');
    const sea = meanColour(seaMesh.ground);
    assert.ok(sea[2] > sea[0], 'sea floor is bluish');
    for (let i = 0; i < M.vertexCount(seaMesh.water); i++) near(seaMesh.water.positions[i * 3 + 2], 0, 1e-6);
    const dart = region.moors[0];
    const xs = dart.pts.filter((_, i) => i % 2 === 0), ys = dart.pts.filter((_, i) => i % 2 === 1);
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
    const moor = meanColour(buildChunkMesh(world, chunkAt(mx, my)).ground);
    assert.ok(moor[0] > moor[2], 'moor is warm (red above blue)');
});

// Inland rivers are not in the game (the baked coastline holds the tidal rivers and estuaries), so the water mesh checks
// run on the sea and estuary water around Plymouth.
function waterChunksNear(town, r = 5) { // (Plymouth Sound lies about 1.3 world km from the town centre at 1:2)
    const ci = Math.floor(town.x / CHUNK_SIZE), cj = Math.floor(town.y / CHUNK_SIZE), out = [];
    for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) out.push(world.chunks.get(ci + di, cj + dj));
    return out;
}

test('water: surfaces are flat at sea level and never below it', () => {
    let vertices = 0;
    for (const chunk of waterChunksNear(region.townById.get('plymouth'))) {
        const { water } = buildChunkMesh(world, chunk);
        if (!water) continue;
        vertices += M.vertexCount(water);
        for (let i = 0; i < M.vertexCount(water); i++) assert.ok(water.positions[i * 3 + 2] >= -1e-6, 'never below sea level');
    }
    assert.ok(vertices > 0);
});

test('water: a piece of water is built by exactly one chunk (no doubled translucent water)', () => {
    const owner = new Map();
    let shared = 0, triangles = 0;
    for (const chunk of waterChunksNear(region.townById.get('plymouth'))) {
        const key = `${chunk.i},${chunk.j}`;
        const { water } = buildChunkMesh(world, chunk);
        if (!water) continue;
        for (let t = 0; t < water.indices.length; t += 3) {
            const c = [0, 1].map(k => [0, 1, 2].reduce((sum, v) => sum + water.positions[water.indices[t + v] * 3 + k], 0) / 3);
            const id = c.map(v => v.toFixed(2)).join(',');
            if (owner.has(id) && owner.get(id) !== key) shared++;
            owner.set(id, key);
            triangles++;
        }
    }
    assert.ok(triangles > 0);
    assert.equal(shared, 0, 'no triangle appears in two chunks');
});

test('coast: parts are classed once and cached; a chunk holding a coast part has surf at z just above 0', () => {
    const parts = coastParts(region);
    assert.ok(parts.length > 50);
    assert.equal(coastParts(region), parts, 'cached');
    const done = new Set();
    for (const p of parts.slice(0, 40)) {
        const chunk = chunkAt(p.mx, p.my), key = `${chunk.i},${chunk.j}`;
        if (done.has(key)) continue;
        done.add(key);
        const { surf } = buildChunkMesh(world, chunk);
        assert.ok(surf && M.triangleCount(surf) >= 2, 'surf present');
        for (let i = 0; i < M.vertexCount(surf); i++) near(surf.positions[i * 3 + 2], 0.05, 1e-5);
    }
});

test('far field: covers the region, sea is flat and below the sea cells, land is sunk, winding is right', () => {
    const far = buildFarField(region, { cells: 24, sink: 0.6 });
    assert.equal(M.triangleCount(far), 24 * 24 * 2);
    assertWinding(far, 'far');
    const bb = M.meshBounds(far);
    assert.ok(bb.min[0] <= region.bounds.minX && bb.max[0] >= region.bounds.maxX);
    assert.ok(bb.min[1] <= region.bounds.minY && bb.max[1] >= region.bounds.maxY);
    let sea = 0, land = 0;
    for (let i = 0; i < M.vertexCount(far); i++) {
        const z = far.positions[i * 3 + 2];
        if (Math.abs(far.colors[i * 3 + 2] - GROUND.sea[2]) < 1e-6) { sea++; near(z, -0.1, 1e-5); } else land++;
    }
    assert.ok(sea > 0 && land > 0);
});

// ---- camera3d.js: frustum culling and LOD -------------------------------------------------------------------------

import * as cam3 from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/camera3d.js';
import { QUALITY } from '../../Games.Client/wwwroot/games/delivery-driver/config.js';

const camAt = (x, y, z = 0) => cam3.obliqueCamera({}, { x, y, z }, 4 / 3);
const clip = (c, x, y, z) => {
    const out = m4.transformPoint([0, 0, 0], c.vp, [x, y, z]);
    return out; // x right, y up in NDC
};

test('obliqueCamera: the target is at the screen centre, north is up the screen and east is right', () => {
    const c = camAt(1000, 2000, 5);
    const mid = clip(c, 1000, 2000, 5), north = clip(c, 1000, 1900, 5), east = clip(c, 1100, 2000, 5);
    near(mid[0], 0, 1e-6); near(mid[1], 0, 1e-6);
    assert.ok(north[1] > mid[1], 'north (smaller y) is higher on the screen');
    assert.ok(east[0] > mid[0], 'east is to the right');
    assert.deepEqual(c.eye.map(v => Math.round(v)), [1000, 2095, 80], 'the eye is south of and above the target (world y)');
});

test('frustum planes: inside, behind the eye, beyond the far plane and far to the side', () => {
    const c = camAt(0, 0);
    const planes = cam3.frustumPlanes(c.vp);
    const inside = (x, y, z) => planes.every(p => p[0] * x + p[1] * y + p[2] * z + p[3] >= 0);
    assert.ok(inside(0, 0, 0), 'the target');
    assert.ok(inside(0, -150, 0), 'ahead (north)');
    assert.ok(!inside(0, 400, 0), 'behind the camera (south of the eye)');
    assert.ok(!inside(0, -9000, 0), 'beyond the far plane');
    assert.ok(!inside(5000, -100, 0), 'far off to the side');
    for (const p of planes) near(Math.hypot(p[0], p[1], p[2]), 1, 1e-9);
    assert.ok(cam3.sphereVisible(planes, 0, -150, 0, 5));
    assert.ok(!cam3.sphereVisible(planes, 0, 400, 0, 5));
    assert.ok(cam3.sphereVisible(planes, 0, 150, 0, 100), 'a big sphere straddling the near plane is kept');
});

test('boxVisible is conservative: a box containing a visible point is never culled', () => {
    const planes = cam3.frustumPlanes(camAt(500, -300).vp);
    let s = 7;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    let visible = 0, culled = 0;
    for (let k = 0; k < 400; k++) {
        const x = 500 + (rnd() - 0.5) * 900, y = -300 + (rnd() - 0.5) * 900, z = rnd() * 40, w = rnd() * 200;
        const inPoint = planes.every(p => p[0] * (x + w / 2) + p[1] * (y + w / 2) + p[2] * (z + 5) + p[3] >= 0);
        const vis = cam3.boxVisible(planes, x, y, z, x + w, y + w, z + 10);
        if (inPoint) assert.ok(vis, 'a box with a visible interior point must be visible');
        vis ? visible++ : culled++;
    }
    assert.ok(visible > 20 && culled > 20, `${visible} visible / ${culled} culled`);
});

test('chunk culling: the chunk ahead is visible, the one behind and the far ones to the side are culled', () => {
    const exeter = region.townById.get('exeter');
    const ci = Math.floor(exeter.x / CHUNK_SIZE), cj = Math.floor(exeter.y / CHUNK_SIZE);
    const c = camAt(ci * CHUNK_SIZE + CHUNK_SIZE / 2, cj * CHUNK_SIZE + CHUNK_SIZE / 2, 0);
    const planes = cam3.frustumPlanes(c.vp);
    const at = (i, j) => world.chunks.get(ci + i, cj + j);
    assert.ok(cam3.chunkVisible(planes, at(0, 0)), 'the chunk under the target');
    assert.ok(cam3.chunkVisible(planes, at(0, -1)), 'a chunk ahead (north)');
    assert.ok(!cam3.chunkVisible(planes, at(0, 3)), 'behind the camera');
    assert.ok(!cam3.chunkVisible(planes, at(12, 0)), 'far to the east');
    const some = [at(0, 0), at(0, -1), at(0, 4), at(9, 0)];
    assert.deepEqual(cam3.visibleChunks(planes, some).map(k => `${k.i - ci},${k.j - cj}`), ['0,0', '0,-1']);
});

test('chunkHeightRange covers the whole height grid with room for bridges, and is cached', () => {
    const chunk = world.chunks.get(Math.floor(exeter.x / CHUNK_SIZE), Math.floor(exeter.y / CHUNK_SIZE));
    const [lo, hi] = cam3.chunkHeightRange(chunk);
    for (const z of chunk.terrain.z) assert.ok(z >= lo && z <= hi);
    assert.ok(lo <= -1 && hi >= chunk.terrain.z.reduce((m, v) => Math.max(m, v), -Infinity) + 12 - 1e-6);
    assert.equal(cam3.chunkHeightRange(chunk), chunk._zRange);
    assert.deepEqual(cam3.chunkHeightRange({ i: 0, j: 0 }), [-6, 72], 'a loose default without a height grid');
});

test('LOD: monotonic with distance, full detail up close, and the draw distance grows with the quality preset', () => {
    let last = 0;
    for (let d = 0; d <= 5000; d += 20) {
        const l = cam3.lodFor(d);
        assert.ok(l >= last, `lod fell at ${d} m`);
        last = l;
    }
    assert.equal(cam3.lodFor(0), 0);
    assert.equal(cam3.lodFor(CHUNK_SIZE * 1.9), 0);
    assert.equal(cam3.lodFor(CHUNK_SIZE * 2), 1);
    assert.equal(cam3.lodFor(CHUNK_SIZE * 3, [1, 2, 4]), 2);
    assert.ok(cam3.viewDistance(QUALITY.low) < cam3.viewDistance(QUALITY.medium));
    assert.ok(cam3.viewDistance(QUALITY.medium) < cam3.viewDistance(QUALITY.high));
    assert.equal(cam3.viewDistance(QUALITY.high), (QUALITY.high.drawChunks + 0.5) * CHUNK_SIZE);
});
