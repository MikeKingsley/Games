// Shared drawing helpers: extruded prisms with back-face culling and simple sun shading, cached colour shades.
import { toScreen, depth } from './projection.js';

const SUN = { x: -0.55, y: -0.83 }; // light from the north-west (world space)
const shadeCache = new Map();

function parse(hex) {
    const h = hex.replace('#', '');
    const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
    return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
}

/** A colour lightened (f > 1) or darkened (f < 1). Cached, so it's cheap to call per frame. */
export function shade(hex, f) {
    const q = Math.round(f * 20) / 20;
    const key = hex + q;
    let out = shadeCache.get(key);
    if (!out) {
        const [r, g, b] = parse(hex);
        const c = v => Math.max(0, Math.min(255, Math.round(q >= 1 ? v + (255 - v) * (q - 1) : v * q)));
        out = `rgb(${c(r)},${c(g)},${c(b)})`;
        if (shadeCache.size > 4000) shadeCache.clear();
        shadeCache.set(key, out);
    }
    return out;
}

const base = Array.from({ length: 16 }, () => ({ x: 0, y: 0 }));
const roof = Array.from({ length: 16 }, () => ({ x: 0, y: 0 }));

/**
 * Draws a vertical prism: polygon `pts` (flat array [x0, y0, x1, y1, ...], any winding, up to 16 points)
 * from height z0 to z1. Walls facing away from the viewer are skipped; the rest are shaded by the sun.
 * `top` may be null to skip the roof (e.g. when a pitched roof is drawn instead).
 */
export function prism(ctx, p, pts, z0, z1, side, top, light = 1) {
    const n = pts.length / 2;
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) {
        toScreen(p, pts[2 * i], pts[2 * i + 1], z0, base[i]);
        toScreen(p, pts[2 * i], pts[2 * i + 1], z1, roof[i]);
        cx += pts[2 * i]; cy += pts[2 * i + 1];
    }
    cx /= n; cy /= n;
    if (z1 > z0) {
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const ex = pts[2 * j] - pts[2 * i], ey = pts[2 * j + 1] - pts[2 * i + 1];
            let nx = ey, ny = -ex;
            const mx = (pts[2 * i] + pts[2 * j]) / 2 - cx, my = (pts[2 * i + 1] + pts[2 * j + 1]) / 2 - cy;
            if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
            // visible when the wall's normal points down the screen (toward the viewer)
            if (-nx * p.sin + ny * p.cos <= 0) continue;
            const len = Math.hypot(nx, ny) || 1;
            const lit = 0.72 + 0.28 * ((nx * SUN.x + ny * SUN.y) / len);
            ctx.fillStyle = shade(side, lit * light);
            ctx.beginPath();
            ctx.moveTo(base[i].x, base[i].y); ctx.lineTo(base[j].x, base[j].y);
            ctx.lineTo(roof[j].x, roof[j].y); ctx.lineTo(roof[i].x, roof[i].y);
            ctx.fill();
        }
    }
    if (top) {
        ctx.fillStyle = light === 1 ? top : shade(top, light);
        ctx.beginPath();
        ctx.moveTo(roof[0].x, roof[0].y);
        for (let i = 1; i < n; i++) ctx.lineTo(roof[i].x, roof[i].y);
        ctx.fill();
    }
}

/** Fills a flat polygon on the ground (z) — roads, fields, shadows. */
export function ground(ctx, p, pts, fill, z = 0) {
    const n = pts.length / 2;
    const s = base[0];
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        toScreen(p, pts[2 * i], pts[2 * i + 1], z, s);
        if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y);
    }
    ctx.fill();
}

/** Rectangle corners as a flat array: centre (x, y), length along `angle`, width across it. */
export function rect(x, y, length, width, angle, out = new Array(8)) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const hl = length / 2, hw = width / 2;
    out[0] = x + hl * c - hw * s; out[1] = y + hl * s + hw * c;
    out[2] = x + hl * c + hw * s; out[3] = y + hl * s - hw * c;
    out[4] = x - hl * c + hw * s; out[5] = y - hl * s - hw * c;
    out[6] = x - hl * c - hw * s; out[7] = y - hl * s + hw * c;
    return out;
}

export { depth };
