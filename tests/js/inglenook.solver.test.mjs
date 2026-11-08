import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLayout } from '../../Games.Client/wwwroot/games/inglenook/layouts.js';
import { solveAbstract, applyOps, solveLevel } from '../../Games.Client/wwwroot/games/inglenook/solver.js';

const classic = getLayout('classic');

test('an already-solved yard has par 0', () => {
    const r = solveAbstract(classic, { H: '', tracks: { A: 'abc', B: '_', C: '' } }, 'abc');
    assert.equal(r.par, 0);
    assert.deepEqual(r.ops, []);
});

test('moving a whole siding costs one uncoupling (pull all is free, the push releases)', () => {
    const r = solveAbstract(classic, { H: '', tracks: { A: '', B: 'abc', C: '' } }, 'abc');
    assert.equal(r.par, 1);
    assert.deepEqual(r.ops, [{ type: 'pull', track: 'B', count: 3 }, { type: 'push', track: 'A', count: 3 }]);
});

test('a pull then a push keeps the order, one more reversal restores it', () => {
    const a = applyOps(classic, { H: '', tracks: { A: 'abc', B: '', C: '' } }, [{ type: 'pull', track: 'A', count: 3 }, { type: 'push', track: 'B', count: 3 }]);
    assert.equal(a.state.tracks.B, 'abc');
    assert.equal(a.state.tracks.A, '');
    assert.equal(a.cost, 1);
});

test('taking only part of a siding costs an extra uncoupling', () => {
    const a = applyOps(classic, { H: '', tracks: { A: 'abc', B: '', C: '' } }, [{ type: 'pull', track: 'A', count: 2 }]);
    assert.equal(a.cost, 1);
    assert.equal(a.state.H, 'cb'); // reverse of the top two
});

test('illegal operations are rejected', () => {
    // capacity, carrying while pulling, stuck wagons, too many for the headshunt
    assert.equal(applyOps(classic, { H: '', tracks: { A: '', B: 'abc', C: '' } }, [{ type: 'pull', track: 'B', count: 3 }, { type: 'push', track: 'B', count: 3 }]) !== null, true);
    assert.equal(applyOps(classic, { H: '', tracks: { A: '', B: 'abc', C: 'de_' } }, [{ type: 'pull', track: 'B', count: 3 }, { type: 'push', track: 'C', count: 3 }]), null);
    assert.equal(applyOps(classic, { H: '', tracks: { A: 'ab', B: '_', C: '' } }, [{ type: 'pull', track: 'A', count: 2 }, { type: 'pull', track: 'B', count: 1 }]), null);
    assert.equal(applyOps(classic, { H: '', tracks: { A: '#', B: '', C: '' } }, [{ type: 'pull', track: 'A', count: 1 }]), null);
    assert.equal(applyOps(getLayout('classic-long'), { H: '', tracks: { A: 'abcde', B: '', C: '' } }, [{ type: 'pull', track: 'A', count: 5 }]), null);
});

test('stuck wagons stay put and reduce room', () => {
    const r = solveLevel(classic, { A: [], B: ['s', 'w1', 'w2'], C: [] }, ['w2', 'w1'], new Set(['s']));
    assert.ok(r);
    assert.ok(r.par >= 1);
    const check = applyOps(classic, { H: '', tracks: { A: '', B: '#ba', C: '' } }, r.ops);
    assert.ok(check.state.tracks.A.startsWith('ab'));
});

test('the search gives up beyond its state cap', () => {
    const l = getLayout('ladder5');
    assert.equal(solveAbstract(l, { H: '', tracks: { S1: '__a_b_', S2: '_c_', S3: 'd__', S4: '_e_', S5: '__f' } }, 'abcdef', 50), null);
});
