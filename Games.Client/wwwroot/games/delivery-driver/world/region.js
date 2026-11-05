// Region data: the hand-written seed JSON (towns, industry sites, moors, relief, ferries, rivers) plus the baked
// OpenStreetMap data (road graph, coastline, era events; world/baked-loader.js) projected into world metres through
// the shared plain projection (world/projection.js). Several regions can be registered by id.
import { WORLD_SCALE } from '../config.js';
import { createProjection, TOWN_RADIUS } from './projection.js';
import { fetchBaked, splitCoast } from './baked-loader.js';

const regions = new Map();

/**
 * Projects a seed JSON into world space. `json.baked` (the decoded baked data) is required: the coast and the road
 * graph come from it. Pure: usable from Node tests (read the JSON with fs and attach `baked`).
 */
export function buildRegion(json) {
    const baked = json.baked;
    if (!baked) throw new Error('buildRegion: the seed needs baked road data (json.baked, see world/baked-loader.js)');
    const proj = createProjection(json);
    const origin = json.origin;
    const project = (lat, lon) => proj.project(lat, lon);
    const towns = json.towns.map(t => ({ ...t, ...project(t.lat, t.lon), radius: TOWN_RADIUS[t.size] ?? 100 }));
    const townById = new Map(towns.map(t => [t.id, t]));
    const point = p => (typeof p === 'string'
        ? { ...pos(townById.get(p), p), town: p }
        : { ...project(p[0], p[1]), key: `${p[0]},${p[1]}` });
    // the seed's hand-written roads are only kept for the ferries and bridges the baker does not produce (Phase 7)
    const seedRoads = json.roads.map(r => ({
        id: r.id, name: r.name, cls: r.class,
        pts: r.points.map(point),
        opened: r.opened ?? 0, closed: r.closed ?? Infinity,
        upgrades: r.upgrades ?? [], ferry: r.ferry ?? null, bridge: !!r.bridge,
    }));
    const sites = json.sites.map(s => ({ ...s, ...(s.lat !== undefined ? project(s.lat, s.lon) : {}) }));
    const flat = list => list.flatMap(([lat, lon]) => { const w = project(lat, lon); return [w.x, w.y]; });
    const { mainland, islands } = splitCoast(baked.coastRings);
    // terrain data (world/terrain.js): heights and radii are real metres in the seed, scaled like positions
    const moors = json.moors.map(m => ({ id: m.id, name: m.name, pts: flat(m.points), height: m.height !== undefined ? m.height * WORLD_SCALE : undefined }));
    // The seed's hand-drawn rivers do not line up with the real roads (a real road crosses the real Exe on a bridge the
    // baker flagged; a hand-drawn line would put it through the water), so inland rivers are off until the real
    // elevation arrives (Phase 8). Tidal rivers and estuaries are already water: the baked coastline follows them.
    const rivers = [];
    const relief = (json.relief ?? []).map(r => ({
        name: r.name, ...project(r.lat, r.lon), height: r.height * WORLD_SCALE, radius: r.radius * WORLD_SCALE, cliff: !!r.cliff,
    }));
    const nw = project(json.bounds.north, json.bounds.west), se = project(json.bounds.south, json.bounds.east);
    const region = {
        id: json.id, name: json.name, seed: json.seed, origin,
        bounds: { minX: nw.x, minY: nw.y, maxX: se.x, maxY: se.y },
        towns, townById, sites, roads: [], seedRoads, coast: mainland, islands, moors, rivers, relief,
        maxGrade: { ...json.maxGrade },
        events: baked.events,
        elevation: baked.elevation ?? null, // real heights (world/elevation-format.js); null = procedural terrain
        baked,
        projection: proj,
        project,
        waterCache: new Map(),
    };
    regions.set(region.id, region);
    return region;
}

function pos(t, id) {
    if (!t) throw new Error(`Unknown town in road: ${id}`);
    return { x: t.x, y: t.y };
}

export const getRegion = id => regions.get(id);

/** Browser: fetches and builds a region (the seed file world/seed/<id>.json plus the baked data under seed/baked/). */
export async function loadRegion(id) {
    if (regions.has(id)) return regions.get(id);
    const [res, baked] = await Promise.all([
        fetch(new URL(`./seed/${id}.json`, import.meta.url)),
        fetchBaked(new URL('./seed/baked/', import.meta.url)),
    ]);
    return buildRegion({ ...(await res.json()), baked });
}

/** Point in polygon (flat [x0, y0, x1, y1, ...]), even-odd rule. */
export function inPolygon(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
        const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

/** Distance from a point to segment (ax, ay)-(bx, by), and the parameter t of the closest point. */
export function segDistance(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const cx = ax + dx * t, cy = ay + dy * t;
    return { d: Math.hypot(px - cx, py - cy), t, x: cx, y: cy };
}

/** Width of river at the nearest point if (x, y) is inside a river, else 0. */
export function riverAt(region, x, y) {
    for (const r of region.rivers) {
        // (same sums as segDistance, without allocating: this runs for every miss of the water cache)
        const box = (r.box ??= riverBox(r));
        if (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY) continue;
        for (let i = 0; i < r.pts.length - 1; i++) {
            const a = r.pts[i], b = r.pts[i + 1];
            const dx = b.x - a.x, dy = b.y - a.y;
            const len2 = dx * dx + dy * dy;
            const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
            const w = a.w + (b.w - a.w) * t;
            if (Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)) <= w / 2) return w;
        }
    }
    return 0;
}

/** A river's bounding box grown by half its widest width (no point outside it can be in the river). */
function riverBox(r) {
    const half = Math.max(...r.pts.map(p => p.w)) / 2 + 1;
    return {
        minX: Math.min(...r.pts.map(p => p.x)) - half, maxX: Math.max(...r.pts.map(p => p.x)) + half,
        minY: Math.min(...r.pts.map(p => p.y)) - half, maxY: Math.max(...r.pts.map(p => p.y)) + half,
    };
}

/**
 * Even-odd point-in-polygon for big rings (the baked coast has ~20,000 vertices): edges are bucketed by the rows
 * (ROW m tall) they span, so a test only walks the edges of one row.
 */
const ROW = 64;
function indexPolygon(pts) {
    const rows = new Map();
    for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
        const y0 = Math.min(pts[i + 1], pts[j + 1]), y1 = Math.max(pts[i + 1], pts[j + 1]);
        for (let r = Math.floor(y0 / ROW); r <= Math.floor(y1 / ROW); r++) {
            let list = rows.get(r);
            if (!list) rows.set(r, (list = []));
            list.push(i);
        }
    }
    return { pts, rows };
}
function inIndexed(ix, x, y) {
    const list = ix.rows.get(Math.floor(y / ROW));
    if (!list) return false;
    const pts = ix.pts;
    let inside = false;
    for (const i of list) {
        const j = i === 0 ? pts.length - 2 : i - 2;
        const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

/** Land: inside the mainland ring or an island ring, or on the open eastern edge ("up country"). */
export function isLand(region, x, y) {
    const ix = (region._landIndex ??= [region.coast, ...(region.islands ?? [])].map(indexPolygon));
    if (x > region.bounds.maxX - 1) return true;
    for (const p of ix) if (inIndexed(p, x, y)) return true;
    return false;
}

/**
 * Water test, cached on a 4 m grid. Returns 0 for land, otherwise the water's width class:
 * Infinity for the sea, the river width (world metres) for rivers and estuaries.
 */
export function waterAt(region, x, y) {
    const key = Math.floor(x / 4) * 100003 + Math.floor(y / 4);
    let v = region.waterCache.get(key);
    if (v === undefined) {
        const cx = (Math.floor(x / 4) + 0.5) * 4, cy = (Math.floor(y / 4) + 0.5) * 4;
        v = !isLand(region, cx, cy) ? Infinity : riverAt(region, cx, cy);
        // a road on dry land is dry: shoreline roads (quays, sea walls) lie within a metre or two of the baked coastline
        if (v > 0 && region.dryRoad?.(cx, cy)) v = 0;
        if (region.waterCache.size > 400000) region.waterCache.clear();
        region.waterCache.set(key, v);
    }
    return v;
}

export function moorAt(region, x, y) {
    for (const m of region.moors) if (inPolygon(m.pts, x, y)) return m;
    return null;
}

/** True if the straight line between two points crosses water at least `minWidth` wide (sampled every 6 m). */
export function crossesWater(region, ax, ay, bx, by, minWidth = 30) {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 6));
    for (let i = 0; i <= n; i++) {
        const w = waterAt(region, ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n);
        if (w >= minWidth) return true;
    }
    return false;
}

export function nearestTown(region, x, y) {
    let best = null, bestD = Infinity;
    for (const t of region.towns) {
        const d = Math.hypot(t.x - x, t.y - y) / t.radius;
        if (d < bestD) { bestD = d; best = t; }
    }
    return { town: best, ratio: bestD };
}
