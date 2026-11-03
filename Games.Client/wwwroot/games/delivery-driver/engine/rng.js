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
