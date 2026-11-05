// Roads under the ground transform: verges/kerbs, surface, then markings, in passes so junctions blend.
// Surfaces and markings follow the era (water-bound macadam and no lines in 1919, tarmac and white lines later).
import { edgeClass, edgeOpen, edgeWidth, ROAD_CLASS, LANE_WIDTH } from '../world/roadgraph.js';
import { layoutJunction } from '../world/junction-layout.js';
import { polylinePath } from './sprite-cache.js';
import { waterAt } from '../world/region.js';
import { resample } from '../world/geom.js';

export function roadStyle(year) {
    if (year < 1926) return { surface: '#b5a685', kerb: '#8d8068', centre: null, edge: null };
    if (year < 1950) return { surface: '#6b6862', kerb: '#8b877c', centre: '#ece9df', edge: null };
    if (year < 1970) return { surface: '#5d5d5c', kerb: '#8e8b84', centre: '#f1efe8', edge: null };
    return { surface: '#545558', kerb: '#8e8c88', centre: '#f4f4f0', edge: '#f4f4f0' };
}

const pathOf = edge => (edge._path ??= polylinePath(edge.pts));

/**
 * Draws the edges listed (ids, deduplicated by the caller). `year` picks open roads, their class and the era style.
 * `detail` adds markings (skipped when zoomed far out or on the low preset).
 */
/** A ferry edge split into its land approaches (drawn as road) and the crossing (dashed), cached on the edge. */
function ferryParts(e, region) {
    if (e._ferry) return e._ferry;
    const pts = resample(e.pts, 3);
    const land = [], water = [];
    let run = null, wet = null;
    for (let i = 0; i < pts.length; i += 2) {
        const w = region ? waterAt(region, pts[i], pts[i + 1]) >= 15 : true;
        if (w !== wet) {
            if (run && run.length >= 4) (wet ? water : land).push(run);
            run = run ? [run[run.length - 2], run[run.length - 1]] : [];
            wet = w;
        }
        run.push(pts[i], pts[i + 1]);
    }
    if (run && run.length >= 4) (wet ? water : land).push(run);
    e._ferry = { land: land.map(polylinePath), water: water.map(polylinePath) };
    return e._ferry;
}

/** The stretches of a road over water (bridges), as raw polylines, cached on the edge. */
function bridgeRuns(e, region) {
    if (e._bridgeRuns) return e._bridgeRuns;
    const runs = [];
    if (region && e.cls !== 'ferry') {
        const pts = resample(e.pts, 2);
        let run = null;
        for (let i = 0; i < pts.length; i += 2) {
            if (waterAt(region, pts[i], pts[i + 1]) > 0) (run ??= []).push(pts[i], pts[i + 1]);
            else if (run) { if (run.length >= 4) runs.push(run); run = null; }
        }
        if (run && run.length >= 4) runs.push(run);
    }
    e._bridgeRuns = runs;
    return runs;
}

/** Bridges: stone (or, from 1960, concrete) parapets either side of the road where it crosses water. */
export function drawBridges(ctx, graph, edgeIds, year, region) {
    for (const id of edgeIds) {
        const e = graph.edges[id];
        if (!edgeOpen(e, year)) continue;
        const runs = bridgeRuns(e, region);
        if (!runs.length) continue;
        const half = edgeWidth(e, year) / 2 + 0.5;
        e._parapets ??= {};
        const paths = (e._parapets[half] ??= runs.flatMap(r => [polylinePath(offsetPolyline(r, half)), polylinePath(offsetPolyline(r, -half))]));
        ctx.lineCap = 'butt';
        ctx.strokeStyle = year < 1960 ? '#a59b88' : '#c4c2bb';
        ctx.lineWidth = 0.8;
        for (const p of paths) ctx.stroke(p);
        ctx.lineCap = 'round';
    }
}

export function drawRoads(ctx, graph, edgeIds, year, detail = true, region = null, wet = false) {
    const style = { ...roadStyle(year) };
    // wet roads are darker with a faint sheen down the middle
    if (wet) { style.surface = darken(style.surface); style.sheen = 'rgba(200, 215, 235, 0.12)'; }
    const list = [];
    for (const id of edgeIds) {
        const e = graph.edges[id];
        if (edgeOpen(e, year)) list.push(e);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 0. pavements beside town roads (reduced fidelity: one wide stroke under the kerb)
    if (detail) {
        ctx.strokeStyle = year < 1950 ? '#aaa597' : '#8f8c86';
        for (const e of list) {
            if (!e.town || e.link || e.bridge || e.tunnel || (e.cls !== 'street' && e.cls !== 'B' && e.cls !== 'A')) continue;
            ctx.lineWidth = edgeWidth(e, year) + 1.6 + 2.4;
            ctx.stroke(pathOf(e));
        }
    }
    // 1. kerbs/verges
    ctx.strokeStyle = style.kerb;
    for (const e of list) {
        ctx.lineWidth = edgeWidth(e, year) + 1.6;
        if (e.cls === 'ferry') for (const p of ferryParts(e, region).land) ctx.stroke(p);
        else ctx.stroke(pathOf(e));
    }
    // 2. surface
    for (const e of list) {
        ctx.strokeStyle = e.cls === 'lane' && year < 1960 ? '#a89a78' : e.cls === 'access' ? '#8e887c' : style.surface;
        ctx.lineWidth = edgeWidth(e, year);
        if (e.cls === 'ferry') for (const p of ferryParts(e, region).land) ctx.stroke(p);
        else ctx.stroke(pathOf(e));
    }
    if (style.sheen) {
        ctx.strokeStyle = style.sheen;
        for (const e of list) { if (e.cls === 'ferry') continue; ctx.lineWidth = edgeWidth(e, year) * 0.35; ctx.stroke(pathOf(e)); }
    }
    // ferry crossings: a dashed route across the water, and the slipway ends
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = '#d8e6ef';
    ctx.lineWidth = 1.2;
    for (const e of list) if (e.cls === 'ferry') for (const p of ferryParts(e, region).water) ctx.stroke(p);
    ctx.setLineDash([]);
    if (!detail) return;
    // 3. markings
    for (const e of list) {
        const cls = edgeClass(e, year);
        if (cls === 'lane' || cls === 'access' || cls === 'ferry') continue;
        const width = edgeWidth(e, year);
        if (cls === 'dual' || cls === 'M') {
            // central reservation
            ctx.strokeStyle = cls === 'M' ? '#5f7d46' : '#6d8a50';
            ctx.lineWidth = width - 2 * (ROAD_CLASS[cls].lanes * LANE_WIDTH);
            ctx.stroke(pathOf(e));
            if (style.centre) {
                // lane dividers: one lane width in from each outer edge
                const off = width / 2 - LANE_WIDTH;
                e._dividers ??= {};
                const paths = (e._dividers[cls] ??= [polylinePath(offsetPolyline(e.pts, off)), polylinePath(offsetPolyline(e.pts, -off))]);
                ctx.setLineDash([3, 6]);
                ctx.strokeStyle = style.centre;
                ctx.lineWidth = 0.15;
                ctx.stroke(paths[0]);
                ctx.stroke(paths[1]);
                ctx.setLineDash([]);
            }
        } else if (style.centre && !e.oneway && (cls !== 'street' || year >= 1935)) {
            ctx.setLineDash([3, 6]);
            ctx.strokeStyle = style.centre;
            ctx.lineWidth = 0.15;
            ctx.stroke(pathOf(e));
            ctx.setLineDash([]);
        }
    }
}

/**
 * Junction surfaces from the layout (world/junction-layout.js), kept simple: the boundary polygon in the road colour over
 * the strokes that run to the node, and a roundabout's island at its layout radius. No kerb returns beyond the polygon,
 * markings or splitters (the WebGL renderer has those).
 */
export function drawJunctions(ctx, graph, nodeIds, year) {
    const style = roadStyle(year);
    for (const id of nodeIds) {
        const n = graph.nodes[id];
        if (n.edges.length < 3) continue;
        const lay = layoutJunction(graph, n, year);
        if (lay.kind !== 'plain' && lay.kind !== 'mini' && lay.kind !== 'roundabout') continue;
        if (lay.boundary.length < 3) continue;
        const widest = lay.arms.reduce((p, q) => (q.hw > p.hw ? q : p));
        ctx.fillStyle = widest.edge.cls === 'lane' && year < 1960 ? '#a89a78' : widest.edge.cls === 'access' ? '#8e887c' : style.surface;
        ctx.beginPath();
        lay.boundary.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.fill();
        if (lay.kind === 'roundabout') {
            ctx.fillStyle = '#8d8b84';
            ctx.beginPath(); ctx.arc(n.x, n.y, lay.ring.ri, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#6f9a4a';
            ctx.beginPath(); ctx.arc(n.x, n.y, Math.max(0.5, lay.ring.ri - 1), 0, Math.PI * 2); ctx.fill();
        }
    }
}

/** A polyline shifted sideways by `off` metres (positive = left of the direction of travel). */
export function offsetPolyline(pts, off) {
    const out = [];
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
        const dx = pts[2 * b] - pts[2 * a], dy = pts[2 * b + 1] - pts[2 * a + 1];
        const len = Math.hypot(dx, dy) || 1;
        out.push(pts[2 * i] + (dy / len) * off, pts[2 * i + 1] - (dx / len) * off);
    }
    return out;
}

function darken(hex) {
    const n = parseInt(hex.slice(1), 16);
    const f = v => Math.round(v * 0.72).toString(16).padStart(2, '0');
    return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}
