// Tuning constants shared by the logic and the renderer. Pure data: safe to import from Node tests.

/** Real metres to world metres. Devon + Cornwall is compressed ~1:13 so Exeter-Penzance is ~10 real minutes at 50 mph. */
export const WORLD_SCALE = 1 / 13;
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
export const AUTO_PREFERS_WEBGL = false;

export const QUALITY = {
    low: { traffic: 8, drawChunks: 2, spriteCache: 24, maxDpr: 1, trees: 0.4, shadows: false },
    medium: { traffic: 16, drawChunks: 3, spriteCache: 48, maxDpr: 1.5, trees: 0.75, shadows: true },
    high: { traffic: 28, drawChunks: 4, spriteCache: 96, maxDpr: 2, trees: 1, shadows: true },
};

/** Loading-bay tolerances. */
export const BAY = { position: 1.5, heading: (15 * Math.PI) / 180, speed: 0.05 };

/** Coupling tolerances for articulated trucks. */
export const COUPLE = { distance: 0.4, heading: (10 * Math.PI) / 180, speed: 0.5 };

/** Real seconds between autosaves. */
export const AUTOSAVE_SECONDS = 180;

export const START_YEAR = 1919;
export const START_MONEY = 400;
