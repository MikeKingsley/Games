import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLayout } from '../../Games.Client/wwwroot/games/inglenook/layouts.js';
import { createSim, pathLength } from '../../Games.Client/wwwroot/games/inglenook/sim.js';
import { COUPLING_GAP, LOCO_LEN, LOCO_SPEED, WAGON_LEN } from '../../Games.Client/wwwroot/games/inglenook/config.js';

const layout = getLayout('classic');
const wagons = n => Array.from({ length: n }, (_, i) => ({ id: `w${i + 1}`, color: ['red', 'blue', 'green'][i % 3], number: i + 1 }));
const ids = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `w${from + i}`);

function run(sim, seconds, dt = 1 / 60) {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) sim.step(dt);
}
const types = sim => sim.drainEvents().map(e => e.type);
const pose = (sim, id) => sim.poses().find(p => p.id === id);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function threeOnB() {
    return createSim(layout, { vehicles: wagons(3), rakes: [{ track: 'B', flush: 'b', vehicles: ids(1, 3) }] });
}

test('the loco starts alone at the headshunt buffer', () => {
    const sim = createSim(layout, { vehicles: wagons(3), rakes: [{ track: 'B', flush: 'b', vehicles: ids(1, 3) }] });
    assert.equal(sim.rakes().length, 2);
    const loco = pose(sim, 'loco');
    assert.equal(loco.track, 'H');
    assert.ok(Math.abs(loco.d - LOCO_LEN / 2) < 1e-9);
    assert.equal(sim.speed, 0);
});

test('speed eases up to the top speed and back down', () => {
    const sim = createSim(layout, { vehicles: [] });
    sim.setDirection('forward');
    run(sim, 0.2);
    assert.ok(sim.speed > 0 && sim.speed < LOCO_SPEED);
    run(sim, 0.3);
    assert.ok(Math.abs(sim.speed - LOCO_SPEED) < 1e-9);
    sim.setDirection('stop');
    run(sim, 0.5);
    assert.equal(sim.speed, 0);
});

test('the loco stops at a buffer stop', () => {
    const sim = createSim(layout, { vehicles: [] });
    sim.setDirection('forward');
    run(sim, 30);
    assert.equal(sim.speed, 0);
    assert.equal(sim.command, 'stop');
    const loco = pose(sim, 'loco');
    assert.equal(loco.track, 'B');
    assert.ok(Math.abs(loco.d - (layout.tracks.B.length - LOCO_LEN / 2)) < 1e-6);
    assert.ok(types(sim).includes('buffer'));
    // and reverse takes it back to the other buffer
    sim.setDirection('reverse');
    run(sim, 30);
    assert.equal(pose(sim, 'loco').track, 'H');
    assert.ok(Math.abs(pose(sim, 'loco').d - LOCO_LEN / 2) < 1e-6);
});

test('points choose the route and trailing moves return to the headshunt', () => {
    const sim = createSim(layout, { vehicles: [] });
    assert.ok(sim.togglePoint('P1'));
    sim.setDirection('forward');
    run(sim, 30);
    assert.equal(pose(sim, 'loco').track, 'A');
    sim.setDirection('reverse');
    run(sim, 30);
    assert.equal(pose(sim, 'loco').track, 'H');
});

test('touching a wagon couples automatically and stops the loco', () => {
    const sim = threeOnB();
    sim.setDirection('forward');
    run(sim, 30);
    assert.equal(sim.speed, 0);
    assert.equal(sim.rakes().length, 1);
    assert.equal(sim.stats.couplings, 1);
    assert.ok(types(sim).includes('coupled'));
    const loco = pose(sim, 'loco'), w1 = pose(sim, 'w1');
    assert.ok(Math.abs(dist(loco, w1) - (LOCO_LEN / 2 + WAGON_LEN / 2 + COUPLING_GAP)) < 1e-6);
    // the three wagons are still where they were, in a row
    const b = layout.tracks.B.length;
    assert.ok(Math.abs(pose(sim, 'w3').d - (b - WAGON_LEN / 2)) < 1e-6);
});

test('pulling a rake out, pushing it into another siding and uncoupling leaves the wagons exactly where they stop', () => {
    const sim = threeOnB();
    sim.setDirection('forward');
    run(sim, 30);
    sim.setDirection('reverse');
    run(sim, 30); // pull the wagons out onto the headshunt
    assert.equal(pose(sim, 'loco').track, 'H');
    assert.equal(pose(sim, 'w3').track, 'H');
    assert.ok(sim.togglePoint('P1'));
    sim.setDirection('forward');
    run(sim, 30); // push them into A
    assert.equal(pose(sim, 'w3').track, 'A');
    assert.ok(Math.abs(pose(sim, 'w3').d - (layout.tracks.A.length - WAGON_LEN / 2)) < 1e-6);
    const before = ['w1', 'w2', 'w3'].map(id => pose(sim, id));
    const rake = sim.rakes().find(r => r.vehicles.includes('loco'));
    assert.deepEqual(rake.vehicles, ['loco', 'w1', 'w2', 'w3']);
    assert.ok(sim.uncouple(rake.id, 1));
    assert.equal(sim.rakes().length, 2);
    assert.equal(sim.stats.uncouplings, 1);
    sim.setDirection('reverse');
    run(sim, 30);
    const after = ['w1', 'w2', 'w3'].map(id => pose(sim, id));
    for (let i = 0; i < 3; i++) assert.ok(dist(before[i], after[i]) < 1e-9);
    assert.equal(pose(sim, 'loco').track, 'H');
    assert.deepEqual(sim.onTrack('A'), ['w1', 'w2', 'w3']);
});

test('a loco coming from the other end couples to the head of a rake', () => {
    const sim = createSim(layout, { vehicles: wagons(2), rakes: [{ track: 'H', flush: 'a', vehicles: ids(1, 2) }], loco: { track: 'H', flush: 'b' } });
    sim.setDirection('forward'); // the loco faces the buffer end here
    run(sim, 30);
    assert.equal(sim.rakes().length, 1);
    const loco = pose(sim, 'loco'), w2 = pose(sim, 'w2');
    assert.ok(Math.abs(dist(loco, w2) - (LOCO_LEN / 2 + WAGON_LEN / 2 + COUPLING_GAP)) < 1e-6);
    assert.equal(sim.rakes()[0].vehicles.length, 3);
});

test('stuck wagons never couple', () => {
    const w = wagons(2);
    w[0].stuck = true;
    const sim = createSim(layout, { vehicles: w, rakes: [{ track: 'B', flush: 'b', vehicles: ['w1'] }] });
    sim.setDirection('forward');
    run(sim, 30);
    assert.equal(sim.rakes().length, 2);
    assert.equal(sim.stats.couplings, 0);
    assert.ok(types(sim).includes('bumped'));
    assert.equal(sim.speed, 0);
});

test('points cannot be thrown under a vehicle', () => {
    const sim = createSim(layout, { vehicles: [], loco: { track: 'H', flush: 'b' } });
    assert.equal(sim.togglePoint('P1'), false);
    assert.deepEqual(types(sim), ['pointLocked']);
    assert.equal(sim.points.P1, 'straight');
    assert.equal(sim.togglePoint('P2'), true);
    assert.equal(sim.points.P2, 'diverging');
});

test('a point stays locked while a long rake straddles it', () => {
    const sim = threeOnB();
    sim.setDirection('forward');
    run(sim, 30);
    sim.setDirection('reverse');
    // reverse just far enough for the rake to be spread across P2 (loco on M, wagons still on B)
    for (let i = 0; i < 600; i++) {
        sim.step(1 / 60);
        const onB = sim.onTrack('B').length;
        if (pose(sim, 'loco').track === 'M' && onB > 0) break;
    }
    assert.equal(pose(sim, 'loco').track, 'M');
    assert.equal(sim.togglePoint('P2'), false);
});

test('uncoupling is refused while moving and when wagons would be left in a foul zone', () => {
    const sim = createSim(layout, { vehicles: wagons(3), rakes: [{ track: 'A', flush: 'a', vehicles: ids(1, 2) }, { track: 'B', flush: 'b', vehicles: ['w3'] }] });
    const standing = sim.rakes().find(r => r.vehicles.includes('w1'));
    assert.equal(sim.uncouple(standing.id, 1), false);
    assert.deepEqual(types(sim), ['uncoupleBlocked']);
    const sim2 = threeOnB();
    sim2.setDirection('forward');
    run(sim2, 30);
    sim2.setDirection('reverse');
    run(sim2, 0.2);
    const rake = sim2.rakes()[0];
    assert.equal(sim2.uncouple(rake.id, 1), false);
    assert.ok(types(sim2).includes('uncoupleBlocked'));
});

test('the simulation is deterministic and snapshots restore exactly', () => {
    const script = sim => {
        sim.setDirection('forward'); run(sim, 30);
        sim.setDirection('reverse'); run(sim, 30);
        sim.togglePoint('P1');
        sim.setDirection('forward'); run(sim, 30);
        return sim.poses();
    };
    assert.deepEqual(script(threeOnB()), script(threeOnB()));
    const sim = threeOnB();
    sim.setDirection('forward'); run(sim, 3);
    const snap = sim.snapshot();
    const before = sim.poses();
    run(sim, 30);
    sim.restore(snap);
    assert.deepEqual(sim.poses(), before);
});

test('rake paths stay as long as the vehicles they carry', () => {
    const sim = threeOnB();
    sim.setDirection('forward'); run(sim, 30);
    sim.setDirection('reverse'); run(sim, 30);
    sim.togglePoint('P1');
    sim.setDirection('forward'); run(sim, 30);
    for (const r of sim.rakes()) {
        const span = r.vehicles.reduce((s, id) => s + sim.state.vehicles[id].len, 0) + COUPLING_GAP * (r.vehicles.length - 1);
        assert.ok(Math.abs(pathLength(r.path) - span) < 1e-6);
    }
});
