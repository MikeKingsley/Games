import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createLoop, STEP, MAX_STEPS } from '../../Games.Client/wwwroot/games/delivery-driver/engine/loop.js';
import { pedals, smoothSteer } from '../../Games.Client/wwwroot/games/delivery-driver/engine/input.js';
import { createProjection, setProjection, toScreen, toWorld } from '../../Games.Client/wwwroot/games/delivery-driver/render/projection.js';
import { createCamera, chaseRotation, wrapAngle } from '../../Games.Client/wwwroot/games/delivery-driver/engine/camera.js';
import { latLonToWorld, worldToLatLon } from '../../Games.Client/wwwroot/games/delivery-driver/config.js';

function fakeLoop() {
    let t = 0;
    const frames = [];
    let steps = 0;
    const loop = createLoop({
        step: () => steps++,
        render: alpha => frames.push(alpha),
        now: () => t,
        raf: cb => { frames.pending = cb; return 1; },
        caf: () => {},
    });
    return { loop, advanceBy: dt => { t += dt; frames.pending(); }, get steps() { return steps; }, frames };
}

test('the loop runs exactly N fixed steps for a simulated elapsed time', () => {
    const f = fakeLoop();
    f.loop.start();
    for (let i = 0; i < 120; i++) f.advanceBy(1 / 60); // two seconds of 60 fps frames
    assert.equal(f.steps, 120);
    const g = fakeLoop();
    g.loop.start();
    for (let i = 0; i < 60; i++) g.advanceBy(1 / 30); // 30 fps: two steps per frame
    assert.equal(g.steps, 120);
});

test('the loop clamps the spiral of death to MAX_STEPS per frame', () => {
    const r = advance(0, 2); // a 2 s stall
    assert.equal(r.steps, MAX_STEPS);
    assert.equal(r.accumulator, 0);
    const f = fakeLoop();
    f.loop.start();
    f.advanceBy(10);
    assert.equal(f.steps, MAX_STEPS);
});

test('advance keeps the remainder and reports the interpolation alpha', () => {
    const r = advance(0, STEP * 2.5);
    assert.equal(r.steps, 2);
    assert.ok(Math.abs(r.alpha - 0.5) < 1e-6);
});

test('a stopped loop renders nothing more', () => {
    const f = fakeLoop();
    f.loop.start();
    f.advanceBy(1 / 60);
    f.loop.stop();
    const before = f.frames.length;
    f.frames.pending();
    assert.equal(f.frames.length, before);
});

function roundTrip(p) {
    for (let i = 0; i < 200; i++) {
        const x = (i * 37.3) % 400 - 200, y = (i * 91.7) % 300 - 150;
        const s = toScreen(p, x, y, 0, {});
        const w = toWorld(p, s.x, s.y, {});
        assert.ok(Math.abs(w.x - x) < 1e-6 && Math.abs(w.y - y) < 1e-6, `(${x},${y}) -> (${w.x},${w.y})`);
    }
}

test('projection round-trips world to screen to world in north-up and chase modes', () => {
    const view = { width: 1024, height: 768 };
    for (const mode of ['north', 'chase']) {
        const cam = createCamera();
        cam.mode = mode;
        for (const heading of [0, 1.1, -2.4, Math.PI]) {
            cam.update({ x: 12.5, y: -40, heading, speed: 5 }, view, 1 / 60);
            roundTrip(cam.proj);
        }
    }
    const p = setProjection(createProjection(), { cx: 3, cy: 4, rot: 0.7, zoom: 5.5, ox: 400, oy: 300 });
    roundTrip(p);
});

test('chase mode points the heading straight up the screen', () => {
    for (const heading of [0, 0.5, 2, -1.3]) {
        const p = setProjection(createProjection(), { cx: 0, cy: 0, rot: chaseRotation(heading), zoom: 10, ox: 0, oy: 0 });
        const s = toScreen(p, Math.cos(heading) * 10, Math.sin(heading) * 10, 0, {});
        assert.ok(Math.abs(s.x) < 1e-9 && s.y < 0, `${heading}: ${s.x},${s.y}`);
    }
});

test('heights lift points up the screen', () => {
    const p = setProjection(createProjection(), { cx: 0, cy: 0, rot: 0, zoom: 10, ox: 0, oy: 0 });
    assert.ok(toScreen(p, 0, 0, 5, {}).y < toScreen(p, 0, 0, 0, {}).y);
});

test('wrapAngle stays within (-PI, PI]', () => {
    for (const a of [0, 7, -7, 3 * Math.PI, -3 * Math.PI + 0.1]) {
        const w = wrapAngle(a);
        assert.ok(w > -Math.PI - 1e-9 && w <= Math.PI + 1e-9);
        assert.ok(Math.abs(Math.sin(w) - Math.sin(a)) < 1e-9 && Math.abs(Math.cos(w) - Math.cos(a)) < 1e-9);
    }
});

test('pedals: back brakes while moving, then selects reverse at a standstill', () => {
    assert.deepEqual(pedals(false, true, 5, false), { throttle: 0, brake: 1, reverse: false });
    assert.deepEqual(pedals(false, true, 0, false), { throttle: 1, brake: 0, reverse: true });
    assert.deepEqual(pedals(true, false, -3, true), { throttle: 0, brake: 1, reverse: true });
    assert.deepEqual(pedals(true, false, 0, true), { throttle: 1, brake: 0, reverse: false });
});

test('keyboard steering is rate limited and self-centres', () => {
    let s = 0;
    s = smoothSteer(s, 1, 0.1);
    assert.ok(s > 0 && s < 1);
    for (let i = 0; i < 20; i++) s = smoothSteer(s, 1, 0.1);
    assert.equal(s, 1);
    for (let i = 0; i < 20; i++) s = smoothSteer(s, 0, 0.1);
    assert.equal(s, 0);
});

test('lat/long projection round-trips', () => {
    const origin = { lat: 50.5, lon: -4.5 };
    const w = latLonToWorld(50.72, -3.53, origin);
    const back = worldToLatLon(w.x, w.y, origin);
    assert.ok(Math.abs(back.lat - 50.72) < 1e-9 && Math.abs(back.lon + 3.53) < 1e-9);
    assert.ok(w.x > 0 && w.y < 0, 'Exeter is east and north of the origin');
});
