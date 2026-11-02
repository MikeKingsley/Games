import { test, expect } from '@playwright/test';

// The dev server's service worker is a no-op, so a fake navigator.serviceWorker with a waiting worker stands in for a deployed update.
const fakeServiceWorker = () => {
    window.__sent = [];
    const waiting = { postMessage: m => window.__sent.push(m) };
    const registration = { waiting, installing: null, addEventListener() { }, update: () => Promise.resolve() };
    Object.defineProperty(navigator, 'serviceWorker', {
        value: { controller: {}, register: async () => registration, addEventListener() { } },
    });
};

test('a waiting update shows the banner; tapping Update applies it and hides the banner', async ({ page }) => {
    await page.addInitScript(fakeServiceWorker);
    await page.goto('/');

    const banner = page.getByTestId('update-banner');
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: 'Update now' }).click();
    await expect.poll(() => page.evaluate(() => window.__sent)).toEqual([{ type: 'SKIP_WAITING' }]);
    await expect(banner).toHaveCount(0);
});

test('no banner when no update is waiting', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.corner-button')).toBeVisible();
    await expect(page.getByTestId('update-banner')).toHaveCount(0);
});
