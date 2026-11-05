// A* over the road graph by travel time, for a given year (roads not yet opened or already closed are skipped;
// ferries add their wait). Hills count: each edge's graded profile (edge.z, world/terrain.js) slows a vehicle up
// its climbs (by its power to weight) and down steep descents, so the hilly way round costs more time, and the
// route reports the fuel multiplier its hills add (sim/slope.js gradeFuelFactor). Returns the route as a polyline
// for the route line, plus its length, time and hill summary.
import { edgeSpeed, edgeOpen, nearestEdge, coreNodes } from './roadgraph.js';
import { TIME_SCALE } from '../config.js';
import { gradeFuelFactor, hillSpeed, TYPICAL_CLIMB } from '../sim/slope.js';

class Heap {
    constructor() { this.items = []; }
    get size() { return this.items.length; }
    push(item, pri) {
        const a = this.items;
        a.push({ item, pri });
        let i = a.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (a[p].pri <= a[i].pri) break;
            [a[p], a[i]] = [a[i], a[p]];
            i = p;
        }
    }
    pop() {
        const a = this.items;
        const top = a[0];
        const last = a.pop();
        if (a.length) {
            a[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < a.length && a[l].pri < a[m].pri) m = l;
                if (r < a.length && a[r].pri < a[m].pri) m = r;
                if (m === i) break;
                [a[m], a[i]] = [a[i], a[m]];
                i = m;
            }
        }
        return top.item;
    }
}

// ---- Hills -------------------------------------------------------------------------------------------------------

/** Steepness buckets (upper bounds of |grade|) the profile is summarised into. */
const BUCKETS = [0.01, 0.02, 0.03, 0.045, 0.06, 0.08, 0.1, Infinity];
const hillCache = new WeakMap();

/**
 * An edge's hills from its graded profile (cached): per steepness bucket, the length and summed grade x length of
 * the stretches that climb going a -> b (`up`, `upG`) and that descend (`down`, `downG`); the fuel multiplier
 * integrated each way (`fuelFwd`, `fuelBack`, in metres); and the metres climbed each way. `flat` when ungraded.
 */
export function edgeHills(edge) {
    let h = hillCache.get(edge);
    if (h) return h;
    const n = BUCKETS.length;
    h = { flat: !edge.z || edge.z.length < 2, up: new Float64Array(n), upG: new Float64Array(n), down: new Float64Array(n), downG: new Float64Array(n), fuelFwd: edge.len, fuelBack: edge.len, climbFwd: 0, climbBack: 0 };
    if (!h.flat) {
        const z = edge.z, step = edge.zStep;
        h.fuelFwd = h.fuelBack = 0;
        for (let i = 0; i + 1 < z.length; i++) {
            const g = (z[i + 1] - z[i]) / step;
            let k = 0;
            while (Math.abs(g) >= BUCKETS[k]) k++;
            if (g >= 0) { h.up[k] += step; h.upG[k] += g * step; h.climbFwd += g * step; } else { h.down[k] += step; h.downG[k] -= g * step; h.climbBack -= g * step; }
            h.fuelFwd += step * gradeFuelFactor(g);
            h.fuelBack += step * gradeFuelFactor(-g);
        }
    }
    hillCache.set(edge, h);
    return h;
}

/** Seconds to drive a whole edge one way at a cruising speed, slowed by its hills for a vehicle's climb model. */
function hillSeconds(edge, forward, cruise, model) {
    const h = edgeHills(edge);
    if (h.flat) return edge.len / cruise;
    const climbL = forward ? h.up : h.down, climbG = forward ? h.upG : h.downG;
    const descL = forward ? h.down : h.up, descG = forward ? h.downG : h.upG;
    let t = 0;
    for (let k = 0; k < BUCKETS.length; k++) {
        if (climbL[k] > 0) t += climbL[k] / hillSpeed(model, climbG[k] / climbL[k], cruise);
        if (descL[k] > 0) t += descL[k] / hillSpeed(model, -descG[k] / descL[k], cruise);
    }
    return t;
}

const ferryWait = edge => (edge.ferry ? (edge.ferry.wait * 60) / TIME_SCALE : 0);

/**
 * Real seconds to drive an edge in a year with a vehicle top speed (m/s), including any ferry wait. `forward` is
 * a -> b; `model` (sim/slope.js climbModel) is the vehicle's power to weight for the hills (a typical lorry if not given).
 */
export function edgeTime(edge, year, vmax = 30, forward = true, model = TYPICAL_CLIMB) {
    const v = Math.min(vmax, edgeSpeed(edge, year));
    return hillSeconds(edge, forward, v, model) + ferryWait(edge);
}

// ---- Routes ------------------------------------------------------------------------------------------------------

/**
 * Route between two points (snapped to the nearest open road). opts = {year, vmax (m/s), maxSnap (m), climb (the
 * vehicle's sim/slope.js climbModel; a typical lorry if not given)}. Returns {pts, length, time (s, hills
 * included), flatTime (s, as if level), hill (time / flatTime, >= 1), fuel (the hills' fuel multiplier over the
 * route, sim/slope.js gradeFuelFactor averaged by distance), climb (m), steps: [{edge, forward}], ferries: [edge]}
 * or null when unreachable. Partly driven edges count their share of the edge's hills.
 */
export function findRoute(graph, from, to, { year = 1919, vmax = 30, maxSnap = 400, climb = TYPICAL_CLIMB } = {}) {
    // endpoints snap to a two-way road when there is one in reach (a one-way cul-de-sac would trap the start or the goal)
    const core = coreNodes(graph);
    const snap = p => {
        const plain = nearestEdge(graph, p.x, p.y, maxSnap, year, e => !e.oneway && e.cls !== 'ferry') ?? nearestEdge(graph, p.x, p.y, maxSnap, year);
        if (!plain || (core[plain.edge.a] && core[plain.edge.b])) return plain;
        // in a one-way pocket: a road of the main network a little further off, if any
        const better = nearestEdge(graph, p.x, p.y, plain.d + 40, year, e => !e.oneway && e.cls !== 'ferry' && core[e.a] && core[e.b]);
        return better ?? plain;
    };
    const s = snap(from);
    const t = snap(to);
    if (!s || !t) return null;
    const speed = e => Math.min(vmax, edgeSpeed(e, year));
    /** Seconds for `metres` of an edge driven one way (its share of the edge's hill time). */
    const part = (e, metres, forward) => (e.len > 0 ? (hillSeconds(e, forward, speed(e), climb) * metres) / e.len : 0);

    // one-way roads (OSM `oneway`, a -> b) are only driven forward: the start can only leave through the b end, the
    // goal can only be reached through the a end
    const canBack = e => !e.oneway;
    // the same edge: drive straight along it
    if (s.edge === t.edge && (t.along >= s.along || canBack(s.edge))) {
        const forward = t.along >= s.along;
        const pts = slice(s.edge.pts, Math.min(s.along, t.along), Math.max(s.along, t.along));
        const ordered = forward ? pts : reverse(pts);
        const metres = Math.abs(t.along - s.along);
        return finish([from.x, from.y, ...ordered, to.x, to.y], [{ edge: s.edge, forward, metres }], part(s.edge, metres, forward), [], speed);
    }

    const goal = new Map([[t.edge.a, part(t.edge, t.along, true)]]);
    if (canBack(t.edge)) goal.set(t.edge.b, part(t.edge, t.edge.len - t.along, false));
    let fastest = 0;
    for (const e of graph.edges) if (edgeOpen(e, year)) fastest = Math.max(fastest, speed(e));
    const h = id => Math.hypot(graph.nodes[id].x - to.x, graph.nodes[id].y - to.y) / fastest;

    const cost = new Map();
    const prev = new Map();
    const heap = new Heap();
    const seed = (node, c) => { if (c < (cost.get(node) ?? Infinity)) { cost.set(node, c); prev.set(node, null); heap.push(node, c + h(node)); } };
    if (canBack(s.edge)) seed(s.edge.a, part(s.edge, s.along, false));
    seed(s.edge.b, part(s.edge, s.edge.len - s.along, true));
    let best = null, bestCost = Infinity;
    const done = new Set();
    while (heap.size) {
        const n = heap.pop();
        if (done.has(n)) continue;
        done.add(n);
        const c = cost.get(n);
        if (c + h(n) >= bestCost) break;
        if (goal.has(n) && c + goal.get(n) < bestCost) { bestCost = c + goal.get(n); best = n; }
        for (const eid of graph.nodes[n].edges) {
            const e = graph.edges[eid];
            if (!edgeOpen(e, year)) continue;
            if (e.oneway && e.a !== n) continue; // against the one-way direction
            const m = e.a === n ? e.b : e.a;
            const nc = c + edgeTime(e, year, vmax, e.a === n, climb);
            if (nc < (cost.get(m) ?? Infinity)) {
                cost.set(m, nc);
                prev.set(m, { node: n, edge: e });
                heap.push(m, nc + h(m));
            }
        }
    }
    if (best === null) return null;

    // walk back: nodes from the start edge to the best goal node
    const steps = [];
    for (let n = best; prev.get(n); n = prev.get(n).node) {
        const { node, edge } = prev.get(n);
        steps.unshift({ edge, forward: edge.a === node });
    }
    const firstNode = steps.length ? (steps[0].forward ? steps[0].edge.a : steps[0].edge.b) : best;
    const pts = [from.x, from.y];
    // part of the start edge up to the first node
    if (firstNode === s.edge.a) pts.push(...reverse(slice(s.edge.pts, 0, s.along)));
    else pts.push(...slice(s.edge.pts, s.along, s.edge.len));
    for (const st of steps) pts.push(...(st.forward ? st.edge.pts : reverse(st.edge.pts)));
    // part of the target edge from the last node
    if (best === t.edge.a) pts.push(...slice(t.edge.pts, 0, t.along));
    else pts.push(...reverse(slice(t.edge.pts, t.along, t.edge.len)));
    pts.push(to.x, to.y);
    const startPart = { edge: s.edge, forward: firstNode === s.edge.b, metres: firstNode === s.edge.a ? s.along : s.edge.len - s.along };
    const endPart = { edge: t.edge, forward: best === t.edge.a, metres: best === t.edge.a ? t.along : t.edge.len - t.along };
    const all = [startPart, ...steps.map(st => ({ ...st, metres: st.edge.len })), endPart];
    return finish(pts, all, bestCost, steps.filter(st => st.edge.ferry).map(st => st.edge), speed);
}

/** The route's polyline, length and hill summary. `steps` carry the metres driven on each edge. */
function finish(pts, steps, time, ferries, speed) {
    const clean = [pts[0], pts[1]];
    let length = 0;
    for (let i = 2; i < pts.length; i += 2) {
        const d = Math.hypot(pts[i] - clean[clean.length - 2], pts[i + 1] - clean[clean.length - 1]);
        if (d < 0.05) continue;
        length += d;
        clean.push(pts[i], pts[i + 1]);
    }
    let flatTime = 0, fuelMetres = 0, driven = 0, climb = 0;
    for (const st of steps) {
        const e = st.edge, share = e.len > 0 ? st.metres / e.len : 0;
        const hills = edgeHills(e);
        flatTime += st.metres / speed(e) + (share >= 1 ? ferryWait(e) : 0);
        fuelMetres += (st.forward ? hills.fuelFwd : hills.fuelBack) * share;
        climb += (st.forward ? hills.climbFwd : hills.climbBack) * share;
        driven += st.metres;
    }
    const plain = steps.map(({ edge, forward }) => ({ edge, forward }));
    return {
        pts: clean, length, time, flatTime, hill: flatTime > 0 ? Math.max(1, time / flatTime) : 1,
        fuel: driven > 0 ? fuelMetres / driven : 1, climb, steps: plain, ferries,
    };
}

/** The part of a polyline between two distances along it. */
export function slice(pts, d0, d1) {
    const out = [];
    let acc = 0;
    for (let i = 2; i < pts.length; i += 2) {
        const ax = pts[i - 2], ay = pts[i - 1], bx = pts[i], by = pts[i + 1];
        const len = Math.hypot(bx - ax, by - ay);
        const s0 = Math.max(d0, acc), s1 = Math.min(d1, acc + len);
        if (s1 >= s0 && len > 0) {
            const t0 = (s0 - acc) / len, t1 = (s1 - acc) / len;
            if (!out.length) out.push(ax + (bx - ax) * t0, ay + (by - ay) * t0);
            out.push(ax + (bx - ax) * t1, ay + (by - ay) * t1);
        }
        acc += len;
    }
    return out;
}

function reverse(pts) {
    const out = [];
    for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
    return out;
}
