import test from 'node:test';
import assert from 'node:assert/strict';
import { createQualityMonitor } from '../../Games.Client/wwwroot/games/inglenook/quality.js';

const feed = (m, ms, count) => { for (let i = 0; i < count; i++) m.sample(ms); };

test('starts high and stays high at 60 fps', () => {
    const m = createQualityMonitor();
    assert.equal(m.level, 'high');
    feed(m, 16.7, 1200); // 20 s
    assert.equal(m.level, 'high');
});

test('steps down after two consecutive slow windows, not one', () => {
    const m = createQualityMonitor();
    feed(m, 30, 70); // just over one 2 s window
    assert.equal(m.level, 'high');
    feed(m, 30, 70);
    assert.equal(m.level, 'low');
});

test('a good window between slow ones resets the count', () => {
    const m = createQualityMonitor();
    feed(m, 30, 70);
    feed(m, 16, 130);
    feed(m, 30, 70);
    assert.equal(m.level, 'high');
});

test('never steps back up', () => {
    const m = createQualityMonitor();
    feed(m, 40, 120);
    assert.equal(m.level, 'low');
    feed(m, 8, 2000);
    assert.equal(m.level, 'low');
});

test('single frames over 250 ms are ignored', () => {
    const m = createQualityMonitor();
    for (let i = 0; i < 20; i++) { m.sample(1000); feed(m, 16, 60); }
    assert.equal(m.level, 'high');
});
