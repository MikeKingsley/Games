// Map rendering for the minimap and the full map. The pure half (view transform, hillshade, relief raster, road
// selection, map mesh) is testable in Node; the GL half draws it on a private WebGL2 canvas that the 2D map code
// blits onto the HUD / full-map canvas and decorates with labels and the player arrow.
import { TRIP_RATE } from '../../config.js';
import { terrainHeight } from '../../world/terrain.js';
import { edgeOpen, edgeClass } from '../../world/roadgraph.js';
import { createBuilder, addStrip } from './meshes.js';
import { createContext } from './context.js';
import { createProgram } from './program.js';
import { uploadMesh, drawMesh, deleteMesh, ATTRIB_SLOTS } from './gpu-mesh.js';

export const RANGE = 420; // world metres from the centre to the edge of the minimap
export const ROUTE_COLOUR = '#ff3fb4';
export const ROAD_COLOURS = { M: '#5aa0e0', dual: '#7fd07f', A: '#e8a33a', B: '#e6d27a', street: '#d9d4c6', lane: '#b8ad8e', access: '#b8ad8e', ferry: '#9fc6dd' };
export const SEA = [45, 93, 130];
const LAND = [91, 122, 69];
const TOWN = [133, 149, 108]; // the town disc (rgba 210,200,180 at 35%) over the lowland colour
const RIVER = [58, 109, 147];

const hexRgb = hex => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
const unit = c => [c[0] / 255, c[1] / 255, c[2] / 255];

/** Screen <-> world for a map view: (cx, cy) at the centre, `range` metres to the nearest edge, turned by `rot`. */
export function mapTransform({ w, h, cx, cy, range = RANGE, rot = 0 }) {
    const scale = Math.min(w, h) / 2 / range;
    const c = Math.cos(-rot), s = Math.sin(-rot);
    return {
        scale,
        project(x, y, out = [0, 0]) {
            const dx = (x - cx) * scale, dy = (y - cy) * scale;
            out[0] = w / 2 + dx * c - dy * s;
            out[1] = h / 2 + dx * s + dy * c;
            return out;
        },
        unproject(sx, sy, out = [0, 0]) {
            const px = sx - w / 2, py = sy - h / 2;
            out[0] = cx + (px * c + py * s) / scale;
            out[1] = cy + (-px * s + py * c) / scale;
            return out;
        },
    };
}

// ---- relief ---------------------------------------------------------------------------------------------------

const LIGHT = (() => { const l = [-0.6, -0.6, 0.55]; const n = Math.hypot(...l); return l.map(v => v / n); })();
const FLAT = LIGHT[2];

/**
 * Brightness multiplier for terrain from its neighbours' heights (west, east, north, south; `step` metres apart).
 * The light comes from the north-west, so slopes facing it are above 1 and slopes facing away are below 1.
 */
export function hillshade(zw, ze, zn, zs, step) {
    const gx = (ze - zw) / (2 * step), gy = (zs - zn) / (2 * step);
    const len = Math.hypot(gx, gy, 1);
    const d = (-gx * LIGHT[0] - gy * LIGHT[1] + LIGHT[2]) / len;
    return Math.max(0.45, Math.min(1.7, d / FLAT));
}

const SHORE = [200, 196, 150];
const MOOR = [127, 122, 82];
const ROCK = [150, 144, 128];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const ramp = (e0, e1, z) => Math.max(0, Math.min(1, (z - e0) / (e1 - e0)));

/** Hypsometric tint for the land at height `z` (world metres): shore, lowland, moor, then bare rock on the tops. */
export function hypsometric(z) {
    let c = mix(LAND, MOOR, ramp(5, 16, z));
    c = mix(c, ROCK, ramp(24, 36, z));
    return mix(SHORE, c, ramp(0, 1.2, z));
}

/** The relief colour at one point: `[r, g, b]` 0-255 (sea below zero, tinted land with hillshading above). */
export function reliefColour(region, x, y, step = 60) {
    const z = terrainHeight(region, x, y);
    if (z <= 0 && x < region.bounds.maxX - 1) return SEA;
    const shade = hillshade(terrainHeight(region, x - step, y), terrainHeight(region, x + step, y),
        terrainHeight(region, x, y - step), terrainHeight(region, x, y + step), step);
    const c = hypsometric(Math.max(z, 0.5));
    // shade lightens as well as darkens, damped so the flat lowlands keep the familiar green
    const k = 1 + (shade - 1) * 0.8;
    return [c[0] * k, c[1] * k, c[2] * k];
}

const reliefCache = new WeakMap();

/** The whole region as a coarse RGBA raster (`cell` metres per texel), built once per world. */
export function reliefRaster(world, cell = 60 * TRIP_RATE) {
    const cached = reliefCache.get(world);
    if (cached && cached.cell === cell) return cached;
    const region = world.region, b = region.bounds;
    const width = Math.ceil((b.maxX - b.minX) / cell), height = Math.ceil((b.maxY - b.minY) / cell);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
            const c = reliefColour(region, b.minX + (i + 0.5) * cell, b.minY + (j + 0.5) * cell, cell);
            const o = (j * width + i) * 4;
            data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
        }
    }
    const raster = { width, height, cell, x0: b.minX, y0: b.minY, data };
    reliefCache.set(world, raster);
    return raster;
}

// ---- roads and the map mesh -----------------------------------------------------------------------------------

/** One-way roads are drawn in a cooler tint of their class colour so they read as different from two-way ones. */
export const ONEWAY_TINT = '#8aa4c8';
export const roadColour = (edge, cls) => (edge.oneway && cls !== 'ferry' ? mixHex(ROAD_COLOURS[cls] ?? '#cccccc', ONEWAY_TINT, 0.45) : ROAD_COLOURS[cls] ?? '#cccccc');
function mixHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = sh => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
    return `#${[16, 8, 0].map(sh => ch(sh).toString(16).padStart(2, '0')).join('')}`;
}

/** Road line width in screen pixels. */
export const roadPixels = cls => (cls === 'M' || cls === 'dual' ? 3.2 : cls === 'A' ? 2.6 : cls === 'B' ? 2 : 1.4);

/** The edges a map view shows: open in `year`, near the view, and only the main roads when zoomed far out. */
export function visibleRoads(world, year, { cx, cy, range = RANGE }) {
    const r = range * 1.5;
    const big = range > 1500;
    const out = [];
    for (const id of world.graph.index.edgesIn(cx - r, cy - r, cx + r, cy + r)) {
        const e = world.graph.edges[id];
        if (!edgeOpen(e, year)) continue;
        const cls = edgeClass(e, year);
        if (big && (cls === 'street' || cls === 'lane' || cls === 'access')) continue;
        out.push({ edge: e, cls });
    }
    return out;
}

const edgePoints = (pts, out = []) => { for (let i = 0; i < pts.length; i += 2) out.push({ x: pts[i], y: pts[i + 1], z: 0 }); return out; };

function addDisc(b, x, y, radius, color, segments = 20) {
    const centre = b.vertex(x, y, 0, 0, 0, 1, color[0], color[1], color[2]);
    const ring = [];
    for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        ring.push(b.vertex(x + Math.cos(a) * radius, y + Math.sin(a) * radius, 0, 0, 0, 1, color[0], color[1], color[2]));
    }
    for (let i = 0; i < segments; i++) b.tri(centre, ring[i], ring[(i + 1) % segments]);
}

function addSquare(b, x, y, half, color) {
    const v = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => b.vertex(x + sx * half, y + sy * half, 0, 0, 0, 1, color[0], color[1], color[2]));
    b.quad(v[0], v[1], v[2], v[3]);
}

/**
 * The fixed layers of a map view: land beyond the east edge, rivers, town discs and roads, in painting order.
 * Widths are in world metres (pixels / scale), so a mesh is valid for one scale and is rebuilt when the range changes.
 */
export function buildMapMesh(world, year, { cx, cy, range = RANGE, scale }) {
    const b = createBuilder();
    const region = world.region;
    // the land east of the seed area (the Canvas map fills it the same way)
    const bx = region.bounds.maxX - 2, land = unit(LAND);
    const y0 = region.bounds.minY - 9000, y1 = region.bounds.maxY + 9000;
    const q = [[bx, y0], [bx + 60000, y0], [bx + 60000, y1], [bx, y1]].map(([x, y]) => b.vertex(x, y, 0, 0, 0, 1, land[0], land[1], land[2]));
    b.tri(q[0], q[1], q[2]); b.tri(q[0], q[2], q[3]);
    const river = unit(RIVER);
    for (const r of region.rivers) {
        for (let i = 0; i < r.pts.length - 1; i++) {
            addStrip(b, [{ x: r.pts[i].x, y: r.pts[i].y, z: 0 }, { x: r.pts[i + 1].x, y: r.pts[i + 1].y, z: 0 }], Math.max(r.pts[i].w, 2 / scale), 0, river);
        }
    }
    const town = unit(TOWN);
    for (const t of region.towns) {
        if (Math.abs(t.x - cx) > range * 1.6 + t.radius || Math.abs(t.y - cy) > range * 1.6 + t.radius) continue;
        addDisc(b, t.x, t.y, t.radius, town, 28);
    }
    for (const { edge, cls } of visibleRoads(world, year, { cx, cy, range })) {
        addStrip(b, edgePoints(edge.pts), roadPixels(cls) / scale, 0, hexRgb(roadColour(edge, cls)));
    }
    return b.finish();
}

/** The per-frame layers: the route line (outlined), its target, depots and other company vehicles. */
export function buildMapMarkers(session, { scale }) {
    const b = createBuilder();
    const world = session.world;
    const route = session.route;
    if (route?.pts.length >= 4) {
        const pts = edgePoints(route.pts);
        addStrip(b, pts, 6 / scale, 0, [0, 0, 0]);
        addStrip(b, pts, 3.6 / scale, 0, hexRgb(ROUTE_COLOUR));
        addDisc(b, route.pts[route.pts.length - 2], route.pts[route.pts.length - 1], 6 / scale, hexRgb('#ff5a3c'), 14);
    }
    for (const d of world.depots) addSquare(b, d.x, d.y, 5 / scale, hexRgb('#f2b33d'));
    for (const v of session.fleetMarkers?.() ?? []) addDisc(b, v.x, v.y, 4 / scale, hexRgb('#7fd0ff'), 10);
    return b.finish();
}

// ---- GL -------------------------------------------------------------------------------------------------------

const VERTEX = `#version 300 es
in vec3 a_pos;
in vec3 a_color;
uniform vec2 u_centre;
uniform vec4 u_view; // cos, sin of -rot, then scale / half width, scale / half height
out vec3 v_color;
void main() {
    vec2 d = a_pos.xy - u_centre;
    vec2 r = vec2(d.x * u_view.x - d.y * u_view.y, d.x * u_view.y + d.y * u_view.x);
    gl_Position = vec4(r.x * u_view.z, -r.y * u_view.w, 0.0, 1.0);
    v_color = a_color;
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec3 v_color;
uniform sampler2D u_relief;
uniform float u_textured; // 1 for the relief quad, whose colour channels carry the texture coordinates
out vec4 o_color;
void main() {
    o_color = u_textured > 0.5 ? vec4(texture(u_relief, v_color.xy).rgb, 1.0) : vec4(v_color, 1.0);
}`;

/** A private WebGL2 canvas that draws maps; `render` returns the canvas ready for `drawImage`, or null when GL is unusable. */
export function createGlMap() {
    const canvas = document.createElement('canvas');
    const gl = createContext(canvas, { antialias: true });
    if (!gl) return null;
    let prog;
    try { prog = createProgram(gl, { vertex: VERTEX, fragment: FRAGMENT }, 'map', ATTRIB_SLOTS); } catch { return null; }
    const stats = { frames: 0, draws: 0, glErrors: 0, roadBuilds: 0, triangles: 0 };
    let relief = null; // { world, texture, quad }
    let fixed = null; // the cached static layers { key, handle }

    const reliefFor = world => {
        if (relief?.world === world) return relief;
        if (relief) { gl.deleteTexture(relief.texture); deleteMesh(gl, relief.quad); }
        const r = reliefRaster(world);
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, r.width, r.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(r.data.buffer));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const b = createBuilder();
        const x1 = r.x0 + r.width * r.cell, y1 = r.y0 + r.height * r.cell;
        const v = [[r.x0, r.y0, 0, 0], [x1, r.y0, 1, 0], [x1, y1, 1, 1], [r.x0, y1, 0, 1]].map(([x, y, u, w]) => b.vertex(x, y, 0, 0, 0, 1, u, w, 0));
        b.tri(v[0], v[1], v[2]); b.tri(v[0], v[2], v[3]);
        relief = { world, texture, quad: uploadMesh(gl, b.finish()) };
        return relief;
    };

    const draw = (handle, textured) => {
        if (!handle) return;
        gl.uniform1f(prog.uniform('u_textured'), textured ? 1 : 0);
        drawMesh(gl, handle);
        stats.draws++;
        stats.triangles += handle.count / 3;
    };

    return {
        canvas,
        stats,
        get lost() { return gl.isContextLost(); },
        /** Draws the map of `session` at pixel size w x h (times dpr); the result is `canvas`. */
        render(session, { w, h, cx, cy, range = RANGE, rot = 0, dpr = 1 }) {
            if (gl.isContextLost() || !session.world) return null;
            const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
            if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
            const world = session.world;
            const scale = Math.min(w, h) / 2 / range;
            const year = session.year;
            // the static layers only depend on the year, the scale and roughly where the view is
            // the mesh is built for a range snapped to ~9% steps so a smoothly zooming minimap rebuilds it occasionally, not
            // every frame; the view uniform uses the exact scale, so road widths are only ever off by a few percent
            const meshRange = 2 ** (Math.round(Math.log2(range) * 8) / 8);
            const meshScale = Math.min(w, h) / 2 / meshRange;
            const q = Math.max(60, meshRange / 4);
            const key = `${year}|${meshRange}|${Math.min(w, h)}|${Math.round(cx / q)}|${Math.round(cy / q)}`;
            if (fixed?.key !== key) {
                deleteMesh(gl, fixed?.handle);
                fixed = { key, handle: uploadMesh(gl, buildMapMesh(world, year, { cx, cy, range: meshRange * 1.1, scale: meshScale })) };
                stats.roadBuilds++;
            }
            const markers = uploadMesh(gl, buildMapMarkers(session, { scale }));
            const rl = reliefFor(world);
            gl.viewport(0, 0, pw, ph);
            gl.clearColor(SEA[0] / 255, SEA[1] / 255, SEA[2] / 255, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.disable(gl.DEPTH_TEST);
            gl.disable(gl.CULL_FACE);
            prog.use();
            gl.uniform2f(prog.uniform('u_centre'), cx, cy);
            gl.uniform4f(prog.uniform('u_view'), Math.cos(-rot), Math.sin(-rot), scale / (w / 2), scale / (h / 2));
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, rl.texture);
            gl.uniform1i(prog.uniform('u_relief'), 0);
            draw(rl.quad, true);
            draw(fixed.handle, false);
            draw(markers, false);
            deleteMesh(gl, markers);
            stats.frames++;
            const err = gl.getError();
            if (err !== gl.NO_ERROR) stats.glErrors++;
            return canvas;
        },
        dispose() {
            if (relief) { gl.deleteTexture(relief.texture); deleteMesh(gl, relief.quad); }
            deleteMesh(gl, fixed?.handle);
            prog.dispose();
            gl.getExtension('WEBGL_lose_context')?.loseContext();
            relief = fixed = null;
        },
    };
}

let shared; // undefined: not tried yet, null: unavailable
/** The one GL map shared by the HUD minimap and the full map, created on first use. */
export function sharedGlMap() {
    if (shared?.lost) { shared.dispose(); shared = undefined; }
    if (shared === undefined) shared = createGlMap();
    return shared;
}
export function disposeSharedGlMap() { shared?.dispose(); shared = undefined; }
