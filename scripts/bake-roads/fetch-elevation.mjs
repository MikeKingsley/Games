// Downloads Terrarium-format elevation tiles (AWS open terrain tiles) covering the region into .cache/elevation/,
// then decodes and stitches them into one float32 grid (.cache/elevation/grid.f32 + grid.json).
//
//   node scripts/bake-roads/fetch-elevation.mjs [--check] [--zoom 11]
//
// Zoom 11 gives ~49 m cells at 50 degrees north. Terrarium: height_m = R * 256 + G + B / 256 - 32768.
// The grid is in Web Mercator pixel space, tile aligned; the baker resamples it into world metres.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { CACHE, USER_AGENT, loadSeed, sleep } from './common.mjs';

const DIR = resolve(CACHE, 'elevation');
const URL_OF = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

const lonToTileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const latToTileY = (lat, z) => {
    const r = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

export function tileRange(bounds, z) {
    return {
        x0: Math.floor(lonToTileX(bounds.west, z)), x1: Math.floor(lonToTileX(bounds.east, z)),
        y0: Math.floor(latToTileY(bounds.north, z)), y1: Math.floor(latToTileY(bounds.south, z)),
    };
}

/** Minimal PNG decoder: 8-bit, non-interlaced, colour type 2 (RGB) or 6 (RGBA). Returns {w, h, ch, data}. */
export function decodePng(buf) {
    if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
    let p = 8, w = 0, h = 0, ch = 0;
    const idat = [];
    while (p < buf.length) {
        const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8);
        const body = buf.subarray(p + 8, p + 8 + len);
        if (type === 'IHDR') {
            w = body.readUInt32BE(0); h = body.readUInt32BE(4);
            const depth = body[8], ctype = body[9], interlace = body[12];
            if (depth !== 8 || interlace !== 0 || (ctype !== 2 && ctype !== 6)) throw new Error(`unsupported PNG (depth ${depth}, type ${ctype}, interlace ${interlace})`);
            ch = ctype === 2 ? 3 : 4;
        } else if (type === 'IDAT') idat.push(body);
        else if (type === 'IEND') break;
        p += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const stride = w * ch, data = Buffer.alloc(h * stride);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
        for (let x = 0; x < stride; x++) {
            const a = x >= ch ? data[dst + x - ch] : 0, b = y ? data[dst - stride + x] : 0, c = x >= ch && y ? data[dst - stride + x - ch] : 0;
            let v = raw[src + x];
            if (f === 1) v += a;
            else if (f === 2) v += b;
            else if (f === 3) v += (a + b) >> 1;
            else if (f === 4) {
                const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
                v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            data[dst + x] = v & 255;
        }
    }
    return { w, h, ch, data };
}

const tileFile = (z, x, y) => resolve(DIR, `${z}-${x}-${y}.png`);

async function download(z, x, y) {
    let wait = 5000;
    for (let attempt = 0; attempt < 8; attempt++) {
        try {
            const res = await fetch(URL_OF(z, x, y), { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60000) });
            if (res.ok) return Buffer.from(await res.arrayBuffer());
            console.warn(`  tile ${z}/${x}/${y} -> HTTP ${res.status}`);
        } catch (e) {
            console.warn(`  tile ${z}/${x}/${y} -> ${e.message}`);
        }
        await sleep(wait);
        wait *= 2;
    }
    throw new Error(`failed to fetch tile ${z}/${x}/${y}`);
}

function stitch(z, r) {
    const T = 256, W = (r.x1 - r.x0 + 1) * T, H = (r.y1 - r.y0 + 1) * T;
    const grid = new Float32Array(W * H);
    let missing = 0;
    for (let ty = r.y0; ty <= r.y1; ty++) for (let tx = r.x0; tx <= r.x1; tx++) {
        const f = tileFile(z, tx, ty);
        if (!existsSync(f)) { missing++; continue; }
        const { w, h, ch, data } = decodePng(readFileSync(f));
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const o = (y * w + x) * ch;
            grid[((ty - r.y0) * T + y) * W + (tx - r.x0) * T + x] = data[o] * 256 + data[o + 1] + data[o + 2] / 256 - 32768;
        }
    }
    // the source has isolated spike pixels (a 1093 m "peak" on Bodmin Moor); replace any pixel more than 60 m above
    // or below the mean of its 4 neighbours with that mean
    let spikes = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const m = (grid[i - 1] + grid[i + 1] + grid[i - W] + grid[i + W]) / 4;
        if (Math.abs(grid[i] - m) > 60) { grid[i] = m; spikes++; }
    }
    return { grid, W, H, missing, spikes };
}

async function main() {
    const args = process.argv.slice(2);
    const z = +(args.includes('--zoom') ? args[args.indexOf('--zoom') + 1] : 11);
    const seed = loadSeed();
    const r = tileRange(seed.bounds, z);
    const total = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    mkdirSync(DIR, { recursive: true });

    if (!args.includes('--check')) {
        let n = 0;
        for (let ty = r.y0; ty <= r.y1; ty++) for (let tx = r.x0; tx <= r.x1; tx++) {
            n++;
            if (existsSync(tileFile(z, tx, ty))) continue;
            console.log(`[${n}/${total}] tile ${z}/${tx}/${ty}`);
            const buf = await download(z, tx, ty);
            writeFileSync(tileFile(z, tx, ty) + '.part', buf);
            renameSync(tileFile(z, tx, ty) + '.part', tileFile(z, tx, ty));
            await sleep(150);
        }
        const { grid, W, H, missing } = stitch(z, r);
        if (missing) throw new Error(`${missing} tiles missing`);
        writeFileSync(resolve(DIR, 'grid.f32'), Buffer.from(grid.buffer));
        writeFileSync(resolve(DIR, 'grid.json'), JSON.stringify({ zoom: z, tileX0: r.x0, tileY0: r.y0, width: W, height: H, tile: 256, bounds: seed.bounds }));
        console.log(`wrote grid ${W}x${H}`);
    }

    // --check: coverage and plausible heights
    const { grid, W, H, missing, spikes } = stitch(z, r);
    let min = Infinity, max = -Infinity, landMax = -Infinity;
    for (const v of grid) { if (v < min) min = v; if (v > max) max = v; }
    landMax = max;
    const have = total - missing;
    console.log(`tiles: ${have}/${total} cached (zoom ${z}, grid ${W}x${H}); heights min ${min.toFixed(1)} m (sea floor), max ${landMax.toFixed(1)} m; ${spikes} spike pixels smoothed`);
    const ok = !missing && landMax > 500 && landMax < 700 && min > -300;
    console.log(ok ? 'coverage complete, heights plausible' : 'PROBLEM: missing tiles or implausible heights');
    process.exitCode = ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
