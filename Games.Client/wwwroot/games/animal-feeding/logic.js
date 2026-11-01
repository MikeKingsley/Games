// Pure game rules for animal feeding. No DOM access so it can be tested in Node.
import { ANIMALS, BIOMES, UNICORN, animalById } from './data.js';

export const ITEMS_PER_ROUND = 3;
export const REWARD_EVERY = 3;
export const MAX_ANIMALS = 3;
export const TIMER_FROM_ROUND = 15; // rounds completed before the countdown starts (level 16 onwards)
export const TIMER_START_S = 30;
export const TIMER_MIN_S = 5;
export const UNICORN_FROM_LEVEL = 6; // unicorns can appear after level 5
export const UNICORN_CHANCE = 0.1; // per round
export const BITES_PER_FOOD = 3;
export const BITE_MS = 450;
const EAT_TOTAL_MS = BITES_PER_FOOD * BITE_MS;

/** Small deterministic RNG (mulberry32) for tests; the game passes Math.random. */
export function seededRng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle(list, rng) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

const setKey = ids => [...ids].sort().join('|');

/**
 * Difficulty ramps with the stars earned (one star per REWARD_EVERY rounds):
 *   first 3 rounds   2 animals, 3 foods
 *   0-2 stars        3 animals, 3 foods
 *   3-4 stars        3 animals, 4 foods
 *   5-7 stars        3 animals, 5 foods, 1 of them belongs to nobody (a distractor)
 *   8+ stars         3 animals, 6 foods, 2 distractors
 */
export function nextDifficulty(roundsCompleted) {
    const stars = Math.floor(roundsCompleted / REWARD_EVERY);
    if (roundsCompleted < REWARD_EVERY) return { animalCount: 2, itemCount: 3, distractors: 0 };
    if (stars < 3) return { animalCount: MAX_ANIMALS, itemCount: 3, distractors: 0 };
    if (stars < 5) return { animalCount: MAX_ANIMALS, itemCount: 4, distractors: 0 };
    if (stars < 8) return { animalCount: MAX_ANIMALS, itemCount: 5, distractors: 1 };
    return { animalCount: MAX_ANIMALS, itemCount: 6, distractors: 2 };
}

/** The level the player is on: rounds completed so far, plus the one in play. */
export function levelFor(roundsCompleted) {
    return roundsCompleted + 1;
}

/**
 * Seconds allowed for the round about to start, or null when there is no countdown yet.
 * Levels 1-15 are untimed; level 16 gets TIMER_START_S and each level after that takes one second less, never below TIMER_MIN_S.
 */
export function roundTimeSeconds(roundsCompleted) {
    if (roundsCompleted < TIMER_FROM_ROUND) return null;
    return Math.max(TIMER_MIN_S, TIMER_START_S - (roundsCompleted - TIMER_FROM_ROUND));
}

/**
 * The biomes whose animals can appear at this level: levels 1-5 farm only, 6-10 add woodland, 11-15 add the African
 * savannah, 16-20 add the ocean and from level 21 the dinosaurs join them. Unlocked biomes stay in the pool.
 */
export function unlockedBiomes(roundsCompleted) {
    const level = levelFor(roundsCompleted);
    const count = level <= 5 ? 1 : level <= 10 ? 2 : level <= 15 ? 3 : level <= 20 ? 4 : BIOMES.length;
    return BIOMES.slice(0, count);
}

/** Animals that may spawn at this level (see `unlockedBiomes`). Each round picks randomly from this pool. */
export function animalPool(roundsCompleted) {
    const biomes = unlockedBiomes(roundsCompleted);
    return ANIMALS.filter(a => biomes.includes(a.biome));
}

/**
 * The surprise animal for this level, with its per-round chance, or null before level 6. The unicorn is never in the
 * regular pool; `createRound` swaps it in for one of the chosen animals now and then.
 */
export function rareAnimalFor(roundsCompleted) {
    return levelFor(roundsCompleted) >= UNICORN_FROM_LEVEL ? { animal: UNICORN, chance: UNICORN_CHANCE } : null;
}

/** A star is awarded after every third completed round. */
export function shouldReward(roundsCompleted) {
    return roundsCompleted > 0 && roundsCompleted % REWARD_EVERY === 0;
}

/**
 * Builds a round: `animalCount` animals and `itemCount` food items, `distractors` of which belong to none of the
 * animals present. Every animal gets one of its foods; any other feedable item is a second helping for a random
 * present animal, so the round is always winnable. Distractors are distinct foods nobody present eats and are
 * flagged `distractor: true`. Animals are drawn at random from `pool` (default: every animal), and distractors are
 * foods of other animals in that pool. `rare` ({ animal, chance }) is a surprise animal that may replace one of the
 * chosen ones. The animal set never equals `previousAnimalIds` (before the surprise is swapped in).
 */
export function createRound(rng, { animalCount = 2, itemCount = ITEMS_PER_ROUND, distractors = 0, previousAnimalIds = [], pool = ANIMALS.filter(a => !a.rare), rare = null } = {}) {
    const count = Math.min(Math.max(animalCount, 1), MAX_ANIMALS, pool.length);
    const previous = setKey(previousAnimalIds);

    let chosen = shuffle(pool, rng).slice(0, count);
    for (let tries = 0; setKey(chosen.map(a => a.id)) === previous && tries < 20; tries++) {
        chosen = shuffle(pool, rng).slice(0, count);
    }
    if (setKey(chosen.map(a => a.id)) === previous) {
        // Pathological RNG: deterministically swap in an animal that was not in the previous round.
        const replacement = pool.find(a => !previousAnimalIds.includes(a.id));
        if (replacement) chosen = [...chosen.slice(0, count - 1), replacement];
    }

    if (rare && !chosen.some(a => a.id === rare.animal.id) && rng() < rare.chance) {
        // A surprise visitor takes the place of one of the chosen animals.
        const slot = Math.floor(rng() * chosen.length);
        chosen = chosen.map((a, i) => (i === slot ? rare.animal : a));
    }

    const eaten = new Set(chosen.flatMap(a => a.foods));
    const spare = shuffle([...new Set(pool.flatMap(a => a.foods))].filter(id => !eaten.has(id)), rng);
    const wanted = Math.min(Math.max(distractors, 0), spare.length, Math.max(itemCount - count, 0));

    const foodIds = chosen.map(a => a.foods[0]);
    while (foodIds.length < itemCount - wanted) {
        foodIds.push(chosen[Math.floor(rng() * chosen.length)].foods[0]);
    }

    const entries = [
        ...foodIds.map(foodId => ({ foodId, distractor: false })),
        ...spare.slice(0, wanted).map(foodId => ({ foodId, distractor: true })),
    ];

    return {
        animals: chosen.map(a => a.id),
        items: shuffle(entries, rng).map((entry, i) => ({ uid: `item${i}`, foodId: entry.foodId, fed: false, eatMs: 0, distractor: entry.distractor })),
    };
}

/** True when the item is still unfed, the animal is in the round, and the animal accepts that food. */
export function checkFeed(round, uid, animalId) {
    const item = round.items.find(i => i.uid === uid);
    if (!item || item.fed || !round.animals.includes(animalId)) return false;
    return animalById(animalId).foods.includes(item.foodId);
}

/** Feeds the item if the drop is correct. Returns whether it was correct. */
export function feed(round, uid, animalId) {
    if (!checkFeed(round, uid, animalId)) return false;
    const item = round.items.find(i => i.uid === uid);
    item.fed = true;
    item.eatMs = EAT_TOTAL_MS;
    return true;
}

/** How many bites have been taken out of an item so far (0..BITES_PER_FOOD). */
export function bitesTaken(item) {
    return Math.min(BITES_PER_FOOD, Math.floor((item.eatMs ?? 0) / BITE_MS));
}

/** Fraction of the item eaten (0..1). */
export function eatenFraction(item) {
    return Math.min(1, (item.eatMs ?? 0) / EAT_TOTAL_MS);
}

/**
 * The animal has been holding its food in its mouth for `ms` more milliseconds. Progress is kept if the food is
 * pulled away, so a half-eaten food stays half-eaten. Returns `{ ok, bites, done }`; `ok` is false for a wrong animal.
 */
export function eat(round, uid, animalId, ms) {
    if (!checkFeed(round, uid, animalId)) return { ok: false, bites: 0, done: false };
    const item = round.items.find(i => i.uid === uid);
    item.eatMs = Math.min(EAT_TOTAL_MS, (item.eatMs ?? 0) + ms);
    const done = item.eatMs >= EAT_TOTAL_MS;
    if (done) item.fed = true;
    return { ok: true, bites: bitesTaken(item), done };
}

/** A round is complete once every item that belongs to someone has been eaten; distractors stay in the tray. */
export function isRoundComplete(round) {
    return round.items.every(i => i.fed || i.distractor);
}
