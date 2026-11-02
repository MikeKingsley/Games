// Pure game rules for animal feeding. No DOM access so it can be tested in Node.
import { ANIMALS, WORLDS, UNICORN, animalById, acceptsFood } from './data.js';

export const ITEMS_PER_ROUND = 3;
export const REWARD_EVERY = 3;
export const MAX_ANIMALS = 3;
export const TIMER_FROM_ROUND = 15; // rounds completed before the countdown starts (level 16 onwards)
export const TIMER_START_S = 30;
export const TIMER_MIN_S = 5;
export const HARDCORE_START_S = 15; // Hardcore Mode: the allowance at level 1 (it shrinks to TIMER_MIN_S at TIMER_MIN_AT_LEVEL)
export const HARDCORE_EXTRA_ANIMAL_S = 3; // Hardcore Mode: extra seconds for each animal beyond the usual three, so a crowded round stays possible
export const HARDCORE_MAX_ANIMALS = 5;
export const HARDCORE_CROWD_FROM_LEVEL = 11; // Hardcore Mode: from here every round has 3-5 animals
export const HARDCORE_BOUNCE_FROM_LEVEL = 101; // Hardcore Mode: from here the animals bounce around the screen
export const TIMER_MIN_AT_LEVEL = 100; // the countdown shrinks evenly from TIMER_START_S at level 16 to TIMER_MIN_S here
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
 * Levels 1-15 are untimed; level 16 gets TIMER_START_S and the allowance shrinks evenly (about 0.3s a level, rounded up to
 * whole seconds) until it reaches TIMER_MIN_S at level TIMER_MIN_AT_LEVEL, where it stays. In Hardcore Mode every level is
 * timed: level 1 gets HARDCORE_START_S and the allowance shrinks evenly to TIMER_MIN_S at level TIMER_MIN_AT_LEVEL, plus
 * HARDCORE_EXTRA_ANIMAL_S for each animal beyond three.
 */
export function roundTimeSeconds(roundsCompleted, hardcore = false, animalCount = MAX_ANIMALS) {
    if (hardcore) {
        // Hardcore Mode: every level is timed, from HARDCORE_START_S at level 1 down to TIMER_MIN_S at level TIMER_MIN_AT_LEVEL.
        const span = TIMER_MIN_AT_LEVEL - 1;
        const base = Math.max(TIMER_MIN_S, Math.ceil(HARDCORE_START_S - roundsCompleted * (HARDCORE_START_S - TIMER_MIN_S) / span));
        return base + Math.max(0, animalCount - MAX_ANIMALS) * HARDCORE_EXTRA_ANIMAL_S;
    }
    if (roundsCompleted < TIMER_FROM_ROUND) return null;
    const levelsIn = roundsCompleted - TIMER_FROM_ROUND;
    const span = TIMER_MIN_AT_LEVEL - (TIMER_FROM_ROUND + 1);
    return Math.max(TIMER_MIN_S, Math.ceil(TIMER_START_S - levelsIn * (TIMER_START_S - TIMER_MIN_S) / span));
}

/**
 * What the round about to start is made of: `nextDifficulty`, except that Hardcore Mode from level HARDCORE_CROWD_FROM_LEVEL
 * deals 3-5 animals at random (with at least one food more than there are animals). `maxAnimals` is what `createRound` may deal.
 */
export function difficultyFor(roundsCompleted, hardcore = false, rng = Math.random) {
    const difficulty = { ...nextDifficulty(roundsCompleted), maxAnimals: MAX_ANIMALS };
    if (hardcore && levelFor(roundsCompleted) >= HARDCORE_CROWD_FROM_LEVEL) {
        difficulty.animalCount = MAX_ANIMALS + Math.floor(rng() * (HARDCORE_MAX_ANIMALS - MAX_ANIMALS + 1));
        difficulty.itemCount = Math.max(difficulty.itemCount, difficulty.animalCount + 1);
        difficulty.maxAnimals = HARDCORE_MAX_ANIMALS;
    }
    return difficulty;
}

/** In Hardcore Mode past level 100 the animals bounce around the screen. */
export function animalsBounce(roundsCompleted, hardcore) {
    return hardcore && levelFor(roundsCompleted) >= HARDCORE_BOUNCE_FROM_LEVEL;
}

/** The world (background and home of the newest animals) for this level; past level 100 the last world stays. */
export function worldFor(roundsCompleted) {
    const level = levelFor(roundsCompleted);
    return WORLDS.findLast(w => w.fromLevel <= level);
}

/** True when finishing a round takes the player into a different world. */
export function isWorldChange(roundsBefore, roundsAfter) {
    return worldFor(roundsBefore).id !== worldFor(roundsAfter).id;
}

/**
 * The worlds whose animals can appear at this level: levels 1-5 farm only, 6-10 add woodland, 11-15 the African
 * savannah, 16-20 the ocean, 21-30 the dinosaurs, then a new mythical world every 10 levels. Unlocked worlds stay in the pool.
 */
export function unlockedBiomes(roundsCompleted) {
    const level = levelFor(roundsCompleted);
    return WORLDS.filter(w => w.fromLevel <= level).map(w => w.id);
}

/** Animals that may spawn at this level (see `unlockedBiomes`). Each round picks randomly from this pool. */
export function animalPool(roundsCompleted) {
    const biomes = unlockedBiomes(roundsCompleted);
    return ANIMALS.filter(a => biomes.includes(a.biome));
}

/** The animals that live in the current world, favoured in mythical worlds; null in the earlier, evenly drawn worlds. */
export function favouredAnimals(roundsCompleted) {
    const world = worldFor(roundsCompleted);
    return world.mythical ? ANIMALS.filter(a => a.biome === world.id) : null;
}

/**
 * The surprise animal for this level, with its per-round chance, or null before level 6. The unicorn is never in the
 * regular pool; `createRound` swaps it in for one of the chosen animals now and then.
 */
export function rareAnimalFor(roundsCompleted) {
    return levelFor(roundsCompleted) >= UNICORN_FROM_LEVEL ? { animal: UNICORN, chance: UNICORN_CHANCE } : null;
}

export const STARS_PER_BUFF = 5; // stars spent on one time buff
export const BUFF_SECONDS = 1; // countdown seconds one purchase adds
export const BUFF_LOSS_SECONDS = 0.5; // the buff that wears off each time the countdown runs out

/** Spends STARS_PER_BUFF stars for BUFF_SECONDS more countdown time; null when there aren't enough stars. */
export function buyTimeBuff(stars, buff) {
    return stars >= STARS_PER_BUFF ? { stars: stars - STARS_PER_BUFF, buff: buff + BUFF_SECONDS } : null;
}

/** Running out of time wears the time buff down by BUFF_LOSS_SECONDS (never below zero). */
export function wearBuff(buff) {
    return Math.max(0, buff - BUFF_LOSS_SECONDS);
}

/** Running out of time costs one star (a life), but never takes her below zero. */
export function loseStar(stars) {
    return Math.max(0, stars - 1);
}

export const MAX_STARS_PER_ROUND = 3;
export const STAR_LAST_LEVEL = 100; // the star targets stop tightening here
const THINK_MS_EASY = 6000; // per animal, at level 1: time to look, pick and drag on top of the eating itself
const THINK_MS_HARD = 1500; // per animal, at STAR_LAST_LEVEL
const SLOW_FACTOR = 1.75; // finishing within this many times the par time still earns two stars

/** 0 (level 1) .. 1 (STAR_LAST_LEVEL): how far up the star targets have tightened. */
const hardness = level => (Math.min(Math.max(level, 1), STAR_LAST_LEVEL) - 1) / (STAR_LAST_LEVEL - 1);

/**
 * The time a round may take and still earn three stars: per animal, the unavoidable eating time plus some thinking time
 * that shrinks from 6s (level 1) to 1.5s (level 100). On timed levels it never exceeds 80% of the countdown.
 */
export function starParMs(level, animalCount, timeLimitMs = null) {
    const think = THINK_MS_EASY - hardness(level) * (THINK_MS_EASY - THINK_MS_HARD);
    const par = Math.round(animalCount * (EAT_TOTAL_MS + think));
    return timeLimitMs ? Math.min(par, Math.round(timeLimitMs * 0.8)) : par;
}

/**
 * How many wrong guesses a round tolerates at this level: up to `threeStars` still allows three stars, up to `twoStars`
 * two, anything below `zeroAt` one, and `zeroAt` or more earns none. Forgiving at level 1 (1 / 3 / 6), strict by level 100 (0 / 1 / 3).
 */
export function mistakeLimits(level) {
    const zeroAt = Math.round(6 - hardness(level) * 3);
    const threeStars = level <= 10 ? 1 : 0;
    return { threeStars, twoStars: Math.max(threeStars, Math.floor(zeroAt / 2)), zeroAt };
}

/**
 * Stars (0-3) for a finished round: the lower of a speed rating (quick = 3, within 1.75x par = 2, slower = 1; slowness
 * alone never means none) and a wrong-guess rating (see `mistakeLimits`). Both targets tighten as the level rises.
 */
export function starsForRound({ level, animalCount, mistakes, elapsedMs, timeLimitMs = null }) {
    const par = starParMs(level, animalCount, timeLimitMs);
    const speed = elapsedMs <= par ? 3 : elapsedMs <= par * SLOW_FACTOR ? 2 : 1;
    const limits = mistakeLimits(level);
    const care = mistakes >= limits.zeroAt ? 0 : mistakes <= limits.threeStars ? 3 : mistakes <= limits.twoStars ? 2 : 1;
    return Math.min(speed, care);
}

/**
 * Builds a round: `animalCount` animals and `itemCount` food items, `distractors` of which belong to none of the
 * animals present. Every animal is dealt a random food from its palette; any other feedable item is a further food from
 * a random present animal's palette, so the round is always winnable (a food may suit more than one animal). Distractors are distinct foods nobody present eats and are
 * flagged `distractor: true`. Animals are drawn at random from `pool` (default: every animal), and distractors are
 * foods of other animals in that pool. `rare` ({ animal, chance }) is a surprise animal that may replace one of the
 * chosen ones. `favoured` (animals of the current world) makes at least `favouredMin` of a three-animal round come from
 * that group. The animal set never equals `previousAnimalIds` (the surprise is skipped if it would make it equal).
 */
export function createRound(rng, { animalCount = 2, itemCount = ITEMS_PER_ROUND, distractors = 0, maxAnimals = MAX_ANIMALS, previousAnimalIds = [], pool = ANIMALS.filter(a => !a.rare), rare = null, favoured = null, favouredMin = 2 } = {}) {
    const count = Math.min(Math.max(animalCount, 1), maxAnimals, pool.length);
    const previous = setKey(previousAnimalIds);

    // With a favoured group (a mythical world's own creatures) at least `favouredMin` of three come from it.
    const home = favoured ? pool.filter(a => favoured.some(f => f.id === a.id)) : [];
    const guaranteed = count >= MAX_ANIMALS ? Math.min(favouredMin, home.length) : 0;
    const draw = () => {
        if (guaranteed === 0) return shuffle(pool, rng).slice(0, count);
        const first = shuffle(home, rng).slice(0, guaranteed);
        const rest = shuffle(pool.filter(a => !first.includes(a)), rng).slice(0, count - guaranteed);
        return shuffle([...first, ...rest], rng);
    };

    let chosen = draw();
    for (let tries = 0; setKey(chosen.map(a => a.id)) === previous && tries < 20; tries++) {
        chosen = draw();
    }
    if (setKey(chosen.map(a => a.id)) === previous) {
        // Pathological RNG: deterministically swap in an animal that was not in the previous round.
        const replacement = pool.find(a => !previousAnimalIds.includes(a.id));
        if (replacement) chosen = [...chosen.slice(0, count - 1), replacement];
    }

    if (rare && !chosen.some(a => a.id === rare.animal.id) && rng() < rare.chance) {
        // A surprise visitor takes the place of one of the chosen animals.
        const slot = Math.floor(rng() * chosen.length);
        const visited = chosen.map((a, i) => (i === slot ? rare.animal : a));
        if (setKey(visited.map(a => a.id)) !== previous) chosen = visited; // never repeat the previous set, even with the surprise
    }

    // A distractor is a food nobody present would eat. If an animal that eats anything is present there is no such food.
    const eaten = new Set(chosen.flatMap(a => a.foods));
    const spare = chosen.some(a => a.eatsAnything)
        ? []
        : shuffle([...new Set(pool.flatMap(a => a.foods))].filter(id => !eaten.has(id)), rng);
    const wanted = Math.min(Math.max(distractors, 0), spare.length, Math.max(itemCount - count, 0));

    const pick = a => a.foods[Math.floor(rng() * a.foods.length)];
    const foodIds = chosen.map(pick);
    while (foodIds.length < itemCount - wanted) {
        foodIds.push(pick(chosen[Math.floor(rng() * chosen.length)]));
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

/** Animals in the round that have eaten at least one whole item. */
function fedAnimals(round) {
    return new Set(round.items.filter(i => i.fed && i.fedBy).map(i => i.fedBy));
}

/**
 * Could every animal that is still hungry (has eaten nothing yet) still get a different remaining item of its own after
 * `animalId` eats `uid`? Without this check an animal that eats anything (the pig) could swallow the whole tray and leave
 * the others with nothing, so the round could never be finished fairly.
 */
function everyoneCanStillEat(round, uid, animalId) {
    const hungry = round.animals.filter(id => id !== animalId && !fedAnimals(round).has(id));
    const items = round.items.filter(i => !i.fed && !i.distractor && i.uid !== uid);
    const owner = new Map(); // item uid -> hungry animal currently assigned to it
    const assign = (id, seen) => {
        for (const item of items) {
            if (seen.has(item.uid) || !acceptsFood(animalById(id), item.foodId)) continue;
            seen.add(item.uid);
            if (!owner.has(item.uid) || assign(owner.get(item.uid), seen)) { owner.set(item.uid, id); return true; }
        }
        return false;
    };
    return hungry.every(id => assign(id, new Set()));
}

/**
 * True when the item is still unfed, the animal is in the round, accepts that food, and eating it would not leave
 * another animal in the round with nothing to eat.
 */
export function checkFeed(round, uid, animalId) {
    const item = round.items.find(i => i.uid === uid);
    if (!item || item.fed || !round.animals.includes(animalId)) return false;
    return acceptsFood(animalById(animalId), item.foodId) && everyoneCanStillEat(round, uid, animalId);
}

/** Feeds the item if the drop is correct. Returns whether it was correct. */
export function feed(round, uid, animalId) {
    if (!checkFeed(round, uid, animalId)) return false;
    const item = round.items.find(i => i.uid === uid);
    item.fed = true;
    item.fedBy = animalId;
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
    if (done) { item.fed = true; item.fedBy = animalId; }
    return { ok: true, bites: bitesTaken(item), done };
}

/**
 * A round is complete as soon as every animal in it has eaten one piece of food; any food left in the tray (spare foods
 * and distractors) just fades away. (Rounds built by hand without `fedBy` fall back to "all food eaten".)
 */
export function isRoundComplete(round) {
    const fed = fedAnimals(round);
    if (fed.size === 0) return round.items.every(i => i.fed || i.distractor);
    return round.animals.every(id => fed.has(id));
}

/** How many whole pieces of food this animal has eaten so far in the round. */
export function foodsEatenBy(round, animalId) {
    return round.items.filter(i => i.fed && i.fedBy === animalId).length;
}

/**
 * What the animal could be fed from the tray right now, for the "show foods" hint under it: one entry per kind of food
 * still in the tray that the animal accepts (its own palette order; tray order for an animal that eats anything).
 * `available` is false when feeding it would leave another animal with nothing to eat, so that food is faded for this animal.
 */
export function paletteFor(round, animalId) {
    const animal = animalById(animalId);
    const open = round.items.filter(i => !i.fed && !i.distractor);
    const inTray = [...new Set(open.map(i => i.foodId))];
    const foodIds = animal.eatsAnything ? inTray : animal.foods.filter(id => inTray.includes(id));
    return foodIds.map(foodId => ({ foodId, available: open.some(i => i.foodId === foodId && checkFeed(round, i.uid, animalId)) }));
}
