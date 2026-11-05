// Resamples the cached elevation grid (.cache/elevation/grid.f32, Web Mercator pixels, see fetch-elevation.mjs) into
// the game's world-metre grid and writes world/seed/baked/elevation.bin (world/elevation-format.js), then records it
// in manifest.json. Heights are real metres x WORLD_SCALE, sea floor clamped to 0. Samples go through the town-lens
// projection (`unproject`), so the terrain lines up with the baked roads.
//
//   node scripts/bake-roads/bake-elevation.mjs [--cell 12]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CACHE, loadSeed } from './common.mjs';

const GAME = resolve(fileURLToPath(import.meta.url), '../../../Games.Client/wwwroot/games/delivery-driver');
const game = p => import(pathToFileURL(`${GAME}/${p}`).href);

const lonToTileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const latToTileY = (lat, z) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z; };

export async function bakeElevation(seed, { outDir = `${GAME}/world/seed/baked`, cell = 12, log = console.log } = {}) {
    const dir = resolve(CACHE, 'elevation');
    const meta = JSON.parse(readFileSync(resolve(dir, 'grid.json'), 'utf8'));
    const raw = readFileSync(resolve(dir, 'grid.f32'));
    const grid = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    const { createProjection } = await game('world/projection.js');
    const { encodeElevation } = await game('world/elevation-format.js');
    const { WORLD_SCALE } = await game('config.js');
    const proj = createProjection(seed);
    const nw = proj.project(seed.bounds.north, seed.bounds.west), se = proj.project(seed.bounds.south, seed.bounds.east);
    const pad = 200;
    const minX = Math.floor((nw.x - pad) / cell) * cell, minY = Math.floor((nw.y - pad) / cell) * cell;
    const width = Math.ceil((se.x + pad - minX) / cell) + 1, height = Math.ceil((se.y + pad - minY) / cell) + 1;
    const unit = 1 / 256; // world metres per step: +-128 m world covers 1664 real m
    const data = new Int16Array(width * height);
    const W = meta.width, H = meta.height;
    const at = (px, py) => grid[Math.max(0, Math.min(H - 1, py)) * W + Math.max(0, Math.min(W - 1, px))];
    let max = 0;
    for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
            const ll = proj.unproject(minX + i * cell, minY + j * cell);
            const fx = (lonToTileX(ll.lon, meta.zoom) - meta.tileX0) * meta.tile - 0.5, fy = (latToTileY(ll.lat, meta.zoom) - meta.tileY0) * meta.tile - 0.5;
            const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
            const h = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
            const w = Math.max(0, h) * WORLD_SCALE;
            if (w > max) max = w;
            data[j * width + i] = Math.round(w / unit);
        }
    }
    const buf = Buffer.from(encodeElevation({ width, height, minX, minY, cell, unit, data }));
    writeFileSync(resolve(outDir, 'elevation.bin'), buf);
    const mf = resolve(outDir, 'manifest.json');
    if (existsSync(mf)) {
        const manifest = JSON.parse(readFileSync(mf, 'utf8'));
        manifest.elevation = { file: 'elevation.bin', cell, unit, width, height, maxWorldM: +max.toFixed(1) };
        writeFileSync(mf, JSON.stringify(manifest));
    }
    log(`elevation.bin: ${width} x ${height} cells of ${cell} m, max ${max.toFixed(1)} world m (${(max / WORLD_SCALE).toFixed(0)} real m), ${(buf.length / 1e6).toFixed(2)} MB`);
    return { width, height, max };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    const i = process.argv.indexOf('--cell');
    await bakeElevation(loadSeed(), { cell: i > 0 ? +process.argv[i + 1] : 12 });
}
