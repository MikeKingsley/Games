// Pure road, junction, bridge and yard mesh data for the WebGL renderer (no DOM, no GL). Roads are ribbons laid along
// the graded centreline (`edge.z`, from world/terrain.js): kerb strip, surface, then markings, each a hair above the
// last (the renderer adds a polygon offset for distance). Everything is built per edge or node and depends on the year
// only through `roadKey(edge, year)`, so an era change rebuilds just the edges whose key changed.
import { createBuilder, addStrip, compose, layerRanks } from './meshes.js';
import { CHUNK_SIZE } from '../../config.js';
import { edgeClass, edgeOpen, edgeWidth, ROAD_CLASS, LANE_WIDTH } from '../../world/roadgraph.js';
import { laneProfile } from '../../world/lane-profile.js';
import { layoutJunction, junctionSignature, trimFor, edgeSpline } from '../../world/junction-layout.js';
import { roadHeightAt, groundZ } from '../../world/terrain.js';
import { waterAt } from '../../world/region.js';
import { closestOnPoly } from '../../world/geom.js';
import { sampleEven, sampleAdaptive } from '../../world/road-spline.js';
import { roadStyle, offsetPolyline } from '../draw-road.js';
import { BRIDGE, addDeck, addTunnel, deckRuns, tunnelRuns } from './structure-mesh.js';

const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const dim = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/**
 * Heights above the graded surface for each layer, metres: distinct, 2 cm apart, so no two stacked layers share a height.
 * Each also draws as its own layer (`LAYER_ORDER`, bottom first, numbered from 1), which the renderer gives a polygon offset
 * of its own: a height step alone is smaller than the depth buffer's resolution at range.
 */
export const LAYER = { kerb: 0.04, surface: 0.06, junction: 0.08, reservation: 0.1, marking: 0.12, pavement: 0.14 };
export const LAYER_ORDER = Object.keys(LAYER).sort((a, c) => LAYER[a] - LAYER[c]);
LAYER_ORDER.forEach((k, i) => layerRanks.set(LAYER[k], i + 1));
/** Sample spacing along an edge, metres. */
export const STEP = 4;

export { BRIDGE };
export const MARK = { yard: hex('#a49d8d'), yardLine: hex('#f2efe4'), bay: hex('#f2b33d'), practice: hex('#b9b5ab'), quay: hex('#a7a196') };

/** Colours for a year (matches `roadStyle` in draw-road.js), as 0..1 triples. */
export function roadColours(year, wet = false) {
    const s = roadStyle(year);
    const k = wet ? 0.72 : 1;
    return {
        surface: dim(hex(s.surface), k), kerb: hex(s.kerb), centre: s.centre ? hex(s.centre) : null, edge: s.edge ? hex(s.edge) : null,
        lane: dim(hex(year < 1960 ? '#a89a78' : s.surface), k), access: dim(hex('#8e887c'), k),
        reservation: { dual: hex('#6d8a50'), M: hex('#5f7d46') },
        // flagstones before 1950, tarmac and concrete slabs after; a grassy verge strip on rural roads
        pavement: dim(hex(year < 1950 ? '#aaa597' : '#8f8c86'), k), verge: dim(hex('#7d8f5a'), k),
    };
}

/** What an edge looks like in a year: its class and width, plus whether it exists. Rebuild its mesh when this changes. */
export function roadKey(edge, year) {
    if (!edgeOpen(edge, year)) return 'closed';
    // the lane profile (lanes, markings, passing places, pavements) is part of the key: it changes with the year
    const p = laneProfile(edge, year, edge.profile);
    const pp = Array.isArray(p.passingPlaces) ? p.passingPlaces.join(',') : +!!p.passingPlaces;
    const prof = `${p.lanesFwd}${p.lanesBack}${+p.centreLine}${+p.edgeLines}${+p.pavements.left}${+p.pavements.right}${pp}`;
    return `${edgeClass(edge, year)}:${edgeWidth(edge, year)}:${prof}`;
}

/** The edge's spline (shared with the junction layout, so arms and strips follow the same curve). */
const splineOf = edgeSpline;

/**
 * Points along an edge's graded centreline, from the `a` end to the `b` end: [{x, y, z, d, tx, ty}]. The line is a spline
 * through the edge's points (not their chords) and `tx, ty` its unit tangent, so strips offset along the spline normal
 * and bends stay smooth. Without a `step` the spacing is adaptive (about 1 m on bends up to STEP m on straights, chord error 0.02 m so a bend turns under 5 degrees per sample down to a 30 m radius); with
 * one it is even. `d` is the distance along the edge's own polyline (what `roadHeightAt`, trims and windows use).
 */
export function edgeSamples(edge, step, { minStep = 1, maxStep = STEP, tol = 0.02 } = {}) {
    const spl = splineOf(edge);
    if (!spl) return [];
    const raw = step ? sampleEven(spl, step) : sampleAdaptive(spl, { minStep, maxStep, tol });
    const k = edge.len / (spl.length || 1);
    return raw.map(p => { const d = Math.min(edge.len, p.s * k); return { x: p.x, y: p.y, z: roadHeightAt(edge, d), d, tx: p.tx, ty: p.ty }; });
}

/** The edge's samples, computed once (the grading is final by the time anything is drawn). */
const samplesOf = edge => (edge._smp ??= edgeSamples(edge));

/**
 * Detail levels of a road mesh (the corridor LOD, see chunk-build.js): 2 full (pavements, zebras, piers, abutments,
 * embankments, junction pavements and island trees), 1 basic (markings, parapets and kerbs, no pavements or supports) and
 * 0 coarse (surface and kerb on every second sample, plain decks, junction fans). `true`/`false` are 2/0 for old callers.
 */
export const DETAIL = { coarse: 0, basic: 1, full: 2 };
const levelOf = detail => (detail === true || detail === undefined ? DETAIL.full : detail === false ? DETAIL.coarse : detail);

/** The coarse variant: the spline sampled at 2 to 8 m (a looser chord tolerance), keeping both ends. */
const coarseSamplesOf = edge => (edge._smpC ??= edgeSamples(edge, 0, { minStep: 2, maxStep: 2 * STEP, tol: 0.15 }));

/** The samples moved `off` m to the right of travel along the spline normal (not per chord); the tangent carries over. */
const offsetSamples = (pts, off) => {
    if (pts.some(p => p.tx === undefined)) {
        const flat = [];
        for (const p of pts) flat.push(p.x, p.y);
        const o = offsetPolyline(flat, off);
        return pts.map((p, i) => ({ x: o[2 * i], y: o[2 * i + 1], z: p.z }));
    }
    return pts.map(p => ({ x: p.x + p.ty * off, y: p.y - p.tx * off, z: p.z, tx: p.tx, ty: p.ty }));
};

/** Samples of [d0, d1] only, with interpolated end points (fewer than two when the range is empty). */
function trimSamples(samples, d0, d1) {
    if (d1 - d0 < 1) return [];
    const out = [];
    const at = (a, c, d) => {
        const f = (d - a.d) / (c.d - a.d || 1), out = { x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f, z: a.z + (c.z - a.z) * f, d };
        if (a.tx !== undefined) { const tx = a.tx + (c.tx - a.tx) * f, ty = a.ty + (c.ty - a.ty) * f, l = Math.hypot(tx, ty) || 1; out.tx = tx / l; out.ty = ty / l; }
        return out;
    };
    for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i], c = samples[i + 1];
        if (c.d <= d0 || a.d >= d1) continue;
        if (!out.length) out.push(a.d >= d0 ? a : at(a, c, d0));
        out.push(c.d <= d1 ? c : at(a, c, d1));
    }
    return out;
}

/** True if (x, y) lies on the carriageway of an open road other than `except` (pavements and kerbs never run over one). */
function onOtherRoad(graph, year, x, y, except = null) {
    for (const sg of graph.index.near(x, y, 12)) {
        const e = graph.edges[sg.edge];
        if (e === except || e.cls === 'ferry' || !edgeOpen(e, year)) continue;
        if (closestOnPoly(e.pts, x, y).d < edgeWidth(e, year) / 2 - 0.3) return true;
    }
    return false;
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

/** Dashes of `dash` m every `dash + gap` m (metres along the spline samples), as short strips into a builder. */
function dashes(b, pts, width, colour, bias, dash = 3, gap = 6) {
    let carry = 0, on = true;
    let run = [pts[0]];
    const lerp = (a, c, f) => {
        const o = { x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f, z: a.z + (c.z - a.z) * f };
        if (a.tx !== undefined && c.tx !== undefined) { const tx = a.tx + (c.tx - a.tx) * f, ty = a.ty + (c.ty - a.ty) * f, l = Math.hypot(tx, ty) || 1; o.tx = tx / l; o.ty = ty / l; }
        return o;
    };
    const flush = () => { if (run.length >= 2) addStrip(b, run, width, undefined, colour, { bias }); run = []; };
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], c = pts[i];
        const len = Math.hypot(c.x - a.x, c.y - a.y);
        let t = 0;
        while (t < len) {
            const room = (on ? dash : gap) - carry, take = Math.min(room, len - t);
            const f1 = (t + take) / len;
            if (on) {
                if (!run.length) { const f0 = t / len; run.push(lerp(a, c, f0)); }
                run.push(lerp(a, c, f1));
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
export function buildEdgeMesh(world, edge, year, { wet = false, detail = true, window = null, into = null } = {}) {
    if (!edgeOpen(edge, year) || !edge.z) return null;
    const level = levelOf(detail);
    const region = world.region;
    const cls = edgeClass(edge, year), width = edgeWidth(edge, year);
    const col = roadColours(year, wet);
    const all = level === DETAIL.coarse ? coarseSamplesOf(edge) : samplesOf(edge);
    // the strips start and end where the junction layouts at either end hand over to the road (`trimFor`)
    const g = world.graph, tA = trimFor(g, edge, 'a', year), tB = trimFor(g, edge, 'b', year);
    const samples = trimSamples(all, Math.max(tA, window ? window[0] : 0), Math.min(edge.len - tB, window ? window[1] : edge.len));
    if (samples.length < 2) return null;
    const b = into ?? createBuilder();
    const first = b.vertexCount;
    const done = () => (into ? (b.vertexCount > first ? into : null) : b.finish());
    const surface = edge.cls === 'lane' ? col.lane : edge.cls === 'access' ? col.access : col.surface;
    // bridge decks and tunnels: the stretches that touch this window (the parts outside it belong to another chunk)
    const near_ = ([t0, t1]) => !window || (t1 + 60 > window[0] && t0 - 60 < window[1]);
    const decks = deckRuns(edge).filter(near_), tunnels = tunnelRuns(edge).filter(near_);
    const helpers = { trimSamples, offsetSamples };
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
        return b.vertexCount > first ? done() : null;
    }
    addStrip(b, samples, width + 1.6, undefined, col.kerb, { bias: LAYER.kerb });
    addStrip(b, samples, width, undefined, surface, { bias: LAYER.surface });
    // the lane profile (world/lane-profile.js; a greybox spec may set `edge.profile` to override fields) says which sides get
    // pavements, whether there is a centre line, edge lines, passing places and lane dividers
    const prof = laneProfile(edge, year, edge.profile);
    const spec = !!edge.profile;
    // (rural dual carriageways keep their grassy verge: the profile's default is none there)
    const sides = { ...prof.pavements };
    if (!spec && cls === 'dual' && !edge.town) sides.left = sides.right = true;
    if (level >= DETAIL.full && (sides.left || sides.right) && !edge.bridge && !edge.tunnel) {
        // pavements (town streets and roads) or a grassy verge (country roads) beside the kerb, stopping at the junction surfaces
        const ps = samples;
        if (ps.length >= 2) {
            const town = !!edge.town && !edge.link;
            const off = width / 2 + 0.8 + (town ? 0.6 : 0.7), w = town ? 1.2 : 1.4;
            // traffic keeps left: the left of travel is the -1 offset side
            for (const side of [1, -1]) {
                if (!(side < 0 ? sides.left : sides.right)) continue;
                // the ends beside a junction can swing over a neighbouring road: the strip stops before it
                let run = offsetSamples(ps, side * off);
                while (run.length > 1 && onOtherRoad(g, year, run[0].x, run[0].y, edge)) run = run.slice(1);
                while (run.length > 1 && onOtherRoad(g, year, run[run.length - 1].x, run[run.length - 1].y, edge)) run = run.slice(0, -1);
                if (run.length >= 2) addStrip(b, run, w, undefined, town ? col.pavement : col.verge, { bias: town ? LAYER.pavement : LAYER.kerb });
            }
        }
    }
    // passing places on single-track roads: bays on the left verge (metres along the edge); the edge line breaks across them
    // (bays keep clear of the junction mouths at either end)
    const bays = prof.singleTrack && level >= DETAIL.basic
        ? passingBays(edge, prof.passingPlaces).filter(([d0, d1]) => d0 >= samples[0].d + 2 && d1 <= samples[samples.length - 1].d - 2)
        : [];
    for (const [d0, d1] of bays) {
        const part = trimSamples(samples, d0, d1);
        if (part.length >= 2) addStrip(b, offsetSamples(part, -(width / 2 + BAY_W / 2 - 0.4)), BAY_W, undefined, surface, { bias: LAYER.surface });
    }
    // lanes and yard accesses are unmarked unless a spec gives them a profile
    if ((cls !== 'lane' && cls !== 'access') || spec) {
        // markings run to the junction surfaces at either end
        const ms = samples;
        const edgeLine = side => {
            const pts = offsetSamples(ms, side * (width / 2 - (cls === 'dual' || cls === 'M' ? 0.4 : 0.35)));
            if (side > 0 || !bays.length) return addStrip(b, pts, 0.15, undefined, col.edge, { bias: LAYER.marking });
            let at = ms[0].d;
            const gaps = [];
            for (const [d0, d1] of bays) { if (d0 > at) gaps.push([at, d0]); at = Math.max(at, d1); }
            gaps.push([at, ms[ms.length - 1].d]);
            for (const [d0, d1] of gaps) {
                const run = trimSamples(ms, d0, d1);
                if (run.length >= 2) addStrip(b, offsetSamples(run, side * (width / 2 - 0.35)), 0.15, undefined, col.edge, { bias: LAYER.marking });
            }
        };
        if (cls === 'dual' || cls === 'M') {
            const lanes = ROAD_CLASS[cls].lanes, median = width - 2 * lanes * LANE_WIDTH;
            if (median > 0) addStrip(b, ms, median, undefined, col.reservation[cls], { bias: LAYER.reservation });
            if (level >= DETAIL.basic && col.centre) {
                const off = width / 2 - LANE_WIDTH;
                dashes(b, offsetSamples(ms, off), 0.2, col.centre, LAYER.marking);
                dashes(b, offsetSamples(ms, -off), 0.2, col.centre, LAYER.marking);
            }
            if (level >= DETAIL.basic && col.edge && prof.edgeLines) for (const side of [1, -1]) edgeLine(side);
        } else {
            const centre = prof.centreLine || (!spec && edge.dual && !edge.oneway && !prof.singleTrack);
            if (level >= DETAIL.basic && col.centre && centre && (cls !== 'street' || year >= 1935)) centreLine(b, ms, cls, year, col);
            // lane dividers: dashes between the lanes of multi-lane roads (a solid line where the two directions meet)
            const lanes = prof.lanesFwd + prof.lanesBack;
            if (level >= DETAIL.basic && col.centre && (lanes > 2 || (prof.lanesBack === 0 && lanes >= 2)) && (cls !== 'street' || year >= 1935)) {
                const lw = width / lanes;
                for (let k = 1; k < lanes; k++) {
                    const pts = offsetSamples(ms, -width / 2 + k * lw); // from the left (-1) edge
                    if (prof.lanesBack > 0 && k === prof.lanesFwd) addStrip(b, pts, 0.15, undefined, col.centre, { bias: LAYER.marking });
                    else dashes(b, pts, 0.15, col.centre, LAYER.marking);
                }
            }
            if (level >= DETAIL.basic && col.edge && prof.edgeLines) for (const side of [1, -1]) edgeLine(side);
        }
    }
    if (level >= DETAIL.full && year >= 1950 && col.centre) addZebra(b, edge, width, window, tA, tB);
    for (const [t0, t1] of decks) addDeck(b, helpers, world, edge, all, t0, t1, width, year, window, tA, tB, level);
    if (level >= DETAIL.basic) for (const [t0, t1] of tunnels) addTunnel(b, helpers, world, edge, all, t0, t1, width, year, window, tA, tB);
    return done();
}

const BAY_W = 2.6, BAY_LEN = 12;
/** Passing-place bays [d0, d1] along an edge: explicit positions (metres) from the profile, or about 100 m apart on edges over 150 m. */
function passingBays(edge, places) {
    let at = Array.isArray(places) ? places : [];
    if (places === true && edge.len > 150) {
        const n = Math.max(1, Math.floor(edge.len / 100));
        at = Array.from({ length: n }, (_, k) => ((k + 0.5) * edge.len) / n);
    }
    return at.map(d => [d - BAY_LEN / 2, d + BAY_LEN / 2]);
}

/**
 * The centre line: dashes on straights; on the bends of A and B roads from 1960 a solid double white line (no
 * overtaking). A bend is a run of samples whose heading turns more than BEND rad per STEP m.
 */
const BEND = 0.1;
function centreLine(b, ms, cls, year, col) {
    if (!(year >= 1960 && (cls === 'A' || cls === 'B'))) return dashes(b, ms, 0.2, col.centre, LAYER.marking);
    const turn = i => {
        if (i <= 0 || i >= ms.length - 1) return 0;
        const a1 = Math.atan2(ms[i].y - ms[i - 1].y, ms[i].x - ms[i - 1].x), a2 = Math.atan2(ms[i + 1].y - ms[i].y, ms[i + 1].x - ms[i].x);
        // the turn per STEP m (samples are 1 to 4 m apart on the spline), so the threshold keeps its meaning in metres
        const chord = (Math.hypot(ms[i].x - ms[i - 1].x, ms[i].y - ms[i - 1].y) + Math.hypot(ms[i + 1].x - ms[i].x, ms[i + 1].y - ms[i].y)) / 2;
        return Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1))) * (STEP / Math.max(chord, 0.5));
    };
    const bend = ms.map((_, i) => turn(i) > BEND || turn(i - 1) > BEND || turn(i + 1) > BEND);
    let i = 0;
    while (i < ms.length - 1) {
        let j = i;
        while (j < ms.length - 1 && bend[j] === bend[i]) j++;
        const run = ms.slice(i, Math.min(ms.length, j + 1));
        if (run.length >= 2) {
            if (bend[i]) for (const side of [0.15, -0.15]) addStrip(b, offsetSamples(run, side), 0.12, undefined, col.centre, { bias: LAYER.marking });
            else dashes(b, run, 0.2, col.centre, LAYER.marking);
        }
        i = Math.max(j, i + 1);
    }
}

/** A zebra crossing across the middle of some long town streets from 1950: eight bars across the carriageway. */
function addZebra(b, edge, width, window, tA, tB) {
    if (!edge.town || edge.link || edge.oneway || edge.bridge || edge.tunnel || (edge.cls !== 'street' && edge.cls !== 'B') || edge.len < 50) return;
    if ((edge.id * 2654435761 >>> 0) % 5 !== 0) return;
    const d = edge.len / 2;
    if (d < tA + 5 || d > edge.len - tB - 5) return;
    if (window && !(d >= window[0] && d < window[1])) return;
    const spl = splineOf(edge);
    if (!spl) return;
    const p = spl.at(Math.min(spl.length, (d * spl.length) / edge.len)); // (the spline's own point and tangent, so the bars follow a bend)
    const z = roadHeightAt(edge, d), nx = p.ty, ny = -p.tx, tx = p.tx, ty = p.ty;
    const half = width / 2 - 0.4, white = hex('#f4f4f0');
    for (let k = -4; k < 4; k++) {
        const c = { x: p.x + tx * (k + 0.5) * 1.0, y: p.y + ty * (k + 0.5) * 1.0 };
        addStrip(b, [{ x: c.x + nx * half, y: c.y + ny * half, z }, { x: c.x - nx * half, y: c.y - ny * half, z }], 0.5, undefined, white, { bias: LAYER.marking });
    }
}

// ---- junctions ---------------------------------------------------------------------------------------------------
// A junction's surface is the layout's `boundary` (world/junction-layout.js) fanned from the node: the edge strips stop at
// the layout's trims, so nothing overlaps. A kerb band and a pavement (or verge) band follow the boundary except across
// the arm mouths, where the edge strips' own kerbs and pavements carry on.

/** Height of a junction vertex: an arm's mouth corner takes that arm's height exactly, the rest blend the mouths and the node (inverse distance). */
function junctionHeights(node, lay) {
    const pts = [{ x: node.x, y: node.y, z: node.z }];
    const corners = [];
    for (const a of lay.arms) {
        const e = a.edge, z = roadHeightAt(e, a.end === 'a' ? a.trim : e.len - a.trim);
        pts.push({ x: a.mouth.x, y: a.mouth.y, z });
        corners.push({ x: a.mL.x, y: a.mL.y, z }, { x: a.mR.x, y: a.mR.y, z });
    }
    return (x, y) => {
        for (const c of corners) if (Math.abs(c.x - x) < 1e-6 && Math.abs(c.y - y) < 1e-6) return c.z;
        let w = 0, s = 0;
        for (const p of pts) { const k = 1 / ((p.x - x) ** 2 + (p.y - y) ** 2 + 0.25); w += k; s += k * p.z; }
        return s / w;
    };
}

/** True when the boundary segment p -> q is an arm mouth (across the carriageway), where the road strips take over. */
function isMouth(lay, p, q) {
    const near = (u, v) => Math.abs(u.x - v.x) < 1e-6 && Math.abs(u.y - v.y) < 1e-6;
    return lay.arms.some(a => (near(p, a.mL) && near(q, a.mR)) || (near(p, a.mR) && near(q, a.mL)));
}

/**
 * Adds a band along the non-mouth boundary segments, from `o0` to `o1` metres outside the boundary, at the vertex heights
 * plus `bias`. Offsets at a vertex follow the mean of its two kerb normals (a mouth end keeps its single kerb's normal).
 */
function addBand(b, verts, mouth, o0, o1, colour, bias, minLen = 1e-4, blocked = null) {
    const n = verts.length;
    let area = 0;
    for (let i = 0; i < n; i++) { const p = verts[i], q = verts[(i + 1) % n]; area += p.x * q.y - q.x * p.y; }
    const sgn = area >= 0 ? 1 : -1; // the outward normal of p -> q is (dy, -dx) for a counterclockwise polygon
    const seg = verts.map((p, i) => {
        const q = verts[(i + 1) % n], dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1;
        return { nx: sgn * dy / l, ny: -sgn * dx / l, len: l };
    });
    const at = (i, o) => {
        const sp = mouth[(i - 1 + n) % n] ? null : seg[(i - 1 + n) % n], sn = mouth[i] ? null : seg[i];
        let nx = 0, ny = 0, k = 1;
        if (sp && sn) {
            nx = sp.nx + sn.nx; ny = sp.ny + sn.ny;
            const l = Math.hypot(nx, ny);
            if (l < 1e-6) { nx = sn.nx; ny = sn.ny; } else { nx /= l; ny /= l; k = Math.min(2.5, 1 / Math.max(0.4, nx * sn.nx + ny * sn.ny)); }
        } else if (sn || sp) { nx = (sn ?? sp).nx; ny = (sn ?? sp).ny; }
        return { x: verts[i].x + nx * o * k, y: verts[i].y + ny * o * k, z: verts[i].z + bias };
    };
    const v = pt => b.vertex(pt.x, pt.y, pt.z, 0, 0, 1, colour[0], colour[1], colour[2]);
    const layer0 = b.layer;
    b.layer = layerRanks.get(bias) ?? layer0;
    for (let i = 0; i < n; i++) {
        if (mouth[i] || seg[i].len < minLen) continue;
        const j = (i + 1) % n;
        const p0 = at(i, o0), p1 = at(j, o0), q0 = at(i, o1), q1 = at(j, o1);
        // a band that would lie on another road's carriageway (tight corners, a neighbour close by) is left out
        if (blocked && (blocked(q0.x, q0.y) || blocked(q1.x, q1.y) || blocked((q0.x + q1.x) / 2, (q0.y + q1.y) / 2) || blocked(p0.x, p0.y) || blocked(p1.x, p1.y))) continue;
        const a0 = v(p0), a1 = v(p1), c0 = v(q0), c1 = v(q1);
        b.tri(a0, a1, c0);
        b.tri(a1, c1, c0);
    }
    b.layer = layer0;
}

/**
 * A junction surface from the layout (plain junctions, mini-roundabouts and roundabouts): the boundary polygon fanned from
 * the node, kerb and pavement bands, stop and give-way lines, a roundabout's raised island with a tree on the bigger ones,
 * splitter islands and a mini-roundabout's disc. Null for nodes with fewer than three open roads (the edge strips run
 * through) and for dead ends.
 */
export function buildNodeMesh(world, node, year, { wet = false, detail = true, into = null } = {}) {
    const graph = world.graph;
    const level = levelOf(detail);
    if (node.z === undefined || node.edges.length < 3) return null;
    const lay = layoutJunction(graph, node, year);
    if ((lay.kind !== 'plain' && lay.kind !== 'mini' && lay.kind !== 'roundabout') || lay.boundary.length < 3) return null;
    const col = roadColours(year, wet);
    const widest = lay.arms.reduce((p, q) => (q.hw > p.hw ? q : p));
    const surface = widest.edge.cls === 'lane' ? col.lane : widest.edge.cls === 'access' ? col.access : col.surface;
    const b = into ?? createBuilder();
    const zAt = junctionHeights(node, lay);
    // a hull fallback (short edges, neighbours close by) can cut across an arm's mouth, leaving the road strip lying on the
    // surface: such junctions are drawn as the mouths joined in order instead, which keeps every mouth on the border
    const outline = lay.stats.hull ? lay.arms.flatMap(a => [a.mR, a.mL]) : lay.boundary;
    const verts = outline.map(p => ({ x: p.x, y: p.y, z: zAt(p.x, p.y) }));
    const n = verts.length;
    // the surface: a fan from the node over the boundary (star-shaped about it), at the carriageway height
    const v = (x, y, z, c) => b.vertex(x, y, z + LAYER.junction, 0, 0, 1, c[0], c[1], c[2]);
    b.layer = layerRanks.get(LAYER.junction);
    const c0 = v(node.x, node.y, node.z, surface);
    const idx = verts.map(p => v(p.x, p.y, p.z, surface));
    for (let i = 0; i < n; i++) b.tri(c0, idx[i], idx[(i + 1) % n]);
    b.layer = 0;
    const mouth = verts.map((p, i) => isMouth(lay, p, verts[(i + 1) % n]));
    // kerb, then pavement (town streets) or verge beside it, as the edge strips have
    const blocked = (x, y) => onOtherRoad(graph, year, x, y);
    if (level >= DETAIL.basic) addBand(b, verts, mouth, 0, 0.8, col.kerb, LAYER.kerb, 1e-4, blocked);
    const wide = lay.arms.filter(a => a.cls !== 'lane' && a.cls !== 'access' && a.cls !== 'M' && !a.edge.bridge && !a.edge.tunnel);
    // (no pavement round a hull or mouths-only outline: the corners there are too tight to hold one without crossing a neighbour)
    if (level >= DETAIL.full && wide.length && !lay.stats.hull) {
        const town = wide.some(a => a.edge.town && !a.edge.link);
        addBand(b, verts, mouth, 0.8, town ? 2.0 : 2.2, town ? col.pavement : col.verge, town ? LAYER.pavement : LAYER.kerb, 2.5, blocked);
    }
    const grey = hex('#8d8b84'), greyTop = hex('#9a9890');
    const zc = node.z + LAYER.junction;
    for (const isl of lay.islands) {
        const cx = isl.poly.reduce((s, p) => s + p.x, 0) / isl.poly.length, cy = isl.poly.reduce((s, p) => s + p.y, 0) / isl.poly.length;
        if (isl.kind === 'island') {
            const r = Math.hypot(isl.poly[0].x - cx, isl.poly[0].y - cy);
            const seg = level >= DETAIL.basic ? 32 : 12;
            compose.cylinder(b, cx, cy, zc, r, 0.18, seg, grey);
            compose.cylinder(b, cx, cy, zc + 0.16, Math.max(0.5, r - 0.6), 0.1, seg, hex('#6f9a4a'));
            if (r >= 6 && level >= DETAIL.full) {
                compose.cylinder(b, cx, cy, zc + 0.26, 0.22, 2.2, 6, hex('#5b4630'));
                compose.cylinder(b, cx, cy, zc + 1.8, 1.7, 3.0, 8, hex('#4a7a3a'), { radiusTop: 0.2 });
            }
        } else if (level < DETAIL.basic) {
            continue; // (splitter islands and the mini-roundabout's disc are too small to see from the far side of the corridor)
        } else if (isl.kind === 'splitter') {
            compose.prism(b, isl.poly, 0.12, grey, { z0: zAt(cx, cy) + LAYER.surface, roofColor: greyTop });
        } else {
            compose.prism(b, isl.poly, 0.07, hex('#d9d6cb'), { z0: zc, roofColor: hex('#e8e6dc') });
        }
    }
    if (level >= DETAIL.basic) addStopLines(b, lay, col, zAt);
    if (level >= DETAIL.basic && lay.kind === 'roundabout' && year >= 1960 && col.centre && lay.ring.width >= 8.5) {
        // lane dividers round the bigger rings
        const ring = Array.from({ length: 49 }, (_, k) => ({ x: node.x + Math.cos((k * Math.PI * 2) / 48) * lay.ring.rc, y: node.y + Math.sin((k * Math.PI * 2) / 48) * lay.ring.rc, z: zc }));
        dashes(b, ring, 0.2, col.centre, LAYER.marking);
    }
    return into ?? b.finish();
}

/** The layout's stop and give-way lines: solid across the lane at signals (from 1935), dashed give-way lines (from 1960). */
function addStopLines(b, lay, col, zAt) {
    if (!col.centre) return;
    for (const s of lay.stopLines) {
        const a = lay.arms[s.arm], e = a.edge;
        const z = lay.kind === 'roundabout' ? zAt((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2) : roadHeightAt(e, a.end === 'a' ? a.trim + 0.4 : e.len - a.trim - 0.4);
        const line = [{ x: s.x0, y: s.y0, z }, { x: s.x1, y: s.y1, z }];
        if (s.kind === 'stop') addStrip(b, line, 0.35, undefined, col.centre, { bias: LAYER.marking });
        else {
            dashes(b, line, 0.3, col.centre, LAYER.marking, 0.6, 0.4);
            // the give-way triangle on plain junctions: apex towards the approaching driver, base just behind the line (plan 0011 phase 5)
            if (lay.kind === 'roundabout') continue;
            const tx = Math.cos(s.angle), ty = Math.sin(s.angle), nx = -ty, ny = tx;
            const hw = Math.min(0.9, Math.hypot(s.x1 - s.x0, s.y1 - s.y0) * 0.3);
            const P = [{ x: s.x - tx * 1.2 + nx * hw, y: s.y - ty * 1.2 + ny * hw, z }, { x: s.x - tx * 1.2 - nx * hw, y: s.y - ty * 1.2 - ny * hw, z }, { x: s.x - tx * 4.2, y: s.y - ty * 4.2, z }];
            for (let i = 0; i < 3; i++) addStrip(b, [P[i], P[(i + 1) % 3]], 0.2, undefined, col.centre, { bias: LAYER.marking });
        }
    }
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
    const graph = world.graph;
    // one builder for the whole chunk: every edge, junction and yard writes straight into it (no per-part meshes to merge)
    const b = createBuilder();
    const nodes = new Set();
    for (const id of chunk.edges) {
        const e = graph.edges[id];
        nodes.add(e.a);
        nodes.add(e.b);
        const windows = edgeWindows(e, chunk);
        if (!windows.length) continue;
        if (keys) keys[id] = roadKey(e, year);
        for (const window of windows) buildEdgeMesh(world, e, year, { wet, detail, window, into: b });
    }
    for (const id of nodes) {
        const n = graph.nodes[id];
        if (!inside(chunk, n.x, n.y)) continue;
        buildNodeMesh(world, n, year, { wet, detail, into: b });
    }
    for (const owner of world.yards) {
        const z = owner.yard.zone;
        if (!inside(chunk, z.x, z.y)) continue;
        b.append(buildYardMesh(world, owner.yard));
        b.append(buildBayMesh(world, owner.yard.marker));
    }
    const pz = world.practice?.yard.zone;
    if (pz && inside(chunk, pz.x, pz.y)) b.append(buildPracticeMesh(world, world.practice));
    for (const h of world.harbours ?? []) if (inside(chunk, h.quay.x, h.quay.y)) b.append(buildQuayMesh(world, h));
    return b.vertexCount ? b.finish() : null;
}

/** Years at which road surfaces, markings or bridge materials change appearance (see `roadStyle`, bridges and lanes). */
export const ERA_YEARS = [1926, 1935, 1950, 1960, 1970];
export const eraOf = year => ERA_YEARS.filter(y => year >= y).length;

/**
 * Everything year-dependent about the static road geometry a chunk owns, as a string: the era, the wet flag, each owned
 * edge's `roadKey` (class, width, open/closed) with the trims its junctions give it, and each owned junction's layout
 * signature (open arms, type, markings, neighbour budget). Two years give the same string exactly when `buildChunkRoads`
 * would produce the same mesh, so the renderer rebuilds a chunk's roads only when it changes.
 */
export function chunkRoadSignature(world, chunk, year, wet = false) {
    const graph = world.graph;
    const parts = [eraOf(year), wet ? 'w' : 'd'];
    const nodes = new Set();
    for (const id of chunk.edges) {
        const e = graph.edges[id];
        nodes.add(e.a);
        nodes.add(e.b);
        if (edgeWindows(e, chunk).length) {
            const open = edgeOpen(e, year);
            parts.push(open ? `${id}=${roadKey(e, year)}:${trimFor(graph, e, 'a', year).toFixed(1)}:${trimFor(graph, e, 'b', year).toFixed(1)}` : `${id}=${roadKey(e, year)}`);
        }
    }
    for (const id of nodes) {
        const n = graph.nodes[id];
        if (inside(chunk, n.x, n.y) && n.edges.length >= 3) parts.push(`n${junctionSignature(graph, n, year)}`);
    }
    return parts.join('|');
}
