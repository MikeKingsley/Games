// Per-chunk GPU mesh cache for the WebGL renderer, free of GL calls so it can be tested in Node: it is given `build`
// (chunk, lod) -> a plain object of meshes and `dispose` to release one, and handles the rest: lazy builds under a
// per-frame budget, rebuilding when the LOD or a chunk's identity changes, and freeing entries whose chunk the world
// has evicted (`world.chunks.cap`).
export function createChunkCache({ build, dispose, refresh = null, max = 400, now = () => performance.now(), budgetMs = Infinity }) {
    const entries = new Map();
    let builtThisFrame = 0, frameStart = 0;
    const key = c => c.i * 100003 + c.j;
    const cache = {
        entries,
        stats: { builds: 0, disposed: 0, refreshes: 0 },
        /** Milliseconds of build work a frame may start (one build always goes ahead, so the cache cannot starve). */
        budgetMs,
        /** Call at the start of every frame. */
        beginFrame() { builtThisFrame = 0; frameStart = cache.budgetMs === Infinity ? 0 : now(); },
        /** Milliseconds of this frame's budget used so far by builds. */
        get spentMs() { return builtThisFrame ? now() - frameStart : 0; },
        /** True while `share` (0..1) of the frame's build budget is still unspent (always true with no budget). */
        hasTime(share = 1) { return cache.budgetMs === Infinity || now() - frameStart < cache.budgetMs * share; },
        /** The entry for a chunk whatever its LOD (null when none), without building. */
        peek(chunk) { const e = entries.get(key(chunk)); return e && e.chunk === chunk ? e : null; },
        /** Swaps a cached chunk's roads to another detail level, if the frame's build budget allows. */
        refresh(entry, level) {
            if (!refresh || entry.data.roadLevel === level) return false;
            if (builtThisFrame >= 1 && !cache.hasTime()) return false;
            builtThisFrame++;
            refresh(entry, level);
            cache.stats.refreshes++;
            return true;
        },
        /**
         * The entry for a chunk at a LOD, building it if the per-frame budget allows. While the wanted LOD is not
         * built yet an existing entry of another LOD (or null) is returned so the chunk keeps drawing.
         */
        get(chunk, lod, budget = 2, hint = undefined) {
            const k = key(chunk);
            const e = entries.get(k);
            if (e && e.chunk === chunk && e.lod === lod) { e.used = cache.frame; return e; }
            if (builtThisFrame >= budget || (builtThisFrame >= 1 && !cache.hasTime())) return e && e.chunk === chunk ? e : null;
            builtThisFrame++;
            if (e) dispose(e);
            const fresh = { chunk, lod, used: cache.frame, data: build(chunk, lod, hint) };
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
