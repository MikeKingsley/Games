import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVehicle, stepVehicle } from '../../Games.Client/wwwroot/games/delivery-driver/sim/vehicle.js';
import { createTrailer, attach, stepTrailer, articulation, steadyArticulation, hitchPoint, kingpin, JACKKNIFE } from '../../Games.Client/wwwroot/games/delivery-driver/sim/trailer.js';
import { couple, uncouple, couplingCheck } from '../../Games.Client/wwwroot/games/delivery-driver/sim/coupling.js';
import { vehicleById, trailerById } from '../../Games.Client/wwwroot/games/delivery-driver/game/catalogue.js';
import { createCareer } from '../../Games.Client/wwwroot/games/delivery-driver/game/career.js';
import { buyTrailer } from '../../Games.Client/wwwroot/games/delivery-driver/game/dealer.js';

const DT = 1 / 60;

function rig(tractor = 'kestrel', trailer = 'box-12', heading = 0) {
    const t = createVehicle(vehicleById(tractor), { heading });
    const tr = createTrailer(trailerById(trailer), { heading });
    t.trailer = tr;
    tr.coupled = true;
    attach(t, tr);
    return { t, tr };
}

function drive(t, tr, controls, seconds) {
    let fold = null;
    for (let i = 0; i < seconds / DT; i++) {
        const r = stepVehicle(t, controls, DT);
        fold = stepTrailer(t, tr, DT, t.speed, r.yawRate) ?? fold;
        if (fold) { t.speed = 0; break; }
    }
    return fold;
}

test('driving forward in a steady circle, the articulation settles at the analytic value (within 2%)', () => {
    for (const [tractor, trailer, steer] of [['kestrel', 'box-12', 0.5], ['tamar-horse', 'flat-light', 0.45], ['moorland-m44', 'curtain', 0.4], ['tamar-t32', 'tanker', 0.6]]) {
        const { t, tr } = rig(tractor, trailer);
        drive(t, tr, { throttle: 0.15, brake: 0, steer }, 120);
        const R0 = t.spec.wheelbase / Math.tan(t.steer);
        const expected = steadyArticulation(R0, t.spec.fifthWheel, tr.spec.axle);
        const actual = articulation(t, tr);
        assert.ok(Math.abs(actual - expected) / expected < 0.02, `${tractor}: ${actual} vs ${expected}`);
    }
});

test('reversing straight with a small articulation, the angle grows (unstable) unless corrected', () => {
    const { t, tr } = rig();
    tr.heading = 0.04; // a slight kink
    attach(t, tr);
    const start = Math.abs(articulation(t, tr));
    drive(t, tr, { throttle: 0.4, brake: 0, steer: 0, reverse: true }, 7);
    const grown = Math.abs(articulation(t, tr));
    assert.ok(t.speed <= 0);
    assert.ok(grown > start * 3, `${start} -> ${grown}`);
    // driving forward straightens it out again
    const { t: t2, tr: tr2 } = rig();
    tr2.heading = 0.3;
    attach(t2, tr2);
    drive(t2, tr2, { throttle: 0.4, brake: 0, steer: 0 }, 12);
    assert.ok(Math.abs(articulation(t2, tr2)) < 0.03);
});

test('folding past the limit flags a jack-knife and holds the trailer at the limit', () => {
    const { t, tr } = rig();
    tr.heading = 0.2;
    attach(t, tr);
    const fold = drive(t, tr, { throttle: 0.6, brake: 0, steer: 0.6, reverse: true }, 20);
    assert.equal(fold, 'jackknife');
    assert.ok(tr.jackknifed);
    assert.ok(Math.abs(articulation(t, tr)) <= JACKKNIFE + 1e-9);
});

test('the kingpin stays on the fifth wheel while driving', () => {
    const { t, tr } = rig();
    for (let i = 0; i < 600; i++) {
        const r = stepVehicle(t, { throttle: 0.5, brake: 0, steer: Math.sin(i / 60) }, DT);
        stepTrailer(t, tr, DT, t.speed, r.yawRate);
        const h = hitchPoint(t), k = kingpin(tr);
        assert.ok(Math.hypot(h.x - k.x, h.y - k.y) < 1e-9);
    }
});

function lineUp(offset = 0, angle = 0, speed = 0) {
    const t = createVehicle(vehicleById('kestrel'), { heading: angle });
    const tr = createTrailer(trailerById('box-12'), { x: 0, y: 0, heading: 0 });
    tr.legsDown = true;
    const k = kingpin(tr);
    const f = t.spec.fifthWheel;
    t.x = k.x - Math.cos(angle) * f + offset;
    t.y = k.y - Math.sin(angle) * f;
    t.speed = speed;
    return { t, tr };
}

test('coupling succeeds only inside the tolerances', () => {
    assert.equal(couplingCheck(...Object.values(lineUp(0.3))), null);
    assert.equal(couplingCheck(...Object.values(lineUp(0.6))).reason, 'position');
    assert.equal(couplingCheck(...Object.values(lineUp(0, 0.25))).reason, 'angle'); // 14 degrees off
    assert.equal(couplingCheck(...Object.values(lineUp(0, 0, 0.8))).reason, 'moving');
    const rigid = createVehicle(vehicleById('dart-3'));
    assert.equal(couplingCheck(rigid, createTrailer(trailerById('box-12'))).reason, 'notTractor');
    const { t, tr } = lineUp(0.2, 0.05);
    assert.equal(couple(t, tr), true);
    assert.equal(t.trailer, tr);
    const h = hitchPoint(t), k = kingpin(tr);
    assert.ok(Math.hypot(h.x - k.x, h.y - k.y) < 1e-9, 'snapped onto the fifth wheel');
});

test('an uncoupled trailer keeps its pose, and trailer records survive a save round trip', () => {
    const { t, tr } = rig();
    drive(t, tr, { throttle: 0.5, brake: 0, steer: 0.3 }, 6);
    t.speed = 0;
    const pose = { x: tr.x, y: tr.y, heading: tr.heading };
    assert.equal(uncouple(t), tr);
    assert.equal(t.trailer, null);
    assert.ok(tr.legsDown && !tr.coupled);
    drive(t, { ...tr }, { throttle: 0.5, brake: 0, steer: 0 }, 2); // the tractor drives off
    assert.deepEqual({ x: tr.x, y: tr.y, heading: tr.heading }, pose);

    const c = createCareer({ money: 5000, minutes: 60 * 24 * 366 * 40 });
    const { rec } = buyTrailer(c, 'box-12', 'depot-exeter');
    rec.pose = pose;
    rec.cargoMass = 4200;
    const back = JSON.parse(JSON.stringify(c));
    assert.deepEqual(back.trailers, c.trailers);
    assert.deepEqual(back.trailers[0].pose, pose);
});
