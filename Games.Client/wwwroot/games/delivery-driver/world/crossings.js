// Grade-separated crossings and road levels (plan 0009 phase 7). Pure: no DOM, no GL, no terrain.
//
// Every edge stretch has a level: 0 on the ground, a bridge span >= 1, a tunnel span <= -1 (baked spans carry it; a
// small margin around a span counts as on it). Two roads that cross in plan at different levels never share a node;
// each such crossing is found once, after the graph is final and before grading, as a record
//   { upper: {edge, d, half}, lower: {edge, d, half}, x, y, sin }
// where d is the distance along that edge to the crossing point, half the half-length of the stretch of that edge
// that lies over (or under) the other road's carriageway and pavements, and sin |sin| of the crossing angle.
//
// From the spans and the crossings, structureZones gives each edge the along-intervals where it is lifted off (or
// sunk under) the ground: the ground mesh and the ground surface leave those stretches out, and vehicles find them as
// separate surfaces (world/terrain.js groundZ).
import { ROAD_CLASS } from './roadgraph.js';

/** Clear height needed under a deck (m), and the deck's slab thickness (taken off the deck height). */
export const CLEARANCE = 5.5, SLAB = 0.6;
/** Metres either side of a span that still count as on it (abutments). */
export const LEVEL_MARGIN = 6;
/** Pavement and margin beyond a carriageway's edge that a deck must clear (m). */
export const STRIP_MARGIN = 3;
/** Longest stretch of an edge one crossing may claim either side of the crossing point (near-parallel roads). */
const MAX_HALF = 60;

const classesOf = e => [e.cls, ...(e.upgrades ?? []).map(u => u.class)];
/** Half the widest carriageway an edge ever has, plus the kerb (as world/terrain.js grades it). */
export const halfWidthOf = e => Math.max(...classesOf(e).map(c => (ROAD_CLASS[c]?.width ?? 7) / 2)) + 0.5;

/**
 * Level of an edge at distance `along`: 0 on the ground, bridge >= 1, tunnel <= -1. Baked edges carry spans (`margin`
 * m either side counts as on the span); fixtures without spans can flag the whole edge (`level`, `bridge`, `tunnel`).
 */
export function levelAt(e, along, margin = LEVEL_MARGIN) {
    if (e.cls === 'ferry') return 0;
    if (Array.isArray(e.spans)) {
        for (const s of e.spans) if (along >= s.from - margin && along <= s.to + margin) return spanLevelOf(s);
        return 0;
    }
    return e.level ?? (e.bridge ? 1 : e.tunnel ? -1 : 0);
}

/** A span's level: its explicit `level`, else +1 for a bridge and -1 for a tunnel. */
export const spanLevelOf = s => (Number.isInteger(s.level) && s.level !== 0 ? s.level : s.type === 'tunnel' ? -1 : 1);

/** The structure spans of an edge as [{from, to, level}] (a fixture flagged whole becomes one span). */
export function spansOf(e) {
    if (e.cls === 'ferry') return [];
    if (Array.isArray(e.spans)) return e.spans.map(s => ({ from: s.from, to: s.to, level: spanLevelOf(s) }));
    const lv = levelAt(e, 0);
    return lv ? [{ from: 0, to: e.len, level: lv }] : [];
}

/** Proper intersection of segments a-b and c-d (interiors of both): {x, y, t, u} or null. */
function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
    const r1x = bx - ax, r1y = by - ay, r2x = dx - cx, r2y = dy - cy;
    const den = r1x * r2y - r1y * r2x;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((cx - ax) * r2y - (cy - ay) * r2x) / den;
    const u = ((cx - ax) * r1y - (cy - ay) * r1x) / den;
    if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) return null;
    return { x: ax + r1x * t, y: ay + r1y * t, t, u };
}

/** Along-distance of each vertex of an edge's polyline. */
function vertexAlong(e) {
    const a = new Float64Array(e.pts.length / 2);
    for (let i = 1; i < a.length; i++) a[i] = a[i - 1] + Math.hypot(e.pts[2 * i] - e.pts[2 * i - 2], e.pts[2 * i + 1] - e.pts[2 * i - 1]);
    return a;
}

/**
 * Every crossing in plan of two edges at different levels (ferries never count). `filter(edge)` may leave edges out
 * (e.g. those never open). Deterministic: sorted by upper edge, then distance along it.
 */
export function findCrossings(graph, { filter = null } = {}) {
    const { edges, index } = graph;
    const along = new Map();
    const alongOf = e => along.get(e.id) ?? along.set(e.id, vertexAlong(e)).get(e.id);
    const out = [], seen = new Set(), buf = [];
    for (const e of edges) {
        if (e.cls === 'ferry' || (filter && !filter(e))) continue;
        const p = e.pts;
        for (let s = 0; s < p.length / 2 - 1; s++) {
            const ax = p[2 * s], ay = p[2 * s + 1], bx = p[2 * s + 2], by = p[2 * s + 3];
            const sl = Math.hypot(bx - ax, by - ay);
            if (!sl) continue;
            for (const o of index.near((ax + bx) / 2, (ay + by) / 2, sl / 2 + 1, buf)) {
                if (o.edge <= e.id) continue;
                const f = edges[o.edge];
                if (f.cls === 'ferry' || (filter && !filter(f))) continue;
                const q = f.pts, k = 2 * o.seg;
                const hit = segCross(ax, ay, bx, by, q[k], q[k + 1], q[k + 2], q[k + 3]);
                if (!hit) continue;
                const ae = alongOf(e), af = alongOf(f);
                const de = ae[s] + (ae[s + 1] - ae[s]) * hit.t, df = af[o.seg] + (af[o.seg + 1] - af[o.seg]) * hit.u;
                const le = levelAt(e, de), lf = levelAt(f, df);
                if (le === lf) continue; // a crossing at one level is a junction (or the validator's crossing-no-node)
                const key = `${e.id}:${f.id}:${Math.round(hit.x * 2)}:${Math.round(hit.y * 2)}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const fx = q[k + 2] - q[k], fy = q[k + 3] - q[k + 1], fl = Math.hypot(fx, fy);
                const sin = Math.abs(((bx - ax) * fy - (by - ay) * fx) / (sl * fl));
                const cos = Math.sqrt(Math.max(0, 1 - sin * sin));
                const he = halfWidthOf(e), hf = halfWidthOf(f), sn = Math.max(sin, 1e-3);
                // the stretch of each road over (or under) the other's carriageway and pavements, deck width included
                const halfE = Math.min(MAX_HALF, (hf + STRIP_MARGIN) / sn + (he * cos) / sn);
                const halfF = Math.min(MAX_HALF, (he + STRIP_MARGIN) / sn + (hf * cos) / sn);
                const E = { edge: e.id, d: de, half: halfE }, F = { edge: f.id, d: df, half: halfF };
                out.push(le > lf ? { upper: E, lower: F, x: hit.x, y: hit.y, sin, levels: [le, lf] } : { upper: F, lower: E, x: hit.x, y: hit.y, sin, levels: [lf, le] });
            }
        }
    }
    out.sort((a, b) => a.upper.edge - b.upper.edge || a.upper.d - b.upper.d || a.lower.edge - b.lower.edge);
    return out;
}

/** Merges overlapping [from, to, kind] intervals of one kind; returns them sorted. */
function mergeIntervals(list) {
    list.sort((a, b) => a.from - b.from);
    const out = [];
    for (const iv of list) {
        const last = out[out.length - 1];
        if (last && iv.from <= last.to + 0.5 && last.kind === iv.kind) last.to = Math.max(last.to, iv.to);
        else out.push({ ...iv });
    }
    return out;
}

/**
 * Per edge, the along-intervals lifted off or sunk under the ground: {edgeId: [{from, to, kind}]} with kind 'deck'
 * (a bridge span, or the stretch of an upper road over another road's carriageway) or 'tunnel' (a tunnel span, or the
 * stretch of a lower road passing under a ground-level road). Ground-level stretches of an upper road that pass over a
 * tunnel stay on the ground.
 */
export function structureZones(graph, crossings) {
    const zones = new Map();
    const push = (id, iv) => (zones.get(id) ?? zones.set(id, []).get(id)).push(iv);
    for (const e of graph.edges) {
        for (const s of spansOf(e)) push(e.id, { from: Math.max(0, s.from), to: Math.min(e.len, s.to), kind: s.level > 0 ? 'deck' : 'tunnel' });
    }
    for (const c of crossings) {
        const [lu, ll] = c.levels;
        const U = graph.edges[c.upper.edge], L = graph.edges[c.lower.edge];
        if (lu > 0) push(U.id, { from: Math.max(0, c.upper.d - c.upper.half), to: Math.min(U.len, c.upper.d + c.upper.half), kind: 'deck' });
        if (ll < 0) push(L.id, { from: Math.max(0, c.lower.d - c.lower.half), to: Math.min(L.len, c.lower.d + c.lower.half), kind: 'tunnel' });
    }
    for (const [id, list] of zones) zones.set(id, mergeIntervals(list));
    return zones;
}

/** The zone of a zone list containing `along` (or null); lists are short, so a scan. */
export function zoneAt(list, along) {
    if (!list) return null;
    for (const z of list) if (along >= z.from && along <= z.to) return z;
    return null;
}

/**
 * Which layer an edge is drawn on in plan views (minimaps, the Canvas fallback): 1 for an edge with a bridge deck, -1 for
 * one in a tunnel, else 0. Drawn in ascending order, so a road on a deck lies over the road below it and a tunnel under
 * the ground roads. Uses the zones `gradeRoads` sets, else the baked bridge/tunnel flags.
 */
export function drawLevel(e) {
    if (e.zones) return e.zones.some(z => z.kind === 'deck') ? 1 : e.zones.some(z => z.kind === 'tunnel') ? -1 : 0;
    return e.bridge ? 1 : e.tunnel ? -1 : 0;
}
