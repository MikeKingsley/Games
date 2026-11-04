// Deterministic randomness. Every random choice in the game goes through these (same mulberry32 algorithm as
// animal-feeding/logic.js), so the same seed always gives the same world, contracts and weather.

export function seededRng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Mixes integers and strings into one 32-bit seed (e.g. hashSeed(regionSeed, 'chunk', i, j)). */
export function hashSeed(...parts) {
    let h = 2166136261 >>> 0;
    for (const part of parts) {
        const s = String(part);
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        h ^= 0x9e3779b9;
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

export const range = (rng, lo, hi) => lo + (hi - lo) * rng();
export const intRange = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
export const pick = (rng, list) => list[Math.floor(rng() * list.length)];
export const chance = (rng, p) => rng() < p;

/** Smooth 2D value noise in [0, 1] (for woods, field colours and weather). */
export function valueNoise(seed, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const h = (i, j) => (hashSeed(seed, i, j) & 0xffff) / 0xffff;
    const s = t => t * t * (3 - 2 * t);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    const u = s(xf), v = s(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** 32-bit integer hash of a seed and a lattice point, in [0, 1]. */
function latticeHash(seed, i, j) {
    let h = (seed ^ Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/**
 * The same smooth value noise as valueNoise (in [0, 1]) but on an integer lattice hash, ~10x faster: for the
 * terrain heightfield, which is sampled ~10^5 times when a world is built. A different hash, so different values.
 */
export function smoothNoise(seed, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = latticeHash(seed, xi, yi), b = latticeHash(seed, xi + 1, yi);
    const c = latticeHash(seed, xi, yi + 1), d = latticeHash(seed, xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
