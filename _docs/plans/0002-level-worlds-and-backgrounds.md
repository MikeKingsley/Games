# Level Worlds: Changing Backgrounds and Mythical Animals

The "Feed the Animals" background changes with the level: Farm, Woodland, Savannah, Ocean, Dino, then seven mythical worlds up to level 100. Each mythical world also adds its own creatures. This builds on plan 0001 (Follow-ups 5 and 8 introduced the biomes).

## Decisions & Answers

- **Q:** Farm, Woodland, Savannah, Ocean and Dino fill levels 1-25 in blocks of 5. What should levels 26-30 be? — **A:** Dino runs 21-30. Mythical worlds start at level 31 and come every 10 levels.
- **Q:** What should the 7 mythical environments (31-100) be? — **A:** My proposed list: 31-40 Enchanted Forest, 41-50 Crystal Caves, 51-60 Cloud Kingdom, 61-70 Volcano Dragon Land, 71-80 Fairy Tale Castle, 81-90 Outer Space, 91-100 Rainbow Unicorn Realm.
- **Q:** Should the animals follow the background (mythical creatures in mythical levels)? — **A:** Add mythical animals too (each mythical world adds its own creatures and foods).
- **Q:** How many mythical animals per world? — **A:** 4 per world (28 new animals), each with a palette of foods.
- **Q:** Once a mythical world unlocks, which animals can appear? — **A:** Current world's creatures weigh more: each round draws mostly from the current world and the rest from earlier unlocked worlds.
- **Q:** How should a background look and change, and what happens after level 100? — **A:** CSS gradients plus emoji scenery, keyed off a `data-world` attribute. It cross-fades (about 1.5s) with a short "New world!" banner. No image files. Level 100+ stays on the last world. The background always follows the current level, so "Reset levels" returns to the Farm.
- **Original request wording:** "each level block such as 1-5, 6-10, 11-15 and so on. I would like the background graphic to change - starting with Farm, Woodland, Savannah, Ocean, Dino, then after level 30, just ever increasing levels of mythical environments every 10 levels up to level 100."
- **Assumed (not separately asked; confirm with the user if it matters):**
  - The worlds table is the single source of truth for both backgrounds and animal unlocks. Levels 1-30 keep today's unlock thresholds (1/6/11/16/21).
  - "Weigh more" applies to mythical worlds only (level 31+). Farm to Dino keep today's uniform draw, so the existing Node tests keep passing. With 3 animals, at least 2 come from the current world. With 2 animals (first 3 rounds only, so never in mythical worlds), no weighting applies.
  - The rare unicorn (already in `data.js`, level 6+) is unchanged and stays outside every pool.
  - The "New world!" banner shows only when a level change crosses a world boundary during play, not on mount when a returning player resumes.
  - The timer, difficulty ramp, stars and rewards are unchanged.
  - Mythical animals use emoji only, and food emoji are reused or added from the Unicode set. Where no true emoji exists (e.g. phoenix), use the nearest single emoji (🦅).

## For Future Agents
As work proceeds: mark the item you are actively working on `- 🔄` (at most one per phase) and flip it to `- ✅` when it completes; when a phase is done, set its status to `Complete` and write its **Phase Summary** (what was done, key decisions, anything needed to continue with zero context); run the phase's **Verification Plan** and record the result before moving on. When all phases are done, fill in **Final Recap** and **Deployment Plan**.

Context to know before starting:
- Game files: `Games.Client/wwwroot/games/animal-feeding/` (`data.js`, `logic.js`, `index.js`, `styles.css`, `sound.js`). Pure rules stay in `logic.js` (no DOM, Node-testable). Level = rounds completed + 1 (`levelFor`).
- Today `data.js` has `BIOMES = ['farm','woodland','savanna','ocean','dinosaur']` and `logic.js` `unlockedBiomes` hard-codes the thresholds. `.af-root` in `styles.css` has one hard-coded sky/grass gradient. `index.js` shows `Level N` (`levelEl`) and re-renders each round.
- Every animal has `foods` (palette, favourite first). Favourites must stay unique across all animals (existing test). `FOODS` entries are `{ emoji, name }` keyed by id. `acceptsFood` is the single acceptance rule.
- Test commands: `npm test` (Node logic), `npm run test:e2e` (Playwright, starts the app on :5211), `dotnet test Games.slnx`. New wwwroot files need a dev-server restart (see plan 0001 Phase 3 gotcha).
- Working tree already has uncommitted changes from plan 0001 follow-ups. Do not revert them.

## Phase 1: Worlds table and weighted pool logic
Status: Complete

- ✅ In `data.js` replace `BIOMES` with an exported `WORLDS` array of `{ id, name, fromLevel, mythical }` (farm 1, woodland 6, savanna 11, ocean 16, dinosaur 21, enchanted 31, crystal 41, cloud 51, volcano 61, castle 71, space 81, rainbow 91). Keep `BIOMES` as `WORLDS.map(w => w.id)` so existing imports keep working.
- ✅ In `logic.js` add `worldFor(roundsCompleted)` returning the world with the highest `fromLevel <= level` (levels beyond 100 stay on `rainbow`), and `isWorldChange(roundsBefore, roundsAfter)`.
- ✅ Rewrite `unlockedBiomes` to use `WORLDS` (all worlds with `fromLevel <= level`), keeping results identical for levels 1-30.
- ✅ Add weighted selection for mythical worlds: new `animalPool` output stays the full unlocked list, plus new `favouredAnimals(roundsCompleted)` (named so instead of `currentWorldAnimals`; returns null outside mythical worlds). `createRound` accepts `favoured` (array of animals) and `favouredMin` (default 2) and guarantees at least `favouredMin` chosen animals come from `favoured` when `animalCount` is 3 (never fewer than the pool can supply). The no-repeat rule on the previous animal set still holds.
- ✅ Wire the new option through the call site in `index.js` (`createRound(..., { favoured, favouredMin })`) only when the current world is mythical.

### Verification Plan
- `npm test` passes, including the existing biome tests unchanged.
- New Node tests: `worldFor` at levels 1, 5, 6, 10, 11, 15, 16, 20, 21, 30, 31, 40, 41, 91, 100, 101 and 250 returns farm, farm, woodland, woodland, savanna, savanna, ocean, ocean, dinosaur, dinosaur, enchanted, enchanted, crystal, rainbow, rainbow, rainbow, rainbow. `isWorldChange` is true exactly at 5->6 and 30->31 style boundaries.
- New Node test over 300 seeds at level 35: every round has at least 2 enchanted animals and the round is still winnable (existing winnability helper).

### Phase Summary
Complete (2026-11-01). `data.js` now exports `WORLDS` (12 worlds: `id`, `name` for speech, `emoji`, `fromLevel`, `mythical`); `BIOMES` is derived from it. `logic.js` gained `worldFor`, `isWorldChange`, `favouredAnimals` (animals of the current world in mythical worlds, else null) and `createRound` options `favoured`/`favouredMin` (default 2, applies only to 3-animal rounds). `unlockedBiomes` reads `WORLDS`. `index.js` passes `favoured: favouredAnimals(progress.rounds)`. Tests: 28 Node tests pass. The old test that expected only 5 biomes at level 100 was updated (31 -> 6 worlds, 100 -> 12). The level-35 "enchanted" weighting check could not run yet (no mythical animals), so weighting was verified with the ocean group as `favoured`; re-check with real enchanted animals in Phase 2. No C# changed, so doc-code not needed.

## Phase 2: Mythical animals and foods
Status: Complete

- ✅ Add 28 mythical animals to `ANIMALS` in `data.js`, 4 per world with `biome` set to the world id and a 2-4 food palette each (favourite first, favourite unique across all animals). Proposed lineup (the executing agent may swap an emoji that does not render, keeping 4 per world, unique ids and unique favourites, and records the final list in the Phase Summary):
  - enchanted: 🧚 fairy, 🧝 elf, 🧌 troll, 🧙 wizard
  - crystal: 🧞 genie, 🦇 bat, 🕷️ spider, 🐛 glow worm
  - cloud: 🦅 phoenix, 🕊️ dove, 👼 cherub, 🦢 swan
  - volcano: 🐲 fire dragon, 🦂 scorpion, 🦞 lava lobster, 🐗 boar
  - castle: 🤴 prince, 👸 princess, 🧛 count, 🐸 frog prince
  - space: 👽 alien, 🤖 robot, 👾 space invader, 🧑‍🚀 astronaut
  - rainbow: 🧜 mermaid, 🦩 flamingo, 🦚 peacock, 🦋 butterfly
- ✅ Add any new foods needed to `FOODS` (`id`, `emoji`, `name`). Each food must be unique by id, and each new favourite must be a food no other animal has as favourite.
- ✅ Keep `UNICORN` out of every pool (unchanged).
- ✅ Check speech: names/foods must read sensibly through `speechSynthesis` (plain words, no emoji characters in `name`).

### Verification Plan
- `npm test`: existing data tests pass (unique favourites, every food id exists in `FOODS`, palette 2-4 entries, `acceptsFood` coverage).
- New Node test: each mythical world has exactly 4 animals, 28 mythical animals in total, and total animals = 58 (30 + 28) excluding the unicorn.
- New Node test: for every level from 1 to 120 sampled over 50 seeds, `createRound` is winnable and respects the previous-set rule.

### Phase Summary
Complete (2026-11-01). `data.js` now has 28 mythical animals (4 per world, ids/emoji/palettes below) and 28 new foods in `FOODS`, each new animal's favourite being a new unique food. Total 58 regular animals + the rare unicorn. Final lineup (favourite first): enchanted: fairy 🧚 (blossom, berry, honey), elf 🧝 (chestnut, nut, mushroom), troll 🧌 (potato, meat, corn), wizard 🧙 (potion, cupcake); crystal: genie 🧞 (grapes, mango, cupcake), bat 🦇 (cherries, banana), spider 🕷️ (fly, cricket), glowworm 🐛 (greenapple, leaf, apple); cloud: phoenix 🦅 (orange, chilli, mango), dove 🕊️ (seeds, corn, berry), cherub 👼 (cake, cupcake, milk), swan 🦢 (bread, lettuce, seaweed); volcano: firedragon 🐲 (kebab, chilli, steak), scorpion 🦂 (beetle, cricket), lobster 🦞 (tempura, crab, shrimp), boar 🐗 (sweetpotato, mushroom, corn); castle: prince 🤴 (croissant, apple, milk), princess 👸 (peach, berry, cupcake), count 🧛 (tomato, steak, egg), frog 🐸 (snail, cricket, fly); space: alien 👽 (pizza, egg), robot 🤖 (battery, pizza), invader 👾 (donut, cupcake), astronaut 🧑‍🚀 (icecream, pizza, apple); rainbow: mermaid 🧜 (coconut, seaweed, fish), flamingo 🦩 (candy, shrimp, tropicalfish), peacock 🦚 (cookie, seeds, berry), butterfly 🦋 (daisy, blossom, honey). The unicorn stays out of every pool. Tests: 32 Node tests pass (4 per world / 58 total / unique favourites, 2-4 foods and speakable names, enchanted weighting at level 35 allowing for the unicorn swap, winnable non-repeating rounds over levels 1-120 x 50 seeds). The newer emoji (🧌 troll, 🪲, 🪰) may not render on very old devices; swap in `data.js` if needed. No C# changed, so doc-code not needed.

## Phase 3: Backgrounds and world-change banner
Status: Complete

- ✅ In `styles.css` replace the hard-coded `.af-root` background with CSS custom properties (`--sky`, `--ground`, `--horizon`) and a `.af-root[data-world="..."]` block for each of the 12 worlds (gradients only, kid-bright, with enough contrast for the emoji and the timer/level labels).
- ✅ Add a `.af-scenery` layer behind animals and foods (`pointer-events: none; z-index: 0`) that holds 6-10 large emoji for the current world (e.g. farm 🌾🏡🌳, woodland 🌲🍄🍂, savanna 🌴🌅🌵, ocean 🌊🐚🪸, dino 🌋🦴🌿, enchanted ✨🍄🌳, crystal 💎🔮🪨, cloud ☁️🌈🪁, volcano 🌋🔥🪨, castle 🏰🚩👑, space 🌙⭐🪐, rainbow 🌈✨🌸). Scenery is sized from `--animal-size` and sits in the ground band so it never covers the tray.
- ✅ In `index.js` set `root.dataset.world = worldFor(progress.rounds).id` on mount and whenever a round starts. On a boundary change, cross-fade: render the new scenery into a second layer, fade it in over 1.5s (`opacity` transition on a duplicate layer), then drop the old layer. Make the gradient transition via `transition` on a pseudo-element (gradients cannot transition directly).
  - Done with a stacked `.af-world` layer that fades in by `opacity` (no gradient transition needed).
- ✅ Add a "New world! <name>" banner (large text + world emoji) that appears for about 2.5s only when the level change crosses a world boundary during play (not on mount), plays the existing reward-style chime from `sound.js`, and speaks the world name when speech is on.
- ✅ Honour `prefers-reduced-motion`: no cross-fade animation (instant swap), banner without movement.
- ✅ `unmount` must clear the banner timer and remove both scenery layers.

### Verification Plan
- Playwright (Edge, 1024x768 and 768x1024 touch): seed `games.progress.animal-feeding` rounds to 4, play one round, assert `.af-root[data-world]` goes `farm` -> `woodland` and the banner text appears then disappears; repeat with rounds seeded to 29->30 (`dinosaur` -> `enchanted`) and to 99 (stays `rainbow`).
- Screenshot every world (seed rounds to 0, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90) and inspect: tray and animals are not covered, timer/level text is readable.
- Browser console has no errors, and 0 `.af-root` elements remain after navigating to the menu.
- "Reset levels" on `/options` then reopening the game shows `data-world="farm"`.

### Phase Summary
Complete (2026-11-01). New `scenery.js` (emoji scenery per world: emoji, left %, top %, size vh). `styles.css`: `.af-world` layer per world driven by `--sky-top/--sky-bottom/--ground-top/--ground-bottom` on `.af-world[data-world=...]`; `--ink`/`--ink-shadow` variables switch the level/stars text to white on the dark worlds (ocean, crystal, volcano, space); `.af-banner`; reduced-motion disables the fade and the banner movement. `index.js`: `showWorld(world)` runs at the start of each round, sets `root.dataset.world`, and on a change mid-game fades the new layer in over 1.6s, drops the old layer, shows the banner for 2.6s, plays `sound.reward()` and says "Welcome to <world>!". All timers go through `later()`, so `unmount` clears them, and the layers go with `root.remove()`. NEW wwwroot files (`scenery.js`) need a dev-server restart.
Verification: Playwright e2e passes (farm to woodland after level 5, dinosaur to enchanted after level 30 with banner appearing and disappearing and the old layer removed, 0 console errors; level 141 stays `rainbow` with no banner). Screenshots of all 12 worlds at 1024x768 reviewed: tray and animals not covered, level/timer/stars readable (the volcano scenery was nudged after one overlapped an animal). Not separately tested in a browser: 768x1024 portrait and the options "Reset levels" (it clears progress, so the world follows the level and returns to farm by construction). No C# changed, so doc-code not needed.

## Phase 4: Tests, docs and release
Status: Complete

- ✅ Extend `tests/js/animal-feeding.logic.test.mjs` with anything not yet covered by Phases 1-2 (the 12 world boundaries, worlds are contiguous and in `fromLevel` order, every world has at least 4 animals).
- ✅ Extend `tests/e2e/animal-feeding.spec.mjs` with a world-change test using the Phase 3 flow (derive the animal-food map from `data.js` as the existing test does).
- ✅ Update `README.md` (worlds table with level ranges) and append a "Follow-up 13" entry to plan 0001 pointing at this plan.
- ✅ No C# classes change, so doc-code is not needed. Confirm with `git diff --stat -- '*.cs' '*.razor'` showing none from this plan.

### Verification Plan
- `npm test`, `npm run test:e2e` and `dotnet test Games.slnx` all pass.
- `git status` shows only game files, tests, README and plan docs changed.

### Phase Summary
Complete (2026-11-01). Node tests (32) cover worldFor/isWorldChange boundaries, weighting, 4-per-world data, speakable names and winnable rounds over levels 1-120; e2e has 3 new tests (4 total). README has a worlds table; plan 0001 has Follow-up 13. `dotnet test` 15/15, `npm test` 32/32, `npm run test:e2e` 4/4. `git status` shows only game files, tests, README and plan docs from this plan (`HoldToOpen.razor` was already modified before this plan started).

## Final Recap
Feed the Animals now has 12 worlds keyed to the level: Farm (1-5), Woodland (6-10), Savannah (11-15), Ocean (16-20), Dino (21-30), then Enchanted Forest, Crystal Caves, Cloud Kingdom, Dragon Volcano, Fairy Tale Castle, Outer Space and Unicorn Rainbow Land every 10 levels to 100 (the last world stays after that). Each has a CSS gradient background with emoji scenery, a cross-fade and a "New world!" banner with chime and speech. The 7 mythical worlds add 28 creatures and 28 foods (58 regular animals in total plus the rare unicorn), and in mythical worlds at least two of three animals come from the current world. Nothing is committed or pushed yet.

## Deployment Plan
1. Review and commit the working tree (this plan's changes sit with earlier uncommitted follow-ups), then `git push origin main`.
2. `.github/workflows/pages.yml` runs `dotnet test` and `npm test`, publishes with the `/Games/` base path and deploys to https://mikekingsley.github.io/Games/ .
3. Installed phone copies pick up the update after the app is closed and reopened (the service worker assets version changes with each publish).
4. Check live: seed progress at level 5 and play a round to see the Woodland banner, or open the Options page to reset levels and confirm the Farm background.
