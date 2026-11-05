// The renderer's per-frame chunk logic, free of GL so it can be tested and measured in Node: what a chunk is made of on the
// CPU (`buildChunkData`), and the frame driver that decides which chunks to draw, at which level of detail, and which to
// build ahead of the camera under a time budget.
//
// Corridor detail (the Slow Roads idea): roads keep every marking, pavement, junction kerb and bridge pier only within
// a distance of the camera (`quality.roadDetail`); further out a chunk's roads are the coarse variant (surface and kerb,
// plain decks and junction fans, half the samples). The swap happens per chunk with hysteresis, so a chunk sitting on the
// boundary does not flicker between the two, and it rebuilds just the road mesh, not the ground or the props.
import { buildChunkMesh } from './terrain-mesh.js';
import { buildChunkRoads, chunkRoadSignature } from './road-mesh.js';
import { buildChunkProps, chunkPropsSig, chunkSignalNodes } from './prop-mesh.js';
import { buildTreeInstances, buildRockInstances } from './instances.js';
import { chunkVisible, lodFor, lodWithHysteresis } from './camera3d.js';
import { CHUNK_SIZE } from '../../config.js';

/** Road detail levels: how much of a road mesh a chunk gets. */
export const ROAD_DETAIL = { coarse: 0, basic: 1, full: 2 };

/** Everything year-independent a chunk needs on the CPU, plus its road and props signatures. `roadLevel` is a ROAD_DETAIL. */
export function buildChunkData(world, chunk, lod, { year, wet = false, trees = 1, roadLevel = ROAD_DETAIL.full } = {}) {
    const m = buildChunkMesh(world, chunk, { lod });
    const near = lod === 0;
    const t = buildTreeInstances(chunk, trees, !near);
    return {
        ground: m.ground, surf: m.surf, water: m.water,
        roads: buildChunkRoads(world, chunk, year, { wet, detail: roadLevel }), roadLevel,
        roadSig: chunkRoadSignature(world, chunk, year, wet),
        props: buildChunkProps(world, chunk, year, { detail: near }), propsSig: chunkPropsSig(chunk, year),
        trees: t, rocks: buildRockInstances(chunk), signals: chunkSignalNodes(world, chunk, year),
        buildings: chunk.buildings.length, furniture: near ? chunk.lamps.length + chunk.signs.length : 0,
    };
}

/** The roads of a chunk at another detail level (the rest of its data is unchanged). */
export const buildRoadsAt = (world, chunk, year, wet, roadLevel) => buildChunkRoads(world, chunk, year, { wet, detail: roadLevel });

/** The CPU meshes of a data object, for counting. */
export function meshesOf(data) {
    const out = [];
    for (const m of [data.ground, data.surf, data.water, data.roads, data.props]) if (m) out.push(m);
    return out;
}

/** The full-detail distance and level a quality preset gives roads (the corridor along the camera). */
export function corridorOf(quality) {
    return { reach: quality?.roadDetail ?? 330, level: quality?.roadLevel ?? ROAD_DETAIL.full };
}

/** Hysteresis (m) on the corridor edge and on the ground LOD edge: a chunk must move this far past it to swap. */
export const HYSTERESIS = CHUNK_SIZE * 0.25;

/**
 * Chunk coordinates worth building before the camera gets there: along the heading and along the planned route (flat
 * [x, y, ...] points starting at the vehicle), from half the view distance out to `extra` chunks beyond it. Nearest
 * first, no duplicates. Pure.
 */
export function lookAheadCoords(x, y, heading, routePts, radius, { extra = 1.5, step = CHUNK_SIZE / 2 } = {}) {
    const seen = new Set(), out = [];
    const add = (px, py) => {
        const i = Math.floor(px / CHUNK_SIZE), j = Math.floor(py / CHUNK_SIZE), k = i * 100003 + j;
        if (seen.has(k)) return;
        seen.add(k);
        out.push({ i, j, d: Math.hypot((i + 0.5) * CHUNK_SIZE - x, (j + 0.5) * CHUNK_SIZE - y) });
    };
    const from = radius * 0.5, to = radius + extra * CHUNK_SIZE;
    const ca = Math.cos(heading), sa = Math.sin(heading);
    for (let s = from; s <= to; s += step) add(x + ca * s, y + sa * s);
    if (routePts && routePts.length >= 4) {
        // walk the route once, adding the chunks it crosses between `from` and `to` metres ahead
        let acc = 0;
        for (let i = 2; i < routePts.length && acc <= to; i += 2) {
            const ax = routePts[i - 2], ay = routePts[i - 1], bx = routePts[i], by = routePts[i + 1];
            const len = Math.hypot(bx - ax, by - ay);
            for (let s = 0; s < len; s += step) {
                const at = acc + s;
                if (at < from) continue;
                if (at > to) break;
                add(ax + ((bx - ax) * s) / len, ay + ((by - ay) * s) / len);
            }
            acc += len;
        }
    }
    return out.sort((a, b) => a.d - b.d);
}

/**
 * The renderer's chunk logic for one frame. `frame({planes, x, y, heading, route, frameNo, chunkGen})` returns the entries
 * to draw (an array reused every frame): the visible chunks within the view distance, each at its LOD and road detail,
 * built under the cache's time budget; then, with what is left of the budget, chunks ahead along the heading and the
 * route are built into the cache for later.
 *
 * options: `world`, `cache` (a createChunkCache with `refresh` set), `quality` (a QUALITY preset), `radius` (view
 * distance), `corridor` (false: every chunk keeps full road detail, as before the corridor LOD) and `lookahead` (false:
 * only what is visible is built).
 */
export function createFrameDriver({ world, cache, quality, radius, corridor = true, lookahead = true }) {
    const entries = [];
    const { reach, level } = corridorOf(quality);
    /** The road detail a chunk at distance `d` wants; `current` (its present level, if built) gives the hysteresis. */
    const roadLevelFor = (d, current) => {
        if (!corridor) return ROAD_DETAIL.full;
        const edge = current === undefined ? reach : current === ROAD_DETAIL.coarse ? reach - HYSTERESIS : reach + HYSTERESIS;
        return d < edge ? level : ROAD_DETAIL.coarse;
    };
    let ahead = [], aheadFrame = -1e9;
    const hasTime = () => cache.hasTime();
    const driver = {
        entries,
        roadLevelFor,
        stats: { ahead: 0 },
        frame({ planes, x, y, heading, route = null, frameNo = 0, chunkGen = 3 }) {
            cache.frame = frameNo;
            cache.beginFrame();
            entries.length = 0;
            const chunks = world.chunks.around(x, y, radius, chunkGen, hasTime);
            for (let n = 0; n < chunks.length; n++) {
                const c = chunks[n];
                const d = Math.hypot((c.i + 0.5) * CHUNK_SIZE - x, (c.j + 0.5) * CHUNK_SIZE - y);
                if (d > radius + CHUNK_SIZE || !chunkVisible(planes, c)) continue;
                const prev = cache.peek(c);
                const lod = prev ? lodWithHysteresis(prev.lod, d, undefined, HYSTERESIS / CHUNK_SIZE) : lodFor(d);
                const want = roadLevelFor(d, prev?.data?.roadLevel);
                const e = cache.get(c, lod, undefined, want);
                if (!e) continue;
                if (e.data.roadLevel !== want) cache.refresh(e, want);
                entries.push(e);
            }
            if (lookahead && frameNo - aheadFrame >= 20) {
                // the list follows the vehicle slowly, so it is rebuilt every third of a second
                ahead = lookAheadCoords(x, y, heading, route?.pts ?? route, radius);
                aheadFrame = frameNo;
            }
            if (lookahead) {
                let generated = 0;
                for (let n = 0; n < ahead.length; n++) {
                    if (!cache.hasTime(0.5)) break;
                    const { i, j } = ahead[n];
                    if (!world.chunks.has(i, j)) { if (generated++ >= 1) continue; }
                    const c = world.chunks.get(i, j), prev = cache.peek(c);
                    if (prev) continue;
                    const d = Math.hypot((i + 0.5) * CHUNK_SIZE - x, (j + 0.5) * CHUNK_SIZE - y);
                    if (cache.get(c, lodFor(d), undefined, roadLevelFor(d))) driver.stats.ahead++;
                }
            }
            return entries;
        },
    };
    return driver;
}
