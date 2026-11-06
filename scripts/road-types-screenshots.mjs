// Plan 0011 phase 8: chase-camera screenshots of the real-map spots that show the new road types and junctions, saved to
// _docs/qa/road-types/realmap-<spot>.png (WebGL, software GL is fine). Needs the dev server on port 5210.
//   node scripts/road-types-screenshots.mjs [--url http://localhost:5210] [--year 2024]
// The greybox pieces are shot top-down (the greybox default) and the real-map spots use the steepest camera tilt.
// Spots: a passing place (single-track lane over 150 m), a double roundabout, a signal junction, a T-junction with give-way.
// The roundabout spot reuses the place picked in _docs/qa/spline-roads/places.json (scripts/qa-screenshots.mjs) when it is
// a double-roundabout candidate; otherwise the first detected pair is used.
import { chromium } from 'playwright';
import fs from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('url', 'http://localhost:5210');
const year = +arg('year', 2024);
const OUT = '_docs/qa/road-types';
fs.mkdirSync(OUT, { recursive: true });

// greybox pieces first (top-down, the greybox default): greybox.html?piece=<id>
const GREYBOX = {
    'single-track': 'greybox-single-track', 'one-way-lane': 'greybox-one-way-lane', 'two-way': 'greybox-two-way',
    'multi-one-way': 'greybox-multi-one-way', asymmetric: 'greybox-asymmetric', 'no-pavement': 'greybox-no-pavement',
    'signals-cross': 'junction-signals-cross', 'tee-give-way': 'junction-tee-give-way', 'give-way-cross': 'junction-give-way-cross', 'crossroads-plain': 'junction-crossroads-plain',
    'roundabout-small': 'roundabout-small', 'roundabout-medium': 'roundabout-medium', 'roundabout-large': 'roundabout-large', 'roundabout-double': 'roundabout-double',
};
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => localStorage.setItem('games.dd.settings', JSON.stringify({ renderer: 'webgl', quality: 'medium' })));
let saved = 0;
for (const [piece, file] of Object.entries(GREYBOX)) {
    await page.goto(`${base}/games/delivery-driver/greybox/greybox.html?piece=${piece}`);
    await page.waitForFunction(() => window.__greybox && window.__greybox.frames > 3, null, { timeout: 30000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${file}.png` });
    console.log(`saved ${file}.png`);
    saved++;
}
await page.goto(`${base}/play/delivery-driver`);
await page.waitForFunction(() => window.__dd?.state?.world, null, { timeout: 120000 });
await page.evaluate(() => window.__dd.newGame());
await page.waitForTimeout(1500);

await page.evaluate(yr => window.__dd.state.debugTools.setYear(yr), year);
const spots = await page.evaluate(year => {
    const w = window.__dd.state.world, g = w.graph;
    const at = (n, other) => ({ x: n.x, y: n.y, heading: Math.atan2(other.y - n.y, other.x - n.x), node: n.id });
    const first = n => { const e = g.edges[n.edges[0]]; return g.nodes[e.a === n.id ? e.b : e.a]; };
    const out = {};
    // double roundabout: two ring nodes paired by detectDoubleRoundabouts; stand midway between them, looking along the link
    const pair = g.nodes.find(n => n.doubleWith !== undefined && n.doubleWith > n.id);
    if (pair) { const o = g.nodes[pair.doubleWith]; out['double-roundabout'] = { ...at({ x: (pair.x + o.x) / 2, y: (pair.y + o.y) / 2, id: pair.id }, o), heading: Math.atan2(o.y - pair.y, o.x - pair.x) }; }
    // signal junction: the signal node (in service this year) with the most arms
    const sig = g.nodes.filter(n => n.junction === 'signals' && year >= n.signalsFrom && n.edges.length >= 3).sort((a, b) => b.edges.length - a.edges.length)[0];
    if (sig) out['signal-junction'] = at(sig, first(sig));
    // T-junction with give-way: a three-arm give-way node with a priority road
    const tee = g.nodes.find(n => n.junction === 'giveway' && n.edges.length === 3 && n.priority && n.town);
    if (tee) out['tee-give-way'] = at(tee, first(tee));
    // passing place: the middle of a long single-track lane
    const lane = g.edges.filter(e => e.cls === 'lane' && !e.oneway && e.len > 200).sort((a, b) => b.len - a.len)[0];
    if (lane) { const a = g.nodes[lane.a], b = g.nodes[lane.b]; out['passing-place'] = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, heading: Math.atan2(b.y - a.y, b.x - a.x), edge: lane.id }; }
    return out;
}, year);
fs.writeFileSync(`${OUT}/realmap-places.json`, JSON.stringify(spots, null, 1));

for (const [name, p] of Object.entries(spots)) {
    await page.evaluate(([x, y, h, yr]) => { window.__dd.state.debugTools.setYear(yr); window.__dd.camera.tilt = 90; window.__dd.camera.zoomIndex = 1; window.__dd.teleport(x, y, h); }, [p.x, p.y, p.heading, year]);
    await page.waitForFunction(() => { const s = window.__dd.renderer?.stats; return s && s.triangles > 2000; }, null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/realmap-${name}.png` });
    console.log(`saved realmap-${name}.png`);
    saved++;
}
await browser.close();
const missing = ['double-roundabout', 'signal-junction', 'tee-give-way', 'passing-place'].filter(k => !spots[k]);
if (missing.length) console.log('no spot found for:', missing.join(', '));
console.log(`screenshots: ${saved}; errors:`, errors.length, errors.slice(0, 5));
if (errors.length || missing.length) process.exitCode = 1;
