// Track graph for Inglenook. DOM-free.
//
// Units are wagon lengths. A layout is a set of tracks (polylines) joined by points (switches).
//   - A track has two ends, 'a' (start of its polyline) and 'b' (end). An end is a buffer stop unless a point claims it.
//   - A point has three legs: 'toe' (the single end) and two branches, 'straight' and 'diverging'. Each leg is one track end.
//   - Moving from the toe goes onto the branch the point is set to. Moving from either branch always passes to the toe:
//     a trailing move never derails, whatever the point is set to (design decision: no fail states).
//   - A position is { track, d, dir }: d is the distance from the start of the track, dir is +1 (towards end 'b') or -1.
//   - Near a point every leg has a "foul zone" (POINT_FOUL long). Vehicles may pass through it but may not be left standing in
//     it (uncoupling is refused there) and a point cannot be thrown while a vehicle is in its zones.
//   - Track centre-lines are built from straights and circular arcs (see pathFrom); every leg leaves its point tangent to the toe.
import { COUPLING_GAP, LOCO_LEN, WAGON_LEN } from './config.js';

export const POINT_FOUL = 2.9;
export const POINT_CLEAR = 0.5; // a point cannot be thrown while a vehicle is this close to it
export const PITCH = WAGON_LEN + COUPLING_GAP; // length one coupled wagon takes up
export const LEGS = ['toe', 'straight', 'diverging'];
export const PATH_STEP = 0.05; // longest distance between two vertices of a built path
export const MIN_RADIUS = 3.0; // tightest curve a layout may use (wagon lengths)
export const MIN_SEPARATION = 0.9; // centre-line distance between parallel or diverging tracks
const EPS = 1e-6;
const BUFFER_SLACK = 0.05;
const SAMPLE = 0.25; // spacing of the samples used by the pairwise geometry checks
const MAX_TURN = 2 * Math.PI / 180; // largest heading change between two neighbouring vertices
const TANGENT_TOL = 0.5 * Math.PI / 180;

/** Length of a siding with one point end that holds exactly `n` wagons. */
export const sidingLength = n => POINT_FOUL + n * PITCH - COUPLING_GAP + BUFFER_SLACK;
/** Length of a headshunt (point at its b end) that holds the loco plus `n` wagons. */
export const headshuntLength = n => POINT_FOUL + LOCO_LEN + n * PITCH + BUFFER_SLACK;

const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Builds a track centre-line from straights and circular arcs, starting at (x, y) heading `heading` (radians; y grows downwards, so
 * a positive turn is clockwise on screen):
 *   pathFrom(x, y, heading).straight(len).arc(radius, angle)....build()
 * build() returns { pts, hdg, length, end: { x, y, heading } }: a dense polyline (vertices at most `step` apart), the heading at each
 * vertex, the exact (analytic) length and the exact end pose. A track spec can be spread straight from it.
 */
export function pathFrom(x, y, heading = 0, step = PATH_STEP) {
    let px = x, py = y, h = heading, len = 0;
    const pts = [[x, y]], hdg = [heading];
    const api = {
        straight(l) {
            if (l < 0) throw new Error('straight length must not be negative');
            if (l < 1e-12) return api;
            const n = Math.ceil(l / step - 1e-9);
            const x0 = px, y0 = py;
            for (let i = 1; i <= n; i++) {
                pts.push([x0 + Math.cos(h) * l * i / n, y0 + Math.sin(h) * l * i / n]);
                hdg.push(h);
            }
            px = pts[pts.length - 1][0]; py = pts[pts.length - 1][1];
            len += l;
            return api;
        },
        arc(radius, angle) {
            if (!(radius > 0)) throw new Error('arc radius must be positive');
            if (Math.abs(angle) < 1e-12) return api;
            const sg = Math.sign(angle);
            const cx = px - sg * radius * Math.sin(h), cy = py + sg * radius * Math.cos(h); // circle centre
            const arcLen = radius * Math.abs(angle);
            const n = Math.ceil(arcLen / step - 1e-9);
            const h0 = h;
            for (let i = 1; i <= n; i++) {
                const psi = h0 + angle * i / n;
                pts.push([cx + sg * radius * Math.sin(psi), cy - sg * radius * Math.cos(psi)]);
                hdg.push(psi);
            }
            h = h0 + angle;
            px = pts[pts.length - 1][0]; py = pts[pts.length - 1][1];
            len += arcLen;
            return api;
        },
        build() { return { pts, hdg, length: len, end: { x: px, y: py, heading: h } }; },
    };
    return api;
}

/** Headings at the vertices of a plain polyline (central difference inside, segment direction at the ends). */
function headingsOf(pts) {
    return pts.map((p, i) => {
        const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
        return Math.atan2(b[1] - a[1], b[0] - a[0]);
    });
}

function parseRef(ref) {
    const [track, end] = ref.split('.');
    if (end !== 'a' && end !== 'b') throw new Error(`bad track end reference "${ref}"`);
    return { track, end };
}

/**
 * Build a layout from a spec:
 * { id, name, goal: trackId, head: trackId, tracks: [{ id, role, pts: [[x,y],...], hdg?: [heading per vertex], length?: exact length }],
 *   points: [{ id, toe: 'T.b', straight: 'U.a', diverging: 'V.a' }] }
 * role is 'headshunt' | 'siding' | 'loop' | 'connector'. `pathFrom(...).build()` gives pts, hdg and length ready to spread into a track.
 * Without `hdg` the headings are taken from the polyline. With `length` the polyline is stretched by the (tiny) difference between its
 * chord length and the exact arc length, so a track is exactly as long as its design says.
 */
export function buildLayout(spec) {
    const tracks = {};
    for (const t of spec.tracks) {
        const cum = [0];
        for (let i = 1; i < t.pts.length; i++) {
            cum.push(cum[i - 1] + Math.hypot(t.pts[i][0] - t.pts[i - 1][0], t.pts[i][1] - t.pts[i - 1][1]));
        }
        if (t.length > 0 && cum[cum.length - 1] > 0) {
            const k = t.length / cum[cum.length - 1];
            for (let i = 0; i < cum.length; i++) cum[i] *= k;
            cum[cum.length - 1] = t.length;
        }
        tracks[t.id] = {
            id: t.id, role: t.role ?? 'siding', pts: t.pts, hdg: t.hdg ?? headingsOf(t.pts), cum, length: cum[cum.length - 1],
            ends: { a: { type: 'buffer' }, b: { type: 'buffer' } }, foul: { a: 0, b: 0 }, capacity: 0,
        };
    }
    const points = {};
    for (const p of spec.points) {
        const legs = { toe: parseRef(p.toe), straight: parseRef(p.straight), diverging: parseRef(p.diverging) };
        for (const leg of LEGS) {
            const { track, end } = legs[leg];
            if (!tracks[track]) throw new Error(`point ${p.id} leg ${leg}: unknown track ${track}`);
            if (tracks[track].ends[end].type !== 'buffer') throw new Error(`track end ${track}.${end} is claimed twice`);
            tracks[track].ends[end] = { type: 'point', point: p.id, leg };
            tracks[track].foul[end] = POINT_FOUL;
        }
        const [x, y] = endXY(tracks[legs.toe.track], legs.toe.end);
        points[p.id] = { id: p.id, x, y, legs };
    }
    for (const t of Object.values(tracks)) {
        const clear = t.length - t.foul.a - t.foul.b;
        if (t.role === 'headshunt') t.capacity = Math.max(0, Math.floor((clear - LOCO_LEN) / PITCH + 1e-9));
        else if (t.role === 'siding' || t.role === 'loop') t.capacity = Math.max(0, Math.floor((clear + COUPLING_GAP) / PITCH + 1e-9));
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of Object.values(tracks)) for (const [x, y] of t.pts) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const margin = 2.5;
    const head = tracks[spec.head];
    return {
        id: spec.id, name: spec.name, tracks, points, goal: spec.goal, head: spec.head,
        sidings: Object.values(tracks).filter(t => t.capacity > 0 && t.role !== 'headshunt').map(t => t.id),
        locoStart: { track: spec.head, d: LOCO_LEN / 2 + BUFFER_SLACK, dir: 1 },
        pointIds: Object.keys(points),
        bounds: { x: minX - margin, y: minY - margin, w: maxX - minX + 2 * margin, h: maxY - minY + 2 * margin },
        headCapacity: head ? head.capacity : 0,
    };
}

export function endXY(track, end) {
    return end === 'a' ? track.pts[0] : track.pts[track.pts.length - 1];
}

/** Initial point state: every point set straight. */
export function initialPoints(layout) {
    const s = {};
    for (const id of layout.pointIds) s[id] = 'straight';
    return s;
}

/** World position and heading (radians, along +d) at distance d on a track. The heading is interpolated between vertices. */
export function pointAt(layout, trackId, d) {
    const t = layout.tracks[trackId];
    const dd = Math.min(Math.max(d, 0), t.length);
    let lo = 1, hi = t.cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (t.cum[mid] < dd) lo = mid + 1; else hi = mid; }
    const i = lo;
    const [x0, y0] = t.pts[i - 1];
    const [x1, y1] = t.pts[i];
    const segLen = t.cum[i] - t.cum[i - 1];
    const f = segLen > 0 ? (dd - t.cum[i - 1]) / segLen : 0;
    const a0 = t.hdg[i - 1];
    return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, angle: a0 + wrapAngle(t.hdg[i] - a0) * f };
}

/**
 * Move `dist` (>= 0) along `pos.dir`, through points set by `state` ({ pointId: 'straight'|'diverging' }).
 * Returns { pos, moved, blocked, pieces }: blocked is 'buffer' when a buffer stop ended the move early, and pieces lists every
 * stretch travelled as { track, from, to } (from -> to, sign gives direction), which the simulation uses to extend a rake's path.
 */
export function walk(layout, pos, dist, state) {
    let { track, d, dir } = pos;
    let remaining = dist;
    const pieces = [];
    let blocked = null;
    for (let guard = 0; guard < 64 && remaining > EPS; guard++) {
        const t = layout.tracks[track];
        const target = dir > 0 ? t.length : 0;
        const room = Math.abs(target - d);
        if (remaining <= room + EPS) {
            const nd = d + dir * Math.min(remaining, room);
            if (Math.abs(nd - d) > 0) pieces.push({ track, from: d, to: nd });
            d = nd;
            remaining = 0;
            break;
        }
        if (room > 0) pieces.push({ track, from: d, to: target });
        remaining -= room;
        d = target;
        const end = t.ends[dir > 0 ? 'b' : 'a'];
        if (end.type === 'buffer') { blocked = 'buffer'; break; }
        const point = layout.points[end.point];
        const exitLeg = end.leg === 'toe' ? (state[end.point] ?? 'straight') : 'toe';
        const exit = point.legs[exitLeg];
        track = exit.track;
        d = exit.end === 'a' ? 0 : layout.tracks[track].length;
        dir = exit.end === 'a' ? 1 : -1;
    }
    return { pos: { track, d, dir }, moved: dist - remaining, blocked, pieces };
}

/** Intervals of the three legs of a point within `size` of it (default: the foul zone). */
export function pointZones(layout, pointId, size = POINT_FOUL) {
    return LEGS.map(leg => {
        const { track, end } = layout.points[pointId].legs[leg];
        const t = layout.tracks[track];
        return end === 'a' ? { track, from: 0, to: Math.min(size, t.length) } : { track, from: Math.max(0, t.length - size), to: t.length };
    });
}

/** True if the stretch [d0, d1] of a track overlaps a foul zone beside a point. */
export function inFoul(layout, trackId, d0, d1 = d0) {
    const t = layout.tracks[trackId];
    const lo = Math.min(d0, d1), hi = Math.max(d0, d1);
    if (t.foul.a > 0 && lo < t.foul.a - EPS) return true;
    if (t.foul.b > 0 && hi > t.length - t.foul.b + EPS) return true;
    return false;
}

function segmentsCross(p1, p2, p3, p4) {
    const o = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const d1 = o(p3, p4, p1), d2 = o(p3, p4, p2), d3 = o(p1, p2, p3), d4 = o(p1, p2, p4);
    return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

/** Samples of a track every `step` (ends included): [{ d, x, y }]. */
function samples(layout, track, step) {
    const out = [];
    for (let d = 0; d < track.length - 1e-9; d += step) { const p = pointAt(layout, track.id, d); out.push({ d, x: p.x, y: p.y }); }
    const e = pointAt(layout, track.id, track.length);
    out.push({ d: track.length, x: e.x, y: e.y });
    return out;
}

/** Heading of a track end, pointing from the track into the point that claims it. */
const intoPoint = (t, end) => (end === 'a' ? t.hdg[0] + Math.PI : t.hdg[t.hdg.length - 1]);

/** Returns a list of problems (empty when the layout is sound). */
export function validateLayout(layout) {
    const errors = [];
    const ids = Object.keys(layout.tracks);
    for (const t of Object.values(layout.tracks)) {
        if (!(t.length > 0)) errors.push(`track ${t.id} has no length`);
    }
    for (const p of Object.values(layout.points)) {
        for (const leg of LEGS) {
            const { track, end } = p.legs[leg];
            const [x, y] = endXY(layout.tracks[track], end);
            if (Math.hypot(x - p.x, y - p.y) > 1e-6) errors.push(`point ${p.id} leg ${leg} does not meet the toe`);
        }
    }
    // tangent continuity: each branch runs away from the point exactly in the direction the toe track runs into it
    for (const p of Object.values(layout.points)) {
        const arriving = intoPoint(layout.tracks[p.legs.toe.track], p.legs.toe.end); // direction of travel from the toe into the point
        for (const leg of ['straight', 'diverging']) {
            const t = layout.tracks[p.legs[leg].track];
            const leaving = intoPoint(t, p.legs[leg].end) + Math.PI; // direction of travel from the point out along this leg
            if (Math.abs(wrapAngle(leaving - arriving)) > TANGENT_TOL) errors.push(`point ${p.id} leg ${leg} is not tangent to the toe`);
        }
    }
    // smooth curves: no abrupt heading change and no curve tighter than MIN_RADIUS
    for (const t of Object.values(layout.tracks)) {
        let worst = 0, tightest = Infinity;
        for (let i = 1; i < t.hdg.length; i++) {
            const turn = Math.abs(wrapAngle(t.hdg[i] - t.hdg[i - 1]));
            worst = Math.max(worst, turn);
            const ds = Math.hypot(t.pts[i][0] - t.pts[i - 1][0], t.pts[i][1] - t.pts[i - 1][1]);
            if (turn > 1e-9) tightest = Math.min(tightest, ds / turn);
        }
        if (worst > MAX_TURN) errors.push(`track ${t.id} bends ${(worst * 180 / Math.PI).toFixed(1)} degrees between neighbouring vertices`);
        else if (tightest < MIN_RADIUS - 0.05) errors.push(`track ${t.id} has a curve of radius ${tightest.toFixed(2)}, tighter than ${MIN_RADIUS}`);
    }
    // the two branches of every point are far enough apart from the foul limit onwards
    for (const p of Object.values(layout.points)) {
        const a = layout.tracks[p.legs.straight.track], b = layout.tracks[p.legs.diverging.track];
        const reach = Math.min(a.length, b.length);
        const at = (t, end, s) => pointAt(layout, t.id, end === 'a' ? s : t.length - s);
        for (let s = Math.min(POINT_FOUL, reach); s <= reach + 1e-9; s += SAMPLE) {
            const q = at(a, p.legs.straight.end, s), r = at(b, p.legs.diverging.end, s);
            if (Math.hypot(q.x - r.x, q.y - r.y) < MIN_SEPARATION - 1e-9) { errors.push(`point ${p.id} branches are closer than ${MIN_SEPARATION} at ${s.toFixed(2)} from the point`); break; }
        }
    }
    // connected: every track reachable from the headshunt through points
    const seen = new Set([layout.head]);
    const queue = [layout.head];
    while (queue.length) {
        const t = layout.tracks[queue.pop()];
        for (const e of [t.ends.a, t.ends.b]) {
            if (e.type !== 'point') continue;
            for (const leg of LEGS) {
                const n = layout.points[e.point].legs[leg].track;
                if (!seen.has(n)) { seen.add(n); queue.push(n); }
            }
        }
    }
    for (const id of ids) if (!seen.has(id)) errors.push(`track ${id} is not connected to the headshunt`);
    const goal = layout.tracks[layout.goal];
    if (!goal) errors.push('goal track missing');
    else if (goal.capacity <= 0) errors.push('goal track holds no wagons');
    for (const id of layout.sidings) if (layout.tracks[id].capacity <= 0) errors.push(`siding ${id} holds no wagons`);
    if (layout.sidings.length === 0) errors.push('no sidings');
    if (layout.headCapacity < 1) errors.push('headshunt too short to hold a wagon with the loco');
    // geometry: tracks must not cross one another away from a shared end (sampled every SAMPLE, so dense curves stay cheap) ...
    const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
    const sampled = {};
    for (const id of ids) sampled[id] = samples(layout, layout.tracks[id], SAMPLE);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const A = sampled[ids[i]], B = sampled[ids[j]];
        let crossed = false;
        for (let s = 1; s < A.length && !crossed; s++) for (let u = 1; u < B.length; u++) {
            const a1 = [A[s - 1].x, A[s - 1].y], a2 = [A[s].x, A[s].y], b1 = [B[u - 1].x, B[u - 1].y], b2 = [B[u].x, B[u].y];
            if (near(a1, b1) || near(a1, b2) || near(a2, b1) || near(a2, b2)) continue;
            if (segmentsCross(a1, a2, b1, b2)) { errors.push(`tracks ${ids[i]} and ${ids[j]} cross`); crossed = true; break; }
        }
    }
    // ... and any two different tracks keep MIN_SEPARATION apart wherever neither is inside a point's foul zone
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const ta = layout.tracks[ids[i]], tb = layout.tracks[ids[j]];
        const free = (t, q) => q.d >= t.foul.a - 1e-9 && q.d <= t.length - t.foul.b + 1e-9;
        const A = sampled[ids[i]].filter(q => free(ta, q)), B = sampled[ids[j]].filter(q => free(tb, q));
        let closest = Infinity;
        for (const q of A) for (const r of B) closest = Math.min(closest, Math.hypot(q.x - r.x, q.y - r.y));
        if (closest < MIN_SEPARATION - 1e-9) errors.push(`tracks ${ids[i]} and ${ids[j]} come within ${closest.toFixed(2)} of each other`);
    }
    return errors;
}
