// Seeded, tileable value noise. DOM-free so it can be unit tested; textures.js paints it to canvases.

/** FNV-1a hash of a string (or number) to an unsigned 32-bit integer. */
export function hash(str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** Deterministic random generator (mulberry32): rng(seed)() returns numbers in [0, 1). A string seed is hashed first. */
export function rng(seed) {
    let a = (typeof seed === 'string' ? hash(seed) : seed >>> 0) || 1;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const smooth = t => t * t * (3 - 2 * t);

/**
 * size x size values in 0..1 (row-major Float32Array) that tile seamlessly: every octave is a periodic lattice, so the value one
 * step past the right/bottom edge equals the value on the left/top edge. Octave k has 4 * 2^k lattice cells per side.
 */
export function tileNoise(size, seed = 1, octaves = 4) {
    const out = new Float32Array(size * size);
    const rand = rng(seed);
    let amp = 1, total = 0;
    for (let o = 0; o < octaves; o++) {
        const cells = 4 << o;
        const lat = new Float32Array(cells * cells);
        for (let i = 0; i < lat.length; i++) lat[i] = rand();
        const step = cells / size;
        for (let y = 0; y < size; y++) {
            const fy = y * step, y0 = Math.floor(fy), ty = smooth(fy - y0), ya = y0 % cells, yb = (y0 + 1) % cells;
            for (let x = 0; x < size; x++) {
                const fx = x * step, x0 = Math.floor(fx), tx = smooth(fx - x0), xa = x0 % cells, xb = (x0 + 1) % cells;
                const top = lat[ya * cells + xa] + (lat[ya * cells + xb] - lat[ya * cells + xa]) * tx;
                const bot = lat[yb * cells + xa] + (lat[yb * cells + xb] - lat[yb * cells + xa]) * tx;
                out[y * size + x] += (top + (bot - top) * ty) * amp;
            }
        }
        total += amp;
        amp *= 0.5;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
}
