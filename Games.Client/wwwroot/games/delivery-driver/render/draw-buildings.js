// Extruded buildings with pitched or flat roofs, church towers, tanks, spoil heaps, pens and log stacks;
// trees and granite tors. Drawn in screen space (after depth sorting with the vehicles).
import { toScreen } from './projection.js';
import { prism, rect, shade, ground } from './shapes.js';
import { fasciaColour, eraOf } from './era.js';

const tmp = new Array(8);
const A = { x: 0, y: 0 }, B = { x: 0, y: 0 }, C = { x: 0, y: 0 }, D = { x: 0, y: 0 }, E = { x: 0, y: 0 }, F = { x: 0, y: 0 };

/** Is a wall with outward normal (nx, ny) facing the viewer? */
const facing = (p, nx, ny) => -nx * p.sin + ny * p.cos > 0;

export function drawBuilding(ctx, p, b, light = 1, detail = true, year = 1919) {
    switch (b.shape) {
        case 'tank': return drawTank(ctx, p, b, light);
        case 'heap': return drawHeap(ctx, p, b, light);
        case 'pit': return ground(ctx, p, rect(b.x, b.y, b.len, b.dep, b.angle, tmp), shade(b.wall, 0.75 * light));
        case 'pens': return drawPens(ctx, p, b, light);
        case 'logs': return prism(ctx, p, rect(b.x, b.y, b.len, b.dep, b.angle, tmp), 0, b.h, b.wall, shade(b.wall, 1.15), light);
        case 'pumps': return drawPumps(ctx, p, b, light, year);
        default: break;
    }
    const wall = b.wall ?? '#ddd';
    const roofCol = b.roofCol ?? '#555';
    if (b.roof === 'flat') {
        prism(ctx, p, rect(b.x, b.y, b.len, b.dep, b.angle, tmp), 0, b.h, wall, shade(roofCol, 1.05), light);
    } else {
        pitched(ctx, p, b.x, b.y, b.len, b.dep, b.angle, b.h, b.dep * 0.32, wall, roofCol, light);
    }
    if (detail && p.zoom > 7) windows(ctx, p, b, light, year);
    if (detail && (b.type === 'shop' || b.type === 'pub') && p.zoom > 5) fascia(ctx, p, b, light, year);
    if (b.tower) {
        const c = Math.cos(b.angle), s = Math.sin(b.angle);
        const tx = b.x - c * (b.len / 2 - 2.6), ty = b.y - s * (b.len / 2 - 2.6);
        prism(ctx, p, rect(tx, ty, 5.2, 5.2, b.angle, tmp), 0, b.h + 9, wall, shade(wall, 0.9), light);
    }
}

/**
 * A gabled building: walls to the eaves at height h, a ridge along the length at h + rise.
 * Back roof slope first, then gables, then the front slope, so the near slope covers the far one.
 */
function pitched(ctx, p, x, y, len, dep, angle, h, rise, wall, roofCol, light) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const hl = len / 2, hd = dep / 2;
    prism(ctx, p, rect(x, y, len, dep, angle, tmp), 0, h, wall, null, light);
    // eaves corners and ridge ends
    const corner = (u, v, z, out) => toScreen(p, x + u * c - v * s, y + u * s + v * c, z, out);
    const ridge0 = corner(-hl, 0, h + rise, E), ridge1 = corner(hl, 0, h + rise, F);
    const slopes = [1, -1].map(v => ({ v, front: facing(p, -s * v, c * v) }));
    slopes.sort((a, b) => a.front - b.front);
    for (const { v, front } of slopes) {
        if (front) {
            // gable ends facing the viewer go under the near slope
            for (const u of [-1, 1]) {
                if (!facing(p, c * u, s * u)) continue;
                corner(u * hl, hd, h, A); corner(u * hl, -hd, h, B);
                const r = u > 0 ? ridge1 : ridge0;
                ctx.fillStyle = shade(wall, (u > 0 ? 0.92 : 0.82) * light);
                ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(r.x, r.y); ctx.fill();
            }
        }
        corner(-hl - 0.3, v * (hd + 0.3), h - 0.2, A); corner(hl + 0.3, v * (hd + 0.3), h - 0.2, B);
        const lit = front ? 1.08 : 0.85;
        ctx.fillStyle = shade(roofCol, lit * light);
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(ridge1.x, ridge1.y); ctx.lineTo(ridge0.x, ridge0.y); ctx.fill();
    }
}

/** A painted (later, plastic) fascia board along the street side of a shop or pub at first-floor level. */
function fascia(ctx, p, b, light, year) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    const side = b.side ?? 1;
    // the street side: the door is on the side facing the road the building was placed along
    const nx = s * side, ny = -c * side;
    if (-nx * p.sin + ny * p.cos <= 0) return;
    const ox = b.x + nx * (b.dep / 2 + 0.03), oy = b.y + ny * (b.dep / 2 + 0.03);
    const hl = b.len / 2 - 0.3;
    toScreen(p, ox - c * hl, oy - s * hl, 2.6, A); toScreen(p, ox + c * hl, oy + s * hl, 2.6, B);
    toScreen(p, ox + c * hl, oy + s * hl, 3.3, C); toScreen(p, ox - c * hl, oy - s * hl, 3.3, D);
    ctx.fillStyle = shade(fasciaColour(b, year), light);
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(C.x, C.y); ctx.lineTo(D.x, D.y); ctx.fill();
}

/** Windows on the long walls facing the viewer (and a door on houses). */
function windows(ctx, p, b, light, year = 1919) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    const storeys = Math.max(1, Math.floor(b.h / 3));
    const lit = light < 0.6;
    // later decades: bigger panes, lighter frames; at night about two windows in three are lit
    const dark = shade(eraOf(year) >= 3 ? '#5a6c78' : '#3c4a55', light);
    const seed = [...b.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 3);
    ctx.fillStyle = lit ? '#ffd98a' : dark;
    for (const v of [1, -1]) {
        const nx = -s * v, ny = c * v;
        if (!facing(p, nx, ny)) continue;
        const n = Math.max(1, Math.floor(b.len / 3.2));
        for (let k = 0; k < n; k++) {
            const u = -b.len / 2 + (k + 0.5) * (b.len / n);
            for (let f = 0; f < storeys; f++) {
                const z0 = 0.9 + f * 3, z1 = z0 + 1.3;
                const wx = b.x + u * c + nx * (b.dep / 2 + 0.02), wy = b.y + u * s + ny * (b.dep / 2 + 0.02);
                toScreen(p, wx - c * 0.55, wy - s * 0.55, z0, A);
                toScreen(p, wx + c * 0.55, wy + s * 0.55, z0, B);
                toScreen(p, wx + c * 0.55, wy + s * 0.55, z1, C);
                toScreen(p, wx - c * 0.55, wy - s * 0.55, z1, D);
                if (lit) ctx.fillStyle = (seed + k * 7 + f * 13) % 3 ? '#ffd98a' : dark;
                ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(C.x, C.y); ctx.lineTo(D.x, D.y); ctx.fill();
            }
        }
    }
}

const OCT = Array.from({ length: 8 }, (_, k) => [Math.cos((k / 8) * Math.PI * 2), Math.sin((k / 8) * Math.PI * 2)]);
const octPts = new Array(16);

function drawTank(ctx, p, b, light) {
    const r = Math.min(b.len, b.dep) / 2;
    for (let k = 0; k < 8; k++) { octPts[2 * k] = b.x + OCT[k][0] * r; octPts[2 * k + 1] = b.y + OCT[k][1] * r; }
    prism(ctx, p, octPts, 0, b.h, b.wall, shade(b.wall, 1.12), light);
}

function drawHeap(ctx, p, b, light) {
    // a six-sided spoil heap (the white "Cornish Alps" of the clay country)
    const r = Math.min(b.len, b.dep) / 2;
    const apex = toScreen(p, b.x, b.y, b.h, E);
    const faces = [];
    for (let k = 0; k < 6; k++) {
        const a0 = (k / 6) * Math.PI * 2, a1 = ((k + 1) / 6) * Math.PI * 2;
        const am = (a0 + a1) / 2;
        faces.push({ a0, a1, front: facing(p, Math.cos(am), Math.sin(am)), lit: 0.8 + 0.25 * Math.cos(am + 2.2) });
    }
    faces.sort((a, b) => a.front - b.front);
    for (const f of faces) {
        toScreen(p, b.x + Math.cos(f.a0) * r, b.y + Math.sin(f.a0) * r, 0, A);
        toScreen(p, b.x + Math.cos(f.a1) * r, b.y + Math.sin(f.a1) * r, 0, B);
        ctx.fillStyle = shade(b.wall, f.lit * light);
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(apex.x, apex.y); ctx.fill();
    }
}

function drawPens(ctx, p, b, light) {
    ground(ctx, p, rect(b.x, b.y, b.len, b.dep, b.angle, tmp), shade('#9c8a6a', light));
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    for (let k = 0; k <= 4; k++) {
        const u = -b.len / 2 + (k / 4) * b.len;
        prism(ctx, p, rect(b.x + u * c, b.y + u * s, 0.3, b.dep, b.angle, tmp), 0, b.h, b.wall, shade(b.wall, 1.1), light);
    }
}

/**
 * Fuel pumps on their island: tall hand-cranked pumps with globes before the war, squat electric pumps after,
 * and a canopy over the forecourt from the 1960s.
 */
function drawPumps(ctx, p, b, light, year) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    prism(ctx, p, rect(b.x, b.y, b.len, b.dep, b.angle, tmp), 0, 0.2, '#9a958a', '#b3ada0', light);
    const old = year < 1950;
    for (const u of [-1.8, 0, 1.8]) {
        const x = b.x + c * u, y = b.y + s * u;
        prism(ctx, p, rect(x, y, 0.55, 0.55, b.angle, tmp), 0.2, old ? 2.6 : 1.7, old ? '#b33' : year < 1980 ? '#e8e2d0' : '#2f6fb3', old ? '#d44' : '#f3efe6', light);
        if (old) { const g = toScreen(p, x, y, 2.9, A); ctx.fillStyle = shade('#f4ead0', light); ctx.beginPath(); ctx.arc(g.x, g.y, Math.max(2, p.zoom * 0.28), 0, Math.PI * 2); ctx.fill(); }
    }
    if (year >= 1960) prism(ctx, p, rect(b.x, b.y, b.len + 4, 6, b.angle, tmp), 4.2, 4.7, '#e8e2d0', year < 1990 ? '#c33' : '#f2f2f0', light);
}

/** A tree: shadow on the ground, trunk, and a canopy (round broadleaf or a conifer cone) at height. */
export function drawTree(ctx, p, t, light = 1) {
    const g = toScreen(p, t.x, t.y, 0, A);
    const top = toScreen(p, t.x, t.y, t.h, B);
    const r = t.r * p.zoom;
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(g.x + r * 0.35, g.y + r * 0.2, r, r * p.tilt, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = shade('#5a4632', light);
    ctx.lineWidth = Math.max(1, p.zoom * 0.35);
    ctx.beginPath(); ctx.moveTo(g.x, g.y); ctx.lineTo(top.x, top.y + r * 0.4); ctx.stroke();
    if (t.kind === 'conifer') {
        ctx.fillStyle = shade('#2f5a34', (0.85 + t.tone * 0.25) * light);
        ctx.beginPath();
        ctx.moveTo(top.x, top.y - r * 1.2);
        ctx.lineTo(top.x + r * 0.75, top.y + r * 0.9);
        ctx.lineTo(top.x - r * 0.75, top.y + r * 0.9);
        ctx.fill();
    } else {
        ctx.fillStyle = shade('#4c7a36', (0.8 + t.tone * 0.3) * light);
        ctx.beginPath(); ctx.arc(top.x, top.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = shade('#6a9a48', (0.85 + t.tone * 0.25) * light);
        ctx.beginPath(); ctx.arc(top.x - r * 0.3, top.y - r * 0.3, r * 0.55, 0, Math.PI * 2); ctx.fill();
    }
}

export function drawRock(ctx, p, r, light = 1) {
    if (r.boat) return drawBoat(ctx, p, r, light);
    const c = r.colour ?? '#8f8c85';
    prism(ctx, p, rect(r.x, r.y, r.len, r.dep, r.angle, tmp), 0, r.h, c, shade(c, 1.15), light);
}

/** A moored fishing boat: hull, deck and a little wheelhouse. */
function drawBoat(ctx, p, b, light) {
    prism(ctx, p, rect(b.x, b.y, b.len, b.dep, b.angle, tmp), -0.2, b.h, b.colour, '#c9b48a', light);
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    prism(ctx, p, rect(b.x - c * b.len * 0.15, b.y - s * b.len * 0.15, b.len * 0.28, b.dep * 0.6, b.angle, tmp), b.h, b.h + 1.3, '#e8e2d0', '#d8d0bc', light);
}

/** A traffic cone (lying on its side once knocked over). */
export function drawCone(ctx, p, cone) {
    const g = toScreen(p, cone.x, cone.y, 0, A);
    const r = Math.max(2, p.zoom * 0.3);
    ctx.fillStyle = '#f26b1d';
    if (cone.knocked) {
        ctx.beginPath(); ctx.ellipse(g.x, g.y, r * 1.6, r * 0.6, 0.6, 0, Math.PI * 2); ctx.fill();
        return;
    }
    const t = toScreen(p, cone.x, cone.y, 0.75, B);
    ctx.beginPath(); ctx.moveTo(g.x - r, g.y); ctx.lineTo(g.x + r, g.y); ctx.lineTo(t.x, t.y); ctx.fill();
    ctx.fillStyle = '#f4f4f0';
    ctx.fillRect(g.x - r * 0.45, (g.y + t.y) / 2 - r * 0.15, r * 0.9, r * 0.3);
}
