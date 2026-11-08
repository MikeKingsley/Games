// Inglenook game logic that sits between levels and the simulation. DOM-free.
import { COUPLING_GAP, WAGON_LEN, STAR_TWO_FACTOR } from './config.js';
import { getLayout } from './layouts.js';
import { labelsFor } from './solver.js';

/** Which end ('a' or 'b') of a dead-end track is its buffer stop. */
export function bufferEnd(layout, trackId) {
    const t = layout.tracks[trackId];
    return t.ends.b.type === 'buffer' ? 'b' : 'a';
}

/** Wagon ids on a siding, bottom (buffer end) to top (point end), from the simulation. */
export function stackOf(sim, trackId) {
    const ids = sim.onTrack(trackId); // increasing d
    return bufferEnd(sim.layout, trackId) === 'a' ? ids : ids.slice().reverse();
}

/** Simulation setup for a generated level: every siding's movable wagons form one coupled rake; stuck wagons stand alone. */
export function buildSetup(level) {
    const layout = getLayout(level.template);
    const byId = Object.fromEntries(level.wagons.map(w => [w.id, w]));
    const vehicles = level.wagons.map(w => ({ id: w.id, color: w.color, number: w.number, shape: w.shape, stuck: w.stuck }));
    const rakes = [];
    for (const track of layout.sidings) {
        const stack = level.placement[track] ?? [];
        const flush = bufferEnd(layout, track);
        const stuckIds = stack.filter(id => byId[id].stuck);
        const movable = stack.filter(id => !byId[id].stuck);
        stuckIds.forEach((id, i) => rakes.push({ track, flush, inset: i * (WAGON_LEN + COUPLING_GAP), vehicles: [id] }));
        if (movable.length) {
            const order = flush === 'a' ? movable : movable.slice().reverse(); // increasing d
            rakes.push({ track, flush, inset: stuckIds.length * (WAGON_LEN + COUPLING_GAP), vehicles: order });
        }
    }
    return { vehicles, rakes };
}

/** True when the goal siding's movable wagons, bottom to top, start with the goal order. */
export function checkWin(sim, level) {
    const wagons = new Set(level.wagons.filter(w => !w.stuck).map(w => w.id));
    const stack = stackOf(sim, sim.layout.goal).filter(id => wagons.has(id));
    return level.goal.every((id, i) => stack[i] === id);
}

/** Uncouplings so far: the "moves" the player is scored on (see solver.js for the model). */
export const movesOf = sim => sim.stats.uncouplings;

export function starsFor(moves, par) {
    if (moves <= par) return 3;
    if (moves <= Math.ceil(par * STAR_TWO_FACTOR)) return 2;
    return 1;
}

/** Abstract (solver-format) state of a simulation: H carried by the loco, and each siding bottom->top. */
export function abstractFromSim(sim, level) {
    const layout = sim.layout;
    const stuck = new Set(level.wagons.filter(w => w.stuck).map(w => w.id));
    const H = sim.onTrack(layout.head).filter(id => id !== 'loco'); // loco outwards = increasing d on a headshunt buffered at 'a'
    const tracks = {};
    for (const id of layout.sidings) tracks[id] = labelsFor(stackOf(sim, id), level.goal, stuck);
    return { H: labelsFor(H, level.goal, stuck), tracks };
}

/** Saved progress, tolerant of missing or damaged data: { level, best: { [level]: { stars, moves } }, muted }. */
export function normalizeProgress(raw) {
    const out = { level: 1, best: {}, muted: false };
    if (!raw || typeof raw !== 'object') return out;
    if (Number.isInteger(raw.level) && raw.level >= 1) out.level = raw.level;
    if (raw.best && typeof raw.best === 'object') {
        for (const [k, v] of Object.entries(raw.best)) {
            const n = Number(k);
            if (Number.isInteger(n) && n >= 1 && v && [1, 2, 3].includes(v.stars) && Number.isInteger(v.moves) && v.moves >= 0) out.best[n] = { stars: v.stars, moves: v.moves };
        }
    }
    out.muted = raw.muted === true;
    return out;
}
