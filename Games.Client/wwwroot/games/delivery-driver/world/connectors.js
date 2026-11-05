// Junction connectors for vehicles: the lane paths through a junction that world/junction-layout.js computes
// (a kerb-return curve through a plain junction, a clockwise arc round a roundabout, a U-turn at a dead end),
// prepared for following (length along, position and heading at a distance, a comfortable cornering speed) and
// compared for conflicts (two paths that cross or merge). Used by traffic/traffic.js and world/pathfind.js.
// Pure logic. The layout is cached per graph under its junction signature, so the lookups here are cheap.
import { layoutJunction } from './junction-layout.js';

const LAT_ACC = 3;            // m/s^2 of sideways acceleration a driver is happy with in a turn
const MIN_TURN_SPEED = 2.5;   // m/s: even the tightest corner or U-turn is taken at a walking-plus pace
const CONFLICT_DIST = 2.4;    // metres between lane paths below which two vehicles on them would touch

/** Layout kinds that have connectors worth following (a 'through' pair or a 'none' node is just the edges meeting). */
export const hasConnectors = layout => layout.kind === 'plain' || layout.kind === 'mini' || layout.kind === 'roundabout' || layout.kind === 'end';

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Adds to a layout connector, once: `cum` (distance along at each vertex), `turn` (total heading change, rad),
 * `vturn` (m/s the corner can be taken at; Infinity when straight), `nodeId`, and the trims of the arms it joins
 * (`inTrim` along the entering edge from the node, `outTrim` along the leaving edge). Returns the connector.
 */
function prepare(c, layout) {
    if (c.cum) return c;
    const n = c.pts.length / 2;
    c.cum = new Float64Array(n);
    let turn = 0, prev = null;
    for (let i = 1; i < n; i++) {
        const dx = c.pts[2 * i] - c.pts[2 * i - 2], dy = c.pts[2 * i + 1] - c.pts[2 * i - 1];
        c.cum[i] = c.cum[i - 1] + Math.hypot(dx, dy);
        if (Math.hypot(dx, dy) < 1e-6) continue;
        const h = Math.atan2(dy, dx);
        if (prev !== null) turn += Math.abs(wrap(h - prev));
        prev = h;
    }
    c.len = c.cum[n - 1];
    c.turn = turn;
    const radius = turn > 0.05 ? c.len / turn : Infinity;
    c.vturn = c.kind === 'uturn' ? MIN_TURN_SPEED : Number.isFinite(radius) ? Math.max(MIN_TURN_SPEED, Math.sqrt(LAT_ACC * radius)) : Infinity;
    c.nodeId = layout.node;
    c.inTrim = layout.arms[c.from].trim;
    c.outTrim = layout.arms[c.to].trim;
    c.layout = layout;
    return c;
}

const byYear = new WeakMap(); // graph -> Map(year -> Map(node id -> { edges (count when cached), layout | null }))

/**
 * The layout of a node in a year when it has connectors to follow, else null (the vehicle just drives the edges to
 * the node). Remembered per graph, year and node (the layout cache itself is keyed by a signature that costs more
 * than a route search can spare); a node that gains an edge is looked up again.
 */
export function connectorLayout(graph, nodeId, year) {
    const node = graph.nodes[nodeId];
    if (!node || node.edges.length < 1) return null;
    let years = byYear.get(graph);
    if (!years) byYear.set(graph, (years = new Map()));
    let nodes = years.get(year);
    if (!nodes) years.set(year, (nodes = new Map()));
    const hit = nodes.get(nodeId);
    if (hit && hit.edges === node.edges.length) return hit.layout;
    const layout = layoutJunction(graph, node, year);
    const usable = hasConnectors(layout) && layout.connectors.length ? layout : null;
    nodes.set(nodeId, { edges: node.edges.length, layout: usable });
    return usable;
}

/**
 * The connector that takes a vehicle from the end `inEnd` ('a' | 'b') of `inEdge` to the end `outEnd` of `outEdge`
 * through the junction layout, or null when there is none (the turn is illegal, or the node has no layout).
 * The same edge and end both ways is the U-turn at a dead end.
 */
export function connectorBetween(layout, inEdge, inEnd, outEdge, outEnd) {
    if (!layout) return null;
    const arms = layout.arms;
    let i = -1, j = -1;
    for (let k = 0; k < arms.length; k++) {
        if (i < 0 && arms[k].edge === inEdge && arms[k].end === inEnd) i = k;
        if (j < 0 && arms[k].edge === outEdge && arms[k].end === outEnd) j = k;
    }
    if (i < 0 || j < 0) return null;
    const c = layout.connectors.find(q => q.from === i && q.to === j);
    return c ? prepare(c, layout) : null;
}

/** Point and heading a distance `s` along a prepared connector (clamped to its ends), into `out`. */
export function connectorPoint(c, s, out = { x: 0, y: 0, angle: 0 }) {
    const n = c.cum.length;
    if (s <= 0) s = 0;
    if (s > c.len) s = c.len;
    let i = 1;
    while (i < n - 1 && c.cum[i] < s) i++;
    const seg = c.cum[i] - c.cum[i - 1];
    const t = seg > 1e-9 ? (s - c.cum[i - 1]) / seg : 0;
    const x0 = c.pts[2 * i - 2], y0 = c.pts[2 * i - 1], x1 = c.pts[2 * i], y1 = c.pts[2 * i + 1];
    out.x = x0 + (x1 - x0) * t;
    out.y = y0 + (y1 - y0) * t;
    out.angle = Math.atan2(y1 - y0, x1 - x0);
    return out;
}

const conflictCache = new WeakMap(); // connector -> Map(connector -> boolean)

function distToSegments(c, x, y) {
    let best = Infinity;
    for (let i = 1; i < c.cum.length; i++) {
        const ax = c.pts[2 * i - 2], ay = c.pts[2 * i - 1], bx = c.pts[2 * i], by = c.pts[2 * i + 1];
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
        best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
    }
    return best;
}

/**
 * Do two lane paths through the same junction conflict (cross or merge: they come within a vehicle width of each
 * other)? Paths that start on the same arm never do (the one behind just follows the one in front).
 */
export function connectorsConflict(p, q) {
    if (p === q) return true;
    if (p.nodeId !== q.nodeId) return false;
    if (p.from === q.from) return false;
    let m = conflictCache.get(p);
    if (!m) conflictCache.set(p, (m = new Map()));
    let hit = m.get(q);
    if (hit === undefined) {
        hit = false;
        // sample both paths densely enough that a miss is smaller than the threshold
        for (let s = 0; s <= p.len && !hit; s += 1) {
            const a = connectorPoint(p, s);
            if (distToSegments(q, a.x, a.y) < CONFLICT_DIST) hit = true;
        }
        m.set(q, hit);
        let r = conflictCache.get(q);
        if (!r) conflictCache.set(q, (r = new Map()));
        r.set(p, hit);
    }
    return hit;
}

/**
 * Extra seconds a turn costs a vehicle that would otherwise cruise at `cruise` m/s: the time to take the connector at
 * its cornering speed compared with going through at cruise (zero for a straight path).
 */
export function turnSeconds(c, cruise) {
    const v = Math.min(c.vturn, cruise);
    return v >= cruise ? 0 : c.len / v - c.len / cruise;
}

/** Is a point on the junction's surface (inside its boundary polygon)? Used for bodies with no lane path, such as the player. */
export function onJunction(layout, x, y) {
    const P = layout.boundary;
    let inside = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        if ((P[i].y > y) !== (P[j].y > y) && x < ((P[j].x - P[i].x) * (y - P[i].y)) / (P[j].y - P[i].y) + P[i].x) inside = !inside;
    }
    return inside;
}
