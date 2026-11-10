// Scenery placement for Inglenook: one composed 1960s goods yard per layout. DOM-free so it can be unit tested.
//
// planScenery(layout, seed) returns [{ type, x, y, w, h, rot, ... }]: x, y is the centre of the footprint rectangle (w x h, wagon lengths),
// rot is 0 or 180 (a building turns its platform side towards the track). The fixed anchors (shed, apron, signal box, staithe, water tower
// and crane, office, lamps, trees, fence, gate) depend only on the layout; the clutter (sleeper stacks, drums, barrows, coal heaps, a
// lorry on the apron) is seeded by the level number.
import { hash, rng } from './noise.js';
import { leverPosition } from './draw-track.js';

export const CLEAR = 0.9; // nothing comes closer than this to a track centre-line ...
export const SHED_CLEAR = 0.6; // ... except the goods shed's platform edge and its apron and the lorry parked on it, which may come to this on their own siding
const GAP = 0.05; // gap kept between two items

/** The sun is fixed in yard coordinates, low in the upper left, so shadows fall down and to the right. */
export const SUN = { dx: 0.78, dy: 0.62 };
/** How far a shadow is thrown for an item `height` tall (the same rule is used for vehicle shadows). */
export const SHADOW_LENGTH = 0.36;
export const shadowOffset = height => ({ x: SUN.dx * height * SHADOW_LENGTH, y: SUN.dy * height * SHADOW_LENGTH });

/** Height of each item type in wagon lengths (it sets the length of its shadow). */
export const ITEM_HEIGHT = {
    shed: 1.0, apron: 0, signalbox: 1.1, staithe: 0.6, watertower: 2.0, watercrane: 1.0, office: 0.6, lamp: 1.2, tree: 1.4,
    fence: 0.3, gate: 0.35, sleepers: 0.3, drums: 0.3, barrow: 0.15, coalheap: 0.35, lorry: 0.5,
};

const rectOf = it => ({ x0: it.x - it.w / 2, y0: it.y - it.h / 2, x1: it.x + it.w / 2, y1: it.y + it.h / 2 });
const rectDist = (r, px, py) => Math.hypot(Math.max(r.x0 - px, 0, px - r.x1), Math.max(r.y0 - py, 0, py - r.y1));
const overlaps = (a, b, gap = 0) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;

/**
 * The area round point `id`'s lever that scenery must keep clear: the ring, the arm and the upright number label beyond it. Pure.
 * Returned as a rectangle { x0, y0, x1, y1 }.
 */
export function leverKeepout(layout, id) {
    const lv = leverPosition(layout, id);
    return lv.side > 0
        ? { x0: lv.x - 0.7, y0: lv.y - 0.6, x1: lv.x + 0.7, y1: lv.y + 1.3 }
        : { x0: lv.x - 0.7, y0: lv.y - 1.3, x1: lv.x + 0.7, y1: lv.y + 0.6 };
}

/** The obstacles of a layout: track centre-line samples (every 0.2) and lever keep-out rectangles. */
function worldOf(layout) {
    const samples = [];
    for (const t of Object.values(layout.tracks)) {
        for (let i = 0; i < t.pts.length; i += 4) samples.push({ x: t.pts[i][0], y: t.pts[i][1], t: t.id });
        const last = t.pts[t.pts.length - 1];
        samples.push({ x: last[0], y: last[1], t: t.id });
    }
    return { b: layout.bounds, samples, keepouts: layout.pointIds.map(id => leverKeepout(layout, id)) };
}

function fits(world, rect, placed, { own = null, exempt = null } = {}) {
    const b = world.b;
    if (rect.x0 < b.x + 0.1 || rect.y0 < b.y + 0.1 || rect.x1 > b.x + b.w - 0.1 || rect.y1 > b.y + b.h - 0.1) return false;
    for (const s of world.samples) {
        const need = (s.t === own ? SHED_CLEAR : CLEAR) + 0.02;
        if (rectDist(rect, s.x, s.y) < need) return false;
    }
    for (const k of world.keepouts) if (overlaps(rect, k, 0.05)) return false;
    for (const p of placed) if ((!exempt || !exempt(p)) && overlaps(rect, rectOf(p), GAP)) return false;
    return true;
}

/** Nearest track sample to a point, and its distance. */
function nearest(world, x, y, track = null) {
    let best = null, bd = Infinity;
    for (const s of world.samples) {
        if (track && s.t !== track) continue;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < bd) { bd = d; best = s; }
    }
    return { s: best, d: bd };
}

/**
 * Scans the board for the spot where an item of w x h fits and `score(rect)` is lowest (ties go to the first in scan order, top to
 * bottom and left to right, so the result is deterministic). Returns the item, or null when there is no room.
 */
function place(world, placed, type, w, h, score, opts = {}) {
    const b = world.b;
    let best = null, bs = Infinity;
    const span = (lo, hi) => { const v = []; for (let t = lo; t <= hi + 1e-9; t += 0.2) v.push(t); if (hi - v[v.length - 1] > 1e-6) v.push(hi); return v; }; // grid plus the far edge
    const xs = span(b.x + 0.1 + w / 2, b.x + b.w - 0.1 - w / 2);
    for (const y of span(b.y + 0.1 + h / 2, b.y + b.h - 0.1 - h / 2)) {
        for (const x of xs) {
            const rect = { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
            const s = Math.round(score(rect, x, y) / 0.05);
            if (s >= bs || !fits(world, rect, placed, opts)) continue;
            bs = s; best = { x, y };
        }
    }
    if (!best) return null;
    const item = { type, x: +best.x.toFixed(3), y: +best.y.toFixed(3), w, h, rot: 0 };
    if (opts.face) { // turn the platform side (local +y) towards the target track
        const near = nearest(world, item.x, item.y, opts.face);
        if (near.s && near.s.y < item.y) item.rot = 180;
    }
    return item;
}

/** Score for standing beside a track: the gap to it, plus a little for the centre being far from it (so the item lies alongside). */
const toTrack = (world, id) => rect => {
    let d = Infinity, c = Infinity;
    const cx = (rect.x0 + rect.x1) / 2, cy = (rect.y0 + rect.y1) / 2;
    for (const s of world.samples) if (s.t === id) { d = Math.min(d, rectDist(rect, s.x, s.y)); c = Math.min(c, Math.hypot(s.x - cx, s.y - cy)); }
    return d + 0.3 * c;
};
const toPoint = (px, py) => rect => rectDist(rect, px, py);

const FENCE_INSET = 1.05; // the boundary fence stands this far in from the bottom edge, with a row of trees outside it

function fixedAnchors(layout) {
    const world = worldOf(layout);
    const b = layout.bounds;
    const placed = [];
    const add = it => { if (it) placed.push(it); return it; };
    const goal = layout.goal;
    const sidings = Object.values(layout.tracks).filter(t => t.role === 'siding' && t.id !== goal);
    const short = sidings.reduce((best, t) => (!best || t.length <= best.length ? t : best), null);
    const head = layout.tracks[layout.head];
    const p1 = layout.points[layout.pointIds[0]];

    // goods shed with its loading platform beside the goal siding, and the setts apron next to it
    const shed = add(place(world, placed, 'shed', 4.4, 1.75, toTrack(world, goal), { own: goal, face: goal }));
    if (shed) {
        const r = rectOf(shed);
        add(place(world, placed, 'apron', 2.2, 1.75, rect => rectDist(r, (rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2) + Math.abs((rect.y0 + rect.y1) / 2 - shed.y), { own: goal }));
    }
    // signal box near the first point, coal staithes beside a short siding
    add(place(world, placed, 'signalbox', 1.0, 0.9, toPoint(p1.x, p1.y)));
    if (short) add(place(world, placed, 'staithe', 3.4, 1.0, toTrack(world, short.id), { face: short.id }));
    // water tower and crane by the headshunt, the yard office
    const hs = head ? pointAt2(head, 1.5) : { x: p1.x - 4, y: p1.y };
    add(place(world, placed, 'watertower', 1.3, 1.3, toPoint(hs.x, hs.y)));
    const hc = head ? pointAt2(head, head.length * 0.6) : { x: p1.x - 2, y: p1.y };
    add(place(world, placed, 'watercrane', 0.8, 0.8, toPoint(hc.x, hc.y), { face: layout.head }));
    add(place(world, placed, 'office', 1.4, 0.9, toPoint(hs.x + 2.5, hs.y)));

    // yard lamps at intervals along the tracks (at most 12)
    const lampTracks = [head, layout.tracks[goal], ...sidings].filter(Boolean);
    let lamps = 0;
    for (const t of lampTracks) {
        for (let d = 2.5, k = 0; d < t.length - 1 && lamps < 12; d += 5, k++) {
            const q = pointAt2(t, d);
            for (const side of k % 2 ? [-1, 1] : [1, -1]) {
                const x = q.x - Math.sin(q.a) * 1.15 * side, y = q.y + Math.cos(q.a) * 1.15 * side;
                const it = { type: 'lamp', x: +x.toFixed(3), y: +y.toFixed(3), w: 0.3, h: 0.3, rot: 0 };
                if (fits(world, rectOf(it), placed)) { placed.push(it); lamps++; break; }
            }
        }
    }

    // a row of trees outside the boundary fence along the bottom edge, and some along the top edge
    const bottomY = b.y + b.h - 0.5;
    for (let x = b.x + 0.5, i = 0; x < b.x + b.w - 0.4; x += 1.45, i++) {
        const r = 0.3 + 0.08 * (hash(`bt${i}`) % 3) / 2 * 2;
        const it = { type: 'tree', x: +(x + 0.2 * ((hash(`bx${i}`) % 3) - 1)).toFixed(3), y: +(bottomY - (hash(`by${i}`) % 2) * 0.04).toFixed(3), w: 2 * r, h: 2 * r, rot: 0, r };
        if (fits(world, rectOf(it), placed)) placed.push(it);
    }
    for (let x = b.x + 0.7, i = 0; x < b.x + b.w - 0.5; x += 1.9, i++) {
        if (hash(`tt${i}`) % 4 === 0) continue;
        const r = 0.36 + 0.14 * (hash(`tr${i}`) % 3) / 2;
        const it = { type: 'tree', x: +x.toFixed(3), y: +(b.y + 0.2 + r + 0.1 * (hash(`ty${i}`) % 2)).toFixed(3), w: 2 * r, h: 2 * r, rot: 0, r };
        if (fits(world, rectOf(it), placed)) placed.push(it);
    }

    // boundary fence along the bottom edge, cut wherever something stands in its way; one fixed gate
    const fy = b.y + b.h - FENCE_INSET;
    const fence = { y0: fy - 0.05, y1: fy + 0.05 };
    const blocked = [...world.keepouts, ...placed.filter(p => p.type !== 'tree').map(rectOf)].filter(r => r.y0 < fence.y1 + 0.1 && r.y1 > fence.y0 - 0.1);
    const gateW = 1.2;
    const cuts = blocked.map(r => [r.x0 - 0.1, r.x1 + 0.1]);
    for (const f of [0.62, 0.45, 0.3, 0.78, 0.15, 0.9]) { // the gate goes at the first of these spots that is clear
        const gx = b.x + f * b.w;
        const gate = { type: 'gate', x: +gx.toFixed(3), y: +fy.toFixed(3), w: gateW, h: 0.1, rot: 0 };
        if (blocked.some(r => overlaps(rectOf(gate), r, 0.1))) continue;
        placed.push(gate); cuts.push([gx - gateW / 2 - 0.05, gx + gateW / 2 + 0.05]);
        break;
    }
    cuts.sort((a, c) => a[0] - c[0]);
    let x = b.x + 0.2;
    const end = b.x + b.w - 0.2;
    const seg = (s, e) => { if (e - s >= 0.5) placed.push({ type: 'fence', x: +((s + e) / 2).toFixed(3), y: +fy.toFixed(3), w: +(e - s).toFixed(3), h: 0.1, rot: 0 }); };
    for (const [c0, c1] of cuts) { if (c0 > x) seg(x, Math.min(c0, end)); x = Math.max(x, c1); }
    if (x < end) seg(x, end);
    return { world, placed };
}

/** Position and heading at distance d along a track (by vertex lookup; the planner needs nothing finer). */
function pointAt2(t, d) {
    let i = 1;
    while (i < t.cum.length - 1 && t.cum[i] < d) i++;
    const f = (d - t.cum[i - 1]) / Math.max(t.cum[i] - t.cum[i - 1], 1e-9);
    return {
        x: t.pts[i - 1][0] + (t.pts[i][0] - t.pts[i - 1][0]) * f,
        y: t.pts[i - 1][1] + (t.pts[i][1] - t.pts[i - 1][1]) * f,
        a: t.hdg[i - 1] + (t.hdg[i] - t.hdg[i - 1]) * f,
    };
}

const fixedCache = new WeakMap();
const fixedFor = layout => {
    if (!fixedCache.has(layout)) fixedCache.set(layout, fixedAnchors(layout));
    return fixedCache.get(layout);
};

const CLUTTER = [
    { type: 'sleepers', w: 1.0, h: 0.5 }, { type: 'drums', w: 0.6, h: 0.6 }, { type: 'barrow', w: 0.6, h: 0.3 },
    { type: 'coalheap', w: 1.0, h: 0.8 }, { type: 'sleepers', w: 0.5, h: 1.0 }, { type: 'drums', w: 0.7, h: 0.5 },
];

/**
 * Plans the yard for `layout`. Fixed anchors depend only on the layout; seeded clutter depends on `seed` (the level number).
 * Every item lies inside layout.bounds, clear of the tracks and point levers and of every other item (the lorry stands on the apron).
 */
export function planScenery(layout, seed = 0) {
    const { world, placed } = fixedFor(layout);
    const items = placed.map(p => ({ ...p }));
    const rand = rng(hash(`${layout.id}:${seed}`) ^ 0x5bd1e995);
    const apron = items.find(p => p.type === 'apron');
    const b = layout.bounds;
    const count = 4 + Math.floor(rand() * 3);
    for (let k = 0; k < count; k++) {
        const proto = CLUTTER[Math.floor(rand() * CLUTTER.length)];
        for (let tries = 0; tries < 80; tries++) {
            const x = b.x + 0.5 + rand() * (b.w - 1), y = b.y + 0.5 + rand() * (b.h - 1);
            const it = { type: proto.type, x: +x.toFixed(3), y: +y.toFixed(3), w: proto.w, h: proto.h, rot: rand() < 0.5 ? 0 : 180, variant: Math.floor(rand() * 4) };
            if (nearest(world, x, y).d > 2.6) continue; // clutter belongs by the tracks
            if (fits(world, rectOf(it), items)) { items.push(it); break; }
        }
    }
    if (apron) { // a parked lorry on the apron
        const lw = 1.7, lh = 0.75;
        const it = {
            type: 'lorry', w: lw, h: lh, rot: rand() < 0.5 ? 0 : 180, variant: Math.floor(rand() * 3),
            x: +(apron.x + (rand() - 0.5) * (apron.w - lw - 0.1)).toFixed(3), y: +(apron.y + (rand() - 0.5) * (apron.h - lh - 0.2)).toFixed(3),
        };
        if (fits(world, rectOf(it), items, { own: layout.goal, exempt: p => p.type === 'apron' })) items.push(it);
    }
    return items;
}
