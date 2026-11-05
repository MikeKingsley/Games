// Road network validator for Delivery Driver. Builds the world, then reports structural problems in the road graph
// and street furniture (lamps, signs) that sits on the carriageway or inside buildings.
//
//   node scripts/validate-roads.mjs [--area exeter|plymouth|truro|penzance|all|<town id>[,...]] [--year 2024]
//        [--radius 1500] [--furniture] [--strict] [--json] [--baked]
//
// --baked validates the baked OSM graph (world/seed/baked/, see scripts/bake-roads/bake.mjs) instead of the seeded
// world, with the baked coast for water, and adds the trunk chain check (M5, A30 and A38 form one network).
// // --check-yards (full game world only) checks every depot, garage, industry site and farm: connected to the main
// road network in each sample year, its yard clear of roads and of other yards.
// Exit code is 0 unless --strict is given and a hard check fails.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(here, '../Games.Client/wwwroot/games/delivery-driver');
const game = p => import(pathToFileURL(`${GAME}/${p}`).href);

const { ROAD_CLASS, edgeOpen, edgeWidth, edgeClass } = await game('world/roadgraph.js');
const { closestOnPoly, pointAt } = await game('world/geom.js');
const { waterAt } = await game('world/region.js');
const { obb, sat } = await game('sim/collision.js');
const { gradeLimit } = await game('world/terrain.js');
const { isLive } = await game('world/furniture.js');

const SAMPLE_YEARS = [1919, 1930, 1950, 1970, 1990, 2024];
const DEFAULT_AREAS = ['exeter', 'plymouth', 'truro', 'penzance'];
const YARD_KINDS = new Set(['depot', 'site', 'farm']);

/** Edges that legitimately cross or pass over others without a junction. */
const grade_separated = e => e.bridge || e.tunnel || e.cls === 'ferry';
/** Baked edges carry bridge/tunnel spans: only the stretch on the structure (plus a margin) is grade separated. */
const hasSpans = e => Array.isArray(e.spans);
function separatedAt(e, x, y, margin = 6) {
    if (e.cls === 'ferry') return true;
    if (!hasSpans(e)) return grade_separated(e);
    if (!e.spans.length) return false;
    const along = closestOnPoly(e.pts, x, y).along;
    return e.spans.some(s => along >= s.from - margin && along <= s.to + margin);
}

function inBox(box, x, y) {
    return !box || (x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY);
}
function edgeInBox(box, e) {
    if (!box) return true;
    for (let i = 0; i < e.pts.length; i += 2) if (inBox(box, e.pts[i], e.pts[i + 1])) return true;
    return false;
}

/** Proper intersection of segments a-b and c-d (interior of both); returns {x, y} or null. */
function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
    const r1x = bx - ax, r1y = by - ay, r2x = dx - cx, r2y = dy - cy;
    const den = r1x * r2y - r1y * r2x;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((cx - ax) * r2y - (cy - ay) * r2x) / den;
    const u = ((cx - ax) * r1y - (cy - ay) * r1x) / den;
    if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) return null;
    return { x: ax + r1x * t, y: ay + r1y * t };
}

/**
 * Structural checks on a road graph. `world` needs `graph` (with `index`); `region` is optional (water and grade
 * checks are skipped without it). Returns {counts, issues}: each issue is {check, hard, edge?, node?, x, y, detail}.
 */
export function validateGraph(world, { year = 2024, box = null } = {}) {
    const { graph, region } = world;
    const issues = [];
    const add = (check, hard, x, y, detail, extra = {}) => issues.push({ check, hard, x, y, detail, ...extra });
    const open = graph.edges.filter(e => edgeOpen(e, year));
    const openIds = new Set(open.map(e => e.id));
    const degree = n => n.edges.filter(id => openIds.has(id)).length;

    // connected components over open edges (ignoring nodes with no open edge)
    const parent = graph.nodes.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const e of open) parent[find(e.a)] = find(e.b);
    const comps = new Map();
    for (const n of graph.nodes) if (degree(n) > 0) comps.set(find(n.id), (comps.get(find(n.id)) ?? 0) + 1);
    const compSizes = [...comps.values()].sort((a, b) => b - a);
    if (compSizes.length > 1) {
        const main = [...comps.entries()].sort((a, b) => b[1] - a[1])[0][0];
        for (const n of graph.nodes) {
            if (degree(n) > 0 && find(n.id) !== main && comps.get(find(n.id)) >= 1 && inBox(box, n.x, n.y) && n.edges.length && find(n.id) === n.id) {
                add('disconnected', true, n.x, n.y, `component of ${comps.get(find(n.id))} nodes not joined to the main network`, { node: n.id });
            }
        }
    }

    for (const n of graph.nodes) {
        if (!inBox(box, n.x, n.y)) continue;
        const deg = degree(n);
        if (deg === 1 && !YARD_KINDS.has(n.kind) && n.end !== 'osm' && n.end !== 'boundary') add('dead-end', false, n.x, n.y, `dead end (${n.kind ?? 'node'}${n.town ? ', ' + n.town : ''})`, { node: n.id });
        if (deg > 5) add('odd-degree', false, n.x, n.y, `${deg} roads meet here`, { node: n.id });
        if (deg >= 3) {
            const dirs = n.edges.filter(id => openIds.has(id)).map(id => {
                const e = graph.edges[id];
                const p = pointAt(e.pts, e.a === n.id ? Math.min(8, e.len / 2) : Math.max(e.len - 8, e.len / 2));
                return Math.atan2(p.y - n.y, p.x - n.x);
            });
            let min = Math.PI;
            for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) {
                let d = Math.abs(dirs[i] - dirs[j]) % (2 * Math.PI);
                if (d > Math.PI) d = 2 * Math.PI - d;
                if (d < min) min = d;
            }
            if (min < (30 * Math.PI) / 180) add('sharp-angle', false, n.x, n.y, `junction arms only ${(min * 180 / Math.PI).toFixed(0)} degrees apart`, { node: n.id });
            if (deg === 3) {
                const ranks = n.edges.filter(id => openIds.has(id)).map(id => ROAD_CLASS[edgeClass(graph.edges[id], year)]?.rank ?? 1);
                if (Math.min(...ranks) === Math.max(...ranks) && n.junction !== 'roundabout' && n.junction !== 'signals') {
                    add('no-priority', false, n.x, n.y, 'T-junction of equal-rank roads has no priority', { node: n.id });
                }
            }
        }
    }

    const seenPairs = new Set();
    for (const e of open) {
        if (!edgeInBox(box, e)) continue;
        if (e.len < 3 && e.cls !== 'ferry') add('short-edge', false, e.pts[0], e.pts[1], `edge ${e.id} is ${e.len.toFixed(1)} m`, { edge: e.id });

        // crossings without a shared node
        if (hasSpans(e) || !grade_separated(e)) {
            for (let s = 0; s < e.pts.length / 2 - 1; s++) {
                const ax = e.pts[2 * s], ay = e.pts[2 * s + 1], bx = e.pts[2 * s + 2], by = e.pts[2 * s + 3];
                const reach = Math.hypot(bx - ax, by - ay) / 2 + 2;
                for (const o of graph.index.near((ax + bx) / 2, (ay + by) / 2, reach)) {
                    if (o.edge <= e.id || !openIds.has(o.edge)) continue;
                    const f = graph.edges[o.edge];
                    if (!hasSpans(f) && grade_separated(f)) continue;
                    const cx = f.pts[2 * o.seg], cy = f.pts[2 * o.seg + 1], dx = f.pts[2 * o.seg + 2], dy = f.pts[2 * o.seg + 3];
                    const hit = segCross(ax, ay, bx, by, cx, cy, dx, dy);
                    if (!hit || separatedAt(e, hit.x, hit.y) || separatedAt(f, hit.x, hit.y)) continue;
                    const k = e.id * 100003 + f.id;
                    if (seenPairs.has(k)) continue;
                    seenPairs.add(k);
                    add('crossing-no-node', true, hit.x, hit.y, `edges ${e.id} (${e.cls}) and ${f.id} (${f.cls}) cross with no junction`, { edge: e.id, other: f.id });
                }
            }
        }

        if (!region) continue;
        // water without a bridge
        if (hasSpans(e) || !grade_separated(e)) {
            let wet = 0, first = null;
            for (let d = 0; d <= e.len; d += 6) {
                if (hasSpans(e) && e.spans.some(s => d >= s.from - 6 && d <= s.to + 6)) continue;
                const p = pointAt(e.pts, d);
                if (waterAt(region, p.x, p.y) >= 10) { wet++; first ??= p; }
            }
            if (wet) add('road-in-water', true, first.x, first.y, `edge ${e.id} (${e.cls}) has ${wet} sample(s) in water, no bridge`, { edge: e.id });
        }
        // grade
        if (e.z && e.zStep > 0 && e.cls !== 'ferry') {
            const limit = gradeLimit(region, e);
            let worst = 0, at = 0;
            for (let i = 1; i < e.z.length; i++) {
                const g = Math.abs(e.z[i] - e.z[i - 1]) / e.zStep;
                if (g > worst) { worst = g; at = i; }
            }
            if (worst > limit * 1.1 + 0.005) {
                const p = pointAt(e.pts, at * e.zStep);
                add('grade', false, p.x, p.y, `edge ${e.id} (${e.cls}) climbs ${(worst * 100).toFixed(1)}% against a ${(limit * 100).toFixed(0)}% limit`, { edge: e.id });
            }
        }
    }

    const counts = { nodes: graph.nodes.length, edges: graph.edges.length, openEdges: open.length, components: compSizes.length, largestComponents: compSizes.slice(0, 5) };
    return { counts, issues };
}

/**
 * Trunk chain check: the edges whose ref includes any of `refs` must form one connected network (through shared
 * nodes, including collapsed roundabouts). Returns {counts, issues} with one hard issue per detached piece.
 */
export function validateChains(world, { refs = ['M5', 'A30', 'A38'], year = 2024 } = {}) {
    const { graph } = world;
    const want = new Set(refs);
    const refsOf = e => (e.ref ?? '').split(';').map(r => r.trim()).filter(r => want.has(r));
    const edges = graph.edges.filter(e => edgeOpen(e, year) && refsOf(e).length);
    const parent = new Map();
    const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (const e of edges) { for (const id of [e.a, e.b]) if (!parent.has(id)) parent.set(id, id); parent.set(find(e.a), find(e.b)); }
    const comps = new Map();
    for (const e of edges) {
        const r = find(e.a);
        if (!comps.has(r)) comps.set(r, { len: 0, refs: new Set(), x: e.pts[0], y: e.pts[1] });
        const c = comps.get(r);
        c.len += e.len;
        for (const x of refsOf(e)) c.refs.add(x);
    }
    const list = [...comps.values()].sort((a, b) => b.len - a.len);
    const issues = list.slice(1).map(c => ({ check: 'chain-broken', hard: true, x: c.x, y: c.y, detail: `${[...c.refs].join('/')} piece of ${c.len.toFixed(0)} m not joined to the main ${refs.join('/')} chain` }));
    return { counts: { components: list.length, edges: edges.length, km: +(edges.reduce((a, e) => a + e.len, 0) / 1000).toFixed(1), sizes: list.slice(0, 5).map(c => +c.len.toFixed(0)) }, issues };
}

/**
 * Yard checks. `world` needs `graph` (with `index`) and `yards` (depots, garages, sites, farms; each with `node`,
 * `yard.zone`). Hard issues: yard-disconnected (its node is not in the biggest road component in a sample year),
 * yard-on-road (the yard zone overlaps a carriageway other than its own access), yard-overlap (two yard zones overlap).
 */
export function validateYards(world, { years = SAMPLE_YEARS } = {}) {
    const { graph } = world;
    const issues = [];
    const add = (check, y, detail) => issues.push({ check, hard: true, x: y.x, y: y.y, detail });
    for (const year of years) {
        const parent = graph.nodes.map((_, i) => i);
        const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
        const size = new Map();
        for (const e of graph.edges) if (edgeOpen(e, year)) parent[find(e.a)] = find(e.b);
        for (const n of graph.nodes) if (n.edges.some(id => edgeOpen(graph.edges[id], year))) { const r = find(n.id); size.set(r, (size.get(r) ?? 0) + 1); }
        const main = [...size.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        for (const y of world.yards) if (find(y.node) !== main) add('yard-disconnected', y, `${y.name} (${y.type}) is not on the main road network in ${year}`);
    }
    for (const y of world.yards) {
        const own = new Set(graph.nodes[y.node].edges);
        const zone = y.yard.zone;
        for (const s of graph.index.near(zone.x, zone.y, Math.hypot(zone.hx, zone.hy) + 30)) {
            if (own.has(s.edge)) continue;
            const e = graph.edges[s.edge];
            if (e.cls === 'ferry') continue;
            const ax = e.pts[2 * s.seg], ay = e.pts[2 * s.seg + 1], bx = e.pts[2 * s.seg + 2], by = e.pts[2 * s.seg + 3];
            if (segBoxGap(ax, ay, bx, by, zone) < ROAD_CLASS[e.cls].width / 2 - 0.01) { add('yard-on-road', y, `${y.name} (${y.type}) overlaps ${e.name ?? e.cls}`); break; }
        }
    }
    for (let i = 0; i < world.yards.length; i++) {
        for (let j = i + 1; j < world.yards.length; j++) {
            const a = world.yards[i].yard.zone, b = world.yards[j].yard.zone;
            if (Math.hypot(a.x - b.x, a.y - b.y) < 80 && sat(a, b)) add('yard-overlap', world.yards[i], `${world.yards[i].name} overlaps ${world.yards[j].name}`);
        }
    }
    return { counts: { yards: world.yards.length }, issues };
}

/** Distance from a segment to an obb (0 when they touch), by sampling. */
function segBoxGap(ax, ay, bx, by, box) {
    const c = Math.cos(box.angle), s = Math.sin(box.angle);
    const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 1.5));
    let best = Infinity;
    for (let i = 0; i <= n; i++) {
        const x = ax + ((bx - ax) * i) / n - box.x, y = ay + ((by - ay) * i) / n - box.y;
        const lx = x * c + y * s, ly = -x * s + y * c;
        best = Math.min(best, Math.hypot(Math.max(0, Math.abs(lx) - box.hx), Math.max(0, Math.abs(ly) - box.hy)));
    }
    return best;
}

/** Builds a validation world ({graph, region}) from the baked tiles under world/seed/baked/. */
export async function loadBakedWorld(dir = `${GAME}/world/seed/baked`) {
    const { decodeTiles, decodeLines } = await game('world/baked-format.js');
    const { createGraph, createSegmentIndex } = await game('world/roadgraph.js');
    const { createProjection } = await game('world/projection.js');
    const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
    const tiles = manifest.tiles.map(t => JSON.parse(readFileSync(`${dir}/${t.file}`, 'utf8')));
    const { nodes, edges } = decodeTiles(tiles);
    const graph = createGraph();
    for (const n of nodes) graph.addNode(n.x, n.y, { junction: n.junction, end: n.end, priority: n.priority, mini: n.mini, town: n.town, signalsFrom: n.signalsFrom, roundaboutFrom: n.roundaboutFrom, kind: n.end ? 'end' : 'junction' });
    for (const e of edges) {
        const { a, b, pts, ...props } = e;
        graph.addEdge(graph.nodes[a], graph.nodes[b], pts, props);
    }
    graph.index = createSegmentIndex(graph);
    const json = JSON.parse(readFileSync(`${GAME}/world/seed/sw-england.json`, 'utf8'));
    const proj = createProjection(json, { lens: manifest.projection.lens });
    const rings = decodeLines(JSON.parse(readFileSync(`${dir}/${manifest.coast}`, 'utf8')).rings);
    // one flat even-odd polygon: every ring is entered from and left back to a shared anchor point, so the
    // connecting segments are each traversed twice and cancel out
    const coast = [];
    const ax = rings[0][0], ay = rings[0][1];
    for (const r of rings) { coast.push(ax, ay); for (const v of r) coast.push(v); }
    const nw = proj.project(json.bounds.north, json.bounds.west), se = proj.project(json.bounds.south, json.bounds.east);
    const towns = json.towns.map(t => ({ ...t, ...proj.project(t.lat, t.lon) }));
    const region = {
        id: json.id, bounds: { minX: nw.x, minY: nw.y, maxX: se.x, maxY: se.y }, coast, rivers: [], moors: [], towns,
        townById: new Map(towns.map(t => [t.id, t])), events: manifest.events, maxGrade: { ...json.maxGrade }, waterCache: new Map(),
    };
    return { graph, region, manifest };
}

/**
 * Furniture checks. `props` is [{x, y, kind}] (lamps, signs, signals); `buildings` is [{box}].
 * A prop is on the road if it lies within half the carriageway plus `margin` of any open edge's centreline.
 */
export function validateFurniture(world, props, { year = 2024, margin = 0.5, buildings = [] } = {}) {
    const { graph } = world;
    const issues = [];
    const buildingIdx = new Map();
    const bkey = (x, y) => Math.floor(x / 32) * 100003 + Math.floor(y / 32);
    for (const b of buildings) {
        const r = Math.hypot(b.box.hx, b.box.hy);
        for (let i = Math.floor((b.box.x - r) / 32); i <= Math.floor((b.box.x + r) / 32); i++) {
            for (let j = Math.floor((b.box.y - r) / 32); j <= Math.floor((b.box.y + r) / 32); j++) {
                const k = i * 100003 + j;
                (buildingIdx.get(k) ?? buildingIdx.set(k, []).get(k)).push(b);
            }
        }
    }
    const seen = new Set();
    for (const p of props) {
        let onRoad = null;
        const done = new Set();
        for (const s of graph.index.near(p.x, p.y, 30)) {
            if (done.has(s.edge)) continue;
            done.add(s.edge);
            const e = graph.edges[s.edge];
            if (!edgeOpen(e, year) || e.cls === 'ferry' || e.bridge) continue;
            const c = closestOnPoly(e.pts, p.x, p.y);
            const half = edgeWidth(e, year) / 2 + margin;
            if (c.d < half && (!onRoad || c.d < onRoad.d)) onRoad = { d: c.d, edge: e.id, half };
        }
        const id = `${p.kind}:${p.x.toFixed(2)}:${p.y.toFixed(2)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        if (onRoad) {
            issues.push({ check: 'furniture-on-road', hard: true, x: p.x, y: p.y, edge: onRoad.edge, detail: `${p.kind} ${onRoad.d.toFixed(1)} m from edge ${onRoad.edge} centreline (carriageway + margin ${onRoad.half.toFixed(1)} m)` });
        }
        const probe = obb(p.x, p.y, 0.4, 0.4, 0);
        for (const b of buildingIdx.get(bkey(p.x, p.y)) ?? []) {
            if (sat(b.box, probe)) { issues.push({ check: 'furniture-in-building', hard: true, x: p.x, y: p.y, detail: `${p.kind} inside a building` }); break; }
        }
    }
    return { counts: { props: props.length }, issues };
}

/** Lamps, signs and signals of the chunks covering a box (generates them). */
export function collectFurniture(world, box, year = 2024) {
    const { CHUNK_SIZE } = world.constants;
    const props = [], buildings = new Map();
    for (let i = Math.floor(box.minX / CHUNK_SIZE); i <= Math.floor(box.maxX / CHUNK_SIZE); i++) {
        for (let j = Math.floor(box.minY / CHUNK_SIZE); j <= Math.floor(box.maxY / CHUNK_SIZE); j++) {
            const c = world.chunks.get(i, j);
            for (const l of c.lamps ?? []) if (isLive(l, year)) props.push({ kind: 'lamp', x: l.x, y: l.y });
            for (const s of c.signs ?? []) if (isLive(s, year)) props.push({ kind: 'sign', x: s.x, y: s.y });
            for (const s of c.signals ?? []) props.push({ kind: 'signal', x: s.x, y: s.y });
            for (const b of c.buildings ?? []) buildings.set(b, b);
        }
    }
    return { props, buildings: [...buildings.keys()] };
}

// ---- CLI ---------------------------------------------------------------------------------------------------------

const toArrayBuffer = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

function parseArgs(argv) {
    const o = { area: DEFAULT_AREAS.join(','), year: 2024, radius: 1500, furniture: false, strict: false, json: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--area') o.area = argv[++i];
        else if (a === '--year') o.year = +argv[++i];
        else if (a === '--radius') o.radius = +argv[++i];
        else if (a === '--furniture') o.furniture = true;
        else if (a === '--strict') o.strict = true;
        else if (a === '--json') o.json = true;
        else if (a === '--baked') o.baked = true;
        else if (a === '--check-yards') o.yards = true;
        else throw new Error(`unknown argument ${a}`);
    }
    return o;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const { CHUNK_SIZE } = await game('config.js');
    let world;
    if (opts.baked) {
        world = await loadBakedWorld();
        if (opts.furniture) { console.warn('note: --furniture needs generated chunks; not available with --baked yet'); opts.furniture = false; }
    } else {
        const { createWorld } = await game('world/world.js');
        // the full game world: seed + baked roads + yards, farms and generated chunks (what the game builds at load)
        const { decodeBaked } = await game('world/baked-loader.js');
        const dir = `${GAME}/world/seed/baked`;
        const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
        const baked = decodeBaked(manifest, manifest.tiles.map(t => JSON.parse(readFileSync(`${dir}/${t.file}`, 'utf8'))), JSON.parse(readFileSync(`${dir}/${manifest.coast}`, 'utf8')), toArrayBuffer(readFileSync(`${dir}/${manifest.elevation.file}`)));
        world = createWorld({ ...JSON.parse(readFileSync(`${GAME}/world/seed/sw-england.json`, 'utf8')), baked });
    }
    world.constants = { CHUNK_SIZE };
    if (opts.yards && !world.yards) { console.warn('note: --check-yards needs the full game world; it is skipped with --baked'); opts.yards = false; }

    const areas = opts.area === 'all' ? [null] : opts.area.split(',').map(id => {
        const t = world.region.towns.find(t => t.id === id);
        if (!t) throw new Error(`unknown area/town "${id}"`);
        return { id, box: { minX: t.x - opts.radius, maxX: t.x + opts.radius, minY: t.y - opts.radius, maxY: t.y + opts.radius } };
    });

    const report = [];
    let hard = 0;
    for (const area of areas) {
        const box = area?.box ?? null;
        const g = validateGraph(world, { year: opts.year, box });
        let issues = g.issues;
        let furnitureCounts = null;
        if (opts.furniture) {
            const fbox = box ?? { minX: world.region.bounds.minX, maxX: world.region.bounds.maxX, minY: world.region.bounds.minY, maxY: world.region.bounds.maxY };
            const { props, buildings } = collectFurniture(world, fbox, opts.year);
            const f = validateFurniture(world, props, { year: opts.year, buildings });
            furnitureCounts = f.counts;
            issues = issues.concat(f.issues);
        }
        if (opts.yards) issues = issues.concat(validateYards(world).issues.filter(i => !box || (i.x >= box.minX && i.x <= box.maxX && i.y >= box.minY && i.y <= box.maxY)));
        const byCheck = {};
        for (const i of issues) byCheck[i.check] = (byCheck[i.check] ?? 0) + 1;
        let chains = null;
        if (opts.baked && !area) {
            const c = validateChains(world, { year: opts.year });
            chains = c.counts;
            issues = issues.concat(c.issues);
            for (const i of c.issues) byCheck[i.check] = (byCheck[i.check] ?? 0) + 1;
        }
        hard += issues.filter(i => i.hard).length;
        report.push({ area: area?.id ?? 'all', counts: g.counts, furniture: furnitureCounts, chains, byCheck, issues });
    }

    if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        for (const r of report) {
            console.log(`\n== ${r.area} (year ${opts.year}) ==`);
            console.log(`graph: ${r.counts.nodes} nodes, ${r.counts.edges} edges (${r.counts.openEdges} open), ${r.counts.components} component(s) ${JSON.stringify(r.counts.largestComponents)}`);
            if (r.furniture) console.log(`furniture props checked: ${r.furniture.props}`);
            if (r.chains) console.log(`M5/A30/A38 chain: ${r.chains.components} component(s), ${r.chains.edges} edges, ${r.chains.km} km ${JSON.stringify(r.chains.sizes)}`);
            if (!r.issues.length) console.log('no issues');
            for (const [check, n] of Object.entries(r.byCheck)) console.log(`  ${check}: ${n}`);
            for (const i of r.issues.slice(0, 5)) console.log(`    e.g. [${i.check}] (${i.x.toFixed(0)}, ${i.y.toFixed(0)}) ${i.detail}`);
        }
        console.log(`\nhard failures: ${hard}`);
    }
    process.exitCode = opts.strict && hard ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
