import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLayout, validateLayout, walk, pointAt, pathFrom, initialPoints, inFoul, pointZones, POINT_FOUL, PATH_STEP, MIN_RADIUS, sidingLength, headshuntLength } from '../../Games.Client/wwwroot/games/inglenook/track.js';
import { getLayout, TEMPLATE_IDS, ROW, TURNOUT_RADIUS, FAN_ANGLE, LADDER_ANGLE } from '../../Games.Client/wwwroot/games/inglenook/layouts.js';

const caps = l => Object.fromEntries(l.sidings.map(id => [id, l.tracks[id].capacity]));
const deg = r => r * 180 / Math.PI;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

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
    assert.equal(getLayout('classic-long').headCapacity, 4);
    assert.deepEqual(caps(getLayout('ladder4')), { S1: 5, S2: 3, S3: 3, S4: 3 });
    assert.equal(getLayout('ladder4').headCapacity, 3);
    assert.deepEqual(caps(getLayout('ladder5')), { S1: 6, S2: 3, S3: 3, S4: 3, S5: 3 });
    assert.equal(getLayout('ladder5').headCapacity, 3);
    const loop = getLayout('loop');
    assert.equal(loop.tracks.L.role, 'loop');
    assert.ok(loop.tracks.L.capacity >= 1);
    assert.equal(loop.tracks.A.capacity, 5);
});

test('curves take their share but every track keeps the length its capacity formula gives', () => {
    const classic = getLayout('classic');
    assert.ok(near(classic.tracks.H.length, headshuntLength(3)));
    assert.ok(near(classic.tracks.A.length, sidingLength(5)));
    assert.ok(near(classic.tracks.M.length, 3));
    assert.ok(near(classic.tracks.B.length, sidingLength(3)));
    assert.ok(near(classic.tracks.C.length, sidingLength(3)));
    const long = getLayout('classic-long');
    assert.ok(near(long.tracks.H.length, headshuntLength(4)));
    assert.ok(near(long.tracks.A.length, sidingLength(7)));
    const diag = Math.hypot(3, ROW);
    for (const [id, capList] of [['ladder4', [5, 3, 3, 3]], ['ladder5', [6, 3, 3, 3, 3]]]) {
        const l = getLayout(id);
        capList.forEach((c, i) => assert.ok(near(l.tracks[`S${i + 1}`].length, sidingLength(c)), `${id} S${i + 1}`));
        for (let i = 1; i < capList.length - 1; i++) assert.ok(near(l.tracks[`L${i}`].length, diag), `${id} L${i}`);
    }
});

test('path builder gives exact arc lengths, end poses and a dense polyline', () => {
    const quarter = pathFrom(0, 0, 0).arc(3, Math.PI / 2).build();
    assert.ok(near(quarter.length, 3 * Math.PI / 2));
    assert.ok(near(quarter.end.x, 3) && near(quarter.end.y, 3), 'a clockwise quarter turn east -> south');
    assert.ok(near(quarter.end.heading, Math.PI / 2));
    assert.ok(near(quarter.pts.at(-1)[0], 3) && near(quarter.pts.at(-1)[1], 3));
    const anti = pathFrom(0, 0, 0).arc(3, -Math.PI / 2).build();
    assert.ok(near(anti.end.x, 3) && near(anti.end.y, -3));
    const mixed = pathFrom(1, 2, 0.3).straight(2).arc(4, 0.6).arc(4, -0.6).straight(1.5).build();
    assert.ok(near(mixed.length, 2 + 4 * 0.6 + 4 * 0.6 + 1.5));
    assert.ok(near(mixed.end.heading, 0.3));
    assert.equal(mixed.pts.length, mixed.hdg.length);
    for (let i = 1; i < mixed.pts.length; i++) {
        const step = Math.hypot(mixed.pts[i][0] - mixed.pts[i - 1][0], mixed.pts[i][1] - mixed.pts[i - 1][1]);
        assert.ok(step <= PATH_STEP + 1e-9, `vertex ${i} is ${step} from the last`);
    }
    // the polyline's own length is within a hair of the exact one
    let chord = 0;
    for (let i = 1; i < mixed.pts.length; i++) chord += Math.hypot(mixed.pts[i][0] - mixed.pts[i - 1][0], mixed.pts[i][1] - mixed.pts[i - 1][1]);
    assert.ok(Math.abs(chord - mixed.length) < 1e-3);
    assert.throws(() => pathFrom(0, 0, 0).arc(0, 1), /radius/);
});

test('buildLayout stretches a built track to its exact length and keeps its headings', () => {
    const t = pathFrom(0, 0, 0).straight(1).arc(3, 1).build();
    const l = buildLayout({ id: 't', goal: 'S', head: 'S', tracks: [{ id: 'S', role: 'siding', ...t }], points: [] });
    assert.ok(near(l.tracks.S.length, t.length));
    assert.ok(near(l.tracks.S.cum.at(-1), t.length));
    assert.ok(near(pointAt(l, 'S', t.length).angle, 1, 1e-9));
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
    const past = pointAt(l, 'H', 999);
    assert.ok(Math.abs(past.x - l.points.P1.x) < 1e-9);
});

test('a turnout leaves its point tangent to the toe and ends parallel to it', () => {
    const l = getLayout('classic');
    const toe = pointAt(l, 'H', l.tracks.H.length).angle;
    const up = pointAt(l, 'A', 0), down = pointAt(l, 'C', 0);
    assert.ok(Math.abs(wrap(up.angle - toe)) < 1e-9, 'A is tangent at P1');
    assert.ok(Math.abs(wrap(down.angle - toe)) < 1e-9, 'C is tangent at P2');
    assert.ok(pointAt(l, 'A', 3.5).angle < -0.05, 'A climbs away from the headshunt');
    assert.ok(pointAt(l, 'C', 3.5).angle > 0.05, 'C falls away from the headshunt');
    const peak = Math.min(...Array.from({ length: 300 }, (_, i) => pointAt(l, 'A', i * l.tracks.A.length / 299).angle));
    assert.ok(Math.abs(deg(peak) + deg(FAN_ANGLE)) < 0.1, 'the steepest part of the reverse curve is the fan angle');
    // parallel at the far end, exactly one ROW from the straight line
    const aEnd = pointAt(l, 'A', l.tracks.A.length), cEnd = pointAt(l, 'C', l.tracks.C.length), bEnd = pointAt(l, 'B', l.tracks.B.length);
    assert.ok(Math.abs(aEnd.angle) < 1e-9 && Math.abs(cEnd.angle) < 1e-9);
    assert.ok(near(aEnd.y, l.points.P1.y - ROW, 1e-6));
    assert.ok(near(cEnd.y, l.points.P2.y + ROW, 1e-6));
    assert.ok(near(bEnd.y, l.points.P2.y, 1e-9));
    assert.ok(2 * TURNOUT_RADIUS * (1 - Math.cos(FAN_ANGLE)) - ROW < 1e-9);
    assert.ok(TURNOUT_RADIUS >= MIN_RADIUS);
});

test('a ladder leaves each point tangent and settles every siding on its own row', () => {
    const l = getLayout('ladder5');
    assert.ok(Math.abs(pointAt(l, 'L1', l.tracks.L1.length).angle + LADDER_ANGLE) < 1e-9, 'the first connector arrives at the ladder angle');
    assert.ok(Math.abs(pointAt(l, 'S2', 0).angle + LADDER_ANGLE) < 1e-9, 'S2 leaves P2 at the ladder angle');
    const rows = [];
    for (let i = 1; i <= 5; i++) {
        const end = pointAt(l, `S${i}`, l.tracks[`S${i}`].length);
        assert.ok(Math.abs(end.angle) < 1e-9, `S${i} ends parallel`);
        rows.push(end.y);
    }
    for (let i = 1; i < rows.length; i++) assert.ok(near(rows[i - 1] - rows[i], ROW, 1e-6), `rows ${i} and ${i + 1} are ${ROW} apart`);
});

test('headings change smoothly along every track', () => {
    for (const id of TEMPLATE_IDS) for (const t of Object.values(getLayout(id).tracks)) {
        let last = pointAt(getLayout(id), t.id, 0).angle;
        for (let d = 0.01; d <= t.length; d += 0.01) {
            const a = pointAt(getLayout(id), t.id, d).angle;
            assert.ok(Math.abs(wrap(a - last)) < 0.01, `${id} ${t.id} at ${d.toFixed(2)}`);
            last = a;
        }
    }
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

/** A sound three-track layout: headshunt H, straight S and a gently curving T. */
function base(radius = 3.5) {
    return {
        id: 't', goal: 'S', head: 'H',
        tracks: [
            { id: 'H', role: 'headshunt', ...pathFrom(0, 0, 0).straight(8).build() },
            { id: 'S', ...pathFrom(8, 0, 0).straight(12).build() },
            { id: 'T', ...pathFrom(8, 0, 0).arc(radius, -0.5).straight(12).build() },
        ],
        points: [{ id: 'P', toe: 'H.b', straight: 'S.a', diverging: 'T.a' }],
    };
}

test('validateLayout catches broken layouts', () => {
    assert.deepEqual(validateLayout(buildLayout(base())), []);
    // legs that do not meet at the toe
    const apart = base();
    apart.tracks[2] = { id: 'T', pts: [[9, 3], [20, 2]] };
    assert.ok(validateLayout(buildLayout(apart)).some(e => e.includes('does not meet')));
    // unreachable track
    const island = base();
    island.tracks.push({ id: 'X', pts: [[0, 5], [5, 5]] });
    assert.ok(validateLayout(buildLayout(island)).some(e => e.includes('not connected')));
    // a siding too short for one wagon
    const short = base();
    short.tracks[1] = { id: 'S', pts: [[8, 0], [9, 0]] };
    assert.ok(validateLayout(buildLayout(short)).some(e => e.includes('holds no wagons')));
    // crossing tracks
    const cross = base();
    cross.tracks.push({ id: 'Z', pts: [[12, -3], [12, 4]] });
    assert.ok(validateLayout(buildLayout(cross)).some(e => e.includes('cross')));
});

test('validateLayout rejects a sharp kink, a tight curve, branches that stay close and a non-tangent leg', () => {
    // a 39 degree kink straight out of the point (the old geometry)
    const kink = base();
    kink.tracks[2] = { id: 'T', pts: [[8, 0], [10.2, -1.8], [20, -1.8]] };
    const kinkErrors = validateLayout(buildLayout(kink));
    assert.ok(kinkErrors.some(e => e.includes('not tangent')), kinkErrors.join('; '));
    assert.ok(kinkErrors.some(e => e.includes('bends')), kinkErrors.join('; '));
    // a curve with a radius of 1: smooth steps are too big and it is tighter than the minimum
    const tight = base(1);
    assert.ok(validateLayout(buildLayout(tight)).some(e => e.includes('bends') || e.includes('tighter')));
    // a curve that is not quite tight enough to flag by step but is below the minimum radius
    const snug = base(2);
    assert.ok(validateLayout(buildLayout(snug)).some(e => e.includes('tighter') || e.includes('bends')));
    // a branch that hardly diverges stays closer than 0.9 at the foul limit
    const shallow = base();
    shallow.tracks[2] = { id: 'T', ...pathFrom(8, 0, 0).arc(3.5, -0.05).straight(12).build() };
    const shallowErrors = validateLayout(buildLayout(shallow));
    assert.ok(shallowErrors.some(e => e.includes('closer than')), shallowErrors.join('; '));
    // a leg that leaves the point at an angle to the toe
    const skew = base();
    skew.tracks[1] = { id: 'S', ...pathFrom(8, 0, 0.1).straight(12).build() };
    assert.ok(validateLayout(buildLayout(skew)).some(e => e.includes('not tangent')));
    // two tracks running too close together
    const close = base();
    close.tracks.push({ id: 'Y', ...pathFrom(8, -0.5, 0).straight(12).build() });
    assert.ok(validateLayout(buildLayout(close)).some(e => e.includes('come within')));
});

test('claiming a track end twice is rejected', () => {
    assert.throws(() => buildLayout({
        id: 't', goal: 'S', head: 'H',
        tracks: [{ id: 'H', pts: [[0, 0], [8, 0]] }, { id: 'S', pts: [[8, 0], [20, 0]] }, { id: 'T', pts: [[8, 0], [20, 2]] }],
        points: [{ id: 'P', toe: 'H.b', straight: 'S.a', diverging: 'T.a' }, { id: 'Q', toe: 'H.b', straight: 'S.b', diverging: 'T.b' }],
    }), /claimed twice/);
});
