import { test, expect } from '@playwright/test';

import { ANIMALS, FOODS, acceptsFood } from '../../Games.Client/wwwroot/games/animal-feeding/data.js';

const animal = id => ANIMALS.find(a => a.id === id);

async function dragTo(page, food, animalSelector) {
    const a = await food.boundingBox();
    const b = await page.locator(animalSelector).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 60, { steps: 10 });
    await page.mouse.up();
}

const animalsOnScreen = page => page.locator('.af-animal').evaluateAll(cards => cards.map(c => c.dataset.animal));

/** Drags the food to each animal that accepts it until one eats it (a pig is refused when another animal needs the food). */
async function feedSomeone(page, locator) {
    const food = await locator.elementHandle(); // a fixed element: the locator would move on to the next food once this one is eaten
    const kind = await food.getAttribute('data-food');
    // animals that haven't eaten yet go first (the dev-only fed counter shows who has), so a round always finishes
    const fed = await page.locator('.af-animal').evaluateAll(cards => Object.fromEntries(cards.map(c => [c.dataset.animal, Number(/\d+/.exec(c.querySelector('.af-fed-count')?.textContent ?? '0')[0])])));
    const candidates = (await animalsOnScreen(page)).filter(id => acceptsFood(animal(id), kind)).sort((a, b) => (fed[a] > 0) - (fed[b] > 0) || (a === 'pig') - (b === 'pig'));
    for (const id of candidates) {
        await dragTo(page, food, `[data-animal="${id}"]`);
        await page.waitForTimeout(200);
        if (await food.evaluate(n => n.classList.contains('eaten') || !n.isConnected)) return true;
        await page.waitForTimeout(500); // glide back home before the next try
    }
    return false;
}

test('home lists the game, wrong drop returns the food, correct drops complete a round', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto('/');
    await page.getByRole('link', { name: 'Feed the Animals' }).click();
    await expect(page.locator('.af-food')).toHaveCount(3);
    await expect(page.locator('.af-root')).toHaveAttribute('data-round', '1');

    // wrong drop: food stays in the tray (a pig eats anything, so a round with a pig may have no wrong animal)
    const first = page.locator('.af-food').first();
    const firstKind = await first.getAttribute('data-food');
    const wrongAnimal = (await animalsOnScreen(page)).find(id => !acceptsFood(animal(id), firstKind));
    if (wrongAnimal) {
        await dragTo(page, first, `[data-animal="${wrongAnimal}"]`);
        await expect(page.locator('.af-food:not(.eaten)')).toHaveCount(3);
        await page.waitForTimeout(600); // let the food finish gliding back before grabbing it again
    }

    // correct drops: the round is complete as soon as every animal has eaten one piece, so spare food is not needed
    const animalCount = await page.locator('.af-animal').count();
    for (let eaten = 1; eaten <= animalCount; eaten++) {
        // the first uneaten food that an animal which hasn't eaten yet accepts (feeding the same animal twice would never finish the round)
        const fed = await page.locator('.af-animal').evaluateAll(cards => Object.fromEntries(cards.map(c => [c.dataset.animal, Number(/\d+/.exec(c.querySelector('.af-fed-count')?.textContent ?? '0')[0])])));
        const hungry = (await animalsOnScreen(page)).filter(id => fed[id] === 0);
        const kinds = await page.locator('.af-food:not(.eaten)').evaluateAll(f => f.map(n => n.dataset.food));
        const index = kinds.findIndex(k => hungry.some(id => acceptsFood(animal(id), k)));
        const food = page.locator('.af-food:not(.eaten)').nth(Math.max(index, 0));
        expect(await feedSomeone(page, food)).toBe(true);
        // a fed animal shrinks to half size
        await expect(page.locator('.af-animal.fed').first()).toBeVisible();
        await expect.poll(() => page.locator('.af-animal.fed .af-emoji').first().evaluate(n => getComputedStyle(n).scale)).toBe('0.5');
    }
    await expect(page.locator('.af-food.leftover, .af-food.eaten')).toHaveCount(3, { timeout: 3000 });
    await expect(page.locator('.af-root')).toHaveAttribute('data-round', '2', { timeout: 6000 });
    // one wrong drop at level 1 is forgiven: the round still earns stars, and they are counted
    expect(Number(await page.locator('.af-root').getAttribute('data-earned'))).toBeGreaterThanOrEqual(1);
    await expect(page.locator('.af-stars')).toContainText('⭐');
    expect(errors).toEqual([]);
});

async function completeRound(page) {
    const level = await page.locator('.af-root').getAttribute('data-round');
    for (let guard = 0; guard < 12; guard++) {
        if ((await page.locator('.af-root').getAttribute('data-round')) !== level) return;
        const foods = await page.locator('.af-food:not(.eaten):not(.leftover)').all();
        let fed = false;
        for (const food of foods) {
            const kind = await food.getAttribute('data-food');
            if (!(await animalsOnScreen(page)).some(id => acceptsFood(animal(id), kind))) continue; // a distractor
            await feedSomeone(page, food);
            fed = true;
            break;
        }
        if (!fed) await page.waitForTimeout(300);
    }
}

const seedProgress = (page, rounds, stars = 0) =>
    page.addInitScript(([r, s]) => localStorage.setItem('games.progress.animal-feeding', JSON.stringify({ rounds: r, stars: s })), [rounds, stars]);

const NAMES = { farm: 'the farm', woodland: 'the woods', dinosaur: 'dinosaur land', enchanted: 'the enchanted forest' };

for (const [rounds, from, to] of [[4, 'farm', 'woodland'], [29, 'dinosaur', 'enchanted']]) {
    test(`the world changes from ${from} to ${to} after level ${rounds + 1}, and the world name shows bottom left`, async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        await seedProgress(page, rounds, 3);
        await page.goto('/play/animal-feeding');
        await expect(page.locator('.af-root')).toHaveAttribute('data-world', from);
        await expect(page.locator('.af-world-name')).toHaveText(new RegExp(NAMES[from], 'i'));
        await completeRound(page);
        await expect(page.locator('.af-root')).toHaveAttribute('data-world', to, { timeout: 15_000 });
        await expect(page.locator('.af-world-name')).toHaveText(new RegExp(NAMES[to], 'i'));
        await expect(page.locator('.af-banner')).toHaveCount(0); // no popup
        await expect(page.locator('.af-world')).toHaveCount(1, { timeout: 5_000 }); // the old layer is dropped after the fade
        expect(errors).toEqual([]);
    });
}

test('past level 100 the last world stays and its name is shown', async ({ page }) => {
    await seedProgress(page, 140, 0);
    await page.goto('/play/animal-feeding');
    await expect(page.locator('.af-root')).toHaveAttribute('data-world', 'rainbow');
    await expect(page.locator('.af-world-name')).toHaveText(/unicorn rainbow land/i);
});

const seedHardcore = (page, rounds, stars) =>
    page.addInitScript(([r, s]) => localStorage.setItem('games.progress.animal-feeding', JSON.stringify({ rounds: r, stars: s, hardcore: true })), [rounds, stars]);

const openGrownUps = page => page.getByRole('button', { name: 'Grown-ups' }).click();

test('each animal shows the foods it accepts; Hardcore Mode (one-way) restarts at level 1, hides them, times it and uses flames', async ({ page }) => {
    // level 6 with 2 stars, seeded once only (an init script would overwrite the saved state again on every reload): Hardcore throws that away
    await page.addInitScript(() => { if (!sessionStorage.seeded) { sessionStorage.seeded = '1'; localStorage.setItem('games.progress.animal-feeding', JSON.stringify({ rounds: 5, stars: 2 })); } });
    await page.goto('/play/animal-feeding');
    await expect(page.locator('.af-food').first()).toBeVisible();
    const animals = await page.locator('.af-animal').count();
    expect(animals).toBeGreaterThan(0);
    await expect(page.locator('.af-palette')).toHaveCount(animals);
    const first = await animalsOnScreen(page).then(ids => ids[0]);
    // only foods that are in the tray (and accepted) are listed
    const inTray = await page.locator('.af-food').evaluateAll(f => f.map(n => n.dataset.food));
    const expected = animal(first).eatsAnything ? '🍽️' : animal(first).foods.filter(f => inTray.includes(f)).map(f => FOODS[f].emoji).join('');
    await expect(page.locator(`[data-animal="${first}"] .af-palette`)).toHaveText(expected);
    await expect(page.locator('.af-timer')).toBeHidden(); // level 1 is untimed in normal mode

    await openGrownUps(page);
    await page.getByRole('button', { name: /Hardcore Mode/ }).click();
    await expect(page.getByRole('button', { name: /Restarts from level 1/ })).toBeVisible();
    await page.getByRole('button', { name: /Tap again/ }).click();
    await expect(page.getByRole('button', { name: /Hardcore Mode on/ })).toBeDisabled();
    await page.getByRole('button', { name: /Close/ }).click();
    await expect(page.locator('.af-root')).toHaveAttribute('data-hardcore', 'true');
    await expect(page.locator('.af-root')).toHaveAttribute('data-round', '1');
    await expect(page.locator('.af-palette')).toHaveCount(0);
    await expect(page.locator('.af-world.night')).toHaveCount(1); // every world is at night in Hardcore Mode
    await expect(page.locator('.af-moon')).toHaveCount(1);
    await expect(page.locator('.af-timer')).toBeVisible();
    await expect(page.locator('.af-hardcore')).toBeVisible();
    await expect(page.locator('.af-hardcore')).toHaveText('Hardcore Mode');
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem('games.progress.animal-feeding')))).toMatchObject({ hardcore: true, rounds: 0, stars: 0 });

    // it is still on after a reload, and only resetting the levels turns it off
    await page.reload();
    await expect(page.locator('.af-root')).toHaveAttribute('data-hardcore', 'true');
    await page.goto('/options');
    await page.getByRole('button', { name: /Reset levels/ }).click();
    await page.getByRole('button', { name: /Tap again/ }).click();
    await page.goto('/play/animal-feeding');
    await expect(page.locator('.af-root')).toHaveAttribute('data-hardcore', 'false');
    await expect(page.locator('.af-palette').first()).toBeVisible();
    await expect(page.locator('.af-world.night')).toHaveCount(0);
});

test('in Hardcore Mode, running out of time with no stars sends the player back to level 1', async ({ page }) => {
    await seedHardcore(page, 99, 0); // level 100 has a 5 second countdown (plus 3s for each animal beyond three)
    await page.goto('/play/animal-feeding');
    await expect(page.locator('.af-root')).toHaveAttribute('data-round', '100');
    await expect(page.locator('.af-root')).toHaveAttribute('data-round', '1', { timeout: 20000 });
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem('games.progress.animal-feeding')))).toMatchObject({ rounds: 0, hardcore: true });
});

test('Hardcore Mode from level 11 has 3-5 animals, and past level 100 they bounce around', async ({ page }) => {
    await seedHardcore(page, 10, 2);
    await page.goto('/play/animal-feeding');
    await expect(page.locator('.af-root')).toHaveAttribute('data-round', '11');
    const count = await page.locator('.af-animal').count();
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(5);
    await expect(page.locator('.af-animals.bouncing')).toHaveCount(0);
    expect(Number(await page.locator('.af-timer-text').textContent())).toBeLessThanOrEqual(15 + 2 * 3);

    // level 101 onwards: the animals leave their row and move
    const page2 = await page.context().newPage();
    await page2.addInitScript(() => localStorage.setItem('games.progress.animal-feeding', JSON.stringify({ rounds: 100, stars: 5, hardcore: true })));
    await page2.bringToFront();
    await page2.goto('/play/animal-feeding');
    await expect(page2.locator('.af-animals.bouncing')).toHaveCount(1);
    const positions = () => page2.locator('.af-animal').evaluateAll(cards => cards.map(c => c.getBoundingClientRect().x + ',' + c.getBoundingClientRect().y).join('|'));
    const before = await positions();
    await expect.poll(positions, { timeout: 4000 }).not.toBe(before);
    // they stay on screen
    const inside = await page2.locator('.af-animal').evaluateAll(cards => cards.every(c => { const r = c.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1; }));
    expect(inside).toBe(true);
});

test('the countdown stands still while the grown-ups menu is open and carries on after it closes', async ({ page }) => {
    await seedProgress(page, 20, 0); // level 21 is timed
    await page.goto('/play/animal-feeding');
    const timer = page.locator('.af-timer-text');
    await expect(timer).toHaveText(/\d+/);

    await openGrownUps(page);
    const panel = page.locator('.parent-panel');
    await expect(panel).toBeVisible();

    const frozen = Number(await timer.textContent());
    await page.waitForTimeout(3500);
    expect(Number(await timer.textContent())).toBe(frozen);

    await page.getByRole('button', { name: /Close/ }).click();
    await expect(panel).toHaveCount(0);
    await expect.poll(async () => Number(await timer.textContent()), { timeout: 5000 }).toBeLessThan(frozen);
});

const seedState = (page, state) =>
    page.addInitScript(([key, value]) => { if (!sessionStorage.seeded) { sessionStorage.seeded = '1'; localStorage.setItem(key, value); } }, ['games.progress.animal-feeding', JSON.stringify(state)]);
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('games.progress.animal-feeding')));

test('in normal mode the stars do nothing until levels have a countdown (level 16)', async ({ page }) => {
    await seedState(page, { rounds: 14, stars: 10 }); // level 15: untimed
    await page.goto('/play/animal-feeding');
    await expect(page.locator('.af-root')).toHaveAttribute('data-round', '15');
    await expect(page.locator('.af-timer')).toBeHidden();
    await page.locator('.af-stars').click();
    await expect(page.locator('.af-stars')).toContainText('10');
    await expect(page.locator('.af-stars')).not.toContainText('+');
    await expect(page.getByRole('dialog', { name: 'Increase time' })).toHaveCount(0);
    expect(await saved(page)).toMatchObject({ stars: 10 });
    expect(await saved(page)).not.toHaveProperty('buff', 1);
});

test('tapping the stars opens a dialog that pauses the countdown and spends 5 stars per +1s until OK', async ({ page }) => {
    await seedState(page, { rounds: 15, stars: 12 }); // level 16: the first timed level
    await page.goto('/play/animal-feeding');
    const timer = page.locator('.af-timer-text');
    await expect(timer).toHaveText(/\d+/);
    const stars = page.locator('.af-stars');
    await expect(stars).toContainText('12');

    await stars.click();
    const dialog = page.getByRole('dialog', { name: 'Increase time' });
    await expect(dialog).toBeVisible();
    const frozen = Number(await timer.textContent());
    await page.waitForTimeout(2500);
    expect(Number(await timer.textContent())).toBe(frozen); // the countdown stands still while the dialog is open

    await dialog.getByRole('button', { name: /\+1 second/ }).click();
    await expect(dialog.locator('[data-shop="have"]')).toContainText('7');
    await expect(dialog.locator('[data-shop="have"]')).toContainText('+1s');
    await dialog.getByRole('button', { name: /Increase as much as I can/ }).click(); // 7 stars = one more
    await expect(dialog.locator('[data-shop="have"]')).toContainText('+2s');
    await expect(dialog.getByRole('button', { name: /\+1 second/ })).toBeDisabled(); // 2 stars left: nothing more to buy
    await expect(dialog.getByRole('button', { name: /Increase as much as I can/ })).toBeDisabled();
    expect(await saved(page)).toMatchObject({ stars: 2, buff: 2 });
    await expect.poll(async () => Number(await timer.textContent())).toBe(frozen + 2); // the bought time is on the clock (frozen while the dialog is open)

    await dialog.getByRole('button', { name: 'OK' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => Number(await timer.textContent()), { timeout: 5000 }).toBeLessThan(frozen + 2); // and the clock runs again
    await stars.click(); // 2 stars is not enough for a dialog
    await expect(dialog).toHaveCount(0);
});

test('increasing time by as much as you can afford in one go', async ({ page }) => {
    await seedState(page, { rounds: 0, stars: 23, hardcore: true });
    await page.goto('/play/animal-feeding');
    await page.locator('.af-stars').click();
    const dialog = page.getByRole('dialog', { name: 'Increase time' });
    await dialog.getByRole('button', { name: /Increase as much as I can \(\+4s\)/ }).click();
    await expect(dialog.locator('[data-shop="have"]')).toContainText('3');
    await expect(dialog.locator('[data-shop="have"]')).toContainText('+4s');
    await dialog.getByRole('button', { name: 'OK' }).click();
    expect(await saved(page)).toMatchObject({ stars: 3, buff: 4, hardcore: true });
});

test('the time buff wears off by 0.5s each time the countdown runs out (Hardcore too)', async ({ page }) => {
    await seedState(page, { rounds: 99, stars: 5, buff: 1, hardcore: true });
    await page.goto('/play/animal-feeding');
    await expect(page.locator('.af-root')).toHaveAttribute('data-hardcore', 'true');
    await expect.poll(async () => (await saved(page)).buff, { timeout: 25000 }).toBe(0.5);
    expect(await saved(page)).toMatchObject({ stars: 4, hardcore: true });
});
