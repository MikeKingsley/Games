// Frame-time measurement of the Delivery Driver WebGL renderer in a real browser (software GL unless the machine has a
// GPU): starts a fresh game on the Medium (or High/Low) preset with traffic, then moves the player along a route at 22 m/s
// for N seconds and reports frame times (requestAnimationFrame deltas and the game's own CPU ms per frame), the worst
// frames, long frames, chunk builds and the JS heap. Needs the dev server on port 5210 (Development build: window.__dd).
//   node scripts/perf-browser.mjs [--route exeter-plymouth] [--quality medium] [--seconds 60] [--year 2024] [--gc] [--json]
// (--gc forces a collection before each 5 s heap sample, which shows the live heap but adds a pause of its own to the frame stats)
import { chromium } from 'playwright';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const route = arg('route', 'exeter-plymouth'), quality = arg('quality', 'medium'), seconds = +arg('seconds', 60), year = +arg('year', 2024);
const base = arg('url', 'http://localhost:5210');
const ROUTES = { 'exeter-plymouth': ['exeter', 'plymouth'], a30: ['exeter', 'penzance'], 'plymouth-truro': ['plymouth', 'truro'] };

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio', '--enable-precise-memory-info', '--js-flags=--expose-gc', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const corridor = arg('corridor', 'on'); // 'off' = the rollback switch: no corridor LOD, no look-ahead, no time budget
await page.addInitScript(([q, c]) => { localStorage.setItem('games.dd.settings', JSON.stringify({ renderer: 'webgl', quality: q })); if (c === 'off') localStorage.setItem('games.dd.corridor', 'off'); }, [quality, corridor]);
await page.goto(`${base}/play/delivery-driver`);
await page.waitForFunction(() => window.__dd?.state?.world, null, { timeout: 120000 });
await page.evaluate(([y]) => { window.__dd.newGame(); window.__dd.setYear?.(y); }, [year]);
await page.waitForTimeout(1500);
const result = await page.evaluate(async ([ids, seconds, forceGc]) => {
    const dd = window.__dd, s = dd.state, w = s.world;
    const pf = await import('/games/delivery-driver/world/pathfind.js');
    const geom = await import('/games/delivery-driver/world/geom.js');
    const [a, b] = ids.map(id => w.region.townById.get(id));
    const r = pf.findRoute(w.graph, a, b, { year: s.year, vmax: 30 });
    if (!r) return { error: 'no route' };
    geom.pointAt(r.pts, 0, { x: 0, y: 0, angle: 0 });
    dd.teleport(r.pts[0], r.pts[1], Math.atan2(r.pts[3] - r.pts[1], r.pts[2] - r.pts[0]));
    if (s.traffic) s.traffic.agents.length = 0;
    await new Promise(res => setTimeout(res, 1500));
    dd.resetPerf();
    const deltas = [], heaps = [], pose = { x: 0, y: 0, angle: 0 };
    let long = 0;
    try { new PerformanceObserver(l => { long += l.getEntries().length; }).observe({ entryTypes: ['longtask'] }); } catch { /* not supported */ }
    const st0 = { ...dd.renderer.stats };
    let d = 0, last = performance.now(), start = last, lastHeap = 0;
    await new Promise(done => {
        const tick = now => {
            const dt = (now - last) / 1000;
            deltas.push(now - last);
            last = now;
            d = Math.min(r.length - 5, d + 22 * Math.min(dt, 0.1));
            geom.pointAt(r.pts, d, pose);
            dd.state.player && Object.assign(dd.state.player, { x: pose.x, y: pose.y, heading: pose.angle, speed: 22, prevX: pose.x, prevY: pose.y, prevHeading: pose.angle });
            dd.state.world.chunks.around(pose.x, pose.y, 200, 1);
            if (now - lastHeap > 5000) { lastHeap = now; if (forceGc && window.gc) window.gc(); heaps.push(performance.memory.usedJSHeapSize / 1048576); }
            if (now - start < seconds * 1000) requestAnimationFrame(tick); else done();
        };
        requestAnimationFrame(tick);
    });
    const stats = dd.stats();
    const sorted = [...deltas].sort((x, y) => x - y);
    const pct = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const st1 = dd.renderer.stats;
    return {
        frames: deltas.length, meanFrameMs: +(deltas.reduce((x, y) => x + y, 0) / deltas.length).toFixed(1), p99FrameMs: +pct(0.99).toFixed(1),
        worstFrameMs: +sorted[sorted.length - 1].toFixed(1), over50: deltas.filter(x => x > 50).length, longTasks: long,
        cpuFrameMs: +stats.frameMs.toFixed(2), chunkBuilds: st1.chunkBuilds - st0.chunkBuilds, drawCalls: st1.drawCalls, triangles: st1.triangles,
        gpuMB: +(st1.gpuBytes / 1048576).toFixed(1), buildMs: st1.buildMs, worstBuildMs: st1.worstBuildMs, aheadBuilds: st1.aheadBuilds, roadSwaps: st1.roadSwaps,
        heapMB: heaps.map(x => Math.round(x)), traffic: s.traffic?.agents?.length ?? null, km: +(d / 1000).toFixed(2),
    };
}, [ROUTES[route], seconds, process.argv.includes('--gc')]);
await browser.close();
const out = { route, quality, year, seconds, corridor, ...result, errors };
console.log(process.argv.includes('--json') ? JSON.stringify(out) : out);
if (errors.length) process.exitCode = 1;
