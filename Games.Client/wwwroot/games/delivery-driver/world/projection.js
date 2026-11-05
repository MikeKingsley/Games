// The game projection: latitude/longitude to world metres (+x east, +y south). Pure: shared by the road bake
// (scripts/bake-roads/bake.mjs), the runtime loader and the tests, so everything baked lines up.
//
// Base: the equirectangular projection of config.latLonToWorld (REF_LAT, compressed by WORLD_SCALE = 1/13).
// Town lenses: at 1/13 a real town (streets ~80 m apart) would shrink to a tarmac blob, so each town's real street
// footprint (footprintM, real metres) is magnified to the town's game radius (TOWN_RADIUS, world metres). Outside
// the footprint a ring compresses radially back to the plain projection, so the map is continuous and one-to-one,
// and distances between towns are unchanged. Lenses are applied in town order (bigger towns first); a lens is
// centred where the earlier lenses put its town centre. `lens: false` gives the plain 1/13 projection.
import { WORLD_SCALE, REF_LAT } from '../config.js';

export const M_PER_DEG_LAT = 110574;
export const M_PER_DEG_LON = 111320 * Math.cos((REF_LAT * Math.PI) / 180);

/** Game radius (world metres) of a town by size; region.js uses the same table. */
export const TOWN_RADIUS = { city: 320, town: 220, small: 160, village: 85 };
/** Real-world radius (real metres) of a town's street footprint: where real residential streets are baked. */
export const footprintM = t => (TOWN_RADIUS[t.size] ?? 100) * 3 + 250;

/** Lat/lon to real metres relative to an origin (same axes as world space, no WORLD_SCALE). */
export function latLonToReal(lat, lon, origin) {
    return { x: (lon - origin.lon) * M_PER_DEG_LON, y: (origin.lat - lat) * M_PER_DEG_LAT };
}
export function realToLatLon(x, y, origin) {
    return { lat: origin.lat - y / M_PER_DEG_LAT, lon: origin.lon + x / M_PER_DEG_LON };
}

const smoothstep = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const SIZE_ORDER = { city: 0, town: 1, small: 2, village: 3 };

/**
 * A radial lens at (cx, cy) (world metres, unlensed): radius rIn maps to rT (rT > rIn), with uniform magnification
 * near the centre, a ring of radial compression (slope q) and identity beyond rOut. The radial profile h(r) is
 * tabulated from a smooth derivative, so the map has no kinks.
 */
export function createLens(cx, cy, rIn, rT, q = 0.55) {
    const a = 0.75 * rIn, b = 1.35 * rIn, w2 = 1.0 * rIn;
    const N = 400;
    // I = integral of the falling smoothstep from a to rIn, so that h(rIn) = rT exactly
    let I = 0;
    for (let k = 0; k < N; k++) { const r = a + ((rIn - a) * (k + 0.5)) / N; I += smoothstep((r - a) / (b - a)) * (rIn - a) / N; }
    const m = (rT - q * I) / (rIn - I);
    const hb = m * b + ((q - m) * (b - a)) / 2; // h(b)
    const c = Math.max(b, b + (hb - b - 0.5 * (1 - q) * w2) / (1 - q));
    const rOut = c + w2;
    const slope = r => (r < a ? m : r < b ? m + (q - m) * smoothstep((r - a) / (b - a)) : r < c ? q : r < rOut ? q + (1 - q) * smoothstep((r - c) / w2) : 1);
    const T = 1024, dr = rOut / T;
    const h = new Float64Array(T + 1);
    for (let k = 0; k < T; k++) {
        // Simpson on each step
        const r0 = k * dr;
        h[k + 1] = h[k] + (dr / 6) * (slope(r0) + 4 * slope(r0 + dr / 2) + slope(r0 + dr));
    }
    const end = h[T]; // ~= rOut; rescale the tail so the profile meets the identity exactly
    const fix = rOut / end;
    for (let k = 0; k <= T; k++) h[k] *= 1 + (fix - 1) * smoothstep(k / T);
    const fwd = r => {
        if (r >= rOut) return r;
        const f = r / dr, k = Math.floor(f);
        return h[k] + (h[k + 1] - h[k]) * (f - k);
    };
    const inv = rr => {
        if (rr >= rOut) return rr;
        let lo = 0, hi = T;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (h[mid] <= rr) lo = mid; else hi = mid; }
        const t = h[hi] > h[lo] ? (rr - h[lo]) / (h[hi] - h[lo]) : 0;
        return (lo + t) * dr;
    };
    return {
        cx, cy, rIn, rT, rOut, magnification: m,
        forward(x, y, out) {
            const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
            if (r >= rOut || r === 0) { out.x = x; out.y = y; return out; }
            const s = fwd(r) / r;
            out.x = cx + dx * s; out.y = cy + dy * s;
            return out;
        },
        inverse(x, y, out) {
            const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
            if (r >= rOut || r === 0) { out.x = x; out.y = y; return out; }
            const s = inv(r) / r;
            out.x = cx + dx * s; out.y = cy + dy * s;
            return out;
        },
    };
}

/**
 * The projection of a region seed JSON ({origin, towns}). Returns
 * project(lat, lon), unproject(x, y), fromReal(x, y) (real-metre frame -> world), toReal(x, y), the lenses, and
 * `localScale(x, y)`: world metres per real metre at a world point (approximate, for tolerances). `scale` overrides
 * WORLD_SCALE (the plan 0009 measurement bakes at 1/4 and 1/5 without touching config.js).
 */
export function createProjection(json, { lens = true, scale = WORLD_SCALE } = {}) {
    const origin = json.origin;
    const lenses = [];
    const tmp = { x: 0, y: 0 };
    const applyLenses = (x, y, upTo = lenses.length) => {
        tmp.x = x; tmp.y = y;
        for (let i = 0; i < upTo; i++) lenses[i].forward(tmp.x, tmp.y, tmp);
        return { x: tmp.x, y: tmp.y };
    };
    if (lens) {
        const towns = json.towns.map((t, i) => ({ t, i })).sort((p, q) => (SIZE_ORDER[p.t.size] ?? 4) - (SIZE_ORDER[q.t.size] ?? 4) || p.i - q.i);
        for (const { t } of towns) {
            const r = latLonToReal(t.lat, t.lon, origin);
            const c = applyLenses(r.x * scale, r.y * scale);
            const rIn = footprintM(t) * scale, rT = TOWN_RADIUS[t.size] ?? 100;
            if (rT > rIn * 1.05) lenses.push(Object.assign(createLens(c.x, c.y, rIn, rT), { town: t.id }));
        }
    }
    const fromReal = (x, y) => applyLenses(x * scale, y * scale);
    const toReal = (x, y) => {
        tmp.x = x; tmp.y = y;
        for (let i = lenses.length - 1; i >= 0; i--) lenses[i].inverse(tmp.x, tmp.y, tmp);
        return { x: tmp.x / scale, y: tmp.y / scale };
    };
    const project = (lat, lon) => { const r = latLonToReal(lat, lon, origin); return fromReal(r.x, r.y); };
    const unproject = (x, y) => { const r = toReal(x, y); return realToLatLon(r.x, r.y, origin); };
    const localScale = (x, y) => {
        const r = toReal(x, y);
        const p = fromReal(r.x + 1, r.y), q = fromReal(r.x - 1, r.y);
        return Math.hypot(p.x - q.x, p.y - q.y) / 2;
    };
    return { origin, lens, lenses, project, unproject, fromReal, toReal, localScale, worldScale: scale };
}
