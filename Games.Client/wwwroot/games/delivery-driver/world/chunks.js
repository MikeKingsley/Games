// Chunk cache: chunks are generated on demand, kept in least-recently-used order and evicted past a cap.
// Loaded chunks register their colliders (buildings, trees, rocks) in the world's static collision hash, and carry
// their terrain (object heights and a lazily built height grid, see world/terrain.js attachTerrain).
import { CHUNK_SIZE } from '../config.js';
import { generateChunk } from './generator.js';
import { attachTerrain } from './terrain.js';

const key = (i, j) => (i + 32768) * 65536 + (j + 32768);

export function createChunks(world, { cap = 160, onEvict = null } = {}) {
    const cache = new Map();
    const chunks = {
        cache,
        cap,
        generated: 0,
        get(i, j) {
            const k = key(i, j);
            let c = cache.get(k);
            if (c) {
                cache.delete(k);
                cache.set(k, c); // most recently used goes to the end
                return c;
            }
            c = attachTerrain(world, generateChunk(world, i, j));
            chunks.generated++;
            cache.set(k, c);
            for (const col of c.colliders) world.colliders.insert(col);
            while (cache.size > chunks.cap) chunks.evict(cache.keys().next().value);
            return c;
        },
        has: (i, j) => cache.has(key(i, j)),
        evict(k) {
            const c = cache.get(k);
            if (!c) return;
            for (const col of c.colliders) world.colliders.remove(col);
            cache.delete(k);
            onEvict?.(c);
        },
        /** Chunk coordinates covering a circle, nearest first. */
        coordsAround(x, y, r) {
            const out = [];
            const i0 = Math.floor((x - r) / CHUNK_SIZE), i1 = Math.floor((x + r) / CHUNK_SIZE);
            const j0 = Math.floor((y - r) / CHUNK_SIZE), j1 = Math.floor((y + r) / CHUNK_SIZE);
            for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
                const d = Math.hypot((i + 0.5) * CHUNK_SIZE - x, (j + 0.5) * CHUNK_SIZE - y);
                out.push({ i, j, d });
            }
            return out.sort((a, b) => a.d - b.d);
        },
        /**
         * Loads the chunks around a point. At most `budget` new chunks are generated per call (spreading the work
         * across frames); chunks already loaded are always returned.
         */
        around(x, y, r, budget = Infinity) {
            const out = [];
            let made = 0;
            for (const { i, j } of chunks.coordsAround(x, y, r)) {
                if (cache.has(key(i, j))) out.push(chunks.get(i, j));
                else if (made < budget) { out.push(chunks.get(i, j)); made++; }
            }
            return out;
        },
        loaded: () => [...cache.values()],
    };
    return chunks;
}

export const chunkOf = (x, y) => ({ i: Math.floor(x / CHUNK_SIZE), j: Math.floor(y / CHUNK_SIZE) });
