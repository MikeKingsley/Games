import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProgress } from '../../Games.Client/wwwroot/games/inglenook/logic.js';

test('missing or damaged progress falls back to the defaults', () => {
    const fresh = { level: 1, best: {}, muted: false };
    assert.deepEqual(normalizeProgress(undefined), fresh);
    assert.deepEqual(normalizeProgress(null), fresh);
    assert.deepEqual(normalizeProgress('garbage'), fresh);
    assert.deepEqual(normalizeProgress({ level: -3, best: 5, muted: 'yes' }), fresh);
    assert.deepEqual(normalizeProgress({ level: 2.5 }), fresh);
});

test('valid progress is kept and bad entries are dropped', () => {
    const p = normalizeProgress({ level: 12, muted: true, best: { 3: { stars: 3, moves: 4 }, x: { stars: 3, moves: 1 }, 4: { stars: 9, moves: 2 }, 5: { stars: 2, moves: -1 }, 6: null } });
    assert.equal(p.level, 12);
    assert.equal(p.muted, true);
    assert.deepEqual(p.best, { 3: { stars: 3, moves: 4 } });
});

test('normalised progress survives a JSON round trip', () => {
    const p = normalizeProgress({ level: 7, best: { 1: { stars: 2, moves: 5 } }, muted: true });
    assert.deepEqual(normalizeProgress(JSON.parse(JSON.stringify(p))), p);
});
