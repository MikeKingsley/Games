import { test, expect } from '@playwright/test';

import { ANIMALS } from '../../Games.Client/wwwroot/games/animal-feeding/data.js';

const eats = Object.fromEntries(ANIMALS.flatMap(a => a.foods.map(f => [f, a.id])));

async function dragTo(page, food, animalSelector) {
    const a = await food.boundingBox();
    const b = await page.locator(animalSelector).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 60, { steps: 10 });
    await page.mouse.up();
}

test('home lists the game, wrong drop returns the food, correct drops complete a round', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto('/');
    await page.getByRole('link', { name: 'Feed the Animals' }).click();
    await expect(page.locator('.af-food')).toHaveCount(3);
    await expect(page.locator('.af-root')).toHaveAttribute('data-round', '1');

    // wrong drop: food stays in the tray
    const first = page.locator('.af-food').first();
    const wrongAnimal = await page.locator('.af-animal').evaluateAll(
        (cards, [food, map]) => cards.map(c => c.dataset.animal).find(a => map[food] !== a),
        [await first.getAttribute('data-food'), eats]);
    await dragTo(page, first, `[data-animal="${wrongAnimal}"]`);
    await expect(page.locator('.af-food:not(.eaten)')).toHaveCount(3);
    await page.waitForTimeout(600); // let the food finish gliding back before grabbing it again

    // correct drops
    for (let left = 3; left > 0; left--) {
        const food = page.locator('.af-food:not(.eaten)').first();
        const kind = await food.getAttribute('data-food');
        await dragTo(page, food, `[data-animal="${eats[kind]}"]`);
        await expect(page.locator('.af-food.eaten')).toHaveCount(3 - left + 1);
    }
    await expect(page.locator('.af-root')).toHaveAttribute('data-round', '2', { timeout: 6000 });
    expect(errors).toEqual([]);
});
