// Contact sheet of the greybox set pieces' top-down shots (from junction-angles-screenshots.mjs --views top): one PNG per
// terrain, a labelled grid, saved beside the shots. Needs the shots in _docs/qa/set-pieces-top/.
//   node scripts/set-pieces-sheet.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { GREYBOX_SPEC } from '../Games.Client/wwwroot/games/delivery-driver/greybox/spec.js';

const DIR = path.resolve('_docs/qa/set-pieces-top');
const DIRU = DIR.split(path.sep).join('/');
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
for (const terrain of ['flat', 'rolling']) {
    const cells = GREYBOX_SPEC.pieces.map(p => `<figure><img src="file:///${DIRU}/${terrain}-${p.id}-top.png"><figcaption>${p.label}</figcaption></figure>`).join('');
    const html = `<!doctype html><html><head><style>
        body { margin: 0; background: #1b1d21; color: #eee; font: 14px system-ui, sans-serif; padding: 12px; }
        h1 { font-size: 18px; margin: 0 0 10px; }
        .grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
        figure { margin: 0; background: #2a2e35; border-radius: 4px; overflow: hidden; }
        img { width: 100%; display: block; }
        figcaption { padding: 4px 8px; }
    </style></head><body><h1>Set pieces, top down, ${terrain} ground</h1><div class="grid">${cells}</div></body></html>`;
    const htmlPath = path.join(DIR, `_sheet-${terrain}.html`);
    fs.writeFileSync(htmlPath, html);
    await page.goto('file:///' + htmlPath.split(path.sep).join('/'));
    await page.waitForLoadState('load');
    await page.screenshot({ path: path.join(DIR, `sheet-${terrain}.png`), fullPage: true });
    fs.rmSync(htmlPath);
    console.log(`saved sheet-${terrain}.png`);
}
await browser.close();
