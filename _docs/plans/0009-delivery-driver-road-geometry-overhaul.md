# Delivery Driver: road and geometry overhaul (scale, junctions, layered bridges)

Fix the 3D road world of Delivery Driver. Re-bake the map at a life-size-friendly 1:4 scale with no town lens (so the 2D map no longer warps around towns), build real junction and roundabout geometry, and give roads true layers so bridges have clearance and vehicles drive over and under them without falling through. Keep the custom WebGL2 renderer; borrow Slow Roads ideas for performance.

## Decisions & Answers

Brief (user, 2026-11-05): "road and possible geometry overhaul. I like the 2d map and the roads display are accurate apart from the weird warping effect around towns. but the 3d road system is a mess, roads overlap, bridges cut through other roads and have no elevation and you can't pass under the bridge if it is elevated enough nor can you pass over a bridge without falling through the road. Junctions are non-existent, just road shapes overlapping. roundabouts are just giant set pieces without a scale and roads don't connect with them, they just mash together. review this post: https://web.dev/case-studies/slow-roads and possibly https://threejs.org/ as it may be able to help create a realistic world."

- **Q:** The root cause of the overlap is scale: the map is squeezed to 1:13 but roads, roundabouts and vehicles are life-size, so real streets end up ~6 m apart and the town lens bends the map to compensate. Which fix do you want? — **A:** "Larger map, no lens (Recommended)": drop the town lens and raise the scale to roughly 1:4 to 1:5 so real junctions, parallel roads and roundabouts fit life-size; same geography and 2D map with no warping; world about 3x longer to drive; needs a re-bake.
- **Q:** If the map gets bigger, how should journey times feel? — **A:** First answer: "Keep trips about as long (Recommended)". **Superseded** by the next answer (the user then chose normal speeds and longer trips).
- **Q:** Should I port rendering to three.js? — **A:** "Keep custom renderer (Recommended)". Fix the road data and geometry in the existing pipeline; borrow Slow Roads ideas only (high-detail corridor along roads, pooled buffers, distance-to-centreline road physics). No three.js port.
- **Q:** Keeping trip length at a 1:4 map means vehicles would travel ~3x faster in world metres, which is hard to steer through life-size junctions. How should the scale and speed trade-off go? — **A:** "1:4 map, normal speeds, longer trips". So the scale is **1:4**, vehicle speeds are **unchanged** (real mph), and the longest runs take about 3.25x longer than today.
- **Q:** How should junctions and roundabouts be built in the road mesh and physics? — **A:** "Proper junction geometry (Recommended)": each junction gets a computed footprint with arms trimmed back to a kerb boundary, lane-accurate corner returns and stop lines; roundabouts are a true ring road with a sensible island radius (scaled by road class, e.g. 8 to 20 m) and arms that join the ring at their angle with flared entries; mini-roundabouts are painted discs; signal junctions get stop lines and poles.
- **Q:** Bridges and layers: what should driving over and under look like? — **A:** "Real layers with clearance (Recommended)": roads carry a layer; decks rise on approach ramps/embankments to ~5.5 m clearance over a road below (or a valley/river), with parapets and piers; you can drive over and under; vehicles and traffic pick the surface at their own layer so nothing falls through; tunnels get portals and a cut through the hills; elevated parapets and abutments are solid for collision.
- **Q:** At a 1:4 map with unchanged speeds a trip takes ~3x longer, so pay per hour of play would drop ~3x. How should the economy handle that? — **A:** "Rebalance rates to keep income per minute (Recommended)": scale pay per mile, fuel use per mile and contract time windows so a given job pays about what it does today per minute of driving. Shown distances stay real miles. Contract windows already derive from distance, so they stretch on their own.
- **Q:** The branch holds a large amount of uncommitted work from plans 0007 and 0008. How should this plan start? — **A:** "Commit it first, then branch (Recommended)": Phase 1 splits the existing work into reviewable commits (commit skill, local only, no push), then creates a new branch for this overhaul.
- **Q:** Which do you want checked during the work, beyond unit tests? — **A:** All three: Playwright screenshots of problem spots; automated drive-through tests (drive a vehicle over and under every bridge in the region, fail if it falls through, hits the deck, or height jumps); a geometry validator for overlaps (extend `scripts/validate-roads.mjs` to fail on overlapping road surfaces at the same layer, arms that miss a roundabout ring, and bridges lacking clearance).
- **Q:** Scope confirmation (IN: commit then branch; re-bake at 1:4 with no lens and the 2D map keeping its look; junction generator; layered surfaces with clearance, ramps, solid parapets, tunnels; economy rebalance; validator, drive-through tests, screenshots; old saves rejected as save v5; custom renderer kept. OUT: three.js port, inland rivers, rail/level crossings, new vehicles). Anything missing or wrong? — **A:** "That's complete, write the plan."

Assumptions (not asked; defaults chosen while planning, change only with the user):
- **Scale is one constant.** `WORLD_SCALE` in `config.js` goes from 1/13 to 1/4 and everything (projection, heights, economy) reads it. The user fixed 1:4; Phase 2 measures whether life-size roads fit at that scale. If the measurement says 1:4 cannot work (for example more than 10% of town street length overlaps after generalisation), **stop and report to the user** rather than silently changing the scale.
- **Heights scale with the map.** Real height times `WORLD_SCALE`, as today, so real gradients are preserved (Dartmoor peaks go from ~45 m to ~150 m world metres).
- **Town lens is deleted**, not disabled: `world/projection.js` loses `createLens` and the lens list; positions are plain equirectangular at `WORLD_SCALE`. Town game radius (`TOWN_RADIUS`) is no longer a magnified footprint: it is the real footprint times the scale, and baked street footprints are set per size in real metres (Phase 3).
- **Yards (42 x 40 m) still mostly sit at the town edge** (blocks are about as dense as under the lens); only revisit if the Phase 2 numbers show otherwise.
- **Generalisation at bake time.** Streets closer than carriageway plus pavements (about 11 m) at the same layer, and junction clusters closer than their footprints, are merged or dropped so the 3D world never overlaps. The 2D map keeps its look.
- **Layers.** OSM `layer` and bridge/tunnel spans become explicit levels on edge spans (bridge >= 1, tunnel <= -1, default 0). Roads only share a node at the same level. A higher level is raised to clear the lower surface by at least 5.5 m, with approach ramps within the class gradient limit (the lower road is not dug down).
- **Tunnels are included** (few in the region; count them in Phase 2). Rail and level crossings are out of scope.
- **Roundabouts circulate clockwise** (left-hand traffic) and give way to the circulating traffic (existing claim rule stays as a fallback).
- **Saves:** world coordinates change, so `SAVE_VERSION` goes 4 -> 5 and older saves are rejected with the existing start-screen notice (no migration).
- **Canvas 2D fallback** keeps working at reduced fidelity (no junction polish required, but it must not break or draw bridges under roads).
- **Elevation wire size.** At 1:4 the DEM resolution (~49 m real) is ~12 world m per cell, i.e. ~15.6 M cells (31 MB Int16). The baked elevation must not ship at that size: target at most ~3 MB on the wire (coarser grid, delta coding, or tiles).
- **Attribution and the bake pipeline stay** (Overpass tiles and DEM caches under `.cache/` already exist; this plan only re-bakes offline). If `.cache/osm` or `.cache/elevation` is missing, stop and ask the user.
- **Tests:** `npm test` (node --test over `tests/js/**/*.test.mjs`, 339 at the start of plan 0009) must stay green; tests that assert 1:13 numbers are updated, not deleted. After every change that affects the running app, restart the dev server on port 5210 (project memory rule: the user tests on a phone).
- **Never push.** Commits are local; commit messages end with the Co-Authored-By line from the session.

## For Future Agents
As work proceeds: mark the item you are actively working on `- 🔄` (at most one per phase) and flip it to `- ✅` when it completes; when a phase is done, set its status to `Complete` and write its **Phase Summary** (what was done, key decisions, anything needed to continue with zero context); run the phase's **Verification Plan** and record the result before moving on. When all phases are done, fill in **Final Recap** and **Deployment Plan**.

Orientation (state at the start of this plan; plan 0008 is Complete but uncommitted):
- Baked world: `Games.Client/wwwroot/games/delivery-driver/world/seed/baked/` (`manifest.json`, `main.json`, 58 `town-<id>.json`, `coast.json`, `rivers.json`, `elevation.bin`). Bake scripts in `scripts/bake-roads/` (`fetch-osm.mjs`, `fetch-elevation.mjs`, `bake.mjs`, `bake-elevation.mjs`, `era.mjs`, `history.json`, `common.mjs`, README). Raw caches in gitignored `.cache/osm/` and `.cache/elevation/`. Format in `world/baked-format.js` (format 2), loader `world/baked-loader.js`.
- **Why it looks wrong now:** `world/projection.js` compresses by `WORLD_SCALE = 1/13` and adds a per-town lens (`createLens`, `footprintM`, `TOWN_RADIUS`) which warps the map; `ROAD_CLASS` widths (`world/roadgraph.js`: M 24, dual 17, A 8, B 7, street 7, lane 4.2) and vehicles are life-size; `render/gl/road-mesh.js` builds one strip per edge plus a patch per node (`buildNodeMesh`, `junctionRadius`, `armsOf`, `addCorners`) with a fixed `ROUNDABOUT.island = 7.2` m regardless of the real roundabout; bridges are only `edge.bridge`/`spans` flags drawn by `addBridge`.
- **Heights:** `world/terrain.js` `gradeRoads` sets `node.z`, `edge.z` (profile every `zStep` m), `edge.zFill`, `edge.zBridges` (straight decks); `groundZ(world, x, y, decks)` returns ONE height per (x, y), blending the nearest roads, so it cannot represent a road above another road. `roadHeightAt`, `roadDeckNear`, `slopeAt` (memoised by pose). Vehicles use `groundZ` via `game/session.js` (`env.groundZ`, `slopeAt`), traffic sets `a.z = roadHeightAt(edge, d)` (`traffic/traffic.js`).
- Consumers of the graph: `traffic/traffic.js`, `world/pathfind.js`, `game/session.js`, `game/fleet.js`, `world/history.js`, `world/furniture.js` (uses `mouthRadius`, `armsOf`), `world/generator.js` (buildings, yards), `render/gl/prop-mesh.js`, minimaps (`render/minimap.js`, `render/gl/minimap-gl.js`), Canvas fallback `render/draw-road.js`, `render/renderer.js`.
- Economy: `game/economy.js` uses `WORLD_SCALE` (line ~50, real km from world metres); `worldToMiles` in `config.js` is used by contracts, HUD, menus, fleet, session.
- Tools: `scripts/validate-roads.mjs` (graph, furniture and yard validators; `--area`, `--year`, `--strict`, `--check-yards`, `--furniture`, `--baked`), `scripts/count-baked-graph.mjs`, `scripts/terrain-stats.mjs`, `scripts/traffic-soak.mjs`, `tests/js/helpers/delivery-seed.mjs` (`seedWithBaked()`), `_docs/road-system.md`. Debug panel (Development builds, 🛠): year, weather, traffic, teleport to depots and towns; Playwright against `http://localhost:5210/play/delivery-driver`.
- Slow Roads (web.dev case study, read in planning) ideas to reuse: keep high-detail geometry in a narrow corridor along the route and coarse geometry elsewhere; generate/cache chunks ahead of the player; pool and recycle buffers, avoid per-frame allocation; collide with road surface and rails by distance to the centreline; offer quality settings tied to measured bottlenecks. The article says nothing about junctions or bridges (its road is a single non-branching path), so those are solved here.
- Plan 0008's rules still hold for baked data: global node ids, edge flags, era dating (`era.mjs`), furniture rules (`furniture.js`), old saves rejected.

## Recommended Model

| Phase | Model | Effort | Why |
|---|---|---|---|
| 1 Commit existing work and branch | haiku | medium | Mechanical git work |
| 2 Measure at 1:4 and add overlap validator | sonnet | medium | Scripted measurement and validator checks |
| 3 Rescale projection, bake and elevation | sonnet | medium | Parameter and format work in existing bake |
| 4 Bake generalisation and layer data | sonnet | medium | Topology clean-up passes in the existing baker |
| 5 Runtime rescale (towns, terrain, yards, camera) | sonnet | medium | Constants and placement fixes with tests |
| 6 Economy and timing rebalance | sonnet | medium | Rate constants and tests |
| 7 Layered road surfaces and height lookup | opus | medium | Subtle height/physics model: grading with crossing clearance, layer-aware `groundZ`, no fall-through |
| 8 Junction layout engine | sonnet | medium | Pure geometry module with a detailed spec and tests |
| 9 Junction and roundabout meshes | sonnet | medium | Mesh work on the layout, furniture alignment |
| 10 Bridge and tunnel meshes, collision, camera | sonnet | medium | Mesh and collider work over the layered model |
| 11 Traffic across layers and junction connectors | sonnet | medium | Extend existing traffic and claim system |
| 12 Corridor LOD and buffer pooling | sonnet | medium | Performance work with measurements |
| 13 Saves, docs, tests, e2e | sonnet | medium | Version bump, docs, test updates |
| 14 QA, screenshots and sign-off | sonnet | medium | Measure, screenshot, fix regressions |

## Phase 1: Commit existing work and branch
Status: Complete
Model: haiku
Effort: medium

- ✅ Run `git status` and `git diff --stat` on `feature/delivery-driver-osm-roads`; confirm local logs (`server.log`, `server.err`) and `.cache/` are not staged and `.gitignore` covers them
  - Note: `.cache/`, `test-results/`, `dist/`, `Games-site.zip`, `.playwright-mcp/` were already ignored; `server.log` and `server.err` were not, so `# Dev server logs` entries were added to `.gitignore` (part of the first commit's tooling/ignore group). `.vscode/launch.json` changes `localhost:5210` to `0.0.0.0:5210`, matching the running dev server, so it is committed as a dev tooling commit.
- ✅ Use the `commit` skill to split the working tree into reviewable commits grouped by intent (bake scripts and baked data; world/terrain/furniture; rendering; traffic/router; saves/docs/tests; plan files); local only, do not push
  - Commits created (oldest first): `1148116` Ignore dev server logs and bind the dev server to all interfaces; `d13a570` Add elevation baker, scale and soak scripts, and refresh baked road data; `f561c9c` Load baked roads and elevation into the world and add rule-based street furniture; `bcafb6d` Render road pavements, verges, centre lines and zebras in the WebGL road mesh; `c2408d9` Honour one-way roads, avoid cul-de-sacs and snap routes to the main network; `8f090f7` Bump the save version for baked roads and cover the change in docs and tests; `5f5b2e5` Mark plan 0008 Complete with its phase summaries
  - Commit trailer is `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>` (the harness attribution for this session), not the Opus line in the task brief, because the session model is Haiku 5.5.
  - Tree is clean apart from this plan file (untracked, to be committed on the new branch with item 4's result).
- ✅ Create branch `feature/delivery-driver-road-geometry` from the resulting HEAD (`git checkout -b`, from `5f5b2e5`)
- ✅ Run `npm test` and record the pass/fail count as the baseline in the Phase Summary (339 pass, 0 fail, exit 0)

### Verification Plan
- `git status --short` prints nothing (clean tree) and `git branch --show-current` prints `feature/delivery-driver-road-geometry`
- `npm test` completes; counts recorded (expect 339 pass)

### Phase Summary
Done (2026-11-05).

What was done: the plan 0008 work that was uncommitted on `feature/delivery-driver-osm-roads` was split into seven local commits (none pushed), then the branch `feature/delivery-driver-road-geometry` was created from the new HEAD. `.gitignore` gained `server.log` and `server.err` (the rest of the junk was already ignored: `.cache/`, `test-results/`, `dist/`, `Games-site.zip`, `.playwright-mcp/`). No runtime code changed in this phase.

Commits (oldest first, all on `feature/delivery-driver-osm-roads` before the branch was cut):
- `1148116` Ignore dev server logs and bind the dev server to all interfaces (`.gitignore`, `.vscode/launch.json`: `localhost` to `0.0.0.0:5210`, matching the phone-testing dev server)
- `d13a570` Add elevation baker, scale and soak scripts, and refresh baked road data
- `f561c9c` Load baked roads and elevation into the world and add rule-based street furniture
- `bcafb6d` Render road pavements, verges, centre lines and zebras in the WebGL road mesh
- `c2408d9` Honour one-way roads, avoid cul-de-sacs and snap routes to the main network
- `8f090f7` Bump the save version for baked roads and cover the change in docs and tests (`SAVE_VERSION` 3 to 4)
- `5f5b2e5` Mark plan 0008 Complete with its phase summaries

Branch: `feature/delivery-driver-road-geometry`, created with `git checkout -b` from `5f5b2e5`.

Key decisions:
- Commit trailer: the task brief asked for `Co-Authored-By: Claude Opus 5.5`, but the session's harness attribution says Haiku 5.5 and this session runs on Haiku 5.5, so every commit uses `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. Future agents should keep the trailer matching the model actually running.
- Commit grouping followed the brief's six groups plus a dev-tooling commit. Groups were not fully independent (for example the rendering commit uses `edgeSpeed`/`coreNodes` from roadgraph in the traffic commit), so each commit is a reviewable intent group rather than a guaranteed-buildable step. Only the final HEAD was tested.
- `.vscode/launch.json` was committed (not left out): the change matches the running dev server's log.
- The `commit` skill was used with the grouping above; two commit messages were reworded before moving on (only unpushed commits made in this phase were amended).

Baseline `npm test` (run from repo root on `feature/delivery-driver-road-geometry` at `5f5b2e5`): 339 tests, 339 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo. Matches the expected 339. Log at `C:\Users\Mike\AppData\Local\Temp\claude\bb31e645db368024\ef087d99-da35-4b53-a791-b07beb60b4a8\scratchpad\npm-test-p1.log`.

For the next agent: the working tree is clean apart from this plan file. Baked data (`elevation.bin` at about 2.7 MB, `main.json` about 2.1 MB) is committed as generated output; the bake inputs live in the gitignored `.cache/` (about 160 MB), which must not be deleted.

### Verification Results
- `git status --short` prints nothing after the final commit below; `git branch --show-current` prints `feature/delivery-driver-road-geometry`
- `npm test`: 339 pass, 0 fail (expected 339 pass)

## Phase 2: Measure at 1:4 and add overlap validator
Status: Complete
Model: sonnet
Effort: medium

- ✅ Add a one-off script `scripts/bake-roads/measure-scale.mjs` that re-bakes into a scratch folder (not the committed baked folder) with `lens: false` at scales 1/4, 1/5 and 1/13, and prints per scale: node/edge counts, vertex count, edges shorter than 6 m, junction pairs closer than 25 m, share of town street length within 11 m of another road at the same level without a shared node, and gzip size; also count tunnels and bridge spans per level and the number of roundabouts by real radius band
  - Note: to parameterise without touching `WORLD_SCALE`, `createProjection(json, {lens, scale})` gained a `scale` option (default `WORLD_SCALE`), `bake()` gained `scale` and `tolScale` options (multiplier on the world-metre clean-up tolerances so they stay the same in real metres; default 1 = unchanged output, verified byte-identical `main.json`/`town-exeter.json`/`manifest.json`), and `bake.mjs` main()'s file writing was extracted into an exported `writeBaked(res, seed, outDir, history)`. The script writes to `.cache/measure-scale/<name>/` (gitignored). Extra rows: today's 1:13 + lens, and 1:4 with raw (unscaled) tolerances. `--validate` (added with item 2) also runs the validator on each scratch bake. It also prints a simulated greedy generalisation (drop lowest-ranked mostly-overlapping street edges while connectivity survives) because the real generalisation pass only arrives in Phase 4; the viability rule is applied to its residual. Takes about 1 minute.
- ✅ Extend `scripts/validate-roads.mjs` with hard check `overlap-same-layer` (two edges at the same level whose carriageway-plus-pavement strips overlap, apart from within `junctionRadius` of a shared node), soft check `junction-cluster` (junction footprints that overlap) and hard check `bridge-clearance` (a higher level passing over a lower surface with less than 5.5 m clearance, once Phase 7 provides deck heights; until then report only), plus `roundabout-arm-gap` (an arm whose end does not reach the roundabout ring), each with unit tests on small fixture graphs in `tests/js/delivery-driver.roads-validator.test.mjs`
  - Notes: all four run inside `validateGraph` (new option `hardClearance`, CLI `--hard-clearance`; `bridge-clearance` is soft/report-only until Phase 7 flips the default). Strip half width = carriageway/2 + 2.0 m pavement. Levels come from `levelAt(edge, along)`: baked `spans` (type or a future `level`, 6 m margin like the crossing check), else `edge.level`, else whole-edge `bridge`/`tunnel` flags. The shared-node exemption is the larger of `junctionRadius` and the angle-dependent strip overlap reach `(he+hf)/(2 sin(theta/2))` (capped 60 m), so acute bends/junctions that the Phase 8 layout will trim are not flagged. `bridge-clearance` only measures crossings where both edges have `z` (the full game world after `gradeRoads`, not `--baked`); it does not yet consider bridges over terrain or water (needs Phase 7). `roundabout-arm-gap` uses the mesh's fixed ring (`ROUNDABOUT.island + 2*halfwidth`) unless a node has `ringOuter`; Phase 8 should feed the layout's outer radius. `loadBakedWorld` now reads `manifest.projection.worldScale`. 6 new fixture tests (11 pass in the file).
- ✅ Run the new checks on the current 1:13 world (before numbers) and on the 1:4 scratch bake; record both tables in the Phase Summary and state plainly whether 1:4 is viable (rule in Assumptions)
  - Notes: before = the committed 1:13 + lens baked world (validator on `--baked`, year 2024); after = scratch bakes at 1:5 and 1:4 with no lens. Both tables are in the Phase Summary, plus the full-game-world `bridge-clearance` baseline.

### Verification Plan
- `node scripts/bake-roads/measure-scale.mjs` prints the comparison table and exits 0
- `node scripts/validate-roads.mjs --area exeter --strict` runs with the new checks and the fixture tests pass in `npm test`

### Phase Summary
Done (2026-11-05).

**Verdict: 1:4 is viable.** After a simulated generalisation (drop the lowest-ranked, mostly-overlapping town street edges while the graph stays connected) only **2.9%** of town street length still lies within 11 m of another same-level road it does not share a node with, well under the 10% stop threshold. Without generalisation 16.3% overlaps, and the simulated pass drops 19.2% of town street length (37.5 km of 195 km), so the Phase 4 pass will thin dense town grids by roughly a fifth. Treat that as the expected cost, not a surprise. 1:5 would also pass (4.2% residual, 32.8% dropped); the scale stays 1:4 as the user decided.

What was done:
- `scripts/bake-roads/measure-scale.mjs` (new, one-off, about 1 minute): bakes the cached OSM into scratch folders `.cache/measure-scale/<name>/` (gitignored; the committed baked folder is never written) at 1:13 + lens (today), 1:13, 1:5, 1:4 (lens off, clean-up tolerances scaled to stay the same in real metres) and 1:4 with raw tolerances, and prints the comparison. `--validate` also runs the new validator checks on each scratch bake; `--only 1:4,1:5` limits the rows.
- To parameterise without touching `WORLD_SCALE` (config.js is unchanged): `createProjection(json, {lens, scale})` has a new `scale` option (default `WORLD_SCALE`); `bake()` has new `scale` and `tolScale` options (default output byte-identical: `main.json`, `town-exeter.json` and `manifest.json` compared equal); `bake.mjs` main()'s file writing is now the exported `writeBaked(res, seed, outDir, history)`; `loadBakedWorld` in `validate-roads.mjs` reads `manifest.projection.worldScale`.
- `scripts/validate-roads.mjs` gained `overlap-same-layer` (hard), `junction-cluster` (soft), `roundabout-arm-gap` (hard) and `bridge-clearance` (soft until `--hard-clearance`; Phase 7 should make it hard by default and also use deck heights over terrain/water), exported `levelAt`, `PAVEMENT` (2.0 m), `CLEARANCE` (5.5), `SLAB` (0.6). `validateGraph` returns extra counts (`overlapPairs`, `junctionClusters`, `roundabouts`, `gradeSeparatedCrossings`, `clearanceMeasured`). 5 new fixture tests (`tests/js/delivery-driver.roads-validator.test.mjs`, 11 tests in the file).

Measurement table (real run; "1:13+lens" is today's game; km are world km; town streets = class street inside a town, open in 2024; the cache holds streets only inside each town's current footprint):

| metric | 1:13+lens (today) | 1:13 no lens | 1:5 | 1:4 | 1:4 raw tol |
|---|---|---|---|---|---|
| nodes | 31,944 | 27,960 | 29,885 | 30,091 | 38,008 |
| edges | 41,030 | 36,201 | 38,944 | 39,272 | 48,608 |
| vertices | 115,894 | 103,760 | 109,287 | 109,981 | 175,168 |
| edges < 6 m | 3,077 | 3,592 | 44 | 26 | 2,844 |
| junction pairs < 25 m | 22,913 | 26,116 | 7,304 | 4,913 | 19,001 |
| road gzip, MiB (no elevation) | 0.77 | 0.69 | 0.87 | 0.92 | 1.20 |
| town street km | 183.4 | 52.1 | 154.6 | 195.1 | 213.7 |
| town street overlap share (<11 m) | 53.7% | 94.7% | 30.7% | 16.3% | 44.3% |
| all-road overlap share | 16.3% | 13.4% | 3.4% | 2.2% | 5.1% |
| street km dropped by simulated generalisation | 40.1% | 62.0% | 32.8% | 19.2% | 34.9% |
| residual street overlap after it (of original km) | 12.9% | 28.4% | 4.2% | **2.9%** | 10.7% |
| roundabout rings / minis | 534 / 251 | 533 / 245 | 535 / 247 | 535 / 247 | 538 / 269 |
| rings by real radius <8 / 8-12 / 12-20 / 20-35 / 35+ m | 48/179/193/82/32 | same | same | same | same |
| rings under 12 m world outer radius at that scale | 534 | 533 | 521 | 515 | 518 |
| bridge spans L1 (n; km) | 3,705; 7.7 | 3,702; 6.8 | 3,747; 17.8 | 3,760; 22.4 | 3,781; 22.5 |
| bridge spans L2 (n; km) | 5; 0.1 | 5; 0.1 | 5; 0.3 | 5; 0.4 | 5; 0.4 (and 2 at L3) |
| tunnel spans L-1 (n; km) | 88; 0.4 | 79; 0.3 | 82; 0.8 | 85; 1.1 | 88; 1.1 |
| era connectivity problems | 0 | 0 | 0 | 0 | 0 |

Reading it: with the lens removed at 1:13 nearly every town street overlaps (94.7%), which is why the lens existed. At 1:4 only 16.3% does, junction pairs closer than 25 m fall from 22.9k to 4.9k, and edges under 6 m almost vanish (the scaled tolerances do this; with raw tolerances 2,844 remain). Levels: bridges are OSM `layer` 1 (a handful at 2), tunnels all -1; only about 85 tunnel spans (1.1 world km) and about 3.8k bridge spans, many tiny. Roundabouts: about 535 rings plus about 247 mini-roundabouts; real radii are mostly 8-20 m, so at 1:4 every ring's scaled radius (real x 0.25, 2-9 m) is smaller than a life-size ring (island 4 + ring 8 = 12 m): roundabout size must come from the class clamps in Phase 8 (`RI_MIN`/`RI_MAX`), not from the scaled OSM radius; `node.ringRadius` (real metres, set by `collapseRoundabouts` before projection) is only a hint.

Validator results (year 2024, `--baked --area all`, issue counts; `crossing-no-node` is 0 everywhere except 1 in the raw-tolerance row):

| check | 1:13+lens (before) | 1:5 | 1:4 (after) |
|---|---|---|---|
| overlap-same-layer (hard) | 37,808 pairs (~767 km of road involved) | 9,996 | 5,297 (~289 km) |
| junction-cluster (soft) | 6,701 | 1,221 | 489 |
| roundabout-arm-gap (hard) | 732 (403 rings) | 390 | 307 (427 rings) |
| sharp-angle / no-priority / odd-degree / short-edge / road-in-water (existing checks) | 1,592 / 11,400 / 27 / 65 / 106 | 1,724 / 9,464 / 102 / 10 / 85 | 1,812 / 9,517 / 114 / 7 / 86 |

So the strict validator is expected to fail until Phase 4: even at 1:4 there are 5,297 overlapping pairs (street+street 2,105, A+A 852, A+lane 661, A+street 466, A+B 465, about 54% involve a town edge) and 307 roundabout arms shorter than the ring. Phase 4 generalisation, junction consolidation and roundabout arm handling must bring these to 0. They are stricter than the 11 m measure (they include A-road slip/link pairs and anything within carriageway plus pavement, and the shared-node exemption only covers directly shared nodes). `bridge-clearance` was measured on the full game world at today's 1:13 (`validate-roads.mjs --area all`): all **342 of 342** grade-separated crossings have under 5.5 m clearance (min -6.4 m, median -0.6 m, max 4.7 m), confirming decks are not raised over the road below. This is the Phase 7 baseline.

Key decisions:
- `tolScale = 13 / denominator` for the clean-up tolerances (`contractShort`/`mergeDegree2` 3.5 m, simplify 1.5/4 m, `trimOvershoots`, `repairCrossings`), i.e. Phase 3's "same fidelity in real terms". Snap and spur-prune are already in real metres. Footprints are unchanged (the cache only has today's `footprintM`: city 1210, town 910, small 730, village 505 real metres); Phase 3's larger footprints need a new OSM fetch (`fetch-osm.mjs` reads `townBoxes`), which this phase did not do.
- The real generalisation pass does not exist yet, so the viability rule is judged on a simulation (greedy drop of lowest-ranked, at least 30% overlapping, non-ref, non-bridge street edges when connectivity survives; spurs always droppable). Phase 4's real pass may merge instead of drop and so keep more streets.
- Overlap uses a flat 11 m in the script (two 7 m streets plus 2 m pavements each side) and carriageway/2 + 2.0 m per road in the validator (2.0 m = outer edge of the mesh pavement strip).
- `--strict` now exits 1 on the current world (new hard checks fail: the Exeter area has 6,018 hard failures, mostly overlaps), whereas before this phase it was 0. That is intended; Phase 4 targets 0. Nothing in `npm test` runs `--strict`.

Files: added `scripts/bake-roads/measure-scale.mjs`; changed `scripts/bake-roads/bake.mjs`, `Games.Client/wwwroot/games/delivery-driver/world/projection.js`, `scripts/validate-roads.mjs`, `tests/js/delivery-driver.roads-validator.test.mjs`, this plan. App runtime behaviour is unchanged (the projection default scale is still `WORLD_SCALE`), so no dev-server restart was needed.

For the next agent: the scratch bakes live in `.cache/measure-scale/` (gitignored, safe to delete, rebuilt in about a minute). Phase 3 still has to change `WORLD_SCALE`, delete the lens and re-bake into the committed folder. `bake.mjs` main() also bakes elevation via `WORLD_SCALE`, so `--scale` is not exposed on the CLI (measure-scale.mjs calls `bake()` directly and skips elevation).

### Verification Results
- `node scripts/bake-roads/measure-scale.mjs` prints the comparison table and exits 0
- `node scripts/validate-roads.mjs --area exeter --strict` runs with the new checks (it now exits 1 by design: 6,018 hard failures on the current world, to be fixed from Phase 4); the new fixture tests pass in `npm test`
- `npm test`: 344 tests, 344 pass, 0 fail (339 baseline + 5 new)

## Phase 3: Rescale projection, bake and elevation
Status: Not started
Model: sonnet
Effort: medium

- [ ] Set `WORLD_SCALE = 1 / 4` in `config.js`; grep every use (`world/projection.js`, `world/region.js`, `world/elevation-format.js`, `game/economy.js`, `worldToMiles`, bake scripts) and confirm each reads the constant
- [ ] Delete the town lens from `world/projection.js` (`createLens`, lens list, `TOWN_RADIUS` magnification, `footprintM`); `createProjection` keeps the same API (`project`, `unproject`, `fromReal`, `toReal`, `localScale`) as plain equirectangular; remove `--no-lens` and the lens fields from `manifest.json` and `decodeBaked`; update `delivery-driver.bake.test.mjs` (lens tests go)
- [ ] Re-express bake tolerances in real metres converted by the scale (endpoint snap, `contractShort`, Douglas-Peucker 1.5/4 world m, `dropOverlaps`, spur pruning, crossing repair) so geometry fidelity is the same in real terms; set baked town street footprints per size in real metres (city 2500, town 1500, small 900, village 450 as starting values; adjust within the 10 MB gzip budget) and the game `TOWN_RADIUS` to footprint times scale
- [ ] Re-bake elevation for the new scale with a wire size of at most ~3 MB (coarser grid of about 24 world m, and/or delta plus byte-plane coding, and/or tiles); update `world/elevation-format.js` and `sampleElevation` accordingly, keep the bilinear sampling API, and keep the sea floor clamped to 0
- [ ] Re-run `node scripts/bake-roads/bake.mjs`; keep the per-year connectivity check passing; record node/edge counts per class and total gzip size

### Verification Plan
- `node scripts/bake-roads/bake.mjs` exits 0, per-year connectivity passes, gzip total under 10 MB, `elevation.bin` (or tiles) at most ~3 MB on the wire
- `node --test tests/js/delivery-driver.bake.test.mjs tests/js/delivery-driver.era.test.mjs` pass

### Phase Summary
_(write when phase completes)_

## Phase 4: Bake generalisation and layer data
Status: Not started
Model: sonnet
Effort: medium

- [ ] Add explicit levels to the baked format: each bridge/tunnel span carries `level` (bridge >= 1, tunnel <= -1, from OSM `layer` where tagged, else +1/-1), edges carry the level of their ground-level stretch (0), and the topology pass never creates a node between edges at different levels (bump `baked-format.js` to format 3, update `decodeTiles` and the round-trip test)
- [ ] Add a "minimum separation" pass (`generaliseSeparation` in `bake.mjs`): at the same level, an edge pair whose strips would overlap (carriageway plus pavements plus gap, by class) and that do not share a node is resolved by dropping the lower-ranked minor road (when connectivity survives), or merging when nearly coincident; never touches bridge/tunnel stretches
- [ ] Add junction-cluster consolidation: nodes whose footprints (class-based radius) overlap are merged into one node when 2-3 nodes are involved, otherwise the connecting edges keep a minimum length of 6 m between footprints (clamped trims are done at layout time in Phase 8); mini-roundabouts stay single nodes
- [ ] Store roundabout geometry on the node: `ringRadius` (real radius times scale of the OSM ring, mean distance of ring vertices from the centre), plus arm angles are derived at runtime from edges
- [ ] Re-run the bake and `scripts/validate-roads.mjs --baked --area all`: `overlap-same-layer` must be 0 (or each remaining case listed and accepted in the Phase Summary), 0 crossings without a node (grade-separated crossings are expected to be level-separated and excluded), 1 connected component, M5/A30/A38 chain whole, era connectivity passes

### Verification Plan
- `node scripts/bake-roads/bake.mjs` exits 0 and prints counts; `node scripts/validate-roads.mjs --baked --area all --strict` exits 0 with the new `overlap-same-layer` check at 0
- `npm test` for bake/era/validator suites passes

### Phase Summary
_(write when phase completes)_

## Phase 5: Runtime rescale (towns, terrain, yards, camera)
Status: Not started
Model: sonnet
Effort: medium

- [ ] Fix every constant tuned for 1:13 so the game plays at 1:4: `world/region.js` town radii and bounds, `world/roadgraph.js` town centres/farms/site attachment distances, `world/terrain.js` (town pads, `pinTownNodes`, coast distance lattice, height range up to ~150 m), `world/generator.js` (yard and building placement counts), `world/world.js` (yard rings), ferries (`addFerry`; the Tamar is now ~60 m wide so Dartmouth may still be dry; leave unless trivial), chunk generation budgets
- [ ] Check `render/gl/camera3d.js`, fog, shadows and sky for distances and a far plane that suit mountains of ~150 m and a 53 x 40 km world (`gl-renderer.js`, `shaders.js`, `terrain-mesh.js` LOD rings); fix pop-in or clipping
- [ ] Check minimaps (`render/minimap.js`, `render/gl/minimap-gl.js`) and the full-screen map for the new extents: zoom levels, tile caching, road colours; the 2D map must look like today's without the town warping (capture a before/after screenshot at Exeter and Plymouth)
- [ ] Measure start-up (world build in Node and in the browser), JS heap and world-ready time; the bigger graph must stay within ~2x today's numbers (2.4 s ready, 143 MB); if not, make town street tiles lazy (the loader is tile-based)
- [ ] Update unit tests that assert 1:13 numbers (positions, distances, heights, counts); run `validate-roads.mjs --area all --check-yards --furniture --strict` and fix hard failures

### Verification Plan
- `npm test` passes
- `node scripts/validate-roads.mjs --area all --check-yards --furniture --strict` exits 0
- Playwright load of `/play/delivery-driver` reaches a drivable state with no console errors; recorded start-up time and heap

### Phase Summary
_(write when phase completes)_

## Phase 6: Economy and timing rebalance
Status: Not started
Model: sonnet
Effort: medium

- [ ] Add a single constant (for example `TRIP_RATE = (1/4) / (1/13)` in `config.js`, documented) and apply it so income and fuel per minute of driving match the 1:13 game: pay per mile and fuel use per mile scale by it in `game/economy.js`; distances shown stay real miles (`worldToMiles`)
- [ ] Review contract windows (`game/contracts.js`, `window`, `vmax` default 11), the offer generator's distance ranges, fleet AI job durations and earnings (`game/fleet.js`), session fuel and cost accounting (`game/session.js`), and tutorial text/thresholds; each must give the same minutes-per-job as before for the same shape of job, or a value justified in the Phase Summary
- [ ] Add tests: a fixed job's pay-per-driving-minute and fuel-per-minute at the new scale are within 5% of the old scale's, a contract window grows with distance, AI fleet income per game day is within 10% of before
- [ ] Print the longest contracts (Exeter to Penzance, Ilfracombe to Penzance, Lynton to St Ives) with real miles, window and expected drive minutes; record in the Phase Summary

### Verification Plan
- `npm test` passes including the new economy tests
- A Node script prints pay per driving minute for a sample of contracts before (1:13 constants) and after; difference within 5%

### Phase Summary
_(write when phase completes)_

## Phase 7: Layered road surfaces and height lookup
Status: Not started
Model: opus
Effort: medium

Design (follow unless a measured reason says otherwise; record any change in the Phase Summary):
- Each edge stretch has a `level`. Two stretches that cross in plan at different levels never share a node. A **crossing record** `{upper: {edge, d}, lower: {edge|ground, d}, point}` is found once (spatial index over edges) after the graph is final and before grading.
- **Clearance constraints:** at a crossing the upper deck height must be at least `lowerSurfaceZ + CLEARANCE` (5.5 m) plus slab thickness, using the lower road's own graded height (grade lower layers first, bottom up). Over a valley, river or sea the constraint is `terrain + clearance` only where the road is flagged as a bridge span.
- **Grading with interior constraints:** replace the straight-deck assumption in `gradeRoads`/`gradeEdge` with a per-edge profile solver that accepts lower bounds at interior samples and a grade limit: `z[i] >= max over constraints (c_k - g * |i - k| * step)` in both directions (ramps), then smoothed without violating the bounds. If an edge is too short to ramp to the bound before its end node, raise the end node target and let the existing node envelope propagate to neighbours (they ramp over their own length). Tunnels keep the road at ground level or below and add an `underGround` flag instead of cutting the land.
- **Surface lookup:** `groundZ(world, x, y, hintZ)` collects candidate surfaces at (x, y) (each nearby road by level, plus ground) and returns the one whose height is closest to `hintZ` and not more than `STEP_UP` (0.6 m) above it, so a vehicle on a deck stays on the deck, a vehicle on the road below stays below, and a vehicle falling off an edge lands on whatever is under it. With no hint (mesh building, props) it returns the ground (layer 0) height, as `decks=false` does today. `slopeAt` memo keys include the hint.
- **Vehicles:** `game/session.js` passes the vehicle's current `z` as the hint (`env.groundZ`, `slopeAt`); `sim/vehicle.js` keeps `v.z`; spawn/teleport/respawn set `z` from the road or ground at that point.

- [ ] Implement crossing detection (`world/crossings.js`, pure) and the level bookkeeping on edges, with unit tests on fixtures (overpass of a street, motorway over a lane, bridge over water, bridge over valley, tunnel under a hill)
- [ ] Extend `gradeRoads` for interior lower bounds and raised end nodes as designed; log how many edges are raised, the largest ramp, and any edge that cannot satisfy clearance within its class gradient (these are reported, then fixed by lengthening the ramp onto neighbouring edges, never by dropping clearance)
- [ ] Implement layer-aware `groundZ`/`slopeAt` with the hint and keep the unhinted behaviour for the ground mesh; update `roadDeckNear` and the terrain mesh blending so the ground under a bridge follows the ground/lower road, not the deck
- [ ] Wire hints through `game/session.js` and `sim/vehicle.js`; add the **drive-through test harness** `tests/js/helpers/drive-through.mjs` and `tests/js/delivery-driver.layers.test.mjs`: for every grade-separated crossing in the baked region (sampled across years where the roads exist), drive a simulated vehicle along the upper road and along the lower road through the crossing and assert: height continuous (no step above 0.15 m per metre except ramps within the grade limit), `groundZ` stays on the correct surface, clearance >= 5.5 m at the crossing, no fall-through
- [ ] Extend the validator's `bridge-clearance` check to use the real deck heights and make it hard; run it region-wide and fix failures
- [ ] Measure and record: number of crossings, raised edges, largest ramp length, worst grade; check `node scripts/terrain-stats.mjs` still reports 0 edges over their class limit

### Verification Plan
- `npm test` passes including `delivery-driver.layers.test.mjs`
- `node scripts/validate-roads.mjs --area all --strict` exits 0 with `bridge-clearance` hard
- The drive-through harness reports every crossing in the region passed (print the count)

### Phase Summary
_(write when phase completes)_

## Phase 8: Junction layout engine
Status: Not started
Model: sonnet
Effort: medium

Create `world/junction-layout.js` (pure, no DOM/GL), the single source of junction geometry for meshes, furniture, buildings, traffic and the validator. For a node and a year it returns `{kind, centre, arms[], boundary[], ring?, islands[], stopLines[], connectors[]}`:
- **Arms:** open edges at the node, each with heading (from the first ~8 m of the edge), half width, class, one-way, and the trim distance `t` along the edge where the junction ends.
- **Plain junctions (T, cross, Y, 5+ arms):** sort arms by angle; for each neighbouring pair compute the kerb return: tangent circles of radius `r(class pair)` (about 4-12 m, larger for A roads and dual carriageways) to the two facing kerb lines, giving corner points on each arm; the trim of an arm is the larger of its two corner distances plus a small margin, clamped to 0.45 of the edge length so short edges still connect. The junction surface `boundary` is the loop of corner arcs and arm mouths (a simple polygon, no overlap with arm strips).
- **Roundabouts:** ring centre = node, island radius `Ri = clamp(node.ringRadius - ringWidth, RI_MIN[class], RI_MAX[class])` (class range 4 to 14 m, upper end for dual/M junctions), circulating width `ringWidth` 7 to 9 m by class, outer radius `Ro = Ri + ringWidth`; each arm trims to meet `Ro` at its own angle, gets a flared entry (carriageway widens by ~1.2 m over ~12 m) with a splitter island and a kerb return with the ring; arms closer than the minimum angle are spread by at most 12 degrees (shifting only the mouth, not the baked edge). Mini-roundabouts: a painted/raised disc of radius 1.5 m on a plain junction. Grade-separated roundabout arms (different level) are not arms.
- **Connectors:** for each legal (in-edge, out-edge) pair a polyline through the junction (straight, kerb-return arc, or clockwise ring arc), used by traffic in Phase 11; one-way edges excluded in the wrong direction.
- **Stop lines / signal poles:** positions just outside the trim per approaching arm, left side, per junction type and year.
- Handles arms count 3 to 8, near-collinear arms, near-parallel arms (spread), short edges, dead-end nodes (cap), nodes with one-way arms, and year-dependent open sets (the layout is a function of `(graph, node, year)` and cached per open-arm signature).

- [ ] Implement `layoutJunction(graph, node, year)` and `junctionSignature(graph, node, year)` with the behaviour above; export `trimFor(edge, end, year)` for edge meshes, `mouthRadius(node, year)` for furniture and buildings
- [ ] Unit tests (`tests/js/delivery-driver.junction-layout.test.mjs`): T, cross, Y, 5-arm, skewed 40 degree junction, roundabout with 3 and 5 arms and a dual carriageway arm, mini-roundabout, short edge clamp; assert no overlapping boundary polygons, all arms reach the boundary within 0.05 m, corner arcs tangent to both kerbs within tolerance, ring arms meet `Ro`, island radius within class limits, determinism
- [ ] Run the layout over every junction in the baked region in 1919/1965/2024: no exceptions, no NaN, report counts of clamped trims, spread arms and rejected cases in the Phase Summary
- [ ] Extend the validator: `roundabout-arm-gap` now uses the layout (every arm ends on the ring), `junction-overlap` hard (two junction boundaries at the same level overlap)

### Verification Plan
- `node --test tests/js/delivery-driver.junction-layout.test.mjs` passes
- `node scripts/validate-roads.mjs --area all --strict` exits 0 with the layout checks hard in all sample years

### Phase Summary
_(write when phase completes)_

## Phase 9: Junction and roundabout meshes
Status: Not started
Model: sonnet
Effort: medium

- [ ] In `render/gl/road-mesh.js`, replace `junctionRadius`, `armsOf`, `addCorners` and the fixed-radius roundabout with the layout: `buildEdgeMesh` starts and ends its kerb, surface, pavement, verge and marking strips at `trimFor(edge, end, year)` (the strips no longer run to the node), and `buildNodeMesh` triangulates the layout `boundary` as one surface polygon (no coplanar overlaps with edge strips), with kerb band, pavement return, and markings drawn from the layout (stop and give-way lines, hatching on the flared entries, splitter islands, lane arrows optional)
- [ ] Roundabout mesh: an annulus (ring road, 32 or more segments) with kerb, a raised island (kerb plus grass; a tree or sign on larger ones), arms joining at their mouths with flares and splitter islands, ring and arm centre lines/dashes by era; scale from `ringRadius` and class
- [ ] Update `roadKey`/`chunkRoadSignature` so a chunk's road mesh rebuilds when any of its junction signatures (`junctionSignature`) changes with the year, and keep the existing era gates (1935/1950/1960/1970)
- [ ] Align props: `world/furniture.js` (`mouthRadius`, `armsOf`), `render/gl/prop-mesh.js` signals/signs, `world/generator.js` building frontages and clearances, and `scripts/validate-roads.mjs` furniture checks use the layout (lamps and signs never on junction surfaces, roundabout islands, or splitter islands; signal poles at the layout's stop lines)
- [ ] Mirror a simplified version in the Canvas fallback (`render/draw-road.js`, `render/renderer.js`): junction polygon and roundabout ring from the layout, no new detail
- [ ] Update road-mesh tests (`tests/js/delivery-driver.road-mesh.test.mjs`): no coplanar overlap between edge strips and junction polygons, strips end at trims, roundabout arms reach the ring, markings inside the carriageway, signature changes with year
- [ ] Playwright screenshots into `test-results/p9-*.png`: a T-junction, a signal crossroads, a skewed junction, a 3-arm and a 5-arm roundabout, a mini-roundabout, a dual carriageway roundabout and a slip-road junction, each in 1919 (or the first year it exists) and 2024; inspect them and fix visible defects (z-fighting, gaps, spikes) before finishing

### Verification Plan
- `npm test` passes including the updated road-mesh and furniture tests; `validate-roads.mjs --area all --furniture --strict` exits 0
- Screenshots listed above exist in `test-results/` with 0 console errors, and the Phase Summary describes what was inspected

### Phase Summary
_(write when phase completes)_

## Phase 10: Bridge and tunnel meshes, collision and camera
Status: Not started
Model: sonnet
Effort: medium

- [ ] Rebuild `addBridge` in `render/gl/road-mesh.js` on the layered profile: a deck of real thickness following `edge.z`, parapets/barriers both sides (stone before 1960, concrete after), abutments at both ends, piers (every ~14 m, only where there is ground or water below; none over a road below, use a clear span or a central pier on the verge/median), and approach ramps/embankments with slopes down to the land (`zFill`) instead of walls; the deck underside is visible and dark; no geometry crossing the lower road's carriageway
- [ ] Tunnels: portal walls at both ends, a tunnel tube (road plus walls and roof) and hide/cut the terrain above (discard terrain cells over the tunnel footprint in `terrain-mesh.js` or clip in the shader) so the road is visible inside; interior lighting from the era; verified with `underGround` from Phase 7
- [ ] Ground mesh: terrain under a bridge follows the ground or the lower road (never the deck); the lower road's cutting/fill and the bridge embankments blend without spikes (`terrain-mesh.js`, `groundZ` unhinted)
- [ ] Collision: add deck-edge and parapet colliders per bridge (distance-to-centreline segment colliders, one per ~4 m, with a z range of deck to deck + 1 m, in the style of Slow Roads' rail checks) to `sim/collision.js` / chunk colliders so a vehicle cannot leave a deck by driving into the parapet at normal speed, and so a vehicle on the lower road does not touch the parapet above; pillars/abutments solid
- [ ] Camera (`render/gl/camera3d.js`): under a bridge or in a tunnel the chase camera must not poke through the deck or terrain (raycast/clamp against the layered surfaces), and the sun/shadow passes still work under decks
- [ ] Minimap/Canvas: draw order by level so the higher road is on top; Canvas fallback skips decks under roads correctly
- [ ] Tests: mesh tests (no deck triangles inside the lower carriageway, parapet heights, tunnel portals exist), collider tests (a car at 30 mph into a parapet stops/deflects; a car beneath passes), and extend the drive-through harness to assert the parapet colliders do not trap vehicles at deck ends
- [ ] Playwright screenshots into `test-results/p10-*.png`: an overpass over a road, a viaduct over a valley, a river bridge, a motorway interchange, the Tamar Bridge area, a tunnel portal, a driving shot under a bridge and one on top; inspect and fix visible defects

### Verification Plan
- `npm test` passes including the new mesh and collider tests
- Screenshots exist with 0 console errors; the drive-through harness still passes for every crossing

### Phase Summary
_(write when phase completes)_

## Phase 11: Traffic across layers and junction connectors
Status: Not started
Model: sonnet
Effort: medium

- [ ] Traffic height and gap logic (`traffic/traffic.js`): vehicles on different levels never block, collide with, or yield to each other at a grade-separated crossing (gap search and junction claims look at level/edge identity, not just plan position); height always from the vehicle's edge profile
- [ ] Junction connectors: vehicles follow the layout's `connectors` through plain junctions (smooth turn arcs, correct lane) and clockwise round the ring at roundabouts, instead of cutting straight across; the single-occupancy claim stays as a fallback and now keys on the connector path; entry gives way to circulating traffic; speeds slow for tight turns
- [ ] Router/pathfinder: turn costs from connector curvature, no routes through junctions with no legal connector, slip roads and one-way edges honoured (`world/pathfind.js`)
- [ ] Add soak and unit tests: `scripts/traffic-soak.mjs` over Exeter/Plymouth in 1919, 1965, 2020 reports 0 wrong-way, 0 closed-edge, 0 vehicles inside a roundabout island or off its ring, 0 overlap samples at grade-separated crossings; tests for connector following, roundabout circulation direction and priority, vehicles at a flyover not interacting
- [ ] Player assistance: if the HUD or navigation arrows use road geometry (route arrow, lane guidance), make sure they follow connectors and layers

### Verification Plan
- `npm test` passes including the new traffic tests
- `node scripts/traffic-soak.mjs` (10,000 steps per year) prints the zero counts above

### Phase Summary
_(write when phase completes)_

## Phase 12: Corridor LOD and buffer pooling
Status: Not started
Model: sonnet
Effort: medium

- [ ] Measure first: frame time and GC pauses driving Exeter, Plymouth and the A30 on the Medium and High presets with traffic, chunk build time per frame, mesh vertex counts per chunk, and heap over a 5-minute drive; record in the Phase Summary as the baseline
- [ ] Corridor detail (Slow Roads): road meshes at full detail (markings, pavements, verges, bridge detail) only within a distance of the camera/route; beyond it use a coarse variant (surface and kerb only, larger `STEP`), and swap at chunk granularity without popping (hysteresis); terrain and props near roads keep their detail, far terrain stays coarse
- [ ] Pooling: reuse mesh builders and typed arrays between chunk builds (`meshes.js` `createBuilder`, `gpu-mesh.js`, `chunk-cache.js`) and avoid per-frame allocations in hot paths (`Object.keys`, `Array.map` in the render loop and in `groundZ`'s candidate collection); spread chunk builds across frames with a per-frame time budget so there are no spikes
- [ ] Look-ahead: prebuild chunks along the player's heading and the planned route (route polyline known) before they are needed
- [ ] Re-measure; frame time on Medium with traffic stays at or below the baseline, no GC pause above 16 ms in a drive, heap growth bounded; add the numbers to the Phase Summary
- [ ] Hook the existing quality presets (`render/auto-quality.js`) to the corridor distance and the junction/bridge detail level

### Verification Plan
- `npm test` passes
- A Playwright (or Node) measurement script prints before/after frame ms, worst frame, chunk build ms/frame and heap; after is not worse than before on any figure

### Phase Summary
_(write when phase completes)_

## Phase 13: Saves, docs, tests, e2e
Status: Not started
Model: sonnet
Effort: medium

- [ ] Bump `SAVE_VERSION` in `game/save.js` to 5; versions 1-4 load as an empty slot with the existing "earlier version" notice; update the save test
- [ ] Update `_docs/road-system.md` (scale, no lens, generalisation, levels and crossings, grading with clearance, junction layout, layered `groundZ`, bake commands), `README.md` Delivery Driver section and `scripts/bake-roads/README.md`; add a short section on Slow Roads-derived performance rules
- [ ] Update `tests/e2e/delivery-driver.spec.mjs` for positions and timings at the new scale; add an e2e test that drives a vehicle across a bridge and under it
- [ ] Run the full unit suite and the Delivery Driver e2e spec; fix failures or record each with its cause
- [ ] Remove dead lens code and unused 1:13 constants; confirm `grep -r "createLens\|footprintM" Games.Client scripts tests` finds nothing

### Verification Plan
- `npm test` passes; `npx playwright test tests/e2e/delivery-driver.spec.mjs` passes (about 7 minutes with software GL)
- A unit test shows an old-format save rejected with the notice

### Phase Summary
_(write when phase completes)_

## Phase 14: QA, screenshots and sign-off
Status: Not started
Model: sonnet
Effort: medium

- [ ] Run `node scripts/validate-roads.mjs --area all --check-yards --furniture --strict --year Y` for Y = 1919, 1930, 1950, 1970, 1990, 2024; all hard checks (including `overlap-same-layer`, `bridge-clearance`, `roundabout-arm-gap`, `junction-overlap`) at 0; list any accepted soft warnings with reasons
- [ ] Walk the map with the debug panel at Exeter, Plymouth, Truro, Penzance, Barnstaple, the M5 junctions, the Tamar Bridge area and a rural junction in 1919, 1955 and 2024; save screenshots `test-results/p14-<place>-<year>.png`, inspect each, fix visible defects (floating props, gaps, kerb slivers, steep spikes, camera clipping)
- [ ] Compare the 2D map (minimap and full map) before and after at Exeter, Plymouth and Truro: no town warping, roads in the same places relative to the coast
- [ ] Re-measure start-up, heap, frame time and router cost for the longest routes at the new scale; confirm within budget (start-up under ~5 s on the dev machine, router under 150 ms per long contract) or add hierarchical routing hints
- [ ] Run the traffic soak and the drive-through harness once more region-wide
- [ ] Restart the dev server on port 5210 and confirm HTTP 200 and a fresh load with no console errors; tell the user to reload (service worker prompt)

### Verification Plan
- All commands above exit 0; screenshots and recorded numbers are in the Phase Summary
- `npm test` and the e2e spec pass

### Phase Summary
_(write when phase completes)_

## Final Recap
_(write when all phases complete: summary of the entire piece of work)_

## Deployment Plan
_(write when all phases complete: step-by-step deployment instructions)_
