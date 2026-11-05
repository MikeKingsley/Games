// Road network validator for Delivery Driver. Builds the world, then reports structural problems in the road graph
// and street furniture (lamps, signs) that sits on the carriageway or inside buildings.
//
//   node scripts/validate-roads.mjs [--area exeter|plymouth|truro|penzance|all|<town id>[,...]] [--year 2024]
//        [--radius 1500] [--furniture] [--strict] [--json] [--baked] [--soft-clearance]
//
// --baked validates the baked OSM graph (world/seed/baked/, see scripts/bake-roads/bake.mjs) instead of the seeded
// world, with the baked coast for water, and adds the trunk chain check (M5, A30 and A38 form one network).
// // --check-yards (full game world only) checks every depot, garage, industry site and farm: connected to the main
// road network in each sample year, its yard clear of roads and of other yards.
// Layer checks (plan 0009): overlap-same-layer (hard: carriageway-plus-pavement strips of two roads at the same ground
// level overlap, apart from beside a junction node of either road; a stretch within RAMP_MARGIN of a bridge or tunnel
// counts as on its approach ramp; overlaps at a bridge or tunnel level are the soft deck-overlap), junction-cluster (soft: junction footprints overlap), roundabout-arm-gap
// (hard: an arm that does not reach the ring or ends inside it) and bridge-clearance (hard since plan 0009 phase 7: a
// higher level crossing a lower road with less than 5.5 m under the deck, on the graded heights; --soft-clearance
// reports it only). A crossing world/terrain.js gradeRoads had to take at road level (a structure's end joined to the
// road it crosses, or an interchange link too short to ramp at 1:4: graph.crossings[].atGrade) is the soft
// crossing-at-grade instead.
// Exit code is 0 unless --strict is given and a hard check fails.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(here, '../Games.Client/wwwroot/games/delivery-driver');
const game = p => import(pathToFileURL(`${GAME}/${p}`).href);

const { ROAD_CLASS, edgeOpen, edgeWidth, edgeClass } = await game('world/roadgraph.js');
const { closestOnPoly, pointAt } = await game('world/geom.js');
const { waterAt } = await game('world/region.js');
const { obb, sat } = await game('sim/collision.js');
const { gradeLimit, roadHeightAt } = await game('world/terrain.js');
const { junctionRadius, ROUNDABOUT } = await game('render/gl/road-mesh.js');
const { junctionType } = await game('world/roadgraph.js');
const { isLive } = await game('world/furniture.js');

const SAMPLE_YEARS = [1919, 1930, 1950, 1970, 1990, 2024];
const DEFAULT_AREAS = ['exeter', 'plymouth', 'truro', 'penzance'];
const YARD_KINDS = new Set(['depot', 'site', 'farm']);

/** Edges that legitimately cross or pass over others without a junction. */
const grade_separated = e => e.bridge || e.tunnel || e.cls === 'ferry';
/** Baked edges carry bridge/tunnel spans: only the stretch on the structure (plus a margin) is grade separated. */
const hasSpans = e => Array.isArray(e.spans);
function separatedAt(e, x, y, margin = 6) {
    if (e.cls === 'ferry') return true;
    if (!hasSpans(e)) return grade_separated(e);
    if (!e.spans.length) return false;
    const along = closestOnPoly(e.pts, x, y).along;
    return e.spans.some(s => along >= s.from - margin && along <= s.to + margin);
}

function inBox(box, x, y) {
    return !box || (x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY);
}
function edgeInBox(box, e) {
    if (!box) return true;
    for (let i = 0; i < e.pts.length; i += 2) if (inBox(box, e.pts[i], e.pts[i + 1])) return true;
    return false;
}

/** Proper intersection of segments a-b and c-d (interior of both); returns {x, y} or null. */
function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
    const r1x = bx - ax, r1y = by - ay, r2x = dx - cx, r2y = dy - cy;
    const den = r1x * r2y - r1y * r2x;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((cx - ax) * r2y - (cy - ay) * r2x) / den;
    const u = ((cx - ax) * r1y - (cy - ay) * r1x) / den;
    if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) return null;
    return { x: ax + r1x * t, y: ay + r1y * t };
}

/**
 * Structural checks on a road graph. `world` needs `graph` (with `index`); `region` is optional (water and grade
 * checks are skipped without it). Returns {counts, issues}: each issue is {check, hard, edge?, node?, x, y, detail}.
 */
export function validateGraph(world, { year = 2024, box = null, hardClearance = true } = {}) {
    const { graph, region } = world;
    const issues = [];
    const add = (check, hard, x, y, detail, extra = {}) => issues.push({ check, hard, x, y, detail, ...extra });
    const open = graph.edges.filter(e => edgeOpen(e, year));
    const openIds = new Set(open.map(e => e.id));
    const degree = n => n.edges.filter(id => openIds.has(id)).length;

    // connected components over open edges (ignoring nodes with no open edge)
    const parent = graph.nodes.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const e of open) parent[find(e.a)] = find(e.b);
    const comps = new Map();
    for (const n of graph.nodes) if (degree(n) > 0) comps.set(find(n.id), (comps.get(find(n.id)) ?? 0) + 1);
    const compSizes = [...comps.values()].sort((a, b) => b - a);
    if (compSizes.length > 1) {
        const main = [...comps.entries()].sort((a, b) => b[1] - a[1])[0][0];
        for (const n of graph.nodes) {
            if (degree(n) > 0 && find(n.id) !== main && comps.get(find(n.id)) >= 1 && inBox(box, n.x, n.y) && n.edges.length && find(n.id) === n.id) {
                add('disconnected', true, n.x, n.y, `component of ${comps.get(find(n.id))} nodes not joined to the main network`, { node: n.id });
            }
        }
    }

    for (const n of graph.nodes) {
        if (!inBox(box, n.x, n.y)) continue;
        const deg = degree(n);
        if (deg === 1 && !YARD_KINDS.has(n.kind) && n.end !== 'osm' && n.end !== 'boundary') add('dead-end', false, n.x, n.y, `dead end (${n.kind ?? 'node'}${n.town ? ', ' + n.town : ''})`, { node: n.id });
        if (deg > 5) add('odd-degree', false, n.x, n.y, `${deg} roads meet here`, { node: n.id });
        if (deg >= 3) {
            const dirs = n.edges.filter(id => openIds.has(id)).map(id => {
                const e = graph.edges[id];
                const p = pointAt(e.pts, e.a === n.id ? Math.min(8, e.len / 2) : Math.max(e.len - 8, e.len / 2));
                return Math.atan2(p.y - n.y, p.x - n.x);
            });
            let min = Math.PI;
            for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) {
                let d = Math.abs(dirs[i] - dirs[j]) % (2 * Math.PI);
                if (d > Math.PI) d = 2 * Math.PI - d;
                if (d < min) min = d;
            }
            if (min < (30 * Math.PI) / 180) add('sharp-angle', false, n.x, n.y, `junction arms only ${(min * 180 / Math.PI).toFixed(0)} degrees apart`, { node: n.id });
            if (deg === 3) {
                const ranks = n.edges.filter(id => openIds.has(id)).map(id => ROAD_CLASS[edgeClass(graph.edges[id], year)]?.rank ?? 1);
                if (Math.min(...ranks) === Math.max(...ranks) && n.junction !== 'roundabout' && n.junction !== 'signals') {
                    add('no-priority', false, n.x, n.y, 'T-junction of equal-rank roads has no priority', { node: n.id });
                }
            }
        }
    }

    const seenPairs = new Set();
    for (const e of open) {
        if (!edgeInBox(box, e)) continue;
        if (e.len < 3 && e.cls !== 'ferry') add('short-edge', false, e.pts[0], e.pts[1], `edge ${e.id} is ${e.len.toFixed(1)} m`, { edge: e.id });

        // crossings without a shared node
        if (hasSpans(e) || !grade_separated(e)) {
            for (let s = 0; s < e.pts.length / 2 - 1; s++) {
                const ax = e.pts[2 * s], ay = e.pts[2 * s + 1], bx = e.pts[2 * s + 2], by = e.pts[2 * s + 3];
                const reach = Math.hypot(bx - ax, by - ay) / 2 + 2;
                for (const o of graph.index.near((ax + bx) / 2, (ay + by) / 2, reach)) {
                    if (o.edge <= e.id || !openIds.has(o.edge)) continue;
                    const f = graph.edges[o.edge];
                    if (!hasSpans(f) && grade_separated(f)) continue;
                    const cx = f.pts[2 * o.seg], cy = f.pts[2 * o.seg + 1], dx = f.pts[2 * o.seg + 2], dy = f.pts[2 * o.seg + 3];
                    const hit = segCross(ax, ay, bx, by, cx, cy, dx, dy);
                    if (!hit || separatedAt(e, hit.x, hit.y) || separatedAt(f, hit.x, hit.y)) continue;
                    const k = e.id * 100003 + f.id;
                    if (seenPairs.has(k)) continue;
                    seenPairs.add(k);
                    add('crossing-no-node', true, hit.x, hit.y, `edges ${e.id} (${e.cls}) and ${f.id} (${f.cls}) cross with no junction`, { edge: e.id, other: f.id });
                }
            }
        }

        if (!region) continue;
        // water without a bridge
        if (hasSpans(e) || !grade_separated(e)) {
            let wet = 0, first = null;
            for (let d = 0; d <= e.len; d += 6) {
                if (hasSpans(e) && e.spans.some(s => d >= s.from - 6 && d <= s.to + 6)) continue;
                const p = pointAt(e.pts, d);
                if (waterAt(region, p.x, p.y) >= 10) { wet++; first ??= p; }
            }
            // the baked-only world has no `region.dryRoad` (the game treats a shoreline road as dry land), so there the check only advises
            if (wet) add('road-in-water', !world.softWater, first.x, first.y, `edge ${e.id} (${e.cls}) has ${wet} sample(s) in water, no bridge`, { edge: e.id });
        }
        // grade
        if (e.z && e.zStep > 0 && e.cls !== 'ferry') {
            const limit = gradeLimit(region, e);
            let worst = 0, at = 0;
            for (let i = 1; i < e.z.length; i++) {
                const g = Math.abs(e.z[i] - e.z[i - 1]) / e.zStep;
                if (g > worst) { worst = g; at = i; }
            }
            if (worst > limit * 1.1 + 0.005) {
                const p = pointAt(e.pts, at * e.zStep);
                add('grade', false, p.x, p.y, `edge ${e.id} (${e.cls}) climbs ${(worst * 100).toFixed(1)}% against a ${(limit * 100).toFixed(0)}% limit`, { edge: e.id });
            }
        }
    }

    const layer = checkLayers(graph, open, openIds, year, box, add, hardClearance);
    const counts = { nodes: graph.nodes.length, edges: graph.edges.length, openEdges: open.length, components: compSizes.length, largestComponents: compSizes.slice(0, 5), ...layer };
    return { counts, issues };
}

// ---- layer checks ------------------------------------------------------------------------------------------------

/** Outer edge of the pavement beyond the carriageway edge (render/gl/road-mesh.js pavement strip). */
export const PAVEMENT = 2.0;
/** Clear height required under a deck, and the slab thickness taken off the deck height. */
export const CLEARANCE = 5.5, SLAB = 0.6;
/** Metres either side of a bridge or tunnel that count as its approach ramp for the strip-overlap check. */
export const RAMP_MARGIN = 30;
const OVERLAP_TOLERANCE = 0.25;

/**
 * Level of an edge at distance `along`: 0 on the ground, bridge >= 1, tunnel <= -1. Baked edges carry spans (a margin
 * around them counts as on the structure, like the crossing check); graph fixtures flag the whole edge.
 */
export function levelAt(e, along, margin = 6) {
    if (e.cls === 'ferry') return 0;
    if (Array.isArray(e.spans)) {
        for (const s of e.spans) if (along >= s.from - margin && along <= s.to + margin) return s.level ?? (s.type === 'tunnel' ? -1 : 1);
        return 0;
    }
    return e.level ?? (e.bridge ? 1 : e.tunnel ? -1 : 0);
}

/** Closest approach of segments a-b and c-d (not crossing): {d, x, y} with (x, y) midway between the closest pair. */
function segSegClosest(a, b, c, d) {
    let best = { d: Infinity, x: 0, y: 0 };
    const consider = (p, s, t) => {
        const ex = t[0] - s[0], ey = t[1] - s[1], l2 = ex * ex + ey * ey;
        const u = l2 ? Math.max(0, Math.min(1, ((p[0] - s[0]) * ex + (p[1] - s[1]) * ey) / l2)) : 0;
        const qx = s[0] + ex * u, qy = s[1] + ey * u, dist = Math.hypot(p[0] - qx, p[1] - qy);
        if (dist < best.d) best = { d: dist, x: (p[0] + qx) / 2, y: (p[1] + qy) / 2 };
    };
    consider(a, c, d); consider(b, c, d); consider(c, a, b); consider(d, a, b);
    return best;
}

/** Along-distance of each vertex of an edge's polyline (cached on the edge). */
function vertexAlong(e) {
    if (e._along) return e._along;
    const a = [0];
    for (let i = 2; i < e.pts.length; i += 2) a.push(a[a.length - 1] + Math.hypot(e.pts[i] - e.pts[i - 2], e.pts[i + 1] - e.pts[i - 1]));
    Object.defineProperty(e, '_along', { value: a, enumerable: false });
    return a;
}
/** Middle of the stretch of segment a-b alongside segment c-d (the closest point `near` when they do not run alongside). */
function overlapMid(a, b, c, d, near) {
    const ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey;
    if (!l2) return near;
    const tc = ((c[0] - a[0]) * ex + (c[1] - a[1]) * ey) / l2, td = ((d[0] - a[0]) * ex + (d[1] - a[1]) * ey) / l2;
    const lo = Math.max(0, Math.min(tc, td)), hi = Math.min(1, Math.max(tc, td));
    if (hi <= lo) return near;
    const t = (lo + hi) / 2;
    return { x: a[0] + ex * t, y: a[1] + ey * t };
}

/** Along-distance of the point of segment s nearest the point `p`. */
function alongNear(e, s, p) {
    const a = vertexAlong(e), ax = e.pts[2 * s], ay = e.pts[2 * s + 1], dx = e.pts[2 * s + 2] - ax, dy = e.pts[2 * s + 3] - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / l2)) : 0;
    return a[s] + t * (a[s + 1] - a[s]);
}
const midAlong = (e, s) => { const a = vertexAlong(e); return (a[s] + a[s + 1]) / 2; };
const segOf = (e, s) => [[e.pts[2 * s], e.pts[2 * s + 1]], [e.pts[2 * s + 2], e.pts[2 * s + 3]]];

/** Key of a crossing by its two edges and (to 4 m) its point, for matching graph.crossings records. */
const crossingKey = (a, b, x, y) => `${Math.min(a, b)}:${Math.max(a, b)}:${Math.round(x / 4)}:${Math.round(y / 4)}`;

/** The crossings gradeRoads took at road level (graph.crossings[].atGrade), by crossingKey (with the neighbouring cells). */
function atGradeKeys(graph) {
    const keys = new Set();
    for (const c of graph.crossings ?? []) {
        if (!c.atGrade) continue;
        for (const dx of [-4, 0, 4]) for (const dy of [-4, 0, 4]) keys.add(crossingKey(c.upper.edge, c.lower.edge, c.x + dx, c.y + dy));
    }
    return keys;
}

/** Clearance of the upper road over the lower one at a crossing point; records it in `clearance`, reports a short one. */
function checkClearance(up, low, hit, clearance, add, hard, atGrade) {
    clearance.crossings++;
    if (atGrade.has(crossingKey(up.id, low.id, hit.x, hit.y))) {
        clearance.atGrade++;
        add('crossing-at-grade', false, hit.x, hit.y, `edge ${up.id} (${up.cls}) crosses ${low.id} (${low.cls}) at road level (no room to ramp)`, { edge: up.id, other: low.id });
        return;
    }
    if (!(up.z && low.z && up.zStep > 0 && low.zStep > 0)) return;
    clearance.measured++;
    const zu = roadHeightAt(up, closestOnPoly(up.pts, hit.x, hit.y).along), zl = roadHeightAt(low, closestOnPoly(low.pts, hit.x, hit.y).along);
    const gap = zu - SLAB - zl;
    if (gap < CLEARANCE - 0.01) {
        clearance.short++;
        add('bridge-clearance', hard, hit.x, hit.y, `edge ${up.id} (${up.cls}) passes over ${low.id} (${low.cls}) with ${gap.toFixed(1)} m clearance (need ${CLEARANCE} m)`, { edge: up.id, other: low.id });
    }
}

/** Strip overlaps at one level and grade-separated crossings. Returns the overlapping pairs (Map) and clearance counts. */
function scanSegments(graph, open, openIds, year, box, add, hardClearance) {
    const half = e => edgeWidth(e, year) / 2 + PAVEMENT;
    const maxHalf = ROAD_CLASS.M.width / 2 + PAVEMENT;
    const pairs = new Map();
    const clearance = { crossings: 0, measured: 0, short: 0, atGrade: 0 };
    const seenCross = new Set(), atGrade = atGradeKeys(graph);
    for (const e of open) {
        if (e.cls === 'ferry' || !edgeInBox(box, e)) continue;
        const he = half(e);
        for (let s = 0; s < e.pts.length / 2 - 1; s++) {
            const [a, b] = segOf(e, s);
            const sl = Math.hypot(b[0] - a[0], b[1] - a[1]);
            for (const o of graph.index.near((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, sl / 2 + he + maxHalf)) {
                if (o.edge <= e.id || !openIds.has(o.edge)) continue;
                const f = graph.edges[o.edge];
                if (f.cls === 'ferry') continue;
                const [c, d] = segOf(f, o.seg);
                const le = levelAt(e, midAlong(e, s)), lf = levelAt(f, midAlong(f, o.seg));
                const hit = segCross(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
                if (hit) {
                    if (le === lf) continue; // a same-level crossing is crossing-no-node's
                    const key = `${e.id}:${f.id}:${Math.round(hit.x)}:${Math.round(hit.y)}`;
                    if (seenCross.has(key)) continue;
                    seenCross.add(key);
                    const [up, low] = le > lf ? [e, f] : [f, e];
                    checkClearance(up, low, hit, clearance, add, hardClearance, atGrade);
                    continue;
                }
                // a stretch within RAMP_MARGIN of a bridge or tunnel is on its approach ramp (phase 7 raises it off the ground)
                const hf = half(f);
                const near = segSegClosest(a, b, c, d);
                // (judged from both roads' point of view, so the answer does not depend on which one is scanned first)
                const mid = overlapMid(a, b, c, d, near), midF = overlapMid(c, d, a, b, near);
                const lvO = levelAt(e, alongNear(e, s, mid), RAMP_MARGIN);
                if (lvO !== levelAt(f, alongNear(f, o.seg, mid), RAMP_MARGIN) || levelAt(e, alongNear(e, s, midF), RAMP_MARGIN) !== levelAt(f, alongNear(f, o.seg, midF), RAMP_MARGIN)) continue;
                const depth = he + hf - near.d;
                if (depth <= OVERLAP_TOLERANCE || (exemptNearJunction(graph, e, f, near, mid, a, b, c, d, he, hf, year) && exemptNearJunction(graph, f, e, near, midF, c, d, a, b, hf, he, year))) continue;
                const k = e.id * 100003 + f.id;
                const p = pairs.get(k) ?? pairs.set(k, { e, f, len: 0, segs: new Set(), depth: 0, x: near.x, y: near.y, level: lvO }).get(k);
                if (!p.segs.has(s)) { p.segs.add(s); p.len += sl; } // each segment of e once, however many of f's it meets
                if (depth > p.depth) { p.depth = depth; p.x = near.x; p.y = near.y; }
            }
        }
    }
    return { pairs, clearance };
}

/** Pairs of junction footprints (circles of junctionRadius) that overlap, in a box. */
function junctionClusters(graph, year, box) {
    const js = [];
    for (const n of graph.nodes) {
        if (!inBox(box, n.x, n.y)) continue;
        const r = junctionRadius(graph, n, year);
        if (r > 0) js.push({ n, r });
    }
    const cell = 48, cells = new Map();
    const ck = (i, j) => i * 100003 + j;
    for (const j of js) { const k = ck(Math.floor(j.n.x / cell), Math.floor(j.n.y / cell)); (cells.get(k) ?? cells.set(k, []).get(k)).push(j); }
    const out = [];
    for (const a of js) {
        const ci = Math.floor(a.n.x / cell), cj = Math.floor(a.n.y / cell);
        for (let i = ci - 1; i <= ci + 1; i++) {
            for (let j = cj - 1; j <= cj + 1; j++) {
                for (const b of cells.get(ck(i, j)) ?? []) {
                    const d = Math.hypot(a.n.x - b.n.x, a.n.y - b.n.y);
                    if (b.n.id > a.n.id && d < a.r + b.r) out.push({ a, b, d });
                }
            }
        }
    }
    return out;
}

/** Roundabout arms that do not reach the ring: the end vertex is off the centre, or the arm is shorter than the ring. */
function roundaboutArmGaps(graph, openIds, year, box, add) {
    let rings = 0;
    for (const n of graph.nodes) {
        if (!inBox(box, n.x, n.y) || junctionType(n, year) !== 'roundabout' || n.mini) continue;
        const arms = n.edges.map(id => graph.edges[id]).filter(e => openIds.has(e.id));
        if (arms.length < 3) continue;
        rings++;
        const hw = Math.max(...arms.map(e => edgeWidth(e, year))) / 2;
        // phase 8 replaces this with the junction layout's outer radius; until then the mesh's fixed ring
        const outer = n.ringOuter ?? ROUNDABOUT.island + 2 * hw;
        for (const e of arms) {
            const atA = e.a === n.id;
            if (levelAt(e, atA ? 0 : e.len, 0) !== 0) continue; // passes over or under the ring: not an arm
            const gap = atA ? Math.hypot(e.pts[0] - n.x, e.pts[1] - n.y) : Math.hypot(e.pts[e.pts.length - 2] - n.x, e.pts[e.pts.length - 1] - n.y);
            // a bridge or tunnel that starts at the arm's far end makes the arm the approach ramp of that structure: soft until
            // phase 8's layout and phase 10's deck meshes place the structure outside the ring
            const far = graph.nodes[atA ? e.b : e.a];
            const rampArm = far.edges.some(id => id !== e.id && levelAt(graph.edges[id], graph.edges[id].a === far.id ? 0 : graph.edges[id].len, 0) !== 0);
            const hard = !rampArm;
            const check = rampArm ? 'roundabout-arm-bridge' : 'roundabout-arm-gap';
            if (gap > 1) add(check, hard, n.x, n.y, `edge ${e.id} (${e.cls}) ends ${gap.toFixed(1)} m from the roundabout centre, short of its ${outer.toFixed(1)} m ring`, { node: n.id, edge: e.id });
            else if (e.len < outer - 0.5) add(check, hard, n.x, n.y, `edge ${e.id} (${e.cls}) is ${e.len.toFixed(1)} m long, shorter than the roundabout's ${outer.toFixed(1)} m ring: its far end is inside the ring`, { node: n.id, edge: e.id });
        }
    }
    return rings;
}

function checkLayers(graph, open, openIds, year, box, add, hardClearance) {
    const { pairs, clearance } = scanSegments(graph, open, openIds, year, box, add, hardClearance);
    for (const p of pairs.values()) {
        // two decks side by side on one structure are not generalised away (the bake never edits a bridge or tunnel
        // stretch): report them softly until phases 7 and 10 lay the decks out
        add(p.level ? 'deck-overlap' : 'overlap-same-layer', !p.level, p.x, p.y, `edges ${p.e.id} (${p.e.cls}) and ${p.f.id} (${p.f.cls}) overlap by up to ${p.depth.toFixed(1)} m over ~${p.len.toFixed(0)} m at ${p.level ? 'level ' + p.level : 'the same level'}`, { edge: p.e.id, other: p.f.id });
    }
    const clusters = junctionClusters(graph, year, box);
    for (const { a, b, d } of clusters) {
        add('junction-cluster', false, (a.n.x + b.n.x) / 2, (a.n.y + b.n.y) / 2, `junctions at nodes ${a.n.id} and ${b.n.id} are ${d.toFixed(0)} m apart; their footprints (${a.r.toFixed(0)} + ${b.r.toFixed(0)} m) overlap`, { node: a.n.id, other: b.n.id });
    }
    const rings = roundaboutArmGaps(graph, openIds, year, box, add);
    return { overlapPairs: pairs.size, junctionClusters: clusters.length, roundabouts: rings, gradeSeparatedCrossings: clearance.crossings, clearanceMeasured: clearance.measured, crossingsAtGrade: clearance.atGrade };
}

/**
 * True if the overlap of two segments is the junction's own: their closest approach lies within the allowance of a node
 * and, when they run roughly alongside each other (within ~14 degrees), so does the middle of the stretch they share
 * (a long parallel run that merely starts at a junction is not).
 */
function exemptNearJunction(graph, e, f, near, mid, a, b, c, d, he, hf, year) {
    if (!nearSharedNode(graph, e, f, near, he, hf, year)) return false;
    const cross = Math.abs((b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]));
    const alongside = cross < 0.25 * Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(d[0] - c[0], d[1] - c[1]);
    return !alongside || nearSharedNode(graph, e, f, mid, he, hf, year);
}

/** True if `near` (the closest approach of edges e and f) lies within the junction/bend allowance of a node they share. */
function nearSharedNode(graph, e, f, near, he, hf, year) {
    for (const id of [e.a, e.b]) {
        if (id !== f.a && id !== f.b) continue;
        const n = graph.nodes[id];
        const bearing = g => {
            const p = pointAt(g.pts, g.a === id ? Math.min(8, g.len / 2) : Math.max(g.len - 8, g.len / 2));
            return Math.atan2(p.y - n.y, p.x - n.x);
        };
        let th = Math.abs(bearing(e) - bearing(f)) % (2 * Math.PI);
        if (th > Math.PI) th = 2 * Math.PI - th;
        // strips of two roads leaving a node at angle th overlap out to (he + hf) / (2 sin(th / 2)) from it
        const reach = Math.min(60, (he + hf) / (2 * Math.sin(Math.max(th, 0.14) / 2)));
        if (Math.hypot(near.x - n.x, near.y - n.y) <= Math.max(reach, junctionRadius(graph, n, year)) + 0.5) return true;
    }
    // beside a junction of either road (not shared): that junction's own patch covers the overlap (plan 0009 phase 4)
    for (const id of [e.a, e.b, f.a, f.b]) {
        const n = graph.nodes[id], r = junctionRadius(graph, n, year);
        if (r && Math.hypot(near.x - n.x, near.y - n.y) <= r + 0.5) return true;
    }
    return false;
}

/**
 * Trunk chain check: the edges whose ref includes any of `refs` must form one connected network (through shared
 * nodes, including collapsed roundabouts). Returns {counts, issues} with one hard issue per detached piece.
 */
export function validateChains(world, { refs = ['M5', 'A30', 'A38'], year = 2024 } = {}) {
    const { graph } = world;
    const want = new Set(refs);
    const refsOf = e => (e.ref ?? '').split(';').map(r => r.trim()).filter(r => want.has(r));
    const edges = graph.edges.filter(e => edgeOpen(e, year) && refsOf(e).length);
    const parent = new Map();
    const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (const e of edges) { for (const id of [e.a, e.b]) if (!parent.has(id)) parent.set(id, id); parent.set(find(e.a), find(e.b)); }
    const comps = new Map();
    for (const e of edges) {
        const r = find(e.a);
        if (!comps.has(r)) comps.set(r, { len: 0, refs: new Set(), x: e.pts[0], y: e.pts[1] });
        const c = comps.get(r);
        c.len += e.len;
        for (const x of refsOf(e)) c.refs.add(x);
    }
    const list = [...comps.values()].sort((a, b) => b.len - a.len);
    const issues = list.slice(1).map(c => ({ check: 'chain-broken', hard: true, x: c.x, y: c.y, detail: `${[...c.refs].join('/')} piece of ${c.len.toFixed(0)} m not joined to the main ${refs.join('/')} chain` }));
    return { counts: { components: list.length, edges: edges.length, km: +(edges.reduce((a, e) => a + e.len, 0) / 1000).toFixed(1), sizes: list.slice(0, 5).map(c => +c.len.toFixed(0)) }, issues };
}

/**
 * Yard checks. `world` needs `graph` (with `index`) and `yards` (depots, garages, sites, farms; each with `node`,
 * `yard.zone`). Hard issues: yard-disconnected (its node is not in the biggest road component in a sample year),
 * yard-on-road (the yard zone overlaps a carriageway other than its own access), yard-overlap (two yard zones overlap).
 */
export function validateYards(world, { years = SAMPLE_YEARS } = {}) {
    const { graph } = world;
    const issues = [];
    const add = (check, y, detail) => issues.push({ check, hard: true, x: y.x, y: y.y, detail });
    for (const year of years) {
        const parent = graph.nodes.map((_, i) => i);
        const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
        const size = new Map();
        for (const e of graph.edges) if (edgeOpen(e, year)) parent[find(e.a)] = find(e.b);
        for (const n of graph.nodes) if (n.edges.some(id => edgeOpen(graph.edges[id], year))) { const r = find(n.id); size.set(r, (size.get(r) ?? 0) + 1); }
        const main = [...size.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        for (const y of world.yards) if (find(y.node) !== main) add('yard-disconnected', y, `${y.name} (${y.type}) is not on the main road network in ${year}`);
    }
    for (const y of world.yards) {
        const own = new Set(graph.nodes[y.node].edges);
        const zone = y.yard.zone;
        for (const s of graph.index.near(zone.x, zone.y, Math.hypot(zone.hx, zone.hy) + 30)) {
            if (own.has(s.edge)) continue;
            const e = graph.edges[s.edge];
            if (e.cls === 'ferry') continue;
            const ax = e.pts[2 * s.seg], ay = e.pts[2 * s.seg + 1], bx = e.pts[2 * s.seg + 2], by = e.pts[2 * s.seg + 3];
            if (segBoxGap(ax, ay, bx, by, zone) < ROAD_CLASS[e.cls].width / 2 - 0.01) { add('yard-on-road', y, `${y.name} (${y.type}) overlaps ${e.name ?? e.cls}`); break; }
        }
    }
    for (let i = 0; i < world.yards.length; i++) {
        for (let j = i + 1; j < world.yards.length; j++) {
            const a = world.yards[i].yard.zone, b = world.yards[j].yard.zone;
            if (Math.hypot(a.x - b.x, a.y - b.y) < 80 && sat(a, b)) add('yard-overlap', world.yards[i], `${world.yards[i].name} overlaps ${world.yards[j].name}`);
        }
    }
    return { counts: { yards: world.yards.length }, issues };
}

/** Distance from a segment to an obb (0 when they touch), by sampling. */
function segBoxGap(ax, ay, bx, by, box) {
    const c = Math.cos(box.angle), s = Math.sin(box.angle);
    const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 1.5));
    let best = Infinity;
    for (let i = 0; i <= n; i++) {
        const x = ax + ((bx - ax) * i) / n - box.x, y = ay + ((by - ay) * i) / n - box.y;
        const lx = x * c + y * s, ly = -x * s + y * c;
        best = Math.min(best, Math.hypot(Math.max(0, Math.abs(lx) - box.hx), Math.max(0, Math.abs(ly) - box.hy)));
    }
    return best;
}

/** Builds a validation world ({graph, region}) from the baked tiles under world/seed/baked/. */
export async function loadBakedWorld(dir = `${GAME}/world/seed/baked`) {
    const { decodeTiles, decodeLines } = await game('world/baked-format.js');
    const { createGraph, createSegmentIndex } = await game('world/roadgraph.js');
    const { createProjection } = await game('world/projection.js');
    const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
    const tiles = manifest.tiles.map(t => JSON.parse(readFileSync(`${dir}/${t.file}`, 'utf8')));
    const { nodes, edges } = decodeTiles(tiles);
    const graph = createGraph();
    for (const n of nodes) graph.addNode(n.x, n.y, { junction: n.junction, end: n.end, priority: n.priority, mini: n.mini, town: n.town, ringRadius: n.ringRadius, signalsFrom: n.signalsFrom, roundaboutFrom: n.roundaboutFrom, kind: n.end ? 'end' : 'junction' });
    for (const e of edges) {
        const { a, b, pts, ...props } = e;
        graph.addEdge(graph.nodes[a], graph.nodes[b], pts, props);
    }
    graph.index = createSegmentIndex(graph);
    const json = JSON.parse(readFileSync(`${GAME}/world/seed/sw-england.json`, 'utf8'));
    const proj = createProjection(json, { scale: manifest.projection.worldScale });
    const rings = decodeLines(JSON.parse(readFileSync(`${dir}/${manifest.coast}`, 'utf8')).rings);
    // one flat even-odd polygon: every ring is entered from and left back to a shared anchor point, so the
    // connecting segments are each traversed twice and cancel out
    const coast = [];
    const ax = rings[0][0], ay = rings[0][1];
    for (const r of rings) { coast.push(ax, ay); for (const v of r) coast.push(v); }
    const nw = proj.project(json.bounds.north, json.bounds.west), se = proj.project(json.bounds.south, json.bounds.east);
    const towns = json.towns.map(t => ({ ...t, ...proj.project(t.lat, t.lon) }));
    const region = {
        id: json.id, bounds: { minX: nw.x, minY: nw.y, maxX: se.x, maxY: se.y }, coast, rivers: [], moors: [], towns,
        townById: new Map(towns.map(t => [t.id, t])), events: manifest.events, maxGrade: { ...json.maxGrade }, waterCache: new Map(),
    };
    return { graph, region, manifest, softWater: true };
}

/**
 * Furniture checks. `props` is [{x, y, kind}] (lamps, signs, signals); `buildings` is [{box}].
 * A prop is on the road if it lies within half the carriageway plus `margin` of any open edge's centreline.
 */
export function validateFurniture(world, props, { year = 2024, margin = 0.5, buildings = [] } = {}) {
    const { graph } = world;
    const issues = [];
    const buildingIdx = new Map();
    const bkey = (x, y) => Math.floor(x / 32) * 100003 + Math.floor(y / 32);
    for (const b of buildings) {
        const r = Math.hypot(b.box.hx, b.box.hy);
        for (let i = Math.floor((b.box.x - r) / 32); i <= Math.floor((b.box.x + r) / 32); i++) {
            for (let j = Math.floor((b.box.y - r) / 32); j <= Math.floor((b.box.y + r) / 32); j++) {
                const k = i * 100003 + j;
                (buildingIdx.get(k) ?? buildingIdx.set(k, []).get(k)).push(b);
            }
        }
    }
    const seen = new Set();
    for (const p of props) {
        let onRoad = null;
        const done = new Set();
        for (const s of graph.index.near(p.x, p.y, 30)) {
            if (done.has(s.edge)) continue;
            done.add(s.edge);
            const e = graph.edges[s.edge];
            if (!edgeOpen(e, year) || e.cls === 'ferry' || e.bridge) continue;
            const c = closestOnPoly(e.pts, p.x, p.y);
            const half = edgeWidth(e, year) / 2 + margin;
            if (c.d < half && (!onRoad || c.d < onRoad.d)) onRoad = { d: c.d, edge: e.id, half };
        }
        const id = `${p.kind}:${p.x.toFixed(2)}:${p.y.toFixed(2)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        if (onRoad) {
            issues.push({ check: 'furniture-on-road', hard: true, x: p.x, y: p.y, edge: onRoad.edge, detail: `${p.kind} ${onRoad.d.toFixed(1)} m from edge ${onRoad.edge} centreline (carriageway + margin ${onRoad.half.toFixed(1)} m)` });
        }
        const probe = obb(p.x, p.y, 0.4, 0.4, 0);
        for (const b of buildingIdx.get(bkey(p.x, p.y)) ?? []) {
            if (sat(b.box, probe)) { issues.push({ check: 'furniture-in-building', hard: true, x: p.x, y: p.y, detail: `${p.kind} inside a building` }); break; }
        }
    }
    return { counts: { props: props.length }, issues };
}

/** Lamps, signs and signals of the chunks covering a box (generates them). */
export function collectFurniture(world, box, year = 2024) {
    const { CHUNK_SIZE } = world.constants;
    const props = [], buildings = new Map();
    for (let i = Math.floor(box.minX / CHUNK_SIZE); i <= Math.floor(box.maxX / CHUNK_SIZE); i++) {
        for (let j = Math.floor(box.minY / CHUNK_SIZE); j <= Math.floor(box.maxY / CHUNK_SIZE); j++) {
            const c = world.chunks.get(i, j);
            for (const l of c.lamps ?? []) if (isLive(l, year)) props.push({ kind: 'lamp', x: l.x, y: l.y });
            for (const s of c.signs ?? []) if (isLive(s, year)) props.push({ kind: 'sign', x: s.x, y: s.y });
            for (const s of c.signals ?? []) props.push({ kind: 'signal', x: s.x, y: s.y });
            for (const b of c.buildings ?? []) buildings.set(b, b);
        }
    }
    return { props, buildings: [...buildings.keys()] };
}

// ---- CLI ---------------------------------------------------------------------------------------------------------

const toArrayBuffer = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

function parseArgs(argv) {
    const o = { area: DEFAULT_AREAS.join(','), year: 2024, radius: 1500, furniture: false, strict: false, json: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--area') o.area = argv[++i];
        else if (a === '--year') o.year = +argv[++i];
        else if (a === '--radius') o.radius = +argv[++i];
        else if (a === '--furniture') o.furniture = true;
        else if (a === '--strict') o.strict = true;
        else if (a === '--json') o.json = true;
        else if (a === '--baked') o.baked = true;
        else if (a === '--check-yards') o.yards = true;
        else if (a === '--soft-clearance') o.softClearance = true;
        else if (a === '--hard-clearance') o.softClearance = false; // (the default since plan 0009 phase 7)
        else throw new Error(`unknown argument ${a}`);
    }
    return o;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const { CHUNK_SIZE } = await game('config.js');
    let world;
    if (opts.baked) {
        world = await loadBakedWorld();
        if (opts.furniture) { console.warn('note: --furniture needs generated chunks; not available with --baked yet'); opts.furniture = false; }
    } else {
        const { createWorld } = await game('world/world.js');
        // the full game world: seed + baked roads + yards, farms and generated chunks (what the game builds at load)
        const { decodeBaked } = await game('world/baked-loader.js');
        const dir = `${GAME}/world/seed/baked`;
        const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
        const baked = decodeBaked(manifest, manifest.tiles.map(t => JSON.parse(readFileSync(`${dir}/${t.file}`, 'utf8'))), JSON.parse(readFileSync(`${dir}/${manifest.coast}`, 'utf8')), toArrayBuffer(readFileSync(`${dir}/${manifest.elevation.file}`)));
        world = createWorld({ ...JSON.parse(readFileSync(`${GAME}/world/seed/sw-england.json`, 'utf8')), baked });
    }
    world.constants = { CHUNK_SIZE };
    if (opts.yards && !world.yards) { console.warn('note: --check-yards needs the full game world; it is skipped with --baked'); opts.yards = false; }

    const areas = opts.area === 'all' ? [null] : opts.area.split(',').map(id => {
        const t = world.region.towns.find(t => t.id === id);
        if (!t) throw new Error(`unknown area/town "${id}"`);
        return { id, box: { minX: t.x - opts.radius, maxX: t.x + opts.radius, minY: t.y - opts.radius, maxY: t.y + opts.radius } };
    });

    const report = [];
    let hard = 0;
    for (const area of areas) {
        const box = area?.box ?? null;
        const g = validateGraph(world, { year: opts.year, box, hardClearance: !opts.softClearance });
        let issues = g.issues;
        let furnitureCounts = null;
        if (opts.furniture) {
            const fbox = box ?? { minX: world.region.bounds.minX, maxX: world.region.bounds.maxX, minY: world.region.bounds.minY, maxY: world.region.bounds.maxY };
            const { props, buildings } = collectFurniture(world, fbox, opts.year);
            const f = validateFurniture(world, props, { year: opts.year, buildings });
            furnitureCounts = f.counts;
            issues = issues.concat(f.issues);
        }
        if (opts.yards) issues = issues.concat(validateYards(world).issues.filter(i => !box || (i.x >= box.minX && i.x <= box.maxX && i.y >= box.minY && i.y <= box.maxY)));
        const byCheck = {};
        for (const i of issues) byCheck[i.check] = (byCheck[i.check] ?? 0) + 1;
        let chains = null;
        if (opts.baked && !area) {
            const c = validateChains(world, { year: opts.year });
            chains = c.counts;
            issues = issues.concat(c.issues);
            for (const i of c.issues) byCheck[i.check] = (byCheck[i.check] ?? 0) + 1;
        }
        hard += issues.filter(i => i.hard).length;
        report.push({ area: area?.id ?? 'all', counts: g.counts, furniture: furnitureCounts, chains, byCheck, issues });
    }

    if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        for (const r of report) {
            console.log(`\n== ${r.area} (year ${opts.year}) ==`);
            console.log(`graph: ${r.counts.nodes} nodes, ${r.counts.edges} edges (${r.counts.openEdges} open), ${r.counts.components} component(s) ${JSON.stringify(r.counts.largestComponents)}`);
            if (r.furniture) console.log(`furniture props checked: ${r.furniture.props}`);
            if (r.chains) console.log(`M5/A30/A38 chain: ${r.chains.components} component(s), ${r.chains.edges} edges, ${r.chains.km} km ${JSON.stringify(r.chains.sizes)}`);
            if (!r.issues.length) console.log('no issues');
            for (const [check, n] of Object.entries(r.byCheck)) console.log(`  ${check}: ${n}`);
            for (const i of r.issues.slice(0, 5)) console.log(`    e.g. [${i.check}] (${i.x.toFixed(0)}, ${i.y.toFixed(0)}) ${i.detail}`);
        }
        console.log(`\nhard failures: ${hard}`);
    }
    process.exitCode = opts.strict && hard ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
