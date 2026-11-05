// Street furniture by explicit rules: lamps, signs and traffic-signal poles placed from the road graph. Pure and
// deterministic (a function of the graph and the position; no random numbers), so a chunk's furniture is the same
// whatever order chunks are generated in.
//
// Geometry is year independent (chunks cache geometry only): every prop carries `from` and `until`, the years it
// stands, and renderers skip a prop outside them (`isLive`). Props are placed beside the widest carriageway an edge
// ever has (so a road dualled later does not swallow them), outside the junction mouths, and are dropped where they
// would stand in water, a building, a yard, a tree or within reach of any other road.
//
// Left/right: traffic drives on the left; the left of a heading h is (sin h, -cos h) (world y points south).
import { ROAD_CLASS } from './roadgraph.js';
import { waterAt } from './region.js';
import { pointAt, closestOnPoly } from './geom.js';

const KERB = 0.5;          // kerb + gutter beyond the carriageway edge
const LAMP_SET = 0.6;      // a lamp stands this far beyond the kerb
const CLEAR = 0.8;         // any prop stays at least this far beyond every carriageway edge
const LIGHT_ERA = 1950;    // rural lit roads (A/B roads lit by OSM) were lit from here
const GIVEWAY_FROM = 1965; // give way signs (and Worboys direction signs) arrive with the 1964 Traffic Signs Regulations
const LAMP_GAP = { street: 30, B: 36, A: 40, dual: 44 };
const LAMP_CLASSES = new Set(['street', 'B', 'A', 'dual']);
const SIGN_CLASSES = new Set(['street', 'B', 'A', 'dual', 'lane']);

/** True while a prop stands in a year. */
export const isLive = (p, year) => year >= (p.from ?? 0) && year < (p.until ?? Infinity);

/** Half the widest carriageway an edge has in any year (roads are placed around once, for every era). */
export function maxHalfWidth(edge) {
    let w = ROAD_CLASS[edge.cls]?.width ?? 7;
    for (const u of edge.upgrades ?? []) w = Math.max(w, ROAD_CLASS[u.class]?.width ?? 7);
    return w / 2;
}

/** Distance from a junction node at which kerbs and stop lines sit: nothing but road lies closer. */
export function mouthRadius(graph, node) {
    let hw = 0;
    for (const id of node.edges) hw = Math.max(hw, maxHalfWidth(graph.edges[id]));
    if (node.edges.length >= 3 && node.junction === 'roundabout') return 7.2 + 2 * hw + 1 + 1;
    return hw + 3.5;
}

/** The arms of a node: [{edge, bearing (outward from the node), hw}], bearing from the edge's first segment. */
export function armsOf(graph, node) {
    return node.edges.map(id => {
        const e = graph.edges[id];
        const atA = e.a === node.id;
        const p = pointAt(e.pts, atA ? Math.min(6, e.len / 2) : Math.max(e.len - 6, e.len / 2));
        const bearing = Math.atan2(p.y - node.y, p.x - node.x);
        return { edge: e, bearing, hw: maxHalfWidth(e) };
    });
}

const leftOf = h => [Math.sin(h), -Math.cos(h)];

/** Does a point keep clear of every road (the widest carriageway of each edge, plus `CLEAR`), whatever its year? */
function clearOfAllRoads(graph, x, y, extra = 0) {
    const seen = new Set();
    for (const s of graph.index.near(x, y, 30)) {
        if (seen.has(s.edge)) continue;
        seen.add(s.edge);
        const e = graph.edges[s.edge];
        if (e.cls === 'ferry') continue;
        if (closestOnPoly(e.pts, x, y).d < maxHalfWidth(e) + CLEAR + extra) return false;
    }
    return true;
}

function standable(world, x, y, blockers, extra) {
    if (waterAt(world.region, x, y)) return false;
    if (!clearOfAllRoads(world.graph, x, y, extra)) return false;
    for (const b of blockers.boxes) if (inBox(b, x, y)) return false;
    for (const t of blockers.trees) if (Math.hypot(t.x - x, t.y - y) < t.r + 0.4) return false;
    return true;
}

function inBox(box, x, y) {
    const dx = x - box.x, dy = y - box.y, c = Math.cos(box.angle), s = Math.sin(box.angle);
    return Math.abs(dx * c + dy * s) <= box.hx + 0.3 && Math.abs(-dx * s + dy * c) <= box.hy + 0.3;
}

// ---- Lamps -----------------------------------------------------------------------------------------------------

/**
 * The lamps of an edge: staggered left/right every LAMP_GAP[class] m on lit roads (OSM `lit`, and every street, B and A
 * road in a town), none in the junction mouths, on bridges or tunnels, and none on slip roads, lanes or motorways.
 * Cached per edge on the world. Each lamp: {x, y, angle, edge, from, until}.
 */
function edgeLamps(world, e) {
    const cache = (world._lampCache ??= new Map());
    let list = cache.get(e.id);
    if (list) return list;
    list = [];
    cache.set(e.id, list);
    const cls = e.cls;
    if (!LAMP_CLASSES.has(cls) || e.link || e.bridge || e.tunnel) return list;
    const urban = !!e.town;
    if (!(e.lit || urban)) return list;
    const { graph } = world;
    // town streets were lit from the start (gas, then electric); rural lit roads only from the 1950s
    const from = Math.max(e.opened ?? 0, urban ? 0 : LIGHT_ERA);
    const until = e.closed ?? Infinity;
    const gap = LAMP_GAP[cls] ?? 36;
    const hw = maxHalfWidth(e);
    const off = hw + KERB + LAMP_SET;
    const a = mouthRadius(graph, graph.nodes[e.a]) + 2, b = e.len - mouthRadius(graph, graph.nodes[e.b]) - 2;
    for (let d = a + 3, k = 0; d <= b; d += gap, k++) {
        if (inSpan(e, d)) continue;
        const p = pointAt(e.pts, d);
        const side = (k + e.id) % 2 ? 1 : -1;
        const [nx, ny] = leftOf(p.angle);
        list.push({ x: p.x + nx * off * side, y: p.y + ny * off * side, angle: p.angle + (side > 0 ? Math.PI / 2 : -Math.PI / 2), edge: e.id, from, until });
    }
    return list;
}

/** True where distance d along an edge is on a bridge or tunnel span (with a margin). */
function inSpan(e, d) {
    return (e.spans ?? []).some(sp => d > sp.from - 4 && d < sp.to + 4);
}

/** A lamp on the kerb corner of a town junction, between the first pair of adjacent arms that leave room. */
function cornerLamp(world, node) {
    const { graph } = world;
    if (!node.town || node.edges.length < 3 || node.junction === 'roundabout') return null;
    const arms = armsOf(graph, node).filter(m => LAMP_CLASSES.has(m.edge.cls) && !m.edge.link).sort((p, q) => p.bearing - q.bearing);
    if (arms.length < 3) return null;
    const lit = arms.filter(m => m.edge.lit || m.edge.town);
    if (!lit.length) return null;
    let best = null;
    for (let i = 0; i < arms.length; i++) {
        const m = arms[i], n = arms[(i + 1) % arms.length];
        let gap = n.bearing - m.bearing;
        if (gap <= 0) gap += Math.PI * 2;
        if (gap < 0.9) continue; // under ~50 degrees there is no room for a lamp between the arms
        if (!best || gap > best.gap) best = { gap, mid: m.bearing + gap / 2, hw: Math.max(m.hw, n.hw) };
    }
    if (!best) return null;
    const r = (best.hw + KERB + LAMP_SET) / Math.sin(Math.min(best.gap / 2, Math.PI / 2)) + 1;
    const from = Math.min(...lit.map(m => m.edge.opened ?? 0));
    return { x: node.x + Math.cos(best.mid) * r, y: node.y + Math.sin(best.mid) * r, angle: best.mid + Math.PI, node: node.id, from, until: Infinity };
}

// ---- Signs and signals -----------------------------------------------------------------------------------------

/**
 * Signs at the nodes of a chunk. Every sign stands on the left verge of an approach (where a driver coming up that arm
 * sees it), beyond the kerb, `d` m from the node, with `angle` = the direction it faces (back toward oncoming traffic).
 *   post      the junction signpost on country junctions: a fingerpost before 1965, a direction sign after
 *   giveway   give way, on the minor arm of a priority junction (1965 on)
 *   roundabout  the roundabout ahead sign on every arm of a roundabout (once it exists)
 */
function nodeSigns(world, node, out) {
    const { graph } = world;
    if (node.edges.length < 3) return;
    const arms = armsOf(graph, node).filter(m => SIGN_CLASSES.has(m.edge.cls) && !m.edge.link && !m.edge.bridge && !m.edge.tunnel);
    if (arms.length < 3) return;
    const R = mouthRadius(graph, node);
    const rank = m => ROAD_CLASS[m.edge.cls]?.rank ?? 1;
    const top = Math.max(...arms.map(rank));
    const born = Math.min(...arms.map(m => m.edge.opened ?? 0));
    const place = (m, kind, dist, from) => {
        const h = m.bearing + Math.PI; // heading of traffic arriving along this arm
        const [nx, ny] = leftOf(h);
        const off = m.hw + KERB + 0.9;
        const d = R + dist;
        if (d > m.edge.len - 3) return;
        out.push({ kind, x: node.x + Math.cos(m.bearing) * d + nx * off, y: node.y + Math.sin(m.bearing) * d + ny * off, angle: m.bearing, node: node.id, edge: m.edge.id, from: Math.max(born, from), until: Infinity });
    };
    if (!node.town && top >= 3 && node.junction !== 'roundabout') {
        // one signpost per country junction, on the lowest-ranked arm's approach
        const minor = arms.reduce((p, q) => (rank(q) < rank(p) ? q : p));
        place(minor, 'post', 3, 0);
    }
    if (node.junction === 'roundabout') {
        const from = node.roundaboutFrom ?? 1960;
        for (const m of arms) place(m, 'roundabout', 6, from);
    } else if (node.junction === 'giveway' && node.priority) {
        for (const m of arms) if (rank(m) < top) place(m, 'giveway', 1.5, GIVEWAY_FROM);
    }
}

/**
 * Traffic signal poles at a signalled junction: one per arm, at the stop line on the left of the approach, beyond
 * the kerb. `group` is the signal group of traffic arriving on that arm (0 east-west, 1 north-south: traffic.js
 * signalGroup), `face` the direction the head looks (back along the arm toward oncoming traffic).
 */
export function signalPoles(graph, node) {
    const R = mouthRadius(graph, node);
    return armsOf(graph, node).filter(m => !m.edge.link).map((m, k) => {
        const h = m.bearing + Math.PI;
        const [nx, ny] = leftOf(h);
        const off = m.hw + KERB + 0.6;
        return { k, x: node.x + Math.cos(m.bearing) * (R + 0.5) + nx * off, y: node.y + Math.sin(m.bearing) * (R + 0.5) + ny * off, face: m.bearing, group: Math.abs(Math.cos(h)) > 0.707 ? 0 : 1, edge: m.edge.id };
    });
}

/** The signal poles of a node that fit (clear of water and of the other arms' roads); cached on the node. */
export function signalPolesOf(world, node) {
    return (node.signalPoles ??= signalPoles(world.graph, node).filter(p => standable(world, p.x, p.y, { boxes: [], trees: [] }, 0)));
}

// ---- A chunk's furniture ---------------------------------------------------------------------------------------

/**
 * Lamps, signs and signal poles standing inside the chunk's rectangle. `blockers` = {boxes: [obb], trees: [{x, y, r}]}
 * (buildings, yard zones and trees already placed there). Also returns `signals` with the poles of every signalled
 * junction owned by the chunk.
 */
export function chunkFurniture(world, x0, y0, S, blockers) {
    const { graph } = world;
    const inChunk = (x, y) => x >= x0 && x < x0 + S && y >= y0 && y < y0 + S;
    const lamps = [], signs = [], signals = [];
    const seenNodes = new Set();
    for (const id of graph.index.edgesIn(x0 - 12, y0 - 12, x0 + S + 12, y0 + S + 12)) {
        const e = graph.edges[id];
        for (const l of edgeLamps(world, e)) if (inChunk(l.x, l.y) && standable(world, l.x, l.y, blockers, 0)) lamps.push(l);
        for (const nid of [e.a, e.b]) {
            if (seenNodes.has(nid)) continue;
            seenNodes.add(nid);
            const n = graph.nodes[nid];
            if (inChunk(n.x, n.y)) {
                const c = cornerLamp(world, n);
                if (c && standable(world, c.x, c.y, blockers, 0)) lamps.push(c);
            }
            // signs are owned by the chunk they stand in, so look at nodes near this chunk
            const found = [];
            nodeSigns(world, n, found);
            for (const s of found) if (inChunk(s.x, s.y) && standable(world, s.x, s.y, blockers, 0)) signs.push(s);
            if (n.junction === 'signals' && inChunk(n.x, n.y)) {
                signals.push(...signalPolesOf(world, n).map(p => ({ ...p, node: n.id })));
            }
        }
    }
    const order = (a, b) => a.x - b.x || a.y - b.y;
    return { lamps: lamps.sort(order), signs: signs.sort(order), signals };
}
