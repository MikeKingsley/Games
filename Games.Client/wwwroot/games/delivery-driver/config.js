// Tuning constants shared by the logic and the renderer. Pure data: safe to import from Node tests.

/** Real metres to world metres: the map is 1:2 (plan 0009, moved from 1:4 in phase 14). Vehicle speeds stay real mph, so Exeter-Penzance takes ~6.5x longer than at the old 1:13. */
export const WORLD_SCALE = 1 / 2;
/** The map scale before plan 0009 (1:13), the baseline every economy value was tuned against. */
export const LEGACY_SCALE = 1 / 13;
/**
 * New-to-old map scale (6.5 at 1:2). Vehicle speeds are unchanged real mph, so any real distance now takes TRIP_RATE times
 * longer to drive than at 1:13. It is the one economy/timing rebalance constant:
 * - per-real-mile rates (job pay per mile, fuel per km, wear per mile) are multiplied by it, so a minute of driving
 *   pays and costs what it did at 1:13 (distances shown to the player stay real miles via worldToMiles);
 * - world-metre distances tuned at 1:13 (offer ranges, route limits, farm radius, minimum trip lengths) are
 *   multiplied by it so jobs still span the same real distances (their drive times grow by the same factor, and
 *   contract windows follow because they derive from route length / speed);
 * - the Phase 5 map-raster cell and a road-mesh time budget reuse it as a plain "same real area" factor.
 */
export const TRIP_RATE = WORLD_SCALE / LEGACY_SCALE;
/** Game minutes per real minute: 1 real minute = 15 game minutes. */
export const TIME_SCALE = 15;
/** Reference latitude for the equirectangular projection. */
export const REF_LAT = 50.5;

const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320 * Math.cos((REF_LAT * Math.PI) / 180);

/** Lat/long to world metres (+x east, +y south) relative to a region origin {lat, lon}. */
export function latLonToWorld(lat, lon, origin) {
    return {
        x: (lon - origin.lon) * M_PER_DEG_LON * WORLD_SCALE,
        y: (origin.lat - lat) * M_PER_DEG_LAT * WORLD_SCALE,
    };
}

/** Inverse of latLonToWorld. */
export function worldToLatLon(x, y, origin) {
    return {
        lat: origin.lat - y / (M_PER_DEG_LAT * WORLD_SCALE),
        lon: origin.lon + x / (M_PER_DEG_LON * WORLD_SCALE),
    };
}

export const MPH = 0.44704;           // m/s per mph
export const METRES_PER_MILE = 1609.344;
/** World metres per displayed mile: distances shown in the HUD are real miles (world distance / WORLD_SCALE). */
export const worldToMiles = metres => metres / WORLD_SCALE / METRES_PER_MILE;

/** Size of a generated world chunk (metres). */
export const CHUNK_SIZE = 160;

/** Quality presets. The device picks one in settings; low is for mid-range phones. */
/** Whether renderer 'auto' picks WebGL when available (flipped on in plan 0007 phase 10). */
export const AUTO_PREFERS_WEBGL = true;

export const QUALITY = {
    // traffic .. shadows serve both renderers; the rest is WebGL only: view distance (m), shadow map texels per side,
    // MSAA (applied when the context is created) and the far-field terrain grid resolution. Corridor detail (the
    // Slow Roads idea, render/gl/chunk-build.js): roads keep their full mesh only within `roadDetail` metres of the
    // camera and the coarse variant beyond; `roadLevel` is the detail inside that corridor (render/gl/road-mesh.js
    // DETAIL: 2 full, 1 basic = no pavements, zebras, piers, abutments or embankments, junction pavements or island
    // trees); `buildMs` is the time a frame may spend building chunks (one build always goes ahead).
    low: { traffic: 8, drawChunks: 2, spriteCache: 24, maxDpr: 1, trees: 0.4, shadows: false, viewDistance: 400, shadowMapSize: 0, antialias: false, farField: 48, roadDetail: 240, roadLevel: 1, buildMs: 4 },
    medium: { traffic: 16, drawChunks: 3, spriteCache: 48, maxDpr: 1.5, trees: 0.75, shadows: true, viewDistance: 560, shadowMapSize: 1024, antialias: false, farField: 72, roadDetail: 330, roadLevel: 2, buildMs: 6 },
    high: { traffic: 28, drawChunks: 4, spriteCache: 96, maxDpr: 2, trees: 1, shadows: true, viewDistance: 720, shadowMapSize: 2048, antialias: true, farField: 96, roadDetail: 480, roadLevel: 2, buildMs: 8 },
};

/** Loading-bay tolerances. */
export const BAY = { position: 1.5, heading: (15 * Math.PI) / 180, speed: 0.05 };

/** Coupling tolerances for articulated trucks (height: kingpin vs fifth wheel, m, on uneven ground). */
export const COUPLE = { distance: 0.4, heading: (10 * Math.PI) / 180, speed: 0.5, height: 0.25 };

/** Real seconds between autosaves. */
export const AUTOSAVE_SECONDS = 180;

export const START_YEAR = 1919;
export const START_MONEY = 400;
