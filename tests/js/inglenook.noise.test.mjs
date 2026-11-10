import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash, rng, tileNoise } from '../../Games.Client/wwwroot/games/inglenook/noise.js';

test('hash and rng are deterministic', () => {
    assert.equal(hash('ballast'), hash('ballast'));
    assert.notEqual(hash('ballast'), hash('cinder'));
    const a = rng(7), b = rng(7), c = rng(8);
    const seqA = [a(), a(), a()], seqB = [b(), b(), b()], seqC = [c(), c(), c()];
    assert.deepEqual(seqA, seqB);
    assert.notDeepEqual(seqA, seqC);
    assert.deepEqual([rng('x')(), rng('x')()].length, 2);
    for (let i = 0; i < 1000; i++) { const v = a(); assert.ok(v >= 0 && v < 1); }
});

test('tileNoise is deterministic and in range', () => {
    const n1 = tileNoise(64, 3, 4), n2 = tileNoise(64, 3, 4), n3 = tileNoise(64, 4, 4);
    assert.equal(n1.length, 64 * 64);
    assert.deepEqual(Array.from(n1), Array.from(n2));
    assert.notDeepEqual(Array.from(n1), Array.from(n3));
    let min = 1, max = 0;
    for (const v of n1) { assert.ok(v >= 0 && v <= 1); min = Math.min(min, v); max = Math.max(max, v); }
    assert.ok(max - min > 0.2, 'noise has some contrast');
});

test('tileNoise tiles: opposite edges join as smoothly as interior neighbours', () => {
    const size = 128, n = tileNoise(size, 11, 4);
    let interior = 0, edge = 0, count = 0;
    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size - 1; j++) {
            interior = Math.max(interior, Math.abs(n[i * size + j + 1] - n[i * size + j]), Math.abs(n[(j + 1) * size + i] - n[j * size + i]));
        }
        edge = Math.max(edge, Math.abs(n[i * size] - n[i * size + size - 1]), Math.abs(n[i] - n[(size - 1) * size + i]));
        count++;
    }
    assert.ok(edge <= interior * 1.01 + 1e-6, `wrap step ${edge} should not exceed the largest interior step ${interior}`);
});
