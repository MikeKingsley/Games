// Test helper: the Delivery Driver seed JSON with the baked road data attached (what world/region.js loadRegion builds
// in the browser). Reads the files with fs, so tests can `createWorld(seedWithBaked())`.
import fs from 'node:fs';
import { decodeBaked } from '../../../Games.Client/wwwroot/games/delivery-driver/world/baked-loader.js';

const DIR = new URL('../../../Games.Client/wwwroot/games/delivery-driver/world/seed/', import.meta.url);
const read = rel => JSON.parse(fs.readFileSync(new URL(rel, DIR), 'utf8'));

let cachedBaked = null;
/** The decoded baked data (decoded once per process). */
export function loadBaked() {
    if (!cachedBaked) {
        const manifest = read('baked/manifest.json');
        const bin = fs.readFileSync(new URL(`baked/${manifest.elevation.file}`, DIR));
        const dem = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
        cachedBaked = decodeBaked(manifest, manifest.tiles.map(t => read(`baked/${t.file}`)), read(`baked/${manifest.coast}`), dem);
    }
    return cachedBaked;
}

/** A fresh copy of the seed JSON with `baked` attached (pass overrides such as {id, seed}). */
export function seedWithBaked(overrides = {}) {
    return { ...read('sw-england.json'), baked: loadBaked(), ...overrides };
}
