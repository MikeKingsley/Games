// Pure road, junction, bridge and yard mesh data for the WebGL renderer (no DOM, no GL). Roads are ribbons laid along
// the graded centreline (`edge.z`, from world/terrain.js): kerb strip, surface, then markings, each a hair above the
// last (the renderer adds a polygon offset for distance). Everything is built per edge or node and depends on the year
// only through `roadKey(edge, year)`, so an era change rebuilds just the edges whose key changed.
import { createBuilder, addStrip, compose, mergeMeshes } from './meshes.js';
import { CHUNK_SIZE } from '../../config.js';
import { edgeClass, edgeOpen, edgeWidth, junctionType, ROAD_CLASS, LANE_WIDTH } from '../../world/roadgraph.js';
import { roadHeightAt, groundZ } from '../../world/terrain.js';
import { waterAt } from '../../world/region.js';
import { pointAt } from '../../world/geom.js';
import { roadStyle, offsetPolyline } from '../draw-road.js';

const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const dim = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** Heights above the graded surface for each layer, metres. */
export const LAYER = { kerb: 0.04, surface: 0.06, reservation: 0.08, marking: 0.1, junction: 0.07 };
/** Sample spacing along an edge, metres. */
export const STEP = 4;

export const BRIDGE = {
    parapet: 0.9, parapetWidth: 0.6, slab: 0.8, stone: hex('#a59b88'), concrete: hex('#c4c2bb'), under: hex('#6f685c'),
};
export const ROUNDABOUT = { island: 7.2 };
export const MARK = { yard: hex('#a49d8d'), yardLine: hex('#f2efe4'), bay: hex('#f2b33d'), practice: hex('#b9b5ab'), quay: hex('#a7a196') };

/** Colours for a year (matches `roadStyle` in draw-road.js), as 0..1 triples. */
export function roadColours(year, wet = false) {
    const s = roadStyle(year);
    const k = wet ? 0.72 : 1;
    return {
        surface: dim(hex(s.surface), k), kerb: hex(s.kerb), centre: s.centre ? hex(s.centre) : null, edge: s.edge ? hex(s.edge) : null,
        lane: dim(hex(year < 1960 ? '#a89a78' : s.surface), k), access: dim(hex('#8e887c'), k),
        reservation: { dual: hex('#6d8a50'), M: hex('#5f7d46') },
    };
}

/** What an edge looks like in a year: its class and width, plus whether it exists. Rebuild its mesh when this changes. */
export const roadKey = (edge, year) => (edgeOpen(edge, year) ? `${edgeClass(edge, year)}:${edgeWidth(edge, year)}` : 'closed');

/** Points along an edge's graded centreline every ~STEP m: [{x, y, z}], from the `a` end to the `b` end. */
export function edgeSamples(edge, step = STEP) {
    const n = Math.max(1, Math.ceil(edge.len / step));
    const out = [];
    const tmp = { x: 0, y: 0, angle: 0 };
    for (let i = 0; i <= n; i++) {
        const d = (edge.len * i) / n;
        pointAt(edge.pts, d, tmp);
        out.push({ x: tmp.x, y: tmp.y, z: roadHeightAt(edge, d), d });
    }
    return out;
}

/** The edge's samples, computed once (the grading is final by the time anything is drawn). */
const samplesOf = edge => (edge._smp ??= edgeSamples(edge));

const offsetSamples = (pts, off) => {
    const flat = [];
    for (const p of pts) flat.push(p.x, p.y);
    const o = offsetPolyline(flat, off);
    return pts.map((p, i) => ({ x: o[2 * i], y: o[2 * i + 1], z: p.z }));
};

/** Samples of [d0, d1] only, with interpolated end points (fewer than two when the range is empty). */
function trimSamples(samples, d0, d1) {
    if (d1 - d0 < 1) return [];
    const out = [];
    const at = (a, c, d) => { const f = (d - a.d) / (c.d - a.d || 1); return { x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f, z: a.z + (c.z - a.z) * f, d }; };
    for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i], c = samples[i + 1];
        if (c.d <= d0 || a.d >= d1) continue;
        if (!out.length) out.push(a.d >= d0 ? a : at(a, c, d0));
        out.push(c.d <= d1 ? c : at(a, c, d1));
    }
    return out;
}

/** Radius of the junction patch at a node in a year: markings of the edges meeting there stop short of it. */
export function junctionRadius(graph, node, year) {
    const open = node.edges.filter(id => edgeOpen(graph.edges[id], year));
    if (open.length < 3) return 0;
    const half = Math.max(...open.map(id => edgeWidth(graph.edges[id], year))) / 2;
    return junctionType(node, year) === 'roundabout' ? ROUNDABOUT.island + 2 * half + 1 : half + 2;
}

/** The dry stretches of a ferry edge, as runs of sample indices [from, to] (the rest is the crossing). */
function wetRuns(samples, region, minWater) {
    const runs = [];
    let from = -1;
    samples.forEach((s, i) => {
        const wet = waterAt(region, s.x, s.y) >= minWater;
        if (wet && from < 0) from = i;
        if ((!wet || i === samples.length - 1) && from >= 0) { runs.push([from, wet ? i : i - 1]); from = -1; }
    });
    return runs;
}

/** Dashes of `dash` m every `dash + gap` m along sample points, as short strips into a builder. */
function dashes(b, pts, width, colour, bias, dash = 3, gap = 6) {
    let carry = 0, on = true;
    let run = [pts[0]];
    const flush = () => { if (run.length >= 2) addStrip(b, run, width, undefined, colour, { bias }); run = []; };
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], c = pts[i];
        const len = Math.hypot(c.x - a.x, c.y - a.y);
        let t = 0;
        while (t < len) {
            const room = (on ? dash : gap) - carry, take = Math.min(room, len - t);
            const f1 = (t + take) / len;
            if (on) {
                if (!run.length) { const f0 = t / len; run.push({ x: a.x + (c.x - a.x) * f0, y: a.y + (c.y - a.y) * f0, z: a.z + (c.z - a.z) * f0 }); }
                run.push({ x: a.x + (c.x - a.x) * f1, y: a.y + (c.y - a.y) * f1, z: a.z + (c.z - a.z) * f1 });
            }
            t += take;
            carry += take;
            if (carry >= (on ? dash : gap) - 1e-9) { if (on) flush(); on = !on; carry = 0; }
        }
    }
    if (on) flush();
}

/**
 * The mesh of one edge in a year, or null when it is closed (or a ferry with no dry approach). Layers, bottom to top:
 * kerb, surface, central reservation (dual carriageways / motorways), lane dividers and centre or edge lines, plus the
 * deck, parapets and piers of any bridge stretch and the dashed crossing of a ferry. `window` ([d0, d1], metres along
 * the edge, sample-aligned: see `edgeWindows`) builds just that stretch, so a long edge can be split between chunks.
 */
export function buildEdgeMesh(world, edge, year, { wet = false, detail = true, window = null } = {}) {
    if (!edgeOpen(edge, year) || !edge.z) return null;
    const region = world.region;
    const cls = edgeClass(edge, year), width = edgeWidth(edge, year);
    const col = roadColours(year, wet);
    const all = samplesOf(edge);
    const samples = window ? all.filter(s => s.d >= window[0] - 1e-6 && s.d <= window[1] + 1e-6) : all;
    if (samples.length < 2) return null;
    const b = createBuilder();
    const surface = edge.cls === 'lane' ? col.lane : edge.cls === 'access' ? col.access : col.surface;
    const bridges = (edge.zBridges ?? []).map(([ia, ib]) => [ia * edge.zStep, ib * edge.zStep]).filter(([t0, t1]) => !window || (t1 > window[0] && t0 < window[1]));
    const bridge = (t0, t1) => addBridge(b, world, edge, all, t0, t1, width, year, window);
    if (cls === 'ferry') {
        // dry approaches as road; the crossing as a dashed route on the water
        const wet2 = wetRuns(samples, region, 15);
        let at = 0;
        const dry = [];
        for (const [from, to] of wet2) { if (from > at) dry.push([at, from]); at = to; }
        if (at < samples.length - 1) dry.push([at, samples.length - 1]);
        for (const [from, to] of dry) {
            const part = samples.slice(from, to + 1);
            if (part.length < 2) continue;
            addStrip(b, part, width + 1.6, undefined, col.kerb, { bias: LAYER.kerb });
            addStrip(b, part, width, undefined, surface, { bias: LAYER.surface });
        }
        for (const [from, to] of wet2) {
            const part = samples.slice(from, to + 1).map(s => ({ x: s.x, y: s.y, z: 0.12 }));
            if (part.length >= 2) dashes(b, part, 1.2, hex('#d8e6ef'), 0, 6, 6);
        }
        return b.vertexCount ? b.finish() : null;
    }
    addStrip(b, samples, width + 1.6, undefined, col.kerb, { bias: LAYER.kerb });
    addStrip(b, samples, width, undefined, surface, { bias: LAYER.surface });
    if (detail && cls !== 'lane' && cls !== 'access') {
        // markings stop at the junction patches at either end
        const ms = trimSamples(samples, junctionRadius(world.graph, world.graph.nodes[edge.a], year), edge.len - junctionRadius(world.graph, world.graph.nodes[edge.b], year));
        if (ms.length < 2) { for (const [t0, t1] of bridges) bridge(t0, t1); return b.vertexCount ? b.finish() : null; }
        if (cls === 'dual' || cls === 'M') {
            const lanes = ROAD_CLASS[cls].lanes, median = width - 2 * lanes * LANE_WIDTH;
            if (median > 0) addStrip(b, ms, median, undefined, col.reservation[cls], { bias: LAYER.reservation });
            if (col.centre) {
                const off = width / 2 - LANE_WIDTH;
                dashes(b, offsetSamples(ms, off), 0.2, col.centre, LAYER.marking);
                dashes(b, offsetSamples(ms, -off), 0.2, col.centre, LAYER.marking);
            }
            if (col.edge) {
                for (const side of [1, -1]) addStrip(b, offsetSamples(ms, side * (width / 2 - 0.4)), 0.15, undefined, col.edge, { bias: LAYER.marking });
            }
        } else {
            if (col.centre && (cls !== 'street' || year >= 1935)) dashes(b, ms, 0.2, col.centre, LAYER.marking);
            if (col.edge) {
                for (const side of [1, -1]) addStrip(b, offsetSamples(ms, side * (width / 2 - 0.35)), 0.15, undefined, col.edge, { bias: LAYER.marking });
            }
        }
    }
    for (const [t0, t1] of bridges) bridge(t0, t1);
    return b.finish();
}

/** Parapets either side, a stone slab under the deck, and piers or abutments down to the bed. */
function addBridge(b, world, edge, samples, t0, t1, width, year, win = null) {
    const whole = samples.filter(s => s.d >= t0 - 1e-6 && s.d <= t1 + 1e-6);
    if (whole.length < 2) return;
    // the parapets and slab stop short of a junction at either end, so they never cut through the roads meeting there;
    // within a chunk's window only that stretch is built
    const graph = world.graph;
    const part = trimSamples(samples, Math.max(t0, win?.[0] ?? 0, junctionRadius(graph, graph.nodes[edge.a], year)), Math.min(t1, win?.[1] ?? edge.len, edge.len - junctionRadius(graph, graph.nodes[edge.b], year)));
    const stone = year < 1960 ? BRIDGE.stone : BRIDGE.concrete;
    const half = width / 2 + 0.5;
    for (const side of part.length < 2 ? [] : [1, -1]) {
        const rail = offsetSamples(part, side * half);
        for (let i = 0; i < rail.length - 1; i++) {
            const p = rail[i], q = rail[i + 1];
            const ex = q.x - p.x, ey = q.y - p.y, len = Math.hypot(ex, ey) || 1, nx = -ey / len * BRIDGE.parapetWidth / 2, ny = ex / len * BRIDGE.parapetWidth / 2;
            const poly = [{ x: p.x + nx, y: p.y + ny }, { x: q.x + nx, y: q.y + ny }, { x: q.x - nx, y: q.y - ny }, { x: p.x - nx, y: p.y - ny }];
            const zLow = Math.min(p.z, q.z);
            compose.prism(b, poly, BRIDGE.parapet + Math.abs(q.z - p.z), stone, { z0: zLow + LAYER.surface });
        }
    }
    // slab under the deck, the same width as the kerb strip
    for (let i = 0; i < part.length - 1; i++) {
        const p = part[i], q = part[i + 1];
        const ex = q.x - p.x, ey = q.y - p.y, len = Math.hypot(ex, ey) || 1, nx = -ey / len * (width / 2 + 0.8), ny = ex / len * (width / 2 + 0.8);
        const poly = [{ x: p.x + nx, y: p.y + ny }, { x: q.x + nx, y: q.y + ny }, { x: q.x - nx, y: q.y - ny }, { x: p.x - nx, y: p.y - ny }];
        compose.prism(b, poly, BRIDGE.slab + Math.abs(q.z - p.z), BRIDGE.under, { z0: Math.min(p.z, q.z) - BRIDGE.slab, roofColor: BRIDGE.under, cap: false });
    }
    // abutments at both ends and a pier every ~14 m between, down to the river bed
    const piers = [whole[0], whole[whole.length - 1]];
    const span = t1 - t0;
    for (let k = 1; k < Math.floor(span / 14); k++) piers.push(whole[Math.min(whole.length - 1, Math.round((whole.length - 1) * (k / Math.floor(span / 14))))]);
    for (const s of piers) {
        if (win && !(s.d >= win[0] - 1e-6 && (s.d < win[1] - 1e-6 || (win[1] >= edge.len - 1e-6 && s.d >= edge.len - 1e-6)))) continue; // another chunk's
        const bed = groundZ(world, s.x, s.y, false);
        const bottom = Math.min(bed, s.z - 1) - 0.3;
        compose.cylinder(b, s.x, s.y, bottom, Math.min(1.2, width / 5), s.z - BRIDGE.slab - bottom + 0.05, 8, BRIDGE.under);
    }
}

/** Directions (radians) leaving a node along each open edge, with the half width of that edge, sorted by angle. */
function armsOf(graph, node, year) {
    const arms = [];
    const tmp = { x: 0, y: 0, angle: 0 };
    for (const id of node.edges) {
        const e = graph.edges[id];
        if (!edgeOpen(e, year) || e.a === e.b) continue;
        const reach = Math.min(e.len, 8);
        pointAt(e.pts, e.a === node.id ? reach : e.len - reach, tmp);
        arms.push({ angle: Math.atan2(tmp.y - node.y, tmp.x - node.x), hw: edgeWidth(e, year) / 2, edge: e });
    }
    return arms.sort((p, q) => p.angle - q.angle);
}

/** Fills the gap between each pair of neighbouring arms: a kite from the node centre out to where their sides meet. */
function addCorners(b, node, arms, grow, z, colour) {
    const n = arms.length;
    for (let i = 0; i < n; i++) {
        const A = arms[i], B = arms[(i + 1) % n];
        const ua = [Math.cos(A.angle), Math.sin(A.angle)], ub = [Math.cos(B.angle), Math.sin(B.angle)];
        const ha = A.hw + grow, hb = B.hw + grow;
        // A's left side and B's right side (left of u is (-uy, ux))
        const la = [node.x - ua[1] * ha, node.y + ua[0] * ha], rb = [node.x + ub[1] * hb, node.y - ub[0] * hb];
        const det = ua[0] * -ub[1] - ua[1] * -ub[0];
        let corner = null;
        if (Math.abs(det) > 0.15) {
            const rx = rb[0] - la[0], ry = rb[1] - la[1];
            const t = (rx * -ub[1] - ry * -ub[0]) / det, s2 = (ua[0] * ry - ua[1] * rx) / det;
            const cap = 2.2 * Math.max(ha, hb);
            if (t >= 0 && s2 >= 0 && t <= cap && s2 <= cap) corner = [la[0] + ua[0] * t, la[1] + ua[1] * t];
        }
        // sides that never meet (a near-straight or very wide gap): bridge them with a point out along the bisector
        if (!corner) {
            const reach = Math.max(ha, hb) * 1.1;
            corner = [(la[0] + rb[0]) / 2 + (ua[0] + ub[0]) * 0.5 * reach * 0.35, (la[1] + rb[1]) / 2 + (ua[1] + ub[1]) * 0.5 * reach * 0.35];
            const gap = ((B.angle - A.angle) + Math.PI * 2) % (Math.PI * 2);
            if (gap > Math.PI * 0.95) corner = [(la[0] + rb[0]) / 2, (la[1] + rb[1]) / 2];
        }
        const c0 = b.vertex(node.x, node.y, z, 0, 0, 1, colour[0], colour[1], colour[2]);
        const c1 = b.vertex(la[0], la[1], z, 0, 0, 1, colour[0], colour[1], colour[2]);
        const c2 = b.vertex(corner[0], corner[1], z, 0, 0, 1, colour[0], colour[1], colour[2]);
        const c3 = b.vertex(rb[0], rb[1], z, 0, 0, 1, colour[0], colour[1], colour[2]);
        b.tri(c0, c1, c2);
        b.tri(c0, c2, c3);
    }
}

/** A junction patch (the corners between the roads meeting there) and, for a roundabout, its ring road and island. Null for plain two-way nodes. */
export function buildNodeMesh(world, node, year, { wet = false } = {}) {
    const graph = world.graph;
    const open = node.edges.filter(id => edgeOpen(graph.edges[id], year));
    if (open.length < 3 || node.z === undefined) return null;
    const col = roadColours(year, wet);
    const widest = open.map(id => graph.edges[id]).sort((p, q) => edgeWidth(q, year) - edgeWidth(p, year))[0];
    const half = edgeWidth(widest, year) / 2;
    const surface = widest.cls === 'lane' ? col.lane : widest.cls === 'access' ? col.access : col.surface;
    const b = createBuilder();
    const type = junctionType(node, year);
    const z = node.z;
    if (type === 'roundabout') {
        const ring = (r, zz, colour) => compose.cylinder(b, node.x, node.y, zz, r, 0.04, 28, colour, { caps: true });
        const outer = ROUNDABOUT.island + 2 * half;
        ring(outer + 0.8, z + LAYER.kerb, col.kerb);
        ring(outer, z + LAYER.junction, surface);
        compose.cylinder(b, node.x, node.y, z + LAYER.junction, ROUNDABOUT.island, 0.18, 20, hex('#8d8b84'));
        compose.cylinder(b, node.x, node.y, z + LAYER.junction + 0.14, ROUNDABOUT.island - 1, 0.1, 20, hex('#6f9a4a'));
        return b.finish();
    }
    const arms = armsOf(graph, node, year);
    if (arms.length < 3) return null;
    addCorners(b, node, arms, 0.8, z + LAYER.kerb, col.kerb);
    addCorners(b, node, arms, 0, z + LAYER.junction, surface);
    return b.finish();
}

/** Orient a rectangle of half sizes (hx, hy) at (x, y) turned by `angle` into polygon points. */
const rect = (x, y, hx, hy, angle) => {
    const c = Math.cos(angle), s = Math.sin(angle);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({ x: x + u * hx * c - v * hy * s, y: y + u * hx * s + v * hy * c }));
};

/** A thin outline of a rectangle (four strips) draped at height z. */
function outline(b, x, y, hx, hy, angle, z, width, colour) {
    const c = rect(x, y, hx, hy, angle);
    for (let i = 0; i < 4; i++) {
        const p = c[i], q = c[(i + 1) % 4];
        addStrip(b, [{ x: p.x, y: p.y, z }, { x: q.x, y: q.y, z }], width, undefined, colour, { bias: LAYER.marking });
    }
}

/** The bay marking: a 3.4 x 7 m box reaching forward from the back line at `marker`, with a back line across. */
export function buildBayMesh(world, marker, { active = false, length = 7, width = 3.4, z = null } = {}) {
    const b = createBuilder();
    const zz = z ?? groundZ(world, marker.x, marker.y);
    const c = Math.cos(marker.heading), s = Math.sin(marker.heading);
    const colour = active ? MARK.bay : MARK.yardLine, lw = active ? 0.35 : 0.22;
    outline(b, marker.x + c * length / 2, marker.y + s * length / 2, length / 2, width / 2, marker.heading, zz, lw, colour);
    addStrip(b, [{ x: marker.x - s * width / 2, y: marker.y + c * width / 2, z: zz }, { x: marker.x + s * width / 2, y: marker.y - c * width / 2, z: zz }], 0.5, undefined, colour, { bias: LAYER.marking });
    return b.finish();
}

/** A yard's surface pad, laid a hair above the levelled ground (the bay marking is separate: it can highlight). */
export function buildYardMesh(world, yard) {
    const z = yard.zone, b = createBuilder();
    compose.prism(b, rect(z.x, z.y, z.hx, z.hy, z.angle), 0.03, MARK.yard, { z0: groundZ(world, z.x, z.y) + LAYER.kerb, roofColor: MARK.yard });
    return b.finish();
}

/** The practice yard: concrete with a painted border; its bays are `buildBayMesh`-style boxes (16 x 3.6 m). */
export function buildPracticeMesh(world, practice, activeBay = -1) {
    const z = practice.yard.zone, b = createBuilder();
    const zz = groundZ(world, z.x, z.y);
    compose.prism(b, rect(z.x, z.y, z.hx, z.hy, z.angle), 0.03, MARK.practice, { z0: zz + LAYER.kerb, roofColor: MARK.practice });
    outline(b, z.x, z.y, z.hx - 1, z.hy - 1, z.angle, zz + LAYER.kerb + 0.03, 0.3, MARK.yardLine);
    practice.bays.forEach((bay, k) => {
        const c = Math.cos(bay.heading), s = Math.sin(bay.heading);
        const colour = k === activeBay ? MARK.bay : MARK.yardLine;
        outline(b, bay.x + c * 8, bay.y + s * 8, 8, 1.8, bay.heading, zz + LAYER.kerb + 0.03, k === activeBay ? 0.35 : 0.22, colour);
    });
    return b.finish();
}

/** A harbour quay slab. */
export function buildQuayMesh(world, harbour) {
    const q = harbour.quay, b = createBuilder();
    compose.prism(b, rect(q.x, q.y, q.hx, q.hy, q.angle), 0.5, MARK.quay, { z0: Math.max(0, groundZ(world, q.x, q.y)) - 0.1, roofColor: MARK.quay });
    return b.finish();
}

const inside = (chunk, x, y) => x >= chunk.x0 && x < chunk.x0 + CHUNK_SIZE && y >= chunk.y0 && y < chunk.y0 + CHUNK_SIZE;

/**
 * The stretches of an edge a chunk draws, as [d0, d1] runs of metres along it. A stretch belongs to the chunk holding
 * the sample at its start, so the chunks' windows tile the edge exactly and a road is drawn whenever any part of it is
 * in a drawn chunk (a long road used to vanish as its middle's chunk left the view).
 */
export function edgeWindows(edge, chunk) {
    const smp = samplesOf(edge), out = [];
    let from = -1;
    for (let i = 0; i <= smp.length; i++) {
        const in_ = i < smp.length && inside(chunk, smp[i].x, smp[i].y);
        if (in_ && from < 0) from = i;
        if (!in_ && from >= 0) {
            const d0 = smp[from].d, d1 = smp[Math.min(smp.length - 1, i)].d;
            if (d1 - d0 > 0.5) out.push([d0, d1]);
            from = -1;
        }
    }
    return out;
}

/**
 * All the static road-level geometry a chunk owns, merged into one mesh (or null): the open edges whose middle lies in
 * it (each edge's stretches inside the chunk, see `edgeWindows`), the junction patches at nodes in it, and the yard pads,
 * bays, practice yard and quays centred in it. `keys` (optional) receives the per-edge keys `{id: roadKey}` of the edges
 * drawn here.
 */
export function buildChunkRoads(world, chunk, year, { wet = false, detail = true, keys = null } = {}) {
    const graph = world.graph, list = [];
    const nodes = new Set();
    for (const id of chunk.edges) {
        const e = graph.edges[id];
        nodes.add(e.a);
        nodes.add(e.b);
        const windows = edgeWindows(e, chunk);
        if (!windows.length) continue;
        if (keys) keys[id] = roadKey(e, year);
        for (const window of windows) {
            const m = buildEdgeMesh(world, e, year, { wet, detail, window });
            if (m) list.push(m);
        }
    }
    for (const id of nodes) {
        const n = graph.nodes[id];
        if (!inside(chunk, n.x, n.y)) continue;
        const m = buildNodeMesh(world, n, year, { wet });
        if (m) list.push(m);
    }
    for (const owner of world.yards) {
        const z = owner.yard.zone;
        if (!inside(chunk, z.x, z.y)) continue;
        list.push(buildYardMesh(world, owner.yard), buildBayMesh(world, owner.yard.marker));
    }
    const pz = world.practice?.yard.zone;
    if (pz && inside(chunk, pz.x, pz.y)) list.push(buildPracticeMesh(world, world.practice));
    for (const h of world.harbours ?? []) if (inside(chunk, h.quay.x, h.quay.y)) list.push(buildQuayMesh(world, h));
    return list.length ? mergeMeshes(list) : null;
}

/** Years at which road surfaces, markings or bridge materials change appearance (see `roadStyle`, bridges and lanes). */
export const ERA_YEARS = [1926, 1935, 1950, 1960, 1970];
export const eraOf = year => ERA_YEARS.filter(y => year >= y).length;

/**
 * Everything year-dependent about the static road geometry a chunk owns, as a string: the era, the wet flag, each owned
 * edge's `roadKey` (class, width, open/closed) and each owned junction's type. Two years give the same string exactly
 * when `buildChunkRoads` would produce the same mesh, so the renderer rebuilds a chunk's roads only when it changes.
 */
export function chunkRoadSignature(world, chunk, year, wet = false) {
    const graph = world.graph;
    const parts = [eraOf(year), wet ? 'w' : 'd'];
    const nodes = new Set();
    for (const id of chunk.edges) {
        const e = graph.edges[id];
        nodes.add(e.a);
        nodes.add(e.b);
        if (edgeWindows(e, chunk).length) parts.push(`${id}=${roadKey(e, year)}`);
    }
    for (const id of nodes) {
        const n = graph.nodes[id];
        if (inside(chunk, n.x, n.y) && n.edges.length >= 3) {
            parts.push(`n${id}=${junctionType(n, year)}:${n.edges.filter(eid => edgeOpen(graph.edges[eid], year)).length >= 3 ? 1 : 0}`);
        }
    }
    return parts.join('|');
}
