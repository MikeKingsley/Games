// One-off measurement for plan 0009 phase 2: does a life-size road network fit at a 1:4 world scale?
//
//   node scripts/bake-roads/measure-scale.mjs [--only 1:4,1:13] [--out DIR] [--validate] [--quiet]
//
// Re-bakes the cached OSM data (.cache/osm/) several times WITHOUT touching the committed baked folder: every bake is
// written to a scratch folder (default .cache/measure-scale/<name>/, gitignored) at 1:13, 1:5
// and 1:4 (the clean-up tolerances are scaled so they stay the same in real metres, like the planned phase 3 bake),
// plus two reference rows: the old 1:13 reference and 1:4 with the raw (unscaled) tolerances. Per bake it prints:
//   - node / edge / vertex counts, edges under 6 m, junction pairs closer than 25 m, gzip size of the road files;
//   - the share of town street length (class street, inside a town, open in 2024) within 11 m of another road at the
//     same level that it does not share a node with (ignoring 25 m around a shared node): "overlap";
//   - the same share after a simulated generalisation (greedy: drop the lowest-ranked mostly-overlapping edges while the
//     graph stays connected), which is the figure the 1:4 viability rule uses (viable if <= 10%);
//   - tunnels and bridge spans per level, and roundabouts by real radius band.
// With --validate it also loads each scratch bake and runs the phase 2 validator checks (scripts/validate-roads.mjs).
// Limitation: the cached OSM tiles only hold the streets inside each town's current footprint (world/projection.js
// townFootprint), so streets further out than that are not measured.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE, loadSeed } from './common.mjs';
import { bake, writeBaked } from './bake.mjs';
import { ROAD_CLASS } from '../../Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const quiet = args.includes('--quiet');
const base = resolve(opt('--out', resolve(CACHE, 'measure-scale')));
const YEAR = 2024, NEAR = 11, JUNCTION_SKIP = 25, STEP = 3;

const CONFIGS = [
    { name: '1:13', denom: 13 },
    { name: '1:5', denom: 5 },
    { name: '1:4', denom: 4 },
    { name: '1:4 rawtol', denom: 4, rawTol: true },
];

// ---- analysis helpers (world metres) ------------------------------------------------------------------------------

const isOpen = e => (e.opened ?? 0) <= YEAR && (e.closed ?? Infinity) > YEAR;
const clsIn = e => [...(e.upgrades ?? [])].filter(u => u.year <= YEAR).sort((p, q) => q.year - p.year)[0]?.class ?? e.cls;
const rankOf = e => ROAD_CLASS[clsIn(e)]?.rank ?? 1;
/** Level of segment i: 0 on the ground, bridges >= 1, tunnels <= -1 (from the OSM layer where it agrees). */
const segLevel = (e, i) => (e.segs[i] === 1 ? (e.layer >= 1 ? e.layer : 1) : e.segs[i] === 2 ? (e.layer <= -1 ? e.layer : -1) : 0);

function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}

function buildGrid(edges, cell = 24) {
    const cells = new Map();
    const key = (i, j) => i * 100003 + j;
    for (const e of edges) {
        for (let s = 0; s < e.pts.length / 2 - 1; s++) {
            const ax = e.pts[2 * s], ay = e.pts[2 * s + 1], bx = e.pts[2 * s + 2], by = e.pts[2 * s + 3];
            for (let i = Math.floor((Math.min(ax, bx) - NEAR) / cell); i <= Math.floor((Math.max(ax, bx) + NEAR) / cell); i++) {
                for (let j = Math.floor((Math.min(ay, by) - NEAR) / cell); j <= Math.floor((Math.max(ay, by) + NEAR) / cell); j++) {
                    const k = key(i, j);
                    (cells.get(k) ?? cells.set(k, []).get(k)).push(e, s);
                }
            }
        }
    }
    return { at: (x, y) => cells.get(key(Math.floor(x / cell), Math.floor(y / cell))) };
}

/** Walks an edge in `step` m samples, calling fn(x, y, segIndex) at each. */
function walk(e, step, fn) {
    let acc = 0, next = step / 2;
    for (let s = 0; s < e.pts.length / 2 - 1; s++) {
        const ax = e.pts[2 * s], ay = e.pts[2 * s + 1], bx = e.pts[2 * s + 2], by = e.pts[2 * s + 3];
        const l = Math.hypot(bx - ax, by - ay);
        while (next <= acc + l) { const t = l ? (next - acc) / l : 0; fn(ax + (bx - ax) * t, ay + (by - ay) * t, s); next += step; }
        acc += l;
    }
}

/**
 * For each edge in `targets`: how many of its samples lie within NEAR m of another live edge's centreline at the same
 * level, ignoring edges that share a node with it near that node. Returns Map(edge -> {n, hit}) and the totals in m.
 */
function overlapPass(g, targets, live, step = STEP) {
    const grid = buildGrid(live);
    const per = new Map();
    let n = 0, hit = 0;
    for (const e of targets) {
        const own = [e.a, e.b].map(id => g.nodes.get(id));
        let en = 0, eh = 0;
        walk(e, step, (px, py, s) => {
            en++;
            const lvl = segLevel(e, s);
            const list = grid.at(px, py);
            if (!list) return;
            let found = false;
            for (let q = 0; q < list.length && !found; q += 2) {
                const f = list[q];
                if (f === e) continue;
                const t = list[q + 1];
                if (segLevel(f, t) !== lvl) continue;
                if (segDist(px, py, f.pts[2 * t], f.pts[2 * t + 1], f.pts[2 * t + 2], f.pts[2 * t + 3]) >= NEAR) continue;
                if (own.some(m => (f.a === m.id || f.b === m.id) && Math.hypot(px - m.x, py - m.y) < JUNCTION_SKIP)) continue;
                found = true;
            }
            if (found) eh++;
        });
        per.set(e, { n: en, hit: eh });
        n += en; hit += eh;
    }
    return { per, n, hit, share: n ? hit / n : 0, totalM: n * step, hitM: hit * step };
}

/** True if a and b stay connected without edge `skip` (breadth first, at most `limit` nodes) over alive edges. */
function connectedWithout(g, adj, skip, limit = 800) {
    const seen = new Set([skip.a]);
    const q = [skip.a];
    for (let i = 0; i < q.length && q.length < limit; i++) {
        for (const e of adj.get(q[i]) ?? []) {
            if (e === skip) continue;
            const o = e.a === q[i] ? e.b : e.a;
            if (o === skip.b) return true;
            if (!seen.has(o)) { seen.add(o); q.push(o); }
        }
    }
    return false;
}

function analyse(res, scale, files) {
    const g = res.graph;
    const edges = [...g.edges.values()];
    const live = edges.filter(e => isOpen(e) && e.cls !== 'ferry');
    const out = { nodes: g.nodes.size, edges: edges.length, vertices: edges.reduce((a, e) => a + e.pts.length / 2, 0) };
    out.short6 = edges.filter(e => e.len < 6).length;
    // junction pairs closer than 25 m
    const js = [...g.nodes.values()].filter(n => n.edges.size >= 3);
    const cell = 25, cells = new Map();
    for (const n of js) { const k = Math.floor(n.x / cell) * 100003 + Math.floor(n.y / cell); (cells.get(k) ?? cells.set(k, []).get(k)).push(n); }
    let pairs = 0;
    for (const n of js) {
        const ci = Math.floor(n.x / cell), cj = Math.floor(n.y / cell);
        for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
            for (const m of cells.get(i * 100003 + j) ?? []) if (m.id > n.id && Math.hypot(m.x - n.x, m.y - n.y) < 25) pairs++;
        }
    }
    out.jpairs = pairs;
    out.gzipMB = files.filter(f => f.name !== 'elevation.bin').reduce((a, f) => a + f.gzip, 0) / 1048576;
    // overlap of town streets
    const streets = live.filter(e => clsIn(e) === 'street' && e.town);
    out.streetKm = streets.reduce((a, e) => a + e.len, 0) / 1000;
    const raw = overlapPass(g, streets, live);
    out.overlapKm = raw.hitM / 1000;
    out.overlapShare = raw.share;
    const all = overlapPass(g, live, live, 5);
    out.allShare = all.share;
    // simulated generalisation: drop the lowest-ranked mostly-overlapping edges while connectivity survives
    const adj = new Map();
    for (const e of live) for (const id of [e.a, e.b]) (adj.get(id) ?? adj.set(id, []).get(id)).push(e);
    const dropped = new Set();
    const cand = streets.filter(e => !e.ref && !e.segs.some(Boolean) && raw.per.get(e).n && raw.per.get(e).hit / raw.per.get(e).n >= 0.3)
        .sort((p, q) => rankOf(p) - rankOf(q) || p.len - q.len);
    for (const e of cand) {
        const spur = (adj.get(e.a)?.length ?? 0) < 2 || (adj.get(e.b)?.length ?? 0) < 2;
        if (!spur && !connectedWithout(g, adj, e)) continue;
        dropped.add(e);
        for (const id of [e.a, e.b]) adj.set(id, adj.get(id).filter(f => f !== e));
    }
    const left = live.filter(e => !dropped.has(e));
    const rest = overlapPass(g, streets.filter(e => !dropped.has(e)), left);
    out.droppedKm = [...dropped].reduce((a, e) => a + e.len, 0) / 1000;
    out.droppedShare = out.droppedKm / out.streetKm;
    out.residualShare = rest.hitM / (out.streetKm * 1000 - out.droppedKm * 1000 || 1); // of what is left
    out.residualOfOriginal = rest.hitM / (out.streetKm * 1000);
    // bridges and tunnels per level
    const spans = {};
    for (const e of edges) {
        let run = null, len = 0;
        const flush = () => { if (!run) return; const k = `${run.t === 2 ? 'tunnel' : 'bridge'} L${run.l}`; const s = (spans[k] ??= { n: 0, km: 0 }); s.n++; s.km += len / 1000; run = null; len = 0; };
        for (let i = 0; i < e.segs.length; i++) {
            const l = e.segs[i] ? segLevel(e, i) : 0;
            const sl = Math.hypot(e.pts[2 * i + 2] - e.pts[2 * i], e.pts[2 * i + 3] - e.pts[2 * i + 1]);
            if (e.segs[i]) { if (run && (run.t !== e.segs[i] || run.l !== l)) flush(); run ??= { t: e.segs[i], l }; len += sl; } else flush();
        }
        flush();
    }
    out.spans = spans;
    // roundabouts by real radius
    const bands = [['<8', 0, 8], ['8-12', 8, 12], ['12-20', 12, 20], ['20-35', 20, 35], ['35+', 35, Infinity]];
    out.rb = { total: 0, mini: 0, bands: Object.fromEntries(bands.map(b => [b[0], 0])), noRadius: 0, smallWorld: 0 };
    for (const n of g.nodes.values()) {
        if (n.junction !== 'roundabout') continue;
        if (n.mini) { out.rb.mini++; continue; }
        out.rb.total++;
        if (!(n.ringRadius > 0)) { out.rb.noRadius++; continue; }
        const b = bands.find(b => n.ringRadius >= b[1] && n.ringRadius < b[2]);
        out.rb.bands[b[0]]++;
        if (n.ringRadius * scale < 12) out.rb.smallWorld++; // outer radius under the minimum ring (island 4 + ring 8)
    }
    return out;
}

// ---- run ----------------------------------------------------------------------------------------------------------

function loadElements() {
    const dir = resolve(CACHE, 'osm');
    const elements = [];
    for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) for (const el of JSON.parse(readFileSync(resolve(dir, f), 'utf8')).elements) elements.push(el);
    return elements;
}
if (!existsSync(resolve(CACHE, 'osm')) || !existsSync(resolve(CACHE, 'elevation'))) {
    console.error('missing .cache/osm or .cache/elevation: run scripts/bake-roads/fetch-osm.mjs and fetch-elevation.mjs first');
    process.exit(2);
}
const only = opt('--only', null)?.split(',');
const seed = loadSeed();
const elements = loadElements();
const history = JSON.parse(readFileSync(resolve(here, 'history.json'), 'utf8'));
const results = [];
for (const cfg of CONFIGS.filter(c => !only || only.includes(c.name.split(' ')[0]))) {
    const scale = 1 / cfg.denom;
    const t0 = Date.now();
    const res = bake(elements, seed, { scale, tolScale: cfg.rawTol ? 1 / (13 * scale) : 1, history, log: () => {} });
    const dir = resolve(base, cfg.name.replace(/[^a-z0-9.+-]/gi, '_'));
    const { files_ } = writeBaked(res, seed, dir, history);
    const r = analyse(res, scale, files_);
    r.name = cfg.name; r.eraProblems = res.eraCheck.problems.length; r.dir = dir; r.secs = (Date.now() - t0) / 1000;
    if (args.includes('--validate')) {
        const { loadBakedWorld, validateGraph } = await import('../validate-roads.mjs');
        const world = await loadBakedWorld(dir);
        const v = validateGraph(world, { year: YEAR });
        r.validator = {};
        for (const i of v.issues) r.validator[i.check] = (r.validator[i.check] ?? 0) + 1;
    }
    results.push(r);
    if (!quiet) console.error(`baked ${cfg.name} in ${r.secs.toFixed(1)} s`);
}

const pct = x => `${(x * 100).toFixed(1)}%`;
const rows = [
    ['nodes', r => r.nodes], ['edges', r => r.edges], ['vertices', r => r.vertices],
    ['edges < 6 m', r => r.short6], ['junction pairs < 25 m', r => r.jpairs], ['road gzip (MiB, no elevation)', r => r.gzipMB.toFixed(2)],
    ['town street km (2024)', r => r.streetKm.toFixed(1)],
    ['street overlap km (<11 m, same level)', r => r.overlapKm.toFixed(2)],
    ['street overlap share', r => pct(r.overlapShare)],
    ['all-road overlap share', r => pct(r.allShare)],
    ['after greedy generalisation: km dropped', r => r.droppedKm.toFixed(1)],
    ['  share of street km dropped', r => pct(r.droppedShare)],
    ['  residual overlap share (of original km)', r => pct(r.residualOfOriginal)],
    ['  residual overlap share (of remaining km)', r => pct(r.residualShare)],
    ['roundabouts (rings)', r => r.rb.total], ['  mini-roundabouts', r => r.rb.mini],
    ...['<8', '8-12', '12-20', '20-35', '35+'].map(b => [`  real radius ${b} m`, r => r.rb.bands[b]]),
    ['  ring smaller than 12 m world outer radius', r => r.rb.smallWorld],
    ['era connectivity problems', r => r.eraProblems],
];
const w0 = Math.max(...rows.map(r => r[0].length)) + 2;
const cols = results.map(r => Math.max(r.name.length, 10) + 2);
console.log('metric'.padEnd(w0) + results.map((r, i) => r.name.padStart(cols[i])).join(''));
for (const [label, f] of rows) console.log(label.padEnd(w0) + results.map((r, i) => String(f(r)).padStart(cols[i])).join(''));
const spanKeys = [...new Set(results.flatMap(r => Object.keys(r.spans)))].sort();
for (const k of spanKeys) console.log(`${k} spans (n / km)`.padEnd(w0) + results.map((r, i) => (r.spans[k] ? `${r.spans[k].n} / ${r.spans[k].km.toFixed(1)}` : '-').padStart(cols[i])).join(''));
if (results.some(r => r.validator)) {
    const vk = [...new Set(results.flatMap(r => Object.keys(r.validator ?? {})))].sort();
    for (const k of vk) console.log(`validator ${k}`.padEnd(w0) + results.map((r, i) => String(r.validator?.[k] ?? 0).padStart(cols[i])).join(''));
}
const v = results.find(r => r.name === '1:4');
if (v) console.log(`\n1:4 viability rule (residual street overlap after generalisation <= 10%): ${v.residualOfOriginal <= 0.1 ? 'VIABLE' : 'NOT VIABLE'} (${pct(v.residualOfOriginal)})`);
console.log(`scratch bakes are in ${base} (the committed baked folder is not touched)`);
