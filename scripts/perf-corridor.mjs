// Chunk-build and GC measurement for the Delivery Driver WebGL renderer, without a GPU: drives the camera along a route
// at 60 frames a second, asks the same chunk cache the renderer uses for the same chunks (frustum culled, at their LOD),
// builds every mesh a chunk needs on the CPU and packs it the way the GPU upload does. It reports chunk build time per
// frame (mean, p99, worst), vertices and bytes per chunk, V8 garbage-collection pauses and the heap after the drive.
//   node --expose-gc scripts/perf-corridor.mjs [--route exeter-plymouth] [--year 2024] [--quality medium] [--minutes 5] [--json]
// Routes: exeter-plymouth (towns and the A38), a30 (Exeter to Penzance: open road), plymouth-truro (Tamar and A38/A390).
import { PerformanceObserver } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { seedWithBaked } from '../tests/js/helpers/delivery-seed.mjs';
import { createWorld } from '../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { findRoute, slice } from '../Games.Client/wwwroot/games/delivery-driver/world/pathfind.js';
import { pointAt } from '../Games.Client/wwwroot/games/delivery-driver/world/geom.js';
import { QUALITY, CHUNK_SIZE } from '../Games.Client/wwwroot/games/delivery-driver/config.js';
import { cameraFromView, frustumPlanes, visibleChunks, viewDistance } from '../Games.Client/wwwroot/games/delivery-driver/render/gl/camera3d.js';
import { createChunkCache } from '../Games.Client/wwwroot/games/delivery-driver/render/gl/chunk-cache.js';
import { buildChunkData, buildRoadsAt, meshesOf, createFrameDriver } from '../Games.Client/wwwroot/games/delivery-driver/render/gl/chunk-build.js';
import { groundZ } from '../Games.Client/wwwroot/games/delivery-driver/world/terrain.js';
import { STRIDE } from '../Games.Client/wwwroot/games/delivery-driver/render/gl/gpu-mesh.js';

const ROUTES = { 'exeter-plymouth': ['exeter', 'plymouth'], a30: ['exeter', 'penzance'], 'plymouth-truro': ['plymouth', 'truro'] };

const tick = () => new Promise(r => setTimeout(r, 2));
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

/** Drives `route` and returns the measurements. `quality` is a QUALITY name. */
export async function measure(world, { route = 'exeter-plymouth', year = 2024, quality = 'medium', minutes = 5, speed = 22, fps = 60, legacy = false, budgetMs = 6 } = {}) {
    const [from, to] = ROUTES[route].map(id => world.region.townById.get(id));
    const r = findRoute(world.graph, from, to, { year, vmax: 30 });
    if (!r) throw new Error(`no route ${route}`);
    const q = QUALITY[quality], radius = viewDistance(q);
    const gcs = [], gcKinds = [];
    let forced = false;
    const obs = new PerformanceObserver(list => { for (const e of list.getEntries()) if (!forced) { gcs.push(e.duration); gcKinds.push(`${e.detail?.kind}:${e.duration.toFixed(0)}`); } });
    obs.observe({ entryTypes: ['gc'] });

    const cam = {}, planes = frustumPlanes(new Float32Array(16));
    const stats = { refreshes: 0, builds: 0, bytes: 0, verts: 0, tris: 0, roadVerts: 0, roadBytes: 0 };
    // where a frame's time went: chunk generation (world/generator.js) or mesh building
    let genMs = 0, buildMs = 0;
    const genOrig = world.chunks.get.bind(world.chunks);
    world.chunks.get = (i, j) => { const had = world.chunks.has(i, j); const t = performance.now(); const c = genOrig(i, j); if (!had) genMs += performance.now() - t; return c; };
    const cache = createChunkCache({
        build(chunk, level, hint) {
            const tb = performance.now();
            const data = buildChunkData(world, chunk, level, { year, trees: q.trees ?? 1, roadLevel: hint });
            let bytes = 0;
            for (const m of meshesOf(data)) { stats.verts += m.positions.length / 3; stats.tris += m.indices.length / 3; bytes += (m.positions.length / 3) * STRIDE + m.indices.length * 4; }
            if (data.roads) { stats.roadVerts += data.roads.positions.length / 3; stats.roadBytes += (data.roads.positions.length / 3) * STRIDE + data.roads.indices.length * 4; }
            stats.builds++; stats.bytes += bytes;
            buildMs += performance.now() - tb;
            // like the renderer, keep only what is needed to draw (handles on the GPU), not the CPU meshes: the heap figure then measures the JS side
            return { roadLevel: data.roadLevel, roadSig: data.roadSig, propsSig: data.propsSig, signals: data.signals };
        },
        dispose() {},
        refresh(entry, level) { const tb = performance.now(); buildRoadsAt(world, entry.chunk, year, false, level); entry.data.roadLevel = level; stats.refreshes++; buildMs += performance.now() - tb; },
    });
    cache.budgetMs = legacy ? Infinity : budgetMs;
    const driver = createFrameDriver({ world, cache, quality: q, radius, corridor: !legacy, lookahead: !legacy });

    const frames = Math.round(minutes * 60 * fps);
    const dt = 1 / fps;
    const total = r.length;
    const frameBuild = [], heap = [], slow = [];
    const pose = { x: 0, y: 0, angle: 0 };
    let d = 0, routeAhead = null;
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) {
        d += speed * dt;
        if (d >= total - 10) d = 0; // loop if the route is shorter than the drive
        pointAt(r.pts, d, pose);
        const view = { tx: pose.x, ty: pose.y, tz: groundZ(world, pose.x, pose.y), az: pose.angle, distance: 25, tilt: 0.61, ahead: 0 };
        cameraFromView(cam, view, 16 / 9, { far: radius * 1.6 + 400 });
        frustumPlanes(cam.vp, planes);
        genMs = 0; buildMs = 0;
        const t1 = performance.now();
        if (f % 120 === 0) routeAhead = { pts: slice(r.pts, d, d + 2500) };
        driver.frame({ planes, x: pose.x, y: pose.y, heading: pose.angle, route: routeAhead, frameNo: f });
        const t2 = performance.now();
        frameBuild.push(t2 - t1);
        if (f >= 120 && t2 - t1 > 8) slow.push(`${(t2 - t1).toFixed(0)}ms (gen ${genMs.toFixed(0)}, build ${buildMs.toFixed(0)})`);
        if (f % fps === fps - 1) await tick();
        if (f % (fps * 10) === 0) {
            // heap after a collection; the forced collections are not counted as pauses
            await tick();
            forced = true;
            if (global.gc) global.gc();
            await tick();
            forced = false;
            heap.push(process.memoryUsage().heapUsed / 1048576);
        }
    }
    const wall = performance.now() - t0;
    await tick();
    obs.disconnect();
    const drive = frameBuild.slice(120); // the first two seconds are cold code and the first chunks
    return {
        route, year, quality, minutes, km: (Math.min(total, speed * minutes * 60) / 1000).toFixed(1),
        frames, wallS: +(wall / 1000).toFixed(1),
        chunkFrameMs: { mean: +(drive.reduce((a, b) => a + b, 0) / drive.length).toFixed(3), p99: +pct(drive, 0.99).toFixed(2), worst: +Math.max(...drive).toFixed(2), firstFrames: +Math.max(...frameBuild.slice(0, 120)).toFixed(0), over16: drive.filter(x => x > 16).length, over8: drive.filter(x => x > 8).length },
        builds: stats.builds, vertsPerChunk: Math.round(stats.verts / Math.max(1, stats.builds)), trisPerChunk: Math.round(stats.tris / Math.max(1, stats.builds)),
        kbPerChunk: Math.round(stats.bytes / Math.max(1, stats.builds) / 1024), roadVertsPerChunk: Math.round(stats.roadVerts / Math.max(1, stats.builds)),
        roadKbPerChunk: Math.round(stats.roadBytes / Math.max(1, stats.builds) / 1024),
        gc: { worst3: gcKinds.sort((a, b) => +b.split(':')[1] - +a.split(':')[1]).slice(0, 3), count: gcs.length, worstMs: +Math.max(0, ...gcs).toFixed(2), over16: gcs.filter(x => x > 16).length, totalMs: +gcs.reduce((a, b) => a + b, 0).toFixed(1) },
        heapMB: heap.map(x => Math.round(x)), heapGrowthMB: heap.length > 6 ? Math.round(heap[heap.length - 1] - heap[Math.floor(heap.length / 4)]) : 0,
        slowFrames: slow.slice(0, 8), cacheSize: cache.size, refreshes: stats.refreshes, ahead: driver.stats.ahead, legacy,
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
    const world = createWorld(seedWithBaked());
    const out = await measure(world, { route: arg('route', 'exeter-plymouth'), year: +arg('year', 2024), quality: arg('quality', 'medium'), minutes: +arg('minutes', 5), legacy: process.argv.includes('--legacy') });
    console.log(process.argv.includes('--json') ? JSON.stringify(out) : out);
}
