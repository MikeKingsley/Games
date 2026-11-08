// Abstract yard solver for Inglenook. DOM-free.
//
// MODEL (the "move" definition used for par and stars). The loco lives on the headshunt H at its buffer end. Every siding is a stack of
// wagons listed from its buffer end (bottom) to its point end (top); stuck wagons sit at the bottom and never move. H holds the wagons the
// loco has coupled and carries, listed from the loco outwards to the points. Two operations exist:
//   PULL(X, j): H is empty. The loco drives into siding X, couples to its movable wagons, and brings the top j of them out onto H
//               (their order along H is the reverse of the stack: H = reverse(top j)). If j is fewer than all of X's movable wagons,
//               the rest must be cut off first: that costs 1. Taking all of them costs 0 (no uncoupling).
//   PUSH(Y, j): the loco pushes the point-most j wagons of H into siding Y, on top of what is there (stack += reverse(those j)),
//               uncouples them (cost 1), and returns to the buffer with the other H wagons still coupled.
// A pull followed by a push preserves the wagons' order along the siding (two reversals), which is why shunting an inglenook works.
// The cost of a solution is therefore the number of uncouplings, which the simulation counts as `stats.uncouplings`.
// Wagons that are not part of the goal are interchangeable for the search, which keeps the state space small.
import { SOLVER_STATE_CAP } from './config.js';

const OTHER = '_';
const STUCK = '#';

/**
 * start: { H: '', tracks: { id: 'labels bottom->top' } } using one char per wagon: goal wagons 'a','b',... in goal order
 * (position i in the goal), '_' for any other wagon, '#' for a stuck wagon.
 * goal: string of labels bottom->top that must be the movable prefix of the goal siding.
 * Returns { par, ops: [{ type: 'pull'|'push', track, count }] } or null when unsolvable within the state cap.
 */
export function solveAbstract(layout, start, goal, cap = SOLVER_STATE_CAP) {
    const order = ['H', ...layout.sidings];
    const idx = Object.fromEntries(order.map((id, i) => [id, i]));
    const capacity = order.map(id => (id === 'H' ? layout.headCapacity : layout.tracks[id].capacity));
    const goalIdx = idx[layout.goal];
    const toKey = parts => parts.join('|');
    const k0 = toKey(order.map(id => (id === 'H' ? start.H : start.tracks[id] ?? '')));

    const isGoal = parts => {
        const s = parts[goalIdx];
        let i = 0;
        while (i < s.length && s[i] === STUCK) i++;
        return s.startsWith(goal, i);
    };
    const fixedOf = s => { let i = 0; while (i < s.length && s[i] === STUCK) i++; return i; };
    const rev = s => s.split('').reverse().join('');

    const dist = new Map([[k0, 0]]);
    const parent = new Map();
    let cur = [k0];
    for (let d = 0; cur.length; d++) {
        const next = [];
        for (let qi = 0; qi < cur.length; qi++) {
            const k = cur[qi];
            if (dist.get(k) !== d) continue;
            const parts = k.split('|');
            if (isGoal(parts)) {
                const ops = [];
                for (let at = k; parent.has(at);) { const p = parent.get(at); ops.push(p.op); at = p.from; }
                return { par: d, ops: ops.reverse() };
            }
            const push = (np, cost, op) => {
                const nk = toKey(np);
                const nd = d + cost;
                const od = dist.get(nk);
                if (od !== undefined && od <= nd) return;
                dist.set(nk, nd);
                parent.set(nk, { from: k, op });
                (cost === 0 ? cur : next).push(nk);
            };
            const h = parts[0];
            if (h === '') {
                for (let x = 1; x < order.length; x++) {
                    const s = parts[x];
                    const movable = s.length - fixedOf(s);
                    for (let j = 1; j <= Math.min(movable, capacity[0]); j++) {
                        const np = parts.slice();
                        np[0] = rev(s.slice(s.length - j));
                        np[x] = s.slice(0, s.length - j);
                        push(np, j === movable ? 0 : 1, { type: 'pull', track: order[x], count: j });
                    }
                }
            } else {
                for (let y = 1; y < order.length; y++) {
                    for (let j = 1; j <= h.length; j++) {
                        if (parts[y].length + j > capacity[y]) break;
                        const np = parts.slice();
                        np[0] = h.slice(0, h.length - j);
                        np[y] = parts[y] + rev(h.slice(h.length - j));
                        push(np, 1, { type: 'push', track: order[y], count: j });
                    }
                }
            }
            if (dist.size > cap) return null;
        }
        cur = next;
    }
    return null;
}

/**
 * Convenience wrapper over real wagon ids. placement: { trackId: [wagon ids bottom->top] } (stuck wagons first), goalIds: ids bottom->top,
 * stuck: Set of stuck ids.
 */
export function solveLevel(layout, placement, goalIds, stuck = new Set(), cap = SOLVER_STATE_CAP) {
    const label = id => {
        if (stuck.has(id)) return STUCK;
        const g = goalIds.indexOf(id);
        return g >= 0 ? String.fromCharCode(97 + g) : OTHER;
    };
    const tracks = {};
    for (const id of layout.sidings) tracks[id] = (placement[id] ?? []).map(label).join('');
    const goal = goalIds.map(label).join('');
    return solveAbstract(layout, { H: '', tracks }, goal, cap);
}

/**
 * Replays a list of ops on an abstract start state (same label format as solveAbstract) and returns { cost, state } or null if an op is
 * illegal. cost counts uncouplings exactly as the solver does.
 */
export function applyOps(layout, start, ops) {
    const tracks = { ...start.tracks };
    let h = start.H;
    let cost = 0;
    const rev = s => s.split('').reverse().join('');
    for (const op of ops) {
        const cap = layout.tracks[op.track].capacity;
        if (op.type === 'pull') {
            const s = tracks[op.track] ?? '';
            let fixed = 0;
            while (fixed < s.length && s[fixed] === STUCK) fixed++;
            const movable = s.length - fixed;
            if (h !== '' || op.count < 1 || op.count > movable || op.count > layout.headCapacity) return null;
            h = rev(s.slice(s.length - op.count));
            tracks[op.track] = s.slice(0, s.length - op.count);
            if (op.count < movable) cost++;
        } else {
            const s = tracks[op.track] ?? '';
            if (op.count < 1 || op.count > h.length || s.length + op.count > cap) return null;
            tracks[op.track] = s + rev(h.slice(h.length - op.count));
            h = h.slice(0, h.length - op.count);
            cost++;
        }
    }
    return { cost, state: { H: h, tracks } };
}

/** Label string for one siding's wagon ids (bottom->top), as used by solveAbstract. */
export function labelsFor(ids, goalIds, stuck) {
    return ids.map(id => (stuck.has(id) ? STUCK : goalIds.indexOf(id) >= 0 ? String.fromCharCode(97 + goalIds.indexOf(id)) : OTHER)).join('');
}
