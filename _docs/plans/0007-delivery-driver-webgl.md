# Delivery Driver: true-3D WebGL renderer with terrain and slope physics

Replace Delivery Driver's Canvas 2D faux-3D renderer with a raw WebGL2 true-3D renderer (perspective chase camera, procedural low-poly meshes, sun + shadows + night lights, weather), add a procedural terrain heightfield, and make slopes affect driving. Canvas 2D stays as a fallback that plays identically but looks flat. Builds on plan 0006 (`_docs/plans/0006-delivery-driver.md`).

## Decisions & Answers

Brief (user, 2026-11-03): "WebGL for Delivery Driver Game".

- **Q:** Main goal of moving to WebGL? — **A:** True 3D. (Real 3D meshes, perspective camera, lighting and shadows; the projection and art change substantially.)
- **Q:** Which WebGL approach given the original "no runtime dependencies" rule? — **A:** Raw WebGL2, no dependencies (hand-written renderer: batched/instanced meshes, a small shader set).
- **Q:** What if WebGL2 is unavailable or the context is lost? — **A:** Keep Canvas 2D as fallback. Both renderers sit behind one interface; auto-select WebGL, fall back to Canvas 2D, plus a renderer setting.
- **Q:** Which visuals must be ported? — **A:** Everything in the world view (terrain, coast, roads, junctions, bridges, buildings, trees, vehicles and trailers, lamps/signs/signals, traffic); weather and lighting (day/night, headlights, rain, fog as GPU effects); the minimap and full map; HUD/menus stay DOM.
- **Q:** Camera? — **A:** Perspective chase cam with adjustable tilt/zoom: behind and above the truck, rotating with it; north-up toggle and zoom kept; reversing view pulls back to show the whole trailer; tilt adjustable from near top-down to a low chase. (No cab view.)
- **Q:** Lighting richness? — **A:** Sun + shadows + night lights: directional sun that moves with game time, shadow map around the camera, headlight cones and lit street lamps at night, fog/rain tinting. The quality setting can disable shadows. (No full per-light dynamic lighting.)
- **Q:** Models? — **A:** Procedural meshes in code, built from the existing vehicle/building specs. No asset files, no model loader. Per-era variants stay data-driven.
- **Q:** Performance target? — **A:** Mid-range phone 30+ fps, desktop 60 fps. Quality presets (low/medium/high) scale draw distance, shadows, traffic and trees.
- **Q:** Terrain: flat or real elevation? — **A:** "Real slopes affect driving". (Chosen over flat ground and visual-only hills.)
- **Q:** Where does height come from? — **A:** Procedural heightfield from seed data: deterministic noise plus hand-set elevations (Dartmoor/Bodmin/Exmoor raised with tors, river valleys carved, coast cliffs, sea level at the coast, towns in sensible spots). Roads are graded (smoothed) so gradients stay driveable. No external data files.
- **Q:** Which slope effects in the sim? — **A:** All four: gravity on speed/acceleration (uphill slows, downhill speeds up, heavy loads struggle, engine braking downhill); braking distance and brake fade on long descents; trailer behaviour on slopes (parked/uncoupled trailers can roll without brakes, jack-knife risk when braking downhill with a trailer, handbrake needed); fuel and wear (climbing burns more fuel, steep climbs add engine wear).
- **Q:** Canvas fallback and the off-screen AI fleet with slopes? — **A:** Sim is shared. Physics and the AI fleet use the same heightfield everywhere. The Canvas 2D fallback shows no relief (a shaded hint on the minimap is fine) but gameplay is identical.
- **Q:** Existing saves given the world/road profile changes? — **A (free text):** "Nuke them if needed. Still only in early development". So: bump `SAVE_VERSION` to 3 and drop old saves with no migration code.
- **Q:** Rollout and default? — **A:** A renderer setting (Auto / WebGL / Canvas 2D). Auto picks WebGL if WebGL2 works. Canvas stays for fallback and comparison.
- **Q:** How to verify autonomously? — **A:** Node math tests + Playwright screenshots. Pure modules (matrices, camera, mesh builders, culling, batching, heightfield, slope physics) tested with `node:test`; Playwright smoke runs with software GL and asserts no GL errors, a non-blank canvas, and records screenshots/fps stats.
- **Q:** Plan ordering? — **A:** Incremental: renderer interface and GL core first, then layers (terrain/roads, buildings/trees, vehicles, lighting/shadows, weather, maps, perspective camera, polish), with Canvas working throughout.
- **Q:** Is the scope complete? — **A (free text):** "as part of the plan /commit first on a new branch. then branch off from the new one for this plan". So Phase 0 commits the current uncommitted Delivery Driver work on a new branch, then creates this plan's working branch off that branch.

Assumptions (not asked; defaults chosen while planning, change only with the user):
- **Height is a pure function.** `terrainHeight(region, x, y)` is deterministic from the region seed data + position, so the sim, AI fleet, traffic, renderer and tests all call the same function. Heights are in WORLD metres (same units as x/y); relief is exaggerated enough to be readable on the compressed map (target: Dartmoor high points ~25-40 world m, i.e. real ~330-520 m / 13), with road gradients capped (target <= 12% in the sim, rare short steeper sections on lanes).
- **Collisions stay 2D.** Collision shapes remain 2D OBBs on the ground plane. Vehicles get a z coordinate plus pitch/roll for rendering and for the gravity force; bridges are graded decks over the carved river valley.
- **The sim stays at 60 Hz, fixed timestep.** Slope forces are added inside the existing `stepVehicle`; no tyre-slip model.
- **One WebGL canvas, one Canvas 2D canvas.** A canvas cannot switch context type once created, so `index.js` creates a canvas for whichever renderer is selected and recreates it when the setting changes (or on a context-loss fallback).
- **WebGL2 only** (no WebGL1 path). `ANGLE_instanced_arrays` etc. are not needed.
- **Existing renderer public surface** (`createRenderer(ctx, view).draw(session, camera, alpha)`, `stats`) is the contract the new GL renderer must satisfy: both are produced by a factory `createRenderer(canvas, view, kind)` in `render/index.js`.
- **Minimap** is rendered by the GL renderer into a small offscreen render target (top-down orthographic view of the terrain + roads) and blitted to the HUD canvas, or drawn on its own small WebGL context if sharing is awkward. Decide inside Phase 9; the Canvas minimap remains for the fallback.
- **No new runtime dependencies.** Shader sources are JS template strings in `render/gl/shaders.js`.

## For Future Agents
As work proceeds: mark the item you are actively working on `- 🔄` (at most one per phase) and flip it to `- ✅` when it completes; when a phase is done, set its status to `Complete` and write its **Phase Summary** (what was done, key decisions, anything needed to continue with zero context); run the phase's **Verification Plan** and record the result before moving on. When all phases are done, fill in **Final Recap** and **Deployment Plan**.

Repo facts (verified 2026-11-03):
- **Game module.** `Games.Client/wwwroot/games/delivery-driver/` (~8000 lines of ES modules). Pure logic in `sim/`, `world/`, `game/`, `traffic/` (testable in Node); rendering in `render/`; DOM overlays in `ui/`; `index.js` wires it up. See plan 0006's "Design contract" and "Target file layout".
- **Current renderer.** `render/renderer.js` `createRenderer(ctx, view)` returns `{ stats, draw(session, camera, alpha) }` and draws in this order: sea fill, ground (under an affine ground transform: base, coast, towns, per-chunk ground, rivers, harbours, yards, practice yard, roads, junctions, bridges), night ground overlay, headlights, then depth-sorted objects (buildings, trees, rocks, cones, lamps, signs, signals, vehicles, trailers), then rain/fog/dusk. Look in `render/draw-*.js`, `render/era.js`, `render/shapes.js` (prisms with sun shading), `render/sprite-cache.js`, `render/minimap.js`, `render/projection.js` (oblique projection: `TILT = 0.78`, `HEIGHT = 0.62`, `toScreen/toWorld/depth/viewRadius`).
- **Canvas creation** is in `index.js` (`canvas.getContext('2d')`, view `{ width, height, dpr }`, `renderer = createRenderer(ctx, view)`), and `engine/camera.js` owns the chase/north-up camera and the projection.
- **Config.** `config.js` has `QUALITY` presets `{ traffic, drawChunks, spriteCache, maxDpr, trees, shadows }` (shadows flag exists but is unused), `CHUNK_SIZE = 160`, `WORLD_SCALE = 1/13`. Session settings: `{ quality, camera, manualGears, touchLayout }` in `game/session.js`.
- **Saves.** `game/save.js` `SAVE_VERSION = 2` with migrations from v1. This plan bumps to 3 and drops older saves.
- **World.** `world/world.js` (`world.region`, `world.graph`, `world.chunks`, `world.yards`, `world.practice`, `world.harbours`), `world/chunks.js` (per-chunk `buildings`, `trees`, `edges`, lamps/signs), `world/generator.js`, `world/roadgraph.js`, `world/region.js`, seed data in `world/seed/sw-england.json`.
- **Sim.** `sim/vehicle.js` (`stepVehicle(v, controls, dt, env)`), `sim/gearbox.js`, `sim/trailer.js`, `sim/coupling.js`, `sim/collision.js`; fleet/AI off-screen sim in `game/fleet.js`; economy (fuel, wear, damage) in `game/economy.js`; traffic in `traffic/traffic.js`.
- **Tests.** `dotnet test Games.slnx` (xUnit); `npm test` (= `node --test "tests/js/**/*.test.mjs"`; plain `node --test tests/js` does NOT work on Node 22); `npm run test:e2e` (Playwright, installed MS Edge, app on :5211, `--mute-audio`); the Delivery Driver e2e is `tests/e2e/delivery-driver.spec.mjs` and uses `window.__dd` (only when `options.debug`). Existing unit tests are `tests/js/delivery-driver.*.test.mjs`.
- **CI** (`.github/workflows/pages.yml`) runs `dotnet test` + `npm test` then publishes to Pages on every push to `main`. New `wwwroot` files are picked up by the service worker automatically; restart `dotnet run` after adding new `wwwroot` files (they 404 until then).
- **Practicalities.** Write files with the Write tool (large bash heredocs hit parse errors). Windows host, use forward-slash paths in bash. No third-party runtime JS.

Design contract for this plan (keep consistent across phases):
- **Renderer interface.** `render/index.js` exports `createRenderer({ canvas, view, kind: 'webgl'|'canvas2d' })` returning `{ kind, stats, resize(view), draw(session, camera, alpha), drawMinimap?, dispose() }`. `session`/`camera` stay renderer-agnostic. Anything GL-specific lives under `render/gl/`.
- **Layout (new files).** `render/index.js` (factory + fallback), `render/gl/context.js` (context creation, loss/restore, capability probe), `render/gl/shaders.js`, `render/gl/program.js`, `render/gl/mat4.js` (pure math), `render/gl/camera3d.js` (pure: view/projection, frustum), `render/gl/meshes.js` (pure mesh builders returning typed arrays: boxes, prisms, cylinders/wheels, extrusions), `render/gl/terrain-mesh.js` (pure: chunk terrain/road/coast mesh data), `render/gl/gl-renderer.js`, `render/gl/shadow.js`, `render/gl/weather.js`, `render/gl/minimap-gl.js`. Pure files (mat4, camera3d, meshes, terrain-mesh) must not touch the DOM or GL so they can be tested in Node. Terrain/physics: `world/terrain.js` (pure heightfield + `groundZ`, `slopeAt`, normals, road grading), `sim/slope.js` (pure slope forces).
- **Coordinates.** Unchanged: world metres, +x east, +y south, heading radians (0 = east). The GL scene uses +z up (height). Convert to the GL clip space only in `mat4`/`camera3d`.
- **Height units.** WORLD metres (same as x/y). `terrainHeight(x, y)` returns metres above sea level; the sea is `z <= 0`.
- **Debug hook.** `window.__dd` (debug only) gains `renderer` info (`kind`, draw stats) and `setRenderer(kind)`, and `terrainHeight(x, y)`, for Playwright.

## Recommended Model

Default to **Opus 5.5 at max effort** for this plan: most phases are cross-cutting numerical or graphics work (GL state, matrix/camera math, physics tuning) where subtle errors only show up as wrong-looking frames or drifting tests. Drop to **Sonnet 5.5** for phases that are mostly pattern-following against already-built infrastructure, and use **Haiku 5.5** only for mechanical git/test-running steps. Switch model per phase (start a fresh session or `/model` at the phase boundary; the plan file carries the context).

| Phase | Model | Why |
|---|---|---|
| 0 Git preparation | Haiku 5.5 (Sonnet 5.5 if the `commit` skill grouping needs judgment) | Mechanical: branch, commit, run baseline tests. |
| 1 Renderer abstraction and WebGL2 core | Sonnet 5.5 | Well-trodden boilerplate (factory, context loss, mat4, shader compile); clear tests. |
| 2 Terrain heightfield | Opus 5.5 | Road grading, junction/bridge consistency and relief tuning against numeric bounds need careful iteration. |
| 3 Slope physics and economy | Opus 5.5 | Touches vehicle, trailer, coupling, fleet, pathfinding, traffic and saves; physics must stay stable and consistent. |
| 4 GL terrain, roads, bridges | Opus 5.5 | Mesh generation, per-chunk batching/eviction and culling/LOD are the riskiest GL work. |
| 5 Buildings, trees, props | Sonnet 5.5 | Largely porting existing draw code onto the Phase 4 mesh and instancing helpers. |
| 6 Vehicles, trailers, traffic | Opus 5.5 | Model matrices, kingpin/articulation geometry and instanced rendering of many specs. |
| 7 Perspective chase camera | Opus 5.5 | Camera math, terrain clearance, unprojection and reversing framing are easy to get subtly wrong. |
| 8 Lighting, shadows, weather | Opus 5.5 | Shadow-map fitting/bias, shader lighting and night spotlights; hard to debug visually. |
| 9 Minimap and full map | Sonnet 5.5 | Reuses the heightfield, road data and GL core; mostly transforms and drawing. |
| 10 Performance, hardening, default flip | Sonnet 5.5 (Opus 5.5 for any frame-time root-causing) | Mostly config, fallbacks, e2e and docs; escalate only if profiling uncovers a hard regression. |

Never use Fable (user instruction). Run every Opus 5.5 phase at **max** effort; if Opus 5.5 gets stuck on the same defect, keep it at max effort rather than switching models.

- 🔄 Inspect `git status` and `git diff --stat` on `main` and check nothing sensitive or unwanted is staged (`.playwright-mcp/` is untracked tooling output: do not commit it, add it to `.gitignore` if not already ignored).
- [ ] Create a new branch off the current `main` HEAD named `feature/delivery-driver` and commit the current uncommitted Delivery Driver work on it using the `commit` skill (group by intent: game module + tests, shell integration changes such as registry/Options/ParentCorner/GameInfo, docs and plan 0006). Do NOT push unless the user asks.
- [ ] Create this plan's working branch `feature/delivery-driver-webgl` off `feature/delivery-driver` and switch to it. Commit this plan file (`_docs/plans/0007-delivery-driver-webgl.md`) as its first commit there.
- [ ] Run the baseline tests on the new branch and record the results in the Phase Summary: `npm test`, `dotnet test Games.slnx`, `npm run test:e2e -- delivery-driver` (so later regressions are distinguishable from pre-existing failures).

### Verification Plan
- `git branch --show-current` prints `feature/delivery-driver-webgl`; `git log --oneline -5` shows the plan commit above the Delivery Driver commit(s) on `feature/delivery-driver`.
- `git status --short` shows no uncommitted changes other than ignored files.
- Baseline test commands above are green (or any failures recorded as pre-existing).

### Phase Summary
_(write when phase completes)_

## Phase 1: Renderer abstraction and WebGL2 core
Status: Not started

- [ ] Add `render/index.js` with `createRenderer({ canvas, view, kind })` wrapping the existing Canvas renderer (move nothing yet; wrap `render/renderer.js` so it keeps its current signature and returns the new interface including `dispose()` and `resize()`).
- [ ] Change `index.js` to create the canvas via the factory, keyed by renderer kind, and to recreate the canvas element when the kind changes (a canvas cannot switch context types).
- [ ] Add the `renderer` session setting (`auto` | `webgl` | `canvas2d`, default `auto`) in `game/session.js` and a selector in the in-game settings UI (`ui/menus.js` / wherever quality is set); persist it with the other settings.
- [ ] Add `render/gl/context.js`: create a WebGL2 context (`antialias` per quality, `alpha: false`, `powerPreference: 'high-performance'`), probe capabilities (max texture size, depth texture, float render targets, instancing), expose `webgl2Available()`; handle `webglcontextlost` / `webglcontextrestored` (prevent default; on restore rebuild GPU resources; if it cannot be restored, fall back to Canvas 2D and toast "Switched to compatibility graphics").
- [ ] Add `render/gl/mat4.js` (pure column-major 4x4 math: identity, multiply, perspective, lookAt, ortho, invert, transform point; allocation-free variants writing into an `out` array) and `render/gl/program.js` (compile/link with readable errors, uniform/attribute location cache) and `render/gl/shaders.js` with a trivial flat-colour shader.
- [ ] Add `render/gl/gl-renderer.js` skeleton: `draw()` clears to the sea colour, draws a test ground quad with the flat shader using a fixed perspective camera, resizes with `view`/DPR (respecting `QUALITY[..].maxDpr`), and counts GL errors into `stats.glErrors`.
- [ ] Extend the debug hook (`window.__dd`) with `renderer: { kind, stats }` and `setRenderer(kind)`.

### Verification Plan
- `npm test` stays green; new `tests/js/delivery-driver.mat4.test.mjs` covers identity, multiply associativity, `perspective` + `lookAt` projecting a known point to the expected NDC, and `invert(M) * M = I` within 1e-9.
- `npm run test:e2e -- delivery-driver` passes with `renderer=canvas2d` forced (existing behaviour unchanged).
- New e2e case (software GL, e.g. Edge with `--use-angle=swiftshader` / `--enable-unsafe-swiftshader`): with `renderer=webgl`, `__dd.renderer.kind === 'webgl'`, `stats.glErrors === 0`, and the canvas is not uniformly one colour (sample pixels via `gl.readPixels` or a screenshot).
- New e2e case: force `WEBGL_lose_context.loseContext()` and assert the game stays running (`__dd.renderer.kind` becomes `canvas2d`).

### Phase Summary
_(write when phase completes)_

## Phase 2: Terrain heightfield (pure logic)
Status: Not started

- [ ] Add `world/terrain.js` (pure, DOM-free): `terrainHeight(region, x, y)` = deterministic fBm value noise (`engine/rng.js` `valueNoise`, seeded from `region.seed`) + large-scale shaping from seed data: moor polygons raised (Dartmoor, Bodmin, Exmoor fringe) with hand-set peak heights, tors from the existing generator's tor positions, river valleys carved along the river polylines (width from the river data), coast cliff lift near cliff-classed coast segments, and everything sinking to `z <= 0` toward the sea; flatten a pad under each town and depot yard and the practice yard.
- [ ] Add optional seed data to `world/seed/sw-england.json` where noise alone is not enough: `relief` entries (name, position, height, radius) for key places (Dartmoor high point, Bodmin Moor, Haldon Hill / Telegraph Hill on the A38 approach, Exeter's valley, Kit Hill, St Austell clay country, Hartland coast) and a `maxGrade` per road class.
- [ ] Add road grading: `gradeRoads(world)` computes a smoothed centreline height profile per road graph edge (limited slope per metre, blended at nodes so junctions are level, bridges level across rivers, short cuttings/embankments), stored in `edge.z` (typed array of samples) with a `roadHeightAt(edge, t)` helper, and have `groundZ(world, x, y)` return the road deck height on/near a road and the terrain height elsewhere with a smooth blend at the road shoulder.
- [ ] Add `slopeAt(world, x, y, heading)` returning `{ grade, pitch, roll, nx, ny, nz }` (sampled with central differences over the vehicle footprint, cached per frame), plus `groundNormal`.
- [ ] Tune relief so max sustained road grade is within the Assumptions bound and no town/yard/bay ground has more than ~2% slope (the loading bay must stay flat).
- [ ] Add `terrain` to chunk generation (`world/chunks.js`): each chunk stores a height grid (e.g. 17x17 samples at `CHUNK_SIZE = 160`) computed once and cached with the chunk; buildings, trees, lamps and signs get a `z` from `groundZ`.

### Verification Plan
- New `tests/js/delivery-driver.terrain.test.mjs` (seeded, Node): determinism (two calls equal, two region instances equal); sea points `<= 0`; Dartmoor centre higher than Exeter pad; Exeter depot yard, practice yard and loading bay slope `< 2%`; for every edge of the road graph, sampled grade never exceeds the class `maxGrade`; junction nodes agree (heights from all meeting edges within 1 cm); a bridge edge's profile is within tolerance of linear between its abutments; `slopeAt` on a plane-like region returns the expected pitch/roll signs for known headings.
- `npm test` green; the Canvas game still loads and plays (e2e `renderer=canvas2d`), since nothing draws height yet.

### Phase Summary
_(write when phase completes)_

## Phase 3: Slope physics and economy effects
Status: Not started

- [ ] Add `sim/slope.js` (pure): `slopeForce(mass, grade)` (`m * g * sin(theta)` along the heading), `brakeFade(heatState, dt, brakeInput, speed, grade, mass)` returning the new heat and an effectiveness multiplier (0.35-1.0), `engineBraking(rpm, gear, throttle)`.
- [ ] Extend `sim/vehicle.js` `stepVehicle` to take ground slope from `env` (`env.grade`, `env.pitch`, `env.roll`, `env.groundZ`), apply the gravity force along the heading to speed (uphill decelerates, downhill accelerates, rolling back on steep slopes with the handbrake off and no throttle), add engine braking when off-throttle in gear, scale brake force by the brake-fade multiplier, and keep `v.z`, `v.pitch`, `v.roll` (smoothed) on the vehicle for rendering. Heavier loads (`totalMass` including trailer) climb more slowly and descend faster; auto gearbox down-shifts on climbs (adjust up-shift points by grade).
- [ ] Extend `sim/trailer.js` and `sim/coupling.js`: loose/uncoupled trailers on a grade `> ~3%` roll along their heading unless their handbrake is set (new `trailer.parkBrake`, set automatically on uncouple at `< 3%`, with a HUD hint to hold it on steeper ground; auto-set when the player presses the handbrake near it); braking downhill with a trailer applies a push on the trailer that raises jack-knife risk (articulation angle grows when the trailer is heavier than the tractor's braking, mitigated by trailer brakes on rigs from 1956); coupling checks account for grade (tolerance on the kingpin height mismatch).
- [ ] Extend `game/economy.js` / the vehicle wear model: fuel burn multiplier from grade (`+x%` per % uphill, `-y%` downhill, floor at 0.3), engine wear from sustained full-throttle steep climbs and brake wear from heavy braking downhill; brake overheating raises brake wear.
- [ ] Make `game/fleet.js` (off-screen hired drivers) and `world/pathfind.js` route costs grade-aware: each edge's travel time uses average speed after the climb/descent penalty from `edge.z`, fuel use uses the same fuel multiplier, so AI deliveries on hilly roads take longer and cost more. Contract deadline/pay estimates (`game/contracts.js`) use the same function so they stay fair.
- [ ] Traffic (`traffic/traffic.js`): AI vehicles slow on climbs (weaker 1919 vehicles and tractors crawl) and take `z` from the road profile; no collision changes.
- [ ] HUD: gradient readout (e.g. "Hill 8% up/down") and a brake-temperature warning next to the speedo (`ui/hud.js`); add tutorial hints (`game/tutorial.js`) for engine braking and parking brakes on hills.
- [ ] Bump `SAVE_VERSION` to 3 in `game/save.js`; remove the v1 -> v2 migration and make older saves load as "no save" with a short notice (per the user's instruction to nuke saves). Dropped trailers still store x, y, heading and snap to ground height on load.

### Verification Plan
- New `tests/js/delivery-driver.slope.test.mjs` (Node): on a constant 6% uphill, a loaded rigid decelerates versus the flat case by the analytic amount (within 2%) and a heavier load loses more speed; on a downhill it gains speed and with engine braking holds a lower terminal speed than without; rolling-back on a 10% slope with no throttle and no handbrake; brake fade reduces effectiveness after N seconds of continuous heavy braking downhill and recovers on flat; a loose trailer at 6% with `parkBrake=false` moves downhill, and with `parkBrake=true` does not; downhill heavy braking increases articulation angle for a trailer without trailer brakes; fuel multiplier is monotonic in grade; the gearbox picks a lower gear on a climb.
- Extend `tests/js/delivery-driver.fleet.test.mjs` / pathfind tests: a hilly route takes strictly more game time and fuel than a flat route of equal length.
- Update `tests/js/delivery-driver.save.test.mjs` for `SAVE_VERSION = 3` and "old saves are dropped".
- `npm test` green; e2e `renderer=canvas2d` still passes (flat look, slope physics active: assert via `__dd.state` that a vehicle teleported to a steep road slows when released).

### Phase Summary
_(write when phase completes)_

## Phase 4: GL terrain, water, roads, junctions and bridges
Status: Not started

- [ ] Add `render/gl/meshes.js` (pure): typed-array builders for indexed triangle meshes with position, normal, colour (and uv where needed): `grid`, `box`, `prism(polygon, height)`, `cylinder`, `extrudeStrip(polyline, width, heightProfile)`, plus a helper to merge meshes with a transform.
- [ ] Add `render/gl/terrain-mesh.js` (pure): from a chunk's height grid + ground-use data, build the chunk ground mesh (vertex colours for grass/field/moor/heather/beach/cliff/town ground/sea floor, with the field pattern from `render/draw-terrain.js` baked to vertex colours or a small tiling texture), coast surf strip, rivers (translucent water strips at `z = 0` plus bank carving from the heightfield), and a low-resolution far-field mesh covering the whole region for distance.
- [ ] Build road meshes per edge from `edge.z` (Phase 2): carriageway strip with era-correct surface colours (macadam < 1926, tarmac + white lines after, edge lines from 1970 per `roadStyle`), centre/edge line decals, dualled carriageways, junction patches, roundabouts, bridges with parapets and abutments, ferry slipways, and the yard/bay/practice markings as decals draped on the terrain.
- [ ] Add the terrain/road shaders to `render/gl/shaders.js` (vertex colour + sun direction lambert + hemispheric ambient + distance fog; water shader with simple animated tint) and a draw-call batching layer in `gl-renderer.js`: one VBO/IBO per chunk, built lazily (budgeted per frame like `session.chunkBudget`), cached with the chunk, freed when chunks are evicted (`world.chunks.cap`).
- [ ] Culling and LOD in `render/gl/camera3d.js` (pure): frustum planes from the view-projection matrix, sphere/AABB tests, chunk visibility, distance-based LOD choice (full mesh near, coarse mesh far), view distance by quality (`QUALITY[..].drawChunks`).
- [ ] Era changes: when `session.year` crosses an era (road upgrades / new roads from `world/history.js`), rebuild only the affected edges' meshes.

### Verification Plan
- New `tests/js/delivery-driver.terrain-mesh.test.mjs`: grid mesh vertex count/index count/winding (all triangle normals point up), every vertex `z` equals `terrainHeight` at its `x, y` (within 1e-6), road strip vertices sit at `edge.z` samples (+ small bias), strip width correct, merge preserves vertex counts; `camera3d` frustum test: a chunk directly ahead is visible, one behind is culled, LOD thresholds monotonic.
- Playwright (software GL): load the game with `renderer=webgl`, teleport to Exeter, then to Dartmoor, take screenshots into `test-results/`, assert `glErrors === 0` and `stats.chunks > 0` and draw calls within a budget (< 300).
- `npm test` green.

### Phase Summary
_(write when phase completes)_

## Phase 5: Buildings, trees, props and street furniture
Status: Not started

- [ ] Extend `render/gl/meshes.js` with building mesh generation matching `render/draw-buildings.js` styles (`houses`, shops, pubs, farmhouses, barns, churches, chimneys, pitched/hipped/flat roofs via roof prisms, doors/windows as inset quads or baked colour bands, era-dependent colours/materials, fascias from `render/era.js`) and per-building `z` from the ground.
- [ ] Batch buildings per chunk into a single static mesh (merged), rebuilt when the chunk is built; trees, rocks, hedges, cones, bollards drawn with instancing (per-type low-poly mesh + per-instance position/scale/rotation/tint, instanced attribute buffers per chunk), with `QUALITY[..].trees` thinning the instances.
- [ ] Street furniture meshes: gas lamps / swan-necks / steel columns by era, finger posts and Worboys signs, traffic signal heads showing the live `signalPhase` (instanced with a per-instance light colour updated each frame), shop signs, the loading-bay marker and depot buildings/yards, harbour quays, breakwaters and boats.
- [ ] Granite tors and moor rocks use the tor positions from the generator; cliffs get rocky vertex colours from the slope of the terrain mesh.
- [ ] Fix hardware limits: keep index counts < 65,535 per draw (use `Uint32` indices with WebGL2 or split merged chunk meshes).

### Verification Plan
- New `tests/js/delivery-driver.building-mesh.test.mjs`: each building style yields non-empty meshes with finite vertices, normals unit length, bounding box matching the building footprint + height within tolerance, no vertex below its base `z`; instance buffer builder returns the expected counts per quality preset; merge of N buildings has the sum of vertices.
- Playwright (software GL): screenshots at Exeter high street (1919), the same place in 1985, and a farm area; assert `glErrors === 0` and stats `drawables > 0`; compare that the 1919 and 1985 screenshots differ (era colours/lamps).
- `npm test` green.

### Phase Summary
_(write when phase completes)_

## Phase 6: Vehicles, trailers and traffic in 3D
Status: Not started

- [ ] Port `render/draw-vehicles.js` to 3D mesh builders in `render/gl/vehicle-mesh.js` (pure): from `VEHICLES` / `TRAILERS` catalogue specs build bodies (cab, bonnet, load bed, box, tanker, livestock, reefer, curtainsider, low-loader, tipper), wheels as cylinders that can spin and steer, lights, mirrors, era styling, liveries (two company colours), damage tint; cache a mesh per (spec, livery) in a small LRU.
- [ ] Render vehicles with per-instance model matrices built from `(x, y, z, heading, pitch, roll)`: the player, owned/parked fleet in yards, hired drivers on the map, loose and coupled trailers (trailer pitch derived from the kingpin height vs its axle height), tractor + trailer articulation, steering wheel angle, wheel rotation from speed, brake/indicator/reverse lamp emissive colours and the reversing beeper state unchanged.
- [ ] Traffic: instanced AI cars, buses, tractors, bicycles and carts using the same mesh cache (low-poly variants), `z`/pitch from the road profile.
- [ ] Collision/damage visual feedback: dents as a darker tint/tilt by damage level, cargo visible on flatbeds/open loads, smoke from engine at low health (instanced billboards).
- [ ] Loading effects: bay marker glow, load bar visuals unchanged (DOM).

### Verification Plan
- New `tests/js/delivery-driver.vehicle-mesh.test.mjs`: every catalogue vehicle and trailer builds a non-empty mesh with bounding box length/width/height within 5% of the spec; wheel positions match `axle` values; the model-matrix builder maps the rear axle origin to the vehicle pose and keeps the matrix orthonormal; pitch/roll from slope tilts the mesh the expected direction; articulation: the trailer matrix at the kingpin coincides with the tractor's fifth wheel point (within 1 cm).
- Playwright (software GL): spawn each catalogue vehicle via a debug call (add `__dd.spawnVehicle(id)` if missing), take a screenshot grid, assert `glErrors === 0`; reverse an artic under a trailer scripted via `__dd` and screenshot the coupling frame.
- `npm test` green; existing trailer/coupling tests unchanged.

### Phase Summary
_(write when phase completes)_

## Phase 7: Perspective chase camera and controls
Status: Not started

- [ ] Add `render/gl/camera3d.js` perspective camera driven by the existing `engine/camera.js` state: chase (behind the rear of the vehicle or rig, distance and height from zoom, rotating with the heading with smoothing), north-up toggle, zoom (wheel/pinch/keys), adjustable tilt (new `Q`/`E` or a UI slider and touch two-finger vertical drag; defaults to ~35 degrees above the horizon), and the reversing view that pulls back and raises to frame the whole rig including the trailer.
- [ ] Camera collision with terrain: keep the camera above the ground (`terrainHeight + clearance`) and push it in so hills never hide the truck; look-at point smoothing so slope changes do not jolt; field of view by aspect (portrait vs landscape), near/far planes by quality draw distance.
- [ ] Keep Canvas camera behaviour untouched: `engine/camera.js` exposes both the oblique `proj` and the 3D state; the Canvas renderer keeps using `proj`.
- [ ] Make picking and screen-space things renderer-agnostic: replace any use of `toWorld(p, sx, sy)` for taps (map tap, touch controls) with a camera method `screenToGround` implemented for both camera types (3D: unproject a ray and intersect the heightfield).
- [ ] Touch/keyboard settings: add the tilt control to the touch layout and the options panel; persist `cameraTilt` and `cameraMode`.

### Verification Plan
- New `tests/js/delivery-driver.camera3d.test.mjs`: the vehicle's world point projects near the lower-middle of the screen in chase mode; rotating the vehicle by 90 degrees rotates the view eye accordingly; north-up keeps the eye fixed relative to world axes; the reversing view eye is farther/higher than the normal one and the trailer rear point projects inside the viewport; terrain clearance: with a hill between the ideal eye and the truck, the eye is lifted above `terrainHeight`; `screenToGround` round-trips with `project` (within 1 cm) on flat ground and on a sloped plane.
- Playwright (software GL): drive, toggle camera modes and tilt, screenshots, assert the truck stays visible (pixel colour test around the screen centre-lower area differs from the terrain colour) and `glErrors === 0`.
- `npm test` green.

### Phase Summary
_(write when phase completes)_

## Phase 8: Lighting, shadows, night and weather
Status: Not started

- [ ] Sun model (pure, `render/gl/sun.js`): sun direction, colour and intensity from game time-of-day and day-of-year (low winter arc, dawn/dusk warmth, moon at night), ambient/hemispheric sky colours; replaces the Canvas `light` scalar in the GL renderer (the Canvas path keeps `session.light`).
- [ ] Shadow map (`render/gl/shadow.js`): a depth texture (1024-2048 by quality) rendered from the sun, fit to a cascade around the camera focus (single cascade; optionally two on high), PCF filtering, slope-scaled bias; casters: vehicles, trailers, buildings, trees, lamps; receivers: terrain, roads, objects. `QUALITY[..].shadows` toggles it (off on `low`: blob shadows under vehicles instead).
- [ ] Night: dim sun/ambient, lit windows on buildings, glowing street lamps (emissive + additive halo billboards), vehicle headlights/tail lights, headlight cones as projected spotlight on terrain and objects (a couple of forward-facing cones for the player and nearest traffic, computed in the fragment shader against a small uniform array), fog tinting at dusk.
- [ ] Weather (`render/gl/weather.js`): rain as instanced streak particles around the camera with wet-road darkening and specular, fog as exponential distance fog (strength from `session.weather`), overcast tint, puddle sheen on roads, wipers/spray optional (skip if costly). Weather state and grip (existing `session.weather`) stay the same.
- [ ] Sky: gradient sky dome / horizon fog colour matching the sun, distant hills silhouette from the far-field mesh.

### Verification Plan
- New `tests/js/delivery-driver.sun.test.mjs`: noon sun elevation > midnight; summer noon elevation > winter noon; sun direction is a unit vector; intensity goes to ~0 below the horizon; colour is warmer at dawn than at noon; continuity (no jumps > epsilon across time steps) and 24h periodicity.
- Shadow math tests (`tests/js/delivery-driver.shadow.test.mjs`): the light-space ortho bounds enclose the camera frustum corners within the fitted focus region; texel snapping stable under sub-texel camera moves.
- Playwright (software GL): screenshots at dawn, noon, dusk and night (`__dd.advanceClock`), clear and rain and fog (`__dd` weather setter, add if missing); assert `glErrors === 0`; assert mean screenshot brightness at night < noon, and fog/rain frames differ from clear.
- Run each quality preset and record frame time stats (`stats.frameMs`) in the Phase Summary.

### Phase Summary
_(write when phase completes)_

## Phase 9: Minimap and full map in WebGL
Status: Not started

- [ ] Add `render/gl/minimap-gl.js`: a top-down orthographic render of the heightfield (shaded relief with hypsometric tint: sea, lowland, moor, cliff), era-correct roads (closed/unopened hidden, dualled green), towns/depots/ferries, the magenta route line with dark outline, and the player/trailer/AI markers; draws to an offscreen render target then to the HUD canvas, redrawn at the existing 5 Hz cadence, rotating with the chase camera as the Canvas minimap does.
- [ ] Full map screen (`M`, tap minimap): pan/zoom in WebGL with the same data; text labels (town names) are DOM/Canvas overlays on top (GL text is out of scope).
- [ ] Canvas fallback minimap (`render/minimap.js`) gets a cheap relief hint (shaded hillshade tint from the heightfield sampled to a coarse offscreen canvas once per region) as promised in the decision on the Canvas fallback.
- [ ] Unify map interaction: tap on the map uses `screenToGround` of the map view; route planning unchanged.

### Verification Plan
- New `tests/js/delivery-driver.minimap-gl.test.mjs`: the map transform maps world bounds to the viewport and back (round-trip within 1e-6), the hillshade function returns brighter for slopes facing the light than away, road visibility by year matches `edgeOpen` for a few known roads (e.g. M5 absent in 1919 and present in 1977 per `world/history.js`).
- Playwright (software GL): open the map, screenshot, assert it is not blank and `glErrors === 0`; pan/zoom via the debug hook; assert the route line is drawn (magenta pixel present) when a job is active.
- `npm test` green.

### Phase Summary
_(write when phase completes)_

## Phase 10: Performance, quality presets, fallback hardening and default flip
Status: Not started

- [ ] Profile (Playwright + `stats`) on each quality preset and tune: draw calls, vertex counts, chunk-build budget per frame (no hitches when driving into new chunks), mesh cache sizes, shadow map size, instance counts, DPR cap, `antialias` only on `high`. Targets: desktop 60 fps, mid-range phone 30+ fps on `low`/`medium` (measure with CPU-throttled Edge and record numbers).
- [ ] Update `QUALITY` in `config.js` with 3D-specific fields (`viewDistance`, `shadowMapSize`, `instances`, `antialias`, `farField`) and keep the old fields for Canvas.
- [ ] Auto quality: on `renderer=auto`, if the average frame time stays above 40 ms for 5 s, drop one quality level (toast once); never raise automatically.
- [ ] Fallback hardening: shader compile failure, missing capability or repeated context loss all fall back to Canvas 2D cleanly with a toast; `dispose()` frees every GL resource (buffers, textures, programs, framebuffers) and the Canvas path leaves no listeners behind; unmounting the game and remounting works; `setOptions({ paused })` stops the GL loop.
- [ ] Make `renderer: 'auto'` choose WebGL when supported (this is the default flip; the setting UI shows "Graphics: Auto / 3D (WebGL) / Compatibility (Canvas)").
- [ ] Update `README.md`, `_docs/code-docs/Games/` (via the `doc-code` skill for any C# changes only; add hand-written notes for the JS render layout in the Delivery Driver docs if present), and plan 0006's file layout note pointing to this plan.
- [ ] Extend `tests/e2e/delivery-driver.spec.mjs`: run the existing smoke flow under both `renderer=webgl` and `renderer=canvas2d`.

### Verification Plan
- `npm test`, `dotnet test Games.slnx`, `npm run test:e2e` all green (including the Delivery Driver smoke under both renderers, `phone-fit`, `fullscreen`, `update-banner`).
- Playwright perf check with CPU throttling: median frame time on `medium` below 33 ms, `low` below 25 ms in software GL baseline (record actual numbers and the machine in the Phase Summary; software GL is slower than a real GPU, so these are upper bounds).
- Manual-free fallback check: e2e forces `webgl` unavailable (override `HTMLCanvasElement.prototype.getContext` to return null for `webgl2` via `addInitScript`) and asserts the game runs on Canvas 2D.
- `dotnet build Games.slnx` has no new warnings; the service worker still precaches new files (check the assets manifest in the build output includes `games/delivery-driver/render/gl/*.js`).

### Phase Summary
_(write when phase completes)_

## Final Recap
_(write when all phases complete: summary of the entire piece of work)_

## Deployment Plan
_(write when all phases complete: step-by-step deployment instructions)_
