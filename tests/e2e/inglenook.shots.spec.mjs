import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

// Visual snapshots for the realism pass (plan 0014). Set IG_SHOTS=before|after to write into _docs/plans/0014-shots/<name>/,
// otherwise PNGs go to test-results/inglenook-shots/. These save images only; they do not compare them.
const outDir = process.env.IG_SHOTS
    ? path.join('_docs', 'plans', '0014-shots', process.env.IG_SHOTS)
    : path.join('test-results', 'inglenook-shots');
const ignorable = text => /service.?worker|serviceWorker|fetching the script|Failed to load resource/i.test(text);

async function open(page, level, size) {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !ignorable(m.text())) errors.push(m.text()); });
    await page.setViewportSize({ width: size[0], height: size[1] });
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/play/inglenook');
    await page.waitForFunction(() => window.__ig && window.__ig.sim);
    if (level !== 1) await page.evaluate(n => window.__ig.start(n), level);
    await page.locator('.ig-root').waitFor();
    await page.waitForTimeout(300);
    return errors;
}

const shot = (page, name) => {
    fs.mkdirSync(outDir, { recursive: true });
    return page.locator('.ig-root').screenshot({ path: path.join(outDir, name) });
};

const SHOTS = [
    ['classic-1024.png', 1, [1024, 768]],
    ['classic-844.png', 1, [844, 390]],
    ['classic-390.png', 1, [390, 844]],
    ['long-1024.png', 26, [1024, 768]],
    ['ladder5-1024.png', 61, [1024, 768]],
    ['stuck-1024.png', 20, [1024, 768]],
];
for (const [name, level, size] of SHOTS) {
    test(`shot ${name}`, async ({ page }) => {
        const errors = await open(page, level, size);
        await shot(page, name);
        expect(errors).toEqual([]);
    });
}

test('shot loco-close.png', async ({ page }) => {
    const errors = await open(page, 1, [1600, 900]);
    const b = await page.locator('.ig-vehicle.loco').boundingBox();
    // the loco is about 1.7 wagon lengths long; clip about 6 wagon lengths around it
    const wagon = Math.max(b.width, b.height) / 1.7;
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const w = Math.min(6 * wagon, 1600), h = Math.min(3 * wagon, 900);
    const clip = { x: Math.max(0, cx - w / 2), y: Math.max(0, cy - h / 2), width: w, height: h };
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, 'loco-close.png'), clip });
    expect(errors).toEqual([]);
});

test('shot moving.png', async ({ page }) => {
    const errors = await open(page, 1, [1024, 768]);
    await page.getByRole('button', { name: 'Forward' }).click();
    await page.waitForTimeout(1500);
    await shot(page, 'moving.png');
    expect(errors).toEqual([]);
});

for (const [label, size] of [['844x390', [844, 390]], ['390x844', [390, 844]]]) {
    test(`ID panels are legible at ${label}`, async ({ page }) => {
        const errors = await open(page, 1, size);
        const heights = await page.evaluate(() => [...document.querySelectorAll('.ig-wagon .ig-label')]
            .map(g => g.querySelector('rect').getBoundingClientRect())
            .map(r => Math.min(r.width, r.height)));
        console.log(`IG_PANEL_HEIGHT ${size.join('x')}: min ${Math.min(...heights).toFixed(1)}px over ${heights.length} wagons`);
        expect(heights.length).toBeGreaterThan(0);
        for (const h of heights) expect(h).toBeGreaterThanOrEqual(10);
        expect(errors).toEqual([]);
    });
}

test('level 61 stays under the DOM budget', async ({ page }) => {
    const errors = await open(page, 61, [1024, 768]);
    const count = await page.evaluate(() => document.querySelectorAll('.ig-board *').length);
    console.log(`IG_DOM_COUNT level 61: ${count}`);
    expect(count).toBeLessThan(4500);
    expect(errors).toEqual([]);
});
