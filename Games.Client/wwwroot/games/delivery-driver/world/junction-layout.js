// Junction layout engine (plan 0009 phase 8). Pure: no DOM, no GL, no terrain. The single source of junction geometry
// for meshes, furniture, buildings, traffic and the validator.
//
//   layoutJunction(graph, node, year) -> {
//     kind: 'none' | 'end' | 'through' | 'plain' | 'mini' | 'roundabout',
//     node, centre {x, y}, type (junctionType), level,
//     arms[]    one per open edge end, sorted by ascending bearing (atan2 of y, x; y points south, so this is clockwise
//               on screen): { edge, end 'a'|'b', bearing, hw, cls, rank, oneway, inbound, outbound, level, trim,
//               mouth {x, y, heading (outward), nx, ny (the + side)}, mL, mR (kerb corners at the mouth: mL on the +n
//               side, towards the next arm), spread (rad, mouth shift on a ring), clamped }
//     boundary[] the junction surface as one simple polygon [{x, y}] in ascending-angle order (star-shaped about the
//               centre); for a roundabout the OUTER silhouette (ring plus flared mouths) with the island as a hole
//     ring?     { ri, ro, width, rc (lane centre radius), flare } for a roundabout
//     islands[] [{ kind: 'island' | 'splitter' | 'mini', poly: [{x, y}], arm? }]
//     stopLines[] [{ arm, kind: 'stop' | 'giveway', x0, y0, x1, y1, x, y, angle }]  (angle: direction of travel into the junction)
//     poles[]   [{ arm, x, y }] signal poles (signals from 1935)
//     connectors[] [{ from, to, kind: 'straight' | 'left' | 'right' | 'ring' | 'uturn', pts: flat [x, y, ...], len }]
//     passing[] ids of edges that meet the node at another level (not arms)
//     stats { clamped, spread, rejected: [reason] }
//   }
//
// Traffic drives on the left of its direction of travel (laneOffset/lanePoint of roadgraph.js, with y pointing south):
// for an arm pointing outwards at heading h, the inbound lane lies on the +n side, n = (-sin h, cos h), the outbound
// lane on the -n side. Roundabouts circulate clockwise on screen, i.e. towards increasing angle.
//
// The layout is a function of (graph, node, year), cached per node under a signature of its open arms (see
// junctionSignature), so it is computed lazily where meshes, furniture or traffic ask for it, never for the whole world.
import { pointAt } from './geom.js';
import { ROAD_CLASS, LANE_WIDTH, edgeOpen, edgeWidth, edgeClass, junctionType, laneOffset } from './roadgraph.js';
import { levelAt } from './crossings.js';
import { createSpline, arcSamples } from './road-spline.js';

/** Kerb return radius (m) by the larger road rank at the corner: lanes 4, streets and B roads 6, A roads 8, dual and motorway 12. */
export const CORNER_RADIUS = { 1: 4, 2: 6, 3: 6, 4: 8, 5: 12, 6: 12 };
/** Roundabout island radius range and circulating width by the highest road rank meeting there. */
export const RING_CLASS = { 1: { min: 4, max: 6, width: 6.5 }, 2: { min: 4, max: 7, width: 7 }, 3: { min: 4.5, max: 9, width: 7.5 }, 4: { min: 5, max: 11, width: 8 }, 5: { min: 8, max: 14, width: 9 }, 6: { min: 10, max: 14, width: 9 } };
/**
 * Roundabout tiers (plan 0011 phase 6): mini is `node.mini`; small is road rank 1 to 2 (ring 4 to 7 m; rank 1 lanes and access
 * roads get the smaller 4 to 6 m island and 6.5 m circulating width), medium rank 3 to 4 (4.5 to 11 m), large rank 5 to 6 (8 to 14 m).
 * `node.tier` ('small' | 'medium' | 'large') overrides the rank-derived tier; it uses the tier's representative rank below.
 */
export const RING_TIER_RANK = { small: 2, medium: 4, large: 5 };
export const ringTierOf = rank => (rank >= 5 ? 'large' : rank >= 3 ? 'medium' : 'small');
const ringClass = (node, rank) => RING_CLASS[RING_TIER_RANK[node.tier] ?? rank] ?? RING_CLASS[2];
export const RI_MIN = 4, RI_MAX = 14;
export const FLARE_WIDTH = 1.2, FLARE_LENGTH = 12;
export const MINI_RADIUS = 1.5;
/** Largest mouth shift on a ring (rad, 12 degrees), smallest angle between plain arms before the corner is judged tight. */
export const SPREAD_MAX = (12 * Math.PI) / 180, MIN_PHI = 0.35;
/** Longest kerb return reach beyond a corner (m): acute corners get a smaller radius so their trim stays bounded. */
const EXT_MAX = 14;
export const TIGHT_TRIM = 14;
const MIN_PHI_FLOOR = 0.1, MIN_TRIM = 1.5, TRIM_MARGIN = 0.3, TRIM_MAX = 45, EDGE_SHARE = 0.45, FREE_SHARE = 0.9, RING_SHARE = 0.75, MIN_RING_GAP = 0.03, SHRUNK_RO_MIN = 8.5;

const TWO_PI = Math.PI * 2;
const TMP = { x: 0, y: 0, angle: 0, seg: 0 };
const wrap = a => { a = (a + Math.PI) % TWO_PI; if (a < 0) a += TWO_PI; return a - Math.PI; };
const rankOf = (cls) => ROAD_CLASS[cls]?.rank ?? 1;
/** Open roads at the far end of an arm's edge (loops excluded): a junction there takes its own share of the edge. */
const openAt = (graph, nodeId, year) => graph.nodes[nodeId].edges.reduce((n, id) => n + (edgeOpen(graph.edges[id], year) && graph.edges[id].a !== graph.edges[id].b ? 1 : 0), 0);
/** Share of an edge's length a junction may take at one end: 0.45 when a junction sits at the other end too, else nearly all. */
const shareOf = (arm, selfRing) => (arm.farOpen < 3 ? FREE_SHARE : selfRing && !arm.farRing ? RING_SHARE : !selfRing && arm.farRing ? 1 - RING_SHARE - 0.02 : EDGE_SHARE);
const isRing = (graph, node, year) => junctionType(node, year) === 'roundabout' && !node.mini && openAt(graph, node.id, year) >= 3;

// ---- cache and signature -----------------------------------------------------------------------------------------

const caches = new WeakMap(); // graph -> Map(signature -> layout)

/** A string that changes exactly when the node's layout can: its open arms (edge, class, one-way, length), type and markings. */
export function junctionSignature(graph, node, year) {
    const budget = reachBudget(graph, node, year);
    let s = `${node.id}|${Number.isFinite(budget) ? budget.toFixed(1) : ''}|${junctionType(node, year)}|${node.mini ? 'm' : ''}${node.priority ? 'p' : ''}${node.tier ? 't' + node.tier : ''}|${node.ringRadius === undefined ? '' : node.ringRadius.toFixed(1)}|${year >= 1935 ? 's' : ''}${year >= 1960 ? 'g' : ''}`;
    for (const id of node.edges) {
        const e = graph.edges[id];
        if (!edgeOpen(e, year)) continue;
        s += `|${id}${e.a === node.id ? 'a' : 'b'}${edgeClass(e, year)}${e.oneway ? 'o' : ''}${e.link ? 'l' : ''}${e.len.toFixed(1)}${openAt(graph, e.a === node.id ? e.b : e.a, year) >= 3 ? 'j' : ''}${isRing(graph, graph.nodes[e.a === node.id ? e.b : e.a], year) ? 'r' : ''}`;
    }
    return s;
}

const quick = new WeakMap(); // graph -> Map(node id * 4096 + year -> { stamp fields, layout })

/**
 * The layout of a node in a year (cached under its signature). Never null: 'none' kind for a node with no open arm.
 * Working out the signature (which needs the reach budget against the neighbouring junctions) costs more than the
 * lookup is worth in a hot path, so the layout of a (node, year) is also remembered with a cheap stamp - the graph's
 * size and the node's own junction fields - and returned straight away while the stamp still matches.
 */
export function layoutJunction(graph, node, year = 2100) {
    let q = quick.get(graph);
    if (!q) quick.set(graph, (q = new Map()));
    const key = node.id * 4096 + (year | 0);
    const hit = q.get(key);
    if (hit && hit.year === year && hit.ng === graph.nodes.length && hit.ne === graph.edges.length && hit.arms === node.edges.length
        && hit.jn === node.junction && hit.mini === node.mini && hit.tier === node.tier && hit.pri === node.priority && hit.rr === node.ringRadius
        && hit.rf === node.roundaboutFrom && hit.df === node.doubleFrom &&hit.sf === node.signalsFrom) return hit.layout;
    let cache = caches.get(graph);
    if (!cache) caches.set(graph, (cache = new Map()));
    const sig = junctionSignature(graph, node, year);
    let layout = cache.get(sig);
    if (!layout) { layout = computeLayout(graph, node, year); cache.set(sig, layout); }
    q.set(key, { year, ng: graph.nodes.length, ne: graph.edges.length, arms: node.edges.length, jn: node.junction, mini: node.mini, tier: node.tier, pri: node.priority, rr: node.ringRadius, rf: node.roundaboutFrom, df: node.doubleFrom, sf: node.signalsFrom, layout });
    return layout;
}

/** Distance (m) along an edge, from the given end ('a' | 'b' | 0 | 1), at which its junction ends and the road strip begins. */
export function trimFor(graph, edge, end, year = 2100) {
    const atA = end === 'a' || end === 0;
    const node = graph.nodes[atA ? edge.a : edge.b];
    if (node.edges.length < 2 || edge.a === edge.b) return 0;
    const lay = layoutJunction(graph, node, year);
    const arm = lay.arms.find(a => a.edge === edge && a.end === (atA ? 'a' : 'b'));
    return arm ? arm.trim : 0;
}

/** Farthest distance from the node's centre of anything the junction occupies (kerbs, mouths, ring): nothing but road lies closer. */
export function mouthRadius(graph, node, year = 2100) {
    return layoutJunction(graph, node, year).reach;
}

/**
 * Height of each arm of a layout at its mouth (where the edge strip stops), from `heightAt(edge, d)` (roadHeightAt), or null
 * for an arm whose edge has no graded profile. The junction surface joins each arm at exactly this height (road-mesh.js).
 */
export function armMouthHeights(lay, heightAt) {
    return lay.arms.map(a => (a.edge.z ? heightAt(a.edge, a.end === 'a' ? a.trim : a.edge.len - a.trim) : null));
}

/**
 * The mean of a junction's arm mouth heights: the level the arms agree on, node.z (the ground-fitted node height) as the
 * fallback. Measurement only (plan 0012 phase 4): the surface is still drawn at node.z, because the ground pad is graded to
 * node.z and a ring at the arm mean shows the ground through it where the mean is lower.
 */
export function junctionLevel(node, lay, heightAt) {
    const zs = armMouthHeights(lay, heightAt).filter(z => z !== null);
    return zs.length ? zs.reduce((s, z) => s + z, 0) / zs.length : node.z;
}

// ---- neighbouring junctions --------------------------------------------------------------------------------------

const nodeGrids = new WeakMap(); // graph -> { n (node count), cells }
const GRID = 100;
function nodeGrid(graph) {
    let g = nodeGrids.get(graph);
    if (g && g.n === graph.nodes.length) return g;
    g = { n: graph.nodes.length, cells: new Map() };
    for (const node of graph.nodes) {
        if (node.edges.length < 3) continue;
        const k = Math.floor(node.x / GRID) * 100003 + Math.floor(node.y / GRID);
        (g.cells.get(k) ?? g.cells.set(k, []).get(k)).push(node);
    }
    nodeGrids.set(graph, g);
    return g;
}

/** A node's nominal size (m) as a junction in a year (a ring also what it needs to keep clear), or null if it has fewer than three open roads. */
function weightOf(graph, node, year) {
    let open = 0, hw = 0, rank = 1;
    for (const id of node.edges) {
        const e = graph.edges[id];
        if (!edgeOpen(e, year) || e.a === e.b) continue;
        open++;
        hw = Math.max(hw, edgeWidth(e, year) / 2);
        rank = Math.max(rank, rankOf(edgeClass(e, year)));
    }
    if (open < 3) return null;
    if (junctionType(node, year) === 'roundabout' && !node.mini) { const rc = ringClass(node, rank); return { ring: true, size: rc.min + rc.width + 6, need: rc.min + rc.width + 1.5 }; }
    return { ring: false, size: hw + (CORNER_RADIUS[rank] ?? 6) };
}

/**
 * The radius (m) the node's junction may occupy so that it cannot meet a neighbouring junction's: each pair of junction
 * nodes shares the distance between them in proportion to their nominal sizes (so two discs of those radii never overlap);
 * a roundabout keeps at least the ring it needs and a plain junction beside it gets the rest. Infinity when no other junction is near.
 */
function reachBudget(graph, node, year) {
    const w = weightOf(graph, node, year);
    if (!w) return Infinity;
    const grid = nodeGrid(graph);
    const ci = Math.floor(node.x / GRID), cj = Math.floor(node.y / GRID);
    let budget = Infinity;
    for (let i = ci - 1; i <= ci + 1; i++) {
        for (let j = cj - 1; j <= cj + 1; j++) {
            for (const m of grid.cells.get(i * 100003 + j) ?? []) {
                if (m === node) continue;
                const d = Math.hypot(m.x - node.x, m.y - node.y);
                if (d >= 2 * GRID) continue;
                const wm = weightOf(graph, m, year);
                if (!wm) continue;
                let share;
                if (w.ring === wm.ring) share = (d * w.size) / (w.size + wm.size);
                else {
                    // a ring keeps at least the ring it needs; the plain junction beside it gets the rest
                    const r = w.ring ? w : wm, q = w.ring ? wm : w;
                    const ringShare = Math.max(r.need, (d * r.size) / (r.size + q.size));
                    share = w.ring ? ringShare : Math.max(0, d - ringShare);
                }
                budget = Math.min(budget, share);
            }
        }
    }
    return budget;
}

/** The trim (m) at which an arm's mouth corners surely lie inside the junction's disc of radius `budget` (a corner is within hw of the mouth centre, which is within the trim of the node). */
const budgetTrim = (budget, hw) => Math.max(MIN_TRIM, budget - hw);


// ---- arms on the edge's spline -------------------------------------------------------------------------------------

/** The edge's centripetal spline through its baked points (arc length, tangent and normal at any distance), built once. */
export function edgeSpline(edge) {
    if (edge._spl !== undefined) return edge._spl;
    const pts = [];
    for (let i = 0; i < edge.pts.length; i += 2) {
        const p = pts[pts.length - 1];
        if (!p || Math.hypot(edge.pts[i] - p.x, edge.pts[i + 1] - p.y) > 0.01) pts.push({ x: edge.pts[i], y: edge.pts[i + 1] });
    }
    // a point 1 m in from each end pins the end tangent to the first/last chord (the spline's own end extrapolation would
    // swing it on a short edge with a corner), so the road leaves a junction along the chord the layout bearing assumes
    if (pts.length >= 3) {
        const pin = (a, c) => { const l = Math.hypot(c.x - a.x, c.y - a.y), k = Math.min(1, l / 3) / l; return { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k }; };
        const n = pts.length;
        pts.splice(n - 1, 0, pin(pts[n - 1], pts[n - 2]));
        pts.splice(1, 0, pin(pts[0], pts[1]));
    }
    return (edge._spl = pts.length >= 2 ? createSpline(pts) : null);
}

const ARM = { x: 0, y: 0, angle: 0 };
/** Point and heading (outward from the node) of an arm's spline at distance `d` (polyline metres) from the node. */
function armPoint(arm, d, out = ARM) {
    const e = arm.edge, atA = arm.end === 'a', spl = edgeSpline(e);
    if (!spl) {
        const p = pointAt(e.pts, atA ? d : e.len - d, TMP);
        out.x = p.x; out.y = p.y; out.angle = atA ? p.angle : p.angle + Math.PI;
        return out;
    }
    const k = e.len / (spl.length || 1), s = Math.max(0, Math.min(spl.length, (atA ? d : e.len - d) / k));
    const q = spl.at(s);
    out.x = q.x; out.y = q.y; out.angle = Math.atan2(q.ty, q.tx) + (atA ? 0 : Math.PI);
    return out;
}

// ---- layout ------------------------------------------------------------------------------------------------------

function buildArms(graph, node, year) {
    const arms = [];
    for (const id of node.edges) {
        const e = graph.edges[id];
        if (!edgeOpen(e, year) || e.a === e.b) continue;
        const atA = e.a === node.id;
        if (arms.some(a => a.edge === e && a.end === (atA ? 'a' : 'b'))) continue;
        const reach = Math.min(e.len, 8);
        const p = pointAt(e.pts, atA ? reach : e.len - reach, TMP);
        let bearing = Math.atan2(p.y - node.y, p.x - node.x);
        if (Math.hypot(p.x - node.x, p.y - node.y) < 0.01) bearing = atA ? p.angle : p.angle + Math.PI;
        const cls = edgeClass(e, year);
        arms.push({
            edge: e, end: atA ? 'a' : 'b', bearing, hw: edgeWidth(e, year) / 2, cls, rank: rankOf(cls), oneway: !!e.oneway,
            inbound: !e.oneway || !atA, outbound: !e.oneway || atA, level: levelAt(e, atA ? 0 : e.len, 0),
            farOpen: openAt(graph, atA ? e.b : e.a, year), farRing: isRing(graph, graph.nodes[atA ? e.b : e.a], year), trim: 0, mouth: null, mL: null, mR: null, spread: 0, clamped: false,
        });
    }
    return arms.sort((p, q) => p.bearing - q.bearing || p.edge.id - q.edge.id);
}

/** Sets an arm's mouth (the centreline point at `trim` from the node and the kerb corners across it). */
function setMouth(arm, trim) {
    arm.trim = trim;
    const p = armPoint(arm, trim), h = p.angle; // on the arm's spline, heading outward from the node
    const nx = -Math.sin(h), ny = Math.cos(h);
    arm.mouth = { x: p.x, y: p.y, heading: h, nx, ny };
    arm.mL = { x: p.x + nx * arm.hw, y: p.y + ny * arm.hw };
    arm.mR = { x: p.x - nx * arm.hw, y: p.y - ny * arm.hw };
}

function computeLayout(graph, node, year) {
    const type = junctionType(node, year);
    const layout = { kind: 'none', node: node.id, centre: { x: node.x, y: node.y }, type, level: 0, arms: [], boundary: [], ring: null, islands: [], stopLines: [], poles: [], connectors: [], passing: [], reach: 0, stats: { clamped: 0, spread: 0, hull: 0, rejected: [] } };
    let arms = buildArms(graph, node, year);
    if (!arms.length) return layout;
    layout.budget = reachBudget(graph, node, year);
    // arms at another level than the rest are passing over or under the node (the baked topology never joins them)
    const counts = new Map();
    for (const a of arms) counts.set(a.level, (counts.get(a.level) ?? 0) + 1);
    let level = 0, best = 0;
    for (const [lv, n] of [...counts].sort((p, q) => Math.abs(p[0]) - Math.abs(q[0]))) if (n > best) { best = n; level = lv; }
    layout.level = level;
    layout.passing = arms.filter(a => a.level !== level).map(a => a.edge.id);
    arms = arms.filter(a => a.level === level);
    layout.arms = arms;
    if (arms.length === 1) layoutEnd(layout, node, year);
    else if (arms.length === 2) layoutThrough(layout, node, year);
    else if (type === 'roundabout' && !node.mini) layoutRing(layout, node, year);
    else layoutPlain(layout, node, year, type === 'roundabout' ? 'mini' : 'plain');
    finish(layout, node, year);
    return layout;
}

// ---- dead ends and through nodes ------------------------------------------------------------------------------------

function layoutEnd(layout, node, year) {
    layout.kind = 'end';
    const a = layout.arms[0];
    setMouth(a, 0);
    a.mouth.x = node.x; a.mouth.y = node.y;
    const pts = [a.mR, a.mL];
    // a rounded cap behind the end of the road: from the + side round the back to the - side
    for (let k = 1; k < 8; k++) {
        const ang = a.mouth.heading + Math.PI / 2 + (Math.PI * k) / 8;
        pts.push({ x: node.x + Math.cos(ang) * a.hw, y: node.y + Math.sin(ang) * a.hw });
    }
    layout.boundary = pts;
    a.mL = { x: node.x + a.mouth.nx * a.hw, y: node.y + a.mouth.ny * a.hw };
    a.mR = { x: node.x - a.mouth.nx * a.hw, y: node.y - a.mouth.ny * a.hw };
    layout.connectors.push(connector(layout, 0, 0, 'uturn', uturn(a, year)));
}

function layoutThrough(layout, node, year) {
    layout.kind = 'through';
    for (const a of layout.arms) { setMouth(a, 0); a.mouth.x = node.x; a.mouth.y = node.y; }
}

// ---- plain junctions ---------------------------------------------------------------------------------------------

function layoutPlain(layout, node, year, kind) {
    layout.kind = kind;
    const arms = layout.arms, n = arms.length;
    for (const a of arms) {
        a.ux = Math.cos(a.bearing); a.uy = Math.sin(a.bearing); a.nx = -a.uy; a.ny = a.ux;
        // the most the arm may give to the junction: a share of its edge, and what the neighbouring junctions leave
        a.cap = Math.min(TRIM_MAX, shareOf(a, false) * a.edge.len, budgetTrim(layout.budget, a.hw));
    }
    // the corner between each arm and the next one (ascending angle): A's + side faces B's - side
    const pairs = arms.map((A, i) => {
        const B = arms[(i + 1) % n];
        let phi = i < n - 1 ? B.bearing - A.bearing : B.bearing + TWO_PI - A.bearing;
        if (phi < 1e-3) phi = 1e-3;
        const hA = A.hw, hB = B.hw, r = CORNER_RADIUS[Math.max(A.rank, B.rank)] ?? 6;
        const pr = { A, B, phi, hA, hB, mode: 'cap', tA: 0, tB: 0, tight: false };
        if (phi < Math.PI - 0.02) {
            const pe = Math.max(phi, MIN_PHI_FLOOR);
            pr.tight = phi < MIN_PHI;
            pr.mode = 'fillet';
            const sinp = Math.sin(pe), cosp = Math.cos(pe);
            pr.s = (hB + hA * cosp) / sinp; pr.t = (hA + hB * cosp) / sinp;
            // a tight corner has no room for a return: the kerbs just run on until the mouths are clear of each other
            pr.r = pr.tight ? 0 : Math.min(r, EXT_MAX * Math.tan(pe / 2));
            pr.ext = pr.tight ? 0 : pr.r / Math.tan(pe / 2);
            // little room (a short edge, a neighbouring junction close by): a smaller return, down to a sharp corner
            if (!pr.tight) {
                const room = Math.min(A.cap - TRIM_MARGIN - pr.s, B.cap - TRIM_MARGIN - pr.t);
                if (room < pr.ext) { pr.ext = Math.max(0, room); pr.r = pr.ext * Math.tan(pe / 2); }
            }
            pr.tA = pr.s + pr.ext; pr.tB = pr.t + pr.ext;
        }
        return pr;
    });
    arms.forEach((a, i) => {
        const left = pairs[i], right = pairs[(i - 1 + n) % n];
        // (a tight corner would need a long sliver of kerb before the mouths clear: it is cut short and the mouths may overlap)
        let trim = Math.max(MIN_TRIM, (left.tight ? Math.min(left.tA, TIGHT_TRIM) : left.tA) + TRIM_MARGIN, (right.tight ? Math.min(right.tB, TIGHT_TRIM) : right.tB) + TRIM_MARGIN);
        const cap = a.cap;
        if (trim > cap) { trim = cap; a.clamped = true; layout.stats.clamped++; }
        setMouth(a, trim);
        if (left.tight || right.tight) { a.spread = 1; }
    });
    layout.stats.spread = arms.filter(a => a.spread).length;
    // the surface: for each arm its mouth, then the kerb return to the next arm
    const poly = [];
    pairs.forEach(pr => {
        const { A, B } = pr;
        poly.push(A.mR, A.mL);
        const okA = pr.tA <= A.trim + 1e-6, okB = pr.tB <= B.trim + 1e-6;
        if (pr.mode === 'fillet' && !pr.tight && okA && okB) {
            // the kerb tangent points sit on the arms' actual kerbs (the edges may bend); the return is the exact circle for
            // straight arms, a rational quadratic through the kerb lines' intersection otherwise
            const TA = kerbPoint(A, pr.tA, 1), TB = kerbPoint(B, pr.tB, -1);
            const C = lineMeet(TA, TA.h, TB, TB.h) ?? { x: node.x + A.ux * pr.s + A.nx * pr.hA, y: node.y + A.uy * pr.s + A.ny * pr.hA };
            const w = Math.sin(pr.phi / 2);
            if (pr.tA < A.trim - 0.05) poly.push({ x: TA.x, y: TA.y });
            const nSeg = Math.max(6, Math.min(16, Math.ceil((pr.r * (Math.PI - pr.phi)) / 1.2))); // about a metre of kerb per segment
            for (let k = 1; k < nSeg; k++) {
                const u = k / nSeg, v = 1 - u, c0 = v * v, c1 = 2 * u * v * w, c2 = u * u, d = c0 + c1 + c2;
                poly.push({ x: (c0 * TA.x + c1 * C.x + c2 * TB.x) / d, y: (c0 * TA.y + c1 * C.y + c2 * TB.y) / d });
            }
            if (pr.tB < B.trim - 0.05) poly.push({ x: TB.x, y: TB.y });
        } else if (pr.mode === 'cap' && pr.phi > Math.PI + 0.02) {
            // the arms leave a reflex gap: a round back to the junction round the centre
            const p0 = { x: node.x + A.nx * pr.hA, y: node.y + A.ny * pr.hA };
            poly.push(p0);
            const sweep = pr.phi - Math.PI;
            for (let k = 1; k < 6; k++) {
                const ang = A.bearing + Math.PI / 2 + (sweep * k) / 6, h = pr.hA + ((pr.hB - pr.hA) * k) / 6;
                poly.push({ x: node.x + Math.cos(ang) * h, y: node.y + Math.sin(ang) * h });
            }
            poly.push({ x: node.x - B.nx * pr.hB, y: node.y - B.ny * pr.hB });
        }
    });
    layout.boundary = poly;
    // short edges and neighbouring junctions can leave no room for the kerb returns: the surface is then the hull of the mouths
    if (selfIntersects(poly)) { layout.boundary = hullOf(arms.flatMap(a => [a.mL, a.mR]), node); layout.stats.hull = 1; }
    if (kind === 'mini') {
        const disc = [];
        for (let k = 0; k < 14; k++) disc.push({ x: node.x + Math.cos((k * TWO_PI) / 14) * MINI_RADIUS, y: node.y + Math.sin((k * TWO_PI) / 14) * MINI_RADIUS });
        layout.islands.push({ kind: 'mini', poly: disc });
    }
    // markings and connectors
    markStops(layout, node, year, a => a.trim + 0.4, null);
    plainConnectors(layout, year);
}

/** The point on an arm's kerb at distance `d` from the node (side +1: the + side, -1: the - side) with the arm's outward heading there. */
function kerbPoint(arm, d, side) {
    const p = armPoint(arm, d), h = p.angle;
    return { x: p.x - Math.sin(h) * arm.hw * side, y: p.y + Math.cos(h) * arm.hw * side, h };
}

/** Where the line from P along heading hp meets the line from Q along hq, both ahead of their points: null if parallel or behind. */
function lineMeet(P, hp, Q, hq) {
    const dx = Math.cos(hp), dy = Math.sin(hp), ex = Math.cos(hq), ey = Math.sin(hq);
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 0.05) return null;
    const t = ((Q.x - P.x) * ey - (Q.y - P.y) * ex) / den, u = ((Q.x - P.x) * dy - (Q.y - P.y) * dx) / den;
    if (t < -0.5 || u < -0.5 || t > 100 || u > 100) return null;
    return { x: P.x + dx * t, y: P.y + dy * t };
}

/** Quadratic corner through the intersection of the two lane lines (straight when they are parallel or diverge). */
function plainConnectors(layout, year) {
    const arms = layout.arms;
    arms.forEach((A, i) => {
        if (!A.inbound) return;
        const hin = A.mouth.heading + Math.PI;
        const offA = laneOffset(A.edge, year);
        const p0 = { x: A.mouth.x + A.mouth.nx * offA, y: A.mouth.y + A.mouth.ny * offA };
        arms.forEach((B, j) => {
            if (i === j || !B.outbound) return;
            const offB = laneOffset(B.edge, year);
            const p1 = { x: B.mouth.x - B.mouth.nx * offB, y: B.mouth.y - B.mouth.ny * offB };
            const hout = B.mouth.heading;
            const delta = wrap(hout - hin);
            const kind = Math.abs(delta) < 0.35 ? 'straight' : delta > 0 ? 'right' : 'left';
            // intersection of p0 + d0 t and p1 + d1 s, with t >= 0 ahead and s <= 0 behind the exit
            const d0x = Math.cos(hin), d0y = Math.sin(hin), d1x = Math.cos(hout), d1y = Math.sin(hout);
            const den = d0x * d1y - d0y * d1x;
            let pts;
            if (Math.abs(den) > 0.05) {
                const t = ((p1.x - p0.x) * d1y - (p1.y - p0.y) * d1x) / den, s = ((p1.x - p0.x) * d0y - (p1.y - p0.y) * d0x) / den;
                if (t >= -0.5 && s <= 0.5 && t < 120 && -s < 120) {
                    const X = { x: p0.x + d0x * t, y: p0.y + d0y * t };
                    pts = [];
                    for (let k = 0; k <= 8; k++) {
                        const u = k / 8, v = 1 - u;
                        pts.push(v * v * p0.x + 2 * v * u * X.x + u * u * p1.x, v * v * p0.y + 2 * v * u * X.y + u * u * p1.y);
                    }
                }
            }
            layout.connectors.push(connector(layout, i, j, kind, pts ?? [p0.x, p0.y, p1.x, p1.y]));
        });
    });
}

/** Convex hull of points as a polygon in ascending-angle order about the centre. */
function hullOf(points, centre) {
    const pts = points.map(p => ({ x: p.x, y: p.y })).sort((p, q) => p.x - q.x || p.y - q.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const build = list => {
        const h = [];
        for (const p of list) {
            while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
            h.push(p);
        }
        h.pop();
        return h;
    };
    const hull = build(pts).concat(build(pts.slice().reverse()));
    // (monotone chain runs counter-clockwise in x-right/y-up terms, i.e. towards decreasing atan2 angle with y down: order by angle)
    hull.sort((p, q) => Math.atan2(p.y - centre.y, p.x - centre.x) - Math.atan2(q.y - centre.y, q.x - centre.x));
    return hull;
}

function uturn(a, year) {
    const off = laneOffset(a.edge, year), m = a.mouth;
    const p0 = { x: m.x + m.nx * off, y: m.y + m.ny * off }, p1 = { x: m.x - m.nx * off, y: m.y - m.ny * off };
    const pts = [p0.x, p0.y];
    for (let k = 1; k < 6; k++) {
        const ang = Math.atan2(m.ny, m.nx) + (Math.PI * k) / 6;
        pts.push(m.x + Math.cos(ang) * off, m.y + Math.sin(ang) * off);
    }
    pts.push(p1.x, p1.y);
    return pts;
}

// ---- roundabouts -------------------------------------------------------------------------------------------------

function layoutRing(layout, node, year) {
    layout.kind = 'roundabout';
    const arms = layout.arms, n = arms.length;
    const top = Math.max(...arms.map(a => a.rank));
    const cls = ringClass(node, top);
    let ri = Math.max(cls.min, Math.min(cls.max, (node.ringRadius ?? 0) - cls.width));
    const spanOf = (a, ro, flare) => 2 * Math.asin(Math.min(0.95, (a.hw + flare) / ro));
    let flare = FLARE_WIDTH, width = cls.width, maxRi = cls.max, shrunk = false;
    // an arm too short to leave the full-size ring (edges are a quarter of their real length) gets a smaller ring: the
    // island down to 2.5 m, the circulating width down to 6 m, never below an 8.5 m outer radius
    const limit = Math.min(...arms.map(a => Math.min(TRIM_MAX, shareOf(a, true) * a.edge.len, budgetTrim(layout.budget, a.hw)))) - 1.2;
    if (ri + width > limit) {
        const ro2 = Math.max(limit, SHRUNK_RO_MIN);
        width = Math.max(6, Math.min(cls.width, ro2 - 2.5));
        ri = Math.max(2.5, Math.min(ri, ro2 - width));
        maxRi = ro2 - width;
        shrunk = true;
    }
    // grow the island (within the class range) until the mouths fit round the ring, then drop the flare
    const fits = (r, f) => arms.reduce((t, a) => t + spanOf(a, r + width, f) + MIN_RING_GAP, 0) <= TWO_PI;
    while (!fits(ri, flare) && ri + 0.5 <= maxRi) ri += 0.5;
    if (!fits(ri, flare)) { flare = 0; while (!fits(ri, flare) && ri + 0.5 <= maxRi) ri += 0.5; }
    const ro = ri + width, rc = ri + width / 2;
    layout.ring = { ri, ro, width, rc, flare, shrunk };
    // each arm's trim: where its centreline is a flare length outside the ring (at most 0.45 of the edge)
    for (const a of arms) {
        const e = a.edge, cap = Math.min(TRIM_MAX, shareOf(a, true) * e.len);
        const roomy = Math.min(cap, Math.max(budgetTrim(layout.budget, a.hw), ro + 1.2)); // neighbours shorten the flare, never the ring entry
        const want = ro + FLARE_LENGTH;
        let trim = roomy, found = false;
        for (let d = 0.5; d <= roomy + 1e-9; d += 0.5) {
            const p = armPoint(a, d);
            if (Math.hypot(p.x - node.x, p.y - node.y) >= want) { trim = d; found = true; break; }
        }
        if (!found) { a.clamped = true; layout.stats.clamped++; }
        setMouth(a, trim);
        a.radial = Math.hypot(a.mouth.x - node.x, a.mouth.y - node.y);
        a.angle0 = Math.atan2(a.mouth.y - node.y, a.mouth.x - node.x);
        if (a.radial < ro + 1) layout.stats.rejected.push('arm-inside-ring');
    }
    // spread the mouths round the ring so that the flared entries do not overlap (at most 12 degrees each)
    const order = arms.map((a, i) => i).sort((p, q) => arms[p].angle0 - arms[q].angle0);
    const ringArms = order.map(i => arms[i]);
    const half = ringArms.map(a => spanOf(a, ro, flare) / 2);
    const shift = ringArms.map(() => 0);
    for (let iter = 0; iter < 80; iter++) {
        let changed = false;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const gap = ringArms[j].angle0 + shift[j] - (ringArms[i].angle0 + shift[i]) + (j <= i ? TWO_PI : 0);
            const deficit = half[i] + half[j] + MIN_RING_GAP - gap;
            if (deficit <= 1e-5) continue;
            const di = Math.min(deficit / 2, SPREAD_MAX + shift[i]);
            const dj = Math.min(deficit - di, SPREAD_MAX - shift[j]);
            if (di <= 1e-9 && dj <= 1e-9) continue;
            shift[i] -= di; shift[j] += dj; changed = true;
        }
        if (!changed) break;
    }
    ringArms.forEach((a, k) => {
        a.spread = shift[k]; a.ringAngle = a.angle0 + shift[k]; a.half = half[k];
        if (Math.abs(shift[k]) > 0.01) layout.stats.spread++;
    });
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const gap = ringArms[j].ringAngle - ringArms[i].ringAngle + (j <= i ? TWO_PI : 0);
        if (half[i] + half[j] > gap + 1e-3) { layout.stats.rejected.push('ring-crowded'); break; }
    }
    // each arm ends in an approach curve: a cubic from the mouth (leaving along the arm's spline tangent) to the ring's outer
    // circle at the arm's ring angle, arriving radially, so the arm meets the ring at a matching tangent. The flared entry
    // is that curve widened from the arm's half width to the half span of the mouth on the ring.
    const poly = [];
    const ringPt = (ang, r) => ({ x: node.x + Math.cos(ang) * r, y: node.y + Math.sin(ang) * r });
    for (const a of ringArms) {
        a.join = approachCurve(a, node, ro);
        a.flareSides = flareSides(a, ro);
    }
    ringArms.forEach((a, k) => {
        const prev = ringArms[(k - 1 + n) % n];
        let from = prev.ringAngle + prev.half, to = a.ringAngle - a.half;
        if (to < from) to += k === 0 ? TWO_PI : 0;
        if (to > from + 1e-6) for (const q of arcSamples(node.x, node.y, ro, from, to, { maxStep: 2 })) poly.push({ x: q.x, y: q.y });
        else poly.push(ringPt(to, ro));
        for (const q of a.flareSides.r) poly.push(q);
        poly.push(a.mR, a.mL);
        for (const q of a.flareSides.l) poly.push(q);
        poly.push(ringPt(a.ringAngle + a.half, ro));
        a.ringLo = ringPt(a.ringAngle - a.half, ro); a.ringHi = ringPt(a.ringAngle + a.half, ro);
    });
    layout.boundary = poly;
    const circle = r => Array.from({ length: 28 }, (_, k) => ({ x: node.x + Math.cos((k * TWO_PI) / 28) * r, y: node.y + Math.sin((k * TWO_PI) / 28) * r }));
    layout.islands.push({ kind: 'island', poly: circle(ri) });
    // a splitter island in each arm just outside the ring, tapering away from it
    for (const a of ringArms) {
        if (a.hw < 3) continue;
        const q0 = ringPt(a.ringAngle, ro + 1);
        let dx = a.mouth.x - q0.x, dy = a.mouth.y - q0.y;
        const dl = Math.hypot(dx, dy) || 1;
        dx /= dl; dy /= dl;
        const L = Math.min(9, Math.max(0, dl - 1.5)), w0 = Math.min(1.1, a.hw * 0.25);
        if (L < 2) continue;
        layout.islands.push({ kind: 'splitter', arm: layout.arms.indexOf(a), poly: [{ x: q0.x - dy * w0, y: q0.y + dx * w0 }, { x: q0.x + dx * L, y: q0.y + dy * L }, { x: q0.x + dy * w0, y: q0.y - dx * w0 }] });
    }
    markStops(layout, node, year, null, a => {
        // on the arm's approach curve, 2.5 m outside the ring, facing along its tangent
        let best = a.join[0], bd = Infinity;
        for (const q of a.join) { const d = Math.abs(Math.hypot(q.x - node.x, q.y - node.y) - (ro + 2.5)); if (d < bd) { bd = d; best = q; } }
        return { x: best.x, y: best.y, heading: Math.atan2(-best.ty, -best.tx) };
    });
    ringConnectors(layout, year, rc);
}

/** Cubic Bezier samples [{x, y, tx, ty}] from the arm's mouth to the ring's outer circle; the tangent points towards the ring. */
function approachCurve(a, node, ro) {
    const m = a.mouth, ca = Math.cos(a.ringAngle), sa = Math.sin(a.ringAngle);
    const E = { x: node.x + ca * ro, y: node.y + sa * ro };
    const dist = Math.hypot(E.x - m.x, E.y - m.y), k = dist * 0.4;
    const P1 = { x: m.x - Math.cos(m.heading) * k, y: m.y - Math.sin(m.heading) * k }, P2 = { x: E.x + ca * k, y: E.y + sa * k };
    const steps = Math.max(4, Math.ceil(dist / 1.5)), out = [];
    for (let i = 0; i <= steps; i++) {
        const u = i / steps, v = 1 - u;
        const x = v * v * v * m.x + 3 * v * v * u * P1.x + 3 * v * u * u * P2.x + u * u * u * E.x;
        const y = v * v * v * m.y + 3 * v * v * u * P1.y + 3 * v * u * u * P2.y + u * u * u * E.y;
        const dx = 3 * v * v * (P1.x - m.x) + 6 * v * u * (P2.x - P1.x) + 3 * u * u * (E.x - P2.x);
        const dy = 3 * v * v * (P1.y - m.y) + 6 * v * u * (P2.y - P1.y) + 3 * u * u * (E.y - P2.y);
        const l = Math.hypot(dx, dy) || 1;
        out.push({ x, y, tx: dx / l, ty: dy / l });
    }
    return out;
}

/** The two flared sides of an arm's entry: the approach curve offset by its half width widening towards the ring (interior points only; right side runs ring to mouth, left side mouth to ring). */
function flareSides(a, ro) {
    const J = a.join, last = J.length - 1, r = [], l = [];
    const extra = Math.max(0, ro * Math.sin(a.half) - a.hw);
    for (let i = last - 1; i >= 1; i--) {
        const u = i / last, w = a.hw + extra * u * u, q = J[i]; // (u runs from the mouth, 0, to the ring, 1)
        const nx = q.ty, ny = -q.tx; // the arm's + side
        r.push({ x: q.x - nx * w, y: q.y - ny * w });
    }
    for (let i = 1; i < last; i++) {
        const u = i / last, w = a.hw + extra * u * u, q = J[i];
        l.push({ x: q.x + q.ty * w, y: q.y - q.tx * w });
    }
    return { r, l };
}

function ringConnectors(layout, year, rc) {
    const arms = layout.arms, node = layout.centre;
    arms.forEach((A, i) => {
        if (!A.inbound) return;
        const offA = laneOffset(A.edge, year);
        const p0 = { x: A.mouth.x + A.mouth.nx * offA, y: A.mouth.y + A.mouth.ny * offA };
        const entry = A.ringAngle + Math.asin(Math.min(0.9, offA / rc));
        arms.forEach((B, j) => {
            if (i === j || !B.outbound) return;
            const offB = laneOffset(B.edge, year);
            const p1 = { x: B.mouth.x - B.mouth.nx * offB, y: B.mouth.y - B.mouth.ny * offB };
            const exit = B.ringAngle - Math.asin(Math.min(0.9, offB / rc));
            let sweep = exit - entry;
            while (sweep <= 0) sweep += TWO_PI;
            while (sweep > TWO_PI) sweep -= TWO_PI;
            const pts = [p0.x, p0.y];
            const steps = Math.max(2, Math.ceil(sweep / 0.14));
            for (let s = 0; s <= steps; s++) pts.push(node.x + Math.cos(entry + (sweep * s) / steps) * rc, node.y + Math.sin(entry + (sweep * s) / steps) * rc);
            pts.push(p1.x, p1.y);
            layout.connectors.push(connector(layout, i, j, 'ring', pts));
        });
    });
}

// ---- markings, connectors, reach -----------------------------------------------------------------------------------

/**
 * Stop and give-way lines across the approaching lane of each arm (a solid line at signals from 1935, a dashed give-way
 * line on the minor arms of a priority junction and on every roundabout arm from 1960; none on slip roads or on arms
 * that only leave the junction). `alongTrim(arm)` gives the distance outside the trim; `atRing(arm)` a point inside a
 * roundabout's flare.
 */
function markStops(layout, node, year, alongTrim, atRing) {
    const type = layout.type;
    const stop = type === 'signals' && year >= 1935;
    const yieldTo = (type === 'giveway' && node.priority || type === 'roundabout') && year >= 1960;
    if (!stop && !yieldTo) return;
    const top = Math.max(...layout.arms.map(a => a.rank));
    layout.arms.forEach((a, i) => {
        if (!a.inbound || a.edge.link) return;
        if (!stop && type === 'giveway' && a.rank >= top) return; // the major road has priority
        const lanes = ROAD_CLASS[a.cls]?.lanes ?? 1;
        const from = lanes > 1 ? a.hw - lanes * LANE_WIDTH + 0.1 : 0.15, to = a.hw - 0.3;
        let px, py, heading;
        if (alongTrim) {
            const d = alongTrim(a);
            if (a.edge.len < d + 4) return;
            const p = armPoint(a, d); // placed from the spline's tangent
            px = p.x; py = p.y; heading = p.angle;
        } else {
            const r = atRing(a);
            px = r.x; py = r.y; heading = r.heading;
        }
        const nx = -Math.sin(heading), ny = Math.cos(heading);
        layout.stopLines.push({ arm: i, kind: stop ? 'stop' : 'giveway', x: px + nx * (from + to) / 2, y: py + ny * (from + to) / 2, x0: px + nx * from, y0: py + ny * from, x1: px + nx * to, y1: py + ny * to, angle: heading + Math.PI });
        if (stop) layout.poles.push({ arm: i, x: px + nx * (a.hw + 0.9), y: py + ny * (a.hw + 0.9) });
    });
}

function connector(layout, from, to, kind, pts) {
    let len = 0;
    for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    return { from, to, kind, pts, len };
}

function finish(layout, node, year) {
    let reach = 0;
    for (const a of layout.arms) if (a.mouth) reach = Math.max(reach, Math.hypot(a.mouth.x - node.x, a.mouth.y - node.y), Math.hypot(a.mL.x - node.x, a.mL.y - node.y), Math.hypot(a.mR.x - node.x, a.mR.y - node.y));
    for (const p of layout.boundary) reach = Math.max(reach, Math.hypot(p.x - node.x, p.y - node.y));
    layout.reach = reach;
    if (layout.kind === 'through') {
        const [a, b] = layout.arms;
        if (a.inbound && b.outbound) layout.connectors.push(connector(layout, 0, 1, 'straight', throughPts(a, b, year)));
        if (b.inbound && a.outbound) layout.connectors.push(connector(layout, 1, 0, 'straight', throughPts(b, a, year)));
    }
}

function throughPts(A, B, year) {
    const oa = laneOffset(A.edge, year), ob = laneOffset(B.edge, year);
    return [A.mouth.x + A.mouth.nx * oa, A.mouth.y + A.mouth.ny * oa, B.mouth.x - B.mouth.nx * ob, B.mouth.y - B.mouth.ny * ob];
}

/** Area-free polygon helpers shared by tests and the validator. */
export function polygonsOverlap(P, Q) {
    const inside = (pt, poly) => {
        let c = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[i], b = poly[j];
            if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
        }
        return c;
    };
    const cross = (a, b, c, d) => {
        const r1x = b.x - a.x, r1y = b.y - a.y, r2x = d.x - c.x, r2y = d.y - c.y, den = r1x * r2y - r1y * r2x;
        if (Math.abs(den) < 1e-12) return false;
        const t = ((c.x - a.x) * r2y - (c.y - a.y) * r2x) / den, u = ((c.x - a.x) * r1y - (c.y - a.y) * r1x) / den;
        return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
    };
    for (let i = 0; i < P.length; i++) for (let j = 0; j < Q.length; j++) if (cross(P[i], P[(i + 1) % P.length], Q[j], Q[(j + 1) % Q.length])) return true;
    return inside(P[0], Q) || inside(Q[0], P);
}

/** True if a polygon crosses itself. */
export function selfIntersects(P) {
    const n = P.length;
    for (let i = 0; i < n; i++) {
        for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue;
            const a = P[i], b = P[(i + 1) % n], c = P[j], d = P[(j + 1) % n];
            const r1x = b.x - a.x, r1y = b.y - a.y, r2x = d.x - c.x, r2y = d.y - c.y, den = r1x * r2y - r1y * r2x;
            if (Math.abs(den) < 1e-12) continue;
            const t = ((c.x - a.x) * r2y - (c.y - a.y) * r2x) / den, u = ((c.x - a.x) * r1y - (c.y - a.y) * r1x) / den;
            if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) return true;
        }
    }
    return false;
}
