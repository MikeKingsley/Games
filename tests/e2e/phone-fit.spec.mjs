import { test, expect } from '@playwright/test';

// Phone fit: at every phone size the pages must not scroll the document, every control must sit inside the viewport,
// and the HUD pieces must not overlap each other. Audio is muted by the browser launch option in playwright.config.mjs.
const VIEWPORTS = [
    [360, 640], [640, 360], [375, 667], [667, 375],
    [412, 915], [915, 412], [390, 844], [844, 390],
];

// A waiting update shows the banner, the worst case for the top-right corner.
const fakeServiceWorker = () => {
    const waiting = { postMessage() { } };
    const registration = { waiting, installing: null, addEventListener() { }, update: () => Promise.resolve() };
    Object.defineProperty(navigator, 'serviceWorker', {
        value: { controller: {}, register: async () => registration, addEventListener() { } },
    });
};

const seedProgress = progress => localStorage.setItem('games.progress.animal-feeding', JSON.stringify(progress));

/** Selectors whose visible boxes must stay inside the viewport and never overlap one another. */
const HUD = [
    '.corner-button', '[data-testid="update-banner"]', '.af-level', '.af-timer', '.af-stars', '.af-hardcore',
    '.af-world-name', '.af-animal .af-emoji', '.af-slot',
];

/** Visible boxes of every matching element, labelled `selector#index`. */
const boxes = (page, selectors) => page.evaluate(selectors => {
    const out = [];
    for (const selector of selectors) {
        document.querySelectorAll(selector).forEach((node, i) => {
            const r = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            if (r.width === 0 || r.height === 0 || style.display === 'none' || style.visibility === 'hidden') return;
            // an emoji's box is wider than its glyph (the font's advance), so compare the glyph's square instead
            const glyph = node.classList.contains('af-emoji') ? parseFloat(style.fontSize) : 0;
            out.push(glyph
                ? { name: `${selector}#${i}`, x: r.left + (r.width - glyph) / 2, y: r.bottom - glyph, w: glyph, h: glyph }
                : { name: `${selector}#${i}`, x: r.left, y: r.top, w: r.width, h: r.height });
        });
    }
    return out;
}, selectors);

async function expectFits(page, selectors, { checkOverlap = true } = {}) {
    const { innerWidth, innerHeight, scrollWidth, scrollHeight } = await page.evaluate(() => ({
        innerWidth: window.innerWidth, innerHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
    }));
    expect(scrollWidth, 'document scrolls horizontally').toBeLessThanOrEqual(innerWidth);
    expect(scrollHeight, 'document scrolls vertically').toBeLessThanOrEqual(innerHeight);

    const all = await boxes(page, selectors);
    const tolerance = 1;
    for (const b of all) {
        expect(b.x, `${b.name} left edge`).toBeGreaterThanOrEqual(-tolerance);
        expect(b.y, `${b.name} top edge`).toBeGreaterThanOrEqual(-tolerance);
        expect(b.x + b.w, `${b.name} right edge`).toBeLessThanOrEqual(innerWidth + tolerance);
        expect(b.y + b.h, `${b.name} bottom edge`).toBeLessThanOrEqual(innerHeight + tolerance);
    }
    for (let i = 0; checkOverlap && i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
            const a = all[i], b = all[j];
            const overlaps = a.x + tolerance < b.x + b.w && b.x + tolerance < a.x + a.w
                && a.y + tolerance < b.y + b.h && b.y + tolerance < a.y + a.h;
            expect(overlaps, `${a.name} overlaps ${b.name}`).toBe(false);
        }
    }
}

for (const [width, height] of VIEWPORTS) {
    test.describe(`${width}x${height}`, () => {
        test.use({ viewport: { width, height } });
        const shot = (page, name) => page.screenshot({ path: `test-results/phone-fit/${name}-${width}x${height}.png` });

        test.beforeEach(async ({ page }) => {
            await page.addInitScript(fakeServiceWorker);
        });

        test('home', async ({ page }) => {
            await page.goto('/');
            await expect(page.locator('.tile').first()).toBeVisible();
            await shot(page, 'home');
            await expectFits(page, ['.corner-button', '[data-testid="update-banner"]', '.tile']);
        });

        test('options', async ({ page }) => {
            await page.goto('/options');
            await expect(page.locator('.options')).toBeVisible();
            await shot(page, 'options');
            // the options list scrolls inside itself, so only the document and the banner are checked, and the buttons must stay within the width
            await expectFits(page, ['[data-testid="update-banner"]']);
            const wide = await page.locator('.option-button').evaluateAll(bs => bs.filter(b => b.getBoundingClientRect().right > innerWidth + 1).length);
            expect(wide, 'option buttons wider than the screen').toBe(0);
        });

        test('game, timed level with stars', async ({ page }) => {
            await page.addInitScript(seedProgress, { rounds: 30, stars: 20, buff: 2, hardcore: false });
            await page.goto('/play/animal-feeding');
            await expect(page.locator('.af-food').first()).toBeVisible();
            await expect(page.locator('.af-timer')).toBeVisible();
            await shot(page, 'game');
            await expectFits(page, HUD);
        });

        test('game, hardcore with a crowded row', async ({ page }) => {
            await page.addInitScript(seedProgress, { rounds: 20, stars: 20, buff: 0, hardcore: true });
            await page.goto('/play/animal-feeding');
            await expect(page.locator('.af-food').first()).toBeVisible();
            await shot(page, 'game-hardcore');
            await expectFits(page, HUD);
        });

        test('game, hardcore bouncing animals stay on screen', async ({ page }) => {
            await page.addInitScript(seedProgress, { rounds: 105, stars: 20, buff: 0, hardcore: true });
            await page.goto('/play/animal-feeding');
            await expect(page.locator('.af-animals.bouncing')).toBeVisible();
            for (let i = 0; i < 4; i++) {
                await page.waitForTimeout(500);
                await shot(page, `game-bouncing${i}`);
                // animals bounce past each other by design, so only containment is checked
                await expectFits(page, ['.af-animal .af-emoji', '.af-slot', '.af-level', '.af-timer', '.af-stars', '.corner-button'], { checkOverlap: false });
            }
        });

        test('game, developer buttons fit on one row', async ({ page }) => {
            await page.addInitScript(seedProgress, { rounds: 30, stars: 20, buff: 2, hardcore: false });
            await page.goto('/play/animal-feeding'); // no update banner here: it shares the bottom-right corner with the developer buttons
            await expect(page.locator('.af-debug-button').first()).toBeVisible();
            await shot(page, 'game-debug');
            await expectFits(page, ['.corner-button', '.af-debug-button', '.af-world-name', '.af-slot']);
        });

        test('shop dialog', async ({ page }) => {
            await page.addInitScript(seedProgress, { rounds: 30, stars: 20, buff: 2, hardcore: false });
            await page.goto('/play/animal-feeding');
            await page.locator('.af-stars').dispatchEvent('click'); // a real click may be blocked by an overlapping banner, which the game test reports
            await expect(page.locator('.af-shop-card')).toBeVisible();
            await shot(page, 'shop');
            await expectFits(page, ['.af-shop-button']);
            await expectFits(page, ['.af-shop-card']);
            // every button inside the card, nothing clipped by the card itself
            const clipped = await page.locator('.af-shop-card').evaluate(c => c.scrollHeight > c.clientHeight + 1);
            expect(clipped, 'shop card content is clipped').toBe(false);
        });

        test('parent panel', async ({ page }) => {
            await page.goto('/play/animal-feeding');
            await page.locator('.corner-button').click();
            await expect(page.locator('.parent-panel')).toBeVisible();
            await shot(page, 'parent-panel');
            await expectFits(page, ['.parent-panel']);
        });
    });
}
