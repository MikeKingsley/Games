import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLayout, validateLayout, walk, pointAt, initialPoints, inFoul, pointZones, POINT_FOUL, sidingLength } from '../../Games.Client/wwwroot/games/inglenook/track.js';
import { getLayout, TEMPLATE_IDS } from '../../Games.Client/wwwroot/games/inglenook/layouts.js';

const caps = l => Object.fromEntries(l.sidings.map(id => [id, l.tracks[id].capacity]));

test('every template is a sound layout', () => {
    for (const id of TEMPLATE_IDS) assert.deepEqual(validateLayout(getLayout(id)), [], id);
});

test('classic inglenook holds 5, 3 and 3 wagons and loco plus 3 in the headshunt', () => {
    const l = getLayout('classic');
    assert.deepEqual(caps(l), { A: 5, B: 3, C: 3 });
    assert.equal(l.headCapacity, 3);
    assert.equal(l.tracks.M.capacity, 0); // the connector between the points holds nothing
    assert.equal(l.goal, 'A');
});

test('other templates have their intended capacities', () => {
    assert.deepEqual(caps(getLayout('classic-long')), { A: 7, B: 4, C: 4 });
    assert.deepEqual(caps(getLayout('ladder4')), { S1: 5, S2: 3, S3: 3, S4: 3 });
    assert.deepEqual(caps(getLayout('ladder5')), { S1: 6, S2: 3, S3: 3, S4: 3, S5: 3 });
    const loop = getLayout('loop');
    assert.equal(loop.tracks.L.role, 'loop');
    assert.ok(loop.tracks.L.capacity >= 1);
    assert.equal(loop.tracks.A.capacity, 5);
});

test('walking from the headshunt follows the point settings', () => {
    const l = getLayout('classic');
    const start = { track: 'H', d: 1, dir: 1 };
    const state = initialPoints(l);
    let r = walk(l, start, 100, state);
    assert.equal(r.pos.track, 'B');
    assert.equal(r.blocked, 'buffer');
    assert.ok(Math.abs(r.pos.d - l.tracks.B.length) < 1e-9);
    r = walk(l, start, 100, { ...state, P1: 'diverging' });
    assert.equal(r.pos.track, 'A');
    r = walk(l, start, 100, { ...state, P2: 'diverging' });
    assert.equal(r.pos.track, 'C');
});

test('trailing moves pass to the toe whatever the point is set to', () => {
    const l = getLayout('classic');
    const back = { track: 'B', d: 2, dir: -1 };
    for (const p1 of ['straight', 'diverging']) for (const p2 of ['straight', 'diverging']) {
        const r = walk(l, back, 100, { P1: p1, P2: p2 });
        assert.equal(r.pos.track, 'H');
        assert.equal(r.pos.d, 0);
        assert.equal(r.blocked, 'buffer');
    }
    const fromA = walk(l, { track: 'A', d: 3.5, dir: -1 }, 100, { P1: 'straight', P2: 'straight' });
    assert.equal(fromA.pos.track, 'H');
});

test('walk reports distance moved and contiguous pieces', () => {
    const l = getLayout('classic');
    const r = walk(l, { track: 'H', d: 1, dir: 1 }, 11, initialPoints(l));
    const summed = r.pieces.reduce((s, p) => s + Math.abs(p.to - p.from), 0);
    assert.ok(Math.abs(summed - 11) < 1e-9);
    assert.ok(Math.abs(r.moved - 11) < 1e-9);
    assert.equal(r.blocked, null);
    assert.deepEqual(r.pieces.map(p => p.track), ['H', 'M', 'B']);
    const stopped = walk(l, { track: 'B', d: l.tracks.B.length - 1, dir: 1 }, 5, initialPoints(l));
    assert.ok(Math.abs(stopped.moved - 1) < 1e-9);
    assert.equal(stopped.blocked, 'buffer');
});

test('zero or tiny moves do nothing odd', () => {
    const l = getLayout('classic');
    const r = walk(l, { track: 'H', d: 1, dir: 1 }, 0, initialPoints(l));
    assert.deepEqual(r.pos, { track: 'H', d: 1, dir: 1 });
    assert.deepEqual(r.pieces, []);
});

test('pointAt interpolates positions and headings', () => {
    const l = getLayout('classic');
    const a = pointAt(l, 'H', 0);
    assert.equal(a.angle, 0);
    const mid = pointAt(l, 'H', 1);
    assert.ok(Math.abs(mid.x - (a.x + 1)) < 1e-9 && mid.y === a.y);
    const slant = pointAt(l, 'A', 1);
    assert.ok(slant.angle < 0); // A climbs away from the headshunt line
    const past = pointAt(l, 'H', 999);
    assert.ok(Math.abs(past.x - l.points.P1.x) < 1e-9);
});

test('foul zones sit beside every point leg', () => {
    const l = getLayout('classic');
    assert.ok(inFoul(l, 'H', l.tracks.H.length - 1));
    assert.ok(!inFoul(l, 'H', 1));
    assert.ok(!inFoul(l, 'A', POINT_FOUL + 0.5, POINT_FOUL + 1.5));
    assert.ok(inFoul(l, 'A', 1));
    assert.equal(pointZones(l, 'P1').length, 3);
    // a buffer end has no foul zone
    assert.ok(!inFoul(l, 'A', l.tracks.A.length));
});

test('sidingLength round-trips to the capacity it was built for', () => {
    for (let n = 1; n <= 8; n++) {
        const l = buildLayout({
            id: 't', goal: 'S', head: 'H',
            tracks: [{ id: 'H', role: 'headshunt', pts: [[0, 0], [8, 0]] }, { id: 'S', pts: [[8, 0], [8 + sidingLength(n), 0]] }, { id: 'T', pts: [[8, 0], [10, 2]] }],
            points: [{ id: 'P', toe: 'H.b', straight: 'S.a', diverging: 'T.a' }],
        });
        assert.equal(l.tracks.S.capacity, n);
    }
});

test('validateLayout catches broken layouts', () => {
    const base = {
        id: 't', goal: 'S', head: 'H',
        tracks: [{ id: 'H', role: 'headshunt', pts: [[0, 0], [8, 0]] }, { id: 'S', pts: [[8, 0], [20, 0]] }, { id: 'T', pts: [[8, 0], [20, 2]] }],
        points: [{ id: 'P', toe: 'H.b', straight: 'S.a', diverging: 'T.a' }],
    };
    assert.deepEqual(validateLayout(buildLayout(base)), []);
    // legs that do not meet at the toe
    const apart = structuredClone(base);
    apart.tracks[2].pts = [[9, 3], [20, 2]];
    assert.ok(validateLayout(buildLayout(apart)).some(e => e.includes('does not meet')));
    // unreachable track
    const island = structuredClone(base);
    island.tracks.push({ id: 'X', pts: [[0, 5], [5, 5]] });
    assert.ok(validateLayout(buildLayout(island)).some(e => e.includes('not connected')));
    // a siding too short for one wagon
    const short = structuredClone(base);
    short.tracks[1].pts = [[8, 0], [9, 0]];
    assert.ok(validateLayout(buildLayout(short)).some(e => e.includes('holds no wagons')));
    // crossing tracks
    const cross = structuredClone(base);
    cross.tracks.push({ id: 'Z', pts: [[12, -2], [12, 4]] });
    assert.ok(validateLayout(buildLayout(cross)).some(e => e.includes('cross')));
});

test('claiming a track end twice is rejected', () => {
    assert.throws(() => buildLayout({
        id: 't', goal: 'S', head: 'H',
        tracks: [{ id: 'H', pts: [[0, 0], [8, 0]] }, { id: 'S', pts: [[8, 0], [20, 0]] }, { id: 'T', pts: [[8, 0], [20, 2]] }],
        points: [{ id: 'P', toe: 'H.b', straight: 'S.a', diverging: 'T.a' }, { id: 'Q', toe: 'H.b', straight: 'S.b', diverging: 'T.b' }],
    }), /claimed twice/);
});
