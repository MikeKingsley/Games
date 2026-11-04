import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutoQuality } from '../../Games.Client/wwwroot/games/delivery-driver/render/auto-quality.js';
import { resolveKind } from '../../Games.Client/wwwroot/games/delivery-driver/render/index.js';
import { QUALITY, AUTO_PREFERS_WEBGL } from '../../Games.Client/wwwroot/games/delivery-driver/config.js';
import { viewDistance } from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/camera3d.js';

/** Feeds `seconds` of frames of `ms` each; returns what the last drop request was (and how many there were). */
function run(aq, ms, seconds, quality) {
    const drops = [];
    for (let t = 0; t < seconds * 1000; t += ms) { const d = aq.sample(ms, quality); if (d) drops.push(d); }
    return drops;
}

test('auto quality drops one level after a slow window and never on a fast one', () => {
    assert.deepEqual(run(createAutoQuality(), 16, 30, 'high'), []);
    assert.deepEqual(run(createAutoQuality(), 50, 5.2, 'high'), ['medium']);
    assert.deepEqual(run(createAutoQuality(), 50, 5.2, 'medium'), ['low']);
    assert.deepEqual(run(createAutoQuality(), 50, 30, 'low'), [], 'nothing lower than low, and it never raises');
});

test('auto quality needs the average to stay slow for the whole window, and ignores hitches', () => {
    const aq = createAutoQuality();
    assert.deepEqual(run(aq, 50, 4.5, 'high'), []);
    assert.deepEqual(run(aq, 10, 2, 'high'), [], 'a fast stretch brings the average under the limit');
    const hitchy = createAutoQuality();
    for (let i = 0; i < 100; i++) assert.equal(hitchy.sample(2000, 'high'), null); // hidden tab / load stalls are not counted
    assert.deepEqual(run(hitchy, 16, 10, 'high'), []);
});

test('Auto graphics now picks WebGL when it is available; explicit settings are respected', () => {
    assert.equal(AUTO_PREFERS_WEBGL, true);
    assert.equal(resolveKind('auto', true), 'webgl');
    assert.equal(resolveKind('auto', false), 'canvas2d');
    assert.equal(resolveKind('webgl', false), 'canvas2d');
    assert.equal(resolveKind('canvas2d', true), 'canvas2d');
});

test('quality presets scale the 3D fields monotonically and the view distance follows them', () => {
    const [low, medium, high] = ['low', 'medium', 'high'].map(n => QUALITY[n]);
    for (const k of ['viewDistance', 'shadowMapSize', 'farField', 'traffic', 'trees', 'maxDpr']) {
        assert.ok(low[k] <= medium[k] && medium[k] <= high[k], k);
    }
    assert.equal(low.shadowMapSize, 0);
    assert.equal(low.antialias, false);
    assert.equal(high.antialias, true);
    assert.equal(viewDistance(medium), medium.viewDistance);
    assert.equal(viewDistance({ drawChunks: 3 }), 560, 'presets without the field fall back to the chunk count');
});
