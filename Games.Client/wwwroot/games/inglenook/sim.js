// Train simulation for Inglenook. DOM-free and deterministic.
//
// Vehicles are grouped into rakes: a rake is a run of coupled vehicles (a lone wagon is a rake of one). A rake owns a path, a list of
// pieces { track, from, to } running from its tail body end to its head body end, so it follows the track through points exactly as
// it was driven, whatever the points are later set to. Vehicles sit at fixed offsets along the path, GAP apart (the coupling gap).
// Only the rake containing the loco moves. It gets its path extended at the head and trimmed at the tail.
//   - A buffer stop ends the move (event 'buffer').
//   - Touching another rake couples to it automatically and stops (event 'coupled'); touching a stuck wagon only stops ('bumped').
//   - Uncoupling is refused while moving and when a wagon-only rake would be left standing in a point's foul zone.
//   - A point cannot be thrown while any rake covers it.
import { COUPLING_GAP, LOCO_SPEED, ACCEL_TIME, LOCO_LEN, WAGON_LEN } from './config.js';
import { walk, pointAt, pointZones, inFoul, initialPoints, POINT_CLEAR } from './track.js';

const EPS = 1e-7;
const GAP = COUPLING_GAP;
const sgn = p => (p.to >= p.from ? 1 : -1);
const plen = p => Math.abs(p.to - p.from);

// ---- path helpers --------------------------------------------------------------------------------------------------------------
export const pathLength = path => path.reduce((s, p) => s + plen(p), 0);

function normalize(path) {
    const out = [];
    for (const p of path) {
        if (plen(p) < EPS) continue;
        const last = out[out.length - 1];
        if (last && last.track === p.track && sgn(last) === sgn(p) && Math.abs(last.to - p.from) < 1e-6) last.to = p.to;
        else out.push({ track: p.track, from: p.from, to: p.to });
    }
    return out;
}

/** The part of a path between offsets s0 and s1 (distances from its tail). */
export function slicePath(path, s0, s1) {
    const out = [];
    let at = 0;
    for (const p of path) {
        const len = plen(p), a = at, b = at + len;
        at = b;
        if (b <= s0 + EPS || a >= s1 - EPS) continue;
        const lo = Math.max(s0, a) - a, hi = Math.min(s1, b) - a;
        out.push({ track: p.track, from: p.from + sgn(p) * lo, to: p.from + sgn(p) * hi });
    }
    return normalize(out);
}

const reversePath = path => path.slice().reverse().map(p => ({ track: p.track, from: p.to, to: p.from }));

/** Track position { track, d, dir } at offset s along a path. */
export function poseOnPath(path, s) {
    let at = 0;
    for (const p of path) {
        const len = plen(p);
        if (s <= at + len + EPS) return { track: p.track, d: p.from + sgn(p) * Math.min(Math.max(s - at, 0), len), dir: sgn(p) };
        at += len;
    }
    const last = path[path.length - 1];
    return { track: last.track, d: last.to, dir: sgn(last) };
}

function endPos(path, atHead) {
    if (atHead) { const p = path[path.length - 1]; return { track: p.track, d: p.to, dir: sgn(p) }; }
    const p = path[0];
    return { track: p.track, d: p.from, dir: sgn(p) };
}

// ---- simulation ----------------------------------------------------------------------------------------------------------------
/**
 * setup: { vehicles: [{ id, color, number, stuck?, kind?, len? }],
 *          rakes: [{ track, flush: 'a'|'b', vehicles: [ids in order of increasing d] }],
 *          loco?: { track, flush } }   (default: on the headshunt, flush to its buffer end)
 */
export function createSim(layout, setup) {
    const S = { vehicles: {}, rakes: {}, points: initialPoints(layout), v: 0, cmd: 'stop', nextRake: 1, stats: { couplings: 0, uncouplings: 0, pointsThrown: 0 } };
    let events = [];
    const emit = e => events.push(e);

    function addVehicle(d) {
        S.vehicles[d.id] = { id: d.id, kind: d.kind ?? 'wagon', len: d.len ?? (d.kind === 'loco' ? LOCO_LEN : WAGON_LEN), facing: d.facing ?? 1, stuck: !!d.stuck, color: d.color, number: d.number, shape: d.shape };
    }
    function newRake(vehicles, path) {
        const id = `r${S.nextRake++}`;
        S.rakes[id] = { id, vehicles, path: normalize(path) };
        return S.rakes[id];
    }
    const spanOf = ids => ids.reduce((s, id) => s + S.vehicles[id].len, 0) + GAP * (ids.length - 1);
    function place(trackId, flush, ids) {
        const t = layout.tracks[trackId];
        const span = spanOf(ids);
        if (span > t.length + EPS) throw new Error(`rake of ${ids.length} does not fit on ${trackId}`);
        const start = flush === 'a' ? 0 : t.length - span;
        return newRake(ids, [{ track: trackId, from: start, to: start + span }]);
    }

    for (const v of setup.vehicles ?? []) addVehicle(v);
    const head = layout.tracks[layout.head];
    const locoSpec = setup.loco ?? { track: layout.head, flush: head.ends.a.type === 'buffer' ? 'a' : 'b' };
    addVehicle({ id: 'loco', kind: 'loco', facing: locoSpec.flush === 'a' ? 1 : -1 });
    place(locoSpec.track, locoSpec.flush, ['loco']);
    for (const r of setup.rakes ?? []) place(r.track, r.flush, r.vehicles);

    const locoRake = () => Object.values(S.rakes).find(r => r.vehicles.includes('loco'));
    const offsets = rake => {
        const out = [];
        let at = 0;
        for (const id of rake.vehicles) { out.push(at); at += S.vehicles[id].len + GAP; }
        return out;
    };
    function flipRake(rake) {
        rake.path = reversePath(rake.path);
        rake.vehicles = rake.vehicles.slice().reverse();
        for (const id of rake.vehicles) S.vehicles[id].facing = -S.vehicles[id].facing;
    }
    const rakeCovers = (rake, zone) => rake.path.some(p => p.track === zone.track && Math.min(p.from, p.to) < zone.to - EPS && Math.max(p.from, p.to) > zone.from + EPS);

    /** Distance along `ext` (pieces ahead of the head) to the first rake it would touch, or null. */
    function findContact(mover, ext) {
        let best = null;
        let acc = 0;
        for (const e of ext) {
            const s = sgn(e), len = plen(e);
            for (const other of Object.values(S.rakes)) {
                if (other === mover) continue;
                other.path.forEach((q, k) => {
                    if (q.track !== e.track) return;
                    const lo = Math.min(q.from, q.to), hi = Math.max(q.from, q.to);
                    let dist = null;
                    if (s > 0) { if (e.from <= hi + EPS && lo - GAP - EPS <= e.from + len) dist = Math.max(0, lo - GAP - e.from); }
                    else if (e.from >= lo - EPS && hi + GAP + EPS >= e.from - len) dist = Math.max(0, e.from - hi - GAP);
                    if (dist === null || dist > len + EPS) return;
                    const total = acc + dist;
                    if (best && total >= best.dist - EPS) return;
                    const nearIsFrom = (sgn(q) > 0) === (s > 0);
                    const tailContact = k === 0 && nearIsFrom;
                    const headContact = k === other.path.length - 1 && !nearIsFrom;
                    best = { dist: total, other, end: tailContact ? 'tail' : headContact ? 'head' : 'side' };
                });
            }
            acc += len;
        }
        return best;
    }

    function couple(mover, other, end) {
        const g = walk(layout, endPos(mover.path, true), GAP, S.points);
        if (end === 'head') flipRake(other);
        mover.vehicles = mover.vehicles.concat(other.vehicles);
        mover.path = normalize(mover.path.concat(g.pieces, other.path));
        delete S.rakes[other.id];
        S.stats.couplings++;
        emit({ type: 'coupled', rake: mover.id, vehicles: mover.vehicles.slice() });
    }

    function step(dt) {
        const rake = locoRake();
        const loco = S.vehicles.loco;
        const target = S.cmd === 'forward' ? LOCO_SPEED : S.cmd === 'reverse' ? -LOCO_SPEED : 0;
        const dv = (LOCO_SPEED / ACCEL_TIME) * dt;
        S.v = S.v < target ? Math.min(target, S.v + dv) : Math.max(target, S.v - dv);
        if (Math.abs(S.v) < EPS) { S.v = 0; return; }
        const towardHead = S.v * loco.facing > 0;
        if (!towardHead) flipRake(rake);
        const want = Math.abs(S.v) * dt;
        const start = endPos(rake.path, true);
        let w = walk(layout, start, want, S.points);
        let blockedBy = w.blocked;
        const contact = findContact(rake, w.pieces);
        if (contact) {
            w = walk(layout, start, contact.dist, S.points);
            blockedBy = null;
        }
        if (w.moved > 0) {
            const len = pathLength(rake.path);
            rake.path = normalize(rake.path.concat(w.pieces));
            rake.path = slicePath(rake.path, w.moved, len + w.moved);
            emit({ type: 'moved', distance: w.moved });
        }
        if (contact) {
            S.v = 0;
            S.cmd = 'stop';
            const stuck = contact.end === 'side' || contact.other.vehicles.some(id => S.vehicles[id].stuck);
            if (stuck) emit({ type: 'bumped' });
            else couple(rake, contact.other, contact.end);
        } else if (blockedBy === 'buffer') {
            S.v = 0;
            S.cmd = 'stop';
            emit({ type: 'buffer' });
        }
    }

    function setDirection(cmd) {
        if (cmd === 'forward' || cmd === 'reverse' || cmd === 'stop') S.cmd = cmd;
    }

    function togglePoint(id) {
        if (!layout.points[id]) return false;
        const zones = pointZones(layout, id, POINT_CLEAR);
        if (Object.values(S.rakes).some(r => zones.some(z => rakeCovers(r, z)))) {
            emit({ type: 'pointLocked', point: id });
            return false;
        }
        S.points[id] = S.points[id] === 'straight' ? 'diverging' : 'straight';
        S.stats.pointsThrown++;
        emit({ type: 'pointThrown', point: id, state: S.points[id] });
        return true;
    }

    /** Uncouple between the vehicle at `index - 1` and the one at `index` of a rake. */
    function uncouple(rakeId, index) {
        const rake = S.rakes[rakeId];
        if (!rake || index < 1 || index >= rake.vehicles.length) return false;
        if (Math.abs(S.v) > 0.05 || S.cmd !== 'stop') { emit({ type: 'uncoupleBlocked', reason: 'moving' }); return false; }
        const off = offsets(rake);
        const a = rake.vehicles.slice(0, index), b = rake.vehicles.slice(index);
        const left = slicePath(rake.path, 0, off[index - 1] + S.vehicles[rake.vehicles[index - 1]].len);
        const right = slicePath(rake.path, off[index], pathLength(rake.path));
        for (const [ids, path] of [[a, left], [b, right]]) {
            if (ids.includes('loco')) continue;
            if (path.some(p => inFoul(layout, p.track, p.from, p.to))) { emit({ type: 'uncoupleBlocked', reason: 'foul' }); return false; }
        }
        delete S.rakes[rakeId];
        newRake(a, left);
        newRake(b, right);
        S.stats.uncouplings++;
        emit({ type: 'uncoupled', between: [rake.vehicles[index - 1], rake.vehicles[index]] });
        return true;
    }

    function poses() {
        const out = [];
        for (const rake of Object.values(S.rakes)) {
            const off = offsets(rake);
            rake.vehicles.forEach((id, i) => {
                const v = S.vehicles[id];
                const pos = poseOnPath(rake.path, off[i] + v.len / 2);
                const pt = pointAt(layout, pos.track, pos.d);
                out.push({ id, kind: v.kind, rake: rake.id, index: i, track: pos.track, d: pos.d, x: pt.x, y: pt.y, angle: pt.angle + (pos.dir < 0 ? Math.PI : 0), flip: v.facing < 0, len: v.len, stuck: v.stuck, color: v.color, number: v.number, shape: v.shape });
            });
        }
        return out;
    }

    /** Hooks between coupled vehicles, for drawing and tapping. */
    function couplings() {
        const out = [];
        for (const rake of Object.values(S.rakes)) {
            const off = offsets(rake);
            for (let i = 1; i < rake.vehicles.length; i++) {
                const mid = off[i] - GAP / 2;
                const pos = poseOnPath(rake.path, mid);
                const pt = pointAt(layout, pos.track, pos.d);
                out.push({ rake: rake.id, index: i, x: pt.x, y: pt.y, between: [rake.vehicles[i - 1], rake.vehicles[i]] });
            }
        }
        return out;
    }

    /** Vehicle ids whose centre is on a track, in order of increasing d. */
    function onTrack(trackId) {
        return poses().filter(p => p.track === trackId).sort((a, b) => a.d - b.d).map(p => p.id);
    }

    return {
        layout,
        state: S,
        step,
        setDirection,
        togglePoint,
        uncouple,
        poses,
        couplings,
        onTrack,
        get speed() { return S.v; },
        get command() { return S.cmd; },
        get points() { return S.points; },
        get stats() { return S.stats; },
        rakes: () => Object.values(S.rakes),
        drainEvents() { const e = events; events = []; return e; },
        snapshot() { return structuredClone({ vehicles: S.vehicles, rakes: S.rakes, points: S.points, v: S.v, cmd: S.cmd, nextRake: S.nextRake, stats: S.stats }); },
        restore(snap) { Object.assign(S, structuredClone(snap)); events = []; },
    };
}
