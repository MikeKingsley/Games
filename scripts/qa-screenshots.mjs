// Plan 0009 phase 14: walks the Delivery Driver map with the debug hook and saves a chase-camera screenshot at each place
// and year to test-results/p14-<place>-<year>.png (WebGL, software GL is fine). Needs the dev server on port 5210.
//   node scripts/qa-screenshots.mjs [--places exeter,plymouth,...] [--years 1919,1955,2024] [--view chase]
import { chromium } from 'playwright';
import fs from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const years = arg('years', '1919,1955,2024').split(',').map(Number);
const only = arg('places', '')?.split(',').filter(Boolean);
const base = arg('url', 'http://localhost:5210');
fs.mkdirSync('test-results', { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => localStorage.setItem('games.dd.settings', JSON.stringify({ renderer: 'webgl', quality: 'medium' })));
await page.goto(`${base}/play/delivery-driver`);
await page.waitForFunction(() => window.__dd?.state?.world, null, { timeout: 120000 });
await page.evaluate(() => window.__dd.newGame());
await page.waitForTimeout(1500);

// places: a town centre, or a spot picked from the graph
const places = await page.evaluate(async () => {
    const w = window.__dd.state.world, g = w.graph;
    const town = id => { const t = w.region.townById.get(id); return { x: t.x, y: t.y }; };
    const headingAt = (x, y) => {
        let best = null, bd = Infinity;
        for (const n of g.nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d < bd && n.edges.length >= 2) { bd = d; best = n; } }
        const e = g.edges[best.edges[0]], other = g.nodes[e.a === best.id ? e.b : e.a];
        return { x: best.x, y: best.y, heading: Math.atan2(other.y - best.y, other.x - best.x), node: best.id };
    };
    const out = {};
    for (const id of ['exeter', 'plymouth', 'truro', 'penzance', 'barnstaple']) out[id] = headingAt(town(id).x, town(id).y);
    // the M5 interchange with the most arms
    const m5 = g.nodes.filter(n => n.edges.some(i => g.edges[i].road === 'm5') && n.edges.length >= 4).sort((a, b) => b.edges.length - a.edges.length)[0];
    out.m5 = headingAt(m5.x, m5.y);
    const tb = g.edges.find(e => e.road === 'a38-tamar-bridge' && e.len > 100);
    const mid = g.nodes[tb.a]; out.tamar = headingAt((mid.x + g.nodes[tb.b].x) / 2, (mid.y + g.nodes[tb.b].y) / 2);
    out.tamar.heading = Math.atan2(g.nodes[tb.b].y - g.nodes[tb.a].y, g.nodes[tb.b].x - g.nodes[tb.a].x);
    // a rural junction: a four-arm giveway node farther than 3 km from any town
    const far = g.nodes.find(n => n.edges.length >= 4 && !n.town && w.region.towns.every(t => Math.hypot(t.x - n.x, t.y - n.y) > 3000));
    out.rural = headingAt(far.x, far.y);
    // a roundabout and a bridge over a road, for good measure
    const ra = g.nodes.find(n => n.junction === 'roundabout' && !n.mini && n.edges.length >= 4 && n.town === 'exeter') ?? g.nodes.find(n => n.junction === 'roundabout' && !n.mini && n.edges.length >= 4);
    out.roundabout = headingAt(ra.x, ra.y);
    const cr = g.crossings.find(c => !c.atGrade && c.levels[0] === 1 && c.levels[1] === 0);
    out.flyover = { x: cr.x, y: cr.y, heading: Math.atan2(g.edges[cr.lower.edge].pts[3] - g.edges[cr.lower.edge].pts[1], g.edges[cr.lower.edge].pts[2] - g.edges[cr.lower.edge].pts[0]) };
    // the far west (float precision): west of Penzance near Land's End
    const pz = w.region.townById.get('penzance');
    out.lands_end = headingAt(pz.x - 3000, pz.y + 1200);
    return out;
});
fs.writeFileSync('test-results/p14-places.json', JSON.stringify(places, null, 1));
for (const [name, p] of Object.entries(places)) {
    if (only.length && !only.includes(name)) continue;
    for (const y of years) {
        await page.evaluate(([x, yy, h, year]) => { window.__dd.state.year = year; window.__dd.camera.tilt = 55; window.__dd.teleport(x, yy, h); }, [p.x, p.y, p.heading, y]);
        await page.waitForFunction(() => { const s = window.__dd.renderer?.stats; return s && s.triangles > 2000; }, null, { timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(2500);
        await page.screenshot({ path: `test-results/p14-${name}-${y}.png` });
        console.log(`saved p14-${name}-${y}.png`);
    }
}
await browser.close();
console.log('errors:', errors.length, errors.slice(0, 5));
if (errors.length) process.exitCode = 1;
