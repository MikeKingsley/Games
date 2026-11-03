// Era styling: street furniture and details that change by decade (1910s-20s, 30s-40s, 50s-60s, 70s-80s, 90s+).
// Road surfaces and markings are in draw-road.js (roadStyle) and traffic styles in traffic.js.
import { toScreen } from './projection.js';
import { prism, rect, shade } from './shapes.js';

/** 0: 1910s-20s, 1: 1930s-40s, 2: 1950s-60s, 3: 1970s-80s, 4: 1990s on. */
export const eraOf = year => (year < 1930 ? 0 : year < 1950 ? 1 : year < 1970 ? 2 : year < 1990 ? 3 : 4);

const tmp = new Array(8);
const A = { x: 0, y: 0 }, B = { x: 0, y: 0 };

/**
 * A street lamp: a short cast-iron gas lamp (to the 1940s), a concrete swan-neck (1950s-80s) or a slim steel
 * column (1990s on). `lit` draws the glow at night.
 */
export function drawLamp(ctx, p, lamp, year, light = 1, lit = false) {
    const era = eraOf(year);
    const h = era <= 1 ? 3.6 : era <= 3 ? 7.5 : 8;
    const colour = era <= 1 ? '#2f3a2f' : era <= 3 ? '#b8b3a6' : '#8d9399';
    const base = toScreen(p, lamp.x, lamp.y, 0, A);
    const top = toScreen(p, lamp.x, lamp.y, h, B);
    ctx.strokeStyle = shade(colour, light);
    ctx.lineWidth = Math.max(1, p.zoom * (era <= 1 ? 0.16 : 0.2));
    ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y);
    let hx = top.x, hy = top.y;
    if (era >= 2) {
        // the arm reaches out over the road
        const arm = toScreen(p, lamp.x + Math.cos(lamp.angle) * 1.4, lamp.y + Math.sin(lamp.angle) * 1.4, h - 0.2, A);
        ctx.lineTo(arm.x, arm.y);
        hx = arm.x; hy = arm.y;
    }
    ctx.stroke();
    const r = Math.max(1.5, p.zoom * (era <= 1 ? 0.28 : 0.22));
    if (lit) {
        const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 7);
        const tint = era <= 1 ? '255,214,140' : era <= 3 ? '255,170,70' : '235,240,255';
        glow.addColorStop(0, `rgba(${tint},0.55)`);
        glow.addColorStop(1, `rgba(${tint},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(hx, hy, r * 7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = lit ? (era <= 1 ? '#ffe2a0' : era <= 3 ? '#ffb347' : '#f4f8ff') : shade(era <= 1 ? '#c9c2a0' : '#d9d6cc', light);
    ctx.beginPath(); ctx.arc(hx, hy, r, 0, Math.PI * 2); ctx.fill();
}

/** A signpost: a white finger post before 1965, a Worboys-style green (primary) or white sign after. */
export function drawSign(ctx, p, sign, year, light = 1) {
    if (year < 1965) {
        const base = toScreen(p, sign.x, sign.y, 0, A);
        const top = toScreen(p, sign.x, sign.y, 2.8, B);
        ctx.strokeStyle = shade('#ece8dc', light);
        ctx.lineWidth = Math.max(1, p.zoom * 0.14);
        ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y); ctx.stroke();
        for (const a of [sign.angle + 0.9, sign.angle - 0.9, sign.angle + Math.PI]) {
            const end = toScreen(p, sign.x + Math.cos(a) * 0.9, sign.y + Math.sin(a) * 0.9, 2.5, A);
            ctx.lineWidth = Math.max(1, p.zoom * 0.18);
            ctx.beginPath(); ctx.moveTo(top.x, top.y + p.zoom * 0.2); ctx.lineTo(end.x, end.y); ctx.stroke();
        }
        return;
    }
    const c = Math.cos(sign.angle + Math.PI / 2), s = Math.sin(sign.angle + Math.PI / 2);
    for (const side of [-0.9, 0.9]) {
        const b = toScreen(p, sign.x + c * side, sign.y + s * side, 0, A), t = toScreen(p, sign.x + c * side, sign.y + s * side, 1.2, B);
        ctx.strokeStyle = shade('#777', light);
        ctx.lineWidth = Math.max(1, p.zoom * 0.08);
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
    }
    prism(ctx, p, rect(sign.x, sign.y, 0.12, 2.4, sign.angle, tmp), 1.2, 2.8, '#1f6b3a', '#e8e8e8', light);
}

/** Traffic signals on two corners of a junction, showing which way has green. */
export function drawSignals(ctx, p, node, phase, light = 1) {
    for (const k of [0, 1, 2, 3]) {
        const a = (k * Math.PI) / 2 + Math.PI / 4;
        const x = node.x + Math.cos(a) * 6.5, y = node.y + Math.sin(a) * 6.5;
        const base = toScreen(p, x, y, 0, A), top = toScreen(p, x, y, 3, B);
        ctx.strokeStyle = shade('#2b2b2b', light);
        ctx.lineWidth = Math.max(1, p.zoom * 0.14);
        ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y); ctx.stroke();
        // facing traffic on the matching axis: east-west heads on corners 0/2, north-south on 1/3
        const green = (k % 2) === phase;
        ctx.fillStyle = '#111';
        ctx.fillRect(top.x - p.zoom * 0.18, top.y - p.zoom * 0.1, p.zoom * 0.36, p.zoom * 0.9);
        ctx.fillStyle = green ? '#3cff6a' : '#ff3b2f';
        ctx.beginPath(); ctx.arc(top.x, top.y + (green ? p.zoom * 0.65 : p.zoom * 0.15), Math.max(1.2, p.zoom * 0.12), 0, Math.PI * 2); ctx.fill();
    }
}

/** Shopfront fascia colours by era: painted dark colours early on, brighter plastic signs later. */
export function fasciaColour(b, year) {
    const h = [...b.id].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const eras = [
        ['#1f3d2b', '#5a1f24', '#2b2b3d', '#3d2b1f'],
        ['#1f3d2b', '#5a1f24', '#2b3d4f', '#4f3d1f', '#2f2f2f'],
        ['#c33', '#2f6fb3', '#e8b33d', '#2d8a4a', '#d8d0b8'],
        ['#e05a2a', '#2a8ad0', '#f2c230', '#8a2ad0', '#2ab07a'],
        ['#e8e8e8', '#1d1d1f', '#c8102e', '#0057b8', '#00843d'],
    ][eraOf(year)];
    return eras[h % eras.length];
}
