// Shared helpers for the road bake scripts: region bounds, tile grids, cache paths.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../..');
export const CACHE = resolve(ROOT, '.cache');
export const SEED = resolve(ROOT, 'Games.Client/wwwroot/games/delivery-driver/world/seed/sw-england.json');
export const loadSeed = () => JSON.parse(readFileSync(SEED, 'utf8'));

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const USER_AGENT = 'GamesRoadBake/0.1 (hobby game; contact mikekingsley@live.co.uk)';

/** Metres per degree of latitude / longitude at a latitude (good enough for tile and footprint sizing). */
export const M_PER_LAT = 111320;
export const mPerLon = lat => 111320 * Math.cos((lat * Math.PI) / 180);

/** Town footprint (real m) where real streets are baked; shared with the game projection (world/projection.js). */
export { TOWN_RADIUS, TOWN_FOOTPRINT, townFootprint } from '../../Games.Client/wwwroot/games/delivery-driver/world/projection.js';
import { townFootprint } from '../../Games.Client/wwwroot/games/delivery-driver/world/projection.js';

export function townBoxes(seed) {
    return seed.towns.map(t => {
        const r = townFootprint(t);
        const dLat = r / M_PER_LAT, dLon = r / mPerLon(t.lat);
        return { id: t.id, south: t.lat - dLat, north: t.lat + dLat, west: t.lon - dLon, east: t.lon + dLon };
    });
}
