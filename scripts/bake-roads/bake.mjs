// Bakes the cached raw OpenStreetMap data (.cache/osm/, see fetch-osm.mjs) into the game's road graph tiles under
// Games.Client/wwwroot/games/delivery-driver/world/seed/baked/.
//
//   node scripts/bake-roads/bake.mjs [--out DIR] [--quiet]
//
// Pipeline (pure functions below, exported for tests; topology work is in real metres, the rest in world metres):
//   1 parse     raw elements -> highway ways (filtered, OSM classes mapped to game classes), signals, coast, rivers
//   2 topology  nodes at shared OSM vertices, ways split there, endpoint snapping, duplicates removed, bridges and
//               tunnels kept as per-segment flags (they share no vertex with what they cross, so no false junctions)
//   3 duals     parallel one-way carriageways with the same ref within ~60 m collapse to one two-way centreline
//   4 rounds    each junction=roundabout ring collapses to one node; mini-roundabouts mark their node
//   5 junction  signals / roundabout / giveway (+ priority when the ranks differ) per node
//   6 streets   residential/service/living_street kept inside town footprints only, driveways and car parks dropped,
//               degree-2 chains merged, short edges contracted, Douglas-Peucker simplification
//   7 output    manifest + main tile + one tile per town, coast and rivers, ODbL header, gzip budget check
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { CACHE, ROOT, loadSeed } from './common.mjs';
import { applyEra, checkEraConnectivity, parseStartYear, buildEvents, SAMPLE_YEARS } from './era.mjs';

const GAME = resolve(ROOT, 'Games.Client/wwwroot/games/delivery-driver');
const game = p => import(pathToFileURL(`${GAME}/${p}`).href);
const { createProjection, latLonToReal, townFootprint } = await game('world/projection.js');
const { encodeTile, encodeLines, encodePoints, LICENCE, BAKE_FORMAT, QUANT } = await game('world/baked-format.js');
const { ROAD_CLASS } = await game('world/roadgraph.js');

export const OUT_DIR = resolve(GAME, 'world/seed/baked');
export const GZIP_BUDGET = 10 * 1024 * 1024;

// ---- Stage 1: parse and classify --------------------------------------------------------------------------------

/**
 * OSM highway -> game class. A road's ref wins where it says more (an "A" ref on a secondary is an A road).
 *
 * | OSM highway                     | game class                                   |
 * |---------------------------------|----------------------------------------------|
 * | motorway                        | M (carriageway pair collapsed to one edge)   |
 * | trunk, primary                  | dual if a carriageway pair, else A           |
 * | motorway/trunk/primary _link    | A, flagged link                              |
 * | secondary (+_link)              | B (A if the ref is an A road)                |
 * | tertiary (+_link)               | A/B by ref; else street in a town, B outside |
 * | unclassified                    | B by ref; else street in a town, lane outside|
 * | residential, living_street      | street (town footprints only)                |
 * | service (not driveway/parking)  | street (town footprints only)                |
 */
export const OSM_CLASS = {
    motorway: 'M', trunk: 'A', primary: 'A', secondary: 'B', tertiary: 'B', unclassified: 'lane',
    motorway_link: 'A', trunk_link: 'A', primary_link: 'A', secondary_link: 'B', tertiary_link: 'B',
    residential: 'street', living_street: 'street', service: 'street',
};
export const MINOR = new Set(['residential', 'living_street', 'service']);
const DUALABLE = new Set(['motorway', 'trunk', 'primary']);
const DROP_SERVICE = new Set(['driveway', 'parking_aisle', 'parking', 'drive-through', 'emergency_access', 'slipway', 'bus', 'fuel']);
const refHas = (ref, letter) => new RegExp(`(^|;)\\s*${letter}\\d`).test(ref ?? '');

export function gameClass(e) {
    if (e.hw === 'motorway') return 'M';
    if (e.link) return refHas(e.ref, 'B') || e.hw === 'secondary_link' || e.hw === 'tertiary_link' ? 'B' : 'A';
    if (e.hw === 'trunk' || e.hw === 'primary') return e.dual ? 'dual' : 'A';
    if (refHas(e.ref, 'A')) return 'A';
    if (refHas(e.ref, 'B')) return 'B';
    if (e.hw === 'secondary') return 'B';
    if (e.hw === 'tertiary') return e.town ? 'street' : 'B';
    if (e.hw === 'unclassified') return e.town ? 'street' : 'lane';
    return 'street';
}

function parseSpeed(v) {
    if (!v) return 0;
    if (/nsl_dual|motorway/i.test(v)) return 70;
    if (/national|nsl/i.test(v)) return 60;
    const m = /^(\d+)\s*(mph)?/.exec(v.trim());
    if (!m) return 0;
    return m[2] ? +m[1] : Math.round(+m[1] / 1.609);
}
const yes = v => v !== undefined && v !== 'no' && v !== '0' && v !== 'false';

/**
 * Raw Overpass elements -> {ways, signals, minis, coast, rivers, tidal}. `ctx` = {origin, towns}. Ways carry real
 * metre geometry (`pts`), coordinate keys (`keys`, identical for a shared OSM node) and tags reduced to what the
 * game uses. Duplicate elements (tiles overlap) are dropped by id.
 */
export function parseOsm(elements, ctx) {
    const seen = new Set();
    const ways = [], signals = [], minis = [], coast = [], rivers = [], tidal = [];
    const real = (lat, lon) => latLonToReal(lat, lon, ctx.origin);
    const dropped = { area: 0, service: 0, private: 0, short: 0 };
    for (const el of elements) {
        const id = `${el.type}/${el.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const t = el.tags ?? {};
        if (el.type === 'node') {
            const p = real(el.lat, el.lon);
            if (t.highway === 'traffic_signals') signals.push({ ...p, key: `${el.lat},${el.lon}` });
            else if (t.highway === 'mini_roundabout') minis.push({ ...p, key: `${el.lat},${el.lon}` });
            continue;
        }
        if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
        const ll = el.geometry.filter(g => g && g.lat !== undefined);
        if (t.natural === 'coastline') { coast.push({ id: el.id, ll: ll.map(g => [g.lat, g.lon]) }); continue; }
        if (t.waterway === 'river') { rivers.push({ id: el.id, name: t.name ?? null, width: parseFloat(t.width) || null, ll: ll.map(g => [g.lat, g.lon]) }); continue; }
        if (t.natural === 'water') { tidal.push({ id: el.id, ll: ll.map(g => [g.lat, g.lon]) }); continue; }
        const hw = t.highway;
        if (!OSM_CLASS[hw]) continue;
        if (t.area === 'yes') { dropped.area++; continue; }
        if (hw === 'service' && DROP_SERVICE.has(t.service)) { dropped.service++; continue; }
        if (MINOR.has(hw) && (t.access === 'private' || t.access === 'no')) { dropped.private++; continue; }
        let geo = ll;
        let oneway = t.oneway === 'yes' || t.oneway === 'true' || t.oneway === '1' || t.oneway === '-1'
            || ((hw === 'motorway' || t.junction === 'roundabout' || t.junction === 'circular') && t.oneway !== 'no');
        if (t.oneway === '-1') geo = [...ll].reverse();
        const keys = [], pts = [];
        for (const g of geo) {
            const k = `${g.lat},${g.lon}`;
            if (keys.length && keys[keys.length - 1] === k) continue;
            keys.push(k);
            const p = real(g.lat, g.lon);
            pts.push(p.x, p.y);
        }
        if (keys.length < 2) { dropped.short++; continue; }
        const flag = yes(t.tunnel) ? 2 : yes(t.bridge) ? 1 : 0;
        ways.push({
            id: el.id, hw, ref: t.ref ?? null, name: t.name ?? null, oneway,
            link: hw.endsWith('_link'), rb: t.junction === 'roundabout' || t.junction === 'circular',
            maxspeed: parseSpeed(t.maxspeed), lit: yes(t.lit) && t.lit !== 'disused', flag, layer: +t.layer || 0,
            startYear: parseStartYear(t.start_date),
            keys, pts,
        });
    }
    return { ways, signals, minis, coast, rivers, tidal, dropped };
}

// ---- Graph helpers -----------------------------------------------------------------------------------------------

/** A mutable graph for the bake. Edges: {id, a, b, pts (flat), segs (per-segment flags: 1 bridge, 2 tunnel), ...}. */
export function createBakeGraph() {
    let nid = 0, eid = 0;
    const g = {
        nodes: new Map(), edges: new Map(),
        addNode(x, y, props = {}) { const n = { id: nid++, x, y, edges: new Set(), rawDeg: 0, ...props }; g.nodes.set(n.id, n); return n; },
        addEdge(a, b, pts, segs, props = {}) {
            const e = { ...props, id: eid++, a: a.id, b: b.id, pts, segs };
            e.len = polyLen(pts);
            g.edges.set(e.id, e);
            a.edges.add(e.id); b.edges.add(e.id);
            return e;
        },
        removeEdge(e) {
            g.edges.delete(e.id);
            g.nodes.get(e.a)?.edges.delete(e.id);
            g.nodes.get(e.b)?.edges.delete(e.id);
        },
        other(e, id) { return e.a === id ? e.b : e.a; },
        /** Moves every edge of `drop` onto `keep` (their end vertex snaps to keep's position) and deletes drop. */
        mergeNodes(keep, drop) {
            if (keep === drop) return keep;
            for (const id of drop.edges) {
                const e = g.edges.get(id);
                if (e.a === drop.id) { e.a = keep.id; e.pts[0] = keep.x; e.pts[1] = keep.y; }
                if (e.b === drop.id) { e.b = keep.id; e.pts[e.pts.length - 2] = keep.x; e.pts[e.pts.length - 1] = keep.y; }
                e.len = polyLen(e.pts);
                keep.edges.add(id);
            }
            keep.rawDeg = Math.max(keep.rawDeg, drop.rawDeg, 2);
            keep.boundary ||= drop.boundary;
            keep.cut ||= drop.cut;
            keep.mini ||= drop.mini;
            if (drop.junction === 'roundabout') keep.junction = 'roundabout';
            g.nodes.delete(drop.id);
            return keep;
        },
        /** Splits an edge at distance `along`; the edge keeps the first part. Returns the new node. */
        splitAt(e, along) {
            const { seg, t, x, y } = pointOn(e.pts, along);
            const node = g.addNode(x, y, { town: e.town });
            node.rawDeg = 2;
            const k = seg + 1; // first vertex after the split point
            const p1 = e.pts.slice(0, 2 * k), s1 = e.segs.slice(0, seg + 1);
            const p2 = [x, y, ...e.pts.slice(2 * k)], s2 = e.segs.slice(seg);
            // drop a zero-length piece next to the split point
            if (t < 1e-6 && p1.length > 2) { p1.length -= 2; s1.length -= 1; }
            p1.push(x, y);
            if (p2.length >= 4 && Math.hypot(p2[2] - x, p2[3] - y) < 1e-6) { p2.splice(2, 2); s2.splice(0, 1); }
            const bNode = g.nodes.get(e.b);
            if (e.a !== e.b) bNode.edges.delete(e.id);
            const { id: _i, a: _a, b: _b, pts: _p, segs: _s, len: _l, ...props } = e;
            g.addEdge(node, bNode, p2, s2, props);
            e.b = node.id; e.pts = p1; e.segs = s1; e.len = polyLen(p1);
            node.edges.add(e.id);
            return node;
        },
        degree(n) { return n.edges.size; },
    };
    return g;
}

export function polyLen(pts) {
    let l = 0;
    for (let i = 2; i < pts.length; i += 2) l += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    return l;
}
function pointOn(pts, along) {
    let acc = 0;
    for (let i = 2; i < pts.length; i += 2) {
        const len = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
        if (acc + len >= along || i === pts.length - 2) {
            const t = len ? Math.max(0, Math.min(1, (along - acc) / len)) : 0;
            return { seg: i / 2 - 1, t, x: pts[i - 2] + (pts[i] - pts[i - 2]) * t, y: pts[i - 1] + (pts[i + 1] - pts[i - 1]) * t, angle: Math.atan2(pts[i + 1] - pts[i - 1], pts[i] - pts[i - 2]) };
        }
        acc += len;
    }
    return { seg: 0, t: 0, x: pts[0], y: pts[1], angle: 0 };
}
export function closestOn(pts, px, py) {
    let best = { d: Infinity, x: 0, y: 0, along: 0, seg: 0, angle: 0 };
    let acc = 0;
    for (let i = 2; i < pts.length; i += 2) {
        const ax = pts[i - 2], ay = pts[i - 1], dx = pts[i] - ax, dy = pts[i + 1] - ay;
        const l2 = dx * dx + dy * dy, l = Math.sqrt(l2);
        const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
        const cx = ax + dx * t, cy = ay + dy * t, d = Math.hypot(px - cx, py - cy);
        if (d < best.d) best = { d, x: cx, y: cy, along: acc + l * t, seg: i / 2 - 1, angle: Math.atan2(dy, dx) };
        acc += l;
    }
    return best;
}

/** Grid of edge ids by the cells their segments cover. Entries may go stale; callers re-check geometry. */
function edgeGrid(cell) {
    const cells = new Map();
    const key = (i, j) => i * 1000003 + j;
    return {
        add(e) {
            const p = e.pts;
            for (let s = 0; s < p.length - 2; s += 2) {
                const i0 = Math.floor(Math.min(p[s], p[s + 2]) / cell), i1 = Math.floor(Math.max(p[s], p[s + 2]) / cell);
                const j0 = Math.floor(Math.min(p[s + 1], p[s + 3]) / cell), j1 = Math.floor(Math.max(p[s + 1], p[s + 3]) / cell);
                for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
                    const k = key(i, j);
                    let l = cells.get(k);
                    if (!l) cells.set(k, (l = new Set()));
                    l.add(e.id);
                }
            }
        },
        near(x, y, r) {
            const out = new Set();
            for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++) {
                for (let j = Math.floor((y - r) / cell); j <= Math.floor((y + r) / cell); j++) {
                    const l = cells.get(key(i, j));
                    if (l) for (const id of l) out.add(id);
                }
            }
            return out;
        },
    };
}
function pointGrid(cell) {
    const cells = new Map();
    const key = (i, j) => i * 1000003 + j;
    return {
        add(p) { const k = key(Math.floor(p.x / cell), Math.floor(p.y / cell)); (cells.get(k) ?? cells.set(k, []).get(k)).push(p); },
        near(x, y, r) {
            const out = [];
            for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++) {
                for (let j = Math.floor((y - r) / cell); j <= Math.floor((y + r) / cell); j++) for (const p of cells.get(key(i, j)) ?? []) out.push(p);
            }
            return out;
        },
    };
}

// ---- Stage 2: topology -------------------------------------------------------------------------------------------

/**
 * Builds the graph: a node at every OSM vertex shared by two or more ways (or at a way's end), ways split there.
 * Bridges and tunnels share no vertex with the roads they cross in OSM, so they never get a junction.
 * Exact duplicate pieces are dropped; dead ends within `snap` m of another road are joined to it.
 */
export function buildTopology(ways, { snap = 2.5 } = {}) {
    const g = createBakeGraph();
    const use = new Map();
    for (const w of ways) w.keys.forEach((k, i) => use.set(k, (use.get(k) ?? 0) + (i === 0 || i === w.keys.length - 1 ? 1 : 2)));
    const nodeAt = new Map();
    const nodeFor = (k, x, y) => {
        let n = nodeAt.get(k);
        if (!n) { n = g.addNode(x, y, { key: k }); n.rawDeg = use.get(k); nodeAt.set(k, n); }
        return n;
    };
    const sigs = new Set();
    let dupes = 0;
    for (const w of ways) {
        const props = { hw: w.hw, ref: w.ref, name: w.name, oneway: w.oneway, link: w.link, rb: w.rb, maxspeed: w.maxspeed, lit: w.lit, layer: w.layer, osm: w.id, startYear: w.startYear };
        let start = 0;
        for (let i = 1; i < w.keys.length; i++) {
            const last = i === w.keys.length - 1;
            if (!last && use.get(w.keys[i]) < 3) continue; // interior vertex of this way only (use 2)
            const keys = w.keys.slice(start, i + 1);
            const sig = keys[0] < keys[keys.length - 1] ? keys.join('|') : [...keys].reverse().join('|');
            if (sigs.has(sig)) { dupes++; start = i; continue; }
            sigs.add(sig);
            const a = nodeFor(w.keys[start], w.pts[2 * start], w.pts[2 * start + 1]);
            const b = nodeFor(w.keys[i], w.pts[2 * i], w.pts[2 * i + 1]);
            const pts = w.pts.slice(2 * start, 2 * i + 2);
            g.addEdge(a, b, pts, new Array(keys.length - 1).fill(w.flag), props);
            start = i;
        }
    }
    // snap loose ends (rawDeg 1: the end of one way, shared with nothing) onto a road just beside them
    let snapped = 0;
    const grid = edgeGrid(50);
    for (const e of g.edges.values()) grid.add(e);
    const pg = pointGrid(50);
    for (const n of g.nodes.values()) pg.add(n);
    for (const n of [...g.nodes.values()]) {
        if (!g.nodes.has(n.id) || n.rawDeg !== 1 || n.edges.size !== 1) continue;
        const own = [...n.edges][0];
        const ownEdge = g.edges.get(own);
        const nb = g.other(ownEdge, n.id);
        let target = null, bestD = snap;
        for (const m of pg.near(n.x, n.y, snap)) {
            if (m === n || m.id === nb || !g.nodes.has(m.id)) continue;
            const d = Math.hypot(m.x - n.x, m.y - n.y);
            if (d < bestD) { bestD = d; target = m; }
        }
        if (!target) {
            let hit = null;
            for (const id of grid.near(n.x, n.y, snap)) {
                if (id === own) continue;
                const e = g.edges.get(id);
                if (!e || e.a === n.id || e.b === n.id) continue;
                const c = closestOn(e.pts, n.x, n.y);
                if (c.d < bestD && !e.segs[c.seg]) { bestD = c.d; hit = { e, c }; }
            }
            if (hit) {
                target = g.splitAt(hit.e, hit.c.along);
                grid.add(g.edges.get([...target.edges].find(id => id !== hit.e.id)));
                pg.add(target);
            }
        }
        if (target) { g.mergeNodes(target, n); target.rawDeg = Math.max(target.rawDeg, 3); snapped++; }
    }
    // a self-loop left by snapping or a closed way: split it so every edge joins two different nodes
    for (const e of [...g.edges.values()]) if (e.a === e.b) { if (e.len < 5) g.removeEdge(e); else g.splitAt(e, e.len / 2); }
    return { graph: g, stats: { dupes, snapped } };
}

// ---- Stage 6a: region bounds and town footprints -----------------------------------------------------------------

/**
 * Drops edges outside the region and minor streets outside town footprints; assigns `town` to edges inside a
 * footprint. Nodes that lose edges are marked `cut` (or `boundary` near the region edge).
 */
export function clipToRegion(g, ctx) {
    const { box, towns } = ctx; // box in real metres; towns [{id, x, y, r}] real metres
    const townAt = (x, y) => {
        let best = null, bd = Infinity;
        for (const t of towns) { const d = Math.hypot(x - t.x, y - t.y) / t.r; if (d < 1 && d < bd) { bd = d; best = t.id; } }
        return best;
    };
    let outside = 0, notTown = 0;
    for (const e of [...g.edges.values()]) {
        const m = pointOn(e.pts, e.len / 2);
        const out = m.x < box.minX || m.x > box.maxX || m.y < box.minY || m.y > box.maxY;
        e.town = townAt(m.x, m.y);
        const drop = out ? 'boundary' : MINOR.has(e.hw) && !e.town ? 'cut' : null;
        if (!drop) continue;
        for (const id of [e.a, e.b]) { const n = g.nodes.get(id); if (drop === 'boundary') n.boundary = true; else n.cut = true; }
        g.removeEdge(e);
        if (out) outside++; else notTown++;
    }
    dropLooseNodes(g);
    return { outside, notTown };
}

function dropLooseNodes(g) {
    for (const n of [...g.nodes.values()]) if (!n.edges.size) g.nodes.delete(n.id);
}

/**
 * Removes dead-end spurs that are artefacts: service spurs shorter than `serviceSpur` m (yard and car park entries)
 * and minor roads left dangling by clipping (`cut`). Repeats until nothing changes.
 */
export function pruneSpurs(g, { serviceSpur = 80, cutClasses = new Set(['residential', 'living_street', 'service', 'unclassified', 'tertiary']) } = {}) {
    let removed = 0, changed = true;
    while (changed) {
        changed = false;
        for (const n of [...g.nodes.values()]) {
            if (!g.nodes.has(n.id) || n.edges.size !== 1) continue;
            const e = g.edges.get([...n.edges][0]);
            const spur = e.hw === 'service' && e.len < serviceSpur;
            const cut = n.cut && n.rawDeg !== 1 && cutClasses.has(e.hw);
            if (!spur && !cut) continue;
            const o = g.nodes.get(g.other(e, n.id));
            g.removeEdge(e);
            g.nodes.delete(n.id);
            if (o && o !== n) {
                if (spur && !cut) o.osmEnd = true; // a road ending at a yard or car park entry
                else o.cut = true;
                if (!o.edges.size) g.nodes.delete(o.id);
            }
            removed++; changed = true;
        }
    }
    return { removed };
}

/** A dead end the bake made (not a real end in OSM, not the map edge). */
export const artificialEnd = n => n.edges.size === 1 && !(n.rawDeg === 1 || n.osmEnd || n.boundary);

/** Deletes short stubs ending in an artificial dead end (leftovers of collapsing carriageways), repeatedly. */
export function pruneArtificialEnds(g, maxLen = 10) {
    let removed = 0;
    for (let changed = true; changed;) {
        changed = false;
        for (const n of [...g.nodes.values()]) {
            if (!g.nodes.has(n.id) || !artificialEnd(n)) continue;
            const e = g.edges.get([...n.edges][0]);
            if (e.len >= maxLen) continue;
            g.removeEdge(e); g.nodes.delete(n.id);
            const o = g.nodes.get(g.other(e, n.id));
            if (o && !o.edges.size) g.nodes.delete(o.id);
            removed++; changed = true;
        }
    }
    return { removed, left: [...g.nodes.values()].filter(artificialEnd).length };
}

/** Keeps the largest connected component; returns the sizes dropped. */
export function keepLargestComponent(g) {
    const comp = new Map();
    const sizes = [];
    for (const n of g.nodes.values()) {
        if (comp.has(n.id)) continue;
        const c = sizes.length;
        let size = 0;
        const stack = [n.id];
        comp.set(n.id, c);
        while (stack.length) {
            const id = stack.pop();
            size++;
            for (const eid of g.nodes.get(id).edges) {
                const o = g.other(g.edges.get(eid), id);
                if (!comp.has(o)) { comp.set(o, c); stack.push(o); }
            }
        }
        sizes.push(size);
    }
    let main = 0;
    sizes.forEach((s, i) => { if (s > sizes[main]) main = i; });
    for (const e of [...g.edges.values()]) if (comp.get(e.a) !== main) g.removeEdge(e);
    dropLooseNodes(g);
    return { components: sizes.length, dropped: sizes.filter((_, i) => i !== main).reduce((a, b) => a + b, 0) };
}

// ---- Stage 4: roundabouts ----------------------------------------------------------------------------------------

/** Collapses each roundabout ring into one node at its centre; arms end there. Mini-roundabouts mark their node. */
export function collapseRoundabouts(g, minis = []) {
    const ringEdges = [...g.edges.values()].filter(e => e.rb);
    const parent = new Map();
    const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (const e of ringEdges) { for (const id of [e.a, e.b]) if (!parent.has(id)) parent.set(id, id); parent.set(find(e.a), find(e.b)); }
    const groups = new Map();
    for (const e of ringEdges) { const r = find(e.a); (groups.get(r) ?? groups.set(r, []).get(r)).push(e); }
    let count = 0, passes = 0;
    const grid = edgeGrid(80);
    for (const e of g.edges.values()) if (!e.rb) grid.add(e);
    for (const edges of groups.values()) {
        let sx = 0, sy = 0, sl = 0;
        for (const e of edges) for (let i = 2; i < e.pts.length; i += 2) {
            const l = Math.hypot(e.pts[i] - e.pts[i - 2], e.pts[i + 1] - e.pts[i - 1]);
            sx += ((e.pts[i] + e.pts[i - 2]) / 2) * l; sy += ((e.pts[i + 1] + e.pts[i - 1]) / 2) * l; sl += l;
        }
        if (!sl) continue;
        const cx = sx / sl, cy = sy / sl;
        const ringNodes = new Set(edges.flatMap(e => [e.a, e.b]));
        let radius = 0;
        for (const id of ringNodes) radius += Math.hypot(g.nodes.get(id).x - cx, g.nodes.get(id).y - cy) / ringNodes.size;
        const centre = g.addNode(cx, cy, { junction: 'roundabout', ringRadius: radius });
        centre.rawDeg = 3;
        // a ring on bridges (over a motorway) or in tunnels: what passes through it is grade separated, so the arms'
        // new stretch from the ring to the centre counts as on the structure
        const deck = edges.some(e => e.segs.includes(1)) ? 1 : edges.some(e => e.segs.includes(2)) ? 2 : 0;
        // a road passing over (or under) the ring without joining it: once the ring is a point, its whole stretch
        // across the roundabout is on the structure (a motorway bridging both sides of the ring and the island)
        for (const id of grid.near(cx, cy, radius * 1.3)) {
            const f = g.edges.get(id);
            if (!f || ringNodes.has(f.a) || ringNodes.has(f.b)) continue;
            // it never joins the ring, so it crosses on a different level: over it, unless the ring is the deck
            const flag = f.segs.find(Boolean) ?? (deck === 1 ? 2 : 1);
            let changed = false;
            for (let k = 2; k < f.pts.length; k += 2) {
                const c = closestOn([f.pts[k - 2], f.pts[k - 1], f.pts[k], f.pts[k + 1]], cx, cy);
                if (c.d <= radius && !f.segs[k / 2 - 1]) { f.segs[k / 2 - 1] = flag; changed = true; }
            }
            if (changed) passes++;
        }
        for (const e of edges) g.removeEdge(e);
        for (const id of ringNodes) {
            const n = g.nodes.get(id);
            // arms keep their vertex on the ring and gain the centre as their new end
            for (const eid of n.edges) {
                const e = g.edges.get(eid);
                if (e.a === id) { e.pts.unshift(cx, cy); e.segs.unshift(deck); e.a = centre.id; }
                if (e.b === id) { e.pts.push(cx, cy); e.segs.push(deck); e.b = centre.id; }
                e.len = polyLen(e.pts);
                centre.edges.add(eid);
            }
            centre.town ??= n.town;
            g.nodes.delete(id);
        }
        // an arm that leaves and rejoins the same ring (a by-pass slip) is now a loop: drop short ones
        for (const eid of [...centre.edges]) {
            const e = g.edges.get(eid);
            if (e.a === e.b) { if (e.len < 300) g.removeEdge(e); else g.splitAt(e, e.len / 2); }
        }
        // a ring with a single arm is a turning circle at the end of a road, not a junction
        if (centre.edges.size === 1) { delete centre.junction; centre.osmEnd = true; }
        count++;
    }
    let mini = 0;
    if (minis.length) {
        const byKey = new Map([...g.nodes.values()].filter(n => n.key).map(n => [n.key, n]));
        for (const m of minis) { const n = byKey.get(m.key); if (n && n.edges.size >= 3) { n.junction = 'roundabout'; n.mini = true; mini++; } }
    }
    dropLooseNodes(g);
    return { roundabouts: count, mini, passes };
}

// ---- Stage 3: dual carriageways ----------------------------------------------------------------------------------

const refSet = r => new Set((r ?? '').split(';').map(s => s.trim()).filter(Boolean));
function sameRoad(e, f) {
    const a = refSet(e.ref), b = refSet(f.ref);
    if (a.size || b.size) { for (const x of a) if (b.has(x)) return true; return false; }
    return !!e.name && e.name === f.name;
}

/**
 * Collapses pairs of parallel one-way carriageways (motorway/trunk/primary, same ref, opposite directions, within
 * `pairDist` m) into one two-way centreline flagged `dual`. Carriageways are cut into short pieces, moved to the
 * midline between the pair, and a piece already covered by the kept centreline is dropped; roads that joined a
 * dropped carriageway (side roads, slips) are re-attached to the nearest point of the centreline.
 */
export function collapseDuals(g, { pairDist = 60, piece = 30, cover = 12, attach = 45 } = {}) {
    const isCand = e => e.oneway && DUALABLE.has(e.hw) && !e.link && !e.rb;
    // 1. cut candidates into short pieces (remember the original edge and order)
    let cand = [...g.edges.values()].filter(isCand);
    for (const e of cand) { e.orig = e.id; e.origLen = e.len; e.ord = 0; }
    const pieces = [];
    for (const e0 of cand) {
        let e = e0, ord = 0;
        while (e.len > piece * 1.5) {
            const node = g.splitAt(e, piece);
            const rest = g.edges.get([...node.edges].find(id => id !== e.id));
            rest.orig = e0.id; rest.origLen = e0.origLen; rest.ord = ++ord;
            pieces.push(e);
            e = rest;
        }
        pieces.push(e);
    }
    const grid = edgeGrid(80);
    for (const p of pieces) grid.add(p);
    const dir = (pts, s) => { const dx = pts[2 * s + 2] - pts[2 * s], dy = pts[2 * s + 3] - pts[2 * s + 1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
    /** Nearest point on a compatible piece running the other way (not `exclude`), or null. */
    const partner = (x, y, d, ref, exclude) => {
        let best = null;
        for (const id of grid.near(x, y, pairDist)) {
            const f = g.edges.get(id);
            if (!f || exclude(f) || !sameRoad(ref, f)) continue;
            const c = closestOn(f.pts, x, y);
            if (c.d > pairDist || (best && c.d >= best.d)) continue;
            const fd = dir(f.pts, c.seg);
            if (fd[0] * d[0] + fd[1] * d[1] > -0.5) continue;
            best = c;
        }
        return best;
    };
    // 2. pair pieces and compute the midline shift of their vertices and nodes
    const paired = new Set();
    const vShift = new Map(); // piece id -> new pts
    for (const p of pieces) {
        const m = pointOn(p.pts, p.len / 2);
        const d = [Math.cos(m.angle), Math.sin(m.angle)];
        if (partner(m.x, m.y, d, p, f => f.id === p.id || f.orig === p.orig)) paired.add(p.id);
    }
    const nodeShift = new Map();
    for (const id of paired) {
        const p = g.edges.get(id);
        const out = p.pts.slice();
        for (let i = 0; i < p.pts.length; i += 2) {
            const s = Math.min(i / 2, p.pts.length / 2 - 2);
            const d = dir(p.pts, s);
            const c = partner(p.pts[i], p.pts[i + 1], d, p, f => f.orig === p.orig || !paired.has(f.id));
            if (!c) continue;
            out[i] = (p.pts[i] + c.x) / 2; out[i + 1] = (p.pts[i + 1] + c.y) / 2;
        }
        vShift.set(id, out);
        for (const [nid, i] of [[p.a, 0], [p.b, out.length - 2]]) if (!nodeShift.has(nid)) nodeShift.set(nid, [out[i], out[i + 1]]);
    }
    for (const [id, pts] of vShift) { const p = g.edges.get(id); p.pts = pts; }
    for (const [nid, [x, y]] of nodeShift) {
        const n = g.nodes.get(nid);
        if (n.junction === 'roundabout') continue; // a roundabout centre stays put
        n.x = x; n.y = y;
    }
    // re-sync every endpoint touching a moved node
    for (const nid of nodeShift.keys()) {
        const n = g.nodes.get(nid);
        for (const eid of n.edges) {
            const e = g.edges.get(eid);
            if (e.a === nid) { e.pts[0] = n.x; e.pts[1] = n.y; }
            if (e.b === nid) { e.pts[e.pts.length - 2] = n.x; e.pts[e.pts.length - 1] = n.y; }
            e.len = polyLen(e.pts);
        }
    }
    // 3. keep the longest carriageway's pieces first; drop pieces already covered by the kept centreline
    const order = [...paired].map(id => g.edges.get(id)).sort((a, b) => b.origLen - a.origLen || a.orig - b.orig || a.ord - b.ord);
    const kept = new Set(), dropped = [];
    const keptGrid = edgeGrid(60);
    // covered = a kept piece of the other carriageway (running the opposite way as digitised) lies on top of it
    const keptDeg = id => [...g.nodes.get(id).edges].filter(e => kept.has(e)).length;
    // `inner`: the foot must lie inside the kept centreline, not past the free end of a kept run (a short piece just
    // beyond the end of the other carriageway's run is not covered by it)
    const antiKept = (x, y, ang, r, skip = () => false, inner = false) => {
        let best = null;
        for (const id of keptGrid.near(x, y, r)) {
            const k = g.edges.get(id);
            if (!k || !kept.has(id) || skip(k)) continue;
            const c = closestOn(k.pts, x, y);
            if (c.d > r || (best && c.d >= best.c.d)) continue;
            if (ang !== null && Math.cos(c.angle - ang) > -0.5) continue;
            if (inner && ((c.along < 0.5 && keptDeg(k.a) < 2) || (c.along > k.len - 0.5 && keptDeg(k.b) < 2))) continue;
            best = { k, c };
        }
        return best;
    };
    for (const p of order) {
        const samples = [0.15, 0.5, 0.85].map(f => pointOn(p.pts, p.len * f));
        if (samples.every(s => antiKept(s.x, s.y, s.angle, cover, undefined, true))) { dropped.push(p); continue; }
        kept.add(p.id);
        keptGrid.add(p);
    }
    const touched = new Set(dropped.flatMap(p => [p.a, p.b]));
    for (const p of dropped) g.removeEdge(p);
    for (const id of kept) { const e = g.edges.get(id); e.oneway = false; e.dual = true; }
    // 4. re-attach whatever joined a dropped carriageway to the kept centreline
    let reattached = 0, restored = 0;
    const into = new Map();
    const resolve = id => { while (into.has(id)) id = into.get(id); return id; };
    for (const nid of touched) {
        const n = g.nodes.get(nid);
        if (!n) continue;
        if (!n.edges.size) { g.nodes.delete(nid); continue; }
        const spine = [...n.edges].filter(id => kept.has(id)).map(id => g.edges.get(id));
        if (spine.length >= 2) continue;
        // off the centreline: attach to any kept piece; the end of a kept run (where the kept centreline switches
        // carriageway): attach to the other carriageway's kept piece only
        let ang = null;
        if (spine.length === 1) {
            const s = spine[0];
            ang = s.a === nid ? Math.atan2(s.pts[3] - s.pts[1], s.pts[2] - s.pts[0]) : Math.atan2(s.pts[s.pts.length - 1] - s.pts[s.pts.length - 3], s.pts[s.pts.length - 2] - s.pts[s.pts.length - 4]);
        }
        const best = antiKept(n.x, n.y, ang, attach, k => k.a === nid || k.b === nid);
        if (!best) continue;
        const { k, c } = best;
        let target;
        const na = g.nodes.get(k.a), nb = g.nodes.get(k.b);
        if (c.along < cover && Math.hypot(na.x - c.x, na.y - c.y) < cover) target = na;
        else if (k.len - c.along < cover && Math.hypot(nb.x - c.x, nb.y - c.y) < cover) target = nb;
        else {
            target = g.splitAt(k, c.along);
            const rest = [...target.edges].find(id => id !== k.id);
            kept.add(rest);
            keptGrid.add(g.edges.get(rest));
        }
        if (n.junction === 'roundabout') { target.x = n.x; target.y = n.y; target.junction = 'roundabout'; target.ringRadius = n.ringRadius; resyncNode(g, target); }
        g.mergeNodes(target, n);
        into.set(nid, target.id);
        reattached++;
    }
    for (const e of [...g.edges.values()]) if (e.a === e.b) g.removeEdge(e);
    // 5. a dropped piece whose loss left a kept carriageway dangling (flares into a roundabout) comes back
    for (let changed = true; changed;) {
        changed = false;
        for (const p of dropped) {
            if (p.restored) continue;
            const na = g.nodes.get(resolve(p.a)), nb = g.nodes.get(resolve(p.b));
            if (!na || !nb || na === nb) continue;
            if (!artificialEnd(na) && !artificialEnd(nb)) continue;
            const pts = p.pts.slice();
            pts[0] = na.x; pts[1] = na.y; pts[pts.length - 2] = nb.x; pts[pts.length - 1] = nb.y;
            const { id: _i, a: _a, b: _b, pts: _p, segs, len: _l, ...props } = p;
            const e = g.addEdge(na, nb, pts, segs.slice(), { ...props, oneway: false, dual: true });
            kept.add(e.id);
            p.restored = true; restored++; changed = true;
        }
    }
    dropLooseNodes(g);
    for (const e of g.edges.values()) { delete e.orig; delete e.origLen; delete e.ord; delete e.restored; }
    return { pieces: pieces.length, paired: paired.size, kept: kept.size, dropped: dropped.length, reattached, restored };
}

function resyncNode(g, n) {
    for (const eid of n.edges) {
        const e = g.edges.get(eid);
        if (e.a === n.id) { e.pts[0] = n.x; e.pts[1] = n.y; }
        if (e.b === n.id) { e.pts[e.pts.length - 2] = n.x; e.pts[e.pts.length - 1] = n.y; }
        e.len = polyLen(e.pts);
    }
}

// ---- Stage 6b: merging, projection, contraction and simplification -----------------------------------------------

const sameAttrs = (e, f) => e.cls === f.cls && e.ref === f.ref && e.link === f.link && e.town === f.town && e.maxspeed === f.maxspeed && !!e.dual === !!f.dual && e.oneway === f.oneway && e.hw === f.hw;

/**
 * Merges chains through degree-2 nodes whose two edges match (class, ref, speed, one-way direction...). With
 * `shortLen`, an edge shorter than that is absorbed into its neighbour even if their tags differ (it takes the
 * longer edge's tags): this keeps a short bridge or a speed-limit stub as a span instead of losing it later.
 */
export function mergeDegree2(g, { shortLen = 0 } = {}) {
    let merged = 0;
    for (const n of [...g.nodes.values()]) {
        if (!g.nodes.has(n.id) || n.edges.size !== 2 || n.junction === 'roundabout' || n.mini || n.keep) continue;
        let [e, f] = [...n.edges].map(id => g.edges.get(id));
        if (e.a === e.b || f.a === f.b) continue;
        const relaxed = shortLen && Math.min(e.len, f.len) < shortLen && e.oneway === f.oneway && !!e.dual === !!f.dual;
        if (!sameAttrs(e, f) && !relaxed) continue;
        if (e.oneway) {
            // the merged one-way edge must run e -> n -> f
            if (f.b === n.id && e.a === n.id) [e, f] = [f, e];
            else if (!(e.b === n.id && f.a === n.id)) continue; // one-way directions disagree
        }
        const ea = g.other(e, n.id), fb = g.other(f, n.id);
        if (ea === fb) continue; // two edges between the same pair of nodes: merging would make a loop
        // orient e as (ea -> n) and f as (n -> fb)
        const ePts = e.b === n.id ? e.pts : reversePts(e.pts), eSegs = e.b === n.id ? e.segs : [...e.segs].reverse();
        const fPts = f.a === n.id ? f.pts : reversePts(f.pts), fSegs = f.a === n.id ? f.segs : [...f.segs].reverse();
        const pts = ePts.concat(fPts.slice(2)), segs = eSegs.concat(fSegs);
        const lit = (e.lit ? e.len : 0) + (f.lit ? f.len : 0) >= (e.len + f.len) / 2;
        const name = e.len >= f.len ? e.name ?? f.name : f.name ?? e.name;
        const props = { ...(e.len >= f.len ? e : f), lit, name };
        delete props.id; delete props.a; delete props.b; delete props.pts; delete props.segs; delete props.len;
        // keep e's direction for one-way roads (ea -> fb); two-way roads go from ea too
        g.removeEdge(e); g.removeEdge(f);
        g.nodes.delete(n.id);
        g.addEdge(g.nodes.get(ea), g.nodes.get(fb), pts, segs, props);
        merged++;
    }
    return { merged };
}
function reversePts(pts) { const out = []; for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]); return out; }

/** Real metres -> world metres for every node and vertex (the shared game projection). */
export function projectGraph(g, proj) {
    for (const n of g.nodes.values()) { const p = proj.fromReal(n.x, n.y); n.x = p.x; n.y = p.y; }
    for (const e of g.edges.values()) {
        for (let i = 0; i < e.pts.length; i += 2) { const p = proj.fromReal(e.pts[i], e.pts[i + 1]); e.pts[i] = p.x; e.pts[i + 1] = p.y; }
        const na = g.nodes.get(e.a), nb = g.nodes.get(e.b);
        e.pts[0] = na.x; e.pts[1] = na.y; e.pts[e.pts.length - 2] = nb.x; e.pts[e.pts.length - 1] = nb.y;
        e.len = polyLen(e.pts);
    }
}

const nodeWeight = (g, n) => (n.junction === 'roundabout' ? 100 : 0) + (n.signals ? 50 : 0) + (n.boundary ? 200 : 0)
    + Math.max(0, ...[...n.edges].map(id => ROAD_CLASS[g.edges.get(id).cls]?.rank ?? 1)) * 2 + n.edges.size;

/**
 * Removes edges shorter than `minLen` (world m): a short dead-end spur is deleted, otherwise its two nodes merge
 * (at the more important node), so junctions closer than minLen become one. Then drops near-duplicate parallel
 * edges between the same two nodes and splits remaining loops.
 */
export function contractShort(g, minLen = 3.5) {
    let contracted = 0, spurs = 0, dupes = 0;
    for (let pass = 0; pass < 6; pass++) {
        const short = [...g.edges.values()].filter(e => e.len < minLen).sort((a, b) => a.len - b.len);
        if (!short.length) break;
        let changed = 0;
        for (const e0 of short) {
            const e = g.edges.get(e0.id);
            if (!e || e.len >= minLen || e.segs.some(Boolean)) continue; // a bridge or tunnel stays, however short
            const na = g.nodes.get(e.a), nb = g.nodes.get(e.b);
            if (e.a === e.b) { g.removeEdge(e); changed++; if (na.edges.size === 1) na.osmEnd = true; continue; }
            if (na.edges.size === 1 || nb.edges.size === 1) {
                const end = na.edges.size === 1 ? na : nb;
                if (end.boundary) continue;
                const other = end === na ? nb : na;
                g.removeEdge(e); g.nodes.delete(end.id); spurs++; changed++;
                if (end.cut) other.cut = true; else other.osmEnd = true; // the road still really ends here
                continue;
            }
            const [keep, drop] = nodeWeight(g, na) >= nodeWeight(g, nb) ? [na, nb] : [nb, na];
            g.removeEdge(e);
            keep.signals ||= drop.signals;
            g.mergeNodes(keep, drop);
            contracted++; changed++;
        }
        for (const e of [...g.edges.values()]) {
            if (e.a !== e.b || e.len >= minLen * 4) continue;
            g.removeEdge(e); changed++;
            const n = g.nodes.get(e.a);
            if (n.edges.size === 1) n.osmEnd = true; // a small turning loop at the end of a road
        }
        if (!changed) break;
    }
    // near-duplicate parallel edges between the same two nodes
    const byPair = new Map();
    for (const e of g.edges.values()) { const k = e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`; (byPair.get(k) ?? byPair.set(k, []).get(k)).push(e); }
    for (const list of byPair.values()) {
        if (list.length < 2) continue;
        list.sort((p, q) => (ROAD_CLASS[q.cls]?.rank ?? 0) - (ROAD_CLASS[p.cls]?.rank ?? 0) || p.len - q.len);
        const keep = [list[0]];
        for (const e of list.slice(1)) {
            if (keep.some(k => hausdorff(k.pts, e.pts) < Math.max(minLen * 1.5, 5))) {
                if (e.oneway && keep[0].oneway && keep[0].a !== e.a) keep[0].oneway = false; // two one-way halves = two-way
                g.removeEdge(e); dupes++;
                for (const id of [e.a, e.b]) { const n = g.nodes.get(id); if (n.edges.size === 1) n.osmEnd = true; } // a loop at a road's end
            } else keep.push(e);
        }
    }
    let loops = 0;
    for (const e of [...g.edges.values()]) if (e.a === e.b) { g.splitAt(e, e.len / 2); loops++; }
    dropLooseNodes(g);
    return { contracted, spurs, dupes, loops };
}
function hausdorff(p, q) {
    let worst = 0;
    const sample = (a, b) => { for (let i = 0; i < a.length; i += 2) worst = Math.max(worst, closestOn(b, a[i], a[i + 1]).d); };
    sample(p, q); sample(q, p);
    return worst;
}

/**
 * Every proper crossing between two edges that share no node there, ignoring bridge and tunnel segments:
 * [{e, f, x, y}]. `only` limits the check to crossings involving those edge ids.
 */
export function findCrossings(g, only = null) {
    const grid = edgeGrid(40);
    for (const e of g.edges.values()) grid.add(e);
    const out = [], seen = new Set();
    const list = only ? [...only].map(id => g.edges.get(id)).filter(Boolean) : [...g.edges.values()];
    for (const e of list) {
        for (let i = 2; i < e.pts.length; i += 2) {
            if (e.segs[i / 2 - 1]) continue;
            const ax = e.pts[i - 2], ay = e.pts[i - 1], bx = e.pts[i], by = e.pts[i + 1];
            for (const id of grid.near((ax + bx) / 2, (ay + by) / 2, Math.hypot(bx - ax, by - ay) / 2 + 1)) {
                if (id === e.id) continue;
                const f = g.edges.get(id);
                if (!f) continue;
                const key = e.id < f.id ? `${e.id}-${f.id}` : `${f.id}-${e.id}`;
                if (seen.has(key)) continue;
                for (let k = 2; k < f.pts.length; k += 2) {
                    if (f.segs[k / 2 - 1]) continue;
                    const t = segT(ax, ay, bx, by, f.pts[k - 2], f.pts[k - 1], f.pts[k], f.pts[k + 1]);
                    if (!t) continue;
                    const l = Math.hypot(bx - ax, by - ay), x = ax + ((bx - ax) * t.d) / l, y = ay + ((by - ay) * t.d) / l;
                    // touching at a shared node is not a crossing
                    const shared = [e.a, e.b].filter(n => n === f.a || n === f.b).map(n => g.nodes.get(n));
                    if (shared.some(n => Math.hypot(n.x - x, n.y - y) < 0.05)) continue;
                    seen.add(key);
                    out.push({ e, f, x, y });
                    break;
                }
            }
        }
    }
    return out;
}

/**
 * Douglas-Peucker on every edge (vertices where the bridge/tunnel flag changes are kept), guarded: an edge whose
 * simplified line crosses a road its full line did not is simplified again more finely (finally not at all).
 */
export function simplifyGuarded(g, tolFor) {
    const full = new Map([...g.edges.values()].map(e => [e.id, { pts: e.pts, segs: e.segs }]));
    const res = simplifyEdges(g, tolFor);
    // crossings that exist before simplifying are not simplification's doing
    const swap = () => { for (const e of g.edges.values()) { const f = full.get(e.id); const t = { pts: e.pts, segs: e.segs }; e.pts = f.pts; e.segs = f.segs; e.len = polyLen(e.pts); full.set(e.id, t); } };
    let refined = 0;
    for (let round = 1; round <= 4; round++) {
        const now = findCrossings(g);
        if (!now.length) break;
        const ids = new Set(now.flatMap(c => [c.e.id, c.f.id]));
        swap();
        const before = new Set(findCrossings(g, ids).map(c => (c.e.id < c.f.id ? `${c.e.id}-${c.f.id}` : `${c.f.id}-${c.e.id}`)));
        swap();
        const fix = new Set();
        for (const c of now) if (!before.has(c.e.id < c.f.id ? `${c.e.id}-${c.f.id}` : `${c.f.id}-${c.e.id}`)) { fix.add(c.e.id); fix.add(c.f.id); }
        if (!fix.size) break;
        for (const id of fix) {
            const e = g.edges.get(id), f = full.get(id);
            const tmp = { pts: f.pts, segs: f.segs, len: 0, town: e.town };
            const one = { edges: new Map([[id, tmp]]) };
            if (round < 4) simplifyEdges(one, () => tolFor(e) / 3 ** round);
            e.pts = tmp.pts; e.segs = tmp.segs; e.len = polyLen(e.pts);
            refined++;
        }
    }
    res.refined = refined;
    res.after = [...g.edges.values()].reduce((a, e) => a + e.pts.length / 2, 0);
    return res;
}

/**
 * At 1:13 a minor road running alongside a bigger one (a service road beside a bypass, an old road next to its
 * dualling) ends up inside that road's carriageway. Such an edge (most of its length within the two half widths of
 * a higher-ranked road) is removed when that leaves its neighbours connected (a spur, or both ends at junctions).
 */
export function dropOverlaps(g, { share = 0.7, slack = 0.9, step = 2 } = {}) {
    const grid = edgeGrid(40);
    for (const e of g.edges.values()) grid.add(e);
    const rank = e => ROAD_CLASS[e.cls]?.rank ?? 1, width = e => ROAD_CLASS[e.cls]?.width ?? 7;
    const list = [...g.edges.values()].sort((a, b) => rank(a) - rank(b) || a.len - b.len);
    let dropped = 0;
    for (const e of list) {
        if (!g.edges.has(e.id) || e.len < 4 || e.ref) continue; // numbered roads (slips, old routes) carry the network
        let n = 0, hit = 0;
        for (let d = 2; d <= e.len - 2; d += step) {
            const p = pointOn(e.pts, d);
            n++;
            for (const id of grid.near(p.x, p.y, 20)) {
                const f = g.edges.get(id);
                if (!f || f === e || rank(f) <= rank(e)) continue;
                if (closestOn(f.pts, p.x, p.y).d < ((width(f) + width(e)) / 2) * slack) { hit++; break; }
            }
        }
        if (!n || hit / n < share) continue;
        const na = g.nodes.get(e.a), nb = g.nodes.get(e.b);
        const spur = na.edges.size === 1 || nb.edges.size === 1;
        if (!spur && (na.edges.size < 3 || nb.edges.size < 3)) continue;
        if (!spur && !connectedWithout(g, e, 600)) continue;
        const realEnd = [na, nb].some(m => m.edges.size === 1 && (m.rawDeg === 1 || m.osmEnd));
        g.removeEdge(e);
        for (const m of [na, nb]) { if (!m.edges.size) g.nodes.delete(m.id); else if (m.edges.size === 1 && realEnd) m.osmEnd = true; }
        dropped++;
    }
    return { dropped };
}

/** True if e's two nodes stay connected without e (searching at most `limit` nodes). */
function connectedWithout(g, e, limit) {
    const seen = new Set([e.a]), queue = [e.a];
    while (queue.length && seen.size < limit) {
        const id = queue.shift();
        for (const eid of g.nodes.get(id).edges) {
            if (eid === e.id) continue;
            const o = g.other(g.edges.get(eid), id);
            if (o === e.b) return true;
            if (!seen.has(o)) { seen.add(o); queue.push(o); }
        }
    }
    return false;
}

/** Douglas-Peucker on every edge; vertices where the bridge/tunnel flag changes are kept. */
export function simplifyEdges(g, tolFor) {
    let before = 0, after = 0;
    for (const e of g.edges.values()) {
        const n = e.pts.length / 2;
        before += n;
        const keep = new Uint8Array(n);
        keep[0] = keep[n - 1] = 1;
        for (let s = 1; s < e.segs.length; s++) if (e.segs[s] !== e.segs[s - 1]) keep[s] = 1;
        const tol = tolFor(e);
        const fixed = [];
        for (let i = 0; i < n; i++) if (keep[i]) fixed.push(i);
        for (let k = 0; k < fixed.length - 1; k++) dp(e.pts, fixed[k], fixed[k + 1], tol, keep);
        const pts = [], segs = [];
        let last = -1;
        for (let i = 0; i < n; i++) {
            if (!keep[i]) continue;
            if (last >= 0) segs.push(e.segs[last]);
            pts.push(e.pts[2 * i], e.pts[2 * i + 1]);
            last = i;
        }
        e.pts = pts; e.segs = segs; e.len = polyLen(pts);
        after += pts.length / 2;
    }
    return { before, after };
}
function dp(pts, i0, i1, tol, keep) {
    const stack = [[i0, i1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        if (b - a < 2) continue;
        const ax = pts[2 * a], ay = pts[2 * a + 1], bx = pts[2 * b], by = pts[2 * b + 1];
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        let worst = -1, at = -1;
        for (let i = a + 1; i < b; i++) {
            const px = pts[2 * i], py = pts[2 * i + 1];
            const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
            const d = Math.hypot(px - ax - dx * t, py - ay - dy * t);
            if (d > worst) { worst = d; at = i; }
        }
        if (worst > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
    }
}

/**
 * A dead end that now pokes across another road it never met (a lane stopping just short of a dual carriageway
 * whose centreline moved onto it, at 1:13) is cut back to stop `gap` m short of that road. Returns the count.
 */
export function trimOvershoots(g, { reach = 8, gap = 1 } = {}) {
    const grid = edgeGrid(40);
    for (const e of g.edges.values()) grid.add(e);
    let trimmed = 0;
    for (const n of [...g.nodes.values()]) {
        if (n.edges.size !== 1) continue;
        const e = g.edges.get([...n.edges][0]);
        if (e.segs.some(Boolean)) continue;
        // walk the edge from the dead end back `reach` m, looking for the first crossing
        const pts = e.b === n.id ? reversePts(e.pts) : e.pts.slice();
        let acc = 0, cut = null;
        for (let i = 2; i < pts.length && acc < reach && !cut; i += 2) {
            const ax = pts[i - 2], ay = pts[i - 1], bx = pts[i], by = pts[i + 1];
            for (const id of grid.near((ax + bx) / 2, (ay + by) / 2, Math.hypot(bx - ax, by - ay) / 2 + 1)) {
                const f = g.edges.get(id);
                if (!f || f === e || f.a === e.a || f.b === e.a || f.a === e.b || f.b === e.b) continue;
                for (let k = 2; k < f.pts.length; k += 2) {
                    if (f.segs[k / 2 - 1]) continue;
                    const t = segT(ax, ay, bx, by, f.pts[k - 2], f.pts[k - 1], f.pts[k], f.pts[k + 1]);
                    if (t !== null && (!cut || acc + t.d < cut.d)) cut = { d: acc + t.d, i };
                }
            }
            acc += Math.hypot(bx - ax, by - ay);
        }
        if (!cut) continue;
        const total = polyLen(pts);
        const keep = cut.d + gap;
        if (total - keep < 2) { // nothing sensible left: drop the stub
            const o = g.nodes.get(g.other(e, n.id));
            g.removeEdge(e); g.nodes.delete(n.id);
            if (o.edges.size === 1) o.osmEnd = true;
            trimmed++;
            continue;
        }
        // keep the part from the far node to `keep` m before the dead end
        const rev = reversePts(pts); // far node first
        const p = pointOn(rev, total - keep);
        const out = rev.slice(0, 2 * (p.seg + 1));
        out.push(p.x, p.y);
        n.x = p.x; n.y = p.y;
        const segs = new Array(out.length / 2 - 1).fill(0);
        // the edge keeps its direction: the far node stays at its end
        if (e.b === n.id) { e.pts = out; } else { e.pts = reversePts(out); }
        e.segs = segs; e.len = polyLen(e.pts);
        trimmed++;
    }
    return { trimmed };
}
/**
 * Last pass over crossings without a node (after simplification): a short edge in a tangle (a city gyratory whose
 * carriageways collapsed onto each other) is straightened if that clears it; a crossing that remains is an
 * untagged at-grade crossing in the data (or too tight to tell apart at 1:13) and becomes a junction.
 */
export function repairCrossings(g, { straightenBelow = 40 } = {}) {
    let straightened = 0, joined = 0;
    for (let round = 0; round < 3; round++) {
        const list = findCrossings(g);
        if (!list.length) break;
        for (const { e, f } of list) {
            if (!g.edges.has(e.id) || !g.edges.has(f.id)) continue;
            let done = false;
            for (const x of [e, f].sort((p, q) => p.len - q.len)) {
                if (x.len >= straightenBelow || x.pts.length <= 4 || x.segs.some(Boolean)) continue;
                const old = { pts: x.pts, segs: x.segs };
                x.pts = [x.pts[0], x.pts[1], x.pts[x.pts.length - 2], x.pts[x.pts.length - 1]]; x.segs = [0]; x.len = polyLen(x.pts);
                if (!findCrossings(g, [x.id]).length) { straightened++; done = true; break; }
                x.pts = old.pts; x.segs = old.segs; x.len = polyLen(x.pts);
            }
            if (done || round < 1) continue;
            const c = findCrossings(g, [e.id]).find(c => c.f.id === f.id || c.e.id === f.id);
            if (!c) continue;
            const ne = g.splitAt(e, closestOn(e.pts, c.x, c.y).along);
            const nf = g.splitAt(f, closestOn(f.pts, c.x, c.y).along);
            if (ne !== nf) { nf.x = ne.x; nf.y = ne.y; g.mergeNodes(ne, nf); resyncNode(g, ne); }
            ne.rawDeg = 4;
            joined++;
        }
    }
    for (const e of [...g.edges.values()]) if (e.a === e.b) g.removeEdge(e);
    dropLooseNodes(g);
    return { straightened, joined, left: findCrossings(g).length };
}

/** Rounds every coordinate to the output grid (1/QUANT m), so later checks see exactly what is written. */
export function quantiseGraph(g) {
    const r = v => Math.round(v * QUANT) / QUANT;
    for (const n of g.nodes.values()) { n.x = r(n.x); n.y = r(n.y); }
    for (const e of g.edges.values()) {
        for (let i = 0; i < e.pts.length; i++) e.pts[i] = r(e.pts[i]);
        const na = g.nodes.get(e.a), nb = g.nodes.get(e.b);
        e.pts[0] = na.x; e.pts[1] = na.y; e.pts[e.pts.length - 2] = nb.x; e.pts[e.pts.length - 1] = nb.y;
        // drop vertices that collapsed onto their neighbour
        const pts = [e.pts[0], e.pts[1]], segs = [];
        for (let i = 2; i < e.pts.length; i += 2) {
            const last = i === e.pts.length - 2;
            if (!last && e.pts[i] === pts[pts.length - 2] && e.pts[i + 1] === pts[pts.length - 1]) continue;
            if (last && pts.length > 2 && e.pts[i] === pts[pts.length - 2] && e.pts[i + 1] === pts[pts.length - 1]) { pts.length -= 2; segs.length -= 1; }
            pts.push(e.pts[i], e.pts[i + 1]); segs.push(e.segs[i / 2 - 1] ?? 0);
        }
        e.pts = pts; e.segs = segs; e.len = polyLen(pts);
    }
}

/** Where segment a-b crosses segment c-d: {d: distance from a} or null. */
function segT(ax, ay, bx, by, cx, cy, dx, dy) {
    const r1x = bx - ax, r1y = by - ay, r2x = dx - cx, r2y = dy - cy;
    const den = r1x * r2y - r1y * r2x;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((cx - ax) * r2y - (cy - ay) * r2x) / den, u = ((cx - ax) * r1y - (cy - ay) * r1x) / den;
    if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
    return { d: t * Math.hypot(r1x, r1y) };
}

// ---- Stage 5: junction typing --------------------------------------------------------------------------------------

/**
 * Sets `junction` on every node: end / through for degree 1 / 2; at real junctions roundabout (collapsed ring or
 * mini), signals (an OSM traffic_signals node within `signalReach` of it, measured on the world map) or giveway,
 * with `priority` true when one road outranks the others and `majorRank` the top class rank. Dead ends get `end`:
 * osm (a real end), boundary (edge of the map) or cut. `signalsFrom`/`roundaboutFrom` are era placeholders that
 * phase 5 (era rules) refines.
 */
export function typeJunctions(g, signals, reachFor = () => 6) {
    const pg = pointGrid(40);
    for (const s of signals) pg.add(s);
    const counts = { through: 0, end: 0, giveway: 0, signals: 0, roundabout: 0, priority: 0 };
    for (const n of g.nodes.values()) {
        const deg = n.edges.size;
        const ranks = [...n.edges].map(id => ROAD_CLASS[g.edges.get(id).cls]?.rank ?? 1);
        n.majorRank = Math.max(...ranks);
        if (deg <= 1) {
            n.junction = 'end';
            n.end = n.boundary ? 'boundary' : n.rawDeg === 1 || n.osmEnd ? 'osm' : 'cut';
        } else if (deg === 2 && n.junction !== 'roundabout') {
            n.junction = 'through';
        } else if (n.junction === 'roundabout') {
            n.roundaboutFrom = n.mini ? 1975 : 1960;
        } else if (n.signals || nearSignal(pg, n, reachFor(n))) {
            n.junction = 'signals';
            n.signalsFrom = 1932;
        } else {
            n.junction = 'giveway';
            n.priority = Math.min(...ranks) < n.majorRank;
        }
        counts[n.junction]++;
        if (n.priority) counts.priority++;
    }
    return counts;
}

const nearSignal = (pg, n, r) => pg.near(n.x, n.y, r).some(s => Math.hypot(s.x - n.x, s.y - n.y) <= r);

// ---- Coast and rivers --------------------------------------------------------------------------------------------

/** Joins coastline ways end to start into chains (OSM coastline has the land on its left). [[lat, lon], ...][] */
export function chainLines(ways) {
    const byStart = new Map();
    const key = p => `${p[0]},${p[1]}`;
    for (const w of ways) if (w.ll.length >= 2) byStart.set(key(w.ll[0]), w);
    const used = new Set(), chains = [];
    // start from ways nothing leads into, then the remaining (closed) loops
    const hasPred = new Set(ways.map(w => key(w.ll[w.ll.length - 1])));
    const starts = [...ways.filter(w => !hasPred.has(key(w.ll[0]))), ...ways];
    for (const w0 of starts) {
        if (used.has(w0.id)) continue;
        const chain = [...w0.ll];
        used.add(w0.id);
        for (;;) {
            const next = byStart.get(key(chain[chain.length - 1]));
            if (!next || used.has(next.id)) break;
            used.add(next.id);
            for (let k = 1; k < next.ll.length; k++) chain.push(next.ll[k]);
        }
        chains.push(chain);
    }
    return chains;
}

/**
 * Land polygon rings clipped to the bounds {north, south, west, east}: open coast chains are clipped and closed
 * along the bounds anticlockwise (land on the left); closed island rings inside are kept. Returns rings of
 * [lat, lon] (each closed: last point equals the first) and a list of problems.
 */
export function assembleLand(chains, b) {
    const inside = p => p[0] >= b.south && p[0] <= b.north && p[1] >= b.west && p[1] <= b.east;
    const W = b.east - b.west, H = b.north - b.south, P = 2 * (W + H);
    // perimeter parameter, anticlockwise from the south-west corner (lat up, lon right)
    const param = p => {
        const [lat, lon] = p, e = 1e-9;
        if (Math.abs(lat - b.south) < e) return lon - b.west;
        if (Math.abs(lon - b.east) < e) return W + (lat - b.south);
        if (Math.abs(lat - b.north) < e) return W + H + (b.east - lon);
        return 2 * W + H + (b.north - lat);
    };
    const corners = [[b.south, b.east, W], [b.north, b.east, W + H], [b.north, b.west, 2 * W + H], [b.south, b.west, P]];
    const cross = (p, q) => {
        // where segment p (inside) -> q (outside) leaves the box
        let t = 1;
        const dLat = q[0] - p[0], dLon = q[1] - p[1];
        if (q[0] > b.north) t = Math.min(t, (b.north - p[0]) / dLat);
        if (q[0] < b.south) t = Math.min(t, (b.south - p[0]) / dLat);
        if (q[1] > b.east) t = Math.min(t, (b.east - p[1]) / dLon);
        if (q[1] < b.west) t = Math.min(t, (b.west - p[1]) / dLon);
        const lat = Math.min(b.north, Math.max(b.south, p[0] + dLat * t)), lon = Math.min(b.east, Math.max(b.west, p[1] + dLon * t));
        return [lat, lon];
    };
    const rings = [], pieces = [], problems = [];
    for (const c of chains) {
        const closed = c.length > 3 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1];
        if (closed && c.every(inside)) { rings.push(c); continue; }
        if (!c.some(inside)) continue;
        let cur = null;
        for (let i = 0; i < c.length; i++) {
            const p = c[i], inP = inside(p);
            if (inP) {
                if (!cur) {
                    if (i === 0) { problems.push('coast chain starts inside the bounds'); cur = { pts: [p], open: true }; }
                    else cur = { pts: [cross(p, c[i - 1]), p] };
                } else cur.pts.push(p);
            } else if (cur) {
                cur.pts.push(cross(c[i - 1], p));
                pieces.push(cur); cur = null;
            }
        }
        if (cur) { problems.push('coast chain ends inside the bounds'); cur.openEnd = true; pieces.push(cur); }
    }
    // a chain that stops just short of the bounds (its next way was outside every fetched tile) is extended to it
    const toEdge = p => {
        const d = [[p[0] - b.south, [b.south, p[1]]], [b.north - p[0], [b.north, p[1]]], [p[1] - b.west, [p[0], b.west]], [b.east - p[1], [p[0], b.east]]].sort((x, y) => x[0] - y[0])[0];
        return d[0] < 0.05 ? d[1] : null;
    };
    for (const p of pieces) {
        if (p.open) { const e = toEdge(p.pts[0]); if (e) { p.pts.unshift(e); p.open = false; } }
        if (p.openEnd) { const e = toEdge(p.pts[p.pts.length - 1]); if (e) { p.pts.push(e); p.openEnd = false; } }
    }
    const good = pieces.filter(p => !p.open && !p.openEnd);
    if (good.length < pieces.length) problems.push(`${pieces.length - good.length} coast piece(s) end far from the bounds and were left out`);
    const used = new Set();
    for (let s = 0; s < good.length; s++) {
        if (used.has(s)) continue;
        const ring = [];
        let i = s;
        for (let guard = 0; guard <= good.length; guard++) {
            used.add(i);
            for (const pt of good[i].pts) ring.push(pt);
            const exit = param(good[i].pts[good[i].pts.length - 1]);
            // the next entry anticlockwise from the exit (possibly the first piece, closing the ring)
            let best = -1, bestD = Infinity;
            for (let k = 0; k < good.length; k++) {
                if (used.has(k) && k !== s) continue;
                let d = (param(good[k].pts[0]) - exit + P) % P;
                if (k === i && d < 1e-12) d = P;
                if (d < bestD) { bestD = d; best = k; }
            }
            if (best < 0) break;
            const passed = corners.map(([lat, lon, at]) => [lat, lon, (at - exit + P) % P]).filter(c => c[2] > 1e-12 && c[2] < bestD).sort((x, y) => x[2] - y[2]);
            for (const c of passed) ring.push([c[0], c[1]]);
            if (best === s) break;
            i = best;
        }
        ring.push(ring[0]);
        rings.push(ring);
    }
    return { rings, problems };
}

function simplifyLine(pts, tol) {
    const n = pts.length / 2;
    if (n < 3) return pts;
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    dp(pts, 0, n - 1, tol, keep);
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
    return out;
}
const ringArea = pts => { let a = 0; for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) a += pts[j] * pts[i + 1] - pts[i] * pts[j + 1]; return Math.abs(a) / 2; };

// ---- The whole bake ----------------------------------------------------------------------------------------------

/**
 * Runs every stage on raw elements. `seed` = {origin, bounds, towns}; 
 * Returns {graph (world metres), coast, rivers, tidal, stats}.
 */
export function bake(elements, seed, { scale, tolScale = 1, log = () => {}, probe = null, history = null } = {}) {
    // `scale` (default WORLD_SCALE) and `tolScale` (multiplier on the clean-up tolerances below) exist for
    // scripts/bake-roads/measure-scale.mjs. The tolerances are written in REAL metres and converted by the scale, so
    // geometry fidelity is the same in real terms at any scale (they were tuned as 3.5 world m at 1:13 = 45.5 real m).
    const proj = createProjection(seed, scale ? { scale } : {});
    const toWorld_ = m => m * proj.worldScale * tolScale;
    const ctx = { origin: seed.origin };
    const stats = {};
    const parsed = parseOsm(elements, ctx);
    stats.parse = { ways: parsed.ways.length, signals: parsed.signals.length, minis: parsed.minis.length, coast: parsed.coast.length, rivers: parsed.rivers.length, dropped: parsed.dropped };
    log('parse', stats.parse);
    const { graph: g, stats: topo } = buildTopology(parsed.ways);
    stats.topology = { ...topo, nodes: g.nodes.size, edges: g.edges.size };
    log('topology', stats.topology);
    const nw = latLonToReal(seed.bounds.north, seed.bounds.west, seed.origin), se = latLonToReal(seed.bounds.south, seed.bounds.east, seed.origin);
    const towns = seed.towns.map(t => ({ id: t.id, ...latLonToReal(t.lat, t.lon, seed.origin), r: townFootprint(t) }));
    stats.clip = clipToRegion(g, { box: { minX: nw.x, minY: nw.y, maxX: se.x, maxY: se.y }, towns });
    probe?.('clip', g);
    stats.prune = pruneSpurs(g);
    probe?.('prune', g);
    log('clip', stats.clip, 'prune', stats.prune);
    stats.roundabouts = collapseRoundabouts(g, parsed.minis);
    probe?.('roundabouts', g);
    log('roundabouts', stats.roundabouts);
    stats.duals = collapseDuals(g);
    probe?.('duals', g);
    log('duals', stats.duals);
    for (const e of g.edges.values()) e.cls = gameClass(e);
    stats.components = keepLargestComponent(g);
    probe?.('components', g);
    log('components', stats.components);
    // signals that sit on a junction's own vertex
    const sigKeys = new Set(parsed.signals.map(s => s.key));
    for (const n of g.nodes.values()) if (n.key && sigKeys.has(n.key)) n.signals = true;
    stats.merge1 = mergeDegree2(g);
    probe?.('merge1', g);
    projectGraph(g, proj);
    stats.merge1b = mergeDegree2(g, { shortLen: toWorld_(45.5) });
    probe?.('merge1b', g);
    stats.contract = contractShort(g, toWorld_(45.5));
    probe?.('contract', g);
    stats.prune2 = pruneSpurs(g, { serviceSpur: 0 });
    probe?.('prune2', g);
    stats.overlaps = dropOverlaps(g);
    probe?.('overlaps', g);
    stats.components2 = keepLargestComponent(g);
    probe?.('components2', g);
    stats.merge2 = mergeDegree2(g);
    probe?.('merge2', g);
    log('merge', stats.merge1, 'contract', stats.contract, 'overlaps', stats.overlaps, stats.components2, 'merge', stats.merge2);
    stats.simplify = simplifyGuarded(g, e => (e.town ? toWorld_(19.5) : toWorld_(52)));
    probe?.('simplify', g);
    stats.trim = trimOvershoots(g, { reach: toWorld_(104), gap: toWorld_(13) });
    probe?.('trim', g);
    quantiseGraph(g);
    stats.crossings = repairCrossings(g, { straightenBelow: toWorld_(520) });
    stats.stubs = pruneArtificialEnds(g);
    quantiseGraph(g);
    stats.crossings.final = findCrossings(g).length;
    probe?.('crossings', g);
    log('simplify', stats.simplify, 'trim', stats.trim, 'crossings', stats.crossings, 'stubs', stats.stubs);
    // signals within ~25 real metres of a junction (they sit on the approaches), measured in world metres
    const sigWorld = parsed.signals.map(s => proj.fromReal(s.x, s.y));
    stats.junctions = typeJunctions(g, sigWorld, n => Math.max(1.5, 30 * proj.localScale(n.x, n.y)));
    // a node's town: the commonest town of its edges
    for (const n of g.nodes.values()) {
        const c = new Map();
        for (const id of n.edges) { const t = g.edges.get(id).town; if (t) c.set(t, (c.get(t) ?? 0) + 1); }
        n.town = [...c.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? null;
    }
    log('junctions', stats.junctions);
    let eraCheck = null;
    if (history) {
        stats.era = applyEra(g, seed, proj, history, { log });
        eraCheck = checkEraConnectivity(g, seed, proj, SAMPLE_YEARS);
        stats.eraCheck = eraCheck.report;
        log('era check', eraCheck.report);
    }

    // coast, rivers, tidal water (world metres)
    const toWorld = ll => { const out = []; for (const [lat, lon] of ll) { const p = proj.project(lat, lon); out.push(p.x, p.y); } return out; };
    const land = assembleLand(chainLines(parsed.coast), seed.bounds);
    const coast = land.rings.map(r => simplifyLine(toWorld(r), 1)).filter(r => r.length >= 8 && ringArea(r) > 50);
    const rivers = parsed.rivers.map(r => ({ name: r.name, width: r.width, pts: simplifyLine(toWorld(r.ll), 2) })).filter(r => r.pts.length >= 4);
    const tidal = parsed.tidal.map(t => simplifyLine(toWorld(t.ll), 1)).filter(r => r.length >= 8);
    stats.coast = { rings: coast.length, points: coast.reduce((a, r) => a + r.length / 2, 0), problems: land.problems.length };
    log('coast', stats.coast);
    return { graph: g, coast, rivers, tidal, stats, proj, eraCheck };
}

/** Flattens the bake graph to global ids and per-tile lists: main network first, then one tile per town. */
export function toTiles(g, seed) {
    const townTile = e => (MINOR.has(e.hw) && e.cls === 'street' && e.town ? e.town : null);
    const tileOfNode = new Map();
    for (const e of g.edges.values()) {
        const t = townTile(e);
        for (const id of [e.a, e.b]) {
            if (!t) tileOfNode.set(id, 'main');
            else if (!tileOfNode.has(id)) tileOfNode.set(id, t);
        }
    }
    const order = ['main', ...seed.towns.map(t => t.id)];
    const tiles = order.map(id => ({ id, nodes: [], edges: [] }));
    const byId = new Map(tiles.map(t => [t.id, t]));
    for (const n of g.nodes.values()) byId.get(tileOfNode.get(n.id) ?? 'main').nodes.push(n);
    const gid = new Map();
    let next = 0;
    for (const t of tiles) { t.nodeStart = next; for (const n of t.nodes) gid.set(n.id, next++); }
    for (const e of g.edges.values()) byId.get(townTile(e) ?? 'main').edges.push(e);
    const nodeOut = n => ({ x: n.x, y: n.y, junction: n.junction, end: n.end ?? null, priority: !!n.priority, mini: !!n.mini, town: n.town ?? null, signalsFrom: n.signalsFrom, roundaboutFrom: n.roundaboutFrom });
    const edgeOut = e => {
        const spans = [];
        for (let s = 0; s < e.segs.length; s++) {
            if (!e.segs[s]) continue;
            const last = spans[spans.length - 1];
            if (last && last.i1 === s && last.flag === e.segs[s]) last.i1 = s + 1;
            else spans.push({ i0: s, i1: s + 1, flag: e.segs[s], type: e.segs[s] === 2 ? 'tunnel' : 'bridge' });
        }
        return {
            a: gid.get(e.a), b: gid.get(e.b), cls: e.cls, oneway: !!e.oneway, link: !!e.link, lit: !!e.lit, dual: !!e.dual,
            bridge: spans.some(s => s.type === 'bridge'), tunnel: spans.some(s => s.type === 'tunnel'),
            ref: e.ref, name: e.name, maxspeed: e.maxspeed, town: e.town, pts: e.pts, spans,
            opened: e.opened ?? 0, closed: e.closed ?? Infinity, upgrades: e.upgrades ?? [], tag: e.tag ?? null,
        };
    };
    const pos = new Map([...g.nodes.values()].map(n => [gid.get(n.id), n]));
    return tiles.filter(t => t.id === 'main' || t.edges.length || t.nodes.length).map(t => ({
        id: t.id, nodeStart: t.nodeStart,
        encoded: encodeTile(t.id, t.nodeStart, t.nodes.map(nodeOut), t.edges.map(edgeOut), id => pos.get(id)),
        nodeCount: t.nodes.length, edgeCount: t.edges.length,
    }));
}

// ---- CLI ---------------------------------------------------------------------------------------------------------

function loadElements() {
    const dir = resolve(CACHE, 'osm');
    if (!existsSync(dir)) throw new Error(`no raw OSM cache at ${dir}: run scripts/bake-roads/fetch-osm.mjs first`);
    const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
    const elements = [];
    for (const f of files) for (const el of JSON.parse(readFileSync(resolve(dir, f), 'utf8')).elements) elements.push(el);
    return { elements, files: files.length };
}

/**
 * Writes manifest, road tiles, coast and rivers of a bake result into `outDir` (not elevation). Returns
 * {tiles, files_ ({name, bytes, gzip}), perClass}. Used by main() and by scripts/bake-roads/measure-scale.mjs.
 */
export function writeBaked(res, seed, outDir, history) {
    const { graph: g } = res;
    mkdirSync(outDir, { recursive: true });
    const tiles = toTiles(g, seed);
    const files_ = [];
    const write = (name, obj) => {
        const text = JSON.stringify(obj);
        writeFileSync(resolve(outDir, name), text);
        files_.push({ name, bytes: text.length, gzip: gzipSync(text, { level: 9 }).length });
    };
    for (const t of tiles) write(`${t.id === 'main' ? 'main' : 'town-' + t.id}.json`, t.encoded);
    write('coast.json', { licence: LICENCE, format: BAKE_FORMAT, rings: encodeLines(res.coast) });
    write('rivers.json', { licence: LICENCE, format: BAKE_FORMAT, rivers: res.rivers.map(r => ({ name: r.name, width: r.width, pts: encodePoints(r.pts) })), tidal: encodeLines(res.tidal) });

    const perClass = {};
    for (const e of g.edges.values()) {
        const cls = [...(e.upgrades ?? [])].sort((p, q) => q.year - p.year)[0]?.class ?? e.cls; // class in 2025
        const c = (perClass[cls] ??= { edges: 0, km: 0 }); c.edges++; c.km += e.len / 1000;
    }
    for (const c of Object.values(perClass)) c.km = +c.km.toFixed(1);
    const manifest = {
        format: BAKE_FORMAT, licence: LICENCE, attribution: 'Map data © OpenStreetMap contributors (ODbL)',
        region: seed.id, quant: QUANT,
        projection: { origin: seed.origin, worldScale: res.proj.worldScale, module: 'world/projection.js' },
        tiles: tiles.map(t => ({ id: t.id, file: `${t.id === 'main' ? 'main' : 'town-' + t.id}.json`, town: t.id === 'main' ? null : t.id, nodeStart: t.nodeStart, nodeCount: t.nodeCount, edgeCount: t.edgeCount })),
        coast: 'coast.json', rivers: 'rivers.json',
        events: buildEvents(history),
        era: { sampleYears: SAMPLE_YEARS, connectivity: res.eraCheck.report, openedByDecade: res.stats.era.openedByDecade },
        stats: { nodes: g.nodes.size, edges: g.edges.size, perClass, junctions: res.stats.junctions },
    };
    write('manifest.json', manifest);
    return { tiles, files_, perClass };
}

async function main() {
    const args = process.argv.slice(2);
    const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
    const quiet = args.includes('--quiet');
    const outDir = resolve(opt('--out', OUT_DIR));
    const seed = loadSeed();
    const t0 = Date.now();
    const { elements, files } = loadElements();
    console.log(`read ${files} cached tiles, ${elements.length} elements`);
    const history = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'history.json'), 'utf8'));
    const res = bake(elements, seed, { history, log: quiet ? () => {} : (...a) => console.log(' ', ...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x)))) });
    const { graph: g } = res;
    if (res.eraCheck.problems.length) {
        console.error('FAIL: era connectivity check');
        for (const p of res.eraCheck.problems) console.error(`  ${p.year} ${p.town}: ${p.reason}`);
        process.exitCode = 1;
        return;
    }

    const { tiles, files_, perClass } = writeBaked(res, seed, outDir, history);
    // real elevation (needs the cached grid from fetch-elevation.mjs; patches manifest.json with an `elevation` entry)
    if (existsSync(resolve(CACHE, 'elevation', 'grid.f32'))) {
        const { bakeElevation } = await import('./bake-elevation.mjs');
        const dem = await bakeElevation(seed, { outDir, log: quiet ? () => {} : console.log });
        const demBytes = readFileSync(resolve(outDir, 'elevation.bin'));
        files_.push({ name: 'elevation.bin', bytes: demBytes.length, gzip: gzipSync(demBytes, { level: 9 }).length });
    }

    const gz = files_.reduce((a, f) => a + f.gzip, 0), raw = files_.reduce((a, f) => a + f.bytes, 0);
    console.log(`\nnodes ${g.nodes.size}, edges ${g.edges.size}`);
    console.log('edges per class (world km):');
    for (const cls of Object.keys(ROAD_CLASS)) if (perClass[cls]) console.log(`  ${cls.padEnd(7)} ${String(perClass[cls].edges).padStart(7)} edges ${String(perClass[cls].km).padStart(8)} km`);
    console.log('junctions:', JSON.stringify(res.stats.junctions));
    console.log('era:', JSON.stringify(res.stats.era));
    console.log('era connectivity:', JSON.stringify(res.eraCheck.report));
    console.log(`files: ${files_.length} (${tiles.length} road tiles) in ${outDir}`);
    for (const f of files_.filter(f => !f.name.startsWith('town-'))) console.log(`  ${f.name.padEnd(14)} ${(f.bytes / 1e6).toFixed(2)} MB raw, ${(f.gzip / 1e6).toFixed(2)} MB gzip`);
    console.log(`total ${(raw / 1e6).toFixed(2)} MB raw, ${(gz / 1024 / 1024).toFixed(2)} MiB gzip (budget ${GZIP_BUDGET / 1024 / 1024} MiB); ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (gz > GZIP_BUDGET) { console.error('FAIL: baked data exceeds the gzip budget'); process.exitCode = 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
