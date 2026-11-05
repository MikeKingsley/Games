// Pure ground mesh data for the WebGL renderer (no DOM, no GL): a chunk's terrain with vertex colours baked from its
// land use, its sea and river water, the coast surf, and a coarse far-field mesh for the whole region.
//
// The ground is built from the chunk's height grid (`chunk.terrain`, 17 x 17 samples every 10 m), one flat-coloured
// cell at a time so field edges stay crisp: each cell has its own four vertices (positions on the shared grid, so
// neighbouring cells and chunks meet exactly) with smooth normals from the height grid.
import { createBuilder, extrudeStrip, mergeMeshes } from './meshes.js';
import { GRID_N, gridHeight, terrainHeight, waterLevel, roadDeckNear, tunnelFloorNear } from '../../world/terrain.js';
import { moorAt } from '../../world/region.js';
import { CHUNK_SIZE } from '../../config.js';

const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

// Same palette as the Canvas renderer's draw-terrain.js (kept as hex there for the 2D context).
export const GROUND = {
    sea: hex('#2d5d82'), seaFloor: hex('#3b6a7e'), land: hex('#6b8f4e'), moor: hex('#8f8a5c'), river: hex('#3a6d93'),
    riverBed: hex('#5d6a5a'), town: hex('#8a9278'), sand: hex('#d9c58f'), cliff: hex('#7d7466'), rock: hex('#7a7468'),
    surf: hex('#a9c9dc'), heather: hex('#7a5f6e'), gorse: hex('#b9a23c'), hedge: hex('#3f5f2c'),
};
const FIELD_COLOURS = new Map();
const fieldColour = c => FIELD_COLOURS.get(c) ?? (FIELD_COLOURS.set(c, hex(c)), FIELD_COLOURS.get(c));

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
/** Deterministic 0..1 hash of a position (so the baked texture noise never changes between rebuilds). */
const hash = (x, y) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };

/** How far under a road's deck the ground mesh is held beside it, metres (the road ribbons sit 0.04-0.1 m above the deck). */
const ROAD_SINK = 0.15;
/** How far beside a tunnel's carriageway edge the ground is cut down to the road, metres (a little more than the walls and the grid's half cell). */
const TUNNEL_CUT = 5.5;

/** Water surface tint used for both the sea and rivers is set by the shader; these are the vertex colours. */
export const WATER_ALPHA = 0.78;

/** Coast segments with their cliff/beach class (same rule as the Canvas renderer), built once per region. */
export function coastParts(region) {
    if (region._glCoast) return region._glCoast;
    const c = region.coast, parts = [];
    const northY = region.project(50.75, -4).y;
    for (let i = 0; i < c.length - 2; i += 2) {
        const ax = c[i], ay = c[i + 1], bx = c[i + 2], by = c[i + 3];
        if (ax > region.bounds.maxX - 5 && bx > region.bounds.maxX - 5) continue; // the open eastern edge
        const north = (ay + by) / 2 < northY;
        const h = Math.abs(Math.sin(ax * 12.9898 + ay * 78.233)) % 1;
        parts.push({ ax, ay, bx, by, mx: (ax + bx) / 2, my: (ay + by) / 2, cliff: north ? h < 0.75 : h < 0.4 });
    }
    return (region._glCoast = parts);
}

function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function inQuad(q, x, y) {
    let inside = false;
    for (let i = 0, j = q.length - 2; i < q.length; j = i, i += 2) {
        if ((q[i + 1] > y) !== (q[j + 1] > y) && x < ((q[j] - q[i]) * (y - q[i + 1])) / (q[j + 1] - q[i + 1]) + q[i]) inside = !inside;
    }
    return inside;
}

function edgeDistance(q, x, y) {
    let d = Infinity;
    for (let i = 0; i < q.length; i += 2) {
        const k = (i + 2) % q.length;
        d = Math.min(d, distToSegment(x, y, q[i], q[i + 1], q[k], q[k + 1]));
    }
    return d;
}

/** The coast parts, rivers' chunk assignment and nearby towns for one chunk (padded so cliffs near the edge classify right). */
function chunkContext(region, chunk) {
    const pad = 40, x0 = chunk.x0 - pad, y0 = chunk.y0 - pad, x1 = chunk.x0 + CHUNK_SIZE + pad, y1 = chunk.y0 + CHUNK_SIZE + pad;
    const coast = coastParts(region).filter(p => Math.max(p.ax, p.bx) >= x0 && Math.min(p.ax, p.bx) <= x1 && Math.max(p.ay, p.by) >= y0 && Math.min(p.ay, p.by) <= y1);
    const towns = region.towns.filter(t => Math.hypot(t.x - (chunk.x0 + CHUNK_SIZE / 2), t.y - (chunk.y0 + CHUNK_SIZE / 2)) < t.radius * 1.1 + CHUNK_SIZE);
    return { coast, towns };
}

/** The ground colour for a cell centre; `slope` is rise per metre, `z` the height there. */
function cellColour(region, chunk, ctx, x, y, z, slope) {
    const n = hash(x, y);
    if (z < -0.15) return scale(GROUND.seaFloor, 0.75 + 0.35 * Math.min(1, -z / 12));
    // coast: beach or cliff next to the shoreline
    let nearCliff = false, nearBeach = false;
    for (const p of ctx.coast) {
        const d = distToSegment(x, y, p.ax, p.ay, p.bx, p.by);
        if (d < (p.cliff ? 7 : 13)) { if (p.cliff) nearCliff = true; else nearBeach = true; }
    }
    if (nearBeach && slope < 0.4) return scale(GROUND.sand, 0.93 + 0.1 * n);
    if (nearCliff || slope > 0.55) return scale(mix(GROUND.cliff, GROUND.rock, n), 0.9 + 0.2 * n);
    const wl = waterLevel(region, x, y);
    if (wl !== null && z < wl + 0.25) return GROUND.riverBed;
    let base;
    let inTown = false;
    for (const t of ctx.towns) if (Math.hypot(x - t.x, y - t.y) < t.radius * 0.98) { inTown = true; break; }
    if (inTown) return scale(GROUND.town, 0.94 + 0.1 * n);
    if (chunk.moor || moorAt(region, x, y)) {
        base = GROUND.moor;
        for (const p of chunk.patches ?? []) {
            const c = Math.cos(p.a), s = Math.sin(p.a), dx = x - p.x, dy = y - p.y;
            const u = (dx * c + dy * s) / p.rx, v = (-dx * s + dy * c) / p.ry;
            if (u * u + v * v < 1) { base = mix(base, p.gorse ? GROUND.gorse : GROUND.heather, 0.55); break; }
        }
        return scale(base, 0.9 + 0.2 * n + Math.min(0.12, Math.max(0, z - 20) * 0.004));
    }
    base = GROUND.land;
    let hedge = Infinity;
    for (const f of chunk.fields) {
        if (inQuad(f.pts, x, y)) { base = fieldColour(f.colour); hedge = Math.min(hedge, edgeDistance(f.pts, x, y)); break; }
    }
    if (hedge < 5) base = mix(base, GROUND.hedge, 0.28 * (1 - hedge / 5));
    return scale(base, 0.95 + 0.1 * n);
}

/**
 * Meshes for one chunk. `lod` 0 uses every height sample (16 x 16 cells of 10 m), 1 uses every fourth (4 x 4 cells of
 * 40 m) for chunks far from the camera. Returns `{ ground, water, surf }` (water/surf are null when the chunk has none):
 * - `ground`: opaque terrain, vertex colours from the land use;
 * - `water`: translucent sea cells at z = 0 and river strips at each river's own level;
 * - `surf`: the pale foam line along the shore, just above sea level.
 */
export function buildChunkMesh(world, chunk, { lod = 0 } = {}) {
    const region = world.region, grid = chunk.terrain;
    const stride = lod === 0 ? 1 : 4, cells = (GRID_N - 1) / stride, span = grid.step * stride;
    const ctx = chunkContext(region, chunk);
    const ground = createBuilder(), sea = createBuilder();
    // Cells are flat-shaded chords between grid heights, so beside a cutting (or on 40 m cells) they can rise above a
    // road's deck and hide it. Heights near a road are capped just under its deck; the road mesh sits on top.
    const sunk = new Map();
    const heightAt = (gi, gj) => {
        const z = grid.z[gj * GRID_N + gi];
        if (!world.graph || z < 0) return z;
        const key = gj * GRID_N + gi;
        let v = sunk.get(key);
        if (v === undefined) {
            const deck = roadDeckNear(world, grid.x0 + gi * grid.step, grid.y0 + gj * grid.step, span * 1.45);
            v = deck === null ? z : Math.min(z, deck - ROAD_SINK);
            // a tunnel is a covered cutting: the hill is cut down to the road beside and over it (full detail only; far chunks keep the hill)
            if (stride === 1) {
                const floor = tunnelFloorNear(world, grid.x0 + gi * grid.step, grid.y0 + gj * grid.step, TUNNEL_CUT);
                // (a tunnel under the sea level, such as a drowned crossing, stays buried: cutting it would flood the cutting)
                if (floor !== null && floor > 0.3) v = Math.min(v, floor - ROAD_SINK);
            }
            sunk.set(key, v);
        }
        return v;
    };
    const node = (i, j) => {
        const gi = Math.min(GRID_N - 1, Math.max(0, i * stride)), gj = Math.min(GRID_N - 1, Math.max(0, j * stride));
        return heightAt(gi, gj);
    };
    const normalAt = (i, j, out) => {
        const gx = (node(Math.min(cells, i + 1), j) - node(Math.max(0, i - 1), j)) / (span * (Math.min(cells, i + 1) - Math.max(0, i - 1)));
        const gy = (node(i, Math.min(cells, j + 1)) - node(i, Math.max(0, j - 1))) / (span * (Math.min(cells, j + 1) - Math.max(0, j - 1)));
        const inv = 1 / Math.hypot(gx, gy, 1);
        out[0] = -gx * inv; out[1] = -gy * inv; out[2] = inv;
    };
    const nrm = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let j = 0; j < cells; j++) {
        for (let i = 0; i < cells; i++) {
            const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
            const zs = corners.map(([a, b]) => node(a, b));
            const x = grid.x0 + (i + 0.5) * span, y = grid.y0 + (j + 0.5) * span;
            const zc = (zs[0] + zs[1] + zs[2] + zs[3]) / 4;
            const slope = Math.max(Math.abs(zs[1] - zs[0] + zs[2] - zs[3]), Math.abs(zs[3] - zs[0] + zs[2] - zs[1])) / (2 * span);
            const c = cellColour(region, chunk, ctx, x, y, zc, slope);
            const base = ground.vertexCount;
            corners.forEach(([a, b], k) => {
                normalAt(a, b, nrm[k]);
                ground.vertex(grid.x0 + a * span, grid.y0 + b * span, zs[k], nrm[k][0], nrm[k][1], nrm[k][2], c[0], c[1], c[2]);
            });
            ground.quad(base, base + 1, base + 2, base + 3);
            if (Math.min(...zs) < 0) {
                const s = sea.vertexCount;
                for (const [a, b] of corners) sea.vertex(grid.x0 + a * span, grid.y0 + b * span, 0, 0, 0, 1, GROUND.sea[0], GROUND.sea[1], GROUND.sea[2]);
                sea.quad(s, s + 1, s + 2, s + 3);
            }
        }
    }
    const waterParts = [];
    if (sea.vertexCount) waterParts.push(sea.finish());
    // rivers: each pair of points is cut into pieces and a piece belongs to the chunk holding its middle, so a river
    // crossing a chunk border is built once
    const inChunk = (x, y) => x >= chunk.x0 && x < chunk.x0 + CHUNK_SIZE && y >= chunk.y0 && y < chunk.y0 + CHUNK_SIZE;
    for (const r of region.rivers) {
        const pts = r.pts;
        for (let k = 0; k < pts.length - 1; k++) {
            const a = pts[k], b = pts[k + 1];
            if (Math.max(a.x, b.x) + a.w < chunk.x0 || Math.min(a.x, b.x) - a.w > chunk.x0 + CHUNK_SIZE || Math.max(a.y, b.y) + a.w < chunk.y0 || Math.min(a.y, b.y) - a.w > chunk.y0 + CHUNK_SIZE) continue;
            const len = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(len / 20));
            for (let s = 0; s < steps; s++) {
                const t0 = s / steps, t1 = (s + 1) / steps, tm = (t0 + t1) / 2;
                if (!inChunk(a.x + (b.x - a.x) * tm, a.y + (b.y - a.y) * tm)) continue;
                const p = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0, w: a.w + (b.w - a.w) * t0 };
                const q = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1, w: a.w + (b.w - a.w) * t1 };
                const level = Math.max(0, waterLevel(region, (p.x + q.x) / 2, (p.y + q.y) / 2) ?? 0);
                const piece = Math.hypot(q.x - p.x, q.y - p.y) || 1;
                waterParts.push(extrudeStrip([{ x: p.x, y: p.y, z: level }, { x: q.x, y: q.y, z: level }], d => p.w + (q.w - p.w) * (d / piece), undefined, GROUND.river, { bias: 0.02 }));
            }
        }
    }
    // surf along the shore, just above the water
    const surfParts = [];
    for (const p of ctx.coast) {
        if (!inChunk(p.mx, p.my)) continue;
        surfParts.push(extrudeStrip([{ x: p.ax, y: p.ay, z: 0.05 }, { x: p.bx, y: p.by, z: 0.05 }], p.cliff ? 7 : 14, undefined, GROUND.surf));
    }
    return {
        ground: ground.finish(),
        water: waterParts.length ? mergeMeshes(waterParts) : null,
        surf: surfParts.length ? mergeMeshes(surfParts) : null,
    };
}

/**
 * A coarse mesh of the whole region for the distance, sampled straight from `terrainHeight` (no roads or yards). The
 * land is sunk `sink` metres (the renderer also draws it without depth writes, so chunk meshes always cover it); the sea is the z = 0 plane.
 */
export function buildFarField(region, { cells = 96, sink = 0.6, margin = 4000 } = {}) {
    const b = region.bounds;
    const x0 = b.minX - margin, y0 = b.minY - margin, w = b.maxX - b.minX + margin * 2, h = b.maxY - b.minY + margin * 2;
    const dx = w / cells, dy = h / cells;
    const zs = new Float32Array((cells + 1) * (cells + 1));
    for (let j = 0; j <= cells; j++) for (let i = 0; i <= cells; i++) zs[j * (cells + 1) + i] = terrainHeight(region, x0 + i * dx, y0 + j * dy);
    const B = createBuilder(), row = cells + 1;
    const at = (i, j) => zs[Math.min(cells, Math.max(0, j)) * row + Math.min(cells, Math.max(0, i))];
    for (let j = 0; j < cells; j++) {
        for (let i = 0; i < cells; i++) {
            const idx = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
            const z = idx.map(([a, c]) => at(a, c));
            const zc = (z[0] + z[1] + z[2] + z[3]) / 4;
            const x = x0 + (i + 0.5) * dx, y = y0 + (j + 0.5) * dy;
            let c;
            if (zc <= 0.2) c = GROUND.sea;
            else c = moorAt(region, x, y) ? scale(GROUND.moor, 0.95 + Math.min(0.15, zc * 0.004)) : scale(GROUND.land, 0.95 + 0.1 * hash(x, y));
            const base = B.vertexCount;
            idx.forEach(([a, bb], k) => {
                const gx = (at(a + 1, bb) - at(a - 1, bb)) / (2 * dx), gy = (at(a, bb + 1) - at(a, bb - 1)) / (2 * dy);
                const inv = 1 / Math.hypot(gx, gy, 1);
                const flat = zc <= 0.2;
                B.vertex(x0 + a * dx, y0 + bb * dy, flat ? -0.1 : Math.max(0, z[k]) - sink, flat ? 0 : -gx * inv, flat ? 0 : -gy * inv, flat ? 1 : inv, c[0], c[1], c[2]);
            });
            B.quad(base, base + 1, base + 2, base + 3);
        }
    }
    return B.finish();
}

/** Re-exported so callers and tests agree on the grid helper the ground mesh samples. */
export { gridHeight };
