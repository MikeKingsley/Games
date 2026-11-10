// Code-generated ground textures: 256 px tiles painted to a canvas from tileable noise, registered as SVG <pattern>s.
// No image files; the PNG data URLs are cached for the session so a level restart does not repaint them.
import { el } from './svg.js';
import { tileNoise, rng } from './noise.js';

const SIZE = 256;

/** name -> { tile: size of one repeat in yard units, flat: fallback colour, paint(px, size) fills ImageData rgba } */
const SPECS = {
    ballast: { tile: 3.2, flat: '#7a7064', paint: paintBallast },
    cinder: { tile: 6, flat: '#3b3835', paint: paintCinder },
    grass: { tile: 7, flat: '#4a6e34', paint: paintGrass },
    setts: { tile: 4, flat: '#6b6a66', paint: paintSetts },
    timber: { tile: 2, flat: '#5c4630', paint: paintTimber },
    coal: { tile: 2, flat: '#18181a', paint: paintCoal },
    grime: { tile: 5, flat: 'rgba(20,15,10,0.25)', paint: paintGrime },
};

const clamp = v => v < 0 ? 0 : v > 255 ? 255 : v;
function put(px, i, r, g, b, a = 255) { const k = i * 4; px[k] = clamp(r); px[k + 1] = clamp(g); px[k + 2] = clamp(b); px[k + 3] = clamp(a); }

function paintBallast(px, size) {
    const n = tileNoise(size, 101, 5), r = rng(102);
    for (let i = 0; i < size * size; i++) {
        let s = 0.7 + n[i] * 0.6; // soft mottling
        const t = r();
        if (t < 0.10) s *= 1.45; else if (t < 0.22) s *= 0.55; // light and dark stones
        put(px, i, 124 * s, 114 * s, 100 * s);
    }
}

function paintCinder(px, size) {
    const n = tileNoise(size, 201, 5), m = tileNoise(size, 202, 3), r = rng(203);
    for (let i = 0; i < size * size; i++) {
        let s = 0.7 + n[i] * 0.55;
        const t = r();
        if (t < 0.04) s *= 1.9; else if (t < 0.2) s *= 0.7;
        const tint = (m[i] - 0.5) * 18; // some rusty patches
        put(px, i, 58 * s + tint, 55 * s + tint * 0.4, 52 * s);
    }
}

function paintGrass(px, size) {
    const n = tileNoise(size, 301, 5), m = tileNoise(size, 302, 2), r = rng(303);
    for (let i = 0; i < size * size; i++) {
        const s = 0.72 + n[i] * 0.55, dry = m[i] > 0.58 ? (m[i] - 0.58) * 120 : 0; // a few dry yellow patches
        let g = 112 * s + dry * 0.5;
        if (r() < 0.12) g *= 1.2; // blade flecks
        put(px, i, 70 * s + dry, g, 48 * s);
    }
}

function paintSetts(px, size) {
    const cell = 32, rows = size / cell, r = rng(401);
    const tone = [];
    for (let i = 0; i < rows * rows; i++) tone.push(0.85 + r() * 0.3);
    const n = tileNoise(size, 402, 4);
    for (let y = 0; y < size; y++) {
        const row = Math.floor(y / cell), shift = (row % 2) * (cell / 2);
        for (let x = 0; x < size; x++) {
            const col = Math.floor(((x + shift) % size) / cell), cx = (x + shift) % cell, cy = y % cell;
            const edge = Math.min(cx, cell - 1 - cx, cy, cell - 1 - cy);
            let s = tone[row * rows + col] * (0.8 + n[y * size + x] * 0.4);
            if (edge < 2) s *= 0.45; else if (edge < 4) s *= 0.85; // dark joints, rounded tops
            put(px, y * size + x, 112 * s, 110 * s, 104 * s);
        }
    }
}

function paintTimber(px, size) {
    const n = tileNoise(size, 501, 6), r = rng(502);
    const rowGrain = new Float32Array(size);
    for (let y = 0; y < size; y++) rowGrain[y] = r();
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const g = rowGrain[y] * 0.25 + n[y * size + ((x >> 4) << 4)] * 0.3; // streaks along x
            const s = 0.75 + g + (r() - 0.5) * 0.08;
            put(px, y * size + x, 96 * s, 74 * s, 52 * s);
        }
    }
}

function paintCoal(px, size) {
    const n = tileNoise(size, 601, 5), r = rng(602);
    for (let i = 0; i < size * size; i++) {
        let s = 0.5 + n[i] * 0.9;
        if (r() < 0.05) s += 1.4; // glints
        put(px, i, 26 * s, 26 * s, 30 * s);
    }
}

function paintGrime(px, size) {
    const n = tileNoise(size, 701, 5), r = rng(702);
    const col = new Float32Array(size);
    for (let x = 0; x < size; x++) col[x] = r();
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const streak = n[y * size + x] * 0.6 + col[x] * 0.5; // vertical streaks
            const a = Math.max(0, streak - 0.62) * 420;
            put(px, y * size + x, 22, 17, 12, a);
        }
    }
}

const cache = {}; // name -> PNG data URL, or null when a 2D canvas is not available

function dataUrl(name) {
    if (name in cache) return cache[name];
    let url = null;
    try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SIZE;
        const g = canvas.getContext('2d');
        if (g) {
            const img = g.createImageData(SIZE, SIZE);
            SPECS[name].paint(img.data, SIZE);
            g.putImageData(img, 0, 0);
            url = canvas.toDataURL('image/png');
        }
    } catch { url = null; }
    cache[name] = url;
    return url;
}

/**
 * Registers every texture as an SVG <pattern> in `defs` and returns { ballast, cinder, grass, setts, timber, coal, grime }:
 * the ids to use as fill="url(#id)". Falls back to a flat colour pattern when canvas is unavailable.
 */
export function createTextures(defs) {
    const ids = {};
    for (const [name, spec] of Object.entries(SPECS)) {
        const id = `ig-tex-${name}`;
        const pat = el('pattern', { id, patternUnits: 'userSpaceOnUse', width: spec.tile, height: spec.tile }, defs);
        const url = dataUrl(name);
        if (url) el('image', { href: url, x: 0, y: 0, width: spec.tile, height: spec.tile, preserveAspectRatio: 'none' }, pat);
        else el('rect', { width: spec.tile, height: spec.tile, fill: spec.flat }, pat);
        ids[name] = id;
    }
    return ids;
}
