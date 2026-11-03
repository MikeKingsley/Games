// Region data: a hand-written seed JSON (real towns, roads, coast, moors, rivers) projected into world metres.
// Several regions can be registered by id, so other parts of the UK can be added later as more seed files.
import { latLonToWorld } from '../config.js';

const TOWN_RADIUS = { city: 320, town: 220, small: 160, village: 85 };
const regions = new Map();

/** Projects a seed JSON into world space. Pure: usable from Node tests (read the JSON with fs). */
export function buildRegion(json) {
    const origin = json.origin;
    const project = (lat, lon) => latLonToWorld(lat, lon, origin);
    const towns = json.towns.map(t => ({ ...t, ...project(t.lat, t.lon), radius: TOWN_RADIUS[t.size] ?? 100 }));
    const townById = new Map(towns.map(t => [t.id, t]));
    const point = p => (typeof p === 'string'
        ? { ...pos(townById.get(p), p), town: p }
        : { ...project(p[0], p[1]), key: `${p[0]},${p[1]}` });
    const roads = json.roads.map(r => ({
        id: r.id, name: r.name, cls: r.class,
        pts: r.points.map(point),
        opened: r.opened ?? 0, closed: r.closed ?? Infinity,
        upgrades: r.upgrades ?? [], ferry: r.ferry ?? null, bridge: !!r.bridge,
    }));
    const sites = json.sites.map(s => ({ ...s, ...(s.lat !== undefined ? project(s.lat, s.lon) : {}) }));
    const flat = list => list.flatMap(([lat, lon]) => { const w = project(lat, lon); return [w.x, w.y]; });
    const coast = flat(json.coast);
    const moors = json.moors.map(m => ({ id: m.id, name: m.name, pts: flat(m.points) }));
    const rivers = json.rivers.map(r => ({
        id: r.id, name: r.name,
        pts: r.points.map(([lat, lon, w]) => ({ ...project(lat, lon), w })),
    }));
    const nw = project(json.bounds.north, json.bounds.west), se = project(json.bounds.south, json.bounds.east);
    const region = {
        id: json.id, name: json.name, seed: json.seed, origin,
        bounds: { minX: nw.x, minY: nw.y, maxX: se.x, maxY: se.y },
        towns, townById, sites, roads, coast, moors, rivers,
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

/** Browser: fetches and builds a region's seed file (world/seed/<id>.json). */
export async function loadRegion(id) {
    if (regions.has(id)) return regions.get(id);
    const res = await fetch(new URL(`./seed/${id}.json`, import.meta.url));
    return buildRegion(await res.json());
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
        for (let i = 0; i < r.pts.length - 1; i++) {
            const a = r.pts[i], b = r.pts[i + 1];
            const s = segDistance(x, y, a.x, a.y, b.x, b.y);
            const w = a.w + (b.w - a.w) * s.t;
            if (s.d <= w / 2) return w;
        }
    }
    return 0;
}

export const isLand = (region, x, y) => inPolygon(region.coast, x, y) || x > region.bounds.maxX - 1;

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
