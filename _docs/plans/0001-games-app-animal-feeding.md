# Games: Kids Game Platform + Animal Feeding Game

Create a new repo `Games`: a static Blazor WebAssembly shell that hosts custom JavaScript kids' games, and ship the first game, an animal feeding game for toddlers (ages 2-4) on touch tablets.

## Decisions & Answers

- **Q:** Where should the Games project live? — **A:** New separate repo (`F:\Documents\Files\Apps\Games`, `git init` done, plan lives in its `_docs/plans/`).
- **Q:** What tech stack? — **A:** Blazor WASM (C# host, games written in JavaScript via interop). .NET SDK installed is 10.0.401; target `net10.0`.
- **Q:** Who are the players and what input? — **A:** Toddlers 2-4, touch tablet. Big targets, no reading required, no fail states, drag/tap only.
- **Q:** Animal feeding game mechanic? — **A:** Drag food to the right animal.
- **Q:** Rendering? — **A:** DOM/SVG + emoji + CSS animation (Pointer Events for drag). No canvas/engine.
- **Q:** Art and sound source? — **A:** Emoji/SVG drawn in code + synthesized WebAudio sounds. No external asset files. (Optional speech synthesis for animal/food names, toggleable.)
- **Q:** Hosting and persistence? — **A:** Static WASM hosting, no accounts, localStorage only. Installable PWA with offline support.
- **Q:** Where does the plan go given the repo doesn't exist? — **A:** Create `F:\Documents\Files\Apps\Games`, git init, plan inside it.
- **Q:** Gameplay details? — **A:** Endless rounds, 2-3 animals + 3 foods per round, wrong drop = gentle wobble and the food returns to its start. No fail state, no score pressure; a star/sticker reward every few rounds; difficulty ramps slowly.
- **Q:** How should future games plug in? — **A:** Blazor shell + game registry; each game is a JS ES module with a mount/unmount contract. Home menu of game tiles; Blazor handles routing/settings, JS owns gameplay.
- **Q:** Testing approach? — **A:** xUnit for the C# shell; plain Node tests (`node:test`, no Vitest) for pure game logic in JS modules; a Playwright smoke test for drag.
- **Q:** Parent-facing features? — **A:** Sound on/off and speech on/off settings, plus a hold-to-open parent corner to exit (toddler-proofing; no accidental navigation, fullscreen friendly).
- **Assumed (user chose all recommended options; not separately asked):** Solution name `Games`; projects `Games.Client` (Blazor WASM) and `Games.Tests` (xUnit); standalone WASM (no ASP.NET host); UI language English; no analytics/telemetry; no third-party JS dependencies at runtime.

## For Future Agents
As work proceeds: mark the item you are actively working on `- 🔄` (at most one per phase) and flip it to `- ✅` when it completes; when a phase is done, set its status to `Complete` and write its **Phase Summary** (what was done, key decisions, anything needed to continue with zero context); run the phase's **Verification Plan** and record the result before moving on. When all phases are done, fill in **Final Recap** and **Deployment Plan**.

Design contract (decided here, keep consistent):
- Game module contract: `wwwroot/games/<id>/index.js` exports `mount(container, options)` returning `{ unmount() }`. `options` = `{ soundEnabled, speechEnabled, onExit, onReward }`. Pure logic lives in `logic.js` beside it (no DOM access) so Node tests can import it.
- Registry: `wwwroot/games/registry.json` (id, title, emoji icon, module path); C# `GameRegistry` loads it.
- Settings stored in localStorage key `games.settings` as `{ sound: bool, speech: bool }`; progress under `games.progress.<gameId>`.

## Phase 1: Repo and Blazor shell
Status: Complete

- ✅ Add `.gitignore` (dotnet + node), `README.md`, `global.json` pinning SDK 10.0.x
- ✅ Create `Games.slnx`, `Games.Client` (Blazor WASM standalone, net10.0) and `Games.Tests` (xUnit) with project reference
- ✅ Add toddler-friendly base CSS: full-viewport layout, `touch-action: none` on play area, `user-select: none`, no scroll/zoom/long-press menu, large tap targets (min 96px)
- ✅ Add `Home.razor` showing a grid of big game tiles from `GameRegistry` (C# record `GameInfo`, `GameRegistry` service reading `games/registry.json`)
- ✅ Add `Play.razor` at `/play/{id}` with a `GameHost` component that dynamically imports the game module via `IJSRuntime`, calls `mount`, and `unmount` on dispose
- ✅ Add `SettingsService` (sound/speech) backed by localStorage via JS interop, with unit-testable abstraction over storage
- ✅ Add `ParentCorner` component: small corner button that must be held ~2 seconds to reveal Exit-to-menu and settings toggles

### Verification Plan
- `dotnet build Games.slnx` succeeds with 0 errors
- `dotnet test Games.slnx` passes (registry parsing, settings service tests)
- `dotnet run --project Games.Client` serves the app; home page shows at least one tile (use Playwright snapshot)

### Phase Summary
Complete (2026-11-01). Repo scaffolded at `F:\Documents\Files\Apps\Games`: `Games.slnx`, `Games.Client` (Blazor WASM, net10.0), `tests/Games.Tests` (xUnit). Shell: `Home.razor` (tiles from `GameRegistry`), `Play.razor` (`/play/{Id}`), `Components/GameHost.razor` (imports `wwwroot/js/host.js`, which dynamic-imports the game module and calls `mount(container, options)`; options also include `loadProgress()`/`saveProgress(obj)` backed by `games.progress.<id>`, and the returned handle may optionally expose `setOptions({soundEnabled, speechEnabled})` for live setting changes), `Components/ParentCorner.razor` (2s hold -> sound/speech toggles, exit). `SettingsService` + `ISettingsStore` (localStorage via JS interop). `wwwroot/games/registry.json` already lists `animal-feeding` (module file not yet created).
Verification: `dotnet build` 0 errors/0 warnings; `dotnet test` 7/7 pass; app served on :5210 and Playwright snapshot showed the "Feed the Animals" tile. Code docs refreshed in `_docs/code-docs/Games/`.
Notes: `GameRegistryTests` has a temporary exemption (`|| g.Id == "animal-feeding"`) for the missing module file — remove it in Phase 3 once `index.js` exists. Dev server may still be running on :5210 (kill by port when done). Write files with the Write tool; large bash heredoc batches hit parse errors.

## Phase 2: Animal feeding game logic (pure JS)
Status: Complete

- ✅ Create `wwwroot/games/animal-feeding/data.js` with animals (emoji, name, preferred food ids, 8+ animals e.g. monkey-banana, rabbit-carrot, cow-grass, dog-bone, mouse-cheese, bear-honey, bird-seeds, panda-bamboo) and foods
- ✅ Create `logic.js`: `createRound(rng, difficulty)` picks 2-3 animals and exactly the matching foods plus distractors to total 3 foods; `checkFeed(round, foodId, animalId)` returns correct/incorrect; `isRoundComplete`; `nextDifficulty(roundsCompleted)` ramps slowly (2 animals first rounds, then 3); `shouldReward(roundsCompleted)` every 3 rounds
- ✅ Ensure rounds never repeat the same animal set twice in a row, and every food in a round is feedable to at least one present animal (no unwinnable rounds)
- ✅ Add `tests/js/animal-feeding.logic.test.mjs` using `node:test` and `node:assert`, with a seeded RNG for determinism

### Verification Plan
- `npm test` (= `node --test "tests/js/**/*.test.mjs"`) passes; covers round validity (never unwinnable), no immediate repeat, difficulty ramp, reward cadence

### Phase Summary
Complete (2026-11-01). Added `Games.Client/wwwroot/games/animal-feeding/data.js` (9 animals, each accepting exactly one food; `FOODS`, `ANIMALS`, `animalById`) and `logic.js` (pure, no DOM): `createRound(rng, {animalCount, previousAnimalIds})` -> `{animals:[ids], items:[{uid, foodId, fed}]}`, `checkFeed`, `feed` (mutates item.fed), `isRoundComplete`, `nextDifficulty` (2 animals for rounds 0-2, then 3), `shouldReward` (every 3rd completed round), `seededRng`.
Key decision: a round always has exactly 3 food items. With 2 animals the third item is a second helping of a random present animal's food, so every item is feedable and rounds are never unwinnable (no distractor foods that match nobody). With 3 animals each gets one item.
Tests: root `package.json` (`"type":"module"`, `npm test` = `node --test "tests/js/**/*.test.mjs"`; `node --test tests/js` does NOT work on Node 22 because it treats the dir as a file). `tests/js/animal-feeding.logic.test.mjs`: 8 tests pass (round validity over 300 seeds, no repeat set, determinism, checkFeed cases, completion, ramp, reward cadence). No C# changed, so doc-code not needed.

## Phase 3: Animal feeding game UI and interaction
Status: Complete

- ✅ Create `index.js` exporting `mount`/`unmount`; render animals (large emoji in SVG/CSS cards with open-mouth target zone) and foods (large emoji tray at bottom)
- ✅ Implement drag with Pointer Events (pointer capture, touch and mouse), food follows finger with offset so it is visible under the thumb; hit-test against animal mouth zones
- ✅ Correct drop: food snaps into mouth, eat animation (bounce + chomp), happy sound, animal-name speech via `speechSynthesis` if enabled, food disappears; wrong drop: gentle wobble/head-shake on the animal, soft sound, food glides back to tray
- ✅ Tap on an animal triggers its idle animation (so toddlers get feedback even without dragging)
- ✅ Round completion: celebrate (confetti emoji burst), then auto-start next round; every 3rd round show a star reward via `onReward` and a sticker
- ✅ Idle hint: after ~8 seconds with no interaction, gently wiggle the correct food and point/bounce toward its animal
- ✅ Create `sound.js` with WebAudio synthesized cues (pop, chomp, success jingle, soft boop) and a resume-on-first-gesture AudioContext unlock; respect `soundEnabled`
- ✅ Create `styles.css` for the game: colorful background, large targets (min 120px), CSS-only animations, `prefers-reduced-motion` respected
- ✅ Register the game in `registry.json` and persist rounds completed / stars in localStorage via shell progress key
- ✅ `unmount` removes all listeners, timers, audio nodes and speech queue (no leaks when returning to menu)

### Verification Plan
- Playwright (via `mcp__playwright` or a scripted `@playwright/test` run) at a tablet viewport (1024x768, touch emulation): drag the correct food to the animal and assert it is consumed; drag wrong food and assert it returns to the tray; complete a round and assert a new round renders
- Check browser console has no errors during the flow
- Manual screenshot review of layout at 768x1024 and 1024x768

### Phase Summary
Complete (2026-11-01). Game lives in `Games.Client/wwwroot/games/animal-feeding/`: `index.js` (`mount(container, options)` -> `{unmount, setOptions}`), `sound.js` (WebAudio cues: pop, chomp, success, boop, reward; AudioContext unlocked on first pointerdown), `styles.css` (injected as a `<link>` on mount, removed on unmount), plus Phase 2 `data.js`/`logic.js`.
How it works: Pointer Events on the root with pointer capture on the food; food lifts half its height above the finger and scales 1.25x; drop is hit-tested by the food's centre against animal cards (+24px padding). Correct drop: food flies into the animal, chomp animation, name spoken. Wrong drop: animal shakes, soft boop, food glides back. Tapping an animal plays a bounce + its name. After 8s idle the next food wiggles and its animal hops. Round complete: confetti, "Hooray", next round after ~1.7s; every 3rd completed round shows a big star + animal sticker overlay, calls `onReward(stars)` and saves `{rounds, stars}` via `saveProgress` (key `games.progress.animal-feeding`). Progress also drives difficulty on return visits.
Test hooks: `data-round` on `.af-root`, `data-animal` on `.af-animal`, `data-uid`/`data-food` on `.af-food`, class `eaten` on consumed food, `.af-reward` overlay.
Gotchas: the dev server's static-asset manifest is built at start, so NEW wwwroot files added while `dotnet run` is running 404 at fingerprinted URLs (import map) — restart the server after adding files. Removed the temporary exemption from `GameRegistryTests` (now every registry module file must exist); 7 xUnit tests pass.
Verification (Playwright MCP, 1024x768 mouse drag): wrong drop kept 3 foods in tray; correct drops consumed all 3 and round went 1 -> 2; with progress seeded to rounds=2 the 3rd round showed `.af-reward` and stored `{"rounds":3,"stars":1}`; navigating to the menu left 0 `.af-root` elements; 0 console errors; screenshots checked at 1024x768 and 768x1024. No C# classes changed, so doc-code not needed. Dev server on :5210 was stopped.

## Phase 4: PWA, polish and kiosk-friendliness
Status: Complete

- ✅ Add `manifest.webmanifest` (name, icons generated as SVG/PNG, `display: fullscreen`, landscape-friendly orientation) and the Blazor PWA service worker for offline use
- ✅ Generate app icons (simple animal emoji on colored background) at 192 and 512 px
- ✅ Block accidental navigation: disable context menu, pinch-zoom, pull-to-refresh (`overscroll-behavior: none`), and back-swipe confusion; add a fullscreen request on first tap if supported
- ✅ Add a loading splash that is toddler-friendly (animated emoji) instead of the default Blazor text
- ✅ Add Playwright smoke test project under `tests/e2e` (documented command) covering the Phase 3 flow
- ✅ Update `README.md` with how to run, test, add a new game (module contract), and deploy

### Verification Plan
- `dotnet publish Games.Client -c Release -o publish` succeeds; serve `publish/wwwroot` with a static server and confirm the app loads
- Lighthouse or manual check that the service worker registers and the app loads offline after first visit
- All tests pass: `dotnet test` and `npm test` (= `node --test "tests/js/**/*.test.mjs"`)

### Phase Summary
Complete (2026-11-01). PWA: `manifest.webmanifest` (fullscreen display, theme `#bfe9ff`), `service-worker.js` / `service-worker.published.js` copied from the Blazor PWA template, `ServiceWorker` item + `ServiceWorkerAssetsManifest` in `Games.Client.csproj`, registration script and apple-touch-icon in `index.html`. Icons `icon-192.png`/`icon-512.png` are a monkey emoji on a sky/grass gradient, rendered with Playwright. Toddler-proofing in `wwwroot/js/kiosk.js` (no context menu/drag/pinch; fullscreen on first tap) plus `overscroll-behavior: none` in `app.css`. The animated-emoji loading splash was already done in Phase 1 (`index.html` `.splash`). E2E: `playwright.config.mjs` + `tests/e2e/animal-feeding.spec.mjs` (`npm run test:e2e`; starts the app on :5211 and uses installed Microsoft Edge, so no browser download; the test waits 600ms after the wrong drop so the food finishes gliding back). README rewritten with run/test/add-a-game/deploy.
Verification: `dotnet publish Games.Client -c Release -o publish` succeeded; served `publish/wwwroot` statically on :5212, Playwright confirmed the home tile loads, the service worker registers and creates an `offline-cache-*` cache, and with the browser set offline the game page loads and renders 3 foods. `dotnet test` 7/7 pass, `npm test` 8/8 pass, `npm run test:e2e` 1/1 pass. No C# classes changed in this phase, so doc-code not needed. Preview servers on :5210/:5212 were stopped and `publish/` removed.

## Final Recap
Built the new `Games` repo (`F:DocumentsFilesAppsGames`): a static Blazor WASM (.NET 10) shell that lists games from `games/registry.json`, mounts each game's JS ES module at `/play/{id}`, stores sound/speech settings and per-game progress in localStorage, and protects toddlers with a hold-to-open parent corner and kiosk behaviour. The first game, **Feed the Animals**, is complete: 9 animals, drag-and-drop food with pointer events, gentle wobble on wrong drops, synthesized WebAudio sounds, optional speech, idle hints, confetti, a star every 3rd round, and slow difficulty ramp (2 then 3 animals). The app is an installable, offline-capable PWA. Tests: 7 xUnit, 8 Node logic tests, 1 Playwright e2e, all passing. Nothing has been committed yet (the repo has no commits).

## Deployment Plan
The app is fully static; host the contents of `publish/wwwroot`.
1. `dotnet publish Games.Client -c Release -o publish` (from the repo root).
2. Upload `publish/wwwroot/` to any static host (GitHub Pages, Netlify, Azure Static Web Apps, S3/CloudFront). Serve over HTTPS (required for the service worker/PWA install).
3. Configure SPA fallback: unknown paths (e.g. `/play/animal-feeding`) must return `index.html` with HTTP 200 (Netlify: `/* /index.html 200`; Azure SWA: `navigationFallback` to `/index.html`; GitHub Pages: copy `index.html` to `404.html`).
4. Serve `.wasm` as `application/wasm`; enable gzip/brotli (publish output includes `.br`/`.gz` files).
5. Hosting under a sub-path (e.g. GitHub Pages project site): change `<base href="/">` in `Games.Client/wwwroot/index.html` to the sub-path (e.g. `/Games/`) and set `const base = "/Games/";` in `service-worker.published.js` before publishing.
6. After deploy, open the site in Chrome/Edge on a tablet, confirm "Install app"/Add to Home Screen, then toggle airplane mode and confirm the game still loads.
7. Update cycle: every publish changes the service worker assets version; users get the new version after closing and reopening the installed app.

## Follow-up 1: Eat on hover, bite by bite (2026-11-01)
Update: the dashed/white drop-zone highlight was removed; the hovered animal now just grows (`.af-animal.hover .af-emoji { scale: 1.3 }`).
Feedback from the child player: hovering over the right animal should start eating immediately, with eating sounds, and the food should be eaten in bites the longer it is held there. Done: `logic.js` gained `eat`/`bitesTaken`/`eatenFraction` (3 bites x 450ms; progress persists if pulled away; releasing over the right animal still finishes it instantly); `index.js` runs a per-frame `tick` while dragging (crunch sound per bite, circular bite masks `.bites-1..3`, shrinking food, munching animal); `sound.js` gained `crunch()`. Tests: 3 new Node tests (11 total), e2e unchanged and passing.

## Follow-up 2: Phone on local network (2026-11-01)
`scripts/run-lan.ps1` serves on `0.0.0.0:5220` and prints phone URLs (use the Ethernet/active adapter's IP; the Wi-Fi adapter may be disconnected). `scripts/allow-lan-firewall.ps1` adds an inbound allow rule "Games dev (5220)" on Private networks (self-elevates). No PWA/service worker over plain HTTP.

## Follow-up 3: Harder levels (2026-11-01)
Request: more than three foods, and foods that belong to none of the animals, harder after five stars. Done in `logic.js` `nextDifficulty` (driven by rounds completed; 1 star = 3 rounds): first 3 rounds 2 animals/3 foods; 0-2 stars 3 animals/3 foods; 3-4 stars 4 foods; 5-7 stars 5 foods incl. 1 distractor; 8+ stars 6 foods incl. 2 distractors. `createRound` takes `{animalCount, itemCount, distractors}`; distractor items carry `distractor: true`, are distinct foods no present animal eats, can never be eaten (wobble + return), and do not keep the round open (`isRoundComplete`). UI: tray sizes itself from `--n` so 6 foods fit, hints skip distractors, leftover distractors fade when the round ends. Tests: 14 Node tests pass (tiers, winnability for every tier x 200 seeds, distractor rules); e2e passes; verified at 8 stars in the browser.

## Follow-up 4: Countdown timer from level 16, level reset, Options page (2026-11-01)
Request: a reset for levels, and a countdown from level 15+ that gets shorter each level, starting at 30s, clamped to about 5s. Done in `logic.js`: level = rounds completed + 1; `roundTimeSeconds(rounds)` is null for levels 1-15, 30s at level 16, one second less per level, minimum 5s (level 41+). UI: `Level N` label, a timer bar with number (turns red/pulses under 5s). Assumption (not asked): when time runs out the animals shake, a soft boop plays and a fresh round starts at the SAME level, with no loss of progress. Reset: the user asked for it to live in an options menu that did not exist, so a new `/options` page was built (sound, speech, per-game level + two-tap "Reset levels"), reached by holding the gear on the home screen or via "Options" in the in-game grown-ups panel. New `HoldToOpen` component (hold gear), `ProgressService` (+ `RemoveAsync` on `ISettingsStore`). Tests: 15 Node tests, 15 xUnit tests, e2e pass. Verified in the browser: timers at levels 15/16/26/41, expiry restarting the round, reset returning to Level 1 and clearing localStorage. Code docs updated (ProgressService, ISettingsStore, LocalStorageSettingsStore).

## Follow-up 5: Animal biomes by level (2026-11-01)
Request: levels 1-5 farm animals only; 6-10 add woodland; 11-15 add African savannah; 16-20 add ocean; animals spawn randomly from the expanding pool. Done: `data.js` now has 24 animals (6 per biome: farm cow/pig/dog/chicken/cat/horse; woodland rabbit/squirrel/bear/hedgehog/deer/bird; savanna monkey/elephant/giraffe/lion/hippo/zebra; ocean dolphin/whale/octopus/seal/turtle/penguin), each with one unique food (no two animals share a food), plus `BIOMES`. `logic.js`: level = rounds completed + 1; `unlockedBiomes`/`animalPool` (ocean stays in the pool after level 20, so level 16+ draws from all 24); `createRound` takes `pool` and draws animals uniformly at random; distractor foods are foods of other animals in the same pool. Panda was dropped (no bamboo in any biome). Tests: 18 Node tests (biome boundaries 5/6, 10/11, 15/16; spawns stay in pool; every pooled animal appears), e2e now derives the animal-food map from `data.js`.

## Follow-up 6: Options menu would not open on a phone (2026-11-01)
Cause (likely): touch browsers fire pointercancel/pointerleave during a long press, which `HoldToOpen` treated as letting go, so the 2s hold never completed (it worked with a mouse). Fix: for touch pointers only pointerup cancels the hold; gear has `touch-action: none` and no text selection/callout; a short tap now shows a "Hold for 2 seconds…" hint. Verified with Chromium touch emulation (CDP touch events, with finger jitter): tap = hint only, 2.4s hold = Options opens from home and from inside a game. Direct fallback URL: `/options`.

## Follow-up 7: Say the food on pick-up; wrong animal says "yuck" (2026-11-01)
Request: the food should say what it is as soon as it is picked up (not on drop/eaten), and a wrong animal should reject it with a yuck/spit/no sound. Done in `index.js`/`sound.js`: pointerdown on a food speaks its name (`FOODS[..].name`); the old speech on eating was removed. `reject(card)` = head-shake animation + new synthesized `sound.yuck()` (wobbling falling sawtooth + a spit burst) + speech cycling "Yuck!", "No thank you!", "Eww!", "Not that!". It fires when food is released on a wrong animal AND after the food has been held over a wrong animal for 500ms (once per visit, no double on release). Verified in the browser by capturing speech: pickup -> "grass"; hover wrong 0.8s -> "Yuck!"; quick wrong drop -> "bone","Yuck!" and food returns; correct feed says only the pickup name. 18 Node tests and e2e still pass.

## Follow-up 8: Dinosaurs after level 20, rare unicorns from level 6 (2026-11-01)
Request: dinosaurs start appearing after level 20; unicorns have a small chance of randomly appearing after level 5. Done: new `dinosaur` biome unlocks at level 21 and stays (all 5 biomes = 30 animals in the pool from then on). Only two dinosaur emoji exist, so the biome is T-rex (steak), brontosaurus (palm leaves) plus four prehistoric-style friends: crocodile (drumstick), lizard (cricket), dragon (chilli), snake (egg). Unicorn (`UNICORN` in `data.js`, eats a cupcake) is NOT in any pool: from level 6 `rareAnimalFor` gives `createRound` a 10% per-round chance (`UNICORN_CHANCE`) to swap it in for one of the chosen animals (max one per round, rounds stay winnable). UI: the unicorn glows and has a twinkling sparkle, plays a glittery arpeggio and says "A unicorn!" when it shows up. Tests: 21 Node tests (dino unlock boundaries 20/21, unicorn never in pool, null before level 6, observed rate within 7-13% over 4000 rounds, gets its cupcake); e2e passes.

## Follow-up 9: Fully offline phone install (2026-11-01)
Request: run as a fully offline app launched from a phone; chosen route = host once on HTTPS, then install the PWA. `gh` CLI is not installed and TrainDriver uses Azure DevOps, so instead of a GitHub deploy the repo gets `scripts/build-static-site.ps1`, which publishes and produces `dist/` (+ `Games-site.zip`, ~9.5 MB, ~15 MB unpacked) with `_redirects` (Netlify/Cloudflare SPA fallback), `404.html` and `.nojekyll` (GitHub Pages). `dist/` and the zip are git-ignored. Verified by serving `dist/` statically: service worker cached 58 assets including the WASM and game module, manifest is fullscreen with 2 icons, and with the network switched off a cold load of `/play/animal-feeding`, `/options` and `/` all worked. Remaining manual step for the owner: upload `dist` to an HTTPS host and install from the phone.
