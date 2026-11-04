// Per-chunk GPU mesh cache for the WebGL renderer, free of GL calls so it can be tested in Node: it is given `build`
// (chunk, lod) -> a plain object of meshes and `dispose` to release one, and handles the rest: lazy builds under a
// per-frame budget, rebuilding when the LOD or a chunk's identity changes, and freeing entries whose chunk the world
// has evicted (`world.chunks.cap`).
export function createChunkCache({ build, dispose, max = 400 }) {
    const entries = new Map();
    let builtThisFrame = 0;
    const key = c => c.i * 100003 + c.j;
    const cache = {
        entries,
        stats: { builds: 0, disposed: 0 },
        /** Call at the start of every frame. */
        beginFrame() { builtThisFrame = 0; },
        /**
         * The entry for a chunk at a LOD, building it if the per-frame budget allows. While the wanted LOD is not
         * built yet an existing entry of another LOD (or null) is returned so the chunk keeps drawing.
         */
        get(chunk, lod, budget = 2) {
            const k = key(chunk);
            const e = entries.get(k);
            if (e && e.chunk === chunk && e.lod === lod) { e.used = cache.frame; return e; }
            if (builtThisFrame >= budget) return e && e.chunk === chunk ? e : null;
            builtThisFrame++;
            if (e) dispose(e);
            const fresh = { chunk, lod, used: cache.frame, data: build(chunk, lod) };
            entries.set(k, fresh);
            cache.stats.builds++;
            return fresh;
        },
        frame: 0,
        /** Drops entries whose chunk was evicted from the world, and the least recently used past `max`. */
        prune(isLoaded) {
            for (const [k, e] of entries) {
                if (!isLoaded(e.chunk)) { dispose(e); entries.delete(k); cache.stats.disposed++; }
            }
            if (entries.size > max) {
                const old = [...entries].sort((a, b) => a[1].used - b[1].used).slice(0, entries.size - max);
                for (const [k, e] of old) { dispose(e); entries.delete(k); cache.stats.disposed++; }
            }
        },
        clear() { for (const e of entries.values()) dispose(e); entries.clear(); },
        get size() { return entries.size; },
    };
    return cache;
}
