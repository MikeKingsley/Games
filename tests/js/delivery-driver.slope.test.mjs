import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { G, slopeForce, gradeSin, brakeFade, fadeFactor, FADE_MIN, engineBraking, engineBrakeForce } from '../../Games.Client/wwwroot/games/delivery-driver/sim/slope.js';
import { createGearbox, updateGearbox, rpmAt } from '../../Games.Client/wwwroot/games/delivery-driver/sim/gearbox.js';
import { createVehicle, stepVehicle } from '../../Games.Client/wwwroot/games/delivery-driver/sim/vehicle.js';
import { createTrailer, attach, stepTrailer, stepLooseTrailer, articulation, kingpin, trailerHasBrakes } from '../../Games.Client/wwwroot/games/delivery-driver/sim/trailer.js';
import { couple, uncouple, couplingCheck, couplingHeights } from '../../Games.Client/wwwroot/games/delivery-driver/sim/coupling.js';
import { COUPLE } from '../../Games.Client/wwwroot/games/delivery-driver/config.js';
import { gradeFuelFactor, fuelBurn, climbWear, brakeWear } from '../../Games.Client/wwwroot/games/delivery-driver/game/economy.js';
import { createWorld } from '../../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { createSession } from '../../Games.Client/wwwroot/games/delivery-driver/game/session.js';
import { createTraffic, TRAFFIC_TYPES } from '../../Games.Client/wwwroot/games/delivery-driver/traffic/traffic.js';
import { createGraph, createSegmentIndex, cruiseSpeed } from '../../Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js';
import { roadHeightAt } from '../../Games.Client/wwwroot/games/delivery-driver/world/terrain.js';
import { gradeLabel, brakeWarning } from '../../Games.Client/wwwroot/games/delivery-driver/ui/hud.js';
import { hillTipFor, attachHillTips, HILL_TIPS } from '../../Games.Client/wwwroot/games/delivery-driver/game/tutorial.js';
import { vehicleById, trailerById } from '../../Games.Client/wwwroot/games/delivery-driver/game/catalogue.js';

const DT = 1 / 60;
const coast = { throttle: 0, brake: 0, steer: 0 };
const full = { throttle: 1, brake: 0, steer: 0 };

/** A rigid lorry with a load, optionally moving. */
function lorry(id = 'dart-3', cargo = 3000, speed = 0) {
    const v = createVehicle(vehicleById(id));
    v.cargoMass = cargo;
    v.speed = speed;
    return v;
}

function run(v, controls, seconds, env = {}, each = null) {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
        stepVehicle(v, typeof controls === 'function' ? controls(v) : controls, DT, env);
        each?.(v);
    }
    return v;
}

test('slopeForce is -m g sin(atan(grade)) along the heading: back uphill, forward downhill', () => {
    assert.ok(Math.abs(slopeForce(1000, 0.06) + 1000 * G * Math.sin(Math.atan(0.06))) < 1e-9);
    assert.equal(slopeForce(1000, -0.06), -slopeForce(1000, 0.06));
    assert.equal(slopeForce(1000, 0), -0);
    assert.ok(Math.abs(gradeSin(1) - Math.SQRT1_2) < 1e-12);
});

test('brake heat builds under braking, fades the brakes between 1 and FADE_MIN, and cools off the brakes', () => {
    assert.equal(fadeFactor(0), 1);
    assert.equal(fadeFactor(1), 1);
    assert.ok(Math.abs(fadeFactor(10) - FADE_MIN) < 1e-12);
    for (let h = 0; h < 4; h += 0.05) assert.ok(fadeFactor(h + 0.05) <= fadeFactor(h) + 1e-12, 'monotonic');
    // no work at a standstill, and cooling never goes below cold
    assert.equal(brakeFade(0, DT, 30000, 0, 10000).heat, 0);
    assert.equal(brakeFade(0, DT, 0, 20, 10000).heat, 0);
    let s = { heat: 0, factor: 1 };
    for (let i = 0; i < 60 * 60; i++) s = brakeFade(s.heat, DT, 10000, 12, 10000); // 12 W/kg for a minute
    assert.ok(s.factor < 0.8 && s.factor >= FADE_MIN, `factor ${s.factor}`);
    for (let i = 0; i < 60 * 60; i++) s = brakeFade(s.heat, DT, 0, 12, 10000);
    assert.equal(s.factor, 1);
});

test('engine braking is zero at full throttle, at idle, while shifting and near a standstill, and grows with RPM', () => {
    const spec = vehicleById('dart-3');
    assert.equal(engineBraking(spec, spec.engine.maxRpm, 1), 0);
    assert.equal(engineBraking(spec, spec.engine.idleRpm, 0), 0);
    assert.ok(engineBraking(spec, spec.engine.maxRpm, 0) > engineBraking(spec, spec.engine.peakRpm, 0));
    const gb = createGearbox(spec);
    gb.gear = 2;
    assert.ok(engineBrakeForce(gb, spec, 5, 0) > 0);
    assert.equal(engineBrakeForce(gb, spec, 0.5, 0), 0, 'clutch slipping');
    assert.equal(engineBrakeForce(gb, spec, -5, 0), 0, 'rolling back in a forward gear');
    gb.shiftTimer = 0.2;
    assert.equal(engineBrakeForce(gb, spec, 5, 0), 0, 'clutch in');
    // an exhaust brake (air-braked lorries) makes it stronger
    const air = vehicleById('exe-milk-tanker');
    assert.ok(engineBraking(air, air.engine.maxRpm, 0) / air.engine.torque > engineBraking(spec, spec.engine.maxRpm, 0) / spec.engine.torque);
});

test('on a constant 6% uphill a loaded rigid slows by g sin(theta) more than on the flat, and a heavier load loses more speed', () => {
    // coasting with the engine braking off, so only gravity differs (rolling resistance by cos(theta), negligibly)
    const env = { engineBrake: false };
    const flat = run(lorry('dart-3', 3000, 3), coast, 2, env);
    const hill = run(lorry('dart-3', 3000, 3), coast, 2, { ...env, grade: 0.06 });
    const expected = G * Math.sin(Math.atan(0.06)) * 2;
    const actual = flat.speed - hill.speed;
    assert.ok(Math.abs(actual - expected) / expected < 0.02, `${actual} vs ${expected}`);
    // full throttle up a long 6% climb from 9 m/s (20 mph): the 1924 two-tonner can't hold it loaded, and the heavier
    // the load the slower it is left
    const light = run(lorry('exe-two-tonner', 300, 9), full, 30, { grade: 0.06 });
    const heavy = run(lorry('exe-two-tonner', 2000, 9), full, 30, { grade: 0.06 });
    assert.ok(heavy.speed < light.speed - 0.5, `${heavy.speed} vs ${light.speed}`);
    assert.ok(heavy.speed < 8.5, `the loaded lorry cannot hold its speed up 6% (${heavy.speed})`);
});

test('downhill a lorry gains speed, and engine braking holds a lower terminal speed than coasting without it', () => {
    const withEb = run(lorry('dart-3', 3000, 5), coast, 300, { grade: -0.06 });
    const without = run(lorry('dart-3', 3000, 5), coast, 300, { grade: -0.06, engineBrake: false });
    assert.ok(withEb.speed > 5 && without.speed > 5, 'both gain speed');
    assert.ok(withEb.speed < without.speed - 2, `${withEb.speed} vs ${without.speed}`);
    // a heavier load runs away faster (drag and engine braking are a smaller share of its weight)
    const empty = run(lorry('dart-3', 0, 5), coast, 300, { grade: -0.06 });
    assert.ok(withEb.speed > empty.speed, `${withEb.speed} vs empty ${empty.speed}`);
});

test('stopped on 10% with no throttle and no handbrake a vehicle rolls back; on 2%, or with a brake, it stays put', () => {
    const steep = run(createVehicle(vehicleById('tamar-t-ton')), coast, 3, { grade: 0.1 });
    assert.ok(steep.speed < -0.5 && steep.x < -1, `speed ${steep.speed}, x ${steep.x}`);
    const down = run(createVehicle(vehicleById('tamar-t-ton')), coast, 3, { grade: -0.1 });
    assert.ok(down.speed > 0.5 && down.x > 1, 'facing downhill it rolls forward');
    const gentle = run(createVehicle(vehicleById('tamar-t-ton')), coast, 10, { grade: 0.02 });
    assert.equal(gentle.speed, 0);
    assert.equal(gentle.x, 0);
    for (const hold of [{ ...coast, handbrake: true }, { ...coast, brake: 1 }]) {
        const v = run(createVehicle(vehicleById('tamar-t-ton')), hold, 5, { grade: 0.1 });
        assert.equal(v.speed, 0);
        assert.equal(v.x, 0);
    }
});

test('brakes fade after a long heavy descent on the brakes and recover on the flat', () => {
    const v = lorry('moorland-8', 8000, 15);
    // hold 15 m/s down a 12% hill on the brakes for a minute
    run(v, s => ({ ...coast, brake: s.speed > 15 ? 1 : 0 }), 60, { grade: -0.12 });
    assert.ok(fadeFactor(v.brakeHeat) < 0.75, `fade ${fadeFactor(v.brakeHeat)}`);
    // faded brakes stop it from 15 m/s on the flat in a longer distance than cold ones
    const stop = w => { w.speed = 15; const x0 = w.x; run(w, { ...coast, brake: 1 }, 30); return w.x - x0; };
    const cold = lorry('moorland-8', 8000);
    assert.ok(stop({ ...v, gearbox: { ...v.gearbox } }) > stop(cold) * 1.2);
    // a minute and a half on the flat off the brakes and they're back
    run(v, s => { s.speed = 15; return coast; }, 90);
    assert.equal(fadeFactor(v.brakeHeat), 1);
});

test('the gearbox picks a lower gear on a climb and holds it without hunting', () => {
    const spec = vehicleById('dart-3');
    const gb = createGearbox(spec);
    gb.gear = 3;
    const speed = (1800 * spec.wheelRadius) / (spec.gears[1] * spec.finalDrive * (60 / (2 * Math.PI))); // 1800 rpm in 2nd
    updateGearbox(gb, spec, speed, 1, DT, 0);
    assert.equal(gb.gear, 3, 'the flat keeps third');
    updateGearbox(gb, spec, speed, 1, DT, 0.06);
    assert.equal(gb.gear, 2, 'a 6% climb changes down');
    assert.ok(rpmAt(gb, spec, speed) < spec.engine.maxRpm * 0.92);
    // a loaded lorry slogging up a long 8% climb settles in a gear (at most a couple of shifts in the last half minute)
    const v = lorry('dart-3', 3000, 6);
    let shifts = 0, last = v.gearbox.gear;
    run(v, full, 60, { grade: 0.08 });
    run(v, full, 30, { grade: 0.08 }, w => { if (w.gearbox.gear !== last) { shifts++; last = w.gearbox.gear; } });
    assert.ok(shifts <= 2, `${shifts} shifts`);
    assert.ok(v.gearbox.gear < spec.gears.length, `gear ${v.gearbox.gear}`);
    // the 1919 van's two far-apart gears: pulling away up 10% it stays in first (second couldn't hold the hill)
    const van = createVehicle(vehicleById('tamar-t-ton'));
    let vanShifts = 0, vanGear = 1;
    run(van, full, 20, { grade: 0.1 }, w => { if (w.gearbox.gear !== vanGear) { vanShifts++; vanGear = w.gearbox.gear; } });
    assert.equal(vanShifts, 0);
    assert.ok(van.speed > 3, `${van.speed}`);
    // ...but on the flat it still changes up through its gears
    const flatVan = run(createVehicle(vehicleById('tamar-t-ton')), full, 20);
    assert.equal(flatVan.gearbox.gear, 2);
});

test('the vehicle keeps its ground height, and pitch and roll follow the ground with a little lag', () => {
    const v = createVehicle(vehicleById('tamar-t-ton'));
    v.speed = 10;
    stepVehicle(v, full, DT, { grade: 0.05, pitch: Math.atan(0.05), roll: 0.02, groundZ: 3 });
    assert.ok(Math.abs(v.z - (3 + 0.05 * (v.x - v.prevX))) < 1e-9);
    assert.ok(v.pitch > 0 && v.pitch < Math.atan(0.05));
    run(v, full, 1, { grade: 0.05, pitch: Math.atan(0.05), roll: 0.02, groundZ: 3 });
    assert.ok(Math.abs(v.pitch - Math.atan(0.05)) < 1e-3 && Math.abs(v.roll - 0.02) < 1e-3);
});

// ---- trailers ----------------------------------------------------------------------------------------------------

function rig(tractor, trailerSpec, { cargo = 0, kink = 0, speed = 0 } = {}) {
    const t = createVehicle(vehicleById(tractor));
    const tr = createTrailer(typeof trailerSpec === 'string' ? trailerById(trailerSpec) : trailerSpec, { heading: -kink });
    tr.cargoMass = cargo;
    t.trailer = tr;
    tr.coupled = true;
    tr.parkBrake = false;
    attach(t, tr);
    t.speed = speed;
    return { t, tr };
}

function driveRig({ t, tr }, controls, seconds, env = {}) {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
        const r = stepVehicle(t, controls, DT, env);
        if (stepTrailer(t, tr, DT, t.speed, r.yawRate, r.push)) break;
    }
}

test('a loose trailer on 6% rolls downhill with its parking brake off and stays put with it on (or on 2%)', () => {
    const loose = (parkBrake, grade) => {
        const tr = createTrailer(trailerById('box-12'));
        tr.cargoMass = 10000;
        tr.parkBrake = parkBrake;
        for (let i = 0; i < 3 * 60; i++) stepLooseTrailer(tr, grade, DT);
        return tr;
    };
    const rolling = loose(false, 0.06); // the kingpin end is uphill: it rolls back, axle first
    assert.ok(rolling.speed < -0.5 && rolling.x < -1, `speed ${rolling.speed}, x ${rolling.x}`);
    assert.ok(loose(false, -0.06).x > 1, 'nose downhill it rolls forward');
    for (const [brake, grade] of [[true, 0.06], [false, 0.02]]) {
        const tr = loose(brake, grade);
        assert.equal(tr.x, 0);
        assert.equal(tr.speed, 0);
    }
});

test('uncoupling puts the parking brake on by itself below 3% only; coupling releases it', () => {
    for (const [grade, expected] of [[0.02, true], [-0.025, true], [0.05, false], [-0.08, false]]) {
        const { t, tr } = rig('kestrel', 'box-12');
        assert.equal(uncouple(t, grade), tr);
        assert.equal(tr.parkBrake, expected, `grade ${grade}`);
    }
    const { t, tr } = rig('kestrel', 'box-12');
    uncouple(t, 0);
    t.x -= 0.2; // pull forward a little, then couple again
    assert.equal(couple(t, tr), true);
    assert.equal(tr.parkBrake, false);
});

test('braking hard downhill swings out an unbraked trailer much heavier than its tractor; braked trailers stay in line', () => {
    const env = { grade: -0.06, trailerGrade: -0.06 };
    const brake = { throttle: 0, brake: 1, steer: 0 };
    const light = trailerById('box-light'); // 1937: no brakes of its own
    const unbraked = rig('tamar-horse', light, { cargo: 5000, kink: 0.1, speed: 8 });
    driveRig(unbraked, brake, 2, env);
    assert.ok(Math.abs(articulation(unbraked.t, unbraked.tr)) > 0.2, `unbraked ${articulation(unbraked.t, unbraked.tr)}`);
    const braked = rig('tamar-horse', { ...light, brakes: true }, { cargo: 5000, kink: 0.1, speed: 8 });
    driveRig(braked, brake, 2, env);
    assert.ok(Math.abs(articulation(braked.t, braked.tr)) < 0.1, `braked ${articulation(braked.t, braked.tr)}`);
    // the same unbraked rig coasting straightens out, and empty it doesn't swing out under braking
    const coasting = rig('tamar-horse', light, { cargo: 5000, kink: 0.1, speed: 8 });
    driveRig(coasting, coast, 2, env);
    assert.ok(Math.abs(articulation(coasting.t, coasting.tr)) < 0.1);
    const empty = rig('tamar-horse', light, { kink: 0.1, speed: 8 });
    driveRig(empty, brake, 2, env);
    assert.ok(Math.abs(articulation(empty.t, empty.tr)) < 0.1);
});

test('trailers from 1956 brake themselves too: the rig stops shorter than with an unbraked trailer', () => {
    const stop = spec => {
        const r = rig('kestrel', spec, { cargo: 15000, speed: 12 });
        const x0 = r.t.x;
        driveRig(r, { throttle: 0, brake: 1, steer: 0 }, 30);
        return r.t.x - x0;
    };
    assert.ok(trailerHasBrakes(trailerById('box-12')) && !trailerHasBrakes(trailerById('box-light')));
    assert.ok(stop(trailerById('box-12')) < stop({ ...trailerById('box-12'), brakes: false }) * 0.7);
});

test('coupling needs the kingpin within 0.25 m of the fifth wheel: fine on an even slope, refused across a ledge', () => {
    const lineUp = () => {
        const tr = createTrailer(trailerById('box-12'));
        const t = createVehicle(vehicleById('kestrel'));
        const k = kingpin(tr);
        t.x = k.x - t.spec.fifthWheel;
        t.y = k.y;
        return { t, tr };
    };
    const slope = (x, y) => 0.08 * x + 0.01 * y;
    const a = lineUp();
    assert.ok(Math.abs(couplingHeights(a.t, a.tr, slope).dz) < 0.02);
    assert.equal(couplingCheck(a.t, a.tr, COUPLE, slope), null);
    const ledge = (x) => (x > 6.8 ? 0.5 : 0); // the tractor's wheels up a 0.5 m step, the trailer's legs below it
    const b = lineUp();
    const why = couplingCheck(b.t, b.tr, COUPLE, ledge);
    assert.equal(why?.reason, 'height');
    assert.ok(Math.abs(why.dz + 0.5) < 0.05);
    assert.equal(couple(b.t, b.tr, ledge), false);
    assert.equal(couplingCheck(b.t, b.tr), null, 'without a ground function the old checks only');
    // a rolling trailer can't be coupled
    const c = lineUp();
    c.tr.speed = 1;
    assert.equal(couplingCheck(c.t, c.tr)?.reason, 'moving');
});

// ---- economy -----------------------------------------------------------------------------------------------------

test('the fuel multiplier is monotonic in grade: more climbing, less descending, never below 0.3', () => {
    assert.equal(gradeFuelFactor(0), 1);
    let prev = 0;
    for (let g = -0.3; g <= 0.3 + 1e-9; g += 0.005) {
        const f = gradeFuelFactor(g);
        assert.ok(f >= prev - 1e-12, `not monotonic at ${g}`);
        assert.ok(f >= 0.3);
        prev = f;
    }
    assert.ok(Math.abs(gradeFuelFactor(0.05) - 1.6) < 1e-9 && Math.abs(gradeFuelFactor(-0.05) - 0.6) < 1e-9);
    assert.equal(gradeFuelFactor(-0.2), 0.3);
    const spec = vehicleById('dart-3');
    assert.ok(fuelBurn(spec, 1000, 0.5, 1, 0.06) > fuelBurn(spec, 1000, 0.5, 1, 0) && fuelBurn(spec, 1000, 0.5, 1, 0) > fuelBurn(spec, 1000, 0.5, 1, -0.06));
});

test('sustained full-throttle steep climbs wear the engine; braking wears the brakes, faster when they are hot', () => {
    assert.equal(climbWear(3, 0.08, 1), 0, 'not sustained yet');
    assert.equal(climbWear(30, 0.03, 1), 0, 'not steep');
    assert.ok(climbWear(30, 0.08, 1) > 0 && climbWear(30, 0.12, 1) > climbWear(30, 0.08, 1));
    assert.equal(brakeWear(0, 5000, 0), 0);
    assert.ok(brakeWear(1e6, 5000, 0) > 0);
    assert.ok(brakeWear(1e6, 5000, 2) > brakeWear(1e6, 5000, 1) * 3);
});

// ---- in the game: the session on a real steep road ------------------------------------------------------------------

const SEED = new URL('../../Games.Client/wwwroot/games/delivery-driver/world/seed/sw-england.json', import.meta.url);
const world = createWorld(JSON.parse(fs.readFileSync(SEED, 'utf8')));

function gameOn(controls) {
    const s = createSession({ world });
    s.input = { update: () => controls, setOverride() {}, onAction() {} };
    s.newGame({});
    return s;
}

test('in the game the player feels the road: slows and rolls back on a steep road, and burns more fuel climbing it', () => {
    const controls = { throttle: 0, brake: 0, steer: 0 };
    const s = gameOn(controls);
    const road = s.debugHook().steepRoad(0.05);
    assert.ok(road && road.grade >= 0.05, 'a steep A or B road');
    s.teleport(road.x, road.y, road.heading);
    assert.ok(Math.abs(s.player.z - s.debugHook().groundZ(s.player.x, s.player.y)) < 0.3, 'settled on the road');
    // coasting up it from 6 m/s loses more speed than on the flat
    s.player.speed = 6;
    for (let i = 0; i < 90; i++) s.step(DT);
    assert.ok(s.slope.grade > 0.03, `grade ${s.slope.grade}`);
    const flat = lorry('tamar-t-ton', 0, 6);
    run(flat, coast, 1.5);
    assert.ok(6 - s.player.speed > 6 - flat.speed + 0.7 * G * 0.04 * 1.5, `${s.player.speed} vs flat ${flat.speed}`);
    // stopped on it with nothing pressed, it rolls back
    s.teleport(road.x, road.y, road.heading);
    let slowest = 0;
    for (let i = 0; i < 180; i++) { s.step(DT); slowest = Math.min(slowest, s.player.speed); }
    assert.ok(slowest < -0.3, `slowest ${slowest}`);
    // full throttle up it: fuel per metre well above the flat rate
    s.teleport(road.x, road.y, road.heading);
    controls.throttle = 1;
    const fuel0 = s.player.rec.fuel, odo0 = s.player.odometer;
    for (let i = 0; i < 240; i++) s.step(DT);
    const metres = s.player.odometer - odo0;
    assert.ok(metres > 5);
    const used = fuel0 - s.player.rec.fuel;
    assert.ok(used > fuelBurn(s.player.spec, metres, 0, 1, 0) * 1.25, `${used} vs flat ${fuelBurn(s.player.spec, metres, 0, 1, 0)}`);
});

test('traffic crawls up hills by its power to weight, holds back down steep ones, and rides the road profile', () => {
    const g = createGraph();
    const a = g.addNode(0, 0), b = g.addNode(1200, 0);
    const e = g.addEdge(a, b, [0, 0, 1200, 0], { cls: 'A' });
    const n = 300;
    e.zStep = e.len / n;
    e.z = Float32Array.from({ length: n + 1 }, (_, i) => 0.06 * i * e.zStep); // 6% up from a to b
    for (const node of g.nodes) node.junction = 'end';
    g.index = createSegmentIndex(g);
    const year = 1975;
    const flatTarget = (type, agent) => Math.min(TRAFFIC_TYPES[type].vmax, cruiseSpeed('A', year)) * agent.factor;
    const tr = createTraffic(g, { seed: 3, cap: 0 });
    for (const type of ['cart', 'bicycle', 'tin', 'bus', 'tractor', 'car70']) {
        tr.agents = [];
        const up = tr.spawnOn(e, true, 20, year, type);
        for (let i = 0; i < 60 * 30; i++) tr.step(DT, { year, player: null });
        const flat = flatTarget(type, up);
        if (type === 'car70') assert.ok(up.speed > flat * 0.98, `${type} ${up.speed} vs ${flat}`);
        else assert.ok(up.speed < flat * 0.9, `${type} climbs at ${up.speed} (flat ${flat})`);
        assert.ok(Math.abs(up.z - roadHeightAt(e, up.along)) < 1e-6 && Math.abs(up.pitch - Math.atan(0.06)) < 1e-3);
        assert.ok(up.prevZ < up.z);
    }
    // downhill a bus keeps its speed on 6% (it only holds back beyond 5%, a little)
    tr.agents = [];
    const down = tr.spawnOn(e, false, 20, year, 'bus');
    for (let i = 0; i < 60 * 20; i++) tr.step(DT, { year, player: null });
    assert.ok(down.speed > flatTarget('bus', down) * 0.9 && down.pitch < 0);
});

// ---- HUD and tips ------------------------------------------------------------------------------------------------

test('the HUD shows the hill along the direction of travel and warns of hot and fading brakes', () => {
    assert.equal(gradeLabel(0.01, 5), '');
    assert.equal(gradeLabel(0.08, 5), 'Hill 8% up');
    assert.equal(gradeLabel(-0.064, 5), 'Hill 6% down');
    assert.equal(gradeLabel(0.08, -2), 'Hill 8% down', 'reversing down the hill');
    assert.equal(gradeLabel(0.08, 0), 'Hill 8% up', 'stopped: the way it faces');
    assert.equal(brakeWarning(0.3), null);
    assert.match(brakeWarning(0.8).text, /^Brakes hot \d+°C$/);
    assert.equal(brakeWarning(0.8).level, 'hot');
    assert.deepEqual(brakeWarning(2.5), { text: 'Brakes fading 35%', level: 'fade' });
});

test('hill tips (engine braking downhill, hot brakes, trailer parking brakes) show once per company', () => {
    assert.equal(hillTipFor({ grade: -0.06, speed: 8 }), 'descent');
    assert.equal(hillTipFor({ grade: -0.06, speed: 2 }), null, 'crawling down is fine');
    assert.equal(hillTipFor({ grade: -0.06, speed: 8 }, ['descent']), null);
    assert.equal(hillTipFor({ brakeHeat: 0.9 }), 'hotBrakes');
    const s = gameOn({ throttle: 0, brake: 0, steer: 0 });
    const tips = [];
    s.on('tip', t => tips.push(t));
    attachHillTips(s);
    s.player.brakeHeat = 1.2;
    for (let i = 0; i < 120; i++) s.step(DT);
    assert.deepEqual(tips, [HILL_TIPS.hotBrakes]);
    // down the steep road at speed (from near the top of the stretch, turned round)
    const road = s.debugHook().steepRoad(0.05);
    s.teleport(road.x + Math.cos(road.heading) * 20, road.y + Math.sin(road.heading) * 20, road.heading + Math.PI);
    s.player.speed = 8;
    for (let i = 0; i < 30; i++) s.step(DT);
    assert.deepEqual(tips, [HILL_TIPS.hotBrakes, HILL_TIPS.descent]);
    // a trailer left without its brake, once only
    s.emit('uncoupled', { parkBrake: false });
    s.emit('uncoupled', { parkBrake: false });
    s.emit('uncoupled', { parkBrake: true });
    assert.deepEqual(tips.slice(2), [HILL_TIPS.parkBrake]);
    assert.deepEqual([...s.career.tips].sort(), ['descent', 'hotBrakes', 'parkBrake']);
    // saved with the company: a new company sees them afresh
    s.newGame({});
    assert.deepEqual(s.career.tips, []);
});
