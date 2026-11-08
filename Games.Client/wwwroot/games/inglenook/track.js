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
import { COUPLING_GAP, LOCO_LEN, WAGON_LEN } from './config.js';

export const POINT_FOUL = 2.9;
export const POINT_CLEAR = 0.5; // a point cannot be thrown while a vehicle is this close to it
export const PITCH = WAGON_LEN + COUPLING_GAP; // length one coupled wagon takes up
export const LEGS = ['toe', 'straight', 'diverging'];
const EPS = 1e-6;
const BUFFER_SLACK = 0.05;

/** Length of a siding with one point end that holds exactly `n` wagons. */
export const sidingLength = n => POINT_FOUL + n * PITCH - COUPLING_GAP + BUFFER_SLACK;
/** Length of a headshunt (point at its b end) that holds the loco plus `n` wagons. */
export const headshuntLength = n => POINT_FOUL + LOCO_LEN + n * PITCH + BUFFER_SLACK;

function parseRef(ref) {
    const [track, end] = ref.split('.');
    if (end !== 'a' && end !== 'b') throw new Error(`bad track end reference "${ref}"`);
    return { track, end };
}

/**
 * Build a layout from a spec:
 * { id, name, goal: trackId, head: trackId, tracks: [{ id, role, pts: [[x,y],...] }],
 *   points: [{ id, toe: 'T.b', straight: 'U.a', diverging: 'V.a' }] }
 * role is 'headshunt' | 'siding' | 'loop' | 'connector'.
 */
export function buildLayout(spec) {
    const tracks = {};
    for (const t of spec.tracks) {
        const cum = [0];
        for (let i = 1; i < t.pts.length; i++) {
            cum.push(cum[i - 1] + Math.hypot(t.pts[i][0] - t.pts[i - 1][0], t.pts[i][1] - t.pts[i - 1][1]));
        }
        tracks[t.id] = {
            id: t.id, role: t.role ?? 'siding', pts: t.pts, cum, length: cum[cum.length - 1],
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

/** World position and heading (radians, along +d) at distance d on a track. */
export function pointAt(layout, trackId, d) {
    const t = layout.tracks[trackId];
    const dd = Math.min(Math.max(d, 0), t.length);
    let i = 1;
    while (i < t.cum.length - 1 && t.cum[i] < dd) i++;
    const [x0, y0] = t.pts[i - 1];
    const [x1, y1] = t.pts[i];
    const segLen = t.cum[i] - t.cum[i - 1];
    const f = segLen > 0 ? (dd - t.cum[i - 1]) / segLen : 0;
    return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, angle: Math.atan2(y1 - y0, x1 - x0) };
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
    // geometry: tracks must not cross one another away from a shared end
    const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const A = layout.tracks[ids[i]], B = layout.tracks[ids[j]];
        for (let s = 1; s < A.pts.length; s++) for (let u = 1; u < B.pts.length; u++) {
            const a1 = A.pts[s - 1], a2 = A.pts[s], b1 = B.pts[u - 1], b2 = B.pts[u];
            if (near(a1, b1) || near(a1, b2) || near(a2, b1) || near(a2, b2)) continue;
            if (segmentsCross(a1, a2, b1, b2)) errors.push(`tracks ${A.id} and ${B.id} cross`);
        }
    }
    return errors;
}
