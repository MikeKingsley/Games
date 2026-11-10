import { test, expect } from '@playwright/test';

// Inglenook smoke tests against the real app. The debug hook window.__ig exists in the Development environment, which `dotnet run` uses.
const ignorable = text => /service.?worker|serviceWorker|fetching the script|Failed to load resource/i.test(text);

async function open(page, level = 1) {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !ignorable(m.text())) errors.push(m.text()); });
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/play/inglenook');
    await page.waitForFunction(() => window.__ig && window.__ig.sim);
    if (level !== 1) await page.evaluate(n => window.__ig.start(n), level);
    return errors;
}

test('home lists Inglenook and the board draws the yard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Inglenook' })).toBeVisible();
    await page.getByRole('link', { name: 'Inglenook' }).click();
    await page.waitForFunction(() => window.__ig && window.__ig.sim);
    await expect(page.locator('.ig-board')).toBeVisible();
    await expect(page.locator('.ig-point')).not.toHaveCount(0);
    await expect(page.locator('.ig-vehicle.loco')).toHaveCount(1);
    await expect(page.locator('.ig-chip').first()).toBeVisible();
    await expect(page.locator('.ig-level')).toHaveText('Level 1');
});

test('driving with the real controls: throw a point, couple, uncouple', async ({ page }) => {
    const errors = await open(page);
    const plan = await page.evaluate(() => {
        const p = window.__ig.level.placement;
        return { target: p.C.length ? 'C' : 'B' };
    });
    if (plan.target === 'C') await page.locator('.ig-point[data-point="P2"]').click();
    await page.getByRole('button', { name: 'Forward' }).click();
    await page.waitForFunction(() => window.__ig.sim.stats.couplings >= 1, null, { timeout: 40_000 });
    await page.waitForFunction(() => window.__ig.sim.speed === 0);
    const rakes = await page.evaluate(() => window.__ig.sim.rakes().filter(r => r.vehicles.includes('loco')).map(r => r.vehicles));
    expect(rakes[0].length).toBeGreaterThan(1);
    // tap the hook right behind the loco to uncouple
    const hooks = await page.evaluate(() => window.__ig.sim.couplings().map(c => ({ index: c.index, between: c.between })));
    const behindLoco = hooks.find(h => h.between.includes('loco'));
    await page.locator(`.ig-hook[data-index="${behindLoco.index}"]`).first().click({ force: true });
    await page.waitForFunction(() => window.__ig.sim.stats.uncouplings === 1);
    await page.getByRole('button', { name: 'Undo' }).click();
    expect(await page.evaluate(() => window.__ig.sim.stats.uncouplings)).toBe(0);
    expect(errors).toEqual([]);
});

test('solving a level shows the result, Next level loads level 2, Reset restores a level', async ({ page }) => {
    const errors = await open(page);
    await page.evaluate(() => window.__ig.solve());
    await expect(page.locator('.ig-win')).toBeVisible();
    await expect(page.locator('.ig-winstars')).toHaveText('★★★');
    await page.locator('.ig-next').click();
    await expect(page.locator('.ig-level')).toHaveText('Level 2');
    expect(await page.evaluate(() => window.__ig.sim.stats.uncouplings)).toBe(0);
    // tapping a point lever must throw it exactly once, even after a level change (no stacked listeners)
    await page.locator('.ig-point[data-point="P2"]').click();
    expect(await page.evaluate(() => window.__ig.sim.points.P2)).toBe('diverging');
    await page.locator('.ig-point[data-point="P2"]').click();
    expect(await page.evaluate(() => window.__ig.sim.points.P2)).toBe('straight');
    // move something, then Reset puts the level back
    await page.keyboard.press('2');
    expect(await page.evaluate(() => window.__ig.sim.points.P2)).toBe('diverging');
    await page.getByRole('button', { name: 'Reset' }).click();
    expect(await page.evaluate(() => window.__ig.sim.points.P2)).toBe('straight');
    // progress is saved
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('games.progress.inglenook') ?? 'null'));
    expect(saved?.best?.['1']?.stars).toBe(3);
    expect(errors).toEqual([]);
});

test('a hard level (ladder with obstacles) draws and is solvable through the real simulation', async ({ page }) => {
    const errors = await open(page, 61);
    await expect(page.locator('.ig-level')).toHaveText('Level 61');
    await page.evaluate(() => window.__ig.solve());
    await expect(page.locator('.ig-win')).toBeVisible();
    expect(errors).toEqual([]);
});

const VIEWPORTS = [[360, 640], [640, 360], [375, 667], [667, 375], [412, 915], [915, 412]];
for (const [w, h] of VIEWPORTS) {
    test(`phone fit ${w}x${h}: no page scroll and the controls are on screen`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await open(page);
        const r = await page.evaluate(() => {
            const rect = sel => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
            return {
                scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
                inner: [innerWidth, innerHeight],
                board: rect('.ig-board'),
                controls: [...document.querySelectorAll('.ig-controls .ig-btn')].map(b => { const q = b.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; }),
            };
        });
        expect(r.scroll[0]).toBeLessThanOrEqual(r.inner[0]);
        expect(r.scroll[1]).toBeLessThanOrEqual(r.inner[1]);
        expect(r.board.h).toBeGreaterThan(120);
        for (const b of r.controls) {
            expect(b.x).toBeGreaterThanOrEqual(-1);
            expect(b.y).toBeGreaterThanOrEqual(-1);
            expect(b.x + b.w).toBeLessThanOrEqual(r.inner[0] + 1);
            expect(b.y + b.h).toBeLessThanOrEqual(r.inner[1] + 1);
            expect(b.h).toBeGreaterThanOrEqual(43);
        }
    });
}
