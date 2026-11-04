import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLES, TRAILERS } from '../../Games.Client/wwwroot/games/delivery-driver/game/catalogue.js';
import * as V from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/vehicle-mesh.js';
import * as M from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/meshes.js';
import * as mat4 from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/mat4.js';
import { axlePositions } from '../../Games.Client/wwwroot/games/delivery-driver/render/draw-vehicles.js';
import { createTrailer, hitchPoint, kingpin, attach } from '../../Games.Client/wwwroot/games/delivery-driver/sim/trailer.js';
import { createVehicle } from '../../Games.Client/wwwroot/games/delivery-driver/sim/vehicle.js';
import { TRAFFIC_TYPES, agentDrawSpec } from '../../Games.Client/wwwroot/games/delivery-driver/traffic/traffic.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const finite = mesh => [mesh.positions, mesh.normals, mesh.colors].every(a => a.every(Number.isFinite));
const LIVERY = { livery1: '#2f5d8a', livery2: '#e8c547' };

test('every catalogue vehicle builds a non-empty mesh matching its length and width, and not taller than its height', () => {
    for (const spec of VEHICLES) {
        const { body, head, tail } = V.buildVehicleMesh(spec, LIVERY);
        assert.ok(M.triangleCount(body) > 12 && finite(body), spec.id);
        assert.ok(M.triangleCount(tail) > 0, spec.id);
        const { min, max } = M.meshBounds(body);
        const len = max[0] - min[0], wid = max[1] - min[1], hgt = max[2];
        assert.ok(Math.abs(len - spec.length) <= spec.length * 0.08, `${spec.id} length ${len} vs ${spec.length}`);
        assert.ok(Math.abs(wid - spec.width) <= spec.width * 0.12, `${spec.id} width ${wid} vs ${spec.width}`);
        assert.ok(hgt <= spec.height * 1.1 && hgt >= spec.height * 0.6, `${spec.id} height ${hgt} vs ${spec.height}`);
        assert.ok(Math.abs(min[0] + spec.rearOverhang) < 0.3, `${spec.id} rear of body sits about rearOverhang behind the axle (${min[0]})`);
        assert.ok(head.positions.length >= 0);
    }
});

test('every trailer builds a mesh matching its size; legs and cargo add geometry', () => {
    for (const spec of TRAILERS) {
        const { body, tail } = V.buildTrailerMesh(spec, LIVERY);
        const { min, max } = M.meshBounds(body);
        assert.ok(M.triangleCount(body) > 12 && M.triangleCount(tail) > 0 && finite(body), spec.id);
        assert.ok(Math.abs(max[0] - min[0] - spec.length) <= spec.length * 0.05, `${spec.id} length`);
        assert.ok(max[2] <= spec.height + 0.5, `${spec.id} height ${max[2]} vs ${spec.height}`);
        assert.ok(M.triangleCount(V.buildTrailerMesh(spec, LIVERY, { legs: true }).body) > M.triangleCount(body), `${spec.id} legs`);
    }
    const flat = TRAILERS.find(t => t.body === 'flat');
    assert.ok(M.triangleCount(V.buildTrailerMesh(flat, LIVERY, { cargo: true }).body) > M.triangleCount(V.buildTrailerMesh(flat, LIVERY).body));
});

test('livery colours reach the mesh; a damaged vehicle is tinted darker', () => {
    const spec = VEHICLES.find(v => v.draw.parts.some(p => p.color === 'livery1'));
    const red = V.buildVehicleMesh(spec, { livery1: '#ff0000', livery2: '#00ff00' }).body;
    const blue = V.buildVehicleMesh(spec, { livery1: '#0000ff', livery2: '#00ff00' }).body;
    assert.notDeepEqual([...red.colors], [...blue.colors]);
    assert.ok(V.damageTint(100)[0] < V.damageTint(0)[0] && V.damageTint(0)[0] === 1);
});

test('wheel positions match the axles, steering is on the front axle only', () => {
    for (const spec of VEHICLES) {
        const wheels = V.vehicleWheels(spec), axles = axlePositions(spec);
        const xs = new Set(wheels.map(w => w.x.toFixed(6)));
        assert.equal(xs.size, axles.length, spec.id);
        for (const u of axles) assert.ok(xs.has((u - spec.rearOverhang).toFixed(6)), `${spec.id} axle at ${u}`);
        assert.ok(wheels.every(w => w.z === w.r), 'wheels rest on the ground');
        const steered = new Set(wheels.filter(w => w.steer).map(w => w.x.toFixed(6)));
        assert.deepEqual([...steered], [(spec.wheelbase).toFixed(6)].map(x => (Number(x) + 0).toFixed(6)).filter(x => xs.has(x)));
        for (const w of wheels) assert.ok(Math.abs(w.y) <= spec.width / 2 + 1e-9);
    }
    const spec = TRAILERS.find(t => t.axles === 3);
    const w = V.trailerWheels(spec);
    assert.equal(w.length, 6);
    near(w.reduce((s, q) => s + q.x, 0), 0);
});

test('the wheel template is a unit tyre with its axle along y', () => {
    const m = V.wheelTemplate();
    const { min, max } = M.meshBounds(m);
    assert.ok(finite(m));
    near(min[0], -1, 1e-3); near(max[0], 1, 1e-3); near(min[2], -1, 1e-3); near(max[2], 1, 1e-3);
    assert.ok(max[1] > 0.5 && max[1] < 0.6 && min[1] < -0.5);
});

const isOrthonormal = m => {
    const c = [0, 4, 8].map(i => [m[i], m[i + 1], m[i + 2]]);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) near(dot(c[i], c[j]), i === j ? 1 : 0, 1e-9);
    return true;
};

test('poseMatrix puts the rear axle at the pose, keeps the matrix orthonormal, and pitch/roll tilt the right way', () => {
    const m = V.poseMatrix(new Float64Array(16), 100, 50, 7, 0.9, 0.1, -0.05);
    assert.ok(isOrthonormal(m));
    const o = mat4.transformPoint([0, 0, 0], m, [0, 0, 0]);
    near(o[0], 100); near(o[1], 50); near(o[2], 7);
    // heading 0: forward is +x (east), right is +y (south)
    const flat = V.poseMatrix(new Float64Array(16), 0, 0, 0, 0);
    assert.deepEqual(mat4.transformPoint([0, 0, 0], flat, [1, 0, 0]).map(v => Math.round(v * 1e9) / 1e9), [1, 0, 0]);
    assert.deepEqual(mat4.transformPoint([0, 0, 0], flat, [0, 1, 0]).map(v => Math.round(v * 1e9) / 1e9), [0, 1, 0]);
    // nose up raises the front; the right side lower lowers +y
    const up = V.poseMatrix(new Float64Array(16), 0, 0, 0, 0, 0.2, 0);
    assert.ok(mat4.transformPoint([0, 0, 0], up, [4, 0, 0])[2] > 0.5);
    const lean = V.poseMatrix(new Float64Array(16), 0, 0, 0, 0, 0, 0.2);
    assert.ok(mat4.transformPoint([0, 0, 0], lean, [0, 1, 0])[2] < -0.1);
    // heading 90 degrees: forward is south (+y)
    const south = V.poseMatrix(new Float64Array(16), 0, 0, 0, Math.PI / 2);
    near(mat4.transformPoint([0, 0, 0], south, [1, 0, 0])[1], 1);
});

test('a coupled trailer pins its kingpin to the tractor fifth wheel within 1 cm, on flat ground and a slope', () => {
    const tractor = createVehicle(VEHICLES.find(v => v.fifthWheel !== undefined), { x: 40, y: -20, heading: 0.7 });
    const spec = TRAILERS.find(t => t.id === 'box-12');
    const tr = createTrailer(spec, { x: 0, y: 0, heading: 0.55 });
    attach(tractor, tr);
    for (const [pitch, tpitch] of [[0, 0], [0.08, 0.05]]) {
        const tm = V.poseMatrix(new Float64Array(16), tractor.x, tractor.y, 3, tractor.heading, pitch, 0.02);
        const hook = V.hitchWorld([0, 0, 0], tm, tractor.spec);
        const m = V.trailerMatrix(new Float64Array(16), spec, { x: tr.x, y: tr.y, z: 3, heading: tr.heading, pitch: tpitch, roll: 0.02 }, hook);
        const k = mat4.transformPoint([0, 0, 0], m, [spec.axle, 0, V.PLATE_Z]);
        for (let i = 0; i < 3; i++) assert.ok(Math.abs(k[i] - hook[i]) < 0.01, `axis ${i}: ${k[i]} vs ${hook[i]}`);
        assert.ok(isOrthonormal(m));
    }
    // on flat ground the unhitched pose has its kingpin over the sim's kingpin point
    const m = V.trailerMatrix(new Float64Array(16), spec, { x: tr.x, y: tr.y, z: 0, heading: tr.heading });
    const kp = mat4.transformPoint([0, 0, 0], m, [spec.axle, 0, 0]), sim = kingpin(tr), hp = hitchPoint(tractor);
    near(kp[0], sim.x, 1e-9); near(kp[1], sim.y, 1e-9);
    near(sim.x, hp.x, 1e-9); near(sim.y, hp.y, 1e-9);
});

test('a wheel matrix moves with the vehicle, steers about z and spins about its axle', () => {
    const spec = VEHICLES.find(v => v.id === 'exe-two-tonner') ?? VEHICLES[1];
    const wheels = V.vehicleWheels(spec), front = wheels.find(w => w.steer);
    const vm = V.poseMatrix(new Float64Array(16), 10, 20, 1, 0);
    const out = new Float64Array(16);
    V.wheelMatrix(out, vm, front, 0, 0);
    const c = mat4.transformPoint([0, 0, 0], out, [0, 0, 0]);
    near(c[0], 10 + front.x); near(c[1], 20 + front.y); near(c[2], 1 + front.z);
    // the unit tyre's lateral axis (y) stays lateral with no steering and turns with it
    const side0 = mat4.transformPoint([0, 0, 0], out, [0, 1, 0]);
    near(side0[0] - c[0], 0); assert.ok(side0[1] - c[1] > 0);
    V.wheelMatrix(out, vm, front, 0.4, 0);
    assert.ok(Math.abs(mat4.transformPoint([0, 0, 0], out, [0, 1, 0])[0] - c[0]) > 0.01);
    // a rear wheel ignores the steering input
    const rear = wheels.find(w => !w.steer);
    const a = V.wheelMatrix(new Float64Array(16), vm, rear, 0, 0), b = V.wheelMatrix(new Float64Array(16), vm, rear, 0.5, 0);
    assert.deepEqual([...a], [...b]);
    // spinning moves the hub's spoke around but leaves the centre
    const s = V.wheelMatrix(new Float64Array(16), vm, rear, 0, 1);
    near(s[12], a[12]); near(s[14], a[14]);
    assert.notDeepEqual([...s], [...a]);
});

test('traffic specs build too, including the bicycle and cart', () => {
    for (const type of Object.keys(TRAFFIC_TYPES)) {
        const spec = agentDrawSpec({ type, spec: TRAFFIC_TYPES[type], colour: '#aa3322' });
        const { body, tail } = V.buildVehicleMesh(spec, LIVERY);
        assert.ok(M.triangleCount(body) > 0 && M.triangleCount(tail) > 0 && finite(body), type);
        assert.ok(V.vehicleWheels(spec).length >= 2, type);
    }
});

test('smoke only appears on badly damaged vehicles and moves with time', () => {
    const spec = VEHICLES[0], pose = { x: 0, y: 0, z: 0, heading: 0 };
    const none = M.createBuilder(); V.addSmoke(none, 1, pose, spec, 30);
    assert.equal(none.vertexCount, 0);
    const a = M.createBuilder(), b = M.createBuilder(), c = M.createBuilder();
    V.addSmoke(a, 1, pose, spec, 70); V.addSmoke(b, 1.3, pose, spec, 70); V.addSmoke(c, 1, pose, spec, 95);
    assert.ok(a.vertexCount > 0 && c.vertexCount > a.vertexCount);
    assert.notDeepEqual([...a.finish().positions], [...b.finish().positions]);
});

test('the mesh cache keeps the most recently used and reports evictions', () => {
    const evicted = [], cache = V.createMeshCache(2, v => evicted.push(v));
    cache.get('a', () => 'A'); cache.get('b', () => 'B'); cache.get('a', () => 'X');
    cache.get('c', () => 'C');
    assert.deepEqual(evicted, ['B']);
    assert.equal(cache.get('a', () => 'Z'), 'A');
    cache.clear();
    assert.equal(cache.size, 0);
    assert.equal(V.vehicleKey(VEHICLES[0], LIVERY, 'c') === V.vehicleKey(VEHICLES[0], LIVERY, ''), false);
});
