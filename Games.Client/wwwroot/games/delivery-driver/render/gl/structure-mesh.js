// Bridge and tunnel geometry for the WebGL road mesh (pure, no DOM, no GL). Built on the layered road model of
// world/terrain.js and world/crossings.js: a *deck run* is a stretch of an edge lifted on a bridge (an `edge.zones` entry
// of kind 'deck', or a straight `edge.zBridges` run over water); a *tunnel run* is a zone of kind 'tunnel'.
//
// A deck gets: a slab of real thickness (dark underside, visible from below), stone or concrete parapets either side,
// abutments where it meets the land, piers every ~14 m (only where the ground or water below is free of other roads: a
// deck over a road is a clear span), and an embankment that slopes the approach ramps down to the land. A tunnel gets
// side walls, roof beams (a covered cutting: the ground mesh is cut down to the road, see terrain-mesh.js), portal walls
// at both ends and, from 1935, lamps under the beams. The collision shapes of the parapets are in world/rails.js and use
// the same offsets (`railOffset`).
import { compose } from './meshes.js';
import { pointAt, closestOnPoly } from '../../world/geom.js';
import { roadHeightAt, roadFillAt, groundZ } from '../../world/terrain.js';
import { zoneAt, SLAB } from '../../world/crossings.js';
import { edgeOpen, edgeWidth } from '../../world/roadgraph.js';

const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const dim = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

export const BRIDGE = {
    parapet: 0.9, parapetWidth: 0.6, slab: SLAB, stone: hex('#a59b88'), concrete: hex('#c4c2bb'), under: hex('#6f685c'),
    soffit: dim(hex('#6f685c'), 0.72), pier: hex('#8a8374'), earth: hex('#6f8a4f'),
};
export const TUNNEL = {
    height: 5.2, wall: hex('#7f7c74'), beam: hex('#5d5a54'), portal: hex('#8d8a82'), lamp: hex('#ffe3a0'), wallWidth: 0.5,
};

/** Centre of a parapet or rail from the road's centreline, metres (shared with the colliders in world/rails.js). */
export const railOffset = width => width / 2 + 0.5;
/** Decks and tunnel mouths shorter than this are culverts and are not built. */
const MIN_RUN = 3;
/** Pier spacing along a deck, metres. */
const PIER_SPAN = 14;
/** How far past a deck's ends the approach embankment is skirted, metres. */
const RAMP_REACH = 45;

/** The deck runs of an edge as [from, to] metres along it: bridge zones plus the straight `zBridges` runs, merged. */
export function deckRuns(edge) {
    if (edge._deckRuns) return edge._deckRuns;
    const runs = [];
    for (const z of edge.zones ?? []) if (z.kind === 'deck' && z.to - z.from >= MIN_RUN) runs.push([z.from, z.to]);
    for (const [ia, ib] of edge.zBridges ?? []) if ((ib - ia) * edge.zStep >= MIN_RUN) runs.push([ia * edge.zStep, Math.min(edge.len, ib * edge.zStep)]);
    runs.sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const r of runs) {
        const last = out[out.length - 1];
        if (last && r[0] <= last[1] + 0.5) last[1] = Math.max(last[1], r[1]);
        else out.push([r[0], r[1]]);
    }
    return (edge._deckRuns = out);
}

/** The tunnel runs of an edge as [from, to] metres along it. */
export function tunnelRuns(edge) {
    if (edge._tunnelRuns) return edge._tunnelRuns;
    return (edge._tunnelRuns = (edge.zones ?? []).filter(z => z.kind === 'tunnel' && z.to - z.from >= MIN_RUN).map(z => [z.from, z.to]));
}

/** A rectangle of half-length `hl` along heading `a` and half-width `hw` across it, centred on (x, y), as a polygon. */
function rect(x, y, a, hl, hw, shiftAcross = 0) {
    const c = Math.cos(a), s = Math.sin(a), nx = s, ny = -c;
    const cx = x + nx * shiftAcross, cy = y + ny * shiftAcross;
    return [
        { x: cx + c * hl + nx * hw, y: cy + s * hl + ny * hw }, { x: cx + c * hl - nx * hw, y: cy + s * hl - ny * hw },
        { x: cx - c * hl - nx * hw, y: cy - s * hl - ny * hw }, { x: cx - c * hl + nx * hw, y: cy - s * hl + ny * hw },
    ];
}

/** Position, heading and road height at `d` metres along an edge. */
function at(edge, d) {
    const p = pointAt(edge.pts, d, { x: 0, y: 0, angle: 0, seg: 0 });
    return { x: p.x, y: p.y, angle: p.angle, z: roadHeightAt(edge, d), d };
}

/** Whether a chunk window owns the point `d` m along the edge (the end of the edge belongs to the last window). */
const owns = (edge, win, d) => !win || (d >= win[0] - 1e-6 && (d < win[1] - 1e-6 || (win[1] >= edge.len - 1e-6 && d >= edge.len - 1e-6)));

/** Unit left normals (the side towards (ty, -tx)) of a sample polyline. */
function normals(pts) {
    return pts.map((_, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
        return { x: dy / l, y: -dx / l };
    });
}

/** The slab under a deck: dark sides and a darker soffit, lofted along the samples (the road surface covers its top). */
function addSlab(b, part, half, slab) {
    const nrm = normals(part);
    const L = (i, o, z) => ({ x: part[i].x + nrm[i].x * o, y: part[i].y + nrm[i].y * o, z });
    const face = (p0, p1, p2, p3, n, c) => {
        const base = b.vertexCount;
        for (const p of [p0, p1, p2, p3]) b.vertex(p.x, p.y, p.z, n[0], n[1], n[2], c[0], c[1], c[2]);
        b.quad(base, base + 1, base + 2, base + 3);
    };
    for (let i = 0; i < part.length - 1; i++) {
        const j = i + 1;
        const zi = part[i].z, zj = part[j].z;
        const tl = L(i, half, zi), tr = L(i, -half, zi), bl = L(i, half, zi - slab), br = L(i, -half, zi - slab);
        const tl2 = L(j, half, zj), tr2 = L(j, -half, zj), bl2 = L(j, half, zj - slab), br2 = L(j, -half, zj - slab);
        face(bl, br, br2, bl2, [0, 0, -1], BRIDGE.soffit);
        face(tl, bl, bl2, tl2, [nrm[i].x, nrm[i].y, 0], BRIDGE.under);
        face(tr, br, br2, tr2, [-nrm[i].x, -nrm[i].y, 0], BRIDGE.under);
    }
}

/** A sloped skirt beside the road where it stands on fill, from the kerb strip down to the land (earth and grass). */
function addEmbankment(b, run, edge, half) {
    const nrm = normals(run);
    const fill = run.map(s => roadFillAt(edge, s.d));
    let i = 0;
    while (i < run.length - 1) {
        if (fill[i] <= 0.35 || fill[i + 1] <= 0.35) { i++; continue; }
        let j = i + 1;
        while (j < run.length - 1 && fill[j + 1] > 0.35) j++;
        for (const side of [1, -1]) {
            const base = b.vertexCount;
            for (let k = i; k <= j; k++) {
                const s = run[k], n = nrm[k], f = fill[k];
                const run2 = Math.max(1.6, 2 * f); // 1:2 slope
                // the slope normal tilts away from the road
                const inv = 1 / Math.hypot(1, 2);
                const nx = side * n.x * inv, ny = side * n.y * inv, nz = 2 * inv;
                b.vertex(s.x + side * n.x * half, s.y + side * n.y * half, s.z - 0.02, nx, ny, nz, BRIDGE.earth[0], BRIDGE.earth[1], BRIDGE.earth[2]);
                const sh = 0.82 + 0.12 * Math.min(1, f / 6);
                b.vertex(s.x + side * n.x * (half + run2), s.y + side * n.y * (half + run2), s.z - f - 0.25, nx, ny, nz, BRIDGE.earth[0] * sh, BRIDGE.earth[1] * sh, BRIDGE.earth[2] * sh);
            }
            for (let k = 0; k < j - i; k++) { const p = base + 2 * k; b.tri(p, p + 1, p + 2); b.tri(p + 1, p + 3, p + 2); }
        }
        i = j + 1;
    }
}

/** True when the carriageway of an open road other than `except` lies within `pad` m of (x, y) (at any height: piers and abutments are only built where nothing drives below). */
function roadBelow(world, year, x, y, except, pad) {
    for (const sg of world.graph.index.near(x, y, 12)) {
        const e = world.graph.edges[sg.edge];
        if (e === except || e.cls === 'ferry' || !edgeOpen(e, year)) continue;
        if (closestOnPoly(e.pts, x, y).d < edgeWidth(e, year) / 2 - 0.3 + pad) return true;
    }
    return false;
}

/** True when an open road other than `except` has its carriageway at (x, y) at about height `z` (a slip road or ramp merging onto the deck: no parapet across it). */
export function mergesAt(world, year, x, y, except, z) {
    for (const sg of world.graph.index.near(x, y, 10)) {
        const e = world.graph.edges[sg.edge];
        if (e === except || e.cls === 'ferry' || !e.z || !edgeOpen(e, year)) continue;
        const c = closestOnPoly(e.pts, x, y);
        if (c.d < edgeWidth(e, year) / 2 + 0.3 && Math.abs(roadHeightAt(e, c.along) - z) < 2.5) return true;
    }
    return false;
}

/** True when another road's carriageway lies under the centre or either end of a line of half-length `half` across the road at `s`. */
function acrossOnRoad(world, year, edge, s, half, pad) {
    const nx = Math.sin(s.angle), ny = -Math.cos(s.angle);
    return roadBelow(world, year, s.x, s.y, edge, pad) || roadBelow(world, year, s.x + nx * half, s.y + ny * half, edge, pad) || roadBelow(world, year, s.x - nx * half, s.y - ny * half, edge, pad);
}

/**
 * The solid supports of a deck run `[t0, t1]` in a year: an abutment where the deck meets the land (not at a junction)
 * and a pier every ~14 m, `{kind, d, x, y, angle, z (deck), bottom, hl, hw, r}`. Neither is built where another road
 * runs below (a skew crossing can put the road under an abutment's footprint): over a road the deck is a clear span.
 * The mesh draws them and world/rails.js makes them solid; cached per edge and year.
 */
export function deckSupports(world, edge, t0, t1, year, tA = 0, tB = 0) {
    const cache = (edge._supports ??= new Map()), key = `${t0.toFixed(1)}:${year}`;
    if (cache.has(key)) return cache.get(key);
    const out = [], width = edgeWidth(edge, year);
    for (const [d, dir] of [[t0, 1], [t1, -1]]) {
        if (d <= tA + 0.5 || d >= edge.len - tB - 0.5) continue;
        const s = at(edge, d + dir * 0.6);
        if (acrossOnRoad(world, year, edge, s, width / 2 + 0.8, 0.5)) continue;
        const nx = Math.sin(s.angle), ny = -Math.cos(s.angle);
        const bed = Math.min(groundZ(world, s.x, s.y, false), groundZ(world, s.x + nx * width / 2, s.y + ny * width / 2, false), groundZ(world, s.x - nx * width / 2, s.y - ny * width / 2, false));
        const bottom = Math.min(bed, s.z - BRIDGE.slab) - 0.4;
        if (s.z - BRIDGE.slab - bottom < 0.5) continue;
        out.push({ kind: 'abutment', d, x: s.x, y: s.y, angle: s.angle, z: s.z, bottom, hl: 0.6, hw: width / 2 + 0.8, r: 0 });
    }
    const span = t1 - t0, count = Math.max(0, Math.ceil(span / PIER_SPAN) - 1);
    for (let k = 1; k <= count; k++) {
        const d = t0 + (span * k) / (count + 1);
        if (d < tA || d > edge.len - tB) continue;
        const s = at(edge, d);
        if (roadBelow(world, year, s.x, s.y, edge, 2.2) || acrossOnRoad(world, year, edge, s, width / 2, 1)) continue;
        const bottom = Math.min(groundZ(world, s.x, s.y, false), s.z - 1) - 0.3, r = Math.min(1.3, width / 5);
        if (s.z - BRIDGE.slab - bottom + 0.05 < 0.4) continue;
        out.push({ kind: 'pier', d, x: s.x, y: s.y, angle: s.angle, z: s.z, bottom, hl: r * 0.9, hw: width / 2 - 0.4, r });
    }
    cache.set(key, out);
    return out;
}

/**
 * The parts of one deck run `[t0, t1]` of an edge: slab, parapets, abutments, piers and the approach embankments.
 * `h` is {trimSamples, offsetSamples} from road-mesh.js; `tA`/`tB` are the junction trims and `win`
 * the chunk window, so every part is built exactly once and never reaches into a junction surface.
 */
export function addDeck(b, h, world, edge, samples, t0, t1, width, year, win = null, tA = 0, tB = 0) {
    const lo = Math.max(t0, win?.[0] ?? 0, tA), hi = Math.min(t1, win?.[1] ?? edge.len, edge.len - tB);
    const part = hi - lo >= 1 ? h.trimSamples(samples, lo, hi) : [];
    const stone = year < 1960 ? BRIDGE.stone : BRIDGE.concrete;
    const half = railOffset(width);
    if (part.length >= 2) {
        for (const side of [1, -1]) {
            const rail = h.offsetSamples(part, side * half);
            for (let i = 0; i < rail.length - 1; i++) {
                const p = rail[i], q = rail[i + 1];
                const ex = q.x - p.x, ey = q.y - p.y, len = Math.hypot(ex, ey) || 1, nx = -ey / len * BRIDGE.parapetWidth / 2, ny = ex / len * BRIDGE.parapetWidth / 2;
                const poly = [{ x: p.x + nx, y: p.y + ny }, { x: q.x + nx, y: q.y + ny }, { x: q.x - nx, y: q.y - ny }, { x: p.x - nx, y: p.y - ny }];
                if (mergesAt(world, year, (p.x + q.x) / 2, (p.y + q.y) / 2, edge, (p.z + q.z) / 2)) continue;
                compose.prism(b, poly, BRIDGE.parapet + Math.abs(q.z - p.z), stone, { z0: Math.min(p.z, q.z) + 0.06 });
            }
        }
        addSlab(b, part, width / 2 + 0.8, BRIDGE.slab);
    }
    // abutments and piers (see deckSupports); each is built by the window that owns its position
    for (const sp of deckSupports(world, edge, t0, t1, year, tA, tB)) {
        if (!owns(edge, win, sp.d)) continue;
        if (sp.kind === 'abutment') {
            compose.prism(b, rect(sp.x, sp.y, sp.angle, sp.hl, sp.hw), sp.z - BRIDGE.slab - sp.bottom, BRIDGE.pier, { z0: sp.bottom, roofColor: BRIDGE.under });
        } else {
            compose.cylinder(b, sp.x, sp.y, sp.bottom, sp.r, sp.z - BRIDGE.slab - sp.bottom + 0.05, 8, BRIDGE.under);
            // a cap beam across the top of the pier, under the slab
            compose.prism(b, rect(sp.x, sp.y, sp.angle, sp.r * 0.9, sp.hw), 0.5, BRIDGE.pier, { z0: sp.z - BRIDGE.slab - 0.5, roofColor: BRIDGE.under });
        }
    }
    // the approach ramps: earth slopes down to the land beside the road, outside the deck
    for (const [from, to] of [[Math.max(0, t0 - RAMP_REACH), t0], [t1, Math.min(edge.len, t1 + RAMP_REACH)]]) {
        const a = Math.max(from, win?.[0] ?? 0, tA), c = Math.min(to, win?.[1] ?? edge.len, edge.len - tB);
        if (c - a < 2) continue;
        addEmbankment(b, h.trimSamples(samples, a, c), edge, width / 2 + 0.8);
    }
}

/** True when the tunnel zone continues into another edge at the node at this end of `edge`. */
function tunnelContinues(world, edge, atStart) {
    const n = world.graph.nodes[atStart ? edge.a : edge.b];
    for (const id of n.edges) {
        const o = world.graph.edges[id];
        if (o === edge || !o.zones) continue;
        const z = zoneAt(o.zones, o.a === n.id ? 0 : o.len);
        if (z?.kind === 'tunnel') return true;
    }
    return false;
}

/** A portal wall at distance `d`, the tunnel lying `dir` (+1 / -1) along the edge from it: two pillars and a lintel up to the hill. */
function addPortal(b, world, edge, d, dir, width) {
    const s = at(edge, d + dir * 0.5);
    const c = Math.cos(s.angle), sn = Math.sin(s.angle), nx = sn, ny = -c;
    const half = width / 2 + 0.3, wall = 3.2;
    let top = s.z + TUNNEL.height + 0.9;
    for (const o of [0, half + wall / 2, -(half + wall / 2)]) top = Math.max(top, groundZ(world, s.x + nx * o, s.y + ny * o, false) + 0.6);
    for (const side of [1, -1]) {
        compose.prism(b, rect(s.x, s.y, s.angle, 0.5, wall / 2, side * (half + wall / 2)), top - s.z, TUNNEL.portal, { z0: s.z, roofColor: TUNNEL.portal });
    }
    compose.prism(b, rect(s.x, s.y, s.angle, 0.5, half), top - (s.z + TUNNEL.height), TUNNEL.portal, { z0: s.z + TUNNEL.height, roofColor: TUNNEL.portal });
}

/** One tunnel run `[t0, t1]` of an edge: walls, roof beams, lamps from 1935 and the portals. Parameters as `addDeck`. */
export function addTunnel(b, h, world, edge, samples, t0, t1, width, year, win = null, tA = 0, tB = 0) {
    const lo = Math.max(t0, win?.[0] ?? 0, tA), hi = Math.min(t1, win?.[1] ?? edge.len, edge.len - tB);
    const part = hi - lo >= 1 ? h.trimSamples(samples, lo, hi) : [];
    const off = width / 2 + 0.3 + TUNNEL.wallWidth / 2;
    if (part.length >= 2) {
        for (const side of [1, -1]) {
            const rail = h.offsetSamples(part, side * off);
            for (let i = 0; i < rail.length - 1; i++) {
                const p = rail[i], q = rail[i + 1];
                const ex = q.x - p.x, ey = q.y - p.y, len = Math.hypot(ex, ey) || 1, nx = -ey / len * TUNNEL.wallWidth / 2, ny = ex / len * TUNNEL.wallWidth / 2;
                const poly = [{ x: p.x + nx, y: p.y + ny }, { x: q.x + nx, y: q.y + ny }, { x: q.x - nx, y: q.y - ny }, { x: p.x - nx, y: p.y - ny }];
                compose.prism(b, poly, TUNNEL.height + Math.abs(q.z - p.z), TUNNEL.wall, { z0: Math.min(p.z, q.z) });
            }
        }
    }
    // roof beams every 9 m across the carriageway, and a lamp under each from 1935
    const BEAM = 9;
    for (let d = t0 + BEAM / 2; d < t1 - 1; d += BEAM) {
        if (d < tA || d > edge.len - tB || !owns(edge, win, d)) continue;
        const s = at(edge, d);
        const across = width / 2 + 0.3 + TUNNEL.wallWidth;
        compose.prism(b, rect(s.x, s.y, s.angle, 0.7, across), 0.5, TUNNEL.beam, { z0: s.z + TUNNEL.height, roofColor: TUNNEL.beam });
        if (year >= 1935) compose.prism(b, rect(s.x, s.y, s.angle, 0.3, 0.7), 0.12, TUNNEL.lamp, { z0: s.z + TUNNEL.height - 0.12, roofColor: TUNNEL.lamp });
    }
    // portals where the tunnel meets daylight
    for (const [d, dir, atStart] of [[t0, 1, true], [t1, -1, false]]) {
        if (!owns(edge, win, d) || d < tA - 0.5 || d > edge.len - tB + 0.5) continue;
        const atNode = atStart ? d <= 0.5 : d >= edge.len - 0.5;
        if (atNode && tunnelContinues(world, edge, atStart)) continue;
        addPortal(b, world, edge, d, dir, width);
    }
}
