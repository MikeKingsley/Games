import test from 'node:test';
import assert from 'node:assert/strict';
import * as SH from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/shadow.js';
import * as C from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/camera3d.js';
import * as mat4 from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/mat4.js';
import { shadowDirection } from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/sun.js';

const dirOf = (az, el) => [Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)];

test('every point within the fitted radius of the focus lands inside the light-space box', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (const light of [dirOf(2.5, 1.1), dirOf(1, 0.35), dirOf(4, 0.31), [0, 0, 1]]) {
        const focus = [400, -250, 12], R = 70;
        const fit = SH.fitShadow({}, light, focus, R, 1024);
        for (let i = 0; i < 400; i++) {
            const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * R * 0.97, z = (rnd() - 0.5) * 40;
            const p = SH.toLightClip(fit.vp, focus[0] + Math.cos(a) * rr, focus[1] + Math.sin(a) * rr, focus[2] + z);
            // inside x/y (texel snapping can shift the box by half a texel) and in depth
            assert.ok(Math.abs(p[0]) <= 1.005 && Math.abs(p[1]) <= 1.005 && Math.abs(p[2]) <= 1, `${light} -> ${p}`);
        }
    }
});

test('the camera frustum corners within the focus region are inside the box', () => {
    const view = { tx: 100, ty: 100, tz: 0, az: 0.4, distance: 28, tilt: 0.6, ahead: 6 };
    const cam = C.cameraFromView({}, view, 4 / 3, { far: 500 });
    const R = SH.shadowRadius(view.distance);
    const focus = [cam.look[0], cam.look[1], 0];
    const fit = SH.fitShadow({}, dirOf(2.2, 0.9), focus, R, 2048);
    let inside = 0, total = 0;
    for (const nx of [-1, 1]) for (const ny of [-1, 1]) {
        const p0 = mat4.transformPoint([0, 0, 0], cam.inv, [nx, ny, -1]), p1 = mat4.transformPoint([0, 0, 0], cam.inv, [nx, ny, 1]);
        for (let t = 0; t <= 1; t += 0.02) {
            const p = [0, 1, 2].map(i => p0[i] + (p1[i] - p0[i]) * t);
            if (Math.hypot(p[0] - focus[0], p[1] - focus[1]) > R * 0.95 || Math.abs(p[2]) > 30) continue;
            total++;
            const c = SH.toLightClip(fit.vp, p[0], p[1], p[2]);
            if (Math.abs(c[0]) <= 1.01 && Math.abs(c[1]) <= 1.01 && Math.abs(c[2]) <= 1) inside++;
        }
    }
    assert.ok(total > 20 && inside === total, `${inside}/${total}`);
});

test('texel snapping: a fixed world point moves across the map in whole texels, so sub-texel camera moves do not shimmer', () => {
    const light = dirOf(2.2, 0.9), R = 60, size = 1024, texel = 2 * R / size;
    assert.ok(Math.abs(SH.fitShadow({}, light, [100, 200, 5], R, size).texel - texel) < 1e-12);
    // a fixed world point moves across the map in whole texels as the focus moves
    const p = [130, 190, 3];
    const base = SH.toLightClip(SH.fitShadow({}, light, [100, 200, 5], R, size).vp, ...p);
    for (const dx of [0.2, 0.9, 3.3]) {
        const q = SH.toLightClip(SH.fitShadow({}, light, [100 + dx, 200, 5], R, size).vp, ...p);
        const du = ((q[0] - base[0]) * 0.5) * size, dv = ((q[1] - base[1]) * 0.5) * size;
        assert.ok(Math.abs(du - Math.round(du)) < 1e-4 && Math.abs(dv - Math.round(dv)) < 1e-4, `${du}, ${dv} texels`);
    }
});

test('radius grows with camera distance within limits and the box is deep enough for tall things', () => {
    assert.equal(SH.shadowRadius(5), 45);
    assert.equal(SH.shadowRadius(1000), 130);
    assert.ok(SH.shadowRadius(30) > SH.shadowRadius(20));
    const fit = SH.fitShadow({}, dirOf(1, 1), [0, 0, 0], 50, 1024, 200);
    const a = SH.toLightClip(fit.vp, 0, 0, 150), b = SH.toLightClip(fit.vp, 0, 0, -150);
    assert.ok(Math.abs(a[2]) <= 1 && Math.abs(b[2]) <= 1);
});

test('the shadow pass uses a direction clamped to a usable elevation, and the presets are ordered', () => {
    const d = shadowDirection(dirOf(1, 0.02));
    assert.ok(d[2] > 0.3);
    const fit = SH.fitShadow({}, d, [0, 0, 0], 60, 1024);
    assert.ok(fit.vp.every(Number.isFinite));
    assert.ok(SH.SHADOW_SIZE.low === 0 && SH.SHADOW_SIZE.medium < SH.SHADOW_SIZE.high);
});
