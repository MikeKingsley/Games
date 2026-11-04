import test from 'node:test';
import assert from 'node:assert/strict';
import { createCamera, ZOOMS } from '../../Games.Client/wwwroot/games/delivery-driver/engine/camera.js';
import * as C from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/camera3d.js';
import { toScreen } from '../../Games.Client/wwwroot/games/delivery-driver/render/projection.js';

const W = 1024, H = 768, view = { width: W, height: H, dpr: 1 };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const flat = () => 0;

/** A settled camera following a vehicle at (x, y, z) with a heading. */
function follow(opts = {}, target = {}) {
    const cam = createCamera();
    Object.assign(cam, opts);
    const t = { x: 100, y: 200, z: 5, heading: 0.3, speed: 0, length: 6, reversing: false, ...target };
    for (let i = 0; i < 120; i++) cam.update(t, view, 1 / 60);
    const out = {};
    C.cameraFromView(out, cam.view3d, W / H, { ground: () => 0 });
    return { cam, out, t };
}
const screenOf = (out, x, y, z) => C.projectPoint(out.vp, x, y, z, W, H);

test('chase mode: the vehicle sits in the lower middle of the screen', () => {
    const { out, t } = follow();
    const s = screenOf(out, t.x, t.y, t.z + 1);
    assert.ok(Math.abs(s.x - W / 2) < W * 0.03, `x ${s.x}`);
    assert.ok(s.y > H * 0.5 && s.y < H * 0.9, `y ${s.y}`);
});

test('rotating the vehicle turns the eye round it', () => {
    const a = follow({}, { heading: 0 }), b = follow({}, { heading: Math.PI / 2 });
    const off = o => [o.out.eye[0] - 100, o.out.eye[1] - 200];
    // behind a vehicle heading east is west (-x); behind one heading south is north (-y)
    assert.ok(off(a)[0] < -5 && Math.abs(off(a)[1]) < 1);
    assert.ok(off(b)[1] < -5 && Math.abs(off(b)[0]) < 1);
    near(Math.hypot(...off(a)), Math.hypot(...off(b)), 1e-3);
});

test('north-up keeps the eye fixed relative to the world axes', () => {
    const a = follow({ mode: 'north' }, { heading: 0 }), b = follow({ mode: 'north' }, { heading: 2.1 });
    for (let i = 0; i < 3; i++) near(a.out.eye[i], b.out.eye[i], 1e-6);
    assert.ok(a.out.eye[1] > 200, 'the eye is south of the vehicle, looking north');
    // north is up the screen: a point north of the vehicle projects above it
    assert.ok(screenOf(a.out, 100, 150, 5).y < screenOf(a.out, 100, 200, 5).y);
    assert.ok(screenOf(a.out, 150, 200, 5).x > screenOf(a.out, 100, 200, 5).x, 'east is to the right');
});

test('zoom and tilt move the eye as expected and clamp', () => {
    const lo = follow({ tilt: 25 }), hi = follow({ tilt: 55 });
    assert.ok(hi.out.eye[2] > lo.out.eye[2]);
    const far = follow({ zoomIndex: 0 }), close = follow({ zoomIndex: ZOOMS.length - 1 });
    assert.ok(Math.hypot(far.out.eye[0] - 100, far.out.eye[1] - 200) > Math.hypot(close.out.eye[0] - 100, close.out.eye[1] - 200));
    const cam = createCamera();
    for (let i = 0; i < 20; i++) cam.tiltUp();
    assert.equal(cam.tilt, C.TILT.max);
    for (let i = 0; i < 20; i++) cam.tiltDown();
    assert.equal(cam.tilt, C.TILT.min);
    cam.cycleTilt();
    assert.ok(cam.tilt > C.TILT.min);
    for (let i = 0; i < 20; i++) cam.cycleTilt();
    assert.ok(cam.tilt >= C.TILT.min && cam.tilt <= C.TILT.max);
});

test('the reversing view is farther and higher, and shows the whole rig including the trailer', () => {
    const rig = 18;
    const fwd = follow({}, { length: rig }), rev = follow({}, { length: rig, reversing: true });
    const dist = o => Math.hypot(o.out.eye[0] - o.t.x, o.out.eye[1] - o.t.y);
    assert.ok(dist(rev) > dist(fwd) && rev.out.eye[2] > fwd.out.eye[2]);
    // the trailer's rear end, `rig` metres behind the cab, projects inside the viewport
    const c = Math.cos(rev.t.heading), s = Math.sin(rev.t.heading);
    for (const [bx, by] of [[rev.t.x - c * rig, rev.t.y - s * rig], [rev.t.x + c * 3, rev.t.y + s * 3]]) {
        const p = screenOf(rev.out, bx, by, rev.t.z + 1);
        assert.ok(p.x > 0 && p.x < W && p.y > 0 && p.y < H, `(${p.x}, ${p.y})`);
    }
});

test('terrain clearance: a hill between the ideal eye and the truck lifts the eye above the terrain', () => {
    const look = [0, 0, 1.2], eye = [-30, 0, 12];
    // a 14 m ridge 12 m behind the truck, nothing else
    const ridge = (x, y) => Math.max(0, 14 - Math.abs(x + 12) * 3);
    const lifted = C.clearTerrain([...eye], look, ridge);
    assert.ok(lifted[2] > eye[2], `lifted to ${lifted[2]}`);
    // the line of sight now clears the ground everywhere
    for (let i = 1; i <= 100; i++) {
        const s = i / 100, x = look[0] + (eye[0] - look[0]) * s, z = look[2] + (lifted[2] - look[2]) * s;
        assert.ok(z >= ridge(x, 0) - 1e-9, `blocked at x=${x}`);
    }
    // flat ground leaves a high eye alone, and the eye never ends up under the ground itself
    assert.equal(C.clearTerrain([-30, 0, 12], look, flat)[2], 12);
    const under = C.clearTerrain([-30, 0, 0], look, () => 20);
    assert.ok(under[2] >= 20 + 2.5);
    // the full camera does it too
    const out = {};
    C.cameraFromView(out, { tx: 0, ty: 0, tz: 0, az: 0, distance: 30, tilt: 0.3, ahead: 0 }, 1.33, { ground: ridge });
    assert.ok(out.eye[2] > ridge(out.eye[0], out.eye[1]) + 2.4);
});

test('screenToGround round-trips with project on flat ground and on a slope', () => {
    const { out } = follow();
    for (const ground of [flat, (x, y) => 0.08 * (x - 100) + 0.05 * (y - 200) + 3]) {
        for (const [px, py] of [[W / 2, H * 0.7], [200, 600], [900, 500], [512, 300]]) {
            const hit = C.screenToGround(out.inv, px, py, W, H, ground);
            assert.ok(hit, `ray at ${px},${py} hits`);
            near(hit.z, ground(hit.x, hit.y), 1e-6);
            const back = C.projectPoint(out.vp, hit.x, hit.y, hit.z, W, H);
            near(back.x, px, 0.5); near(back.y, py, 0.5);
        }
    }
    // a pixel above the horizon (low tilt) never reaches the ground
    assert.equal(C.screenToGround(follow({ tilt: 15 }).out.inv, W / 2, 1, W, H, flat), null);
});

test('the camera exposes screenToGround for both renderers', () => {
    const { cam, out } = follow();
    // Canvas: the oblique inverse
    const p = toScreen(cam.proj, 110, 215, 0);
    const c2 = cam.screenToGround(p.x, p.y);
    near(c2.x, 110, 1e-6); near(c2.y, 215, 1e-6);
    // WebGL: the heightfield ray
    cam.gl = { inv: out.inv, width: W, height: H, ground: flat };
    const s = screenOf(out, 120, 230, 0);
    const g = cam.screenToGround(s.x, s.y);
    near(g.x, 120, 0.01); near(g.y, 230, 0.01);
});

test('the field of view widens on portrait screens; the view follows the target height smoothly', () => {
    assert.ok(C.fovFor(0.6) > C.fovFor(1.6));
    const cam = createCamera();
    cam.update({ x: 0, y: 0, z: 0, heading: 0 }, view, 1 / 60);
    cam.update({ x: 0, y: 0, z: 20, heading: 0 }, view, 1 / 60);
    assert.ok(cam.view3d.tz > 0 && cam.view3d.tz < 20, `${cam.view3d.tz}`);
});

test('clearSolids pulls the camera in short of a building and eases back out when it is clear', () => {
    const wall = (x, y) => (x < -10 && x > -16 && Math.abs(y) < 20 ? 12 : -Infinity); // a 12 m high block behind the truck
    const out = {};
    const view = { tx: 0, ty: 0, tz: 0, az: 0, distance: 30, tilt: 0.3, ahead: 0 };
    C.cameraFromView(out, view, 1.33, { solidTop: wall });
    const boomNow = Math.hypot(out.eye[0] - out.look[0], out.eye[1] - out.look[1]);
    assert.ok(out.boom < 1 && out.boom >= 0.22, `boom ${out.boom}`);
    assert.ok(out.eye[0] > -10 || out.eye[2] > 12 + 1, `eye at x=${out.eye[0]} z=${out.eye[2]} is outside the block`);
    assert.ok(boomNow < 30);
    // moving the truck away from the block: the boom comes back out gradually, never in one jump
    view.tx = 60;
    const seen = [];
    for (let i = 0; i < 30; i++) { C.cameraFromView(out, view, 1.33, { solidTop: wall }); seen.push(out.boom); }
    assert.ok(seen[0] < 1 && seen.at(-1) > seen[0] && seen.every((b, i) => i === 0 || b >= seen[i - 1]));
    // with nothing in the way the boom is full length
    const free = {};
    C.cameraFromView(free, { tx: 0, ty: 0, tz: 0, az: 0, distance: 30, tilt: 0.3, ahead: 0 }, 1.33, { solidTop: () => -Infinity });
    assert.equal(free.boom, 1);
});

test('the flip button swings the chase camera 180 degrees round the truck, and back', () => {
    const cam = createCamera();
    const target = { x: 0, y: 0, z: 0, heading: 0.7, speed: 0, reversing: false, length: 6 };
    const view = { width: 800, height: 600 };
    const settle = () => { for (let i = 0; i < 240; i++) cam.update(target, view, 1 / 60); };
    settle();
    const az0 = cam.view3d.az;
    cam.toggleFlip();
    settle();
    const turned = Math.abs(Math.atan2(Math.sin(cam.view3d.az - az0), Math.cos(cam.view3d.az - az0)));
    assert.ok(Math.abs(turned - Math.PI) < 0.05, `turned ${turned}`);
    cam.toggleFlip();
    settle();
    assert.ok(Math.abs(Math.atan2(Math.sin(cam.view3d.az - az0), Math.cos(cam.view3d.az - az0))) < 0.05);
});
