// Greybox junction shots from several angles, on flat ground and on rolling hills (plan 0011 phase 9). Saves
// _docs/qa/junctions-terrain/<terrain>-<piece>-<view>.png (WebGL, software GL is fine). Needs the dev server on port 5210.
//   node scripts/junction-angles-screenshots.mjs [--url http://localhost:5210] [--terrain flat,rolling] [--pieces crossroads,tee] [--views top] [--out dir]
// Views (camera placed from the piece centre; eyes sit 1.6 m above the ground under them):
//   top        straight down, 230 m up
//   aerial     150 m south of the piece, 110 m up, looking down at it
//   eye-south  60 m south, at driver eye height, looking north at the junction
//   eye-west   40 m west, at driver eye height, looking east
import { chromium } from 'playwright';
import fs from 'node:fs';
import { GREYBOX_SPEC } from '../Games.Client/wwwroot/games/delivery-driver/greybox/spec.js';
import { groundHeightFn } from '../Games.Client/wwwroot/games/delivery-driver/greybox/terrain.js';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('url', 'http://localhost:5210');
const terrains = arg('terrain', 'flat,rolling').split(',');
const JUNCTIONS = ['crossroads', 'tee', 'roundabout', 'signals-cross', 'tee-give-way', 'give-way-cross', 'crossroads-plain', 'roundabout-small', 'roundabout-medium', 'roundabout-large', 'roundabout-double'];
const pieces = arg('pieces', JUNCTIONS.join(',')).split(',');
const viewList = arg('views', 'top,aerial,eye-south,eye-west').split(',');
const OUT = arg('out', '_docs/qa/junctions-terrain');
fs.mkdirSync(OUT, { recursive: true });

const YAW_SOUTH = Math.PI / 2; // looks north
const views = (p, ground) => {
    const eye = (dx, dy) => ground(p.x + dx, p.y + dy) + 1.6;
    return {
        top: { x: p.x, y: p.y, z: ground(p.x, p.y) + 230, yaw: YAW_SOUTH, pitch: -1.55 },
        aerial: { x: p.x, y: p.y + 150, z: ground(p.x, p.y + 150) + 110, yaw: YAW_SOUTH, pitch: -0.63 },
        'eye-south': { x: p.x, y: p.y + 60, z: eye(0, 60), yaw: YAW_SOUTH, pitch: -0.03 },
        'eye-west': { x: p.x - 40, y: p.y, z: eye(-40, 0), yaw: 0, pitch: -0.03 },
    };
};

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
let saved = 0;
for (const terrain of terrains) {
    const ground = groundHeightFn(terrain);
    for (const id of pieces) {
        const piece = GREYBOX_SPEC.pieces.find(p => p.id === id);
        if (!piece) throw new Error(`no piece ${id}`);
        // the page builds its own mesh per load; one load per piece, then move the camera for each view
        await page.goto(`${base}/games/delivery-driver/greybox/greybox.html?terrain=${terrain}&piece=${id}`);
        await page.waitForFunction(() => window.__greybox && window.__greybox.frames > 3, null, { timeout: 60000 });
        await page.addStyleTag({ content: '#bar, #labels, #help { display: none !important; }' }); // clean frames: no buttons or piece labels
        for (const [view, cam] of Object.entries(views(piece, ground)).filter(([v]) => viewList.includes(v))) {
            await page.evaluate(c => Object.assign(window.__greybox.cam, c), { x: cam.x, y: cam.y, z: Math.max(1, cam.z), yaw: cam.yaw, pitch: cam.pitch });
            const frames = await page.evaluate(() => window.__greybox.frames);
            await page.waitForFunction(f => window.__greybox.frames >= f + 2, frames, { timeout: 10000 });
            await page.screenshot({ path: `${OUT}/${terrain}-${id}-${view}.png` });
            saved++;
        }
        console.log(`saved ${terrain} ${id}`);
    }
}
await browser.close();
console.log(`saved ${saved} shots to ${OUT}`);
if (errors.length) console.log('page errors:', errors.slice(0, 5));
