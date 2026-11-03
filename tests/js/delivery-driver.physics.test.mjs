import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVehicle, stepVehicle, turningRadius, collideVehicle, vehicleObb } from '../../Games.Client/wwwroot/games/delivery-driver/sim/vehicle.js';
import { gearedTopSpeed, torqueAt, rpmAt, createGearbox } from '../../Games.Client/wwwroot/games/delivery-driver/sim/gearbox.js';
import { obb, sat, resolve, createSpatialHash } from '../../Games.Client/wwwroot/games/delivery-driver/sim/collision.js';
import { vehicleById } from '../../Games.Client/wwwroot/games/delivery-driver/game/catalogue.js';

const DT = 1 / 60;
const MPH = 0.44704;
const van = () => vehicleById('tamar-t-ton');
const full = { throttle: 1, brake: 0, steer: 0 };

function run(v, controls, seconds, onStep) {
    for (let i = 0; i < Math.round(seconds / DT); i++) { stepVehicle(v, controls, DT); onStep?.(v, i * DT); }
}

test('the van reaches 25 +-2 mph from a standstill and does not exceed it', () => {
    const v = createVehicle(van());
    let max = 0;
    run(v, full, 120, s => { max = Math.max(max, s.speed); });
    assert.ok(Math.abs(v.speed / MPH - 25) <= 2, `${v.speed / MPH} mph`);
    assert.ok(max / MPH <= 27, `peak ${max / MPH} mph`);
});

function zeroTo20(cargo) {
    const v = createVehicle(van());
    v.cargoMass = cargo;
    let t = 0;
    while (v.speed < 20 * MPH && t < 120) { stepVehicle(v, full, DT); t += DT; }
    return t;
}

function stoppingDistance(cargo) {
    const v = createVehicle(van());
    v.cargoMass = cargo;
    run(v, full, 90);
    const x0 = v.x;
    let n = 0;
    while (v.speed > 0 && n++ < 60 * 60) stepVehicle(v, { throttle: 0, brake: 1, steer: 0 }, DT);
    return v.x - x0;
}

test('a heavier load gives a longer 0-20 mph time and a longer stopping distance', () => {
    assert.ok(zeroTo20(1000) > zeroTo20(0) * 1.3);
    assert.ok(stoppingDistance(1000) > stoppingDistance(0) * 1.3);
});

test('a full-lock turning circle matches wheelbase / tan(max steer) within 5%', () => {
    const spec = van();
    const v = createVehicle(spec);
    const pts = [];
    run(v, { throttle: 0.15, brake: 0, steer: 1 }, 40, s => pts.push([s.x, s.y]));
    // fit the circle from the extremes of the rear-axle path once the steering has settled
    const settled = pts.slice(pts.length / 2);
    const xs = settled.map(p => p[0]), ys = settled.map(p => p[1]);
    const r = ((Math.max(...xs) - Math.min(...xs)) + (Math.max(...ys) - Math.min(...ys))) / 4;
    const expected = turningRadius(spec, spec.maxSteer);
    assert.ok(Math.abs(r - expected) / expected < 0.05, `r=${r} expected=${expected}`);
});

test('reversing with straight wheels moves backwards along the heading', () => {
    const v = createVehicle(van(), { x: 0, y: 0, heading: 0.7 });
    run(v, { throttle: 1, brake: 0, steer: 0, reverse: true }, 3);
    assert.ok(v.speed < 0);
    const along = v.x * Math.cos(0.7) + v.y * Math.sin(0.7);
    const across = -v.x * Math.sin(0.7) + v.y * Math.cos(0.7);
    assert.ok(along < -1, `along=${along}`);
    assert.ok(Math.abs(across) < 1e-6);
    assert.ok(Math.abs(v.heading - 0.7) < 1e-9);
});

test('reverse speed is limited by the reverse gearing', () => {
    const spec = van();
    const v = createVehicle(spec);
    run(v, { throttle: 1, brake: 0, steer: 0, reverse: true }, 60);
    assert.ok(-v.speed <= gearedTopSpeed(spec, true) + 0.05);
});

test('the gearbox shifts up through the gears and the governor cuts torque at max RPM', () => {
    const spec = van();
    const v = createVehicle(spec);
    run(v, full, 60);
    assert.equal(v.gearbox.gear, spec.gears.length);
    assert.equal(torqueAt(spec, spec.engine.maxRpm), 0);
    assert.ok(torqueAt(spec, spec.engine.peakRpm) === spec.engine.torque);
    assert.ok(rpmAt(createGearbox(spec), spec, 0) === spec.engine.idleRpm);
});

test('SAT separates two overlapping boxes and reports the closing speed as the impact speed', () => {
    const a = obb(0, 0, 4, 2, 0.3), b = obb(3, 0.5, 4, 2, -0.2);
    const c = sat(a, b);
    assert.ok(c && c.depth > 0);
    const bodyA = { ...a, vx: 6, vy: 0, invMass: 1 };
    const bodyB = { ...b, vx: -2, vy: 0, invMass: 1 };
    const closing = -((bodyA.vx - bodyB.vx) * c.nx + (bodyA.vy - bodyB.vy) * c.ny);
    const impact = resolve(bodyA, bodyB, c);
    assert.ok(Math.abs(impact - closing) < 1e-9);
    assert.equal(sat(bodyA, bodyB), null); // separated after resolution (touching counts as separated)
    assert.equal(sat(obb(0, 0, 2, 2, 0), obb(5, 0, 2, 2, 0)), null);
});

test('a vehicle driving into a wall stops and reports the impact speed', () => {
    const v = createVehicle(van(), { x: 0, y: 0, heading: 0 });
    v.speed = 8;
    const wall = obb(5, 0, 1, 10, 0);
    let impact = 0;
    for (let i = 0; i < 60 && !impact; i++) { stepVehicle(v, { throttle: 0, brake: 0, steer: 0 }, DT); impact = collideVehicle(v, wall); }
    assert.ok(impact > 7 && impact <= 8, `impact ${impact}`);
    assert.ok(v.speed < 1);
    assert.equal(sat(vehicleObb(v), wall), null);
});

test('the spatial hash returns nearby items only', () => {
    const hash = createSpatialHash(10);
    const near = { box: obb(5, 5, 2, 2, 0) }, far = { box: obb(200, 200, 2, 2, 0) };
    hash.insert(near); hash.insert(far);
    assert.deepEqual(hash.query(obb(6, 6, 2, 2, 0)), [near]);
    hash.remove(near);
    assert.deepEqual(hash.query(obb(6, 6, 2, 2, 0)), []);
});
