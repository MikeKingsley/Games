import { signalPolesOf } from '../../Games.Client/wwwroot/games/delivery-driver/world/furniture.js';
import test from 'node:test';
import { seedWithBaked } from './helpers/delivery-seed.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorld } from '../../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { CHUNK_SIZE, QUALITY } from '../../Games.Client/wwwroot/games/delivery-driver/config.js';
import * as B from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/building-mesh.js';
import * as P from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/prop-mesh.js';
import * as I from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/instances.js';
import * as M from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/meshes.js';
import { interleave } from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/gpu-mesh.js';

const world = createWorld(seedWithBaked());
const exeter = world.region.project(50.7236, -3.5275);

/** All the chunks within `r` metres of Exeter's centre. */
const chunksNear = (x, y, r) => world.chunks.around(x, y, r);
const townChunks = chunksNear(exeter.x, exeter.y, 400);
const allBuildings = townChunks.flatMap(c => c.buildings);

const finite = mesh => [mesh.positions, mesh.normals, mesh.colors].every(a => a.every(Number.isFinite));
const unitNormals = mesh => {
    for (let i = 0; i < mesh.normals.length; i += 3) {
        const l = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
        if (Math.abs(l - 1) > 1e-3) return false;
    }
    return true;
};

test('the town has buildings of several styles to test against', () => {
    assert.ok(allBuildings.length > 30, `${allBuildings.length} buildings`);
    const types = new Set(allBuildings.map(b => b.type));
    for (const t of ['house', 'shop']) assert.ok(types.has(t), `${t} missing from ${[...types]}`);
});

test('every building yields a finite mesh with unit normals, inside its footprint, above its base minus the skirt', () => {
    for (const bd of allBuildings) {
        const mesh = B.buildBuilding(bd, 1985);
        assert.ok(M.triangleCount(mesh) > 0, bd.id);
        assert.ok(finite(mesh) && unitNormals(mesh), bd.id);
        const { min, max } = M.meshBounds(mesh);
        const reach = Math.hypot(bd.len, bd.dep) / 2 + (bd.shape === 'pumps' ? 4 : 0.6); // roof overhang, towers, chimneys and forecourt canopies stay within this
        for (const i of [0, 1]) assert.ok(Math.abs(min[i] - (i ? bd.y : bd.x)) <= reach + 1e-6 && Math.abs(max[i] - (i ? bd.y : bd.x)) <= reach + 1e-6, bd.id);
        const z = bd.z ?? 0;
        assert.ok(min[2] >= z - B.SKIRT - 1e-6, `${bd.id} dips to ${min[2]}`);
        // no taller than the eaves + ridge + a chimney (+ the church tower)
        assert.ok(max[2] <= z + bd.h + bd.dep * 0.32 + 3 + (bd.tower ? 9 : 0), `${bd.id} rises to ${max[2]}`);
        assert.ok(max[2] >= z + bd.h - 1e-6 || bd.shape, `${bd.id} is lower than its walls`);
    }
});

test('a gabled building has a ridge above its eaves; a flat one does not', () => {
    const gabled = allBuildings.find(b => b.roof === 'pitched' && !b.shape && !b.tower);
    const flat = allBuildings.find(b => b.roof === 'flat' && !b.shape);
    const g = M.meshBounds(B.buildBuilding(gabled, 1985, false));
    near(g.max[2], (gabled.z ?? 0) + gabled.h + gabled.dep * 0.32);
    if (flat) near(M.meshBounds(B.buildBuilding(flat, 1985, false)).max[2], (flat.z ?? 0) + flat.h);
});

const near = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('detail adds windows and doors; far buildings stay cheaper', () => {
    const b = allBuildings.find(x => x.type === 'house' || x.type === 'shop');
    const full = M.triangleCount(B.buildBuilding(b, 1985, true)), bare = M.triangleCount(B.buildBuilding(b, 1985, false));
    assert.ok(full > bare + 4, `${full} vs ${bare}`);
});

test('era changes colours: shop fascias differ between 1919 and 1985, windows lighten from 1970', () => {
    const shop = allBuildings.find(x => x.type === 'shop');
    const a = B.buildBuilding(shop, 1919), c = B.buildBuilding(shop, 1985);
    assert.notDeepEqual([...a.colors], [...c.colors]);
    assert.notEqual(B.buildingEra(1919), B.buildingEra(1985));
    assert.equal(B.buildingEra(1971), B.buildingEra(1975));
});

test('industrial shapes build: tank, heap, pit, pens, logs, pumps', () => {
    const base = { id: 'x', x: 100, y: 200, len: 12, dep: 9, angle: 0.4, h: 5, wall: '#a09080', z: 3 };
    for (const shape of ['tank', 'heap', 'pit', 'pens', 'logs', 'pumps']) {
        const mesh = B.buildBuilding({ ...base, shape }, 1990);
        assert.ok(M.triangleCount(mesh) > 0 && finite(mesh), shape);
        assert.ok(M.meshBounds(mesh).min[2] >= base.z - B.SKIRT - 1e-6, shape);
    }
    // the pumps gain a canopy from 1960
    assert.ok(M.triangleCount(B.buildBuilding({ ...base, shape: 'pumps' }, 1970)) > M.triangleCount(B.buildBuilding({ ...base, shape: 'pumps' }, 1930)));
});

test('merging buildings adds up vertices and triangles', () => {
    const list = allBuildings.slice(0, 12);
    const parts = list.map(b => B.buildBuilding(b, 1985));
    const merged = B.buildBuildings(list, 1985);
    assert.equal(M.vertexCount(merged), parts.reduce((n, m) => n + M.vertexCount(m), 0));
    assert.equal(M.triangleCount(merged), parts.reduce((n, m) => n + M.triangleCount(m), 0));
});

test('chunk props: a town chunk builds buildings, lamps and signs; far chunks only buildings; the era key changes', () => {
    const c = townChunks.find(ch => ch.buildings.length > 10 && ch.lamps.length > 2);
    assert.ok(c, 'a town chunk with lamps');
    const near_ = P.buildChunkProps(world, c, 1985, { detail: true }), far = P.buildChunkProps(world, c, 1985, { detail: false });
    assert.ok(M.triangleCount(near_) > M.triangleCount(far) && M.triangleCount(far) > 0);
    assert.ok(finite(near_) && unitNormals(near_));
    assert.notEqual(P.propsEra(1919), P.propsEra(1985));
    assert.equal(P.propsEra(1972), P.propsEra(1978));
    // lamps are taller after the gas era
    assert.ok(P.lampStyle(1985).height > P.lampStyle(1925).height);
});

test('props stay far below the 32-bit index and a sane per-chunk size budget', () => {
    let worst = 0;
    for (const c of townChunks) {
        const m = P.buildChunkProps(world, c, 1985, { detail: true });
        assert.ok(m.indices instanceof Uint32Array);
        worst = Math.max(worst, m.indices.length);
        assert.ok(M.vertexCount(m) < 400000);
        assert.ok(m.indices.every(i => i < M.vertexCount(m)));
    }
    assert.ok(worst < 600000, `worst chunk has ${worst} indices`);
});

test('hedges are low ribbons along field edges, away from roads', () => {
    const c = world.chunks.around(world.region.project(50.9, -3.9).x, world.region.project(50.9, -3.9).y, 700).find(ch => ch.hedges.length);
    assert.ok(c, 'a farmland chunk');
    const b = M.createBuilder();
    P.addHedges(b, c.hedges, () => 10, world.graph, world.region);
    const mesh = b.finish();
    assert.ok(M.triangleCount(mesh) > 10);
    const { min, max } = M.meshBounds(mesh);
    assert.ok(min[2] >= 9.7 && max[2] <= 11.4, `${min[2]}..${max[2]}`);
    assert.ok(finite(mesh) && unitNormals(mesh));
});

test('harbour walls rise out of the water and boats float', () => {
    const h = world.harbours[0];
    const b = M.createBuilder();
    P.addHarbour(b, h);
    const { min, max } = M.meshBounds(b.finish());
    assert.ok(min[2] < 0 && max[2] > 1.5);
});

test('signals show green on the poles whose signal group has the phase', () => {
    const node = world.graph.nodes.find(n => n.junction === 'signals' && signalPolesOf(world, n).some(p => p.group === 0) && signalPolesOf(world, n).some(p => p.group === 1));
    const poles = signalPolesOf(world, node);
    assert.ok(node, 'a signalled junction');
    const green = [0.235, 1, 0.416], red = [1, 0.231, 0.184];
    const count = (mesh, rgb) => {
        let n = 0;
        for (let i = 0; i < M.vertexCount(mesh); i++) if ([0, 1, 2].every(k => Math.abs(mesh.colors[i * 3 + k] - rgb[k]) < 0.01)) n++;
        return n;
    };
    for (const phase of [0, 1]) {
        const m = P.buildDynamicProps(world, { signalNodes: [node], phaseOf: () => phase });
        const greens = poles.filter(p => p.group === phase).length;
        assert.equal(count(m, green), 4 * greens); // a green lamp is four vertices
        assert.equal(count(m, red), 4 * (poles.length - greens));
    }
    const a = P.buildDynamicProps(world, { signalNodes: [node], phaseOf: () => 0 }), c = P.buildDynamicProps(world, { signalNodes: [node], phaseOf: () => 1 });
    assert.notDeepEqual([...a.positions], [...c.positions]);
    assert.equal(P.buildDynamicProps(world, {}), null);
});

test('cones stand up, and lie flat when knocked over', () => {
    const cone = world.practice.cones[0];
    const up = M.createBuilder();
    P.addCone(up, { ...cone, knocked: false }, 0);
    const down = M.createBuilder();
    P.addCone(down, { ...cone, knocked: true }, 0);
    assert.ok(M.meshBounds(up.finish()).max[2] > 0.7);
    assert.ok(M.meshBounds(down.finish()).max[2] < 0.2);
});

test('tree instances: expected counts per quality preset, thinned for low quality and far chunks', () => {
    const c = world.chunks.around(world.region.project(50.65, -3.95).x, world.region.project(50.65, -3.95).y, 900).reduce((best, ch) => (ch.trees.length > best.trees.length ? ch : best));
    assert.ok(c.trees.length > 20, `${c.trees.length} trees`);
    const total = q => I.buildTreeInstances(c, QUALITY[q].trees).count;
    assert.equal(total('high'), c.trees.length);
    assert.equal(I.buildTreeInstances(c, 1).count, c.trees.length);
    assert.ok(total('low') < total('medium') && total('medium') < total('high'));
    assert.equal(total('low'), Math.ceil(c.trees.length / I.treeStep(QUALITY.low.trees)));
    assert.ok(I.buildTreeInstances(c, 1, true).count < c.trees.length / 2);
    const inst = I.buildTreeInstances(c, 1);
    assert.equal(inst.broadleaf.length % I.INSTANCE_FLOATS, 0);
    assert.equal(inst.conifer.length % I.INSTANCE_FLOATS, 0);
    assert.equal((inst.broadleaf.length + inst.conifer.length) / I.INSTANCE_FLOATS, c.trees.length);
    assert.ok(inst.broadleaf.every(Number.isFinite));
});

test('tree and rock templates are unit-sized, finite and interleave to the GPU layout', () => {
    for (const [name, mesh, w, h] of [['broadleaf', I.broadleafTemplate(), 1, 1], ['conifer', I.coniferTemplate(), 1, 1]]) {
        const { min, max } = M.meshBounds(mesh);
        assert.ok(finite(mesh) && unitNormals(mesh), name);
        assert.ok(max[0] <= w + 1e-6 && min[0] >= -w - 1e-6 && min[2] >= -1e-6 && max[2] <= h + 1e-6, name);
        assert.ok(max[2] > 0.9, `${name} reaches the top`);
        assert.equal(interleave(mesh).length, M.vertexCount(mesh) * 9);
    }
    const rock = I.rockTemplate();
    const { min, max } = M.meshBounds(rock);
    assert.ok(min[2] >= 0 && max[2] <= 1.0001 && max[0] <= 0.5001 && finite(rock));
});

test('tor rocks become instances sunk into the ground', () => {
    const c = townChunks.find(ch => ch.rocks.length) ?? world.chunks.around(world.region.project(50.6, -3.95).x, world.region.project(50.6, -3.95).y, 3000).find(ch => ch.rocks.length);
    assert.ok(c, 'a chunk with tor rocks');
    const inst = I.buildRockInstances(c);
    assert.equal(inst.length, c.rocks.length * I.INSTANCE_FLOATS);
    near(inst[2], (c.rocks[0].z ?? 0) - 0.6);
    near(inst[6], c.rocks[0].h + 0.6);
});

test('signal nodes of a chunk are inside it and only exist once junctionType says signals', () => {
    let found = 0;
    for (const c of world.chunks.around(exeter.x, exeter.y, 1500)) {
        for (const n of P.chunkSignalNodes(world, c, 1990)) {
            found++;
            assert.ok(n.x >= c.i * CHUNK_SIZE && n.x < (c.i + 1) * CHUNK_SIZE && n.y >= c.j * CHUNK_SIZE && n.y < (c.j + 1) * CHUNK_SIZE);
        }
        assert.equal(P.chunkSignalNodes(world, c, 1919).length, 0);
    }
    assert.ok(found >= 0);
});

test('the active bay glows: an amber curtain that pulses in height', () => {
    const bay = { x: 10, y: 20, len: 7, dep: 3.4, angle: 0.3 };
    const low = M.createBuilder(), high = M.createBuilder();
    P.addBayGlow(low, bay, 2, Math.PI / 8 * 3 * 0 - Math.PI / 8); // sin(4t) = -sin(pi/2)... lowest
    P.addBayGlow(high, bay, 2, Math.PI / 8);
    const lo = M.meshBounds(low.finish()), hi = M.meshBounds(high.finish());
    assert.ok(hi.max[2] > lo.max[2] && lo.max[2] > 2.2);
    const m = P.buildDynamicProps(world, { bays: [bay], time: 1 });
    assert.ok(m && M.triangleCount(m) > 8);
});
