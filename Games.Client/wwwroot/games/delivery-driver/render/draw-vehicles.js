// Faux-3D vehicles drawn from catalogue parameters: chassis/cab/body boxes extruded by height, wheels, lamps, livery.
import { prism, ground, rect, shade } from './shapes.js';
import { toScreen, depth } from './projection.js';

const DEFAULT_LIVERY = { livery1: '#2f5d8a', livery2: '#e8c547' };
const tmp = new Array(8);
const pt = { x: 0, y: 0 };
const order = [];
const qa = { x: 0, y: 0 }, qb = { x: 0, y: 0 }, qc = { x: 0, y: 0 }, qd = { x: 0, y: 0 };

function colour(c, livery) {
    return c === 'livery1' || c === 'livery2' ? livery[c] ?? DEFAULT_LIVERY[c] : c;
}

/**
 * Draws a rigid vehicle (or a trailer/tractor unit) at a pose. pose = {x, y, heading} of the REAR AXLE;
 * spec has length, width, rearOverhang, wheelbase and draw.parts. opts = {livery, light (0..1 night dimming), lamps, brake}.
 */
export function drawVehicle(ctx, p, spec, pose, opts = {}) {
    const livery = opts.livery ?? DEFAULT_LIVERY;
    const light = opts.light ?? 1;
    const c = Math.cos(pose.heading), s = Math.sin(pose.heading);
    const rearX = pose.x - c * spec.rearOverhang, rearY = pose.y - s * spec.rearOverhang; // back of the body
    const at = (u, out) => { out.x = rearX + c * u; out.y = rearY + s * u; return out; };
    const draw = spec.draw ?? { parts: [{ u0: 0, u1: spec.length, w: spec.width, z0: 0.4, h: spec.height - 0.4, color: 'livery1', roof: 'livery1' }] };

    // shadow
    at(spec.length / 2, pt);
    ground(ctx, p, rect(pt.x + 0.5, pt.y + 0.7, spec.length, spec.width, pose.heading, tmp), 'rgba(0,0,0,0.22)');

    // wheels: dark blocks either side at each axle (a three-wheeler has one in the middle at the front)
    const wr = draw.wheel?.r ?? 0.45, ww = draw.wheel?.w ?? 0.3;
    const axles = axlePositions(spec);
    for (let k = 0; k < axles.length; k++) {
        const sides = spec.threeWheeler && k === 1 ? [0] : [-1, 1];
        for (const side of sides) {
            at(axles[k], pt);
            const off = (spec.width / 2 - ww / 2) * side;
            prism(ctx, p, rect(pt.x - s * off, pt.y + c * off, wr * 2, ww, pose.heading, tmp), 0, wr * 1.6, '#151515', '#2b2b2b', light);
        }
    }
    // a tractor unit without a trailer shows its fifth-wheel plate
    if (spec.fifthWheel !== undefined && !opts.coupled) {
        const q = toScreen(p, pose.x + c * spec.fifthWheel, pose.y + s * spec.fifthWheel, 1.25, pt);
        ctx.fillStyle = shade('#3a3a3a', light);
        ctx.beginPath(); ctx.ellipse(q.x, q.y, p.zoom * 0.7, p.zoom * 0.7 * p.tilt, 0, 0, Math.PI * 2); ctx.fill();
    }

    // body parts, back to front in view depth
    order.length = 0;
    for (const part of draw.parts) {
        at((part.u0 + part.u1) / 2, pt);
        order.push({ part, d: depth(p, pt.x, pt.y), x: pt.x, y: pt.y });
    }
    order.sort((a, b) => a.d - b.d);
    for (const { part, x, y } of order) {
        const len = part.u1 - part.u0;
        const pts = rect(x, y, len, part.w, pose.heading, tmp);
        const side = colour(part.color, livery);
        prism(ctx, p, pts, part.z0, part.z0 + part.h, side, shade(colour(part.roof ?? part.color, livery), 1.12), light);
        if (part.glass) windscreen(ctx, p, x, y, len, part, pose.heading, light);
        if (part.sign) stripe(ctx, p, x, y, len, part, pose.heading, livery.livery2 ?? DEFAULT_LIVERY.livery2, light);
        if (part.lamps) lamps(ctx, p, x, y, len, part, pose.heading, opts.lamps);
    }
    if (opts.brake) brakeLights(ctx, p, rearX, rearY, spec, pose.heading);
}

/** Rear axle at u = rearOverhang, front at rearOverhang + wheelbase; extra axles from spec.extraAxles (u values). */
export function axlePositions(spec) {
    const list = [spec.rearOverhang, spec.rearOverhang + spec.wheelbase];
    if (spec.extraAxles) list.push(...spec.extraAxles);
    return list;
}

function faceQuad(ctx, p, x, y, u, halfW, z0, z1, heading) {
    const c = Math.cos(heading), s = Math.sin(heading);
    const fx = x + c * u, fy = y + s * u;
    const a = toScreen(p, fx - s * halfW, fy + c * halfW, z0, qa);
    const b = toScreen(p, fx + s * halfW, fy - c * halfW, z0, qb);
    const d = toScreen(p, fx + s * halfW, fy - c * halfW, z1, qc);
    const e = toScreen(p, fx - s * halfW, fy + c * halfW, z1, qd);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(d.x, d.y); ctx.lineTo(e.x, e.y); ctx.fill();
}

function windscreen(ctx, p, x, y, len, part, heading, light) {
    // only when the front face is towards the viewer
    if (-Math.cos(heading) * p.sin + Math.sin(heading) * p.cos <= 0) return;
    ctx.fillStyle = shade('#9fc6d8', 0.9 * light);
    faceQuad(ctx, p, x, y, len / 2 + 0.01, part.w * 0.42, part.z0 + part.h * 0.45, part.z0 + part.h * 0.92, heading);
}

function stripe(ctx, p, x, y, len, part, heading, col, light) {
    const c = Math.cos(heading), s = Math.sin(heading);
    for (const side of [-1, 1]) {
        const nx = -s * side, ny = c * side;
        if (-nx * p.sin + ny * p.cos <= 0) continue;
        const ox = x + nx * (part.w / 2 + 0.01), oy = y + ny * (part.w / 2 + 0.01);
        const z0 = part.z0 + part.h * 0.55, z1 = part.z0 + part.h * 0.75;
        const a = toScreen(p, ox - c * len * 0.45, oy - s * len * 0.45, z0, qa);
        const b = toScreen(p, ox + c * len * 0.45, oy + s * len * 0.45, z0, qb);
        const d = toScreen(p, ox + c * len * 0.45, oy + s * len * 0.45, z1, qc);
        const e = toScreen(p, ox - c * len * 0.45, oy - s * len * 0.45, z1, qd);
        ctx.fillStyle = shade(col, light);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(d.x, d.y); ctx.lineTo(e.x, e.y); ctx.fill();
    }
}

function lamps(ctx, p, x, y, len, part, heading, on) {
    const c = Math.cos(heading), s = Math.sin(heading);
    ctx.fillStyle = on ? '#fff6c0' : '#d8d2b0';
    for (const side of [-1, 1]) {
        const off = part.w * 0.38 * side;
        const q = toScreen(p, x + c * (len / 2) - s * off, y + s * (len / 2) + c * off, part.z0 + part.h * 0.6, pt);
        ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(1.5, p.zoom * 0.14), 0, Math.PI * 2); ctx.fill();
    }
}

function brakeLights(ctx, p, rearX, rearY, spec, heading) {
    const c = Math.cos(heading), s = Math.sin(heading);
    ctx.fillStyle = '#ff3b2f';
    for (const side of [-1, 1]) {
        const off = spec.width * 0.4 * side;
        const q = toScreen(p, rearX - s * off, rearY + c * off, 0.8, pt);
        ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(1.5, p.zoom * 0.12), 0, Math.PI * 2); ctx.fill();
    }
}

const TRAILER_BODY = {
    flat: (len, w) => [{ u0: 0, u1: len, w, z0: 1.1, h: 0.25, color: '#5b4a3a', roof: '#7a6650' }],
    low: (len, w) => [{ u0: 0, u1: len - 3, w, z0: 0.55, h: 0.25, color: '#3a3a3a', roof: '#5a5a5a' }, { u0: len - 3, u1: len, w, z0: 1.1, h: 0.35, color: '#3a3a3a', roof: '#5a5a5a' }],
    box: (len, w, h) => [{ u0: 0, u1: len, w, z0: 1.15, h: h - 1.15, color: 'livery1', roof: '#e8e4dc', sign: true }],
    curtain: (len, w, h) => [{ u0: 0, u1: len, w, z0: 1.15, h: h - 1.15, color: 'livery1', roof: '#e8e4dc', sign: true }],
    reefer: (len, w, h) => [{ u0: 0, u1: len - 0.4, w, z0: 1.15, h: h - 1.15, color: '#eef0f2', roof: '#f6f7f8', sign: true }, { u0: len - 0.4, u1: len, w: w * 0.7, z0: 2.2, h: 1.3, color: '#6a6e72', roof: '#7a7e82' }],
    tank: (len, w, h) => [{ u0: 0.3, u1: len - 0.2, w: w * 0.92, z0: 1.2, h: h - 1.2, color: '#cfd4d8', roof: '#e2e6e9', sign: true }],
    slats: (len, w, h) => [{ u0: 0, u1: len, w, z0: 1.0, h: h - 1.0, color: '#7a5a3a', roof: '#8d6a46' }],
    tipper: (len, w, h) => [{ u0: 0, u1: len - 0.3, w, z0: 1.15, h: h - 1.15, color: '#8a8a82', roof: '#6f6f68' }],
};

/**
 * A semi-trailer at its pose (axle-group centre, heading towards the kingpin): body by type, an axle group,
 * landing legs when it stands on its own, and a load on flatbeds.
 */
export function drawTrailer(ctx, p, spec, pose, opts = {}) {
    const light = opts.light ?? 1;
    const livery = opts.livery ?? DEFAULT_LIVERY;
    const c = Math.cos(pose.heading), s = Math.sin(pose.heading);
    const rearX = pose.x - c * spec.rearOverhang, rearY = pose.y - s * spec.rearOverhang;
    const at = (u, out) => { out.x = rearX + c * u; out.y = rearY + s * u; return out; };
    at(spec.length / 2, pt);
    ground(ctx, p, rect(pt.x + 0.6, pt.y + 0.8, spec.length, spec.width, pose.heading, tmp), 'rgba(0,0,0,0.22)');
    // wheels: an axle group around the pose, 1.3 m apart
    const n = spec.axles ?? 1;
    for (let k = 0; k < n; k++) {
        const u = spec.rearOverhang + (k - (n - 1) / 2) * 1.3;
        for (const side of [-1, 1]) {
            at(u, pt);
            const off = (spec.width / 2 - 0.2) * side;
            prism(ctx, p, rect(pt.x - s * off, pt.y + c * off, 1.0, 0.4, pose.heading, tmp), 0, 0.85, '#151515', '#2b2b2b', light);
        }
    }
    if (opts.legsDown) {
        for (const side of [-1, 1]) {
            at(spec.length - spec.kingpin - 1.8, pt);
            const off = (spec.width / 2 - 0.35) * side;
            prism(ctx, p, rect(pt.x - s * off, pt.y + c * off, 0.25, 0.25, pose.heading, tmp), 0, 1.2, '#444', '#555', light);
        }
    }
    const parts = (TRAILER_BODY[spec.body] ?? TRAILER_BODY.box)(spec.length, spec.width, spec.height);
    for (const part of parts) {
        at((part.u0 + part.u1) / 2, pt);
        const len = part.u1 - part.u0;
        prism(ctx, p, rect(pt.x, pt.y, len, part.w, pose.heading, tmp), part.z0, part.z0 + part.h, colour(part.color, livery), shade(colour(part.roof ?? part.color, livery), 1.1), light);
        if (part.sign) stripe(ctx, p, pt.x, pt.y, len, part, pose.heading, livery.livery2 ?? DEFAULT_LIVERY.livery2, light);
    }
    if (opts.cargo && (spec.body === 'flat' || spec.body === 'low')) {
        at(spec.length * 0.45, pt);
        prism(ctx, p, rect(pt.x, pt.y, spec.length * 0.6, spec.width * 0.85, pose.heading, tmp), 1.35, 2.5, '#8a6d4f', '#a58660', light);
    }
    if (opts.brake) brakeLights(ctx, p, rearX, rearY, spec, pose.heading);
}

/** Reversing guide lines (1990s cameras): from the rear corners straight back, red, amber and green bands. */
export function drawGuideLines(ctx, rear, heading, width) {
    const c = Math.cos(heading), s = Math.sin(heading);
    ctx.lineWidth = 0.18;
    for (const [d0, d1, col] of [[0, 2, '#ff3b2f'], [2, 5, '#f2d33d'], [5, 10, '#3cff6a']]) {
        ctx.strokeStyle = col;
        ctx.beginPath();
        for (const side of [-1, 1]) {
            const ox = -s * (width / 2) * side, oy = c * (width / 2) * side;
            ctx.moveTo(rear.x - c * d0 + ox, rear.y - s * d0 + oy);
            ctx.lineTo(rear.x - c * d1 + ox, rear.y - s * d1 + oy);
        }
        ctx.moveTo(rear.x - c * d1 - s * width / 2, rear.y - s * d1 + c * width / 2);
        ctx.lineTo(rear.x - c * d1 + s * width / 2, rear.y - s * d1 - c * width / 2);
        ctx.stroke();
    }
}
