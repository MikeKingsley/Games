# Inglenook visual realism pass

Make the Inglenook shunting game look and sound like a real 1960s Western Region goods yard seen from directly overhead: true curved pointwork, a GWR 64xx pannier tank in BR green, period wagons, textured ground, composed yard scenery with daylight shadows, steam effects and steam sound, and a light period restyle of the HUD. **Puzzles, par, timing and controls must not change.**

## Decisions & Answers

Original request (user, 2026-11-10): `/planout a visual realism pass` (run in the Inglenook worktree straight after the Inglenook bug-fix PR).

- **Q:** I'm assuming the visual realism pass is for the Inglenook shunting game. Which areas should it cover? (multi-select: Track and pointwork / Rolling stock / Yard scenery and ground / Motion and effects) — **A:** "Track and pointwork, Rolling stock, Yard scenery and ground, Motion and effects, Steam train a shunter. 64xx pannier br green". (All four areas, and the loco becomes a steam shunter: a 64xx pannier tank in BR green.)
- **Q:** Wagons are currently bright colours so the goal train is easy to read. Real 1960s wagons were bauxite brown, grey and rust. How should realism and readability be balanced? — **A:** "Realistic body, bold ID panel (Recommended)". Bodies in period liveries with weathering; each wagon keeps a clear coloured panel with its number and shape, matching the goal strip chips.
- **Q:** Track is currently straight segments with sharp corners, and a wagon jumps to the new angle at each kink. How far should curved track go? — **A:** "Real curves in the track model (Recommended)". Turnouts and bends become true arcs in the track geometry, and each wagon sits on the curve by its two axles. Siding capacities stay the same; the track tests are updated.
- **Q:** The game is drawn as live SVG shapes today (no image files). What rendering approach may the realism pass use? — **A:** "if you can generate the image art, then images otherwise svgs".
- **Q (follow-up):** I have no image generator, so I cannot produce painted or photo-style pictures. I can generate textures in code that are built in the browser when the game loads. Which approach should the plan use? — **A:** "SVG plus code-generated textures (Recommended)". Vehicles, track and buildings stay as detailed SVG; ground, ballast and weathering use textures generated in code at load time. No image files to download; works offline as now.
- **Q:** The loco becomes a 64xx pannier tank in BR green. The current sound is a diesel engine rumble. Should the sound change too? — **A:** "Yes, steam sounds (Recommended)". Exhaust chuffs timed to the wheels, a steam hiss when standing, and a whistle for the win. Still synthesised, no audio files.
- **Q:** A real 64xx is about 1.7 times the length of a 16-ton mineral wagon, but the current loco is only 1.1 wagon lengths. Should proportions be true to scale? — **A:** "True-to-scale loco (Recommended)". The headshunt grows to match so every puzzle still fits and plays the same.
- **Q:** How should the yard be lit? — **A:** "Daylight with soft shadows (Recommended)". One fixed sun direction; vehicles, buildings, fences and trees cast soft shadows; rails catch a highlight. Same look on every level.
- **Q:** Should the viewpoint stay overhead? — **A:** "Stay directly overhead (Recommended)". Plan view; depth comes from shadows, highlights and roof detail. Buildings show roofs.
- **Q:** How much scenery variety should there be between levels? — **A:** "One rich yard per layout (Recommended)". Each track layout gets one composed 1960s goods yard; small seeded details such as clutter positions vary by level.
- **Q:** Should the train's movement feel change, or only how it looks? — **A:** "Looks only, same timing (Recommended)". Speed, acceleration and stopping stay exactly as now; buffer squeeze, coupling slack and rocking are purely visual.
- **Q:** Should the heads-up display and buttons be restyled to match the period? — **A:** "Light period touch (Recommended)". Same layout and button sizes, enamel-sign colours and a period typeface feel; the goal strip looks like a shunter's wagon list. Readability and touch targets unchanged.
- **Q:** How should the plan handle branches, commits and pushing? — **A:** "New branch, local commits only (Recommended)". Create `feature/inglenook-realism` from the latest `main` in this worktree. One local checkpoint commit per verified phase. Nothing is pushed; the user runs commit-and-pr when happy.
- **Q:** How should the game cope with a slow device? — **A:** "Automatic fallback (Recommended)". The game measures its frame rate and quietly drops steam particles and soft shadows if it falls behind; it also honours the device's reduce-motion setting. No new buttons.
- **Q:** How should the tappable point levers and couplings look? — **A:** "Realistic part plus a clear marker (Recommended)". A real ground lever beside each point and three-link couplings between wagons, each with a small high-visibility ring or arrow so it is obvious what can be tapped and which way a point is set.
- **Q:** Is this the complete scope? (IN: curved turnouts and two-axle wagons; 64xx pannier at true scale; period wagons with ID panel; textured ground, track, blades, levers, couplings; one composed yard per layout with shadows; steam, squeeze, rocking with slow-phone fallback; steam sounds; light HUD restyle. OUT: any change to puzzles, par, timing or controls; new layouts; other games; image files.) — **A:** "Complete, write the plan".
- **Q:** Should before and after screenshots be saved in the repository alongside the plan? — **A:** "Yes, commit them (Recommended)". PNGs under `_docs/plans/0014-shots/`, committed with the phases.

Assumptions (not asked; defaults chosen while planning, change only with the user):
- **Models and effort.** The user gave no model preference, so the skill defaults apply: sonnet throughout, effort medium except the geometry phase (high).
- **Loco identity.** GWR 6400 class 0-6-0 pannier tank (built 1932-37, auto-fitted, in BR service until 1964), in BR lined green. Plan view shows: red buffer beams, black running plate, black smokebox with a copper-capped chimney, green boiler top between two long green pannier tank tops (filler lids, lining along the edges), green dome, brass safety-valve bonnet, dark cab roof with rain strips, coal bunker with coal at the rear. No BR crest, no real logos (carried over from plan 0013); the number is not visible from above.
- **Scale.** `LOCO_LEN` becomes `1.7` (wagon body = 1). All wagons stay exactly 1 unit long, whatever their type, so the simulation is unchanged.
- **Wagon types.** Chosen deterministically from the wagon number (no change to level data): 16-ton steel mineral (BR grey, coal load), 12-ton ventilated van (bauxite, ribbed roof), 5-plank open (bauxite or grey, sheeted or with a load), 14-ton tank wagon (black with a filler dome and walkway). Weathering varies per wagon from a hash of its id.
- **ID panel.** The six existing `COLORS` and `SHAPES` in `levels.js` are kept, so goal chips still match. The panel (colour, number, shape) stays upright on screen as it does today (the user's earlier fix: numbers must not move when reversing), and is at least 0.6 x 0.4 wagon lengths.
- **Stuck wagons** look like a crippled wagon: rusty grey body, wheel scotches, a red "not to be moved" target; no ID panel. The red cross stays so it is unmistakable.
- **Sun direction** is fixed in yard coordinates (shadows fall down-right in landscape). When the yard is turned for portrait the shadows turn with it.
- **Typeface.** No web fonts (the game works offline): a Gill Sans style stack `'Gill Sans', 'Gill Sans MT', Calibri, 'Trebuchet MS', sans-serif`. HUD colours follow Western Region chocolate and cream.
- **Quality fallback** only ever steps down during a session (never back up) to avoid flicker.
- **Saved progress** format is unchanged.

## For Future Agents
As work proceeds: set a phase's status to `In progress` when you start it and flip each item to `- ✅` as soon as it completes; when a phase is done, run its **Verification Plan**, write its **Phase Summary** (max ~5 lines: what was done, key decisions, anything later phases need), and set its status to `Complete` (`execute-plan` then makes a local checkpoint commit on `feature/inglenook-realism`; **never push**). Never ask the user questions; record any assumption inline. When all phases are done, fill in **Final Recap** and **Deployment Plan**.

**If verification fails:** fix the cause and rerun. Never weaken a puzzle, solver, simulation-timing or phone-fit assertion to get green; adjust the new geometry or art instead. If frame rate or DOM budgets fail, cut detail (fewer elements, no filters) rather than raising the budget. If an item cannot be done, mark it `- ⛔` with a `**Blocked:**` note and continue with phases that do not depend on it.

Repo facts (verified 2026-11-10):
- **Worktree and branch.** Work in `F:\Documents\Files\Apps\Games-inglenook`. It is on `feature/inglenook` (c3f960d), which was merged to `main` by PR #1 (`origin/main` = 5a89883). This plan file is uncommitted in that worktree; `git switch -c feature/inglenook-realism origin/main` carries it across. Other worktrees (`Games`, `Games-playtest`) hold unrelated Delivery Driver work: never touch them. Stage only Inglenook files, `tests/`, `README.md` and `_docs/plans/0014*`.
- **Plan numbers.** 0006-0012 live on Delivery Driver branches, 0013 is Inglenook; 0014 is the next free number across all branches.
- **Game files** (`Games.Client/wwwroot/games/inglenook/`): `index.js` (mount, 60 Hz loop, undo, events), `ui.js` + `styles.css` (HUD), `render.js` (all SVG drawing, 280 lines), `track.js` + `layouts.js` (track graph, polylines in wagon-length units), `sim.js` (rakes on paths; `poses()`, `couplings()`), `solver.js`, `levels.js`, `logic.js`, `autoplay.js`, `audio.js` (WebAudio synth), `config.js`. New files under `wwwroot` need a dev-server restart to avoid 404s.
- **Geometry today.** A track is a polyline `pts` with cumulative lengths `cum`; `pointAt(layout, track, d)` returns `{x, y, angle}`; a diverging leg leaves its point at a sharp 39 degree kink (`SLANT_DX` 2.2, `ROW` 1.8). Lengths drive the puzzle: `sidingLength(n)` and `headshuntLength(n)` (in `track.js`) give capacities, `POINT_FOUL` = 2.9 is the no-standing zone on each leg. `headshuntLength` already includes `LOCO_LEN`, so changing `LOCO_LEN` lengthens the headshunt and keeps `headCapacity`.
- **Renderer contract that tests and input rely on.** One `<svg class="ig-board">` reused across levels; `createRenderer(svg, layout, handlers)` returns `{ update(sim), destroy() }`; `destroy()` must remove its `pointerdown` listener and `ResizeObserver` (bug fixed in c3f960d). All drawing sits inside `<g class="ig-world">`, which is rotated 90 degrees with a swapped `viewBox` on tall screens; upright text counter-rotates (`labelEls`, and vehicle labels use `rotate(-deg - 90)` when turned). Selectors used by e2e: `.ig-board`, `.ig-point[data-point="P2"]`, `.ig-hook[data-index]` (with `data-hook`, `data-rake`), `.ig-vehicle.loco`, `.ig-chip`, `.ig-level`, `.ig-win`, `.ig-winstars`, `.ig-next`, `.ig-controls .ig-btn`. Keep every one of them.
- **Events** from `sim.drainEvents()`: `moved {distance}`, `coupled`, `uncoupled`, `buffer`, `bumped`, `pointThrown {point, state}`, `pointLocked`, `uncoupleBlocked`. `index.js` `handleEvents()` calls `audio.play(e.type)` for each. Undo calls `sim.restore()`, which teleports vehicles.
- **Tests.** `npm test` (100 pass, about 30 s; includes generating levels 1-200 and autoplaying 12 solutions through the real sim). `npx playwright test "inglenook.spec"` runs the Inglenook e2e (uses installed Microsoft Edge, starts `dotnet run` on :5211 itself; port must be free). **Do not use the bare filter `inglenook`**: it matches the worktree folder name and runs all 92 tests (about 2 minutes; fine as a final gate). `dotnet test Games.slnx` runs the shell tests (27).
- **Debug hook** `window.__ig` (Development only): `sim`, `level`, `won`, `progress`, `start(n)`, `onEvent(fn)`, `solve()`.
- **Levels by layout:** level 1 = `classic`, 26 = `classic-long`, 25 = `ladder4`, 61 = `ladder5`, 20 = `classic` with a stuck wagon.

Target module layout after this plan (all in `Games.Client/wwwroot/games/inglenook/`):

| File | Owns | Interface |
|---|---|---|
| `svg.js` | shared helpers | `NS`, `el(name, attrs, parent)`, `polyline(pts)` |
| `render.js` | layers, turn/fit, input, per-frame orchestration | `createRenderer(svg, layout, handlers, opts)` -> `{ update(sim, dt), onEvent(e), reset(), setQuality(q), destroy() }`; `opts = { level, reducedMotion }` |
| `noise.js` | DOM-free seeded, tileable value noise | `hash(str)`, `rng(seed)`, `tileNoise(size, seed, octaves)` |
| `textures.js` | canvas-generated textures as SVG patterns, cached per session | `createTextures(defs)` -> `{ ballast, cinder, grass, setts, timber, coal, grime }` (pattern ids) |
| `draw-track.js` | ground, ballast, sleepers, rails, pointwork, buffer stops, levers | `drawTrack(layers, layout, ctx)` -> `{ update(sim, dt), onEvent(e) }` |
| `draw-stock.js` | wagons, pannier, couplings | `drawWagon(parent, w, ctx)`, `drawLoco(parent, ctx)`, `drawCoupling(parent, ctx)`, `BODY_W` |
| `scenery-plan.js` | DOM-free scenery placement | `planScenery(layout, seed)` -> `[{ type, x, y, rot, w, h }]` |
| `draw-scenery.js` | buildings, lamps, trees, clutter and their static shadows | `drawScenery(layers, layout, items, ctx)` |
| `effects.js` | steam, smoke, vehicle shadows, squeeze, rocking | `createEffects(layers, ctx)` -> `{ update(sim, poses, dt), onEvent(e), reset(), setQuality(q), destroy() }` |
| `quality.js` | DOM-free quality decision | `createQualityMonitor({ reducedMotion })` -> `{ sample(dtMs), level }` (`'high'` or `'low'`) |

`ctx` = `{ defs, textures, quality, seed }`. Layer order inside `.ig-world`, bottom to top: `ground`, `sceneryLow`, `ballast`, `sleepers`, `rails`, `shadows`, `points`, `vehicles`, `hooks`, `sceneryHigh` (lamp heads, tree canopies), `steam`.

## Recommended Model

| Phase | Model | Effort | Why |
|---|---|---|---|
| 1 Branch, baseline, renderer split | sonnet | medium | Mechanical refactor with tests and screenshots as guard |
| 2 Curved track, true-scale loco, two-axle poses | sonnet | high | Arc geometry with length and clearance invariants; guarded by unit tests |
| 3 Textures, ground and trackwork | sonnet | medium | SVG drawing against a fixed interface |
| 4 Rolling stock | sonnet | medium | SVG art: pannier, wagons, couplings |
| 5 Scenery and lighting | sonnet | medium | Placement module with tests plus SVG art |
| 6 Motion, effects and quality fallback | sonnet | medium | Per-frame effects and a small tested monitor |
| 7 Steam sound | sonnet | medium | WebAudio synth following the existing pattern |
| 8 HUD restyle, e2e, docs, after shots | sonnet | medium | CSS, tests, README |

## Phase 1: Branch, baseline, renderer split
Status: Complete
Depends on: none
Files: Games.Client/wwwroot/games/inglenook/render.js, svg.js, draw-track.js, draw-stock.js, draw-scenery.js, index.js; tests/e2e/inglenook.shots.spec.mjs; tests/js/inglenook.levels.snapshot.test.mjs; _docs/plans/0014-shots/before/
Model: sonnet
Effort: medium

- ✅ In the worktree run `git fetch origin` then `git switch -c feature/inglenook-realism origin/main` (the uncommitted plan file comes along). Confirm `npm test` passes (100) and `npx playwright test "inglenook.spec"` passes on the untouched baseline.
- ✅ Add `tests/js/inglenook.levels.snapshot.test.mjs`: for levels 1, 5, 10, 20, 25, 26, 61 and 100 assert `template`, `placement`, `goal` and `par` equal values captured now (inline the captured JSON in the test). This is the "puzzles are identical" guard for the whole plan.
  - One test per level (8 tests), so `npm test` is now 108, not 101.
- ✅ Add `tests/e2e/inglenook.shots.spec.mjs`: saves eight PNGs of `.ig-root` with these exact names: `classic-1024.png`, `classic-844.png`, `classic-390.png` (level 1 at 1024x768, 844x390, 390x844), `long-1024.png` (level 26), `ladder5-1024.png` (level 61), `stuck-1024.png` (level 20), `loco-close.png` (level 1, clip of about 6 wagon lengths around the loco at 1600x900) and `moving.png` (level 1 at 1024x768 after Forward has run 1.5 s). Output folder: `_docs/plans/0014-shots/<IG_SHOTS>/` when the env var `IG_SHOTS` is set, otherwise `test-results/inglenook-shots/`. Each test also asserts no page errors.
- ✅ Capture the baseline: run the shots spec with `IG_SHOTS=before` and keep the eight PNGs in `_docs/plans/0014-shots/before/`.
- ✅ Create `svg.js` (`NS`, `el`, `polyline`) and split `render.js` with **no visual change**: move track, ballast, sleepers, rails, buffers and point levers into `draw-track.js`; `drawWagon`, `drawLoco`, `BODY_W` and the hook drawing into `draw-stock.js`; `drawScenery` into `draw-scenery.js`. `render.js` keeps the world group, turn/fit logic, `labelEls`, the pointer listener and the per-frame update, and creates the named layers listed above (empty ones are fine).
- ✅ Extend the renderer API to `createRenderer(svg, layout, handlers, opts)` returning `{ update(sim, dt), onEvent(e), reset(), setQuality(q), destroy() }` (new methods are no-ops for now). In `index.js` pass `{ level, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches }`, pass `dt` to `update`, call `renderer.onEvent(e)` for every event in `handleEvents()`, and call `renderer.reset()` after `sim.restore()` in `undo()`.

### Verification Plan
- `npm test` passes (now 101+ with the snapshot test).
- `npx playwright test "inglenook.spec"` passes (10 tests).
- `npx playwright test "inglenook.shots"` passes; open `test-results/inglenook-shots/classic-1024.png` and `_docs/plans/0014-shots/before/classic-1024.png` with the Read tool: they must look the same (the split changed nothing).
- `git status --short` shows only the files listed above plus this plan.

### Phase Summary
Branch `feature/inglenook-realism` created from `origin/main` (5a89883); baseline shots saved to `_docs/plans/0014-shots/before/`; `render.js` split into `svg.js`, `draw-track.js` (ground, ballast, sleepers, rails, buffers, point levers and blades), `draw-stock.js` (`drawWagon`, `drawLoco`, `drawCoupling`, `BODY_W`) and `draw-scenery.js`; `render.js` creates the 11 named layers and still owns turn/fit, `labelEls`, pointer input and the frame update.
Renderer API is now `createRenderer(svg, layout, handlers, opts)` with `update(sim, dt)`, `onEvent`, `reset`, `setQuality` (the last three are stubs); `index.js` passes `{ level, reducedMotion }`, `dt`, events and calls `reset()` after undo. The renderer `ctx` is `{ defs, textures: null, quality, seed, labelEls, isTurned() }`; lever labels register into `ctx.labelEls`.
Snapshot test is one test per level (8), so `npm test` is 108. Seven of the eight after-split shots are byte-identical to the baseline; `classic-390.png` differs in bytes only and looks the same.
Buffers are drawn in the `rails` layer (above rails, below points) and the old `.ig-track`/`.ig-points`/`.ig-vehicles`/`.ig-hooks` group classes became `.ig-layer-*`; no test selector used them.

## Phase 2: Curved track, true-scale loco, two-axle poses
Status: Complete
Depends on: 1
Files: Games.Client/wwwroot/games/inglenook/track.js, layouts.js, sim.js, config.js; tests/js/inglenook.track.test.mjs, tests/js/inglenook.sim.test.mjs
Model: sonnet
Effort: high

- ✅ In `track.js` add a path builder for track centre-lines made of straights and circular arcs: `pathFrom(x, y, heading).straight(len).arc(radius, angleRad)...build()` returning a dense polyline (sample step at most 0.05) plus the exact length and end heading. `buildLayout` keeps storing `pts` and `cum` (so `walk`, the sim and the solver are untouched) and additionally stores per-vertex headings so `pointAt` returns a smoothly interpolated `angle` instead of a per-segment step.
  - `build()` returns `{ pts, hdg, length, end }`; a track spec may carry `hdg` and an exact `length` (cum is stretched by about 1e-5 so the track is exactly as long as designed). Specs without `hdg` get central-difference headings. Also added `MIN_RADIUS` 3.0 and `PATH_STEP` 0.05; `pointAt` now uses binary search.
- ✅ Rebuild every template in `layouts.js` (`classic`, `classic-long`, `ladder4`, `ladder5`, `loop`) with the builder so that **every leg leaves its point tangent to the toe's heading**. Fan sidings A and C become reverse curves (two equal arcs) from the toe heading to a parallel row `ROW` = 1.8 away; ladder connectors curve from the toe heading up to the ladder angle then run straight; each ladder siding curves from the ladder angle back to its row. Starting values: `TURNOUT_RADIUS` about 3.5 (never below 3.0), fan arc angle about 42 degrees, ladder angle about 31 degrees. Put the constants at the top of `layouts.js`.
  - Final constants: `TURNOUT_RADIUS` 3.5, `FAN_ANGLE` = acos(1 - ROW / 2R) = 42.02 degrees (each arc of the reverse curve), `LADDER_ANGLE` = atan2(ROW, CONNECTOR) = 30.96 degrees. Ladder: connector L1 = short lead-in straight + arc + straight (so it keeps the old 3.4986 length); later connectors are straight at the ladder angle; ladder sidings S2.. curve back to horizontal; the last siding runs one connector along the ladder, then curves back.
  - **Assumption:** the `loop` template uses `LOOP_RADIUS` 3.0 (the minimum allowed) because the two reverse curves of loop track L must fit in the fixed 9.09 length of the connector S; with R 3.5 they do not fit. No level uses the loop template. Its loop track L is now 10.065 long (was 10.374: cutting the corners shortens it) with capacity 3 (was 4); the loop test only asserts capacity >= 1.
- ✅ Keep every track's **total length exactly as today's formulas give** (`sidingLength(cap)`, `headshuntLength(head)`, connector `M` = 3.0, the `loop` formula): the curve takes its share and the straight tail takes the rest. Capacities and `headCapacity` must come out unchanged: classic 5/3/3 head 3, classic-long 7/4/4 head 4, ladder4 5/3/3/3 head 3, ladder5 6/3/3/3/3 head 3.
- ✅ Extend `validateLayout` with: tangent continuity at each point (leg start heading equals toe heading within 0.5 degrees); no heading change above 2 degrees between consecutive samples; the two branch legs of every point are at least 0.9 apart (centre-line distance) at `POINT_FOUL` along each leg and stay at least that far apart beyond it; every pair of different tracks is at least 0.9 apart outside the foul zones of a shared point. Make the crossing check cope with dense polylines (sample every 0.25 for the pairwise checks).
- ✅ Set `LOCO_LEN = 1.7` in `config.js`. Check nothing else hard-codes 1.1 (`grep -rn "1\.1" Games.Client/wwwroot/games/inglenook`).
  - Only `render.js:40` (an unrelated 1.1 hysteresis factor) matches. `tests/e2e/inglenook.shots.spec.mjs` line 51 derives the wagon length from the loco box using `/ 1.1`; it is outside this phase's files, so it is left alone (the `loco-close` clip just gets about 1.5x wider). Later phase: change it to `/ 1.7`.
- ✅ In `sim.js` `poses()` place each vehicle on two axle points instead of its centre: sample the rake path at `centre - wb/2` and `centre + wb/2` (`wb` = 0.6 x vehicle length for wagons, 0.5 x for the loco), return `x, y` as their midpoint and `angle` as the direction from the first to the second. `track` and `d` stay the centre values (win detection and `onTrack` depend on them). `couplings()` is unchanged.
  - **Assumption:** the curved ladder and fan made point levers 2 to 4 sit on top of a curving track, so `draw-track.js` (outside the Files line, smallest change) now reads the diverging direction with `pointAt` at distance 1 instead of `pts[1]`, and flips a lever to the other side when another point's track passes within 1.2 of its spot. Richer lever art stays with Phase 3.
- ✅ Update `tests/js/inglenook.track.test.mjs` and `inglenook.sim.test.mjs` for the new geometry (the old test asserts a slant heading at `pointAt(l, 'A', 1)`: replace with tangent-at-point and parallel-at-end assertions) and add tests for: builder arc length and end heading, the new validator rules passing for all five templates and failing for a deliberately tight curve, unchanged capacities, a wagon on a curve whose pose angle lies between its two axle headings, and pose equal to the old centre pose on straight track.

### Verification Plan
- `node --test tests/js/inglenook.track.test.mjs tests/js/inglenook.sim.test.mjs` passes.
- `npm test` passes, **including the unchanged level snapshot test and the "real simulation solves levels with exactly par uncouplings" test** (this proves the longer loco and curves did not change any puzzle).
- `npx playwright test "inglenook.spec"` passes.
- `npx playwright test "inglenook.shots"` then Read `test-results/inglenook-shots/classic-1024.png` and `ladder5-1024.png`: track curves smoothly out of every point with no kink, sidings are parallel, the loco is clearly longer than a wagon, nothing overlaps or leaves the board.

### Phase Summary
Tracks are now built with `pathFrom(x, y, heading).straight().arc().build()` -> `{ pts, hdg, length, end }` (dense polyline, vertices <= 0.05 apart, exact length, per-vertex headings in `layout.tracks[id].hdg`); `pointAt` interpolates heading smoothly. `validateLayout` checks tangency (0.5 deg), heading step (2 deg), minimum radius 3.0, branch separation 0.9 from `POINT_FOUL` onwards and pairwise track separation outside foul zones. Rails/sleepers for later phases can be taken from `pointAt(layout, id, d)` (x, y, angle) or `t.pts` + `t.hdg` (offset rails by +/- 0.18 along the normal of `hdg`).
Constants (`layouts.js`): `ROW` 1.8, `TURNOUT_RADIUS` 3.5, `FAN_ANGLE` 42.02 deg (each of two arcs), `LADDER_ANGLE` 30.96 deg, `CONNECTOR` 3.0, `LOOP_RADIUS` 3.0 (the loop template only; its L track is 10.065 long, capacity 3). All track lengths and capacities equal the old formulas (classic 5/3/3 head 3, long 7/4/4 head 4, ladder4 5/3/3/3, ladder5 6/3/3/3/3). `LOCO_LEN` is 1.7.
`poses()` now returns the midpoint and chord direction of two axles (wheelbase 0.6 x length for wagons, 0.5 for the loco); `track` and `d` stay the centre values and `couplings()` is unchanged, so hooks sit on the centre line. `draw-track.js` also got a small lever-placement fix (see item 6). Phase 4 should use `LOCO_LEN` 1.7 for the pannier body and expect a pose `angle` that can differ from the track heading by about 1 degree on curves.
Checks: `npm test` 119 pass (level snapshots and par test unchanged), Playwright inglenook.spec 10 pass, inglenook.shots 8 pass, PNGs show smooth curves, parallel sidings and a clearly longer loco. `tests/e2e/inglenook.shots.spec.mjs` line 51 still divides the loco box by 1.1 (to get a wagon length): change to 1.7 in a later phase.

## Phase 3: Textures, ground and trackwork
Status: Not started
Depends on: 1, 2
Files: Games.Client/wwwroot/games/inglenook/noise.js, textures.js, draw-track.js, render.js; tests/js/inglenook.noise.test.mjs
Model: sonnet
Effort: medium

- [ ] Add `noise.js` (DOM-free): `hash(str)`, `rng(seed)` and `tileNoise(size, seed, octaves)` returning a `Float32Array` of values 0..1 that tiles seamlessly. Test determinism, range and that opposite edges match.
- [ ] Add `textures.js`: paint tileable 256 px textures to a canvas from `tileNoise` and register each as an SVG `<pattern>` with an `<image>` (PNG data URL) in the board's `<defs>`: `ballast` (grey-brown stone speckle), `cinder` (dark ash yard surface), `grass` (mottled green), `setts` (stone setts for the shed apron), `timber` (sleeper and plank grain), `coal`, `grime` (transparent dark streaks for weathering). Cache the data URLs at module level so a level restart does not regenerate them; if a 2D canvas is unavailable fall back to flat fills.
- [ ] Ground in `draw-track.js`: a `cinder` yard surface under and around the tracks (a wide rounded band following each track, so the yard reads as trodden ash), `grass` beyond it, and a `ballast` shoulder with a slightly darker oily strip between the rails.
- [ ] Sleepers and rails: timber sleepers drawn cheaply along the curves (one wide dashed stroke per track with `stroke-dasharray`, using the `timber` pattern, not one element per sleeper); two rails per track as offset polylines with a dark web and a thin bright running-surface highlight; rail joints every 2 wagon lengths.
- [ ] Pointwork for every point: closure rails and a crossing vee (frog) where the branch rails cross, check rails opposite the frog, long timbers under the point, and two switch blades that sit against the stock rail for the set route. Blades tween between positions over 150 ms on `pointThrown` (instant when quality is `low` or reduced motion).
- [ ] Buffer stops as rail-built stops with a red beam and a lamp, replacing the current blocks.
- [ ] Ground levers: a weighted point lever on a timber base beside each point (same position rule as today), whose arm flips sides with the point, inside the existing `.ig-point[data-point]` group with its transparent 0.95-radius hit circle. Keep a high-visibility marker: a yellow ring round the lever, a yellow arrow showing the set route and the point number (upright via `labelEls`), and a subtle yellow highlight along the set route's blade.

### Verification Plan
- `npm test` passes (noise tests included).
- `npx playwright test "inglenook.spec"` passes (lever taps and the tap-twice check still work).
- `npx playwright test "inglenook.shots"` then Read `classic-1024.png`, `ladder5-1024.png`, `classic-390.png` from `test-results/inglenook-shots/` and check: textured ground with no visible tile seams; rails continuous through every point with a visible frog and blades set for the straight route; sleepers evenly spaced and square to the track on curves; each lever has its yellow marker and an upright number in both landscape and portrait.
- In a Playwright one-off (or the shots spec) assert `document.querySelectorAll('.ig-board *').length < 2500` on level 61.

### Phase Summary
_(write when phase completes)_

## Phase 4: Rolling stock
Status: Not started
Depends on: 2, 3
Files: Games.Client/wwwroot/games/inglenook/draw-stock.js; tests/js/inglenook.stock.test.mjs
Model: sonnet
Effort: medium

- [ ] Export a DOM-free `wagonSpec(w)` from `draw-stock.js` (or a small `stock-spec.js` beside it) returning `{ type, livery, weathering }` from the wagon number and a hash of its id; test that it is deterministic, covers all four types across numbers 1-12 and never returns an ID-panel colour as the body colour.
- [ ] Draw the four wagon types in plan view, 1 unit long and `BODY_W` wide, with buffers and a drawhook in the coupling gap: 16-ton steel mineral (grey sides seen as a rim, `coal` load heaped inside, top-flap door outline), 12-ton van (bauxite, ribbed curved roof with a highlight along the ridge and roof vents), 5-plank open (planked `timber` floor or a roped tarpaulin sheet, chosen from the hash), 14-ton tank (black barrel with end straps, filler dome, walkway and ladder).
- [ ] Weathering: a `grime` overlay clipped to each body, rust patches and brake-dust tone from the hash, lighter on some wagons than others. Skip the overlay when quality is `low`.
- [ ] ID panel: a bold panel at least 0.6 x 0.4 in the wagon's `color` with a dark outline, the white number and the white shape marker, in the existing `.ig-label` group so it stays upright exactly as now. Check the six colours against each body livery for contrast.
- [ ] Stuck wagons: rusty grey body, scotches at the wheels, a red target and the red cross, no ID panel.
- [ ] Draw the 64xx pannier tank, 1.7 long, chimney towards +x, per the Loco identity assumption: red buffer beams, black running plate with steps, smokebox and copper-capped chimney, green boiler top with dome and brass safety-valve bonnet, two green pannier tanks with filler lids and orange-black-orange lining, cab roof with rain strips, bunker with `coal`. Keep the root class `ig-loco` under `.ig-vehicle.loco` and the `scale(-1 1)` flip.
- [ ] Three-link couplings: draw a chain between coupled vehicles in the `.ig-hook` group (keep `data-hook`, `data-rake`, `data-index` and the 0.4-radius transparent hit circle) with a small high-visibility ring so it is clearly tappable; uncoupled ends show a hanging hook on each headstock.

### Verification Plan
- `npm test` passes (stock tests included).
- `npx playwright test "inglenook.spec"` passes (hook tap, couple and uncouple still work).
- `npx playwright test "inglenook.shots"` then Read `loco-close.png`, `classic-1024.png`, `stuck-1024.png`, `classic-844.png` and check: the loco reads as a green pannier tank (two tanks either side of the boiler, chimney, dome, cab, coal bunker); the four wagon types are distinguishable; every movable wagon's number and shape are legible in the phone-landscape shot and match the goal chips; the stuck wagon is obviously different; couplings show a chain and a marker.
- In the shots spec assert the ID panel is at least 10 CSS px tall at 844x390 and at 390x844 (`.ig-label` `getBoundingClientRect()`).

### Phase Summary
_(write when phase completes)_

## Phase 5: Scenery and lighting
Status: Not started
Depends on: 2, 3
Files: Games.Client/wwwroot/games/inglenook/scenery-plan.js, draw-scenery.js; tests/js/inglenook.scenery.test.mjs
Model: sonnet
Effort: medium

- [ ] Add `scenery-plan.js` (DOM-free): `planScenery(layout, seed)` returns placed items `{ type, x, y, rot, w, h }` for one composed yard per layout. Fixed anchors per layout: a goods shed with a loading platform and `setts` apron beside the goal siding, a signal box near the first point, coal staithes beside a short siding, a water crane and water tower by the headshunt, a yard office or lamp hut, a boundary fence along one long edge with a gate, yard lamps at intervals, and trees outside the fence. Seeded clutter (sleeper stacks, oil drums, barrows, coal heaps, a parked lorry on the apron) varies with `seed` = level number.
- [ ] Placement rules, enforced in the planner: every item lies inside `layout.bounds`; no item's footprint comes within 0.9 of any track centre-line (the shed platform edge may come to 0.6 of its own siding); no item covers a point lever position (use the same lever position rule as `draw-track.js`, exported from there or duplicated as a small pure function); items do not overlap each other.
- [ ] Tests in `tests/js/inglenook.scenery.test.mjs`: for all four generated layouts and seeds 1-50 the rules above hold, the plan is deterministic for a given seed, and the fixed anchors are identical across seeds.
- [ ] Draw each item type in `draw-scenery.js` in plan view with roof detail (slate courses, ridge, chimney stacks, skylights), using the Phase 3 textures; low items go in `sceneryLow`, lamp heads and tree canopies in `sceneryHigh` so vehicles pass beneath them where they overhang.
- [ ] Static daylight shadows: each item casts an offset soft shadow (taller items longer) drawn once into `sceneryLow`; use a single shared blur filter on the static shadow group only, and plain offset shapes with no filter when quality is `low`.
- [ ] Remove the old placeholder scenery (the flat shed, box, tower, trees and fence).

### Verification Plan
- `npm test` passes (scenery tests included).
- `npx playwright test "inglenook.spec"` passes.
- `npx playwright test "inglenook.shots"` then Read the six full-board shots (`classic-1024`, `classic-844`, `classic-390`, `long-1024`, `ladder5-1024`, `stuck-1024`) and check: every layout has a shed, signal box, staithes, lamps and fence; nothing sits on or touches the track or hides a lever, hook or wagon; shadows all fall the same way; the portrait shot is still clear.
- Assert `document.querySelectorAll('.ig-board *').length < 4500` on level 61.

### Phase Summary
_(write when phase completes)_

## Phase 6: Motion, effects and quality fallback
Status: Not started
Depends on: 3, 4, 5
Files: Games.Client/wwwroot/games/inglenook/effects.js, quality.js, render.js, index.js; tests/js/inglenook.quality.test.mjs; tests/e2e/inglenook.spec.mjs
Model: sonnet
Effort: medium

- [ ] Add `quality.js` (DOM-free): `createQualityMonitor({ reducedMotion })` with `sample(dtMs)` and `level`. Start at `high`; step down to `low` when the average frame time over a 2 s window exceeds 22 ms for two consecutive windows; never step back up; ignore single frames over 250 ms (tab switches). Unit-test these rules.
- [ ] Wire it in `index.js`: call `sample` every frame and `renderer.setQuality(level)` on change; expose `quality` and `setQuality(q)` on `window.__ig` for tests. `reducedMotion` turns off particles, rocking, squeeze and blade tweens regardless of quality.
- [ ] `effects.js` vehicle shadows: one offset dark rounded shape per vehicle in the `shadows` layer, following position and angle, no filter; hidden at quality `low`.
- [ ] Steam and smoke from the pannier's chimney in the `steam` layer: puffs emitted in time with distance travelled (one puff per 0.22 wagon lengths, matching the Phase 7 chuff), drifting with a fixed wind, growing and fading over about 1.5 s; a faint wisp from the safety valve when standing; a short burst of drain-cock steam at the front when starting from rest. Pool at most 40 elements and reuse them; none at quality `low`.
- [ ] Buffer squeeze and coupling slack: on `coupled`, `buffer` and `bumped` the vehicles nearest the contact close up by a few hundredths of a wagon length and spring back over 250 ms; on starting to pull, gaps open by the same amount one wagon after another. Purely a render offset: the simulation state, win check and hook hit positions are never changed.
- [ ] Gentle rocking: while moving, each vehicle gets a tiny seeded sway (under 0.6 degrees) that settles when stopped.
- [ ] `reset()` (called on undo and on level start) clears particles and any running squeeze so nothing animates across a teleport; `destroy()` removes everything.
- [ ] Extend `tests/e2e/inglenook.spec.mjs`: (a) drive Forward for 1 s and expect steam elements to exist at quality `high`; (b) call `__ig.setQuality('low')` and expect no steam or shadow elements; (c) with `page.emulateMedia({ reducedMotion: 'reduce' })` expect no steam while driving; (d) measure 3 s of `requestAnimationFrame` intervals while driving on level 61 and expect the average under 20 ms.

### Verification Plan
- `npm test` passes (quality tests included).
- `npx playwright test "inglenook.spec"` passes, including the four new checks.
- `npx playwright test "inglenook.shots"` then Read `moving.png`: steam trails from the chimney, vehicles have shadows, the train looks intact (no gaps or overlaps from the squeeze).
- Run the win test again and confirm moves still equal par (`__ig.solve()` gives three stars): effects did not alter the simulation.

### Phase Summary
_(write when phase completes)_

## Phase 7: Steam sound
Status: Not started
Depends on: 6
Files: Games.Client/wwwroot/games/inglenook/audio.js, index.js
Model: sonnet
Effort: medium

- [ ] Replace the diesel oscillators in `audio.js` with a steam voice: a looped filtered-noise hiss at low level when standing, and exhaust chuffs (short band-passed noise bursts with a low thump) scheduled by distance travelled, one per 0.22 wagon lengths, in groups of four with the first slightly stronger. Add `moved(distance)` handling so chuffs follow real movement: change `play(type)` to `play(type, event)` and update the call in `index.js` `handleEvents()`.
- [ ] Soften the chuffs as speed settles and cut them cleanly on stop; keep `setSpeed` for the hiss level; cap simultaneous noise sources so a long run does not pile up nodes.
- [ ] Replace the win chime with a two-note steam whistle (two detuned tones with breath noise and a slight pitch rise). Keep the existing coupling clank, buffer thump, point click and error tones.
- [ ] Keep the public API (`resume`, `play`, `setSpeed`, `setEnabled`, `destroy`), Mute, `soundEnabled` and the resume-on-first-gesture behaviour; `destroy()` must stop the hiss loop and close the context.

### Verification Plan
- `npm test` passes.
- `npx playwright test "inglenook.spec"` passes with no console errors (the config launches Edge with `--mute-audio`, so this checks the code runs, not how it sounds).
- In a Playwright one-off, wrap `AudioContext.prototype.createBufferSource` to count calls, drive Forward for 2 s and expect between 4 and 20 chuff sources, then Stop and expect the count to stop rising within 0.5 s; toggle Mute and expect no new sources while driving.

### Phase Summary
_(write when phase completes)_

## Phase 8: HUD restyle, e2e, docs and after shots
Status: Not started
Depends on: 6, 7
Files: Games.Client/wwwroot/games/inglenook/styles.css, ui.js; tests/e2e/inglenook.spec.mjs; README.md; _docs/plans/0014-shots/after/
Model: sonnet
Effort: medium

- [ ] Restyle the HUD in `styles.css` with a light period touch: Western Region chocolate and cream, enamel-sign style title and level plate, the Gill Sans style font stack, buttons as cream enamel plates with dark lettering (Forward/Reverse/Stop keep clearly different colours and their `.on` state). Same layout, same element sizes; every button stays at least 44 px.
- [ ] Goal strip as a shunter's wagon list: a cream card with a ruled line and the chips in order; chips keep their colour, number and shape and must match the wagons' ID panels. Keep the wording "Make up exactly this train on the long siding, nearest the points first:".
- [ ] Restyle the win panel and toast to match. Change the Mute icon only if needed for contrast.
- [ ] Run the six phone-fit viewports in `inglenook.spec.mjs` and fix any overflow caused by the restyle or by the longer headshunt.
- [ ] Update `README.md` Inglenook section: the pannier tank replaces "a small diesel shunter", curved pointwork, code-generated textures, effects and automatic quality fallback, steam sound, and the new files in the Code table.
- [ ] Capture the after set: run the shots spec with `IG_SHOTS=after` so `_docs/plans/0014-shots/after/` holds the same eight PNGs as `before/`.

### Verification Plan
- `npm test` passes.
- `dotnet test Games.slnx` passes.
- `npx playwright test` (full suite) passes.
- Read each `after/` PNG beside its `before/` counterpart and confirm every scope item is visible: curved pointwork, pannier, period wagons with legible panels, textured ground, composed yard with shadows, steam in `moving.png`, restyled HUD; and that the board, goal strip and controls are fully on screen at 844x390 and 390x844.
- `git status --short` is clean after the checkpoint commit; nothing was pushed (`git log origin/main..HEAD --oneline` lists only this plan's commits).

### Phase Summary
_(write when phase completes)_

## Final Recap
_(write when all phases complete: summary of the entire piece of work)_

## Deployment Plan
_(write when all phases complete: step-by-step deployment instructions)_
