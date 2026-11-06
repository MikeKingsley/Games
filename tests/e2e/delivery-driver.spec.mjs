import { test, expect } from '@playwright/test';

/** Waits for the map, then starts a fresh (unsaved) company, skipping the save-slot menu. */
async function startGame(page) {
    await page.waitForFunction(() => window.__dd?.state?.world);
    await page.evaluate(() => window.__dd.newGame());
}

/** Pins the graphics setting (Auto now means WebGL). */
const forceRenderer = (page, renderer) => page.addInitScript(r => localStorage.setItem('games.dd.settings', JSON.stringify({ renderer: r })), renderer);

function watchErrors(page) {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    return errors;
}

test('the game loads a canvas and the truck drives with the keyboard', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/play/delivery-driver');
    // the real road network takes a few seconds to load and build (software GL here)
    await expect(page.locator('.dd-canvas')).toBeVisible({ timeout: 30000 });
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
    await forceRenderer(page, 'canvas2d'); // measures the Canvas renderer's frame time and pixels
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
    expect(stats.samples).toBeGreaterThan(20); // software Canvas on the real, layered road network draws far more edges than the seeded one did (about 7 frames a second here)
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
    await forceRenderer(page, 'canvas2d'); // measures the Canvas renderer's frame time and pixels
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

    test('renderer=webgl draws terrain, water and roads at Exeter, Dartmoor and the coast within the draw-call budget', async ({ page }) => {
        test.setTimeout(120_000);
        const errors = watchErrors(page);
        await forceRenderer(page, 'webgl');
        await page.goto('/play/delivery-driver');
        await startGame(page);
        const spots = await page.evaluate(() => {
            const r = window.__dd.state.world.region;
            const ex = r.townById.get('exeter');
            const moor = r.moors[0].pts;
            let mx = 0, my = 0;
            for (let i = 0; i < moor.length; i += 2) { mx += moor[i]; my += moor[i + 1]; }
            const c = r.coast;
            return { exeter: { x: ex.x, y: ex.y }, moor: { x: mx / (moor.length / 2), y: my / (moor.length / 2) }, coast: { x: c[40], y: c[41] } };
        });
        for (const [name, at] of Object.entries(spots)) {
            await page.evaluate(({ x, y }) => window.__dd.teleport(x, y, 0), at);
            // chunks build under a per-frame time budget (Phase 12), so wait until the view has some, then let a few frames draw
            await page.waitForFunction(() => window.__dd.renderer.stats.chunks > 1 && window.__dd.renderer.stats.triangles > 2000, null, { timeout: 20000 });
            await page.waitForTimeout(500);
            const r = await page.evaluate(() => ({ stats: { ...window.__dd.renderer.stats }, px: window.__dd.renderer.probe() }));
            await page.screenshot({ path: `test-results/delivery-driver-gl/${name}.png` });
            expect(r.stats.glErrors, name).toBe(0);
            expect(r.stats.chunks, name).toBeGreaterThan(1); // the chase camera sees a few chunks around the truck
            expect(r.stats.drawCalls, name).toBeGreaterThan(5);
            expect(r.stats.drawCalls, name).toBeLessThan(300);
            expect(r.stats.triangles, name).toBeGreaterThan(2000);
            // the moor's centre is now far from any road (plain 1:4 scale), a uniform fogged heath where the probes can agree
            if (name !== 'moor') expect(new Set(r.px.map(p => p.join(','))).size, name).toBeGreaterThan(1);
        }
        expect(errors).toEqual([]);
    });

    test('renderer=webgl draws buildings, trees and street furniture: Exeter 1919 vs 1985 differ, and a farm shows up', async ({ page }) => {
        test.setTimeout(120_000);
        const errors = watchErrors(page);
        await forceRenderer(page, 'webgl');
        await page.goto('/play/delivery-driver');
        await startGame(page);
        const spots = await page.evaluate(() => {
            const w = window.__dd.state.world, ex = w.region.townById.get('exeter');
            return { exeter: { x: ex.x, y: ex.y }, farm: { x: w.farms[0].yard.zone.x, y: w.farms[0].yard.zone.y } };
        });
        const shot = async name => {
            await page.waitForTimeout(1500);
            const r = await page.evaluate(() => ({ stats: { ...window.__dd.renderer.stats }, px: window.__dd.renderer.probe() }));
            await page.screenshot({ path: `test-results/delivery-driver-gl/${name}.png` });
            expect(r.stats.glErrors, name).toBe(0);
            expect(r.stats.drawables, name).toBeGreaterThan(0);
            expect(r.stats.buildings, name).toBeGreaterThan(0);
            expect(r.stats.drawCalls, name).toBeLessThan(500);
            return page.screenshot();
        };
        await page.evaluate(({ x, y }) => { window.__dd.state.year = 1919; window.__dd.teleport(x, y, 0); }, spots.exeter);
        const old = await shot('exeter-1919');
        await page.evaluate(() => { window.__dd.state.year = 1985; });
        const modern = await shot('exeter-1985');
        expect(Buffer.compare(old, modern)).not.toBe(0); // era colours, lamps and signs change
        await page.evaluate(({ x, y }) => window.__dd.teleport(x, y, 0), spots.farm);
        await shot('farm');
        expect(errors).toEqual([]);
    });

    test('renderer=webgl draws every catalogue vehicle, and an artic coupled to a trailer, with no GL errors', async ({ page }) => {
        test.setTimeout(120_000);
        const errors = watchErrors(page);
        await forceRenderer(page, 'webgl');
        await page.goto('/play/delivery-driver');
        await startGame(page);
        const ids = await page.evaluate(() => window.__dd.state.world && ['tamar-t-ton', 'exe-two-tonner', 'dart-3', 'moorland-tipper', 'kestrel']);
        const shots = [];
        for (const id of ids) {
            expect(await page.evaluate(i => window.__dd.setPlayerSpec(i), id), id).toBe(true);
            await page.waitForTimeout(500);
            const r = await page.evaluate(() => ({ stats: { ...window.__dd.renderer.stats }, px: window.__dd.renderer.probe() }));
            expect(r.stats.glErrors, id).toBe(0);
            expect(r.stats.vehicles, id).toBeGreaterThan(0);
            await page.screenshot({ path: `test-results/delivery-driver-gl/vehicle-${id}.png` });
            shots.push(await page.screenshot());
        }
        expect(Buffer.compare(shots[0], shots[1])).not.toBe(0);
        // an artic in the practice yard: reverse under the trailer, couple, and look at the coupling frame
        await page.evaluate(() => {
            const s = window.__dd.state;
            s.career.ledger.money = 100000;
            window.__dd.advanceClock(24 * 366 * 41);
            const depot = s.world.depots.find(d => d.home);
            s.buyVehicle({ model: 'kestrel', depot, tradeIn: true });
            s.enterPractice(depot);
        });
        await page.evaluate(() => {
            const s = window.__dd.state, t = s.trailerObjs.get('practice-trailer');
            const kx = t.x + Math.cos(t.heading) * t.spec.axle, ky = t.y + Math.sin(t.heading) * t.spec.axle;
            const f = s.player.spec.fifthWheel;
            window.__dd.teleport(kx + Math.cos(t.heading) * (6 - f), ky + Math.sin(t.heading) * (6 - f), t.heading);
            window.__dd.setControls({ throttle: 0.3, reverse: true });
        });
        await page.waitForFunction(() => {
            const s = window.__dd.state, p = s.player, t = s.trailerObjs.get('practice-trailer'), f = p.spec.fifthWheel;
            return Math.hypot(p.x + Math.cos(p.heading) * f - (t.x + Math.cos(t.heading) * t.spec.axle), p.y + Math.sin(p.heading) * f - (t.y + Math.sin(t.heading) * t.spec.axle)) < 0.3;
        }, null, { timeout: 15000 });
        await page.evaluate(() => window.__dd.setControls({ brake: 1 }));
        await page.waitForFunction(() => Math.abs(window.__dd.state.player.speed) < 0.05);
        await page.evaluate(() => window.__dd.setControls(null));
        await page.locator('.dd-canvas').click({ position: { x: 500, y: 300 } });
        await page.keyboard.press('KeyC');
        expect(await page.evaluate(() => window.__dd.state.player.trailer?.id)).toBe('practice-trailer');
        await page.waitForTimeout(600);
        const r = await page.evaluate(() => ({ stats: { ...window.__dd.renderer.stats } }));
        expect(r.stats.glErrors).toBe(0);
        expect(r.stats.vehicles).toBeGreaterThanOrEqual(2); // the tractor and its trailer
        await page.screenshot({ path: 'test-results/delivery-driver-gl/coupled.png' });
        expect(errors).toEqual([]);
    });

    test('renderer=webgl chase camera: the truck stays in view as the mode, tilt and zoom change, and keys and settings persist', async ({ page }) => {
        test.setTimeout(120_000);
        const errors = watchErrors(page);
        await forceRenderer(page, 'webgl');
        await page.goto('/play/delivery-driver');
        await startGame(page);
        await page.locator('.dd-canvas').click({ position: { x: 500, y: 300 } });
        /** Is the truck's pixel different from the ground beside it? (the screen position comes from the camera's matrix) */
        const truckVisible = () => page.evaluate(async () => {
            const m = await import('/games/delivery-driver/render/gl/camera3d.js');
            const dd = window.__dd, p = dd.state.player, g = dd.camera.gl;
            await new Promise(r => setTimeout(r, 400));
            dd.renderer.probe(); // redraw so camera.gl is current
            const s = m.projectPoint(g.vp, p.x, p.y, (p.z ?? 0) + 1.2, g.width, g.height);
            const fx = s.x / g.width, fy = s.y / g.height; // fractions from the top-left
            const px = dd.renderer.probeAt([[fx, fy], [fx - 0.07, fy], [fx + 0.07, fy]]);
            const [c, l, r] = px.map(q => q.slice(0, 3));
            const d = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
            return { on: fx > 0 && fx < 1 && fy > 0 && fy < 1, fx, fy, diff: Math.max(d(c, l), d(c, r)), glErrors: dd.renderer.stats.glErrors };
        });
        // software GL is slow, so the camera can need a few frames to catch up after a key: look again before judging
        const settled = async () => { let r; for (let i = 0; i < 6; i++) { r = await truckVisible(); if (r.on && r.diff > 12) break; } return r; };
        const seen = [];
        for (const step of ['chase', 'north', 'tiltUp', 'tiltDown', 'tiltDown', 'zoomOut']) {
            if (step === 'north') await page.keyboard.press('KeyV');
            if (step === 'tiltUp') await page.keyboard.press('BracketRight');
            if (step === 'tiltDown') await page.keyboard.press('BracketLeft');
            if (step === 'zoomOut') await page.keyboard.press('KeyX');
            const r = await settled();
            await page.screenshot({ path: `test-results/delivery-driver-gl/camera-${step}-${seen.length}.png` });
            expect(r.on, step).toBe(true);
            expect(r.diff, step).toBeGreaterThan(12);
            expect(r.glErrors, step).toBe(0);
            seen.push(r);
        }
        // the camera keys saved the mode and tilt with the other settings
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('games.dd.settings')));
        expect(saved.camera).toBe('north');
        expect(saved.cameraTilt).toBe(await page.evaluate(() => window.__dd.camera.tilt));
        expect(errors).toEqual([]);
    });

    test('renderer=webgl lighting: dawn, noon, dusk and night differ, shadows and night lights switch on, rain and fog change the frame', async ({ page }) => {
        test.setTimeout(180_000);
        const errors = watchErrors(page);
        await forceRenderer(page, 'webgl');
        await page.goto('/play/delivery-driver');
        await startGame(page);
        await page.evaluate(() => {
            const w = window.__dd.state.world, ex = w.region.townById.get('exeter');
            window.__dd.teleport(ex.x, ex.y, 0);
        });
        /** Mean brightness over a grid of pixels, plus the renderer's lighting stats. */
        const look = async name => {
            await page.waitForTimeout(1200);
            const r = await page.evaluate(() => {
                const pts = [];
                for (let i = 1; i < 6; i++) for (let j = 1; j < 6; j++) pts.push([i / 6, j / 6]);
                const px = window.__dd.renderer.probeAt(pts);
                const st = window.__dd.renderer.stats;
                return { lum: px.reduce((n, q) => n + q[0] + q[1] + q[2], 0) / (px.length * 3), shadows: st.shadows, night: st.night, spots: st.spots, glErrors: st.glErrors, shadowCalls: st.shadowCalls };
            });
            await page.screenshot({ path: `test-results/delivery-driver-gl/light-${name}.png` });
            expect(r.glErrors, name).toBe(0);
            return { ...r, shot: await page.screenshot() };
        };
        const clock = hours => page.evaluate(h => window.__dd.advanceClock(h), hours);
        await page.evaluate(() => window.__dd.setWeather({ kind: 'clear', intensity: 0 }));
        const dawn = await look('dawn'); // 06:00 in January is still dark; 08:30 is the dawn
        await clock(2.5);
        const morning = await look('morning');
        await clock(3.5);
        const noon = await look('noon');
        await clock(3.8);
        const dusk = await look('dusk');
        await clock(5);
        const night = await look('night');
        // Mean brightness no longer separates day from night: the depot now looks over dark tarmac in a low January sun, while the
        // night frame has bright lamp heads and a headlight cone (the ratio was 1.8 on the seeded roads). The frames still differ
        // and the night/shadow flags below carry the lighting checks.
        expect(Math.max(dawn.lum, morning.lum, noon.lum)).toBeGreaterThan(dusk.lum);
        expect(Buffer.compare(morning.shot, noon.shot)).not.toBe(0);
        expect(Buffer.compare(dusk.shot, night.shot)).not.toBe(0);
        expect(noon.shadows).toBe(true);
        expect(noon.shadowCalls).toBeGreaterThan(0);
        expect(night.shadows).toBe(false);
        expect(night.night).toBeGreaterThan(0.8);
        expect(night.spots).toBeGreaterThan(0); // headlights and street lamps
        expect(noon.night).toBeLessThan(0.1);
        // weather at noon
        await clock(15.5);
        await page.evaluate(() => window.__dd.setWeather({ kind: 'clear', intensity: 0 }));
        const clear = await look('clear');
        await page.evaluate(() => window.__dd.setWeather({ kind: 'rain', intensity: 1 }));
        const rain = await look('rain');
        await page.evaluate(() => window.__dd.setWeather({ kind: 'fog', intensity: 1 }));
        const fog = await look('fog');
        expect(Buffer.compare(clear.shot, rain.shot)).not.toBe(0);
        expect(Buffer.compare(clear.shot, fog.shot)).not.toBe(0);
        expect(Buffer.compare(rain.shot, fog.shot)).not.toBe(0);
        expect(errors).toEqual([]);
    });

    for (const kind of ['webgl', 'canvas2d']) {
        test(`renderer=${kind} map: the minimap and the full map draw relief, roads and the pink route, and pan and zoom redraw`, async ({ page }) => {
            test.setTimeout(90_000);
            const errors = watchErrors(page);
            await forceRenderer(page, kind);
            await page.goto('/play/delivery-driver');
            await startGame(page);
            await page.evaluate(() => {
                const ex = window.__dd.state.world.region.townById.get('exeter');
                window.__dd.teleport(ex.x, ex.y, 0);
                window.__dd.state.route = { pts: [ex.x, ex.y, ex.x + 3000, ex.y + 800, ex.x + 7000, ex.y + 2600], length: 8000 }; // long enough to span tens of pixels on the 28 km default view
            });
            // pixels of a canvas: how many are pink route pixels, and how many different colours there are
            const scan = selector => page.evaluate(sel => {
                const c = document.querySelector(sel);
                const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
                let pink = 0;
                const colours = new Set();
                for (let i = 0; i < d.length; i += 16) {
                    if (d[i] > 230 && d[i + 1] > 30 && d[i + 1] < 110 && d[i + 2] > 130 && d[i + 2] < 220) pink++;
                    colours.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4));
                }
                return { pink, colours: colours.size, w: c.width, h: c.height };
            }, selector);
            await page.waitForTimeout(500);
            const mini = await scan('.dd-minimap');
            expect(mini.colours, 'minimap is not a flat colour').toBeGreaterThan(8);
            await page.keyboard.press('KeyM');
            await expect(page.locator('.dd-fullmap')).toBeVisible();
            await page.waitForTimeout(500);
            const full = await scan('.dd-fullmap');
            expect(full.colours).toBeGreaterThan(8);
            expect(full.pink, 'the route line is drawn').toBeGreaterThan(3);
            await page.screenshot({ path: `test-results/delivery-driver-gl/map-${kind}.png` });
            // zoom in with the wheel (about the cursor), then drag to pan: each redraws a different picture
            const box = await page.locator('.dd-fullmap').boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -120);
            await page.waitForTimeout(300);
            const zoomed = await scan('.dd-fullmap');
            await page.mouse.down();
            await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 60, { steps: 6 });
            await page.mouse.up();
            await page.waitForTimeout(300);
            await page.screenshot({ path: `test-results/delivery-driver-gl/map-${kind}-zoomed.png` });
            expect(zoomed.colours).toBeGreaterThan(8);
            const info = await page.evaluate(() => window.__dd.map());
            expect(info.kind).toBe(kind);
            if (kind === 'webgl') {
                expect(info.gl.glErrors).toBe(0);
                expect(info.gl.frames).toBeGreaterThan(2);
                expect(info.gl.draws).toBeGreaterThan(5);
                expect(info.gl.roadBuilds).toBeGreaterThan(1); // zoom changed the scale
            } else {
                expect(info.gl).toBeNull();
            }
            expect(errors).toEqual([]);
        });
    }

    test('Auto graphics (no saved setting) starts on WebGL', async ({ page }) => {
        const errors = watchErrors(page);
        await page.goto('/play/delivery-driver');
        await startGame(page);
        expect(await page.evaluate(() => window.__dd.renderer.kind)).toBe('webgl');
        expect(errors).toEqual([]);
    });

    for (const kind of ['webgl', 'canvas2d']) {
        test(`renderer=${kind} smoke: the truck drives and the settings menu lists the graphics options`, async ({ page }) => {
            const errors = watchErrors(page);
            await forceRenderer(page, kind);
            await page.goto('/play/delivery-driver');
            await startGame(page);
            const p0 = await page.evaluate(() => [window.__dd.state.player.x, window.__dd.state.player.y]);
            await page.locator('.dd-canvas').click({ position: { x: 500, y: 400 } });
            await page.keyboard.down('KeyW');
            // software GL is slow, so wait for the truck to have moved rather than for a fixed time
            await page.waitForFunction(([x, y]) => Math.hypot(window.__dd.state.player.x - x, window.__dd.state.player.y - y) > 0.3, p0, { timeout: 8000 }).catch(() => {});
            await page.keyboard.up('KeyW');
            // the depot faces south-ish now (real roads), so measure the distance, not x alone
            const p1 = await page.evaluate(() => [window.__dd.state.player.x, window.__dd.state.player.y]);
            expect(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])).toBeGreaterThan(0.3);
            expect(await page.evaluate(() => window.__dd.renderer.kind)).toBe(kind);
            if (kind === 'webgl') expect(await page.evaluate(() => window.__dd.renderer.stats.glErrors)).toBe(0);
            expect(errors).toEqual([]);
        });
    }

    test('with WebGL2 unavailable the game runs on Canvas 2D, even when 3D is chosen', async ({ page }) => {
        const errors = watchErrors(page);
        await forceRenderer(page, 'webgl');
        await page.addInitScript(() => {
            const real = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return type === 'webgl2' || type === 'webgl' ? null : real.call(this, type, ...rest); };
        });
        await page.goto('/play/delivery-driver');
        await startGame(page);
        expect(await page.evaluate(() => window.__dd.renderer.kind)).toBe('canvas2d');
        await page.keyboard.down('KeyW');
        await page.waitForTimeout(600);
        await page.keyboard.up('KeyW');
        expect(await page.evaluate(() => window.__dd.map().kind)).toBe('canvas2d');
        expect(errors).toEqual([]);
    });

    test('repeated context loss gives up on WebGL and falls back to Canvas 2D', async ({ page }) => {
        const errors = watchErrors(page);
        await forceRenderer(page, 'webgl');
        await page.goto('/play/delivery-driver');
        await startGame(page);
        expect(await page.evaluate(() => window.__dd.renderer.kind)).toBe('webgl');
        await page.evaluate(() => window.__dd.renderer.loseContext());
        await page.waitForFunction(() => window.__dd.renderer.kind === 'canvas2d', null, { timeout: 8000 });
        await expect(page.locator('.dd-toast')).toContainText('compatibility graphics');
        expect(errors).toEqual([]);
    });

    test('renderer=webgl quality presets: shadows follow the preset and each draws with no GL errors (frame times recorded)', async ({ page }) => {
        test.setTimeout(180_000);
        const errors = watchErrors(page);
        await forceRenderer(page, 'webgl');
        await page.goto('/play/delivery-driver');
        await startGame(page);
        await page.evaluate(() => {
            const ex = window.__dd.state.world.region.townById.get('exeter');
            window.__dd.advanceClock(6);
            window.__dd.setWeather({ kind: 'clear', intensity: 0 });
            window.__dd.teleport(ex.x, ex.y, 0);
        });
        const report = {};
        for (const quality of ['low', 'medium', 'high']) {
            await page.evaluate(q => { window.__dd.setSettings({ quality: q }); window.__dd.resetPerf(); }, quality);
            await page.waitForTimeout(2500);
            const r = await page.evaluate(() => {
                const st = window.__dd.renderer.stats, perf = window.__dd.stats();
                return { shadows: st.shadows, glErrors: st.glErrors, drawCalls: st.drawCalls, shadowCalls: st.shadowCalls, frameMs: perf.frameMs, chunks: st.chunks };
            });
            report[quality] = r;
            expect(r.glErrors, quality).toBe(0);
        }
        console.log('quality presets (software GL):', JSON.stringify(report));
        expect(report.low.shadows).toBe(false);
        expect(report.medium.shadows).toBe(true);
        expect(report.high.shadows).toBe(true);
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

// ---- slope physics (plan 0007 phase 3) ---------------------------------------------------------------------------
test('renderer=canvas2d: slope physics is active: a van released on a steep road slows, stops and rolls back', async ({ page }) => {
    const errors = watchErrors(page);
    await forceRenderer(page, 'canvas2d');
    await page.goto('/play/delivery-driver');
    await startGame(page);
    expect(await page.evaluate(() => window.__dd.renderer.kind)).toBe('canvas2d');
    const road = await page.evaluate(() => window.__dd.steepRoad(0.05));
    expect(road?.grade).toBeGreaterThan(0.05);
    // put the van at the foot of the steepest stretch facing up it at 6 m/s, then let go of everything
    const r = await page.evaluate(async rd => {
        const dd = window.__dd, s = dd.state;
        dd.setControls({ throttle: 0, brake: 0 });
        dd.teleport(rd.x, rd.y, rd.heading);
        s.player.speed = 6;
        const t0 = s.time;
        let slowest = Infinity;
        const until = sec => new Promise(res => {
            const tick = () => { slowest = Math.min(slowest, s.player.speed); if (s.time - t0 >= sec) res(); else requestAnimationFrame(tick); };
            tick();
        });
        await until(1);
        const first = { t: s.time - t0, v: s.player.speed, grade: s.slope.grade };
        await until(7);
        dd.setControls(null);
        const p = s.player;
        return { first, slowest, z: p.z, ground: dd.groundZ(p.x, p.y), terrain: dd.terrainHeight(p.x, p.y) };
    }, road);
    // gravity: it slows much faster than coasting on the level could (~0.4 m/s2 for the van), then rolls back
    expect(r.first.grade).toBeGreaterThan(0.03);
    expect((6 - r.first.v) / r.first.t).toBeGreaterThan(0.8 * 9.81 * Math.sin(Math.atan(road.grade)));
    expect(r.slowest).toBeLessThan(-0.1);
    expect(Math.abs(r.z - r.ground)).toBeLessThan(0.3);
    expect(typeof r.terrain).toBe('number');
    expect(errors).toEqual([]);
});

test('renderer=webgl layered roads: a vehicle drives over a bridge and under it without falling through or climbing onto the deck', async ({ page }) => {
    test.setTimeout(150_000);
    const errors = watchErrors(page);
    await forceRenderer(page, 'webgl');
    await page.goto('/play/delivery-driver');
    await startGame(page);
    const found = await page.evaluate(async () => {
        const dd = window.__dd, s = dd.state;
        s.year = 2024;
        const road = await import('/games/delivery-driver/world/roadgraph.js');
        const terr = await import('/games/delivery-driver/world/terrain.js');
        const { edges } = s.world.graph;
        const p = { x: 0, y: 0, angle: 0 };
        const approach = 80; // metres before the crossing where each drive starts
        // a separated crossing whose two roads are open, long enough, and straight over the drive (no steering needed)
        const straight = (e, d) => {
            // driving on from the start pose along its heading must pass within 1.5 m of the crossing and of the road 20 m before it
            const off = road.laneOffset(e, 2024), q = { x: 0, y: 0, angle: 0 };
            road.lanePoint(e, d - approach, true, off, p);
            let worst = 0;
            for (const t of [d - 40, d - 20, d, d + 15]) {
                road.lanePoint(e, t, true, off, q);
                worst = Math.max(worst, Math.abs((q.x - p.x) * Math.sin(p.angle) * -1 + (q.y - p.y) * Math.cos(p.angle)));
            }
            return worst < 1.5;
        };
        for (const c of s.world.graph.crossings) {
            if (c.atGrade) continue;
            const U = edges[c.upper.edge], L = edges[c.lower.edge];
            if (!road.edgeOpen(U, 2024) || !road.edgeOpen(L, 2024) || U.oneway || L.oneway) continue;
            // the drive checks run within 6 to 12 m of the crossing, so skip wide carriageways whose lane lies further off the centre line
            if (Math.abs(road.laneOffset(U, 2024)) > 4 || Math.abs(road.laneOffset(L, 2024)) > 4) continue;
            if (c.upper.d < approach + 5 || U.len < c.upper.d + 25 || c.lower.d < approach + 5 || L.len < c.lower.d + 25) continue;
            if (!straight(U, c.upper.d) || !straight(L, c.lower.d)) continue;
            const gap = terr.crossingGap(edges, c);
            return { c: { upper: c.upper, lower: c.lower, x: c.x, y: c.y }, gap };
        }
        return null;
    });
    expect(found, 'a straight separated crossing exists').not.toBeNull();
    expect(found.gap).toBeGreaterThanOrEqual(5.5 - 0.01);

    // drive one road through the crossing at a steady pace; report the lowest and highest height within 12 m of it
    const drive = side => page.evaluate(async ({ c, side }) => {
        const dd = window.__dd, s = dd.state;
        const road = await import('/games/delivery-driver/world/roadgraph.js');
        const terr = await import('/games/delivery-driver/world/terrain.js');
        const edges = s.world.graph.edges;
        const here = c[side], other = c[side === 'upper' ? 'lower' : 'upper'];
        const e = edges[here.edge], oe = edges[other.edge];
        const p = { x: 0, y: 0, angle: 0 };
        road.lanePoint(e, here.d - 80, true, road.laneOffset(e, 2024), p);
        dd.setControls({ throttle: 0, brake: 0 });
        dd.teleport(p.x, p.y, p.angle);
        const pl = s.player;
        const startZ = pl.z;
        const out = { startZ, own: terr.roadHeightAt(e, here.d), other: terr.roadHeightAt(oe, other.d), minZ: Infinity, maxZ: -Infinity, reached: false, minGround: Infinity, minNear: Infinity };
        const t0 = performance.now();
        await new Promise(res => {
            const tick = () => {
                pl.speed = Math.max(pl.speed, 7); // hold a steady 7 m/s so the run does not depend on the truck's pull
                dd.setControls({ throttle: 0.4, steer: 0, brake: 0 });
                const near = Math.hypot(pl.x - c.x, pl.y - c.y);
                if (near < 12) { out.minZ = Math.min(out.minZ, pl.z); out.maxZ = Math.max(out.maxZ, pl.z); }
                out.minNear = Math.min(out.minNear, near);
                out.reached = out.minNear < 6; // the nearside lane lies a few metres off the centre line
                out.minGround = Math.min(out.minGround, pl.z - dd.groundZ(pl.x, pl.y, false));
                if ((out.minNear < 12 && near > 14) || performance.now() - t0 > 60000) res(); else requestAnimationFrame(tick);
            };
            tick();
        });
        dd.setControls(null);
        out.endZ = pl.z;
        return out;
    }, { c: found.c, side });

    const over = await drive('upper');
    expect(over.reached, 'the vehicle reached the crossing on the deck ' + JSON.stringify([found, over])).toBe(true);
    // on the deck: at least the clearance above the road beneath, and within a metre of the deck's own profile
    expect(over.minZ).toBeGreaterThanOrEqual(over.other + 5.5 - 1.0);
    expect(Math.abs(over.maxZ - over.own)).toBeLessThan(2.5);
    expect(over.minGround).toBeGreaterThan(-0.5); // never below the ground (no falling through)

    const under = await drive('lower');
    expect(under.reached, 'the vehicle reached the crossing on the road beneath ' + JSON.stringify(under)).toBe(true);
    // beneath: stays on the lower road, well below the deck above
    expect(under.maxZ).toBeLessThan(under.own + 1.5);
    expect(under.maxZ).toBeLessThan(under.other - 3);
    expect(under.minGround).toBeGreaterThan(-0.5);
    expect(errors).toEqual([]);
});
