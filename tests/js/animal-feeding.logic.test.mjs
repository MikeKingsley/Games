import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANIMALS, FOODS, WORLDS, acceptsFood } from '../../Games.Client/wwwroot/games/animal-feeding/data.js';
import {
    createRound, checkFeed, feed, eat, paletteFor, foodsEatenBy, isRoundComplete, nextDifficulty, starsForRound, starParMs, mistakeLimits, roundTimeSeconds, difficultyFor, animalsBounce, buyTimeBuff, wearBuff, seededRng, ITEMS_PER_ROUND, animalPool, unlockedBiomes, favouredAnimals, worldFor, isWorldChange, rareAnimalFor, UNICORN_CHANCE, loseStar,
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

test('stars: quick and careful earns three; slower earns fewer; too many wrong guesses earns none', () => {
    const base = { level: 1, animalCount: 2, mistakes: 0 };
    const par = starParMs(1, 2);
    assert.equal(starsForRound({ ...base, elapsedMs: par }), 3);
    assert.equal(starsForRound({ ...base, elapsedMs: par * 1.5 }), 2);
    assert.equal(starsForRound({ ...base, elapsedMs: par * 10 }), 1); // slowness alone never means none
    assert.equal(starsForRound({ ...base, mistakes: 1, elapsedMs: par }), 3);
    assert.equal(starsForRound({ ...base, mistakes: 3, elapsedMs: par }), 2);
    assert.equal(starsForRound({ ...base, mistakes: 5, elapsedMs: par }), 1);
    assert.equal(starsForRound({ ...base, mistakes: 6, elapsedMs: 1 }), 0);
});

test('stars get harder as the level rises: less time and fewer wrong guesses are allowed', () => {
    assert.ok(starParMs(100, 3) < starParMs(50, 3) && starParMs(50, 3) < starParMs(1, 3));
    assert.equal(starParMs(500, 3), starParMs(100, 3)); // targets stop tightening at level 100
    assert.deepEqual(mistakeLimits(1), { threeStars: 1, twoStars: 3, zeroAt: 6 });
    assert.deepEqual(mistakeLimits(100), { threeStars: 0, twoStars: 1, zeroAt: 3 });
    // the same performance rates lower later on
    const play = { animalCount: 3, mistakes: 1, elapsedMs: starParMs(100, 3) };
    assert.equal(starsForRound({ ...play, level: 1 }), 3);
    assert.equal(starsForRound({ ...play, level: 100 }), 2);
    assert.equal(starsForRound({ ...play, level: 100, mistakes: 3 }), 0);
});

test('on timed levels the three-star time never exceeds 80% of the countdown', () => {
    assert.equal(starParMs(100, 3, 5000), 4000);
    assert.equal(starParMs(1, 2, 60000), starParMs(1, 2));
});

test('holding food over the right animal takes bites and finishes after BITES_PER_FOOD * BITE_MS', async () => {
    const { eat, bitesTaken, eatenFraction, BITES_PER_FOOD, BITE_MS } = await import('../../Games.Client/wwwroot/games/animal-feeding/logic.js');
    const round = { animals: ['monkey', 'rabbit'], items: [{ uid: 'a', foodId: 'banana', fed: false, eatMs: 0 }, { uid: 'b', foodId: 'carrot', fed: false, eatMs: 0 }] };
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
    const round = { animals: ['monkey', 'rabbit'], items: [{ uid: 'a', foodId: 'banana', fed: false, eatMs: 0 }, { uid: 'b', foodId: 'carrot', fed: false, eatMs: 0 }] };
    assert.equal(eat(round, 'a', 'rabbit', 5000).ok, false);
    assert.equal(round.items[0].eatMs, 0);
    eat(round, 'a', 'monkey', BITE_MS * 2);
    eat(round, 'a', 'rabbit', 1000); // pulled over a wrong animal: no change
    assert.equal(bitesTaken(round.items[0]), 2);
});

test('feed() completes a partly eaten item', async () => {
    const { eat, feed, eatenFraction, BITE_MS } = await import('../../Games.Client/wwwroot/games/animal-feeding/logic.js');
    const round = { animals: ['monkey'], items: [{ uid: 'a', foodId: 'banana', fed: false, eatMs: 0 }, { uid: 'b', foodId: 'carrot', fed: false, eatMs: 0 }] };
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
            const everythingEater = round.animals.some(id => animal(id).eatsAnything);
            assert.equal(distractors.length, everythingEater ? 0 : difficulty.distractors, 'a pig eats anything, so no distractors then');
            assert.equal(new Set(distractors.map(d => d.foodId)).size, distractors.length, 'distractors are distinct');
            for (const item of round.items) {
                const eaters = round.animals.filter(id => acceptsFood(animal(id), item.foodId));
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

test('levels 1-15 are untimed; level 16 gets 30s, shrinking evenly to 5s at level 100', async () => {
    const { levelFor } = await import('../../Games.Client/wwwroot/games/animal-feeding/logic.js');
    assert.equal(levelFor(0), 1);
    assert.equal(levelFor(15), 16);
    for (let rounds = 0; rounds < 15; rounds++) assert.equal(roundTimeSeconds(rounds), null, `level ${levelFor(rounds)}`);
    assert.equal(roundTimeSeconds(15), 30); // level 16
    assert.equal(roundTimeSeconds(25), 28); // level 26
    assert.equal(roundTimeSeconds(40), 23); // level 41, no longer the minimum
    assert.equal(roundTimeSeconds(60), 17);
    assert.equal(roundTimeSeconds(98), 6); // level 99
    assert.equal(roundTimeSeconds(99), 5); // level 100 is the first level at the minimum
    assert.equal(roundTimeSeconds(500), 5);
    for (let r = 15; r < 98; r++) assert.ok(roundTimeSeconds(r) > 5, `level ${r + 1} is above the minimum`);
    for (let r = 15; r < 200; r++) assert.ok(roundTimeSeconds(r + 1) <= roundTimeSeconds(r), 'never gets longer');
});

test('every biome has enough animals, and every animal has a valid palette with a unique favourite', () => {
    for (const biome of ['farm', 'woodland', 'savanna', 'ocean', 'dinosaur']) {
        assert.ok(ANIMALS.filter(a => a.biome === biome).length >= 5, biome);
    }
    const favourites = ANIMALS.map(a => a.foods[0]);
    assert.equal(new Set(favourites).size, favourites.length, 'favourites are unique');
    for (const a of ANIMALS) {
        assert.ok(a.foods.length >= 2, `${a.id} has a palette`);
        assert.equal(new Set(a.foods).size, a.foods.length, `${a.id}: no duplicate foods`);
        for (const f of a.foods) assert.ok(FOODS[f], `${a.id} -> ${f}`);
    }
    assert.equal(new Set(ANIMALS.map(a => a.id)).size, ANIMALS.length);
});

test('biomes unlock by level: 1-5 farm, 6-10 +woodland, 11-15 +savanna, 16+ +ocean', () => {
    const at = level => unlockedBiomes(level - 1);
    for (const level of [1, 3, 5]) assert.deepEqual(at(level), ['farm'], `level ${level}`);
    for (const level of [6, 8, 10]) assert.deepEqual(at(level), ['farm', 'woodland'], `level ${level}`);
    for (const level of [11, 13, 15]) assert.deepEqual(at(level), ['farm', 'woodland', 'savanna'], `level ${level}`);
    for (const level of [16, 18, 20]) assert.deepEqual(at(level), ['farm', 'woodland', 'savanna', 'ocean'], `level ${level}`);
    for (const level of [21, 22, 30]) assert.deepEqual(at(level), ['farm', 'woodland', 'savanna', 'ocean', 'dinosaur'], `level ${level}`);
    assert.equal(at(31).length, 6);
    assert.equal(at(100).length, 12);
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
                assert.ok(round.items.some(i => !i.distractor && animal('unicorn').foods.includes(i.foodId)), 'unicorn is dealt something from its palette');
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

test('running out of time costs one star but never goes below zero', () => {
    assert.equal(loseStar(8), 7);
    assert.equal(loseStar(1), 0);
    assert.equal(loseStar(0), 0);
});

test('palettes: an apple suits a horse (and a pig), but not a lion', () => {
    assert.equal(acceptsFood(animal('horse'), 'apple'), true);
    assert.equal(acceptsFood(animal('horse'), 'hay'), true);
    assert.equal(acceptsFood(animal('pig'), 'apple'), true);
    assert.equal(acceptsFood(animal('lion'), 'apple'), false);
    assert.equal(acceptsFood(animal('lion'), 'meat'), true);
    const round = { animals: ['horse', 'pig'], items: [{ uid: 'a', foodId: 'apple', fed: false, eatMs: 0 }, { uid: 'b', foodId: 'hay', fed: false, eatMs: 0 }] };
    assert.equal(checkFeed(round, 'a', 'horse'), true);
    assert.equal(checkFeed(round, 'a', 'pig'), true);
});

test('pigs eat everything: any food, including ones no pig palette lists', () => {
    for (const foodId of Object.keys(FOODS)) assert.equal(acceptsFood(animal('pig'), foodId), true, foodId);
    const round = { animals: ['pig', 'cow'], items: [{ uid: 'a', foodId: 'seaweed', fed: false, eatMs: 0 }, { uid: 'b', foodId: 'grass', fed: false, eatMs: 0 }] };
    assert.equal(checkFeed(round, 'a', 'pig'), true);
    assert.equal(checkFeed(round, 'a', 'cow'), false);
    assert.ok(Object.values(ANIMALS).filter(a => a.eatsAnything).map(a => a.id).join() === 'pig', 'only the pig is an everything-eater');
});

test('animals are dealt a variety of foods from their palette, and some foods suit more than one animal in the round', () => {
    const rng = seededRng(5);
    const horseFoods = new Set();
    let shared = 0;
    for (let i = 0; i < 600; i++) {
        const round = createRound(rng, { animalCount: 3, pool: ANIMALS.filter(a => a.biome === 'farm') });
        for (const item of round.items) {
            if (round.animals.includes('horse')) horseFoods.add(item.foodId);
            if (round.animals.filter(id => acceptsFood(animal(id), item.foodId)).length > 1) shared++;
        }
    }
    assert.ok(horseFoods.size > 3, 'varied foods');
    assert.ok(shared > 0, 'some foods suit more than one animal');
});

test('worldFor follows the level blocks and stays on the last world past level 100', () => {
    const expected = { 1: 'farm', 5: 'farm', 6: 'woodland', 10: 'woodland', 11: 'savanna', 15: 'savanna', 16: 'ocean', 20: 'ocean', 21: 'dinosaur', 30: 'dinosaur', 31: 'enchanted', 40: 'enchanted', 41: 'crystal', 91: 'rainbow', 100: 'rainbow', 101: 'rainbow', 250: 'rainbow' };
    for (const [level, id] of Object.entries(expected)) assert.equal(worldFor(Number(level) - 1).id, id, `level ${level}`);
});

test('isWorldChange is true exactly when a finished round crosses a world boundary', () => {
    const changes = [];
    for (let rounds = 0; rounds < 120; rounds++) if (isWorldChange(rounds, rounds + 1)) changes.push(rounds + 2);
    assert.deepEqual(changes, [6, 11, 16, 21, 31, 41, 51, 61, 71, 81, 91]);
});

test('a favoured group supplies at least two of three animals, rounds stay winnable and never repeat', () => {
    const pool = ANIMALS.filter(a => !a.rare);
    const favoured = pool.filter(a => a.biome === 'ocean');
    const rng = seededRng(7);
    let previous = [];
    for (let i = 0; i < 300; i++) {
        const round = createRound(rng, { animalCount: 3, itemCount: 4, pool, favoured, previousAnimalIds: previous });
        assert.ok(round.animals.filter(id => animal(id).biome === 'ocean').length >= 2);
        assert.equal(new Set(round.animals).size, 3);
        assert.notEqual([...round.animals].sort().join(), [...previous].sort().join());
        for (const item of round.items) assert.ok(round.animals.some(id => acceptsFood(animal(id), item.foodId)));
        previous = round.animals;
    }
});

test('each mythical world has exactly 4 animals, 28 in all, and there are 58 regular animals', () => {
    const mythical = WORLDS.filter(w => w.mythical);
    assert.equal(mythical.length, 7);
    for (const w of mythical) assert.equal(ANIMALS.filter(a => a.biome === w.id).length, 4, w.id);
    assert.equal(ANIMALS.filter(a => !a.rare).length, 58);
    assert.equal(new Set(ANIMALS.map(a => a.id)).size, ANIMALS.length);
    assert.equal(new Set(ANIMALS.filter(a => !a.rare).map(a => a.foods[0])).size, 58, 'favourites are unique');
});

test('every animal has 2-4 foods and every animal and food has a plain speakable name', () => {
    for (const a of ANIMALS) {
        assert.ok(a.foods.length >= 2 && a.foods.length <= 4, a.id);
        assert.match(a.name, /^[A-Za-z -]+$/, a.id);
    }
    for (const f of Object.values(FOODS)) assert.match(f.name, /^[A-Za-z -]+$/, f.id);
});

test('in mythical worlds at least two of three animals live in the current world (level 35)', () => {
    const rounds = 34;
    const world = worldFor(rounds).id;
    assert.equal(world, 'enchanted');
    const rng = seededRng(11);
    let previous = [];
    for (let i = 0; i < 300; i++) {
        const round = createRound(rng, { ...nextDifficulty(rounds + 30), previousAnimalIds: previous, pool: animalPool(rounds), rare: rareAnimalFor(rounds), favoured: favouredAnimals(rounds) });
        const home = round.animals.filter(id => animal(id).biome === 'enchanted').length;
        // The unicorn surprise may replace one animal, so two at home is only guaranteed without it.
        assert.ok(home >= (round.animals.includes('unicorn') ? 1 : 2), `seed round ${i}`);
        for (const item of round.items.filter(it => !it.distractor)) assert.ok(round.animals.some(id => acceptsFood(animal(id), item.foodId)));
        previous = round.animals;
    }
});

test('rounds are winnable and never repeat across levels 1-120', () => {
    for (let seed = 1; seed <= 50; seed++) {
        const rng = seededRng(seed);
        let previous = [];
        for (let rounds = 0; rounds < 120; rounds++) {
            const round = createRound(rng, { ...nextDifficulty(rounds), previousAnimalIds: previous, pool: animalPool(rounds), rare: rareAnimalFor(rounds), favoured: favouredAnimals(rounds) });
            for (const item of round.items.filter(it => !it.distractor)) assert.ok(round.animals.some(id => acceptsFood(animal(id), item.foodId)), `seed ${seed} rounds ${rounds}`);
            assert.notEqual([...round.animals].sort().join(), [...previous].sort().join());
            previous = round.animals;
        }
    }
});

test('a pig cannot swallow everything: the other animals must each eat something before the round is complete', () => {
    const round = {
        animals: ['pig', 'cow', 'dog'],
        items: [
            { uid: 'a', foodId: 'apple', fed: false, eatMs: 0 },
            { uid: 'b', foodId: 'grass', fed: false, eatMs: 0 },
            { uid: 'c', foodId: 'bone', fed: false, eatMs: 0 },
        ],
    };
    // The pig may take the apple, but not the grass (the cow needs it) or the bone (the dog needs it).
    assert.equal(checkFeed(round, 'b', 'pig'), false);
    assert.equal(checkFeed(round, 'c', 'pig'), false);
    assert.equal(feed(round, 'b', 'pig'), false);
    assert.equal(checkFeed(round, 'a', 'pig'), true);
    assert.equal(feed(round, 'a', 'pig'), true);
    assert.equal(isRoundComplete(round), false);
    assert.equal(feed(round, 'b', 'cow'), true);
    assert.equal(isRoundComplete(round), false);
    assert.equal(feed(round, 'c', 'dog'), true);
    assert.equal(isRoundComplete(round), true);
});

test('with a spare food the pig may eat two, but never so that someone is left hungry', () => {
    const round = {
        animals: ['pig', 'cow'],
        items: [
            { uid: 'a', foodId: 'apple', fed: false, eatMs: 0 },
            { uid: 'b', foodId: 'corn', fed: false, eatMs: 0 },
            { uid: 'c', foodId: 'grass', fed: false, eatMs: 0 },
        ],
    };
    assert.equal(feed(round, 'a', 'pig'), true);
    assert.equal(checkFeed(round, 'b', 'pig'), true); // grass still left for the cow
    assert.equal(feed(round, 'b', 'pig'), true);
    assert.equal(checkFeed(round, 'c', 'pig'), false); // now the cow would have nothing
    assert.equal(eat(round, 'c', 'pig', 5000).ok, false);
    assert.equal(feed(round, 'c', 'cow'), true);
    assert.equal(isRoundComplete(round), true);
});

test('random legal play always finishes every generated round (never stuck, everyone eats)', () => {
    for (let seed = 1; seed <= 200; seed++) {
        const rng = seededRng(seed);
        for (const rounds of [0, 4, 10, 20, 40, 80]) {
            const round = createRound(rng, { ...nextDifficulty(rounds), pool: animalPool(rounds), rare: rareAnimalFor(rounds), favoured: favouredAnimals(rounds) });
            for (let steps = 0; steps < 20 && !isRoundComplete(round); steps++) {
                const moves = round.items.flatMap(i => round.animals.map(id => [i.uid, id])).filter(([uid, id]) => checkFeed(round, uid, id));
                assert.ok(moves.length > 0, `stuck, seed ${seed} rounds ${rounds}`);
                const [uid, id] = moves[Math.floor(rng() * moves.length)];
                assert.equal(feed(round, uid, id), true);
            }
            assert.equal(isRoundComplete(round), true, `seed ${seed} rounds ${rounds}`);
            assert.equal(new Set(round.items.filter(i => i.fedBy).map(i => i.fedBy)).size, round.animals.length, 'everyone ate');
        }
    }
});

test('a round is complete once every animal has eaten ONE piece; spare foods are not needed', () => {
    const round = {
        animals: ['cow', 'dog', 'cat'],
        items: [
            { uid: 'a', foodId: 'grass', fed: false, eatMs: 0 },
            { uid: 'b', foodId: 'bone', fed: false, eatMs: 0 },
            { uid: 'c', foodId: 'milk', fed: false, eatMs: 0 },
            { uid: 'd', foodId: 'hay', fed: false, eatMs: 0 },
            { uid: 'e', foodId: 'meat', fed: false, eatMs: 0 },
        ],
    };
    feed(round, 'a', 'cow');
    feed(round, 'b', 'dog');
    assert.equal(isRoundComplete(round), false); // the cat is still hungry
    feed(round, 'c', 'cat');
    assert.equal(isRoundComplete(round), true); // hay and meat are left over
    assert.deepEqual(['cow', 'dog', 'cat'].map(id => foodsEatenBy(round, id)), [1, 1, 1]);
    assert.equal(round.items.filter(i => !i.fed).length, 2);
});

test('foodsEatenBy counts whole pieces per animal', () => {
    const round = { animals: ['pig', 'cow'], items: [
        { uid: 'a', foodId: 'apple', fed: false, eatMs: 0 },
        { uid: 'b', foodId: 'corn', fed: false, eatMs: 0 },
        { uid: 'c', foodId: 'grass', fed: false, eatMs: 0 },
    ] };
    feed(round, 'a', 'pig');
    feed(round, 'b', 'pig');
    assert.equal(foodsEatenBy(round, 'pig'), 2);
    assert.equal(foodsEatenBy(round, 'cow'), 0);
    assert.equal(isRoundComplete(round), false);
});

test('paletteFor lists only foods in the tray, and fades a food that is another animal\'s only option', () => {
    // whale eats shrimp/squid, dolphin eats fish/tropicalfish/squid/shrimp: the only shrimp is all the whale has
    const round = {
        animals: ['whale', 'dolphin'],
        items: [
            { uid: 'a', foodId: 'shrimp', fed: false, eatMs: 0 },
            { uid: 'b', foodId: 'tropicalfish', fed: false, eatMs: 0 },
        ],
    };
    assert.deepEqual(paletteFor(round, 'whale'), [{ foodId: 'shrimp', available: true }]);
    assert.deepEqual(paletteFor(round, 'dolphin'), [
        { foodId: 'tropicalfish', available: true },
        { foodId: 'shrimp', available: false },
    ]);

    // a second shrimp frees it up for the dolphin
    round.items.push({ uid: 'c', foodId: 'shrimp', fed: false, eatMs: 0 });
    assert.equal(paletteFor(round, 'dolphin').find(e => e.foodId === 'shrimp').available, true);

    // eaten food leaves the palette
    round.items[1].fed = true;
    round.items[1].fedBy = 'dolphin';
    assert.ok(!paletteFor(round, 'dolphin').some(e => e.foodId === 'tropicalfish'));
});

test('paletteFor for a pig lists the tray foods, fading the one the whale needs', () => {
    const round = {
        animals: ['pig', 'whale'],
        items: [{ uid: 'a', foodId: 'shrimp', fed: false, eatMs: 0 }, { uid: 'b', foodId: 'apple', fed: false, eatMs: 0 }],
    };
    assert.deepEqual(paletteFor(round, 'pig'), [{ foodId: 'shrimp', available: false }, { foodId: 'apple', available: true }]);
    assert.deepEqual(paletteFor(round, 'whale'), [{ foodId: 'shrimp', available: true }]);
});

test('Hardcore Mode times every level: 15s at level 1 shrinking to 5s at level 100', () => {
    assert.equal(roundTimeSeconds(0, true), 15);
    assert.equal(roundTimeSeconds(99, true), 5);
    assert.equal(roundTimeSeconds(500, true), 5);
    for (let rounds = 1; rounds < 100; rounds++) assert.ok(roundTimeSeconds(rounds, true) <= roundTimeSeconds(rounds - 1, true));
    assert.equal(roundTimeSeconds(5), null); // normal mode is unchanged
});

test('Hardcore Mode gives each animal beyond three a few extra seconds', () => {
    assert.equal(roundTimeSeconds(0, true, 3), 15);
    assert.equal(roundTimeSeconds(99, true, 5), 5 + 2 * 3);
    assert.equal(roundTimeSeconds(20, false, 5), roundTimeSeconds(20)); // normal mode ignores the animal count
});

test('Hardcore Mode deals 3-5 animals from level 11, with more foods than animals', () => {
    for (let rounds = 0; rounds < 10; rounds++) assert.equal(difficultyFor(rounds, true).animalCount, nextDifficultyAnimals(rounds));
    const seen = new Set();
    for (const r of [0, 0.34, 0.67, 0.99]) {
        const d = difficultyFor(10, true, () => r);
        seen.add(d.animalCount);
        assert.ok(d.animalCount >= 3 && d.animalCount <= 5);
        assert.ok(d.itemCount > d.animalCount);
        assert.equal(d.maxAnimals, 5);
    }
    assert.deepEqual([...seen].sort(), [3, 4, 5]);
    assert.equal(difficultyFor(50, false).maxAnimals, 3); // normal mode never has more than three
    assert.equal(difficultyFor(50, false).animalCount, 3);
});

test('createRound can deal up to maxAnimals distinct animals, all feedable', () => {
    for (let seed = 1; seed <= 20; seed++) {
        const round = createRound(seededRng(seed), { ...difficultyFor(40, true, () => 0.99), pool: ANIMALS.filter(a => !a.rare) });
        assert.equal(round.animals.length, 5);
        assert.equal(new Set(round.animals).size, 5);
        assert.ok(round.items.length >= 6);
    }
});

test('animals bounce only in Hardcore Mode, after level 100', () => {
    assert.equal(animalsBounce(99, true), false); // level 100
    assert.equal(animalsBounce(100, true), true); // level 101
    assert.equal(animalsBounce(100, false), false);
});

const nextDifficultyAnimals = rounds => (rounds < 3 ? 2 : 3);

test('5 stars buy +1s of countdown time; fewer stars buy nothing', () => {
    assert.deepEqual(buyTimeBuff(5, 0), { stars: 0, buff: 1 });
    assert.deepEqual(buyTimeBuff(12, 2.5), { stars: 7, buff: 3.5 });
    assert.equal(buyTimeBuff(4, 0), null);
    assert.equal(buyTimeBuff(0, 3), null);
});

test('running out of time wears the buff down 0.5s at a time, never below zero', () => {
    assert.equal(wearBuff(3), 2.5);
    assert.equal(wearBuff(0.5), 0);
    assert.equal(wearBuff(0.25), 0);
    assert.equal(wearBuff(0), 0);
});
