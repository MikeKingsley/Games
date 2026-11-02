import { test, expect } from '@playwright/test';

// Count requestFullscreen calls instead of really going fullscreen (headless browsers may refuse).
const spyOnFullscreen = () => {
    window.__fullscreenCalls = 0;
    Element.prototype.requestFullscreen = function () { window.__fullscreenCalls++; return Promise.resolve(); };
};
const calls = page => page.evaluate(() => window.__fullscreenCalls);

test('the app does not go fullscreen by default', async ({ page }) => {
    await page.addInitScript(spyOnFullscreen);
    await page.goto('/');
    await page.locator('.tile').first().click();
    await page.waitForTimeout(300);
    expect(await calls(page)).toBe(0);
});

test('with the Fullscreen setting on, the first tap of a page load goes fullscreen', async ({ page }) => {
    await page.addInitScript(spyOnFullscreen);
    await page.addInitScript(() => { if (!sessionStorage.s) { sessionStorage.s = 1; localStorage.setItem('games.settings', JSON.stringify({ sound: true, speech: true, fullscreen: true })); } });
    await page.goto('/');
    await page.mouse.click(500, 400);
    await expect.poll(() => calls(page)).toBe(1);
    await page.mouse.click(500, 400);
    await page.waitForTimeout(200);
    expect(await calls(page)).toBe(1); // only once per page load
});

test('switching Fullscreen on in Options goes fullscreen right away and is remembered; switching it off is remembered too', async ({ page }) => {
    await page.addInitScript(spyOnFullscreen);
    await page.goto('/options');
    await page.getByRole('button', { name: 'Fullscreen off' }).click();
    await expect(page.getByRole('button', { name: 'Fullscreen on' })).toBeVisible();
    expect(await calls(page)).toBe(1);
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem('games.settings')))).toMatchObject({ fullscreen: true });
    await page.getByRole('button', { name: 'Fullscreen on' }).click();
    await expect(page.getByRole('button', { name: 'Fullscreen off' })).toBeVisible();
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem('games.settings')))).toMatchObject({ fullscreen: false });
});

test('the in-game grown-ups panel has the Fullscreen switch too', async ({ page }) => {
    await page.addInitScript(spyOnFullscreen);
    await page.goto('/play/animal-feeding');
    await page.getByRole('button', { name: 'Grown-ups' }).click();
    await page.getByRole('button', { name: 'Fullscreen off' }).click();
    await expect(page.getByRole('button', { name: 'Fullscreen on' })).toBeVisible();
    expect(await calls(page)).toBe(1);
});
