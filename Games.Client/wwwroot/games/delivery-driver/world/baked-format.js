// Baked road data format (written by scripts/bake-roads/bake.mjs, read by the runtime loader and the validator).
// Pure: no DOM, no fetch. All coordinates are world metres quantised to 1/QUANT m and delta-encoded.
//
// manifest.json  {format, licence, attribution, projection, quant, tiles: [{id, file, town?, nodeStart, nodeCount,
//                 edgeCount}], coast, rivers, stats}
// <tile>.json    {licence, id, nodeStart, strings, nodes, nodeInfo, nodeEra, edges}
//   nodes     [x0, y0, dx1, dy1, ...]  quantised, delta from the previous node of the tile (first from 0, 0)
//   nodeInfo  [junction, end, flags, town, ...] four ints per node (indices into JUNCTIONS / ENDS / strings)
//   edges     [[a, b, cls, flags, ref, name, maxspeed, town, pts, spans], ...]
//             a, b global node ids; cls index into CLASSES; ref/name/town string indices (-1 none); maxspeed mph (0
//             unknown); pts = interior vertices as quantised deltas, starting from node a; spans = flat
//             [i0, i1, type, ...] vertex-index ranges (0 = node a) of bridges (1) and tunnels (2); then, only on edges
//             with era data: opened (year, 0 = always), closed (year, 0 = never), upgrades flat [year, cls, ...] (cls
//             index into CLASSES; `cls` above is the class before any upgrade), tag (string index of the curated
//             history tag, -1 none). Era rules: scripts/bake-roads/era.mjs.
//   nodeEra   [nodeIndexInTile, signalsFrom, roundaboutFrom, ...] for signal and roundabout nodes (0 = none)
// coast.json     {licence, land: [ring, ...], rings: delta-encoded closed rings of the land polygon (even-odd)}
// rivers.json    {licence, rivers: [{name, width, pts}], tidal: [ring, ...]}
export const BAKE_FORMAT = 2;
export const QUANT = 10;
export const CLASSES = ['M', 'dual', 'A', 'B', 'street', 'lane', 'access', 'ferry'];
export const JUNCTIONS = ['through', 'end', 'giveway', 'signals', 'roundabout'];
/** Why a node is a dead end: a real end in OSM, the edge of the map, or cut by the bake (should not survive). */
export const ENDS = [null, 'osm', 'boundary', 'cut'];
export const EDGE_FLAG = { oneway: 1, link: 2, lit: 4, bridge: 8, tunnel: 16, dual: 32 };
export const NODE_FLAG = { priority: 1, mini: 2 };
export const LICENCE = 'Map data (c) OpenStreetMap contributors, licensed under the Open Database Licence (ODbL) 1.0: https://www.openstreetmap.org/copyright';

const q = v => Math.round(v * QUANT);

/** Delta-encodes a flat [x, y, ...] list of world metres (relative to a start point). */
export function encodePoints(pts, sx = 0, sy = 0) {
    const out = [];
    let px = q(sx), py = q(sy);
    for (let i = 0; i < pts.length; i += 2) {
        const x = q(pts[i]), y = q(pts[i + 1]);
        out.push(x - px, y - py);
        px = x; py = y;
    }
    return out;
}
export function decodePoints(enc, sx = 0, sy = 0) {
    const out = new Array(enc.length);
    let px = q(sx), py = q(sy);
    for (let i = 0; i < enc.length; i += 2) {
        px += enc[i]; py += enc[i + 1];
        out[i] = px / QUANT; out[i + 1] = py / QUANT;
    }
    return out;
}

/**
 * Encodes one tile. `nodes` [{id, x, y, junction, end, priority, mini, town}] (ids consecutive from nodeStart);
 * `edges` [{a, b, cls, oneway, link, lit, bridge, tunnel, dual, ref, name, maxspeed, town, pts, spans}] where pts is
 * the full flat polyline (endpoints equal to the nodes) and spans [{i0, i1, type}].
 */
export function encodeTile(id, nodeStart, nodes, edges, nodePos) {
    const strings = [], sIdx = new Map();
    const str = s => {
        if (s === null || s === undefined || s === '') return -1;
        if (!sIdx.has(s)) { sIdx.set(s, strings.length); strings.push(s); }
        return sIdx.get(s);
    };
    const flat = [], info = [], nodeEra = [];
    nodes.forEach((n, k) => { if (n.signalsFrom || n.roundaboutFrom) nodeEra.push(k, n.signalsFrom ?? 0, n.roundaboutFrom ?? 0); });
    for (const n of nodes) {
        flat.push(n.x, n.y);
        info.push(JUNCTIONS.indexOf(n.junction ?? 'through'), Math.max(0, ENDS.indexOf(n.end ?? null)), (n.priority ? NODE_FLAG.priority : 0) | (n.mini ? NODE_FLAG.mini : 0), str(n.town));
    }
    const out = [];
    for (const e of edges) {
        const a = nodePos(e.a);
        const interior = e.pts.slice(2, -2);
        const flags = (e.oneway ? EDGE_FLAG.oneway : 0) | (e.link ? EDGE_FLAG.link : 0) | (e.lit ? EDGE_FLAG.lit : 0)
            | (e.bridge ? EDGE_FLAG.bridge : 0) | (e.tunnel ? EDGE_FLAG.tunnel : 0) | (e.dual ? EDGE_FLAG.dual : 0);
        const spans = (e.spans ?? []).flatMap(s => [s.i0, s.i1, s.type === 'tunnel' ? 2 : 1]);
        const row = [e.a, e.b, CLASSES.indexOf(e.cls), flags, str(e.ref), str(e.name), e.maxspeed ?? 0, str(e.town), encodePoints(interior, a.x, a.y), spans];
        const closed = Number.isFinite(e.closed) ? e.closed : 0;
        if (e.opened || closed || e.upgrades?.length || e.tag) {
            row.push(e.opened ?? 0, closed, (e.upgrades ?? []).flatMap(u => [u.year, CLASSES.indexOf(u.class)]), str(e.tag));
        }
        out.push(row);
    }
    return { licence: LICENCE, format: BAKE_FORMAT, id, nodeStart, strings, nodes: encodePoints(flat), nodeInfo: info, nodeEra, edges: out };
}

/**
 * Decodes tiles (all of them, in manifest order) into {nodes, edges}: nodes indexed by global id, edges with full
 * world polylines and spans as along-distances {from, to, type}.
 */
export function decodeTiles(tiles) {
    const nodes = [];
    for (const t of tiles) {
        const flat = decodePoints(t.nodes);
        for (let k = 0; k < flat.length / 2; k++) {
            const i = 4 * k;
            nodes[t.nodeStart + k] = {
                id: t.nodeStart + k, x: flat[2 * k], y: flat[2 * k + 1],
                junction: JUNCTIONS[t.nodeInfo[i]], end: ENDS[t.nodeInfo[i + 1]],
                priority: !!(t.nodeInfo[i + 2] & NODE_FLAG.priority), mini: !!(t.nodeInfo[i + 2] & NODE_FLAG.mini),
                town: t.nodeInfo[i + 3] >= 0 ? t.strings[t.nodeInfo[i + 3]] : null,
            };
        }
        const ne = t.nodeEra ?? [];
        for (let i = 0; i < ne.length; i += 3) {
            const n = nodes[t.nodeStart + ne[i]];
            if (ne[i + 1]) n.signalsFrom = ne[i + 1];
            if (ne[i + 2]) n.roundaboutFrom = ne[i + 2];
        }
    }
    const edges = [];
    for (const t of tiles) {
        const s = i => (i >= 0 ? t.strings[i] : null);
        for (const [a, b, cls, flags, ref, name, maxspeed, town, enc, spans, opened = 0, closed = 0, upg = [], tag = -1] of t.edges) {
            const na = nodes[a], nb = nodes[b];
            const pts = [na.x, na.y, ...decodePoints(enc, na.x, na.y), nb.x, nb.y];
            const along = [0];
            for (let i = 2; i < pts.length; i += 2) along.push(along[along.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
            const sp = [];
            for (let i = 0; i < spans.length; i += 3) sp.push({ from: along[spans[i]], to: along[spans[i + 1]], type: spans[i + 2] === 2 ? 'tunnel' : 'bridge' });
            edges.push({
                a, b, pts, cls: CLASSES[cls], ref: s(ref), name: s(name), maxspeed: maxspeed || null, town: s(town),
                oneway: !!(flags & EDGE_FLAG.oneway), link: !!(flags & EDGE_FLAG.link), lit: !!(flags & EDGE_FLAG.lit),
                bridge: !!(flags & EDGE_FLAG.bridge), tunnel: !!(flags & EDGE_FLAG.tunnel), dual: !!(flags & EDGE_FLAG.dual),
                spans: sp, opened, closed: closed || Infinity,
                upgrades: Array.from({ length: upg.length / 2 }, (_, k) => ({ year: upg[2 * k], class: CLASSES[upg[2 * k + 1]] })),
                tag: s(tag),
            });
        }
    }
    return { nodes, edges };
}

/** Rings/lines: [[dx, dy, ...], ...] each delta-encoded from 0, 0. */
export const encodeLines = lines => lines.map(l => encodePoints(l));
export const decodeLines = lines => lines.map(l => decodePoints(l));
