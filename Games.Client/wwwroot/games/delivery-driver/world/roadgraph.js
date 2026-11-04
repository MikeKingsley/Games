// The road network: nodes at junctions and ends, edges carrying a centreline polyline. Traffic drives on the LEFT
// of each edge's centreline; lanes are offsets from it. Built once per region from the seed roads plus the
// generated town streets, farm lanes and site access roads (all deterministic from the region seed).
import { polyLength, pointAt, closestOnPoly, splitPoly, smooth, bbox } from './geom.js';
import { crossesWater, waterAt, moorAt, nearestTown } from './region.js';
import { seededRng, hashSeed, range, chance } from '../engine/rng.js';
import { MPH } from '../config.js';

/** Road classes: carriageway width (m), lanes per direction, and a priority rank at junctions. */
export const ROAD_CLASS = {
    M: { width: 24, lanes: 2, rank: 6, label: 'Motorway' },
    dual: { width: 17, lanes: 2, rank: 5, label: 'Dual carriageway' },
    A: { width: 8, lanes: 1, rank: 4, label: 'A-road' },
    B: { width: 7, lanes: 1, rank: 3, label: 'B-road' },
    street: { width: 7, lanes: 1, rank: 2, label: 'Street' },
    access: { width: 6, lanes: 1, rank: 1, label: 'Yard access' },
    lane: { width: 4.2, lanes: 1, rank: 1, label: 'Lane' },
    ferry: { width: 7, lanes: 1, rank: 4, label: 'Ferry' },
};
export const LANE_WIDTH = 3.4;

/** Typical cruising speed (m/s) on a class of road in a year, before any vehicle limit. */
export function cruiseSpeed(cls, year) {
    const era = year < 1930 ? 0 : year < 1950 ? 1 : year < 1970 ? 2 : 3;
    const mph = {
        M: [0, 0, 60, 65], dual: [30, 40, 55, 65], A: [22, 32, 45, 52], B: [18, 26, 36, 42],
        street: [12, 20, 26, 28], access: [8, 8, 8, 8], lane: [10, 14, 18, 20], ferry: [6, 6, 6, 6],
    }[cls]?.[era] ?? 15;
    return Math.max(4, mph) * MPH;
}

/** An edge's class in a year (upgrades such as dualling apply from their year). */
export function edgeClass(edge, year) {
    let cls = edge.cls;
    for (const u of edge.upgrades ?? []) if (year >= u.year) cls = u.class;
    return cls;
}

export const edgeOpen = (edge, year) => year >= (edge.opened ?? 0) && year < (edge.closed ?? Infinity);
export const edgeWidth = (edge, year) => ROAD_CLASS[edgeClass(edge, year)]?.width ?? 7;

export function createGraph() {
    const g = {
        nodes: [],
        edges: [],
        addNode(x, y, props = {}) {
            const node = { id: g.nodes.length, x, y, edges: [], ...props };
            g.nodes.push(node);
            return node;
        },
        addEdge(a, b, pts, props = {}) {
            const edge = { id: g.edges.length, a: a.id, b: b.id, pts, len: polyLength(pts), cls: 'street', upgrades: [], opened: 0, closed: Infinity, ...props };
            g.edges.push(edge);
            a.edges.push(edge.id);
            b.edges.push(edge.id);
            return edge;
        },
        other(edge, nodeId) { return edge.a === nodeId ? edge.b : edge.a; },
        /** Splits an edge at a distance along it: the old edge keeps the first half, a new edge takes the rest. */
        splitEdge(edge, along) {
            if (along <= 0.5) return g.nodes[edge.a];
            if (along >= edge.len - 0.5) return g.nodes[edge.b];
            const [p1, p2] = splitPoly(edge.pts, along);
            const mid = g.addNode(p1[p1.length - 2], p1[p1.length - 1], { town: edge.town });
            const bNode = g.nodes[edge.b];
            bNode.edges = bNode.edges.filter(id => id !== edge.id);
            const rest = g.addEdge(mid, bNode, p2, { ...pick(edge) });
            edge.b = mid.id; edge.pts = p1; edge.len = polyLength(p1);
            mid.edges.push(edge.id);
            if (g.index) { g.index.add(edge); g.index.add(rest); }
            return mid;
        },
        index: null,
    };
    return g;
}

function pick(edge) {
    const { cls, name, road, opened, closed, upgrades, ferry, bridge, town } = edge;
    return { cls, name, road, opened, closed, upgrades, ferry, bridge, town };
}

/** Spatial index of edge segments on a coarse grid, for nearest-road and clearance queries. */
export function createSegmentIndex(graph, cell = 48) {
    const cells = new Map();
    const edgeCells = new Map(); // edge id -> the cell keys holding its segments
    const key = (i, j) => i * 100003 + j;
    const index = {
        cell,
        add(edge) {
            // remove stale entries for a split edge, then re-add every segment
            for (const k of edgeCells.get(edge.id) ?? []) {
                const list = cells.get(k);
                for (let n = list.length - 1; n >= 0; n--) if (list[n].edge === edge.id) list.splice(n, 1);
            }
            const mine = new Set();
            edgeCells.set(edge.id, mine);
            const pts = edge.pts;
            for (let s = 0; s < pts.length / 2 - 1; s++) {
                const ax = pts[2 * s], ay = pts[2 * s + 1], bx = pts[2 * s + 2], by = pts[2 * s + 3];
                const i0 = Math.floor(Math.min(ax, bx) / cell), i1 = Math.floor(Math.max(ax, bx) / cell);
                const j0 = Math.floor(Math.min(ay, by) / cell), j1 = Math.floor(Math.max(ay, by) / cell);
                for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
                    const k = key(i, j);
                    let list = cells.get(k);
                    if (!list) cells.set(k, (list = []));
                    list.push({ edge: edge.id, seg: s });
                    mine.add(k);
                }
            }
        },
        /** Segments whose cells are within r of (x, y). */
        near(x, y, r, out = []) {
            out.length = 0;
            const i0 = Math.floor((x - r) / cell), i1 = Math.floor((x + r) / cell);
            const j0 = Math.floor((y - r) / cell), j1 = Math.floor((y + r) / cell);
            for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
                const list = cells.get(key(i, j));
                if (list) for (const s of list) out.push(s);
            }
            return out;
        },
        /** Edge ids touching a rectangle. */
        edgesIn(minX, minY, maxX, maxY) {
            const ids = new Set();
            for (let i = Math.floor(minX / cell); i <= Math.floor(maxX / cell); i++) {
                for (let j = Math.floor(minY / cell); j <= Math.floor(maxY / cell); j++) {
                    const list = cells.get(key(i, j));
                    if (list) for (const s of list) ids.add(s.edge);
                }
            }
            return ids;
        },
    };
    for (const e of graph.edges) index.add(e);
    return index;
}

/** Nearest point on any (open) edge within maxD: {edge, d, x, y, along, angle} or null. */
export function nearestEdge(graph, x, y, maxD = 200, year = 2100, filter = null) {
    let best = null;
    const seen = new Set();
    for (let r = 50; r <= maxD + 50; r *= 2) {
        for (const s of graph.index.near(x, y, Math.min(r, maxD))) {
            if (seen.has(s.edge)) continue;
            seen.add(s.edge);
            const e = graph.edges[s.edge];
            if (!edgeOpen(e, year) || (filter ? !filter(e) : e.cls === 'ferry')) continue; // ferries only when a filter asks
            const c = closestOnPoly(e.pts, x, y);
            if (c.d <= maxD && (!best || c.d < best.d)) best = { edge: e, ...c };
        }
        if (best) return best;
    }
    return best;
}

/** True if a box (obb) is clear of every road's carriageway plus a margin (pavement). */
export function clearOfRoads(graph, box, margin = 1.5, ignoreEdge = -1) {
    const r = Math.hypot(box.hx, box.hy) + 30;
    const c = Math.cos(box.angle), s = Math.sin(box.angle);
    for (const seg of graph.index.near(box.x, box.y, r)) {
        if (seg.edge === ignoreEdge) continue;
        const e = graph.edges[seg.edge];
        const half = (ROAD_CLASS[e.cls]?.width ?? 7) / 2 + margin + (e.upgrades?.length ? 5 : 0); // leave room for dualling
        const ax = e.pts[2 * seg.seg], ay = e.pts[2 * seg.seg + 1], bx = e.pts[2 * seg.seg + 2], by = e.pts[2 * seg.seg + 3];
        // distance between the segment and the box, via the box's local frame
        if (segBoxDistance(ax, ay, bx, by, box, c, s) < half) return false;
    }
    return true;
}

/** Minimum distance from a segment to an OBB (0 if they intersect). */
export function segBoxDistance(ax, ay, bx, by, box, c = Math.cos(box.angle), s = Math.sin(box.angle)) {
    const toLocal = (x, y) => [(x - box.x) * c + (y - box.y) * s, -(x - box.x) * s + (y - box.y) * c];
    const [lax, lay] = toLocal(ax, ay), [lbx, lby] = toLocal(bx, by);
    // sample the segment densely enough for road clearance (segments are <= ~25 m)
    const n = Math.max(2, Math.ceil(Math.hypot(lbx - lax, lby - lay) / 1.5));
    let best = Infinity;
    for (let i = 0; i <= n; i++) {
        const x = lax + ((lbx - lax) * i) / n, y = lay + ((lby - lay) * i) / n;
        const dx = Math.max(0, Math.abs(x) - box.hx), dy = Math.max(0, Math.abs(y) - box.hy);
        const d = Math.hypot(dx, dy);
        if (d < best) best = d;
        if (best === 0) return 0;
    }
    return best;
}

// ---- Building the region network -------------------------------------------------------------------------------

/**
 * Builds the whole network for a region: seed roads (split at shared points, trimmed at town edges and joined to
 * the town streets), town streets (from the generator), farm lanes and industry site access roads.
 * `streetsFor(town)` returns {nodes: [{x, y}], edges: [[i, j, bridge]]} for a town.
 */
export function buildRoadGraph(region, streetsFor) {
    const g = createGraph();
    const rng = seededRng(hashSeed(region.seed, 'roads'));

    // 1. town streets
    const townNodes = new Map();
    for (const town of region.towns) {
        const plan = streetsFor(town);
        const nodes = plan.nodes.map(p => g.addNode(p.x, p.y, { town: town.id, kind: 'street' }));
        for (const [i, j, bridge] of plan.edges) g.addEdge(nodes[i], nodes[j], [nodes[i].x, nodes[i].y, nodes[j].x, nodes[j].y], { cls: 'street', town: town.id, bridge: !!bridge });
        townNodes.set(town.id, nodes);
        town.centreNode = plan.centre >= 0 ? nodes[plan.centre].id : null;
    }

    // 2. seed roads: split at towns and shared waypoints, smooth, trim at town edges, then join to the streets
    const keyUse = new Map();
    for (const r of region.roads) r.pts.forEach((p, i) => {
        if (!p.key) return;
        keyUse.set(p.key, (keyUse.get(p.key) ?? 0) + (i === 0 || i === r.pts.length - 1 ? 2 : 1));
    });
    const junctions = new Map();
    const junctionAt = p => {
        let n = junctions.get(p.key);
        if (!n) junctions.set(p.key, (n = g.addNode(p.x, p.y, { kind: 'junction' })));
        return n;
    };
    for (const road of region.roads) {
        const pieces = [];
        let cur = [road.pts[0]];
        for (let i = 1; i < road.pts.length; i++) {
            const p = road.pts[i];
            cur.push(p);
            const isBreak = i < road.pts.length - 1 && (p.town || (p.key && keyUse.get(p.key) >= 2));
            if (isBreak) { pieces.push(cur); cur = [p]; }
        }
        pieces.push(cur);
        for (const piece of pieces) addSeedPiece(g, region, road, piece, townNodes, junctionAt);
    }

    g.index = createSegmentIndex(g);

    // 3. farms along the main roads (outside towns), each with a lane to its yard
    const farms = [];
    const mainEdges = g.edges.filter(e => e.cls === 'A' || e.cls === 'B');
    for (const edge of mainEdges) {
        for (let d = range(rng, 60, 200); d < edge.len - 60; d += range(rng, 220, 380)) {
            if (!chance(rng, 0.6)) continue;
            const side = chance(rng, 0.5) ? 1 : -1;
            const p = pointAt(edge.pts, d);
            const off = range(rng, 55, 95);
            const nx = -Math.sin(p.angle) * side, ny = Math.cos(p.angle) * side;
            const fx = p.x + nx * off, fy = p.y + ny * off;
            if (!farmSiteOk(region, g, farms, fx, fy, p, edge)) continue;
            farms.push({ x: fx, y: fy, off, roadX: p.x, roadY: p.y, edgeId: edge.id, along: d, ux: nx, uy: ny, moor: !!moorAt(region, fx, fy), seed: hashSeed(region.seed, 'farm', farms.length) });
        }
    }
    // connect farms (split edges from the far end backwards so earlier distances stay valid)
    const byEdge = new Map();
    for (const f of farms) (byEdge.get(f.edgeId) ?? byEdge.set(f.edgeId, []).get(f.edgeId)).push(f);
    for (const [, list] of byEdge) {
        list.sort((a, b) => b.along - a.along);
        for (const f of list) {
            const node = g.splitEdge(g.edges[f.edgeId], f.along);
            const yard = g.addNode(node.x + f.ux * (f.off - 18), node.y + f.uy * (f.off - 18), { kind: 'farm' }); // the yard's entrance
            const lane = g.addEdge(node, yard, [node.x, node.y, yard.x, yard.y], { cls: 'lane', name: 'Farm lane' });
            g.index.add(lane);
            f.node = yard.id; f.entryNode = node.id; f.lane = lane.id;
        }
    }

    // 4. industry sites with their own position: an access road from the nearest main road
    const sites = [];
    for (const s of region.sites) {
        if (s.x === undefined) continue; // in-town sites are placed by the building generator
        const near = nearestEdge(g, s.x, s.y, 600, 2100, e => e.cls === 'A' || e.cls === 'B' || e.cls === 'street');
        if (!near) continue;
        const dx = s.x - near.x, dy = s.y - near.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const entry = g.splitEdge(near.edge, near.along);
        const yardLen = Math.max(30, len);
        const yard = g.addNode(entry.x + ux * yardLen, entry.y + uy * yardLen, { kind: 'site' });
        const access = g.addEdge(entry, yard, [entry.x, entry.y, yard.x, yard.y], { cls: 'access', name: s.name });
        g.index.add(access);
        sites.push({ ...s, node: yard.id, entryNode: entry.id, access: access.id, x: yard.x, y: yard.y, ux, uy });
    }

    classifyJunctions(g, region);
    return { graph: g, farms, sites };
}

function addSeedPiece(g, region, road, piece, townNodes, junctionAt) {
    const props = { cls: road.cls, name: road.name, road: road.id, opened: road.opened, closed: road.closed, upgrades: road.upgrades, ferry: road.ferry, bridge: road.bridge };
    if (road.cls === 'ferry') return addFerryPiece(g, region, props, piece, townNodes, junctionAt);
    let pts = smooth(piece.flatMap(p => [p.x, p.y]), 22);
    let startNode = null, endNode = null;
    const first = piece[0], last = piece[piece.length - 1];
    // trim the ends that sit in a town at the town's edge, and join them to the nearest street node
    // a piece lying wholly inside a town (e.g. the last few metres into a village): its outer end joins the streets
    for (const [end, other, fromEnd] of [[first, last, false], [last, first, true]]) {
        if (!end.town || other.town) continue;
        const t = region.townById.get(end.town);
        if (!trimInside(pts, t, fromEnd)) {
            const outer = junctionAt(other);
            const street = nearestStreetNode(region, t, townNodes, outer.x, outer.y);
            if (street) g.addEdge(outer, street, [outer.x, outer.y, street.x, street.y], { ...props, cls: props.cls === 'ferry' ? 'A' : props.cls, town: t.id, ferry: null });
            return;
        }
    }
    if (first.town) {
        const t = region.townById.get(first.town);
        const cut = trimInside(pts, t, false);
        if (!cut) return; // both ends in towns and the piece is inside one: the streets cover it
        pts = cut;
        startNode = joinTown(g, region, t, townNodes, pts[0], pts[1], props);
    }
    if (last.town) {
        const t = region.townById.get(last.town);
        const cut = trimInside(pts, t, true);
        if (!cut) return;
        pts = cut;
        endNode = joinTown(g, region, t, townNodes, pts[pts.length - 2], pts[pts.length - 1], props);
    }
    startNode ??= junctionAt(first);
    endNode ??= junctionAt(last);
    if (startNode === endNode) return;
    pts[0] = startNode.x; pts[1] = startNode.y;
    pts[pts.length - 2] = endNode.x; pts[pts.length - 1] = endNode.y;
    g.addEdge(startNode, endNode, pts, props);
}

/**
 * Ferries are not trimmed at towns (they usually cross right by the town centre): the crossing runs between the
 * piece's waypoints (the slipways), and a town at either end joins its nearest street to the slipway.
 */
function addFerryPiece(g, region, props, piece, townNodes, junctionAt) {
    const way = piece.filter(p => !p.town);
    if (!way.length) return;
    const start = junctionAt(way[0]);
    const end = junctionAt(way[way.length - 1]);
    if (start !== end) g.addEdge(start, end, way.flatMap(p => [p.x, p.y]), props);
    const link = { ...props, cls: 'A', ferry: null, upgrades: [] };
    for (const [ref, node] of [[piece[0], start], [piece[piece.length - 1], end]]) {
        if (!ref.town) continue;
        const t = region.townById.get(ref.town);
        const street = nearestStreetNode(region, t, townNodes, node.x, node.y);
        if (street) g.addEdge(node, street, [node.x, node.y, street.x, street.y], { ...link, town: t.id });
    }
}

/** Cuts a polyline where it leaves a town's circle (at 80% radius). fromEnd trims the end instead of the start. */
function trimInside(pts, town, fromEnd) {
    const r = town.radius * 0.8;
    const n = pts.length / 2;
    const idx = i => (fromEnd ? n - 1 - i : i);
    const inside = i => Math.hypot(pts[2 * idx(i)] - town.x, pts[2 * idx(i) + 1] - town.y) < r;
    let k = 0;
    while (k < n && inside(k)) k++;
    if (k >= n - 1) return null;
    if (k === 0) return pts;
    // interpolate the crossing between k-1 (inside) and k (outside)
    const ax = pts[2 * idx(k - 1)], ay = pts[2 * idx(k - 1) + 1], bx = pts[2 * idx(k)], by = pts[2 * idx(k) + 1];
    let lo = 0, hi = 1;
    for (let it = 0; it < 20; it++) {
        const m = (lo + hi) / 2;
        if (Math.hypot(ax + (bx - ax) * m - town.x, ay + (by - ay) * m - town.y) < r) lo = m; else hi = m;
    }
    const cx = ax + (bx - ax) * hi, cy = ay + (by - ay) * hi;
    const kept = [];
    for (let i = k; i < n; i++) kept.push(pts[2 * idx(i)], pts[2 * idx(i) + 1]);
    const out = [cx, cy, ...kept];
    return fromEnd ? reverseFlat(out) : out;
}

function reverseFlat(pts) {
    const out = [];
    for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
    return out;
}

/** A node where a main road meets a town: a connector to the nearest street node that isn't across wide water. */
/** The town's nearest street node not across wide water (or simply the nearest, as a bridge, if none is). */
function nearestStreetNode(region, town, townNodes, x, y) {
    const nodes = townNodes.get(town.id) ?? [];
    let best = null, bestD = Infinity, any = null, anyD = Infinity;
    for (const n of nodes) {
        const d = Math.hypot(n.x - x, n.y - y);
        if (d < anyD) { any = n; anyD = d; }
        if (d < bestD && !crossesWater(region, x, y, n.x, n.y, 30)) { best = n; bestD = d; }
    }
    return best ?? any;
}

function joinTown(g, region, town, townNodes, x, y, props) {
    const best = nearestStreetNode(region, town, townNodes, x, y);
    const gate = g.addNode(x, y, { kind: 'junction', town: town.id });
    if (best) g.addEdge(gate, best, [x, y, best.x, best.y], { ...props, cls: props.cls === 'M' || props.cls === 'ferry' ? 'A' : props.cls, town: town.id, opened: props.opened, closed: props.closed, ferry: null });
    return gate;
}

function farmSiteOk(region, g, farms, fx, fy, roadPoint, edge) {
    if (waterAt(region, fx, fy) || waterAt(region, roadPoint.x, roadPoint.y)) return false;
    if (crossesWater(region, roadPoint.x, roadPoint.y, fx, fy, 1)) return false;
    const { town, ratio } = nearestTown(region, fx, fy);
    if (town && Math.hypot(town.x - fx, town.y - fy) < town.radius + 80 && ratio < 2) return false;
    if (moorAt(region, fx, fy) && (Math.floor(fx * 7 + fy * 3) & 3) !== 0) return false; // few farms up on the moor
    for (const f of farms) if (Math.hypot(f.x - fx, f.y - fy) < 150) return false;
    // the farm (yard + buildings ~ 60 m across) must keep clear of every other road
    for (const s of g.index.near(fx, fy, 70)) {
        if (s.edge === edge.id) continue;
        const e = g.edges[s.edge];
        const ax = e.pts[2 * s.seg], ay = e.pts[2 * s.seg + 1], bx = e.pts[2 * s.seg + 2], by = e.pts[2 * s.seg + 3];
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((fx - ax) * dx + (fy - ay) * dy) / len2));
        if (Math.hypot(fx - ax - dx * t, fy - ay - dy * t) < 55) return false;
    }
    // and its lane must not run along/over the main road (check the road itself stays > 30 m from the yard)
    const own = closestOnPoly(edge.pts, fx, fy);
    return own.d > 45;
}

/** Junction types: give way to the higher-ranked road; signals in city centres (1930s+); roundabouts on A-road junctions (1960s+). */
function classifyJunctions(g, region) {
    for (const n of g.nodes) {
        const deg = n.edges.length;
        n.junction = deg <= 1 ? 'end' : deg === 2 ? 'through' : 'giveway';
        if (deg >= 3) {
            const ranks = n.edges.map(id => ROAD_CLASS[g.edges[id].cls]?.rank ?? 1);
            n.majorRank = Math.max(...ranks);
            const town = n.town ? region.townById.get(n.town) : null;
            if (town && town.size === 'city' && deg >= 4 && Math.hypot(n.x - town.x, n.y - town.y) < town.radius * 0.45) {
                n.junction = 'signals';
                n.signalsFrom = 1932;
            } else if (!n.town && deg >= 3 && ranks.filter(r => r >= 4).length >= 3) {
                n.junction = 'roundabout';
                n.roundaboutFrom = 1960;
            }
        }
    }
}

/** Signals and roundabouts only exist from their year; before that a junction is a plain give-way. */
export function junctionType(node, year) {
    if (node.junction === 'signals' && year < node.signalsFrom) return 'giveway';
    if (node.junction === 'roundabout' && year < node.roundaboutFrom) return 'giveway';
    return node.junction;
}

export { bbox };

/**
 * Lane centre offset (m) from the centreline, to the LEFT of the direction of travel (we drive on the left).
 * Lane 0 is the nearside lane; dual carriageways and motorways have a central reservation.
 */
export function laneOffset(edge, year, lane = 0) {
    const cls = edgeClass(edge, year);
    const lanes = ROAD_CLASS[cls]?.lanes ?? 1;
    const width = ROAD_CLASS[cls]?.width ?? 7;
    if (cls === 'lane') return 0.6; // single track: keep left, squeeze past oncoming traffic
    if (lanes === 1) return width / 4;
    // nearside lane (0) is the outermost one; a central reservation fills the middle
    const median = width / 2 - lanes * LANE_WIDTH;
    return median + (lanes - 1 - Math.min(lane, lanes - 1) + 0.5) * LANE_WIDTH;
}

/** A point on an edge's lane: travelling from a to b (forward) or b to a, `along` measured in that direction. */
export function lanePoint(edge, along, forward, offset, out = { x: 0, y: 0, angle: 0 }) {
    const d = forward ? along : edge.len - along;
    const p = pointAt(edge.pts, d, out);
    const heading = forward ? p.angle : p.angle + Math.PI;
    out.x = p.x + Math.sin(heading) * offset;
    out.y = p.y - Math.cos(heading) * offset;
    out.angle = heading;
    return out;
}
