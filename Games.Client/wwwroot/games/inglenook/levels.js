// Seeded, always-solvable level generator for Inglenook. DOM-free.
// Level n always produces the same level, on every device. The difficulty curve is in levelParams().
import { getLayout } from './layouts.js';
import { solveLevel, applyOps, labelsFor } from './solver.js';

export const COLORS = ['#b5483a', '#3e6fa8', '#5b8c3e', '#d9a82b', '#7d5aa6', '#4c8f8c'];
export const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'bar', 'cross'];

/** mulberry32 */
export function seededRng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Difficulty curve: level number -> layout and challenge. `wagons` counts every wagon including stuck ones. */
export function levelParams(n) {
    const p = rawParams(n);
    return { ...p, goalLen: Math.min(p.goalLen, getLayout(p.template).tracks[getLayout(p.template).goal].capacity) };
}

function rawParams(n) {
    const lv = Math.max(1, Math.floor(n));
    if (lv <= 3) return { template: 'classic', wagons: 4, goalLen: 3, stuck: 0, minPar: 2 };
    if (lv <= 8) return { template: 'classic', wagons: 5 + (lv > 6 ? 1 : 0), goalLen: lv > 6 ? 4 : 3, stuck: 0, minPar: 3 };
    if (lv <= 14) return { template: 'classic', wagons: 8, goalLen: 5, stuck: 0, minPar: 4 + (lv > 11 ? 1 : 0) };
    if (lv <= 24) return { template: 'classic', wagons: 8, goalLen: 5, stuck: 1, minPar: 5 };
    if (lv <= 39) return lv % 2 ? { template: 'ladder4', wagons: 9, goalLen: 5, stuck: 0, minPar: 5 } : { template: 'classic-long', wagons: 10, goalLen: 6, stuck: 0, minPar: 6 };
    if (lv <= 59) return lv % 2 ? { template: 'ladder4', wagons: 10, goalLen: 5, stuck: 1, minPar: 6 } : { template: 'classic-long', wagons: 11, goalLen: 6, stuck: 1, minPar: 7 };
    if (lv <= 99) return lv % 3 === 0 ? { template: 'classic-long', wagons: 11, goalLen: 7, stuck: 2, minPar: 7 } : { template: 'ladder5', wagons: 11, goalLen: 6, stuck: lv % 3 === 1 ? 1 : 2, minPar: 7 };
    return { template: ['ladder5', 'ladder4', 'classic-long'][lv % 3], wagons: 12, goalLen: 6, stuck: 2, minPar: 8 };
}

function shuffle(list, rng) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** Solved yard: the goal wagons on the goal siding, every other wagon on the other sidings, stuck wagons at the bottoms. */
function solvedYard(params, layout, rng) {
    const total = params.wagons;
    const wagons = Array.from({ length: total }, (_, i) => ({ id: `w${i + 1}`, number: i + 1, color: COLORS[i % COLORS.length], shape: SHAPES[(i * 5 + 1) % SHAPES.length], stuck: false }));
    const others = layout.sidings.filter(id => id !== layout.goal);
    const placement = Object.fromEntries(layout.sidings.map(id => [id, []]));
    const stuckSidings = shuffle(others, rng);
    const stuckIds = [];
    for (let i = 0; i < params.stuck; i++) {
        const w = wagons[total - 1 - i];
        w.stuck = true;
        stuckIds.push(w.id);
        placement[stuckSidings[i % stuckSidings.length]].push(w.id);
    }
    const movable = shuffle(wagons.filter(w => !w.stuck).map(w => w.id), rng);
    const goalIds = movable.slice(0, params.goalLen);
    placement[layout.goal] = goalIds.slice();
    for (const id of movable.slice(params.goalLen)) {
        const open = others.filter(s => placement[s].length < layout.tracks[s].capacity);
        if (open.length === 0) return null;
        placement[open[Math.floor(rng() * open.length)]].push(id);
    }
    return { wagons, placement, goalIds, stuckIds };
}

/**
 * Scramble a solved yard with random order-preserving transfers (pull j from X, push j onto Y). Every transfer can be undone, so the
 * result is solvable by construction; the exact par comes from the solver, falling back to the scramble's own undo sequence.
 */
function scramble(yard, layout, depth, rng) {
    const stuck = new Set(yard.stuckIds);
    const place = Object.fromEntries(Object.entries(yard.placement).map(([k, v]) => [k, v.slice()]));
    const steps = [];
    const movableOf = id => place[id].filter(w => !stuck.has(w)).length;
    for (let i = 0; i < depth; i++) {
        let made = false;
        for (let tries = 0; tries < 20 && !made; tries++) {
            const xs = layout.sidings.filter(id => movableOf(id) > 0);
            const x = xs[Math.floor(rng() * xs.length)];
            const ys = layout.sidings.filter(id => id !== x && place[id].length < layout.tracks[id].capacity);
            if (ys.length === 0) continue;
            const y = ys[Math.floor(rng() * ys.length)];
            const jMax = Math.min(movableOf(x), layout.headCapacity, layout.tracks[y].capacity - place[y].length);
            if (jMax < 1) continue;
            const j = 1 + Math.floor(rng() * jMax);
            const last = steps[steps.length - 1];
            if (last && last.from === y && last.to === x && last.count === j) continue; // would undo the previous step
            const moved = place[x].splice(place[x].length - j, j);
            place[y].push(...moved);
            steps.push({ from: x, to: y, count: j });
            made = true;
        }
    }
    // undo sequence: reverse order, each transfer back again
    const undo = [];
    for (const st of steps.slice().reverse()) {
        undo.push({ type: 'pull', track: st.to, count: st.count });
        undo.push({ type: 'push', track: st.from, count: st.count });
    }
    return { placement: place, undo, depth: steps.length };
}

/** Level n: { n, template, wagons, placement (bottom->top per siding), goal (ids bottom->top), par, solution }. */
export function generateLevel(n) {
    const params = levelParams(n);
    let best = null;
    for (let tries = 0; tries < 40; tries++) {
        const p = tries < 25 ? params : { ...params, minPar: Math.max(2, params.minPar - 2) };
        const layout = getLayout(p.template);
        const rng = seededRng(Math.imul(n, 7919) + tries * 104729 + 12345);
        const yard = solvedYard(p, layout, rng);
        if (!yard) continue;
        const scr = scramble(yard, layout, p.minPar + 1 + Math.floor(rng() * 3) + Math.floor(tries / 5), rng);
        const sol = solveLevel(layout, scr.placement, yard.goalIds, new Set(yard.stuckIds));
        if (!sol && scr.depth === 0) continue;
        const exact = !!sol;
        let par = sol?.par ?? 0;
        if (!exact) { // the search hit its cap: the scramble's own undo sequence is an upper bound for par
            const stuck = new Set(yard.stuckIds);
            const start = { H: '', tracks: Object.fromEntries(layout.sidings.map(id => [id, labelsFor(scr.placement[id], yard.goalIds, stuck)])) };
            const replay = applyOps(layout, start, scr.undo);
            if (!replay) continue;
            par = replay.cost;
        }
        if (par < 1) continue;
        const level = { n, template: p.template, wagons: yard.wagons, placement: scr.placement, goal: yard.goalIds, par, solution: exact ? sol.ops : scr.undo, exact, tries };
        if (par >= p.minPar) return level;
        if (!best || par > best.par) best = level;
    }
    if (best) return best;
    throw new Error(`could not generate level ${n}`);
}
