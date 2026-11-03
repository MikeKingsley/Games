// A* over the road graph by travel time, for a given year (roads not yet opened or already closed are skipped;
// ferries add their wait). Returns the route as a polyline for the route line, plus its length and time.
import { cruiseSpeed, edgeClass, edgeOpen, nearestEdge } from './roadgraph.js';
import { TIME_SCALE } from '../config.js';

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

/** Real seconds to drive an edge in a year with a vehicle top speed (m/s), including any ferry wait. */
export function edgeTime(edge, year, vmax = 30) {
    const v = Math.min(vmax, cruiseSpeed(edgeClass(edge, year), year));
    return edge.len / v + (edge.ferry ? (edge.ferry.wait * 60) / TIME_SCALE : 0);
}

/**
 * Route between two points (snapped to the nearest open road). opts = {year, vmax (m/s), maxSnap (m)}.
 * Returns {pts, length, time, steps: [{edge, forward}], ferries: [edge]} or null when unreachable.
 */
export function findRoute(graph, from, to, { year = 1919, vmax = 30, maxSnap = 400 } = {}) {
    const s = nearestEdge(graph, from.x, from.y, maxSnap, year);
    const t = nearestEdge(graph, to.x, to.y, maxSnap, year);
    if (!s || !t) return null;
    const speed = e => Math.min(vmax, cruiseSpeed(edgeClass(e, year), year));

    // the same edge: drive straight along it
    if (s.edge === t.edge) {
        const forward = t.along >= s.along;
        const pts = slice(s.edge.pts, Math.min(s.along, t.along), Math.max(s.along, t.along));
        const ordered = forward ? pts : reverse(pts);
        return finish([from.x, from.y, ...ordered, to.x, to.y], [{ edge: s.edge, forward }], Math.abs(t.along - s.along) / speed(s.edge), []);
    }

    const goal = new Map([[t.edge.a, t.along / speed(t.edge)], [t.edge.b, (t.edge.len - t.along) / speed(t.edge)]]);
    let fastest = 0;
    for (const e of graph.edges) if (edgeOpen(e, year)) fastest = Math.max(fastest, speed(e));
    const h = id => Math.hypot(graph.nodes[id].x - to.x, graph.nodes[id].y - to.y) / fastest;

    const cost = new Map();
    const prev = new Map();
    const heap = new Heap();
    const seed = (node, c) => { if (c < (cost.get(node) ?? Infinity)) { cost.set(node, c); prev.set(node, null); heap.push(node, c + h(node)); } };
    seed(s.edge.a, s.along / speed(s.edge));
    seed(s.edge.b, (s.edge.len - s.along) / speed(s.edge));
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
            const m = e.a === n ? e.b : e.a;
            const nc = c + edgeTime(e, year, vmax);
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
    const all = [{ edge: s.edge, forward: firstNode === s.edge.b }, ...steps, { edge: t.edge, forward: best === t.edge.a }];
    return finish(pts, all, bestCost, steps.filter(st => st.edge.ferry).map(st => st.edge));
}

function finish(pts, steps, time, ferries) {
    const clean = [pts[0], pts[1]];
    let length = 0;
    for (let i = 2; i < pts.length; i += 2) {
        const d = Math.hypot(pts[i] - clean[clean.length - 2], pts[i + 1] - clean[clean.length - 1]);
        if (d < 0.05) continue;
        length += d;
        clean.push(pts[i], pts[i + 1]);
    }
    return { pts: clean, length, time, steps, ferries };
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
