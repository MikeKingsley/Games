// Terrain: the region's heightfield in WORLD metres above sea level (+z up, the same units as x/y; the sea is
// z <= 0). terrainHeight(region, x, y) is a pure function of the region's seed data and the position, so the sim,
// the AI fleet, traffic, both renderers and the tests all agree on it. Pure and DOM-free (Node tests import it).
//
// Shaping, in order: a rise inland from the coast scaled by fBm value noise; moor plateaus (seed moors, with their
// hand-set heights); relief bumps and dips and cliff coasts (seed `relief`); a knoll under each granite tor (the
// generator's tor sites); river valleys cut down to each river's level; flat pads under towns; the river channels
// themselves; and last a ramp down to the sea at the coastline (a beach, a cliff, or a quay wall in towns).
import { inPolygon, isLand, moorAt, waterAt } from './region.js';
import { ROAD_CLASS } from './roadgraph.js';
import { sat } from '../sim/collision.js';
import { seededRng, hashSeed, range, smoothNoise } from '../engine/rng.js';
import { CHUNK_SIZE } from '../config.js';
import { sampleElevation } from './elevation-format.js';

// ---- Tuning (world metres) ---------------------------------------------------------------------------------------

/** Lowland height well inland, and the e-folding distance of the rise from the coast. */
const INLAND_H = 10, INLAND_D = 380;
/** Local hills: +-HILL_H about the lowland (the octave sum rarely strays far from 0.5), full size HILL_D or so inland. */
const HILL_H = 10, HILL_D = 150;
/** fBm octaves: lattice cell (m), weight (each set sums to 1), and a rotation so the lattices don't line up. */
const octaves = (list, k0) => list.map(([cell, w, a], k) => ({ w, k: k0 + k, c: Math.cos(a) / cell, s: Math.sin(a) / cell }));
const BROAD = octaves([[2400, 0.6, 0], [900, 0.4, 0.9]], 0);
const HILLS = octaves([[330, 0.55, 1.7], [150, 0.3, 2.6], [70, 0.15, 0.4]], 2);
/** Moor plateau lift when the seed gives none, ramping up from MOOR_OUT outside the moor's edge to MOOR_IN inside. */
const MOOR_H = 14, MOOR_IN = 520, MOOR_OUT = 160;
/** The knoll raised under each tor. */
const TOR_H = 3.2, TOR_R = 52, TOR_CHANCE = 0.35;
/** Coast: land within SHORE of the coastline stays at 0, then ramps up over a beach, a cliff or (in towns) a quay. */
const SHORE = 4, BEACH = 90, CLIFF = 12, QUAY = 2;
/** With real elevation the coast already has its real shape: a short ramp, and little extra relief on top of it. */
const DEM_BEACH = 20, DEM_DETAIL = 0.5, DEM_TOR_H = 1;
/** Sea floor: depth gained per metre out to sea, and its limit. */
const SEA_SLOPE = 0.06, SEA_DEPTH = 12;
/**
 * Rivers: bank height above the water; valley side slope; the channel's wall above the bank (a quay wall where a
 * town pad meets the river); the width from which a river is a tidal estuary (its level is 0) and how fast its
 * level may rise upstream of that; level profile sample spacing.
 */
const BANK = 0.6, VALLEY_SLOPE = 0.07, CHANNEL_SLOPE = 3, TIDAL_W = 30, TIDAL_GRADE = 0.006, LEVEL_STEP = 15;
/**
 * Towns: the flat pad reaches TOWN_FLAT x radius, then blends back to the land over TOWN_BLEND m + 35% radius. A
 * town on a river or the sea sits at most TOWN_ABOVE_WATER above it (quays, not cliffs), and at least TOWN_MIN.
 */
const TOWN_FLAT = 1.08, TOWN_BLEND = 60, TOWN_MIN = 1.2, TOWN_ABOVE_WATER = 3, TOWN_GRADE = 0.015, TOWN_WOBBLE = 1.2;

// ---- Small maths -------------------------------------------------------------------------------------------------

export function smoothstep(e0, e1, x) {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

/** Polynomial smooth minimum: equals min(a, b) when they differ by more than k, rounds the crease otherwise. */
function smin(a, b, k) {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
}
const smax = (a, b, k) => -smin(-a, -b, k);

/** Segments of a flat polyline as [ax, ay, dx, dy, 1/len^2] runs; `skip(ax, ay, bx, by)` drops some. */
function segments(pts, closed, skip = null) {
    const out = [];
    const n = pts.length / 2;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
        const k = (i + 1) % n;
        const ax = pts[2 * i], ay = pts[2 * i + 1], bx = pts[2 * k], by = pts[2 * k + 1];
        if (skip?.(ax, ay, bx, by)) continue;
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        out.push(ax, ay, dx, dy, l2 > 0 ? 1 / l2 : 0);
    }
    return Float64Array.from(out);
}

/** Squared distance from a point to the nearest of a set of segments. */
function nearestSq(segs, x, y) {
    let best = Infinity;
    for (let k = 0; k < segs.length; k += 5) {
        const ax = segs[k], ay = segs[k + 1], dx = segs[k + 2], dy = segs[k + 3];
        let u = ((x - ax) * dx + (y - ay) * dy) * segs[k + 4];
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const ex = ax + dx * u - x, ey = ay + dy * u - y;
        const d2 = ex * ex + ey * ey;
        if (d2 < best) best = d2;
    }
    return best;
}

const GRID = 512;
/**
 * A grid over a segment list (the baked coast has ~20,000 segments): cells hold the segments passing within `reach`
 * of them, so a nearest query only looks in the rings around the point.
 */
function gridSegments(segs) {
    const cells = new Map();
    for (let k = 0; k < segs.length; k += 5) {
        const ax = segs[k], ay = segs[k + 1], bx = ax + segs[k + 2], by = ay + segs[k + 3];
        const i0 = Math.floor(Math.min(ax, bx) / GRID), i1 = Math.floor(Math.max(ax, bx) / GRID);
        const j0 = Math.floor(Math.min(ay, by) / GRID), j1 = Math.floor(Math.max(ay, by) / GRID);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
            const key = i * 100003 + j;
            let list = cells.get(key);
            if (!list) cells.set(key, (list = []));
            list.push(k);
        }
    }
    return { segs, cells };
}

/** Squared distance to the nearest grid segment, or the cap (4 km squared) when none is within that. */
function nearestGridSq(g, x, y, cap = 4000) {
    const segs = g.segs, ci = Math.floor(x / GRID), cj = Math.floor(y / GRID);
    let best = cap * cap;
    const maxR = Math.ceil(cap / GRID);
    for (let r = 0; r <= maxR; r++) {
        // everything in ring r is at least (r - 1) * GRID away
        if (r > 0 && (r - 1) * GRID > Math.sqrt(best)) break;
        for (let i = ci - r; i <= ci + r; i++) {
            for (let j = cj - r; j <= cj + r; j++) {
                if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
                const list = g.cells.get(i * 100003 + j);
                if (!list) continue;
                for (const k of list) {
                    const ax = segs[k], ay = segs[k + 1], dx = segs[k + 2], dy = segs[k + 3];
                    let u = ((x - ax) * dx + (y - ay) * dy) * segs[k + 4];
                    u = u < 0 ? 0 : u > 1 ? 1 : u;
                    const ex = ax + dx * u - x, ey = ay + dy * u - y;
                    const d2 = ex * ex + ey * ey;
                    if (d2 < best) best = d2;
                }
            }
        }
    }
    return best;
}

function boxOf(pts, pad) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
        minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]);
        minY = Math.min(minY, pts[i + 1]); maxY = Math.max(maxY, pts[i + 1]);
    }
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

const inBox = (b, x, y) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;

/** Squared distance from a point to a box (0 inside). */
function boxDistanceSq(b, x, y) {
    const dx = Math.max(b.minX - x, 0, x - b.maxX), dy = Math.max(b.minY - y, 0, y - b.maxY);
    return dx * dx + dy * dy;
}

// ---- Precomputed per-region data -----------------------------------------------------------------------------------

const prepared = new WeakMap();

/** The region's terrain data (coast segments, moors, relief, town pads, river level profiles), built once. */
function prep(region) {
    let t = prepared.get(region);
    if (!t) prepared.set(region, (t = build(region)));
    return t;
}

function build(region) {
    const east = region.bounds.maxX - 1, north = region.bounds.minY + 1;
    const onBoundsEdge = (ax, ay, bx, by) => (ax >= east && bx >= east) || (ay <= north && by <= north);
    const relief = region.relief ?? [];
    const t = {
        region,
        seed: hashSeed(region.seed, 'terrain'),
        // the coast rings close along the region's east and north edges, which are not real coastlines ("up country")
        coast: gridSegments(Float64Array.from([
            ...segments(region.coast, true, onBoundsEdge),
            ...(region.islands ?? []).flatMap(r => [...segments(r, true, onBoundsEdge)]),
        ])),
        moors: region.elevation ? [] : region.moors.map(m => ({ pts: m.pts, h: m.height ?? MOOR_H, segs: segments(m.pts, true), box: boxOf(m.pts, MOOR_OUT) })),
        dem: region.elevation ?? null,
        beach: region.elevation ? DEM_BEACH : BEACH,
        relief: region.elevation ? [] : relief.filter(r => !r.cliff),
        cliffs: region.elevation ? [] : relief.filter(r => r.cliff),
        torBox: region.moors.length ? boxOf(region.moors.flatMap(m => m.pts), CHUNK_SIZE) : null,
        tors: new Map(),
        coastLattice: new Map(),
        towns: [],
        rivers: [],
        // scratch state for one terrainHeight call (it never re-enters)
        cliff: { w: 0, h: 0 },
        pad: { w: 0, z: 0 },
        q: [],
    };
    // river levels from the land alone, then the towns (kept near any water they sit on), then the levels again
    // kept below the towns
    t.rivers = region.rivers.map(r => buildRiver(t, r));
    t.towns = region.towns.map(town => {
        const r1 = town.radius * TOWN_FLAT;
        return { id: town.id, x: town.x, y: town.y, r1, r2: r1 + TOWN_BLEND + town.radius * 0.35, base: townBase(t, town) };
    });
    relaxTownBases(t.towns);
    t.rivers = region.rivers.map(r => buildRiver(t, r));
    t.q = t.rivers.map(() => ({ d: 0, w: 0, level: 0, ok: false }));
    return t;
}

/** Signed distance to the coastline: positive inland, negative out at sea. */
function coastDistance(t, x, y) {
    // far inland the distance only shapes the land very gently (and the coast ramp is long over), so it is
    // interpolated from a lazily filled 24 m lattice of exact values; within COARSE_NEAR of the coast it is exact
    const fx = x / COARSE_CELL, fy = y / COARSE_CELL, i = Math.floor(fx), j = Math.floor(fy);
    const c00 = coastLattice(t, i, j), c10 = coastLattice(t, i + 1, j), c01 = coastLattice(t, i, j + 1), c11 = coastLattice(t, i + 1, j + 1);
    if (Math.min(c00, c10, c01, c11) > COARSE_NEAR) {
        const tx = fx - i, ty = fy - j;
        return (c00 * (1 - tx) + c10 * tx) * (1 - ty) + (c01 * (1 - tx) + c11 * tx) * ty;
    }
    return exactCoastDistance(t, x, y);
}

const COARSE_CELL = 24, COARSE_NEAR = 120;
function exactCoastDistance(t, x, y) {
    const d = Math.sqrt(nearestGridSq(t.coast, x, y));
    return isLand(t.region, x, y) ? d : -d;
}
function coastLattice(t, i, j) {
    const key = (i + 32768) * 65536 + (j + 32768);
    let v = t.coastLattice.get(key);
    if (v === undefined) { v = exactCoastDistance(t, i * COARSE_CELL, j * COARSE_CELL); t.coastLattice.set(key, v); }
    return v;
}

const seaFloor = dc => -Math.min(SEA_DEPTH, SEA_SLOPE * -dc);

/** How cliff-like the coast is near a point (0-1) and the cliff height there (seed relief entries with `cliff`). */
function cliffAt(t, x, y, out) {
    let wsum = 0, hsum = 0;
    for (const c of t.cliffs) {
        const d = Math.hypot(x - c.x, y - c.y);
        if (d >= c.radius) continue;
        const w = 1 - smoothstep(0.55 * c.radius, c.radius, d);
        wsum += w;
        hsum += w * c.height;
    }
    out.w = Math.min(1, wsum);
    out.h = wsum > 0 ? hsum / wsum : 0;
    return out;
}

/** Width of the ramp from the shore up to the land: a beach, steeper at cliffs, a quay wall in towns. */
function coastRamp(dc, cliffW, townW, beach = BEACH) {
    if (dc >= SHORE + beach) return 1;
    const width = (beach + (CLIFF - beach) * cliffW) * (1 - townW) + QUAY * townW;
    return smoothstep(SHORE, SHORE + width, dc);
}

/** Weighted value noise over a set of octaves, in [0, 1]. */
function fbm(seed, set, x, y) {
    let n = 0;
    for (const o of set) n += o.w * smoothNoise(seed + o.k, x * o.c - y * o.s, x * o.s + y * o.c);
    return n;
}

/** The land before rivers, towns and the coast ramp: inland rise x broad noise, hills, moors, relief, tors, cliffs. */
function landShape(t, x, y, dc, cliff) {
    if (t.dem) {
        // real elevation, plus fine detail growing inland (the grid is 12 world m per cell), plus the tor knolls
        let h = sampleElevation(t.dem, x, y) + DEM_DETAIL * (1 - Math.exp(-dc / HILL_D)) * (2 * fbm(t.seed, HILLS, x, y) - 1);
        if (t.torBox && inBox(t.torBox, x, y)) h += torLift(t, x, y);
        return smax(h, 0.4, 0.8);
    }
    const n = fbm(t.seed, BROAD, x, y);
    let h = INLAND_H * (1 - Math.exp(-dc / INLAND_D)) * (0.4 + 0.9 * n)
        + HILL_H * (1 - Math.exp(-dc / HILL_D)) * (2 * fbm(t.seed, HILLS, x, y) - 1);
    for (const m of t.moors) {
        if (!inBox(m.box, x, y)) continue;
        const d = Math.sqrt(nearestSq(m.segs, x, y));
        const sd = inPolygon(m.pts, x, y) ? d : -d;
        if (sd > -MOOR_OUT) h += m.h * smoothstep(-MOOR_OUT, MOOR_IN, sd) * (0.75 + 0.5 * n);
    }
    for (const r of t.relief) {
        const dx = x - r.x, dy = y - r.y, q = (dx * dx + dy * dy) / (r.radius * r.radius);
        if (q < 1) h += r.height * (1 - q) * (1 - q);
    }
    if (t.torBox && inBox(t.torBox, x, y)) h += torLift(t, x, y);
    if (cliff.w > 0) h += cliff.w * cliff.h * (1 - smoothstep(120, 520, dc));
    return smax(h, 0.4, 0.8);
}

/** The land with the coast ramp but no rivers or towns (used to place towns and to set river levels). */
function landHeight(t, x, y) {
    const dc = coastDistance(t, x, y);
    if (dc <= 0) return seaFloor(dc);
    const cliff = cliffAt(t, x, y, { w: 0, h: 0 });
    return landShape(t, x, y, dc, cliff) * coastRamp(dc, cliff.w, 0, t.beach);
}

// ---- Tors ----------------------------------------------------------------------------------------------------------

/**
 * The granite tor of a chunk, if it has one: {x, y} or null. Shared by the chunk generator (which piles the rocks
 * there) and the heightfield (which raises a knoll under them). Only chunks whose centre is on a moor have tors.
 */
export function torSite(region, i, j) {
    const S = CHUNK_SIZE;
    const x0 = i * S, y0 = j * S;
    if (!moorAt(region, x0 + S / 2, y0 + S / 2)) return null;
    const rng = seededRng(hashSeed(region.seed, 'tor', i, j));
    if (rng() >= TOR_CHANCE) return null;
    return { x: x0 + range(rng, 30, S - 30), y: y0 + range(rng, 30, S - 30) };
}

function torLift(t, x, y) {
    const i0 = Math.floor(x / CHUNK_SIZE), j0 = Math.floor(y / CHUNK_SIZE);
    let h = 0;
    for (let i = i0 - 1; i <= i0 + 1; i++) {
        for (let j = j0 - 1; j <= j0 + 1; j++) {
            const key = (i + 32768) * 65536 + (j + 32768);
            let s = t.tors.get(key);
            if (s === undefined) t.tors.set(key, (s = torSite(t.region, i, j)));
            if (!s) continue;
            const dx = x - s.x, dy = y - s.y, q = (dx * dx + dy * dy) / (TOR_R * TOR_R);
            if (q < 1) h += (t.dem ? DEM_TOR_H : TOR_H) * (1 - q) * (1 - q);
        }
    }
    return h;
}

// ---- Towns ---------------------------------------------------------------------------------------------------------

/**
 * A town's pad height: the mean land height over its area (land samples only), but no more than TOWN_ABOVE_WATER
 * above the sea or a river within it (riverside and harbour towns sit by the water), and at least TOWN_MIN.
 */
function townBase(t, town) {
    let sum = 0, n = 0, water = Infinity;
    const q = { d: 0, w: 0, level: 0 };
    for (let k = -1; k < 16; k++) {
        const a = (k / 8) * Math.PI * 2, r = k < 0 ? 0 : town.radius * (k < 8 ? 0.5 : 0.9);
        const x = town.x + Math.cos(a) * r, y = town.y + Math.sin(a) * r;
        if (!isLand(t.region, x, y)) { water = 0; continue; }
        if (waterAt(t.region, x, y) > 0) {
            for (const river of t.rivers) if (riverQuery(river, x, y, q).d <= q.w / 2) water = Math.min(water, q.level);
            continue;
        }
        if (k < 8) { sum += landHeight(t, x, y); n++; }
    }
    const base = n ? sum / n : TOWN_MIN;
    return Math.max(TOWN_MIN, Math.min(base, water + TOWN_ABOVE_WATER));
}

/**
 * Neighbouring towns whose pads blend into each other get bases at most TOWN_GRADE apart per metre of gap between
 * their flat areas (equal if the flat areas touch), so the ground between them stays gentle. Fitted with the
 * lower/upper Lipschitz envelopes (their mean is the closest such fit).
 */
function relaxTownBases(towns) {
    const pairs = [];
    for (let i = 0; i < towns.length; i++) {
        for (let j = i + 1; j < towns.length; j++) {
            const a = towns[i], b = towns[j], d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < a.r2 + b.r2) pairs.push([i, j, TOWN_GRADE * Math.max(0, d - a.r1 - b.r1)]);
        }
    }
    const lo = towns.map(tw => tw.base), hi = lo.slice();
    for (let it = 0, changed = true; changed && it < towns.length; it++) {
        changed = false;
        for (const [i, j, w] of pairs) {
            if (lo[j] + w < lo[i]) { lo[i] = lo[j] + w; changed = true; }
            if (lo[i] + w < lo[j]) { lo[j] = lo[i] + w; changed = true; }
            if (hi[j] - w > hi[i]) { hi[i] = hi[j] - w; changed = true; }
            if (hi[i] - w > hi[j]) { hi[j] = hi[i] - w; changed = true; }
        }
    }
    towns.forEach((tw, k) => { tw.base = (lo[k] + hi[k]) / 2; });
}

/** Town pad weight (0-1) and height at a point; overlapping pads are averaged by weight. */
function townPad(t, x, y, out) {
    let wsum = 0, zsum = 0;
    for (const tw of t.towns) {
        const dx = x - tw.x, dy = y - tw.y;
        if (dx > tw.r2 || dx < -tw.r2 || dy > tw.r2 || dy < -tw.r2) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= tw.r2) continue;
        const w = 1 - smoothstep(tw.r1, tw.r2, d);
        wsum += w;
        zsum += w * tw.base;
    }
    out.w = Math.min(1, wsum);
    // a gentle swell (well under 1% slope) so town ground isn't perfectly flat
    out.z = wsum > 0 ? zsum / wsum + TOWN_WOBBLE * (smoothNoise(t.seed + 11, x / 520, y / 520) - 0.5) : 0;
    return out;
}

// ---- Rivers --------------------------------------------------------------------------------------------------------

/**
 * A river's segments plus its water level profile: from the source down, the running minimum of the land along
 * (and either side of) its course, kept below any town it passes through, never below 0, and 0 on the tidal
 * estuary with a gentle rise (TIDAL_GRADE) upstream of the tidal limit.
 */
function buildRiver(t, river) {
    const segs = [];
    let total = 0, wmax = 0;
    for (let k = 0; k + 1 < river.pts.length; k++) {
        const a = river.pts[k], b = river.pts[k + 1];
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
        segs.push({ ax: a.x, ay: a.y, dx, dy, inv: len ? 1 / (len * len) : 0, len, s0: total, wa: a.w, wb: b.w });
        total += len;
        wmax = Math.max(wmax, a.w, b.w);
    }
    const n = Math.max(1, Math.ceil(total / LEVEL_STEP));
    const step = total / n;
    const level = new Float64Array(n + 1);
    let run = Infinity, tidal = -1;
    for (let i = 0; i <= n; i++) {
        const s = i * step;
        const seg = segs.find(g => s <= g.s0 + g.len) ?? segs[segs.length - 1];
        const u = seg.len ? Math.min(1, Math.max(0, (s - seg.s0) / seg.len)) : 0;
        const x = seg.ax + seg.dx * u, y = seg.ay + seg.dy * u, w = seg.wa + (seg.wb - seg.wa) * u;
        const nx = seg.len ? -seg.dy / seg.len : 0, ny = seg.len ? seg.dx / seg.len : 0;
        const off = w / 2 + 6;
        const low = Math.min(landHeight(t, x, y), landHeight(t, x + nx * off, y + ny * off), landHeight(t, x - nx * off, y - ny * off));
        run = Math.min(run, low - 0.8);
        for (const tw of t.towns) if (Math.hypot(x - tw.x, y - tw.y) < tw.r2) run = Math.min(run, tw.base - TOWN_WOBBLE / 2 - BANK - 1);
        level[i] = Math.max(0, run);
        if (tidal < 0 && w >= TIDAL_W) tidal = s;
    }
    if (tidal >= 0) for (let i = 0; i <= n; i++) level[i] = Math.min(level[i], Math.max(0, tidal - i * step) * TIDAL_GRADE);
    const pts = river.pts.flatMap(p => [p.x, p.y]);
    return { id: river.id, segs, total, step, level, wmax, box: boxOf(pts, 0) };
}

/** Nearest point of a river to (x, y): distance from its centreline, its width and its water level there. */
function riverQuery(r, x, y, out) {
    let best = Infinity, bs = 0, bw = 0;
    for (const g of r.segs) {
        let u = ((x - g.ax) * g.dx + (y - g.ay) * g.dy) * g.inv;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const ex = g.ax + g.dx * u - x, ey = g.ay + g.dy * u - y;
        const d2 = ex * ex + ey * ey;
        if (d2 < best) { best = d2; bs = g.s0 + g.len * u; bw = g.wa + (g.wb - g.wa) * u; }
    }
    const f = Math.min(r.level.length - 1, bs / r.step);
    const i = Math.min(r.level.length - 2, Math.floor(f));
    out.d = Math.sqrt(best);
    out.w = bw;
    out.level = i < 0 ? r.level[0] : r.level[i] + (r.level[i + 1] - r.level[i]) * (f - i);
    return out;
}

const bedDepth = w => Math.min(3, Math.max(0.6, 0.5 + 0.03 * w));

/** The river bed under the water (d < w/2): a shallow parabola below the water level L. */
function bed(d, w, L) {
    const q = d / (w / 2);
    return L - bedDepth(w) * (1 - q * q);
}

/** Valley cross-section: the bed, a low bank, a flood plain (wider for wider rivers), then the valley side. */
function valleyZ(d, w, L) {
    const e = d - w / 2;
    if (e < 0) return bed(d, w, L);
    return L + BANK * smoothstep(0, 4, e) + VALLEY_SLOPE * Math.max(0, e - 4 - 0.4 * w);
}

/**
 * The channel alone: the bed, a low bank `bankW` wide, then a wall (cut after the town pads, so rivers keep their
 * banks in towns, where the bank is narrow and the wall is a quay).
 */
function channelZ(d, w, L, bankW) {
    const e = d - w / 2;
    if (e < 0) return bed(d, w, L);
    return L + BANK * smoothstep(0, bankW, e) + CHANNEL_SLOPE * Math.max(0, e - bankW);
}

// ---- The heightfield -----------------------------------------------------------------------------------------------

/**
 * Ground height (world metres above sea level) at a point, before roads and yards (see groundZ for the driven
 * surface). Deterministic: the same region data and position always give the same height. The sea is <= 0, and so
 * is the strip of land within SHORE metres of the coastline.
 */
export function terrainHeight(region, x, y) {
    const t = prep(region);
    const dc = coastDistance(t, x, y);
    if (dc <= 0) return seaFloor(dc);
    const cliff = cliffAt(t, x, y, t.cliff);
    let h = landShape(t, x, y, dc, cliff);
    // river valleys, skipping rivers too far away to reach this height: even the widest part of a river at level 0
    // only cuts below h + 2 (the smooth-min width) within valleyReach of its course
    for (let k = 0; k < t.rivers.length; k++) {
        const r = t.rivers[k], q = t.q[k];
        const reach = r.wmax * 0.9 + 4 + Math.max(0, h + 2 - BANK) / VALLEY_SLOPE;
        q.ok = boxDistanceSq(r.box, x, y) < reach * reach;
        if (!q.ok) continue;
        riverQuery(r, x, y, q);
        h = smin(h, valleyZ(q.d, q.w, q.level), 2);
    }
    const pad = townPad(t, x, y, t.pad);
    if (pad.w > 0) h += pad.w * (pad.z - h);
    // the channels, cut through the town pads too (with a narrow bank in towns: quays)
    const bankW = 4 - 3.2 * pad.w;
    for (let k = 0; k < t.rivers.length; k++) {
        const r = t.rivers[k], q = t.q[k];
        if (!q.ok) {
            const reach = r.wmax / 2 + 4 + Math.max(0, h - BANK) / CHANNEL_SLOPE;
            if (boxDistanceSq(r.box, x, y) >= reach * reach) continue;
            riverQuery(r, x, y, q);
        }
        const c = channelZ(q.d, q.w, q.level, bankW);
        if (c < h) h = c;
    }
    return h * coastRamp(dc, cliff.w, pad.w, t.beach);
}

/**
 * The water surface height at a point: 0 on the sea, the river's level on a river (rivers fall from their source
 * to 0 at the tidal estuary, so inland rivers sit above sea level), or null on dry land.
 */
export function waterLevel(region, x, y) {
    if (!isLand(region, x, y)) return 0;
    const t = prep(region);
    const q = { d: 0, w: 0, level: 0 };
    for (const r of t.rivers) {
        if (boxDistanceSq(r.box, x, y) > (r.wmax / 2) ** 2) continue;
        riverQuery(r, x, y, q);
        if (q.d <= q.w / 2) return q.level;
    }
    return null;
}

// ---- Road grading --------------------------------------------------------------------------------------------------

/** Steepest grade (rise per metre) allowed on each road class, when the region's seed gives no `maxGrade`. */
export const MAX_GRADE = { M: 0.05, dual: 0.06, A: 0.08, B: 0.1, street: 0.08, access: 0.08, lane: 0.12, ferry: 0.12 };
/** Profile sample spacing (m) and smoothing half-window (samples, i.e. +-16 m); node heights keep 3% off the limit. */
const ROAD_STEP = 4, SMOOTH = 4, NODE_SLACK = 0.97;
/** Flat approach at junctions (beyond the widest road's half-width) and into yards. */
const JUNCTION_FLAT = 2, YARD_FLAT = 4;
/** Height a road may change per metre along a town pad (the pad's swell is well under this). */
const TOWN_SWELL = 0.01;
/** Ground beside a road or yard blends back to the land over BLEND_MIN + 1.5x the cut/fill depth, up to a limit. */
const BLEND_MIN = 4, BLEND_MAX = 20, PAD_MARGIN = 2, PAD_BLEND_MAX = 25, PAD_RANK = 64;
/** Yards whose pads come within PAD_LINK m of each other differ in height by at most PAD_GRADE per metre of gap. */
const PAD_LINK = 30, PAD_GRADE = 0.02;
/** Bridge decks stay at least this far above the water. */
const DECK_CLEARANCE = 1;
const ROAD_REACH = ROAD_CLASS.M.width / 2 + 0.5 + BLEND_MAX;

const classesOf = e => [e.cls, ...(e.upgrades ?? []).map(u => u.class)];
/** Half the widest carriageway an edge ever has (roads are graded once, for every era), plus the kerb. */
const halfWidthOf = e => Math.max(...classesOf(e).map(c => (ROAD_CLASS[c]?.width ?? 7) / 2)) + 0.5;

/** The steepest grade an edge may have: the strictest of its classes over the years (an A-road later dualled uses dual's). */
export function gradeLimit(region, edge) {
    const table = region.maxGrade ?? {};
    return Math.min(...classesOf(edge).map(c => table[c] ?? MAX_GRADE[c] ?? 0.08));
}

/** A small binary min-heap of (key, id). */
function createHeap() {
    const keys = [], ids = [];
    const swap = (i, j) => { [keys[i], keys[j]] = [keys[j], keys[i]]; [ids[i], ids[j]] = [ids[j], ids[i]]; };
    return {
        get size() { return keys.length; },
        push(k, id) {
            keys.push(k); ids.push(id);
            for (let i = keys.length - 1; i > 0;) {
                const p = (i - 1) >> 1;
                if (keys[p] <= keys[i]) break;
                swap(i, p); i = p;
            }
        },
        /** Removes the smallest entry; returns its id (its key is left in `top`). */
        pop() {
            const id = ids[0];
            this.top = keys[0];
            const k = keys.pop(), last = ids.pop();
            if (keys.length) {
                keys[0] = k; ids[0] = last;
                for (let i = 0; ;) {
                    const l = 2 * i + 1, r = l + 1;
                    let m = i;
                    if (l < keys.length && keys[l] < keys[m]) m = l;
                    if (r < keys.length && keys[r] < keys[m]) m = r;
                    if (m === i) break;
                    swap(i, m); i = m;
                }
            }
            return id;
        },
        top: 0,
    };
}

/**
 * Lipschitz envelope of node targets over the graph (edge weights = the most height an edge can climb): sign 1
 * gives the lower envelope min_u(t(u) + dist(u, v)), sign -1 the upper one max_u(t(u) - dist(u, v)). Dijkstra
 * with every node as a source.
 */
function envelope(target, adj, sign) {
    const val = target.map(t => sign * t);
    const heap = createHeap();
    val.forEach((v, id) => heap.push(v, id));
    while (heap.size) {
        const v = heap.pop();
        if (heap.top > val[v]) continue;
        for (const [u, w] of adj[v]) {
            const c = val[v] + w;
            if (c < val[u]) { val[u] = c; heap.push(c, u); }
        }
    }
    return val.map(v => sign * v);
}

/**
 * Keeps nodes on a town's flat pad at their own height: every other node's target is clamped into the range the
 * town nodes allow (their Lipschitz bounds), so roads climbing out of a town take the cut and fill outside it
 * rather than lifting the town end. (If the town nodes alone conflict, those nodes are left unclamped.)
 */
function pinTownNodes(region, nodes, target, adj) {
    const t = prep(region), pad = { w: 0, z: 0 };
    const pinned = nodes.map(n => townPad(t, n.x, n.y, pad).w >= 1);
    if (!pinned.some(Boolean)) return;
    const FREE = 1e9;
    const upper = envelope(target.map((v, k) => (pinned[k] ? v : FREE)), adj, 1);
    const lower = envelope(target.map((v, k) => (pinned[k] ? v : -FREE)), adj, -1);
    for (let k = 0; k < target.length; k++) {
        if (!pinned[k] && lower[k] <= upper[k]) target[k] = Math.max(lower[k], Math.min(upper[k], target[k]));
    }
}

const roadPad = { w: 0, z: 0 };

/**
 * The height a road wants on dry land: the land, except on a town's flat pad, where it is the pad itself (streets
 * run level along the quays and river walls rather than dipping down them). `pin` reports a town-pad point;
 * `land` is terrainHeight there if the caller already has it.
 */
function roadTarget(region, x, y, pin = null, land = undefined) {
    const pad = townPad(prep(region), x, y, roadPad);
    const onPad = pad.w >= 1;
    if (pin) pin.on = onPad;
    if (onPad) return pad.z;
    return land ?? terrainHeight(region, x, y);
}

/** Roughly how much of an edge lies on a town's flat pad (sampled every ~8 m). */
function townLength(region, e) {
    const n = Math.max(1, Math.ceil(e.len / 8));
    const xs = new Float64Array(n + 1), ys = new Float64Array(n + 1);
    samplePolyline(e.pts, e.len, n, xs, ys);
    const t = prep(region);
    let on = 0;
    for (let i = 0; i <= n; i++) if (townPad(t, xs[i], ys[i], roadPad).w >= 1) on++;
    return (e.len * on) / (n + 1);
}

/**
 * The height a node should have before grading: see roadTarget (the pad height anywhere on a town pad), and just
 * above the water for any other node over water.
 */
function nodeTarget(region, x, y) {
    const pin = { on: false };
    const h = roadTarget(region, x, y, pin);
    if (pin.on || !(waterAt(region, x, y) > 0)) return h;
    return Math.max(h, (waterLevel(region, x, y) ?? 0) + DECK_CLEARANCE);
}

/** Positions every `L/n` metres along a flat polyline (n + 1 of them, both ends included). */
function samplePolyline(pts, len, n, xs, ys) {
    let seg = 0, acc = 0;
    for (let i = 0; i <= n; i++) {
        const s = (len * i) / n;
        for (;;) {
            const dx = pts[2 * seg + 2] - pts[2 * seg], dy = pts[2 * seg + 3] - pts[2 * seg + 1];
            const sl = Math.hypot(dx, dy);
            if (acc + sl >= s || 2 * seg + 4 >= pts.length) {
                const u = sl ? Math.max(0, Math.min(1, (s - acc) / sl)) : 0;
                xs[i] = pts[2 * seg] + dx * u;
                ys[i] = pts[2 * seg + 1] + dy * u;
                break;
            }
            acc += sl;
            seg++;
        }
    }
}

/**
 * Narrows an edge's cones so samples on a town pad keep their target height exactly (and the samples around them
 * stay within reach of it at `dz` per sample): a road leaving town climbs outside it rather than lifting the street.
 * Leaves the cones alone if the pins cannot all be met.
 */
function pinToTown(target, pinned, lo, hi, dz) {
    const n = target.length - 1;
    // a pin outside its own cone (e.g. in a junction's landing, held at the node's height) is dropped; pins inside
    // their cones always leave room at every other sample, the cones being as steep as the pins' reach
    for (let i = 0; i <= n; i++) if (pinned[i] && (target[i] < lo[i] - 1e-9 || target[i] > hi[i] + 1e-9)) pinned[i] = 0;
    if (!pinned.some(Boolean)) return;
    const upper = new Float64Array(n + 1).fill(Infinity), lower = new Float64Array(n + 1).fill(-Infinity);
    for (let i = 0; i <= n; i++) if (pinned[i]) upper[i] = lower[i] = target[i];
    for (let i = 1; i <= n; i++) { upper[i] = Math.min(upper[i], upper[i - 1] + dz); lower[i] = Math.max(lower[i], lower[i - 1] - dz); }
    for (let i = n - 1; i >= 0; i--) { upper[i] = Math.min(upper[i], upper[i + 1] + dz); lower[i] = Math.max(lower[i], lower[i + 1] - dz); }
    for (let i = 0; i <= n; i++) if (Math.max(lo[i], lower[i]) > Math.min(hi[i], upper[i]) + 1e-9) return;
    for (let i = 0; i <= n; i++) { lo[i] = Math.max(lo[i], lower[i]); hi[i] = Math.min(hi[i], upper[i]); }
}

/**
 * The centreline profile of one edge between its node heights zA and zB. The land along the edge is the target;
 * stretches over water (bridges) get a straight deck between the banks, above the water. The profile must stay in
 * the cones from the fixed ends (flat landings at junctions, then at most g per metre); within them it is the
 * mean of the lower and upper Lipschitz envelopes of the target (cutting and filling equally), smoothed (+-16 m)
 * and clamped back into the cones. Every step keeps the grade <= g, so the stored profile never exceeds it.
 */
function gradeEdge(region, e, zA, zB, { g, la, lb, linear }) {
    const L = e.len;
    const n = Math.max(1, Math.ceil(L / ROAD_STEP));
    const step = L / n;
    const xs = new Float64Array(n + 1), ys = new Float64Array(n + 1), ground = new Float64Array(n + 1);
    samplePolyline(e.pts, L, n, xs, ys);
    for (let i = 0; i <= n; i++) ground[i] = terrainHeight(region, xs[i], ys[i]);
    const z = new Float64Array(n + 1);
    let spans = [];
    if (linear) {
        for (let i = 0; i <= n; i++) z[i] = zA + ((zB - zA) * i) / n;
        spans = [[0, n]];
    } else {
        const target = new Float64Array(n + 1), pinned = new Uint8Array(n + 1), wet = new Uint8Array(n + 1), pin = { on: false };
        for (let i = 1; i < n; i++) {
            wet[i] = waterAt(region, xs[i], ys[i]) > 0 ? 1 : 0;
            target[i] = roadTarget(region, xs[i], ys[i], pin, ground[i]);
            pinned[i] = pin.on && !wet[i] ? 1 : 0;
        }
        target[0] = zA;
        target[n] = zB;
        // bridges: runs of samples over water get a straight deck between the banks (the ends are nodes, never runs)
        const runs = [];
        for (let i = 1; i < n; i++) {
            if (!wet[i]) continue;
            let j = i;
            while (j + 1 < n && wet[j + 1]) j++;
            let lvl = 0;
            for (let k = i; k <= j; k++) lvl = Math.max(lvl, waterLevel(region, xs[k], ys[k]) ?? 0);
            // abutments: the higher of the two dry samples nearest the water (the bank's foot can be a low strip)
            const ia = i - 1, ib = j + 1, deck = lvl + DECK_CLEARANCE;
            if (ia > 0) target[ia] = Math.max(target[ia], target[ia - 1], deck);
            if (ib < n) target[ib] = Math.max(target[ib], target[ib + 1], deck);
            for (let k = i; k <= j; k++) target[k] = target[ia] + ((target[ib] - target[ia]) * (k - ia)) / (ib - ia);
            runs.push([ia, ib]);
            i = j;
        }
        // a bridge landing on a junction: the junction's flat starts at the abutment (the deck can then stay
        // straight; the node heights allowed for the longer ramp, so this always fits)
        let flatA = la, flatB = lb;
        for (const [ia, ib] of runs) {
            flatA = Math.min(flatA, ia * step);
            if (ib * step > L - flatB) flatB = L - ib * step;
        }
        // the cones from the fixed ends (flat for flatA / flatB metres, then climbing at most g per metre)
        const lo = new Float64Array(n + 1), hi = new Float64Array(n + 1);
        for (let i = 0; i <= n; i++) {
            const ra = g * Math.max(0, i * step - flatA), rb = g * Math.max(0, L - i * step - flatB);
            lo[i] = Math.max(zA - ra, zB - rb);
            hi[i] = Math.min(zA + ra, zB + rb);
            if (lo[i] > hi[i]) lo[i] = hi[i] = (lo[i] + hi[i]) / 2; // only if the node heights were infeasible
        }
        const dz = g * step;
        pinToTown(target, pinned, lo, hi, dz);
        const clampTo = (v, i) => Math.max(lo[i], Math.min(hi[i], v));
        const up = new Float64Array(n + 1), down = new Float64Array(n + 1);
        for (let i = 0; i <= n; i++) up[i] = down[i] = clampTo(target[i], i);
        for (let i = 1; i <= n; i++) { up[i] = Math.min(up[i], up[i - 1] + dz); down[i] = Math.max(down[i], down[i - 1] - dz); }
        for (let i = n - 1; i >= 0; i--) { up[i] = Math.min(up[i], up[i + 1] + dz); down[i] = Math.max(down[i], down[i + 1] - dz); }
        // up is the lower envelope, down the upper one; their mean, smoothed with the ends held
        for (let i = 0; i <= n; i++) {
            let sum = 0;
            for (let k = -SMOOTH; k <= SMOOTH; k++) {
                const j = Math.max(0, Math.min(n, i + k));
                sum += (up[j] + down[j]) / 2;
            }
            z[i] = clampTo(sum / (2 * SMOOTH + 1), i);
        }
        // bridge decks dead straight between their abutments
        for (const [ia, ib] of runs) for (let k = ia + 1; k < ib; k++) z[k] = clampTo(z[ia] + ((z[ib] - z[ia]) * (k - ia)) / (ib - ia), k);
        spans = runs;
    }
    const cum = new Float64Array(e.pts.length / 2);
    for (let k = 1; k < cum.length; k++) cum[k] = cum[k - 1] + Math.hypot(e.pts[2 * k] - e.pts[2 * k - 2], e.pts[2 * k + 1] - e.pts[2 * k - 1]);
    e.z = Float32Array.from(z);
    e.zStep = step;
    e.zFill = Float32Array.from(z, (v, i) => v - ground[i]); // + embankment, - cutting
    e.zBridges = spans; // [first, last] sample pairs of straight decks: over water, or the whole of a bridge/ferry edge
    e.zCum = cum;
    e.zHalf = halfWidthOf(e);
    e.maxGrade = g;
}

/**
 * Height of an edge's graded centreline `t` metres along it from its `a` end (clamped to the edge). Roads are
 * level across: this is the deck height anywhere on the carriageway at that distance.
 */
export function roadHeightAt(edge, t) {
    return sampleProfile(edge.z, edge.zStep, t);
}

/**
 * Grade of an edge's graded centreline (rise per metre going a -> b; negate it travelling b -> a) at `t` metres
 * from its `a` end, measured over +-`span` m. 0 on an ungraded edge.
 */
export function roadGradeAt(edge, t, span = 4) {
    if (!edge.z || !(edge.zStep > 0)) return 0;
    const t0 = Math.max(0, t - span), t1 = Math.min(edge.len, t + span);
    return t1 > t0 ? (roadHeightAt(edge, t1) - roadHeightAt(edge, t0)) / (t1 - t0) : 0;
}

function sampleProfile(z, step, t) {
    if (!z) return 0;
    if (!(step > 0)) return z[0];
    const f = Math.max(0, Math.min(z.length - 1, t / step));
    const i = Math.min(z.length - 2, Math.floor(f));
    return z[i] + (z[i + 1] - z[i]) * (f - i);
}

/** Distance from a point to an OBB (0 inside). */
function obbDistance(b, x, y) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    const lx = (x - b.x) * c + (y - b.y) * s, ly = -(x - b.x) * s + (y - b.y) * c;
    return Math.hypot(Math.max(0, Math.abs(lx) - b.hx), Math.max(0, Math.abs(ly) - b.hy));
}

const grown = (b, m) => ({ x: b.x, y: b.y, hx: b.hx + m, hy: b.hy + m, angle: b.angle });
const PAD_CELL = 64;
const padKey = (i, j) => (i + 32768) * 65536 + (j + 32768);

const cornersOf = b => {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    return [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([u, v]) => ({ x: b.x + u * b.hx * c - v * b.hy * s, y: b.y + u * b.hx * s + v * b.hy * c }));
};

/** Gap between two OBBs: 0 when they overlap, else (near enough for yards) the nearest corner of either to the other. */
function boxGap(a, b) {
    if (sat(a, b)) return 0;
    let gap = Infinity;
    for (const p of cornersOf(a)) gap = Math.min(gap, obbDistance(b, p.x, p.y));
    for (const p of cornersOf(b)) gap = Math.min(gap, obbDistance(a, p.x, p.y));
    return gap;
}

/**
 * The pads under every yard (depots, sites, farms, garages, the practice yard): the yard zone and its buildings.
 * Their heights come later (the yard's road node height). Also returns links between the nodes of yards whose pads
 * touch or nearly do (yards can overlap): the node grading keeps those within PAD_GRADE per metre of gap.
 */
function padShapes(world) {
    const owners = [...world.yards, ...(world.practice ? [world.practice] : [])];
    const pads = owners.filter(o => o.yard?.zone).map(o => ({
        owner: o.id, node: o.node, z: 0, blend: 0,
        boxes: [grown(o.yard.zone, PAD_MARGIN), ...(o.buildings ?? []).map(b => grown(b.box, 1))],
    }));
    const links = [];
    for (let i = 0; i < pads.length; i++) {
        for (let j = i + 1; j < pads.length; j++) {
            const a = pads[i], b = pads[j];
            if (a.node === undefined || b.node === undefined || Math.hypot(a.boxes[0].x - b.boxes[0].x, a.boxes[0].y - b.boxes[0].y) > 200) continue;
            let gap = Infinity;
            for (const p of a.boxes) for (const q of b.boxes) gap = Math.min(gap, boxGap(p, q));
            if (gap < PAD_LINK) links.push([a.node, b.node, PAD_GRADE * gap]);
        }
    }
    return { pads, links };
}

/** Sets each pad's height (its yard node's, or the land for the practice yard), blend width and spatial cells. */
function placePads(world, pads) {
    const { region, graph } = world;
    const cells = new Map();
    for (const pad of pads) {
        const first = pad.boxes[0];
        pad.z = pad.node !== undefined ? graph.nodes[pad.node].z : terrainHeight(region, first.x, first.y);
        // blend width from how far the pad sits above or below the land at its corners
        let dev = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const b of pad.boxes) {
            for (const p of cornersOf(b)) {
                dev = Math.max(dev, Math.abs(pad.z - terrainHeight(region, p.x, p.y)));
                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            }
        }
        pad.blend = Math.min(PAD_BLEND_MAX, BLEND_MIN + 1.5 * dev);
        for (let i = Math.floor((minX - pad.blend) / PAD_CELL); i <= Math.floor((maxX + pad.blend) / PAD_CELL); i++) {
            for (let j = Math.floor((minY - pad.blend) / PAD_CELL); j <= Math.floor((maxY + pad.blend) / PAD_CELL); j++) {
                const k = padKey(i, j);
                (cells.get(k) ?? cells.set(k, []).get(k)).push(pad);
            }
        }
    }
    return { pads, cells };
}

/**
 * Grades the whole road network once (call after the graph is final): node heights first, as the closest fit to
 * the land under each edge's grade limit (|za - zb| <= limit x ramp length), then a centreline profile per edge
 * (`edge.z`, samples every `edge.zStep` m; see roadHeightAt), then the yard pads. Sets `node.z` and
 * `world.terrain` (used by groundZ).
 */
export function gradeRoads(world) {
    const { region, graph } = world;
    const { nodes, edges } = graph;
    const landing = nodes.map(n => {
        if (n.edges.length >= 3) return Math.max(...n.edges.map(id => halfWidthOf(edges[id]))) + JUNCTION_FLAT;
        if (n.edges.length === 1 && (n.kind === 'depot' || n.kind === 'site' || n.kind === 'farm')) return YARD_FLAT;
        return 0;
    });
    const info = edges.map(e => {
        const linear = !!e.bridge || e.cls === 'ferry';
        const la = linear ? 0 : Math.min(landing[e.a], 0.4 * e.len), lb = linear ? 0 : Math.min(landing[e.b], 0.4 * e.len);
        const g = gradeLimit(region, e);
        // the stretch on a town pad stays on it (pinned in gradeEdge), so only the rest can climb
        const town = linear ? 0 : townLength(region, e);
        return { g, la, lb, linear, w: NODE_SLACK * g * Math.max(0, e.len - la - lb - town) + TOWN_SWELL * town };
    });
    const target = nodes.map(n => nodeTarget(region, n.x, n.y));
    // a bridge over water has a straight deck between its two end nodes, so both must stand clear of the water
    for (const e of edges) {
        if (!e.bridge || e.cls === 'ferry') continue;
        const n = Math.max(1, Math.ceil(e.len / 2)), xs = new Float64Array(n + 1), ys = new Float64Array(n + 1);
        samplePolyline(e.pts, e.len, n, xs, ys);
        let lvl = -Infinity;
        for (let i = 0; i <= n; i++) if (waterAt(region, xs[i], ys[i]) > 0) lvl = Math.max(lvl, waterLevel(region, xs[i], ys[i]) ?? 0);
        if (lvl > -Infinity) for (const id of [e.a, e.b]) target[id] = Math.max(target[id], lvl + DECK_CLEARANCE);
    }
    const adj = nodes.map(n => n.edges.map(id => [graph.other(edges[id], n.id), info[id].w]));
    // yards whose pads touch are tied together so neither is left tilting into the other
    const { pads, links } = padShapes(world);
    for (const [a, b, w] of links) { adj[a].push([b, w]); adj[b].push([a, w]); }
    pinTownNodes(region, nodes, target, adj);
    const lo = envelope(target, adj, 1), hi = envelope(target, adj, -1);
    for (const n of nodes) n.z = (lo[n.id] + hi[n.id]) / 2;
    edges.forEach((e, k) => gradeEdge(region, e, nodes[e.a].z, nodes[e.b].z, info[k]));
    world.terrain = placePads(world, pads);
    return world.terrain;
}

// ---- The driven surface --------------------------------------------------------------------------------------------

const near = [];
const hitEdge = [], hitD = [], hitAlong = [];

/**
 * Height of the surface vehicles drive on: the road deck on a road (bridges included), the pad in a yard, the land
 * elsewhere, blended smoothly across road shoulders and yard edges. With `decks` false, water is never bridged (the
 * river bed or sea floor under a bridge), for the ground mesh. Needs gradeRoads (createWorld runs it).
 */
export function groundZ(world, x, y, decks = true) {
    const T = world.terrain, region = world.region;
    if (!T || (!decks && waterAt(region, x, y) > 0)) return terrainHeight(region, x, y);
    // each edge's nearest point within reach
    let m = 0;
    const graph = world.graph;
    for (const s of graph.index.near(x, y, ROAD_REACH, near)) {
        const e = graph.edges[s.edge];
        if (!e.z) continue;
        const p = e.pts, k = 2 * s.seg;
        const ax = p[k], ay = p[k + 1], dx = p[k + 2] - ax, dy = p[k + 3] - ay;
        const l2 = dx * dx + dy * dy;
        const u = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
        const d = Math.hypot(ax + dx * u - x, ay + dy * u - y);
        if (d >= e.zHalf + BLEND_MAX) continue;
        let h = 0;
        while (h < m && hitEdge[h] !== s.edge) h++;
        if (h === m) { hitEdge[m] = s.edge; hitD[m] = Infinity; m++; }
        if (d < hitD[h]) { hitD[h] = d; hitAlong[h] = e.zCum[s.seg] + Math.sqrt(l2) * u; }
    }
    let wmax = 0, osum = 0, zsum = 0;
    // `out`: metres beyond the flat surface (<= 0 on it); the surface you are on dominates, nearer ones next, and a
    // yard pad outranks a road that strays onto it so the yard stays level
    const add = (z, out, blend, rank) => {
        if (out >= blend) return;
        const w = out <= 0 ? 1 : 1 - smoothstep(0, blend, out);
        const o = (rank * w) / (Math.max(out, 0) + 0.25) ** 4;
        wmax = Math.max(wmax, w);
        osum += o;
        zsum += o * z;
    };
    for (let h = 0; h < m; h++) {
        const e = graph.edges[hitEdge[h]];
        const fill = sampleProfile(e.zFill, e.zStep, hitAlong[h]);
        add(roadHeightAt(e, hitAlong[h]), hitD[h] - e.zHalf, Math.min(BLEND_MAX, BLEND_MIN + 1.5 * Math.abs(fill)), 1);
    }
    const list = T.cells.get(padKey(Math.floor(x / PAD_CELL), Math.floor(y / PAD_CELL)));
    if (list) {
        for (const pad of list) {
            let out = Infinity;
            for (const b of pad.boxes) out = Math.min(out, obbDistance(b, x, y));
            add(pad.z, out, pad.blend, PAD_RANK);
        }
    }
    if (wmax === 0) return terrainHeight(region, x, y);
    const z = zsum / osum;
    if (wmax >= 1) return z;
    const land = terrainHeight(region, x, y);
    return land + wmax * (z - land);
}

/**
 * The deck height of the road under or within `reach` m of the carriageway edge at (x, y), or null when none is that
 * close (the nearest road wins). The ground mesh uses it to keep its coarse cells from rising above a road.
 */
export function roadDeckNear(world, x, y, reach) {
    const graph = world.graph;
    let best = null, bestOut = Infinity;
    for (const s of graph.index.near(x, y, reach + ROAD_CLASS.M.width / 2 + 1, near)) {
        const e = graph.edges[s.edge];
        if (!e.z) continue;
        const p = e.pts, k = 2 * s.seg;
        const ax = p[k], ay = p[k + 1], dx = p[k + 2] - ax, dy = p[k + 3] - ay;
        const l2 = dx * dx + dy * dy;
        const u = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
        const out = Math.hypot(ax + dx * u - x, ay + dy * u - y) - e.zHalf;
        if (out < reach && out < bestOut) { bestOut = out; best = roadHeightAt(e, e.zCum[s.seg] + Math.sqrt(l2) * u); }
    }
    return best;
}

// ---- Slopes --------------------------------------------------------------------------------------------------------

/**
 * Slope of a height function `sample(x, y)` under a footprint centred at (x, y) and facing `heading` (radians,
 * 0 = east, +y south), by central differences between its front and rear (`length` apart) and its left and right
 * (`width` apart). Returns {grade, pitch, roll, nx, ny, nz, z}:
 * - grade: rise per metre straight ahead (+ uphill, - downhill); pitch = atan(grade) (+ nose up);
 * - roll = atan(cross-slope), + when the right side is lower than the left (leaning right);
 * - (nx, ny, nz): the unit ground normal (nz > 0) from the fitted plane; z: the plane's height at the centre.
 */
export function slopeFrom(sample, x, y, heading, length = 4, width = 2) {
    const c = Math.cos(heading), s = Math.sin(heading);
    const hl = length / 2, hw = width / 2;
    // left of the heading is (sin h, -cos h) in world axes (+y south), as in roadgraph's lanePoint
    const front = sample(x + c * hl, y + s * hl), rear = sample(x - c * hl, y - s * hl);
    const left = sample(x + s * hw, y - c * hw), right = sample(x - s * hw, y + c * hw);
    const grade = (front - rear) / length, cross = (left - right) / width;
    // the world gradient from the two directional derivatives (ahead and left are orthonormal)
    const gx = grade * c + cross * s, gy = grade * s - cross * c;
    const inv = 1 / Math.hypot(gx, gy, 1);
    return { grade, pitch: Math.atan(grade), roll: Math.atan(cross), nx: -gx * inv, ny: -gy * inv, nz: inv, z: (front + rear + left + right) / 4 };
}

const MEMO = 8;
const memos = new WeakMap();

/**
 * Ground slope under a vehicle (see slopeFrom), on the driven surface (groundZ). Footprint defaults suit a car;
 * pass a vehicle's wheelbase/track. The last few results are memoised by exact arguments, so the physics, the HUD
 * and the renderer asking about the same pose in one frame pay once.
 */
export function slopeAt(world, x, y, heading, length = 4, width = 2) {
    let memo = memos.get(world);
    if (!memo) memos.set(world, (memo = { list: [], sample: (px, py) => groundZ(world, px, py) }));
    for (const m of memo.list) {
        if (m.x === x && m.y === y && m.heading === heading && m.length === length && m.width === width) return { ...m.result };
    }
    const result = slopeFrom(memo.sample, x, y, heading, length, width);
    memo.list.unshift({ x, y, heading, length, width, result });
    if (memo.list.length > MEMO) memo.list.pop();
    return { ...result };
}

// ---- Chunks --------------------------------------------------------------------------------------------------------

/** Samples per side of a chunk's height grid: 17 at CHUNK_SIZE 160 is every 10 m, edges shared with neighbours. */
export const GRID_N = 17;

/**
 * A chunk's height grid: GRID_N x GRID_N samples of the ground (groundZ without bridge decks: the river bed under a
 * bridge), every `step` m from the chunk's corner (x0, y0), row-major: z[j * n + i] is at (x0 + i * step, y0 + j * step).
 */
export function chunkHeights(world, ci, cj) {
    const n = GRID_N, step = CHUNK_SIZE / (n - 1);
    const x0 = ci * CHUNK_SIZE, y0 = cj * CHUNK_SIZE;
    const z = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z[j * n + i] = groundZ(world, x0 + i * step, y0 + j * step, false);
    return { n, step, x0, y0, z };
}

/** Bilinear height from a chunk height grid (clamped to the chunk). */
export function gridHeight(grid, x, y) {
    const { n, step, x0, y0, z } = grid;
    const fx = Math.max(0, Math.min(n - 1, (x - x0) / step)), fy = Math.max(0, Math.min(n - 1, (y - y0) / step));
    const i = Math.min(n - 2, Math.floor(fx)), j = Math.min(n - 2, Math.floor(fy));
    const u = fx - i, v = fy - j;
    const a = z[j * n + i], b = z[j * n + i + 1], c = z[(j + 1) * n + i], d = z[(j + 1) * n + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Lowest ground under a footprint (its corners and centre), so a building's base never floats on a slope. */
function footprintZ(world, box) {
    let z = groundZ(world, box.x, box.y);
    const c = Math.cos(box.angle), s = Math.sin(box.angle);
    for (const [u, v] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        z = Math.min(z, groundZ(world, box.x + u * box.hx * c - v * box.hy * s, box.y + u * box.hx * s + v * box.hy * c));
    }
    return z;
}

/**
 * Gives a freshly generated chunk its terrain: a `z` (ground height) on its buildings (the lowest ground under the
 * footprint), trees, rocks, lamps and signs, and a `terrain` height grid (chunkHeights), built on first access and
 * then kept with the chunk (the Canvas renderer never asks for it). Buildings are shared between regenerations of a
 * chunk, so theirs is set once.
 */
export function attachTerrain(world, chunk) {
    for (const b of chunk.buildings) b.z ??= footprintZ(world, b.box);
    for (const list of [chunk.trees, chunk.rocks, chunk.lamps, chunk.signs]) for (const o of list) o.z = groundZ(world, o.x, o.y);
    let grid = null;
    Object.defineProperty(chunk, 'terrain', { get: () => (grid ??= chunkHeights(world, chunk.i, chunk.j)), configurable: true });
    return chunk;
}

/** Unit normal of the driven surface at a point (+z up), by central differences 1 m either side. */
export function groundNormal(world, x, y, out = { nx: 0, ny: 0, nz: 1 }) {
    const gx = (groundZ(world, x + 1, y) - groundZ(world, x - 1, y)) / 2;
    const gy = (groundZ(world, x, y + 1) - groundZ(world, x, y - 1)) / 2;
    const inv = 1 / Math.hypot(gx, gy, 1);
    out.nx = -gx * inv;
    out.ny = -gy * inv;
    out.nz = inv;
    return out;
}
