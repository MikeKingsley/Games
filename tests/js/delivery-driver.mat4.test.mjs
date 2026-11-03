import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/mat4.js';
import { resolveKind } from '../../Games.Client/wwwroot/games/delivery-driver/render/index.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const rand = seed => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
const randomMatrix = r => { const out = m.create(); for (let i = 0; i < 16; i++) out[i] = r() * 2 - 1; return out; };

test('identity leaves points alone and multiplies as a no-op', () => {
    const id = m.create();
    const out = m.transformPoint([0, 0, 0], id, [1, 2, 3]);
    assert.deepEqual([...out], [1, 2, 3]);
    const a = randomMatrix(rand(7));
    const prod = m.multiply(m.create(), id, a);
    for (let i = 0; i < 16; i++) near(prod[i], a[i]);
});

test('multiply is associative', () => {
    const r = rand(11);
    const [a, b, c] = [randomMatrix(r), randomMatrix(r), randomMatrix(r)];
    const left = m.multiply(m.create(), m.multiply(m.create(), a, b), c);
    const right = m.multiply(m.create(), a, m.multiply(m.create(), b, c));
    for (let i = 0; i < 16; i++) near(left[i], right[i]);
});

test('multiply applies the right-hand matrix first', () => {
    const t = m.translation(m.create(), 10, 0, 0);
    const s = m.scaling(m.create(), 2, 2, 2);
    const ts = m.multiply(m.create(), t, s); // scale, then translate
    assert.deepEqual([...m.transformPoint([0, 0, 0], ts, [1, 1, 1])], [12, 2, 2]);
});

test('perspective + lookAt project the look-at target to the NDC centre and a side point off-centre', () => {
    const proj = m.perspective(m.create(), Math.PI / 3, 16 / 9, 0.5, 500);
    const view = m.lookAt(m.create(), [0, -50, 20], [10, 10, 0], [0, 0, 1]);
    const vp = m.multiply(m.create(), proj, view);
    const c = m.transformPoint([0, 0, 0], vp, [10, 10, 0]);
    near(c[0], 0); near(c[1], 0);
    assert.ok(c[2] > -1 && c[2] < 1, 'inside the depth range');
    const behind = m.transformPoint([0, 0, 0], view, [10, -200, 20]);
    assert.ok(behind[2] > 0, 'a point behind the eye has positive view z');
    // a point directly above the target appears higher on screen
    const above = m.transformPoint([0, 0, 0], vp, [10, 10, 5]);
    assert.ok(above[1] > 0);
});

test('lookAt puts the eye at the origin of view space, looking down -z', () => {
    const view = m.lookAt(m.create(), [3, 4, 5], [3, 4, -10], [0, 1, 0]);
    const eye = m.transformPoint([0, 0, 0], view, [3, 4, 5]);
    near(eye[0], 0); near(eye[1], 0); near(eye[2], 0);
    const ahead = m.transformPoint([0, 0, 0], view, [3, 4, -5]);
    near(ahead[2], -10);
});

test('invert(M) * M is the identity', () => {
    const r = rand(23);
    for (let n = 0; n < 5; n++) {
        const a = randomMatrix(r);
        const inv = m.invert(m.create(), a);
        assert.ok(inv);
        const prod = m.multiply(m.create(), inv, a);
        for (let i = 0; i < 16; i++) near(prod[i], i % 5 === 0 ? 1 : 0);
    }
    const vp = m.multiply(m.create(), m.perspective(m.create(), 1, 1.5, 1, 1000), m.lookAt(m.create(), [5, 6, 7], [0, 0, 0], [0, 0, 1]));
    const prod = m.multiply(m.create(), m.invert(m.create(), vp), vp);
    for (let i = 0; i < 16; i++) near(prod[i], i % 5 === 0 ? 1 : 0, 1e-9);
});

test('invert of a singular matrix returns null', () => {
    assert.equal(m.invert(m.create(), new Float64Array(16)), null);
});

test('ortho maps the box corners to the clip cube', () => {
    const o = m.ortho(m.create(), -10, 10, -5, 5, 1, 101);
    assert.deepEqual([...m.transformPoint([0, 0, 0], o, [-10, -5, -1])].map(Math.round), [-1, -1, -1]);
    assert.deepEqual([...m.transformPoint([0, 0, 0], o, [10, 5, -101])].map(Math.round), [1, 1, 1]);
});

test('resolveKind: auto stays on Canvas until the default flip, webgl needs WebGL2', () => {
    assert.equal(resolveKind('canvas2d', true), 'canvas2d');
    assert.equal(resolveKind('webgl', true), 'webgl');
    assert.equal(resolveKind('webgl', false), 'canvas2d');
    assert.equal(resolveKind('auto', true, false), 'canvas2d');
    assert.equal(resolveKind('auto', true, true), 'webgl');
    assert.equal(resolveKind('auto', false, true), 'canvas2d');
    assert.equal(resolveKind(undefined, false, true), 'canvas2d');
});
