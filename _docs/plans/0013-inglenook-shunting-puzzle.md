# Inglenook (shunting puzzle game)

Add a new game, **Inglenook**, to the Games shell: a top-down 2D SVG shunting puzzle set in a UK goods yard in the 1960s. The player drives a diesel shunter forward and reverse around an inglenook-style siding layout, flipping points and uncoupling wagons to assemble a target train. Levels are endless, seeded and always solvable, and they get harder.

## Decisions & Answers

Original brief (user, 2026-11-08): "new game idea: a inglenook shunting puzzle game, 2d SVG graphics, levels with random challenges that get hard. Control the train, simple controls forward and reverse. Stops at end on line or when coupling up automatically". Later message: "UK based, 1960s".

- **Q:** How should the track points (switches) be set while you only have forward and reverse controls? — **A:** Tap a point to flip it (recommended). Points are drawn on the layout; tap one to toggle it (keyboard: number keys). The train has only Forward / Reverse / Stop.
- **Q:** How does uncoupling work, given coupling is automatic on contact? — **A:** Tap a coupling (recommended). Each coupling between loco and wagons shows a small hook; tap it to uncouple there. Wagons beyond it stay behind.
- **Q:** Which puzzle rules should the levels use? — **A:** Classic inglenook plus variations (recommended). Start with the classic 3-siding inglenook (5/3/3 wagon capacity, 8 wagons, one loco); goal is to assemble a target train on the long siding in a set order. Harder levels change the layout and goal.
- **Q:** What makes later levels harder? (multi-select) — **A:** Longer required sequence; bigger layouts; obstacles. (Move/time limits were NOT selected: no countdown or hard move limit. Par moves still exist for star ratings.)
- **Q:** Who is the audience and how does it sit in the shell? — **A:** Older kids + adults (recommended). Text UI is fine. A registry `features` flag hides Hardcore and the Level row; progress goes in `saveProgress`.
- **Q:** How are progress, winning and scoring handled? — **A:** Endless seeded levels + stars (recommended). Level N uses seed N; solver-computed par moves; 1-3 stars; no fail state; Reset, Skip level and Undo available; best result saved per level.
- **Q:** What look and sound? — **A:** Top-down model railway (recommended). Plan view of track on a baize/grass board: sleepers, rails, shunter, coloured wagons with numbers. WebAudio synth chuff/clank/whistle, no audio files.
- **Q:** Name, tests, commit policy? — **A:** Game id `inglenook`, title "Inglenook", icon 🚂 (recommended). DOM-free logic tested with `node:test` plus a Playwright smoke test. `execute-plan` makes a local checkpoint commit per verified phase and never pushes.
- **Q:** How do Forward/Reverse controls behave? — **A:** Latching with gentle accel (recommended). Press Forward or Reverse to set direction and start; the loco eases to a slow fixed speed; a Stop button/Space halts it. It auto-stops at buffer stops and on coupling. Keys W/S or arrows.
- **Q:** How is the win condition shown and checked? — **A:** Target train on the long siding (recommended). A goal strip shows the required wagon order (coloured and numbered). Win when those wagons sit in that order on the goal siding; other wagons may be anywhere; the loco is free.
- **Q:** How are layouts introduced as levels climb? — **A:** A handful of templates plus random parameters (recommended). Templates: classic 5/3/3 inglenook, bigger inglenook, 4-5 siding ladder, layouts with a run-round loop. Each level seed picks template, wagon count, obstacle wagons and blocked sidings. A solver guarantees the level is solvable.
- **Q:** Setting? — **A (free text, mid-planning):** "UK based, 1960s". See assumptions.
- **Q:** Git workflow? — **A (free text, mid-planning):** "Branch off from main first", and "Once built, commit and push to main". Executed as: the work happens on branch `feature/inglenook`, created off `main` in a separate worktree at `F:\Documents\Files\Apps\Games-inglenook` (the main folder holds the user's uncommitted Delivery Driver work on another branch, which must not be touched; **Q:** how to branch? — **A:** "Separate worktree"). `execute-plan` makes local checkpoint commits per verified phase on `feature/inglenook`. When ALL phases are complete and gates pass, the user has explicitly authorised: merge `feature/inglenook` into `main` (fast-forward if possible, otherwise a merge commit) and `git push origin main` (this triggers the GitHub Pages deploy). This is the one authorised push; push nothing else and no other branches.
- **Q:** Scope summary complete? — **A:** "Complete, write the plan".

Assumptions (not asked; defaults chosen while planning, change only with the user):
- **Era look.** A 1960s British Railways goods yard: a small diesel shunter (Class 08 style, blue/green livery, drawn generically), 16-ton mineral wagons, vans, open wagons and tank wagons in period liveries (bauxite brown, grey, red oxide), a brake van as an optional decoration. Fictional/generic names only: **no real logos, no BR double arrow**, no real wagon operator marks. Wagon numbers use a plain period style (letter prefix plus digits, e.g. `B 482113`). Yard scenery: goods shed, signal box, coal staithe, water tower, fence, buffer stops with lamps. Drive/handedness does not matter (no road traffic).
- **Wagon identity for the goal.** Goal wagons are identified by a coloured body plus a large number (colour-blind safe), not by type alone.
- **Locomotive.** One shunter per level. It couples at either end and can push or pull. It does not run out of fuel and cannot derail.
- **Scale.** Wagon length 1 unit; speed is slow and fixed (about 1.2 wagon-lengths per second), easing in and out over about 0.4 s.
- **Orientation.** Landscape preferred; the SVG viewBox scales to fit, portrait still plays with a "rotate for a bigger view" hint.
- **Stars.** 3 stars at par moves or fewer, 2 stars within 1.5 x par, otherwise 1. A "move" is one coupling event plus one uncoupling event plus the move between them (defined precisely in phase 4). Slowness never loses stars.
- **Save.** Progress in the shell's `saveProgress` object: `{ level, best: { [level]: { stars, moves } }, muted }`. No slots.
- **Layout names.** Templates are named `classic`, `classic-long`, `ladder4`, `ladder5`, `loop` in code.
- **Obstacles.** (a) "Stuck" wagons: loose wagons that must not be moved (handbrake on, shown with a chock); the loco can still use sidings around them. (b) Blocked/occupied sidings: a siding has a fixed wagon at its far end, which reduces its capacity. Both are removed by the generator if they make a level unsolvable.
- **Solver.** The solver works on an abstract yard state (sequence of wagons per siding, loco position, point states) with the move model defined in phase 4; BFS with a state cap. Levels the solver cannot solve inside the cap are regenerated with the next sub-seed.

## For Future Agents
As work proceeds: mark the item you are actively working on `- 🔄` (at most one per phase) and flip it to `- ✅` when it completes. When a phase is done, run its **Verification Plan**, write its **Phase Summary** (max ~5 lines), set its status to `Complete` (`execute-plan` then makes a local checkpoint commit). Never ask the user questions; record any assumption inline. When all phases are done, fill in **Final Recap** and **Deployment Plan**.

Repo facts (verified 2026-11-08):
- **Game contract.** Games mount via `Games.Client/wwwroot/js/host.js`: `export function mount(container, options)` returning `{ unmount(), setOptions(next) }`. `options` = `{ soundEnabled, speechEnabled, showFoods, debug, onExit(), onReward(stars), loadProgress(), saveProgress(obj) }`; `setOptions` also receives `paused` while the grown-ups panel is open. Keep rules in a DOM-free `logic.js`; inject your own stylesheet from `mount` and remove it in `unmount`.
- **Registry.** `Games.Client/wwwroot/games/registry.json` entries are `{ id, title, icon, module, features? }`. `features: { "hardcore": false, "levels": false }` hides the shell Hardcore button and Level row (Delivery Driver does this). `Services/GameRegistry.cs` reads it and `tests/Games.Tests` (`GameRegistryTests`) checks every module file exists. New files under `wwwroot` need a dev-server restart to avoid 404s.
- **Existing games** live in `Games.Client/wwwroot/games/animal-feeding/` and `.../delivery-driver/` (the latter is the best pattern for folder layout: `index.js`, `config.js`, `styles.css`, `engine/`, `ui/`, `audio/`).
- **Tests.** `npm test` runs `node --test "tests/js/**/*.test.mjs"`; name new files `tests/js/inglenook.*.test.mjs`. `dotnet test Games.slnx` runs the shell tests. `npm run test:e2e` runs Playwright (app on :5211, installed Microsoft Edge); add `tests/e2e/inglenook.spec.mjs`. Dev debug hook pattern: `window.__dd` in Delivery Driver (Development only); use `window.__ig` here.
- **Worktree.** Work in `F:\Documents\Files\Apps\Games-inglenook` (branch `feature/inglenook`, based on `main` at 29b0d99). It has no `node_modules`: run `npm install` there first. `main` only has plans up to 0005 (other plans live on Delivery Driver branches), so 0013 is intentionally the next free number across branches. Stage only Inglenook files (plus registry.json/README.md edits); never `git add -A` blindly. The `main` README does not yet contain the Delivery Driver section, so add only an Inglenook line/section in the shape that exists on `main`.
- **Deploy.** Push to `main` triggers `.github/workflows/pages.yml` (tests, publish, GitHub Pages at https://mikekingsley.github.io/Games/). This plan never pushes.
- **Doc sync.** README has a Games list at the top and a Layout table; add an Inglenook section.
- A pre-existing e2e regression is open from plan 0012 phase 8 (Delivery Driver). It is not this plan's concern: run only the Inglenook e2e spec plus `npm test` and `dotnet test` as gates, and note any unrelated failures in the phase summary without fixing them.

## Recommended Model

| Phase | Model | Effort | Why |
|---|---|---|---|
| 1 Scaffold and shell wiring | sonnet | medium | Follows the existing mount/registry pattern |
| 2 Track model and layouts | sonnet | medium | Graph and geometry in pure JS with tests |
| 3 Train simulation | sonnet | medium | 1D motion on a graph, coupling and buffers; unit-tested |
| 4 Levels, solver and stars | sonnet | medium | Seeded generator plus BFS; well-defined and tested |
| 5 SVG renderer and input | sonnet | medium | UI wiring and SVG drawing |
| 6 Audio, progress, e2e and docs | sonnet | medium | Synth sound, save, smoke test, README |

## Phase 1: Scaffold and shell wiring
Status: Complete
Depends on: none
Files: Games.Client/wwwroot/games/inglenook/, Games.Client/wwwroot/games/registry.json, README.md
Model: sonnet
Effort: medium

- ✅ In the worktree `F:\Documents\Files\Apps\Games-inglenook` run `npm install`, then confirm `npm test` and `dotnet test Games.slnx` pass on the untouched baseline.
- ✅ Create `Games.Client/wwwroot/games/inglenook/index.js` exporting `mount(container, options)` that injects a stylesheet, renders a placeholder SVG board and a title, and returns `{ unmount, setOptions }` (unmount removes DOM, listeners, timers and audio).
- ✅ Create `styles.css` (full-height board, HUD placeholders, 16px minimum touch targets of 44px) and `config.js` (tuning constants: `WAGON_LEN`, `LOCO_SPEED`, `ACCEL_TIME`, star multipliers, `SOLVER_STATE_CAP`).
- ✅ Add `{ "id": "inglenook", "title": "Inglenook", "icon": "🚂", "module": "games/inglenook/index.js", "features": { "hardcore": false, "levels": false } }` to `registry.json`.
  - **Assumption:** `main` has no `features` support in the shell yet (that flag lives on the Delivery Driver branches); the unknown JSON property is ignored, so the entry is harmless and the shell Hardcore/Level rows still show for Inglenook until that lands. Not fixed here (out of scope).
- ✅ Wire `onExit` to a visible Back control and honour `setOptions({ paused })`.
- ✅ Add an Inglenook line to the README games list and Layout table (full section is written in phase 6).

### Verification Plan
- `dotnet test Games.slnx` passes (registry test finds the module file).
- `npm test` passes.
- `dotnet run --project Games.Client` starts; `curl -s http://localhost:<port>/games/registry.json` shows the `inglenook` entry and `curl -sI .../games/inglenook/index.js` returns 200.

### Phase Summary
Scaffolded `games/inglenook/` (`index.js` mount/unmount with Back button and `paused` handling, `config.js` constants, `styles.css`), registered in `registry.json`, README games list updated. Verified: `npm test` 58 pass, `dotnet test` 27 pass, registry and module served 200. `main` lacks the shell `features` flag (see assumption); worktree uses `npm install` already done. Later phases import constants from `config.js`.

## Phase 2: Track model and layouts
Status: Complete
Depends on: 1
Files: Games.Client/wwwroot/games/inglenook/track.js, Games.Client/wwwroot/games/inglenook/layouts.js, tests/js/inglenook.track.test.mjs
Model: sonnet
Effort: medium

- ✅ Implement `track.js`: a track graph of nodes and edges (each edge a straight or arc piece with length), points as nodes with `straight`/`diverging` exits and a current state, buffer stops as dead-end nodes, `positionAt(edge, distance)` returning `{x, y, angle}` for rendering.
- ✅ Implement route walking: `advance(position, distance, direction, pointsState)` returning the new position, stopping flags at buffers, and how points are traversed facing (trailing points behave correctly: a trailing move through a point set against it is ignored/forced by design; decide and document in code: trailing moves follow the point's setting, no derailment).
- ✅ Implement `layouts.js` with templates `classic` (5/3/3 capacity, headshunt, 2 points), `classic-long`, `ladder4`, `ladder5`, `loop` (run-round loop); each returns graph, siding list with capacities, goal siding id, loco start, plus SVG-ready geometry (coordinates in a fixed viewBox).
- ✅ Add a validator `validateLayout(layout)` (connected graph, all capacities > 0, no overlapping geometry, buffers at siding ends).
- ✅ Tests: walking along each template, point-state routing, buffer stop clamping, capacities match the template table, `validateLayout` passes for all templates and fails for deliberately broken ones.

### Verification Plan
- `node --test tests/js/inglenook.track.test.mjs` passes.
- `npm test` passes.

### Phase Summary
`track.js` (graph, `buildLayout`, `walk`, `pointAt`, foul zones, `validateLayout`) and `layouts.js` (`classic`, `classic-long`, `ladder4`, `ladder5`, `loop`; `getLayout(id)`). Units are wagon lengths; positions are `{track, d, dir}`; trailing moves always pass to the toe. Every point leg has a 2.9 foul zone (`POINT_FOUL`): phase 3 must refuse uncoupling and point-throwing there. Capacities are derived from track length (classic 5/3/3, headshunt loco+3). `walk` returns `pieces` for extending a rake path. 12 new tests; `npm test` 70 pass.

## Phase 3: Train simulation
Status: Complete
Depends on: 2
Files: Games.Client/wwwroot/games/inglenook/sim.js, tests/js/inglenook.sim.test.mjs
Model: sonnet
Effort: medium

- ✅ Implement `createSim(layout, wagons)` holding loco and wagon positions as distances along the graph, plus couplings between adjacent vehicles on the same track (loco-wagon and wagon-wagon).
- ✅ Implement `step(dt)` with latching controls `setDirection('forward'|'reverse'|'stop')`, easing speed over `ACCEL_TIME`, fixed top speed, and motion of the whole coupled rake as one unit.
- ✅ Auto-stop: stop at buffer stops (loco or rake end reaches the buffer), and stop when the leading vehicle meets an uncoupled vehicle; couple automatically on contact (loco to wagon, rake to wagon) with a `coupled` event and a small impact event for sound.
- ✅ Implement `toggleCoupling(index)` (uncouple at a tap) and `togglePoint(id)`; only allowed while the train is stopped or moving slowly? Decision: points may only be flipped when no vehicle occupies or is within one wagon length of the point (otherwise ignored with a `pointLocked` event); couplings may only be changed when stopped.
- ✅ Wagons that are uncoupled stay put (handbrake assumed); "stuck" obstacle wagons cannot be coupled (the loco stops against them without coupling).
- ✅ Emit events (`coupled`, `uncoupled`, `buffer`, `pointLocked`, `moved`) for the UI and a move counter definition used by phase 4.
- ✅ Tests: easing and stop distance, auto-couple, auto-stop at buffer, push then uncouple leaves wagons exactly where they were, point lock rules, stuck wagons never couple, deterministic replay of an input script yields identical final state.

### Verification Plan
- `node --test tests/js/inglenook.sim.test.mjs` passes.
- `npm test` passes.

### Phase Summary
`sim.js`: `createSim(layout, {vehicles, rakes, loco})`. Vehicles are grouped into rakes that own a path of track pieces (tail to head), so they follow the driven route through points. Latching `setDirection`, eased speed, auto-stop at buffers, auto-couple on contact (head or tail), stuck wagons only bump, `uncouple(rakeId, index)` refused while moving or if a loco-less rake would stand in a foul zone, `togglePoint` locked while any rake covers the point (`POINT_CLEAR` 0.5). Exposes `poses()`, `couplings()`, `onTrack(id)`, `stats` (couplings/uncouplings), `drainEvents()`, `snapshot()/restore()`. 13 tests; `npm test` all pass.

## Phase 4: Levels, solver and stars
Status: Not started
Depends on: 2, 3
Files: Games.Client/wwwroot/games/inglenook/levels.js, Games.Client/wwwroot/games/inglenook/solver.js, Games.Client/wwwroot/games/inglenook/logic.js, tests/js/inglenook.levels.test.mjs, tests/js/inglenook.solver.test.mjs
Model: sonnet
Effort: medium

- [ ] Add `rng.js`-style seeded RNG inside `levels.js` (mulberry32 or the repo's existing seeded RNG if reusable) so `generateLevel(n)` is deterministic: the same level number gives the same level on every device.
- [ ] Define the difficulty curve in `levels.js`: level number to `{ template, wagonCount, goalLength, stuckWagons, blockedSidings }`. Level 1-5 classic with 4-5 wagons and a goal of 3; classic 8 wagons and goal of 5 from level 6; obstacles from about level 15; bigger layouts from about level 25; cap the growth so level 100+ stays solvable and fast to generate.
- [ ] Define the abstract move model in `solver.js` (document in the file header): one "move" = couple the loco to a rake at one end of a siding (taking 1..k wagons), travel through the points to a destination siding, and uncouple the rake there (fully or partly). Count one move per such transfer. Points that need flipping are implied by the route.
- [ ] Implement the BFS solver over abstract state (wagon order per siding, loco side) with a state cap of `SOLVER_STATE_CAP`; return the minimum number of moves (the par) and an optional solution for a hint.
- [ ] Generator loop: build a random level, run the solver, accept only if solvable and par is within the intended band for that level; otherwise retry with sub-seed + 1 (bounded retries; fallback to the template's guaranteed-solvable base position).
- [ ] Implement `logic.js`: `checkWin(sim, goal)`, `countMoves(events)` consistent with the solver's definition, `starsFor(moves, par)` (3 / 2 / 1 per the assumption above), `levelSummary(n)`.
- [ ] Tests: determinism for levels 1..200, every generated level solvable with par >= 1, par never above a sane cap, abstract move count matches the sim for scripted solutions on `classic`, star thresholds, win detection with irrelevant wagons elsewhere.
- [ ] Performance guard test: generating levels 1..200 stays under a few seconds in Node.

### Verification Plan
- `node --test tests/js/inglenook.levels.test.mjs tests/js/inglenook.solver.test.mjs` passes.
- `npm test` passes.

### Phase Summary
_(write when phase completes)_

## Phase 5: SVG renderer and input
Status: Not started
Depends on: 3, 4
Files: Games.Client/wwwroot/games/inglenook/render.js, Games.Client/wwwroot/games/inglenook/ui.js, Games.Client/wwwroot/games/inglenook/index.js, Games.Client/wwwroot/games/inglenook/styles.css
Model: sonnet
Effort: medium

- [ ] Implement `render.js`: draw the static board (baize/grass, sleepers, rails, buffer stops with lamps, scenery: goods shed, signal box, water tower, fence) from the layout geometry, and the dynamic layer (shunter, wagons with colour and number, couplings with tappable hook hit areas, point blades with tappable switch levers) as SVG elements updated each frame.
- [ ] Draw period details: a generic 1960s diesel shunter (blue/green livery, no logos), 16-ton mineral wagons, vans, open wagons and tank wagons in muted liveries, plain `B 482113`-style numbers. Wagon colours must stay distinguishable (also by number and a small shape marker) for colour-blind safety.
- [ ] Implement `ui.js`: HUD with level number, moves, par, stars, goal strip (target wagon order and a tick when matched), Forward / Stop / Reverse buttons, Undo, Reset, Skip level, Mute, and a win overlay with stars and Next level.
- [ ] Input: tap point levers and coupling hooks (44px hit areas), keyboard W/S/↑/↓ for reverse/forward, Space for stop, 1-9 to flip points, U for undo, R for reset; tap-to-stop on the board background.
- [ ] Wire `index.js`: fixed-timestep loop (60 Hz) driving `sim.step`, level load from progress, win detection, `onReward(stars)` on completion, `unmount` cleanup (cancel rAF, remove listeners).
- [ ] Undo is implemented by snapshotting the sim state before each coupling/uncoupling/point change (cap of 50 snapshots); Reset restores the level start.
- [ ] Add the `window.__ig` debug hook (only when `options.debug`): `state`, `level`, `solve()` (hint), `tryMove(script)`, `winNow()` for e2e.

### Verification Plan
- `npm test` passes.
- `dotnet test Games.slnx` passes.
- Launch via the `run` workflow: start the app, open `/play/inglenook`, take a screenshot of level 1, confirm the board, goal strip and controls render without console errors (Playwright MCP or Edge).

### Phase Summary
_(write when phase completes)_

## Phase 6: Audio, progress, e2e and docs
Status: Not started
Depends on: 5
Files: Games.Client/wwwroot/games/inglenook/audio.js, Games.Client/wwwroot/games/inglenook/index.js, tests/e2e/inglenook.spec.mjs, tests/js/inglenook.save.test.mjs, README.md, _docs/code-docs/
Model: sonnet
Effort: medium

- [ ] Implement `audio.js`: WebAudio synth only: diesel idle rumble that rises with speed, coupling clank, buffer thump, point click, success whistle; honour `soundEnabled` and the in-game Mute; resume the AudioContext on the first gesture.
- [ ] Implement progress save in `logic.js`/`index.js`: `{ level, best: { [n]: { stars, moves } }, muted }` via `loadProgress`/`saveProgress`, tolerant of missing or malformed data; unit test in `tests/js/inglenook.save.test.mjs`.
- [ ] Add `tests/e2e/inglenook.spec.mjs`: open `/play/inglenook`, use `window.__ig.solve()` to apply the solver's moves via the real controls where practical (or `winNow()` as a fallback), assert the win overlay and stars appear, assert Next level loads level 2 and Reset restores it.
- [ ] Phone fit: check the board and controls at a phone-size viewport (add Inglenook to the existing phone-fit pattern or a dedicated check in the new spec); fix any overflow.
- [ ] Add an **Inglenook** section to `README.md`: how to play, controls table, difficulty curve, folder layout, debug hook, the 1960s setting and the no-real-logos note.
- [ ] Run the `doc-code`-equivalent pass is not needed (JS only); instead confirm the README lists every new module.

### Verification Plan
- `npm test` passes.
- `dotnet test Games.slnx` passes.
- `npx playwright test tests/e2e/inglenook.spec.mjs` passes (unrelated Delivery Driver e2e failures are out of scope).

### Phase Summary
_(write when phase completes)_

## Final Recap
_(write when all phases complete: summary of the entire piece of work)_

## Deployment Plan
_(write when all phases complete: step-by-step deployment instructions. Authorised final step per Decisions & Answers: merge `feature/inglenook` into `main` and `git push origin main`; confirm the Pages workflow run starts.)_
