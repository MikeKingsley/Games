// How much z-fighting the greybox shows (plan 0011 phase 9). Each view is rendered twice with the camera nudged 1 cm sideways
// (far too little to move a real edge more than a fraction of a pixel); pixels that change by more than THRESH in any channel are
// counted as flicker. Run with the HUD hidden. Reports the % of the frame that flickers per terrain and view, and saves a diff
// image (red = changed) for the worst cases to _docs/qa/zfight/. Needs the dev server on port 5210.
//   node scripts/zfight-check.mjs [--url http://localhost:5210] [--pieces a,b] [--views top,aerial,eye-south] [--terrain flat,rolling]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { GREYBOX_SPEC } from '../Games.Client/wwwroot/games/delivery-driver/greybox/spec.js';
import { groundHeightFn } from '../Games.Client/wwwroot/games/delivery-driver/greybox/terrain.js';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('url', 'http://localhost:5210');
const terrains = arg('terrain', 'flat,rolling').split(',');
const viewNames = arg('views', 'top,aerial,eye-south').split(',');
const pieces = arg('pieces', GREYBOX_SPEC.pieces.map(p => p.id).join(',')).split(',');
const THRESH = 24, NUDGE = 0.01, OUT = '_docs/qa/zfight';
fs.mkdirSync(OUT, { recursive: true });

const Y = Math.PI / 2;
const viewsOf = (p, g) => ({
    top: { x: p.x, y: p.y, z: g(p.x, p.y) + 230, yaw: Y, pitch: -1.55 },
    aerial: { x: p.x, y: p.y + 150, z: g(p.x, p.y + 150) + 110, yaw: Y, pitch: -0.63 },
    far: { x: p.x, y: p.y, z: g(p.x, p.y) + 500, yaw: Y, pitch: -1.55 },
    overview: { x: 450, y: 750, z: 1900, yaw: Y, pitch: -1.55 },
    'eye-south': { x: p.x, y: p.y + 60, z: g(p.x, p.y + 60) + 1.6, yaw: Y, pitch: -0.03 },
});

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
const calc = await browser.newPage();
// in-page diff: two PNG data URLs in, { changed, total, diffPng } out
const diff = (a, b) => calc.evaluate(async ([a, b, thresh]) => {
    const load = async s => { const im = new Image(); im.src = s; await im.decode(); const c = new OffscreenCanvas(im.width, im.height), x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, im.width, im.height); };
    const [A, B] = [await load(a), await load(b)];
    const out = new ImageData(A.width, A.height);
    let changed = 0;
    for (let i = 0; i < A.data.length; i += 4) {
        const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
        const hit = d > thresh;
        if (hit) changed++;
        out.data[i] = hit ? 255 : A.data[i] >> 1; out.data[i + 1] = hit ? 0 : A.data[i + 1] >> 1; out.data[i + 2] = hit ? 0 : A.data[i + 2] >> 1; out.data[i + 3] = 255;
    }
    const c = new OffscreenCanvas(A.width, A.height); c.getContext('2d').putImageData(out, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/png' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; for (const v of buf) bin += String.fromCharCode(v);
    return { changed, total: A.width * A.height, png: btoa(bin) };
}, [a, b, THRESH]);
const shot = async () => 'data:image/png;base64,' + (await page.screenshot()).toString('base64');

const rows = [];
for (const terrain of terrains) {
    const g = groundHeightFn(terrain);
    for (const id of pieces) {
        const piece = GREYBOX_SPEC.pieces.find(p => p.id === id);
        await page.goto(`${base}/games/delivery-driver/greybox/greybox.html?terrain=${terrain}&piece=${id}`);
        await page.waitForFunction(() => window.__greybox && window.__greybox.frames > 3, null, { timeout: 60000 });
        await page.addStyleTag({ content: '#bar, #labels, #help { display: none !important; }' });
        for (const [name, cam] of Object.entries(viewsOf(piece, g)).filter(([n]) => viewNames.includes(n))) {
            const set = async dx => {
                await page.evaluate(c => Object.assign(window.__greybox.cam, c), { ...cam, x: cam.x + dx, z: Math.max(1, cam.z) });
                const f = await page.evaluate(() => window.__greybox.frames);
                await page.waitForFunction(n => window.__greybox.frames >= n + 2, f, { timeout: 10000 });
            };
            await set(0); const a = await shot();
            await set(NUDGE); const b = await shot();
            const r = await diff(a, b);
            rows.push({ terrain, piece: id, view: name, pct: (100 * r.changed) / r.total, changed: r.changed, png: r.png });
        }
        console.log(`${terrain} ${id} done`);
    }
}
await browser.close();

const summary = {};
for (const r of rows) { const k = `${r.terrain}/${r.view}`; (summary[k] ??= []).push(r.pct); }
console.log('\nflicker, % of frame (mean / worst piece):');
for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(18)} ${(v.reduce((s, x) => s + x, 0) / v.length).toFixed(3)} / ${Math.max(...v).toFixed(3)}`);
const worst = [...rows].sort((a, b) => b.pct - a.pct).slice(0, 6);
console.log('\nworst:');
for (const r of worst) { console.log(`  ${r.terrain} ${r.piece} ${r.view}: ${r.pct.toFixed(3)}% (${r.changed} px)`); fs.writeFileSync(`${OUT}/${r.terrain}-${r.piece}-${r.view}-diff.png`, Buffer.from(r.png, 'base64')); }
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(rows.map(({ png, ...r }) => r), null, 1));
