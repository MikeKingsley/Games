import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANIMALS, FOODS } from '../../Games.Client/wwwroot/games/animal-feeding/data.js';
import {
    createRound, checkFeed, feed, isRoundComplete, nextDifficulty, shouldReward, seededRng, ITEMS_PER_ROUND, animalPool, unlockedBiomes, rareAnimalFor, UNICORN_CHANCE,
} from '../../Games.Client/wwwroot/games/animal-feeding/logic.js';

const animal = id => ANIMALS.find(a => a.id === id);

test('every animal food exists in FOODS', () => {
    for (const a of ANIMALS) for (const f of a.foods) assert.ok(FOODS[f], `${a.id} -> ${f}`);
});

test('rounds are always winnable: right size, unique animals, every item feedable to a present animal', () => {
    for (let seed = 1; seed <= 300; seed++) {
        const rng = seededRng(seed);
        for (const animalCount of [2, 3]) {
            const round = createRound(rng, { animalCount });
            assert.equal(round.animals.length, animalCount);
            assert.equal(new Set(round.animals).size, animalCount);
            assert.equal(round.items.length, ITEMS_PER_ROUND);
            for (const item of round.items) {
                assert.ok(round.animals.some(id => animal(id).foods.includes(item.foodId)), `seed ${seed}`);
            }
            for (const id of round.animals) {
                assert.ok(round.items.some(i => animal(id).foods.includes(i.foodId)), `animal ${id} has food, seed ${seed}`);
            }
        }
    }
});

test('animal set never repeats the previous round', () => {
    const rng = seededRng(42);
    let previous = [];
    for (let i = 0; i < 300; i++) {
        const round = createRound(rng, { animalCount: i % 2 ? 3 : 2, previousAnimalIds: previous });
        assert.notEqual([...round.animals].sort().join(), [...previous].sort().join());
        previous = round.animals;
    }
});

test('same seed gives the same round', () => {
    assert.deepEqual(createRound(seededRng(7)), createRound(seededRng(7)));
});

test('checkFeed accepts the right food and rejects wrong animal, absent animal, unknown item and fed item', () => {
    const round = { animals: ['monkey', 'rabbit'], items: [
        { uid: 'a', foodId: 'banana', fed: false },
        { uid: 'b', foodId: 'carrot', fed: false },
        { uid: 'c', foodId: 'carrot', fed: true },
    ] };
    assert.equal(checkFeed(round, 'a', 'monkey'), true);
    assert.equal(checkFeed(round, 'a', 'rabbit'), false);
    assert.equal(checkFeed(round, 'a', 'cow'), false);
    assert.equal(checkFeed(round, 'zzz', 'monkey'), false);
    assert.equal(checkFeed(round, 'c', 'rabbit'), false);
});

test('feeding every item completes the round; wrong drops change nothing', () => {
    const round = createRound(seededRng(3), { animalCount: 2 });
    assert.equal(isRoundComplete(round), false);
    for (const item of round.items) {
        const wrong = round.animals.find(id => !animal(id).foods.includes(item.foodId));
        if (wrong) assert.equal(feed(round, item.uid, wrong), false);
        assert.equal(item.fed, false);
    }
    for (const item of round.items) {
        const right = round.animals.find(id => animal(id).foods.includes(item.foodId));
        assert.equal(feed(round, item.uid, right), true);
    }
    assert.equal(isRoundComplete(round), true);
});

test('difficulty ramps from two to three animals', () => {
    assert.equal(nextDifficulty(0).animalCount, 2);
    assert.equal(nextDifficulty(2).animalCount, 2);
    assert.equal(nextDifficulty(3).animalCount, 3);
    assert.equal(nextDifficulty(50).animalCount, 3);
});

test('reward every third completed round, never at zero', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(shouldReward),
        [false, false, false, true, false, false, true, false]);
});

test('holding food over the right animal takes bites and finishes after BITES_PER_FOOD * BITE_MS', async () => {
    const { eat, bitesTaken, eatenFraction, BITES_PER_FOOD, BITE_MS } = await import('../../Games.Client/wwwroot/games/animal-feeding/logic.js');
    const round = { animals: ['monkey', 'rabbit'], items: [{ uid: 'a', foodId: 'banana', fed: false, eatMs: 0 }] };
    assert.deepEqual(eat(round, 'a', 'monkey', BITE_MS - 1), { ok: true, bites: 0, done: false });
    assert.deepEqual(eat(round, 'a', 'monkey', 1), { ok: true, bites: 1, done: false });
    assert.equal(bitesTaken(round.items[0]), 1);
    assert.ok(eatenFraction(round.items[0]) > 0 && eatenFraction(round.items[0]) < 1);
    const last = eat(round, 'a', 'monkey', BITE_MS * BITES_PER_FOOD);
    assert.deepEqual(last, { ok: true, bites: BITES_PER_FOOD, done: true });
    assert.equal(round.items[0].fed, true);
    assert.equal(eatenFraction(round.items[0]), 1);
});

test('wrong animal never eats; progress is kept when the food is pulled away', async () => {
    const { eat, bitesTaken, BITE_MS } = await import('../../Games.Client/wwwroot/games/animal-feeding/logic.js');
    const round = { animals: ['monkey', 'rabbit'], items: [{ uid: 'a', foodId: 'banana', fed: false, eatMs: 0 }] };
    assert.equal(eat(round, 'a', 'rabbit', 5000).ok, false);
    assert.equal(round.items[0].eatMs, 0);
    eat(round, 'a', 'monkey', BITE_MS * 2);
    eat(round, 'a', 'rabbit', 1000); // pulled over a wrong animal: no change
    assert.equal(bitesTaken(round.items[0]), 2);
});

test('feed() completes a partly eaten item', async () => {
    const { eat, feed, eatenFraction, BITE_MS } = await import('../../Games.Client/wwwroot/games/animal-feeding/logic.js');
    const round = { animals: ['monkey'], items: [{ uid: 'a', foodId: 'banana', fed: false, eatMs: 0 }] };
    eat(round, 'a', 'monkey', BITE_MS);
    assert.equal(feed(round, 'a', 'monkey'), true);
    assert.equal(eatenFraction(round.items[0]), 1);
});

test('difficulty tiers: more foods after stars, distractors from 5 stars', () => {
    const at = stars => nextDifficulty(stars * 3);
    assert.deepEqual(nextDifficulty(0), { animalCount: 2, itemCount: 3, distractors: 0 });
    assert.deepEqual(at(1), { animalCount: 3, itemCount: 3, distractors: 0 });
    assert.deepEqual(at(2), { animalCount: 3, itemCount: 3, distractors: 0 });
    assert.deepEqual(at(3), { animalCount: 3, itemCount: 4, distractors: 0 });
    assert.deepEqual(at(4), { animalCount: 3, itemCount: 4, distractors: 0 });
    assert.deepEqual(at(5), { animalCount: 3, itemCount: 5, distractors: 1 });
    assert.deepEqual(at(7), { animalCount: 3, itemCount: 5, distractors: 1 });
    assert.deepEqual(at(8), { animalCount: 3, itemCount: 6, distractors: 2 });
    assert.deepEqual(at(40), { animalCount: 3, itemCount: 6, distractors: 2 });
});

test('every difficulty tier makes winnable rounds with the right number of distractors nobody present eats', () => {
    for (const rounds of [0, 3, 9, 15, 24, 100]) {
        const difficulty = nextDifficulty(rounds);
        for (let seed = 1; seed <= 200; seed++) {
            const round = createRound(seededRng(seed), { ...difficulty, pool: animalPool(rounds) });
            assert.equal(round.animals.length, difficulty.animalCount);
            assert.equal(round.items.length, difficulty.itemCount);
            const distractors = round.items.filter(i => i.distractor);
            assert.equal(distractors.length, difficulty.distractors);
            assert.equal(new Set(distractors.map(d => d.foodId)).size, distractors.length, 'distractors are distinct');
            for (const item of round.items) {
                const eaters = round.animals.filter(id => animal(id).foods.includes(item.foodId));
                assert.equal(eaters.length > 0, !item.distractor, `${item.foodId} seed ${seed}`);
            }
            for (const id of round.animals) {
                assert.ok(round.items.some(i => !i.distractor && animal(id).foods.includes(i.foodId)), `${id} gets food`);
            }
        }
    }
});

test('a distractor can never be fed and does not keep the round open', () => {
    const round = { animals: ['monkey'], items: [
        { uid: 'a', foodId: 'banana', fed: false, eatMs: 0 },
        { uid: 'b', foodId: 'bone', fed: false, eatMs: 0, distractor: true },
    ] };
    assert.equal(checkFeed(round, 'b', 'monkey'), false);
    assert.equal(feed(round, 'b', 'monkey'), false);
    assert.equal(isRoundComplete(round), false);
    feed(round, 'a', 'monkey');
    assert.equal(isRoundComplete(round), true);
});

test('levels 1-15 are untimed; level 16 gets 30s and each level takes one second less, never below 5s', async () => {
    const { roundTimeSeconds, levelFor } = await import('../../Games.Client/wwwroot/games/animal-feeding/logic.js');
    assert.equal(levelFor(0), 1);
    assert.equal(levelFor(15), 16);
    for (let rounds = 0; rounds < 15; rounds++) assert.equal(roundTimeSeconds(rounds), null, `level ${levelFor(rounds)}`);
    assert.equal(roundTimeSeconds(15), 30);
    assert.equal(roundTimeSeconds(16), 29);
    assert.equal(roundTimeSeconds(25), 20);
    assert.equal(roundTimeSeconds(39), 6);
    assert.equal(roundTimeSeconds(40), 5);
    assert.equal(roundTimeSeconds(500), 5);
    for (let r = 15; r < 100; r++) assert.ok(roundTimeSeconds(r + 1) <= roundTimeSeconds(r), 'never gets longer');
});

test('every biome has enough animals, and no two animals share a food', () => {
    for (const biome of ['farm', 'woodland', 'savanna', 'ocean', 'dinosaur']) {
        assert.ok(ANIMALS.filter(a => a.biome === biome).length >= 5, biome);
    }
    const foods = ANIMALS.flatMap(a => a.foods);
    assert.equal(new Set(foods).size, foods.length);
    assert.equal(new Set(ANIMALS.map(a => a.id)).size, ANIMALS.length);
});

test('biomes unlock by level: 1-5 farm, 6-10 +woodland, 11-15 +savanna, 16+ +ocean', () => {
    const at = level => unlockedBiomes(level - 1);
    for (const level of [1, 3, 5]) assert.deepEqual(at(level), ['farm'], `level ${level}`);
    for (const level of [6, 8, 10]) assert.deepEqual(at(level), ['farm', 'woodland'], `level ${level}`);
    for (const level of [11, 13, 15]) assert.deepEqual(at(level), ['farm', 'woodland', 'savanna'], `level ${level}`);
    for (const level of [16, 18, 20]) assert.deepEqual(at(level), ['farm', 'woodland', 'savanna', 'ocean'], `level ${level}`);
    for (const level of [21, 22, 100]) assert.deepEqual(at(level), ['farm', 'woodland', 'savanna', 'ocean', 'dinosaur'], `level ${level}`);
});

test('rounds only spawn animals (and distractor foods) from the unlocked pool, and the pool is genuinely mixed', () => {
    for (const level of [1, 5, 6, 10, 11, 15, 16, 20, 21, 30]) {
        const rounds = level - 1;
        const allowed = new Set(unlockedBiomes(rounds));
        const seen = new Set();
        let previous = [];
        const rng = seededRng(level);
        for (let i = 0; i < 300; i++) {
            const round = createRound(rng, { ...nextDifficulty(rounds), pool: animalPool(rounds), previousAnimalIds: previous });
            previous = round.animals;
            for (const id of round.animals) {
                assert.ok(allowed.has(animal(id).biome), `level ${level}: ${id}`);
                seen.add(id);
            }
            for (const item of round.items.filter(i => i.distractor)) {
                const owner = ANIMALS.find(a => a.foods.includes(item.foodId));
                assert.ok(allowed.has(owner.biome), `level ${level}: distractor ${item.foodId}`);
            }
        }
        assert.equal(seen.size, animalPool(rounds).length, `level ${level}: every pooled animal shows up`);
    }
});

test('dinosaurs join the pool from level 21 and never before', () => {
    const dinos = ANIMALS.filter(a => a.biome === 'dinosaur').map(a => a.id);
    assert.ok(dinos.includes('trex') && dinos.includes('brontosaurus'));
    for (const level of [1, 10, 16, 20]) assert.ok(!animalPool(level - 1).some(a => dinos.includes(a.id)), `level ${level}`);
    for (const level of [21, 25, 60]) assert.ok(dinos.every(id => animalPool(level - 1).some(a => a.id === id)), `level ${level}`);
});

test('the unicorn is never in the regular pool and is a surprise only from level 6', () => {
    for (const level of [1, 5]) assert.equal(rareAnimalFor(level - 1), null, `level ${level}`);
    for (const level of [6, 7, 20, 99]) {
        const rare = rareAnimalFor(level - 1);
        assert.equal(rare.animal.id, 'unicorn');
        assert.equal(rare.chance, UNICORN_CHANCE);
        assert.ok(rare.chance > 0 && rare.chance <= 0.15, 'a small chance');
        assert.ok(!animalPool(level - 1).some(a => a.id === 'unicorn'), `level ${level}: not in pool`);
    }
    // rounds made without a `rare` option (and the default pool) never contain one
    for (let seed = 1; seed <= 300; seed++) assert.ok(!createRound(seededRng(seed), { animalCount: 3 }).animals.includes('unicorn'));
});

test('unicorns appear in roughly UNICORN_CHANCE of rounds, only once per round, and rounds stay winnable', () => {
    for (const rounds of [5, 30]) {
        const rng = seededRng(99);
        let withUnicorn = 0;
        const N = 4000;
        for (let i = 0; i < N; i++) {
            const round = createRound(rng, { ...nextDifficulty(rounds), pool: animalPool(rounds), rare: rareAnimalFor(rounds) });
            const count = round.animals.filter(id => id === 'unicorn').length;
            assert.ok(count <= 1);
            assert.equal(new Set(round.animals).size, round.animals.length);
            if (count) {
                withUnicorn++;
                assert.ok(round.items.some(i => !i.distractor && i.foodId === 'cupcake'), 'unicorn gets its cupcake');
            }
            for (const item of round.items.filter(i => !i.distractor)) {
                assert.ok(round.animals.some(id => animal(id).foods.includes(item.foodId)));
            }
        }
        const rate = withUnicorn / N;
        if (rareAnimalFor(rounds)) assert.ok(rate > 0.07 && rate < 0.13, `rate ${rate}`);
        else assert.equal(withUnicorn, 0);
    }
});
