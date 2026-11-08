import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLayout } from '../../Games.Client/wwwroot/games/inglenook/layouts.js';
import { generateLevel, levelParams } from '../../Games.Client/wwwroot/games/inglenook/levels.js';
import { applyOps, labelsFor } from '../../Games.Client/wwwroot/games/inglenook/solver.js';
import { createSim } from '../../Games.Client/wwwroot/games/inglenook/sim.js';
import { buildSetup, checkWin, movesOf, starsFor, abstractFromSim } from '../../Games.Client/wwwroot/games/inglenook/logic.js';
import { playOps } from '../../Games.Client/wwwroot/games/inglenook/autoplay.js';

function startState(level) {
    const layout = getLayout(level.template);
    const stuck = new Set(level.wagons.filter(w => w.stuck).map(w => w.id));
    return { H: '', tracks: Object.fromEntries(layout.sidings.map(id => [id, labelsFor(level.placement[id], level.goal, stuck)])) };
}

test('levels are deterministic', () => {
    for (const n of [1, 7, 20, 33, 61, 150]) assert.deepEqual(generateLevel(n), generateLevel(n));
});

test('level 1 is the small classic inglenook', () => {
    const l = generateLevel(1);
    assert.equal(l.template, 'classic');
    assert.equal(l.wagons.length, 4);
    assert.equal(l.goal.length, 3);
});

test('the difficulty curve grows: layouts, wagons, goal length, obstacles', () => {
    assert.equal(levelParams(10).wagons, 8);
    assert.equal(levelParams(10).goalLen, 5);
    assert.equal(levelParams(10).stuck, 0);
    assert.ok(levelParams(20).stuck >= 1);
    assert.notEqual(levelParams(30).template, 'classic');
    assert.ok(levelParams(70).stuck >= 1);
    for (let n = 1; n <= 200; n++) {
        const p = levelParams(n);
        const layout = getLayout(p.template);
        assert.ok(p.goalLen <= layout.tracks[layout.goal].capacity, `goal fits level ${n}`);
        assert.ok(p.wagons <= layout.sidings.reduce((s, id) => s + layout.tracks[id].capacity, 0), `wagons fit level ${n}`);
    }
});

test('levels 1..200 are valid, unsolved at the start, and their solutions are legal with cost = par', () => {
    const started = Date.now();
    for (let n = 1; n <= 200; n++) {
        const l = generateLevel(n);
        const layout = getLayout(l.template);
        assert.ok(l.par >= 1, `par level ${n}`);
        const ids = l.wagons.map(w => w.id);
        assert.equal(new Set(ids).size, ids.length);
        // every wagon placed exactly once, within capacity, stuck wagons at the bottom
        const placed = layout.sidings.flatMap(s => l.placement[s]);
        assert.deepEqual(placed.slice().sort(), ids.slice().sort(), `placement level ${n}`);
        for (const s of layout.sidings) {
            assert.ok(l.placement[s].length <= layout.tracks[s].capacity);
            const flags = l.placement[s].map(id => l.wagons.find(w => w.id === id).stuck);
            assert.ok(!flags.includes(false) || !flags.slice(flags.indexOf(false)).includes(true), `stuck at bottom level ${n} ${s}`);
        }
        const start = startState(l);
        const replay = applyOps(layout, start, l.solution);
        assert.ok(replay, `solution legal level ${n}`);
        assert.equal(replay.cost, l.par, `cost = par level ${n}`);
        const goalSiding = replay.state.tracks[layout.goal].replace(/#/g, '');
        assert.ok(goalSiding.startsWith('abcdefghijklmnopqrstuvwxyz'.slice(0, l.goal.length)), `goal reached level ${n}`);
    }
    assert.ok(Date.now() - started < 30000, 'generating 200 levels stays fast');
});

test('the real simulation solves levels with exactly par uncouplings', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 8, 10, 15, 22, 25, 30]) {
        const l = generateLevel(n);
        const sim = createSim(getLayout(l.template), buildSetup(l));
        assert.equal(checkWin(sim, l), false, `unsolved at start, level ${n}`);
        playOps(sim, l.solution);
        assert.equal(checkWin(sim, l), true, `won level ${n}`);
        assert.equal(movesOf(sim), l.par, `moves = par level ${n}`);
        const abs = abstractFromSim(sim, l);
        assert.ok(abs.tracks[getLayout(l.template).goal].replace(/#/g, '').startsWith('abcdefghijklmnopqrstuvwxyz'.slice(0, l.goal.length)));
    }
});

test('stars: par or better is three, within 1.5x is two, anything else one', () => {
    assert.equal(starsFor(4, 4), 3);
    assert.equal(starsFor(2, 4), 3);
    assert.equal(starsFor(5, 4), 2);
    assert.equal(starsFor(6, 4), 2);
    assert.equal(starsFor(7, 4), 1);
});

test('win detection ignores wagons elsewhere and needs the exact order', () => {
    const layout = getLayout('classic');
    const level = { template: 'classic', goal: ['w1', 'w2'], wagons: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }] };
    const make = order => createSim(layout, {
        vehicles: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }],
        rakes: [{ track: 'A', flush: 'b', vehicles: order }],
    });
    // A's buffer is at its b end; vehicles are listed by increasing d, so the last is the bottom
    assert.equal(checkWin(make(['w3', 'w2', 'w1']), level), true); // bottom w1, then w2, then w3 above
    assert.equal(checkWin(make(['w3', 'w1', 'w2']), level), false);
    assert.equal(checkWin(make(['w2', 'w1']), level), true);
});
