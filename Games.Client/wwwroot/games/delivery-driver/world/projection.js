// The game projection: latitude/longitude to world metres (+x east, +y south). Pure: shared by the road bake
// (scripts/bake-roads/bake.mjs), the runtime loader and the tests, so everything baked lines up.
//
// Plain equirectangular projection of config.latLonToWorld (REF_LAT, scaled by WORLD_SCALE = 1/4). There is no town
// lens any more: a real town is as dense as in the real world, only 4x smaller, and towns are as far apart as the map
// is. Positions of a town's streets follow the real map, so the 2D map no longer warps around towns.
import { WORLD_SCALE, REF_LAT } from '../config.js';

export const M_PER_DEG_LAT = 110574;
export const M_PER_DEG_LON = 111320 * Math.cos((REF_LAT * Math.PI) / 180);

/**
 * Real-world radius (real metres) of a town's baked street footprint by size: where real residential streets are
 * baked (the OSM cache under .cache/osm covers exactly these radii; enlarging them needs a fresh Overpass fetch).
 */
export const TOWN_FOOTPRINT = { city: 1210, town: 910, small: 730, village: 505 };
export const townFootprint = t => TOWN_FOOTPRINT[t.size] ?? 505;
/** Game radius (world metres) of a town by size: the street footprint times the world scale. */
export const TOWN_RADIUS = Object.fromEntries(Object.entries(TOWN_FOOTPRINT).map(([k, v]) => [k, v * WORLD_SCALE]));

/** Lat/lon to real metres relative to an origin (same axes as world space, no WORLD_SCALE). */
export function latLonToReal(lat, lon, origin) {
    return { x: (lon - origin.lon) * M_PER_DEG_LON, y: (origin.lat - lat) * M_PER_DEG_LAT };
}
export function realToLatLon(x, y, origin) {
    return { lat: origin.lat - y / M_PER_DEG_LAT, lon: origin.lon + x / M_PER_DEG_LON };
}

/**
 * The projection of a region seed JSON ({origin}). Returns project(lat, lon), unproject(x, y), fromReal(x, y)
 * (real-metre frame -> world), toReal(x, y) and `localScale(x, y)` (world metres per real metre, constant).
 * `scale` overrides WORLD_SCALE (the plan 0009 measurement bakes at 1/5 and 1/13 without touching config.js).
 */
export function createProjection(json, { scale = WORLD_SCALE } = {}) {
    const origin = json.origin;
    const fromReal = (x, y) => ({ x: x * scale, y: y * scale });
    const toReal = (x, y) => ({ x: x / scale, y: y / scale });
    const project = (lat, lon) => { const r = latLonToReal(lat, lon, origin); return fromReal(r.x, r.y); };
    const unproject = (x, y) => { const r = toReal(x, y); return realToLatLon(r.x, r.y, origin); };
    const localScale = () => scale;
    return { origin, project, unproject, fromReal, toReal, localScale, worldScale: scale };
}
