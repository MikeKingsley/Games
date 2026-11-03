import { test, expect } from '@playwright/test';

/** Waits for the map, then starts a fresh (unsaved) company, skipping the save-slot menu. */
async function startGame(page) {
    await page.waitForFunction(() => window.__dd?.state?.world);
    await page.evaluate(() => window.__dd.newGame());
}

function watchErrors(page) {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    return errors;
}

test('the game loads a canvas and the truck drives with the keyboard', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/play/delivery-driver');
    await expect(page.locator('.dd-canvas')).toBeVisible();
    await startGame(page);
    const x0 = await page.evaluate(() => [window.__dd.state.player.x, window.__dd.state.player.y]);
    await page.locator('.dd-canvas').click({ position: { x: 500, y: 400 } });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1000);
    await page.keyboard.up('KeyW');
    const x1 = await page.evaluate(() => [window.__dd.state.player.x, window.__dd.state.player.y]);
    expect(Math.hypot(x1[0] - x0[0], x1[1] - x0[1])).toBeGreaterThan(0.5);
    expect(errors).toEqual([]);
});

test('Options has no Level row for Delivery Driver and the grown-ups panel has no Hardcore button', async ({ page }) => {
    await page.goto('/options');
    await expect(page.locator('.game-row')).toHaveCount(1);
    await expect(page.locator('.game-row', { hasText: 'Delivery Driver' })).toHaveCount(0);
    await page.goto('/play/delivery-driver');
    await page.getByRole('button', { name: 'Grown-ups' }).click();
    await expect(page.getByRole('button', { name: /Exit to menu/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Hardcore/ })).toHaveCount(0);
});

test('the game starts at the Exeter depot with buildings around and runs smoothly', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/play/delivery-driver');
    await startGame(page);
    const start = await page.evaluate(() => {
        const s = window.__dd.state;
        return { yard: s.world.yardAt(s.player.x, s.player.y)?.id ?? null };
    });
    expect(start.yard).toBe('depot-exeter');
    await page.waitForTimeout(500);
    expect((await page.evaluate(() => window.__dd.stats())).loadedBuildings).toBeGreaterThan(50);

    // five seconds of scripted driving out of the yard and around town
    await page.evaluate(() => { window.__dd.resetPerf(); window.__dd.setControls({ throttle: 1, steer: 0.25 }); });
    await page.waitForTimeout(5000);
    await page.evaluate(() => window.__dd.setControls(null));
    const stats = await page.evaluate(() => window.__dd.stats());
    expect(stats.samples).toBeGreaterThan(100);
    expect(stats.frameMs).toBeLessThan(20);
    expect(stats.buildings).toBeGreaterThan(0);
    expect(errors).toEqual([]);
});

test('a contract is accepted, loaded at the bay, delivered and paid', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/play/delivery-driver');
    await startGame(page);
    // open the depot office with F and accept the first offer
    await page.locator('.dd-canvas').click({ position: { x: 500, y: 300 } });
    await page.keyboard.press('KeyF');
    await expect(page.locator('.dd-panel h2')).toHaveText('Exeter Depot');
    const pay = await page.evaluate(() => window.__dd.state.career.offers[0].pay);
    const money0 = await page.evaluate(() => window.__dd.state.career.ledger.money);
    await page.locator('[data-act=accept]').first().click();
    await expect(page.locator('.dd-menu')).toBeHidden();
    expect(await page.evaluate(() => window.__dd.state.jobStage())).toBe('toLoad');

    // put the van's rear on the bay marker; loading starts by itself
    await page.evaluate(() => {
        const s = window.__dd.state, m = s.career.job.contract.stops[0];
        window.__dd.teleport(m.x + Math.cos(m.heading) * s.player.spec.rearOverhang, m.y + Math.sin(m.heading) * s.player.spec.rearOverhang, m.heading);
    });
    await expect.poll(() => page.evaluate(() => window.__dd.state.jobStage())).toBe('loading');
    // finish loading and every drop through the debug hook
    let result = null;
    for (let i = 0; i < 10 && !result; i++) {
        const ev = await page.evaluate(() => window.__dd.completeDrop());
        if (ev === 'complete') result = await page.evaluate(() => window.__dd.state.career.ledger.entries.at(-1));
    }
    expect(result).not.toBeNull();
    const money1 = await page.evaluate(() => window.__dd.state.career.ledger.money);
    expect(money1 - money0).toBe(result.amount);
    expect(result.amount).toBeGreaterThanOrEqual(pay);
    await expect(page.locator('.dd-toast')).toContainText('Paid');
    expect(errors).toEqual([]);
});

test('far-off towns load and render without errors', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/play/delivery-driver');
    await startGame(page);
    for (const id of ['penzance', 'barnstaple', 'plymouth']) {
        const before = await page.evaluate(() => window.__dd.state.world.chunks.generated);
        await page.evaluate(town => { const t = window.__dd.state.world.region.townById.get(town); window.__dd.teleport(t.x, t.y, 0); }, id);
        await page.waitForTimeout(800);
        const after = await page.evaluate(() => ({ generated: window.__dd.state.world.chunks.generated, stats: window.__dd.stats() }));
        expect(after.generated).toBeGreaterThan(before);
        expect(after.stats.loadedBuildings).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
});

test('by 1931 the Dart 3-Ton is at the dealer and buying it costs its price', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/play/delivery-driver');
    await startGame(page);
    await page.evaluate(() => { window.__dd.state.career.ledger.money = 50000; });
    await page.locator('.dd-canvas').click({ position: { x: 500, y: 300 } });
    await page.keyboard.press('KeyF');
    await page.locator('[data-act=tab][data-id=dealer]').click();
    await expect(page.locator('[data-act=buy][data-model=dart-3]')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // twelve years on (Monday upkeep comes off as the weeks pass)
    await page.evaluate(() => window.__dd.advanceClock(24 * 366 * 12));
    expect(await page.evaluate(() => window.__dd.state.year)).toBe(1931);
    await page.keyboard.press('KeyF');
    await page.locator('[data-act=tab][data-id=dealer]').click();
    const buy = page.locator('[data-act=buy][data-model=dart-3]');
    await expect(buy).toBeVisible();
    const before = await page.evaluate(() => window.__dd.state.career.ledger.money);
    await buy.click();
    const after = await page.evaluate(() => ({ money: window.__dd.state.career.ledger.money, fleet: window.__dd.state.career.fleet.map(v => v.model) }));
    expect(before - after.money).toBe(950);
    expect(after.fleet).toContain('dart-3');
    expect(errors).toEqual([]);
});

test('in the practice yard an artic reverses under a trailer, couples with C and pulls it away', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/play/delivery-driver');
    await startGame(page);
    // 1960, a Kestrel tractor unit, then the practice yard (which provides a trailer)
    await page.evaluate(() => {
        const s = window.__dd.state;
        s.career.ledger.money = 100000;
        window.__dd.advanceClock(24 * 366 * 41);
        const depot = s.world.depots.find(d => d.home);
        s.buyVehicle({ model: 'kestrel', depot, tradeIn: true });
        s.enterPractice(depot);
    });
    expect(await page.evaluate(() => window.__dd.state.inPractice || !!window.__dd.state.practiceReturn)).toBe(true);
    // line up 6 m in front of the trailer's kingpin, facing the same way, then reverse straight back
    await page.evaluate(() => {
        const s = window.__dd.state;
        const t = s.trailerObjs.get('practice-trailer');
        const kx = t.x + Math.cos(t.heading) * t.spec.axle, ky = t.y + Math.sin(t.heading) * t.spec.axle;
        const f = s.player.spec.fifthWheel;
        window.__dd.teleport(kx + Math.cos(t.heading) * (6 - f), ky + Math.sin(t.heading) * (6 - f), t.heading);
        window.__dd.setControls({ throttle: 0.3, reverse: true });
    });
    await page.waitForFunction(() => {
        const s = window.__dd.state, p = s.player, t = s.trailerObjs.get('practice-trailer');
        const f = p.spec.fifthWheel;
        const hx = p.x + Math.cos(p.heading) * f, hy = p.y + Math.sin(p.heading) * f;
        const kx = t.x + Math.cos(t.heading) * t.spec.axle, ky = t.y + Math.sin(t.heading) * t.spec.axle;
        return Math.hypot(hx - kx, hy - ky) < 0.3;
    }, null, { timeout: 15000 });
    await page.evaluate(() => window.__dd.setControls({ brake: 1 }));
    await page.waitForFunction(() => Math.abs(window.__dd.state.player.speed) < 0.05);
    await page.evaluate(() => window.__dd.setControls(null));
    await page.locator('.dd-canvas').click({ position: { x: 500, y: 300 } });
    await page.keyboard.press('KeyC');
    expect(await page.evaluate(() => window.__dd.state.player.trailer?.id)).toBe('practice-trailer');
    // pull it 50 m forward
    const start = await page.evaluate(() => ({ x: window.__dd.state.player.x, y: window.__dd.state.player.y }));
    await page.evaluate(() => window.__dd.setControls({ throttle: 0.7 }));
    await page.waitForFunction(s0 => Math.hypot(window.__dd.state.player.x - s0.x, window.__dd.state.player.y - s0.y) > 50, start, { timeout: 30000 });
    await page.evaluate(() => window.__dd.setControls(null));
    expect(await page.evaluate(() => window.__dd.state.player.trailer?.id)).toBe('practice-trailer');
    expect(errors).toEqual([]);
});

test('a hired driver takes a contract with a second vehicle and gets paid', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/play/delivery-driver');
    await startGame(page);
    await page.evaluate(() => { window.__dd.state.career.ledger.money = 5000; });
    await page.locator('.dd-canvas').click({ position: { x: 500, y: 300 } });
    await page.keyboard.press('KeyF');
    // a second van from the dealer
    await page.locator('[data-act=tab][data-id=dealer]').click();
    await page.locator('[data-act=buy][data-model=tamar-t-ton]').click();
    expect(await page.evaluate(() => window.__dd.state.career.fleet.length)).toBe(2);
    // hire a driver, give them the new van and a job from the board
    await page.locator('[data-act=tab][data-id=drivers]').click();
    await page.locator('[data-act=hire]').first().click();
    const ids = await page.evaluate(() => ({ driver: window.__dd.state.career.drivers[0].id, van: window.__dd.state.career.fleet[1].id }));
    await page.locator(`[data-assign="${ids.driver}"]`).selectOption(ids.van);
    await page.locator(`[data-act=assign][data-id="${ids.driver}"]`).click();
    await page.locator(`[data-act=give][data-id="${ids.driver}"]`).click();
    const title = await page.evaluate(() => window.__dd.state.career.drivers[0].job?.title);
    expect(title).toBeTruthy();
    await page.keyboard.press('Escape');
    // a day later the job is done and paid
    await page.evaluate(() => window.__dd.advanceClock(24));
    const paid = await page.evaluate(name => window.__dd.state.career.ledger.entries.filter(e => e.category === 'income' && e.text.startsWith(name)), await page.evaluate(() => window.__dd.state.career.drivers[0].name));
    expect(paid.length).toBe(1);
    expect(paid[0].text).toContain(title);
    expect(paid[0].amount).toBeGreaterThan(0);
    expect(errors).toEqual([]);
});

test('at 23:00 the scene is darker than by day', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/play/delivery-driver');
    await startGame(page);
    // average luminance of a grid of canvas pixels
    const luminance = () => page.evaluate(async () => {
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const c = document.querySelector('.dd-canvas');
        const ctx = c.getContext('2d');
        let sum = 0, n = 0;
        for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) {
            const [r, g, b] = ctx.getImageData(Math.floor((c.width * i) / 10), Math.floor((c.height * j) / 10), 1, 1).data;
            sum += 0.2126 * r + 0.7152 * g + 0.0722 * b; n++;
        }
        return sum / n;
    });
    await page.evaluate(() => { window.__dd.setWeather({ kind: 'clear', intensity: 0 }); window.__dd.advanceClock(6); }); // 12:00
    await page.waitForTimeout(400);
    const day = await luminance();
    await page.evaluate(() => window.__dd.advanceClock(11)); // 23:00
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__dd.state.night)).toBe(true);
    const night = await luminance();
    expect(night).toBeLessThan(day * 0.7);
    expect(errors).toEqual([]);
});

test('a new game in slot 1 is offered as Continue after a reload', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/play/delivery-driver');
    await page.waitForFunction(() => window.__dd?.state?.world);
    await page.locator('[data-act="new"][data-slot="1"]').click();
    await page.locator('[data-field="company"]').fill('Tamar Test Haulage');
    await page.locator('[data-field="tutorial"]').uncheck();
    await page.locator('[data-act="start"]').click();
    await expect(page.locator('.dd-menu:visible')).toHaveCount(0);
    await page.reload();
    await page.waitForFunction(() => window.__dd?.state?.world);
    const row = page.locator('.dd-row', { hasText: 'Tamar Test Haulage' });
    await expect(row).toBeVisible();
    await expect(row.locator('[data-act="continue"]')).toBeEnabled();
    expect(errors).toEqual([]);
});

test.describe('phone portrait', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    test('the touch controls are visible and clear of the shell gear', async ({ page }) => {
        await page.goto('/play/delivery-driver');
        await startGame(page);
        await expect(page.locator('.dd-pedal.gas')).toBeVisible();
        const boxes = await page.evaluate(() => [...document.querySelectorAll('.corner-button, .dd-pedal, .dd-touch-buttons button')]
            .map(n => { const r = n.getBoundingClientRect(); return { n: n.className, x: r.left, y: r.top, w: r.width, h: r.height }; })
            .filter(b => b.w > 0 && b.h > 0));
        expect(boxes.length).toBeGreaterThan(2);
        const gear = boxes.filter(b => b.n.includes('corner-button'));
        expect(gear.length).toBeGreaterThan(0);
        for (const b of boxes) {
            expect(b.x).toBeGreaterThanOrEqual(-1);
            expect(b.x + b.w).toBeLessThanOrEqual(391);
            expect(b.y + b.h).toBeLessThanOrEqual(845);
        }
        for (const g of gear) for (const b of boxes.filter(b => !b.n.includes('corner-button'))) {
            const overlap = g.x < b.x + b.w && b.x < g.x + g.w && g.y < b.y + b.h && b.y < g.y + g.h;
            expect(overlap, `${b.n} overlaps the shell gear`).toBe(false);
        }
    });
});

// ---- renderer selection (plan 0007) ------------------------------------------------------------------------------
const forceRenderer = (page, renderer) => page.addInitScript(r => localStorage.setItem('games.dd.settings', JSON.stringify({ renderer: r })), renderer);

test.describe('renderers', () => {
    test('renderer=canvas2d keeps the Canvas renderer', async ({ page }) => {
        const errors = watchErrors(page);
        await forceRenderer(page, 'canvas2d');
        await page.goto('/play/delivery-driver');
        await startGame(page);
        expect(await page.evaluate(() => window.__dd.renderer.kind)).toBe('canvas2d');
        expect(errors).toEqual([]);
    });

    test('renderer=webgl draws a non-blank frame with no GL errors', async ({ page }) => {
        const errors = watchErrors(page);
        await forceRenderer(page, 'webgl');
        await page.goto('/play/delivery-driver');
        await startGame(page);
        await page.waitForTimeout(500);
        const r = await page.evaluate(() => ({ kind: window.__dd.renderer.kind, errors: window.__dd.renderer.stats.glErrors, px: window.__dd.renderer.probe() }));
        expect(r.kind).toBe('webgl');
        expect(r.errors).toBe(0);
        expect(new Set(r.px.map(p => p.join(','))).size).toBeGreaterThan(1); // sea colour and ground are both visible
        expect(errors).toEqual([]);
    });

    test('setRenderer switches kind at run time and a lost WebGL context falls back to Canvas 2D', async ({ page }) => {
        await forceRenderer(page, 'webgl');
        await page.goto('/play/delivery-driver');
        await startGame(page);
        expect(await page.evaluate(() => window.__dd.renderer.kind)).toBe('webgl');
        await page.evaluate(() => window.__dd.setRenderer('canvas2d'));
        expect(await page.evaluate(() => window.__dd.renderer.kind)).toBe('canvas2d');
        await page.evaluate(() => window.__dd.setRenderer('webgl'));
        expect(await page.evaluate(() => window.__dd.renderer.kind)).toBe('webgl');
        await page.evaluate(() => window.__dd.renderer.loseContext());
        await expect.poll(() => page.evaluate(() => window.__dd.renderer.kind), { timeout: 8000 }).toBe('canvas2d');
        const x0 = await page.evaluate(() => window.__dd.state.player.x);
        await page.keyboard.down('KeyW');
        await page.waitForTimeout(800);
        await page.keyboard.up('KeyW');
        expect(await page.evaluate(() => window.__dd.state.player.x)).not.toBe(x0);
    });
});
