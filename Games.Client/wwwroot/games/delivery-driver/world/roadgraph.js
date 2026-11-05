// The road network: nodes at junctions and ends, edges carrying a centreline polyline. Traffic drives on the LEFT
// of each edge's centreline; lanes are offsets from it. Built once per region from the baked OpenStreetMap network
// (world/baked-loader.js) plus the farm lanes and site access roads (deterministic from the region seed).
import { polyLength, pointAt, closestOnPoly, splitPoly, bbox } from './geom.js';
import { crossesWater, waterAt, moorAt, nearestTown } from './region.js';
import { seededRng, hashSeed, range, chance } from '../engine/rng.js';
import { obb } from '../sim/collision.js';
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

/**
 * Cruising speed (m/s) on an edge in a year: the class's typical speed, held down by the edge's baked `maxspeed` (mph)
 * where a limit applies: 30 mph and under from 1935 (the first built-up limit), higher limits from 1965.
 */
export function edgeSpeed(edge, year) {
    const base = cruiseSpeed(edgeClass(edge, year), year);
    const limit = edge.maxspeed > 0 && year >= (edge.maxspeed <= 30 ? 1935 : 1965) ? edge.maxspeed * MPH : Infinity;
    return Math.max(4 * MPH, Math.min(base, limit));
}

/**
 * The nodes of the main strongly connected component of the roads that exist for the whole game, honouring one-way
 * streets (a Uint8Array flag per node, cached on the graph; call `g._core = null` after changing the graph). Vehicles
 * that start or end in a one-way pocket outside it could never leave (or be reached).
 */
export function coreNodes(g) {
    if (g._core && g._core.length === g.nodes.length) return g._core;
    const N = g.nodes.length, out = Array.from({ length: N }, () => []), inn = Array.from({ length: N }, () => []);
    for (const e of g.edges) {
        if (e.cls === 'ferry' || !alwaysOpen(e)) continue;
        out[e.a].push(e.b); inn[e.b].push(e.a);
        if (!e.oneway) { out[e.b].push(e.a); inn[e.a].push(e.b); }
    }
    const seen = new Uint8Array(N), order = [];
    for (let s = 0; s < N; s++) {
        if (seen[s]) continue;
        seen[s] = 1;
        const st = [[s, 0]];
        while (st.length) {
            const t = st[st.length - 1];
            if (t[1] < out[t[0]].length) { const u = out[t[0]][t[1]++]; if (!seen[u]) { seen[u] = 1; st.push([u, 0]); } } else { order.push(t[0]); st.pop(); }
        }
    }
    const comp = new Int32Array(N).fill(-1);
    let best = -1, bestN = 0, c = 0;
    for (let k = order.length - 1; k >= 0; k--) {
        const s = order[k];
        if (comp[s] >= 0) continue;
        comp[s] = c;
        let n = 0;
        const st = [s];
        while (st.length) { const v = st.pop(); n++; for (const u of inn[v]) if (comp[u] < 0) { comp[u] = c; st.push(u); } }
        if (n > bestN) { bestN = n; best = c; }
        c++;
    }
    g._core = Uint8Array.from(comp, x => (x === best ? 1 : 0));
    return g._core;
}

/** An edge's class in a year (upgrades such as dualling apply from their year). */
export function edgeClass(edge, year) {
    let cls = edge.cls;
    for (const u of edge.upgrades ?? []) if (year >= u.year) cls = u.class;
    return cls;
}

/** True for a road that exists for the whole game (yards and farms only attach to these, so they never float). */
export const alwaysOpen = edge => !edge.opened && !(edge.closed < Infinity);
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
            const mid = g.addNode(p1[p1.length - 2], p1[p1.length - 1], { town: edge.town, junction: 'through' });
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
    const { cls, name, ref, road, opened, closed, upgrades, ferry, bridge, tunnel, town, oneway, link, lit, dual, maxspeed, tag } = edge;
    return { cls, name, ref, road, opened, closed, upgrades, ferry, bridge, tunnel, town, oneway, link, lit, dual, maxspeed, tag };
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
 * Builds the whole network for a region: the baked OpenStreetMap graph (nodes and edges as written by the bake, split
 * into the main network and town street tiles), then farm lanes and industry site access roads.
 */
export function buildRoadGraph(region) {
    const g = createGraph();
    const rng = seededRng(hashSeed(region.seed, 'roads'));

    // 1. the baked network (global node ids are the graph's node ids)
    const { nodes, edges } = region.baked;
    for (const n of nodes) {
        g.addNode(n.x, n.y, {
            junction: n.junction, end: n.end, priority: n.priority, mini: n.mini, town: n.town ?? undefined,
            signalsFrom: n.signalsFrom, roundaboutFrom: n.roundaboutFrom, ringRadius: n.ringRadius, kind: n.junction === 'end' ? 'end' : 'junction',
        });
    }
    for (const e of edges) {
        const { a, b, pts, ...props } = e;
        // a "bridge" a few metres long (a culvert or kerb-high span in OSM) is just road: only real spans lift the deck
        if (props.bridge && (props.spans ?? []).filter(sp => sp.type === 'bridge').reduce((t, sp) => t + sp.to - sp.from, 0) < 4) props.bridge = false;
        g.addEdge(g.nodes[a], g.nodes[b], pts, { ...props, town: props.town ?? undefined, road: props.tag ?? undefined }); // road = the curated history tag
    }
    for (const n of g.nodes) setPriority(g, n);
    // each town's centre: the nearest junction (or street end) inside the town, for routing and the minimap
    for (const town of region.towns) {
        town.centreNode = nearestTownNode(g, town);
        // a seed point that is off the real streets (Penzance and Torquay's lie by or in the sea) moves onto the town's
        // real centre junction: the town's buildings, pad and map marker then sit on its streets
        const c = town.centreNode !== null ? g.nodes[town.centreNode] : null;
        if (c && Math.hypot(c.x - town.x, c.y - town.y) > 40) { town.seedX = town.x; town.seedY = town.y; town.x = c.x; town.y = c.y; }
    }
    g._core = null; // yards, farms and splits change the graph below

    // 2. ferries: the seed's slips and crossings, attached to the nearest real roads at each shore
    for (const f of region.seedRoads.filter(r => r.cls === 'ferry')) addFerry(g, region, f);

    g.index = createSegmentIndex(g);

    // 3. farms on the real minor-road frontages outside towns (rural lanes and B roads), each with a short drive to its
    // yard that leaves the road at a right angle
    const farms = [];
    const farmRoads = g.edges.filter(e => (e.cls === 'lane' || e.cls === 'B') && !e.oneway && !e.link && alwaysOpen(e) && !e.bridge && !e.tunnel && !e.town && e.len > 60);
    for (const edge of farmRoads) {
        if (farms.length >= MAX_FARMS) break;
        for (let d = range(rng, 25, 120); d < edge.len - 25; d += range(rng, 200, 380)) {
            if (!chance(rng, 0.15)) continue;
            const side = chance(rng, 0.5) ? 1 : -1;
            const p = pointAt(edge.pts, d);
            const off = range(rng, 34, 52);
            const nx = -Math.sin(p.angle) * side, ny = Math.cos(p.angle) * side;
            const fx = p.x + nx * off, fy = p.y + ny * off;
            if (!farmSiteOk(region, g, farms, fx, fy, p, edge, nx, ny, off)) continue;
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

    // 4. industry sites with their own position: an access road from the nearest real road (minor roads count), leaving
    // it at a right angle (the nearest point is the foot of the perpendicular), clear of junctions and other roads
    const sites = [];
    for (const s of region.sites) {
        if (s.x === undefined) continue; // in-town sites are placed by the building generator
        const skip = new Set();
        let placed = false;
        for (let attempt = 0; attempt < 14 && !placed; attempt++) {
            const near = nearestEdge(g, s.x, s.y, 700, 1919, e => !skip.has(e.id) && (e.cls === 'A' || e.cls === 'B' || e.cls === 'street' || e.cls === 'lane')
                && !e.oneway && !e.link && !e.dual && alwaysOpen(e) && !e.bridge && !e.tunnel && e.len >= 14);
            if (!near) break;
            skip.add(near.edge.id);
            // keep the mouth clear of the junctions at the ends of short edges
            const along = Math.max(7, Math.min(near.edge.len - 7, near.along));
            const p = pointAt(near.edge.pts, along);
            const half = ROAD_CLASS[near.edge.cls].width / 2;
            const sideOfSeed = (s.x - p.x) * -Math.sin(p.angle) + (s.y - p.y) * Math.cos(p.angle) >= 0 ? 1 : -1;
            // the side the seed point is on first (when it is on the road itself, either side), leaving at a right angle
            for (const side of [sideOfSeed, -sideOfSeed]) {
                const ux = -Math.sin(p.angle) * side, uy = Math.cos(p.angle) * side;
                const yardLen = Math.max(30, Math.hypot(s.x - p.x, s.y - p.y));
                const ex = p.x + ux * yardLen, ey = p.y + uy * yardLen;
                if (waterAt(region, ex, ey) || crossesWater(region, p.x, p.y, ex, ey, 1)) continue;
                const ang = Math.atan2(uy, ux);
                const driveLen = yardLen - half - 4;
                // the drive must not cross another road, and the yard (28 x 34 m, plus its shed) must sit clear of the roads
                if (driveLen > 4 && !clearOfRoads(g, obb(p.x + ux * (half + 2 + driveLen / 2), p.y + uy * (half + 2 + driveLen / 2), driveLen, 3, ang), 0.5, near.edge.id)) continue;
                if (!clearOfRoads(g, obb(ex + ux * 20, ey + uy * 20, 40, 40, ang), 1)) continue; // (the road it leaves can bend back past the yard too)
                const entry = g.splitEdge(near.edge, along);
                const yard = g.addNode(ex, ey, { kind: 'site' });
                const access = g.addEdge(entry, yard, [entry.x, entry.y, yard.x, yard.y], { cls: 'access', name: s.name });
                g.index.add(access);
                sites.push({ ...s, node: yard.id, entryNode: entry.id, access: access.id, x: yard.x, y: yard.y, ux, uy });
                placed = true;
                break;
            }
        }
    }

    // shoreline roads count as dry land for waterAt (bridges, tunnels and ferries are the exceptions: they cross water)
    region.dryRoad = (x, y) => {
        for (const s of g.index.near(x, y, 4)) {
            const e = g.edges[s.edge];
            if (e.cls === 'ferry') continue;
            const ax = e.pts[2 * s.seg], ay = e.pts[2 * s.seg + 1], bx = e.pts[2 * s.seg + 2], by = e.pts[2 * s.seg + 3];
            const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
            const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
            if (e.spans?.length) {
                // along the edge only the bridge and tunnel spans cross water (a few metres of margin either side)
                let along = Math.sqrt(l2) * t;
                for (let k = 0; k < s.seg; k++) along += Math.hypot(e.pts[2 * k + 2] - e.pts[2 * k], e.pts[2 * k + 3] - e.pts[2 * k + 1]);
                if (e.spans.some(sp => along > sp.from - 3 && along < sp.to + 3)) continue;
            }
            if (Math.hypot(x - ax - dx * t, y - ay - dy * t) < (ROAD_CLASS[e.cls]?.width ?? 7) / 2 + 3) return true;
        }
        return false;
    };
    region.waterCache.clear();
    for (const n of g.nodes) if (n.baseDegree === undefined || n.edges.length !== n.baseDegree) refreshJunction(g, n);
    return { graph: g, farms, sites };
}

/**
 * Adds one seed ferry. The seed gives the two shores as latitude/longitude points (hand-placed, so they do not line
 * up exactly with the real coast); the crossing is the shortest straight line between a real road node near one
 * shore point and a real road node near the other that goes over open sea or tidal water. The end nodes are on
 * streets, B or A roads that exist for the whole game, so the ferry never floats. Dates, fee and wait come from
 * the seed.
 */
function addFerry(g, region, f) {
    const line = f.pts.filter(p => p.key);
    if (line.length < 2) return null;
    const ok = n => n.edges.some(id => { const e = g.edges[id]; return (e.cls === 'street' || e.cls === 'B' || e.cls === 'A') && alwaysOpen(e) && !e.oneway && !e.link && !e.dual && !e.bridge && !e.tunnel; });
    const near = p => g.nodes.filter(n => Math.hypot(n.x - p.x, n.y - p.y) < 350 && ok(n))
        .sort((m, n) => Math.hypot(m.x - p.x, m.y - p.y) - Math.hypot(n.x - p.x, n.y - p.y)).slice(0, 70);
    const starts = near(line[0]), ends = near(line[line.length - 1]);
    // try for a real crossing (12 m of water, then 5 m); where the baked water does not cover the gap (the Dart is not
    // in the coastline) fall back to the two road nodes nearest the seed's shore points
    let best = null;
    for (const minWet of [12, 5, -1]) {
        for (const a of starts) {
            for (const b of ends) {
                if (a === b) continue;
                const len = Math.hypot(b.x - a.x, b.y - a.y);
                if (len < (minWet < 0 ? 30 : 16) || len > 600) continue;
                let wet = 0;
                if (minWet >= 0) {
                    const n = Math.max(2, Math.ceil(len / 3));
                    for (let i = 1; i < n; i++) if (waterAt(region, a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n)) wet += len / n;
                    if (wet < minWet) continue;
                }
                // the dry part is the approach on land and costs extra
                const cost = len + 4 * (len - wet) + (minWet < 0 ? Math.hypot(a.x - line[0].x, a.y - line[0].y) + Math.hypot(b.x - line.at(-1).x, b.y - line.at(-1).y) : 0);
                if (!best || cost < best.cost) best = { a, b, cost };
            }
        }
        if (best) break;
    }
    if (!best) return null;
    const { a, b } = best;
    return g.addEdge(a, b, [a.x, a.y, b.x, b.y], { cls: 'ferry', name: f.name, road: f.id, tag: f.id, opened: f.opened, closed: f.closed, ferry: f.ferry });
}

/** Farms per region at most (the real lane network would otherwise give thousands). */
const MAX_FARMS = 110;

function farmSiteOk(region, g, farms, fx, fy, roadPoint, edge, nx, ny, off) {
    if (waterAt(region, fx, fy) || waterAt(region, roadPoint.x, roadPoint.y)) return false;
    if (crossesWater(region, roadPoint.x, roadPoint.y, fx, fy, 1)) return false;
    const { town, ratio } = nearestTown(region, fx, fy);
    if (town && Math.hypot(town.x - fx, town.y - fy) < town.radius + 80 && ratio < 2) return false;
    if (moorAt(region, fx, fy) && (Math.floor(fx * 7 + fy * 3) & 3) !== 0) return false; // few farms up on the moor
    for (const f of farms) if (Math.hypot(f.x - fx, f.y - fy) < 400) return false;
    // the farm (drive, yard and buildings ~ 60 m deep) must keep clear of every other road and of the road it opens onto
    const half = (ROAD_CLASS[edge.cls]?.width ?? 7) / 2;
    const depth = off - half + 48;
    const box = obb(roadPoint.x + nx * (half + depth / 2), roadPoint.y + ny * (half + depth / 2), depth, 50, Math.atan2(ny, nx));
    if (!clearOfRoads(g, box, 2, edge.id)) return false;
    // and the yard and sheds (from the yard entrance on) clear of every road, the one it leaves included (it can bend back)
    const yardFrom = off - 18;
    return clearOfRoads(g, obb(roadPoint.x + nx * (yardFrom + 28), roadPoint.y + ny * (yardFrom + 28), 56, 44, Math.atan2(ny, nx)), 1);
}

/** Sets `majorRank` (the highest class rank meeting at the node) and `priority` for a node with 3+ roads. */
function setPriority(g, n) {
    n.baseDegree = n.edges.length;
    if (n.edges.length < 3) return;
    const ranks = n.edges.map(id => ROAD_CLASS[g.edges[id].cls]?.rank ?? 1);
    n.majorRank = Math.max(...ranks);
    if (n.priority === undefined) n.priority = ranks.filter(r => r === n.majorRank).length === 1;
}

/**
 * Re-types a node after roads were attached to it (a yard access or farm lane joining a street): dead ends and
 * through nodes that became junctions give way to the higher-ranked road; signals and roundabouts are kept.
 */
export function refreshJunction(g, n) {
    const deg = n.edges.length;
    if (deg <= 1) n.junction = 'end';
    else if (deg === 2) { if (n.junction !== 'signals' && n.junction !== 'roundabout') n.junction = 'through'; }
    else if (n.junction === undefined || n.junction === 'end' || n.junction === 'through') n.junction = 'giveway';
    n.priority = undefined;
    setPriority(g, n);
    n.baseDegree = deg;
}

/**
 * The town's centre node: the nearest real junction of a street or main road within the town footprint, else the
 * nearest node tagged with the town. Only nodes touching a road that exists from the start of the game qualify, so
 * the centre is reachable in every year.
 */
function nearestTownNode(g, town) {
    const old = id => !g.edges[id].opened && !(g.edges[id].closed < Infinity);
    const urban = id => ['street', 'B', 'A', 'dual', 'M'].includes(g.edges[id].cls) && old(id);
    let best = null, bestD = Infinity, any = null, anyD = Infinity;
    const core = coreNodes(g);
    for (const n of g.nodes) {
        if (n.town !== town.id || !n.edges.some(old) || !core[n.id]) continue; // not in a one-way pocket
        const d = Math.hypot(n.x - town.x, n.y - town.y);
        if (d < anyD) { any = n; anyD = d; }
        if (n.edges.length >= 3 && d <= town.radius && n.edges.some(urban) && d < bestD) { best = n; bestD = d; }
    }
    return (best ?? any)?.id ?? null;
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
