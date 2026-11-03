# Delivery Driver (haulage career game)

Add a new game, **Delivery Driver**, to the Games shell: a semi top-down, faux-3D haulage game set in Devon and Cornwall. The player starts in 1919 at an Exeter depot with a Model-T-style light van and drives every delivery themselves: load at the depot, drop or collect around the area, get paid. They grow a haulage company across the decades with bigger and newer vehicles, articulated trucks with real trailer physics, extra depots and hired AI drivers. Only Devon and Cornwall are built in this plan, but the world is designed so other UK regions can be added later.

## Decisions & Answers

Original brief (user, 2026-11-02): "new game, 'Delivery Driver': A semi top down 3d svg graphics game where you load up your truck at a hub/depot/warehouse and delivery to customer around the local area. A full UK based map, with roads, taffic, buildings, farms, countryside. You drive the truck, get paid for each drop or pick up and build up your haulage empire. Start in 1919 with a Ford Model T style truck, and work up through time and size and type of vehicle. Articulated trucks should be able to change trailers and have full trailer physics, particularly when reversing. Pick up contracts, get paid, pick more contacts, get paid, trade in truck/add additional ones to your roster, pick more contracts and so on"

- **Q:** Where should Delivery Driver live, given the repo is a toddler app? — **A:** New game in this repo: `Games.Client/wwwroot/games/delivery-driver/`, using the existing shell (registry tile, mount/unmount contract, PWA, Pages deploy). It's a standalone module with its own UI rules for older players.
- **Q:** Devices and controls? — **A:** Keyboard + touch: desktop keyboard (WASD/arrows) plus on-screen pedals and a steering control on tablets and phones. Gamepad optional (nice-to-have, not required).
- **Q:** Rendering ("semi top-down 3D SVG graphics")? — **A:** Canvas 2D, faux-3D: vector-style art drawn in code onto a canvas, in angled top-down/oblique projection with extruded buildings and vehicles. No runtime dependencies.
- **Q:** What does "a full UK based map" mean? — **A:** A stylised, compressed UK: real towns in roughly the right places, main A-roads/motorways, procedural local streets/farms/countryside in between.
- **Q:** Map scale / region? — **A (free text):** "South west, Devon, Cornwall". Clarified: **Start with the South West, expand to the UK later.** Build Devon + Cornwall now. The data format and world system must support adding regions later (other regions are out of scope for this plan).
- **Q:** How compressed should Devon + Cornwall be? — **A:** Exeter to Penzance in about 10 real minutes (roughly 1:13-1:15 compression). Local drops take 1-3 minutes.
- **Q:** First depot and towns? — **A:** Exeter start. Main towns: Exeter, Plymouth, Torquay/Paignton, Barnstaple, Okehampton, Bodmin, Truro, Falmouth, St Austell, Newquay, Penzance, St Ives, plus villages and farms.
- **Q:** Traffic and road rules? — **A:** Living traffic, light rules. Drive on the left. AI cars, tractors and buses follow lanes, give way at junctions/roundabouts and obey signals (signals only in years they existed). Collisions damage the truck/cargo and reduce pay. No police or fines.
- **Q:** Progression through time from 1919? — **A:** In-game calendar. Deliveries take in-game hours and days pass. Years advance, unlocking vehicles, roads and trailer types by year.
- **Q:** What do trucks you aren't driving do? — **A:** Hire AI drivers, assign them a truck and contracts. They run deliveries off-screen (simulated), earning money minus wages, and are visible on the map. The player always drives one truck.
- **Q:** Driving/trailer physics realism? — **A:** Sim-lite: kinematic bicycle model, articulated trailers pivot on the fifth wheel, can jack-knife, reverse realistically (hard). Weight affects acceleration/braking. Automatic gears with an optional manual mode. No tyre-slip simulation.
- **Q:** Loading at the depot? — **A:** Reverse onto a loading-bay marker (reversing skill matters), then loading runs on a short timer. Mixed loads for multi-drop runs are chosen from a cargo list.
- **Q:** Economy systems? — **A:** All four: fuel + refuelling; wear, damage, repairs; driver wages + loans; deadlines + bonuses (late = reduced pay, early/undamaged = bonus, reputation per client).
- **Q:** Business expansion? — **A:** All four: extra depots in other towns; trade-in + used market; company name + livery; reputation tiers unlocking bigger contracts.
- **Q:** Cargo/contract types? — **A:** All four: multi-drop parcels/goods; pick-ups/collections; point-to-point haulage; special cargo needing the right vehicle/trailer (livestock, milk, china clay, fish, timber, fuel, refrigerated).
- **Q:** Real brand names? — **A:** Fictional names, era-styled (look inspired by real eras, made-up makes such as "Tamar Motor Co.").
- **Q:** Vehicle range? — **A:** About 12-15 vehicles across eras and classes, plus trailer types (box, curtainsider, flatbed, tanker, reefer, livestock, low-loader). Drawbar trailers optional.
- **Q:** World presentation? — **A:** All four: day/night cycle; weather (rain/fog affecting grip and visibility); era-changing visuals; minimap + full map.
- **Q:** Sound? — **A:** Synthesized WebAudio: engine note following RPM, different per vehicle, horn, reversing beeper (1980s+), indicators, ambience. No audio files.
- **Q:** Camera? — **A:** Chase-rotate + toggle. Default: behind the truck, rotating with it, oblique tilt. Toggle to north-up, plus zoom. A reversing view zooms out to show the whole trailer.
- **Q:** Bankruptcy? — **A:** Bailout. Below zero: forced loan / sale of trucks. Game over only with no trucks and no way to borrow; then restart, with an option to keep the old save as "retired".
- **Q:** Saves? — **A:** 3 slots, autosave after each delivery and every few minutes, export/import of a save file. The shell gear still gives exit + sound.
- **Q:** Performance target? — **A:** Mid-range phone (60 fps target, 30 fps acceptable): culling, cached building sprites, a capped traffic count, a quality setting.
- **Q:** Map authoring? — **A:** Seed data + generator. Hand-written JSON of real towns (positions from lat/long), main roads, coast outline, Dartmoor/Bodmin Moor. A deterministic generator builds town streets, villages, farms, fields and lanes, cached per chunk.
- **Q:** Clock speed? — **A:** 1 real minute = 15 game minutes (tunable constant).
- **Q:** Driver realism (fatigue / skip time / era navigation / tutorial)? — **A:** Tutorial only. No fatigue, no sleep/skip-time, no era-limited navigation. A guided first job in 1919 (drive, back into bay, deliver) plus a reversing practice yard.
- **Q:** Artic coupling? — **A:** Reverse under + key. Reverse the tractor's fifth wheel under the trailer kingpin within tolerance, then press Couple. Uncouple leaves the trailer where it stands. Trailers persist in the world at depots/customers (drop-and-swap jobs possible).
- **Q:** Route guidance? — **A:** Route line always shown on minimap and full map, in every era.
- **Q:** Does the clock pause in menus? — **A:** The clock runs only while driving in the world. Menus (contracts, garage, map) pause it.
- **Q:** Historic road changes? — **A:** Yes, key milestones: Exeter bypass (1938), Torpoint/Saltash ferries until the Tamar Bridge (1961), M5 to Exeter (1977), A30 dualling/bypasses (1970s-2000s). Roads appear/upgrade on real-ish dates.
- **Q:** First playable milestone? — **A:** 1919 Exeter local: the Model-T-style van around a generated Exeter area with traffic, depot loading bay, multi-drop contracts and pay. Then layer on the full SW map, economy, eras, artics/trailers, fleet/AI, depots, polish.
- **Q:** Currency/units? — **A:** No inflation: flat game-currency values throughout (shown as £, speeds in mph, distances in miles). Pay scales with cargo, weight and distance, not with year.
- **Q:** Audience? — **A:** Older kids + adults. Readable text UI, normal difficulty. The shell's toddler rules (no reading, no fail states) don't apply inside this game; the shell's gear/exit still works.
- **Q:** Testing? — **A:** Node logic + Playwright smoke. Pure DOM-free modules (physics, trailer kinematics, economy, contracts, map generator, calendar, AI fleet sim) tested with `node:test` and a seeded RNG. A Playwright smoke test: game loads, truck drives, a scripted job is delivered via a debug hook.
- **Q:** Out of scope? — **A:** Multiplayer; other UK regions (future plan); mod support / map editor; music.
- **Q:** Scope summary complete? — **A:** "Yes, write the plan".

Assumptions (not asked; defaults chosen while planning, change only with the user):
- **Speeds and scale.** Displayed speeds are real (mph), and world distances are compressed about 1:13. With the 15x clock, a trip's game-time duration stays roughly realistic. The "Exeter-Penzance ~10 min" target is for a mid-era lorry at ~50 mph on main roads; the 1919 van (top speed ~25 mph) takes about twice as long. Constants: `WORLD_SCALE` (real metres to world metres, ~1/13) and `TIME_SCALE = 15` in `config.js`.
- **Projection.** Equirectangular around 50.5°N (x = lon * cos(50.5°), y = lat) to real metres, then `WORLD_SCALE`. Region data has its own origin, so regions can be added later.
- **No drawbar trailers** (marked optional by the user; left out).
- **Calendar.** Runs from 1 Jan 1919 with no end date. After the last vehicle unlocks (2020s) the game continues indefinitely.
- **Hardcore Mode / levels.** These shell features don't apply here. A registry flag hides the parent-corner Hardcore button and the Options "Level / Reset levels" row for this game. The game has its own "delete slot" in the save menu.
- **Save storage.** Slot index in the shell's `saveProgress` object (`games.progress.delivery-driver`). Each slot's state is in its own localStorage key `games.dd.slot<1-3>`. The world is regenerated from the seed, so only changes are stored (owned assets, contracts, dropped trailers, calendar, money, reputation). The budget is about 500 KB per slot. Switch to IndexedDB only if that's exceeded.
- **Orientation.** Landscape is preferred. Portrait shows a "rotate your device" hint but still plays.

## For Future Agents
As work proceeds: mark the item you are actively working on `- 🔄` (at most one per phase) and flip it to `- ✅` when it completes; when a phase is done, set its status to `Complete` and write its **Phase Summary** (what was done, key decisions, anything needed to continue with zero context); run the phase's **Verification Plan** and record the result before moving on. When all phases are done, fill in **Final Recap** and **Deployment Plan**.

Repo facts (verified 2026-11-02):
- **Game contract.** Games mount via `Games.Client/wwwroot/js/host.js`: `mount(container, options)` with `options = { soundEnabled, speechEnabled, debug, onExit(), onReward(stars), loadProgress(), saveProgress(obj) }`. It returns `{ unmount(), setOptions(next) }`, and `setOptions` receives `{ soundEnabled, speechEnabled }`, `{ paused }` (grown-ups panel open) or `{ hardcore }`. See README "Adding a game".
- **Registry.** `Games.Client/wwwroot/games/registry.json` is read by `Services/GameRegistry.cs` into the `GameInfo` record, and `tests/Games.Tests/GameRegistryTests` checks every module file exists.
- **Tests.** `dotnet test Games.slnx` (xUnit, `tests/Games.Tests`); `npm test` (= `node --test "tests/js/**/*.test.mjs"`; plain `node --test tests/js` does NOT work on Node 22); `npm run test:e2e` (Playwright, installed MS Edge, app on :5211, `--mute-audio`).
- **CI.** `.github/workflows/pages.yml` runs `dotnet test` + `npm test` and then publishes to GitHub Pages on every push to `main`. The service worker caches all `wwwroot` files with hashes, so new data files are picked up automatically.
- **Practicalities.** Restart `dotnet run` after adding new `wwwroot` files (new files 404 until then). Write files with the Write tool (large bash heredocs hit parse errors). No third-party runtime JS dependencies.

Design contract for this game (keep consistent across phases):
- **Logic/presentation split.** Everything under `games/delivery-driver/` is an ES module. Pure, DOM-free logic (testable in Node) lives in `sim/`, `world/`, `game/` and `traffic/`. Canvas rendering lives in `render/`, DOM overlays in `ui/`, WebAudio in `audio/`. `index.js` wires them together.
- **Fixed timestep.** Simulation runs at 60 Hz (`engine/loop.js`) and rendering interpolates. All randomness goes through `seededRng` (same algorithm as `animal-feeding/logic.js`).
- **Coordinates.** World units are metres in world space, +x east, +y south (canvas), heading in radians, 0 = east.
- **Debug hook.** When `options.debug` is true, `window.__dd` exposes `{ state, teleport(x,y,heading), setControls({throttle,brake,steer}), completeDrop(), advanceClock(hours) }` for Playwright. It is never exposed in production.

Target file layout (`Games.Client/wwwroot/games/delivery-driver/`):
```
index.js            mount/unmount, wiring, debug hook
config.js           WORLD_SCALE, TIME_SCALE, quality presets, tuning constants
styles.css          overlay/HUD styles (injected by mount, removed by unmount)
engine/  loop.js input.js (keyboard+touch+gamepad) camera.js
render/  projection.js renderer.js draw-road.js draw-buildings.js draw-vehicles.js draw-terrain.js draw-weather.js sprite-cache.js minimap.js
sim/     vehicle.js (bicycle model) trailer.js coupling.js gearbox.js collision.js
world/   seed/sw-england.json (towns, roads, coast, moors, history) region.js generator.js chunks.js roadgraph.js pathfind.js history.js
traffic/ traffic.js (spawn, lane follow, give way, signals)
game/    calendar.js contracts.js economy.js catalogue.js (vehicles+trailers) fleet.js depots.js reputation.js save.js tutorial.js
ui/      hud.js menus.js (contracts board, garage, dealer, bank, depots, drivers, map, save slots) touch-controls.js
audio/   sound.js (engine synth, horn, beeper, indicators, ambience)
```
Tests: `tests/js/delivery-driver.*.test.mjs`; e2e: `tests/e2e/delivery-driver.spec.mjs`.

## Phase 1: Shell integration and engine skeleton
Status: Complete

- ✅ Add optional `features` to `GameInfo` (C# record in `Services/GameInfo.cs`) parsed by `GameRegistry`: `hardcore` (default true) and `levels` (default true). `ParentCorner.razor` hides the Hardcore button when `hardcore` is false; `Options.razor` hides the "Level N / Reset levels" row when `levels` is false. Add xUnit tests for parsing the defaults and the explicit `false`.
- ✅ Register `{ "id": "delivery-driver", "title": "Delivery Driver", "icon": "🚚", "module": "games/delivery-driver/index.js", "features": { "hardcore": false, "levels": false } }` in `registry.json`.
- ✅ Create `index.js` with `mount`/`unmount`/`setOptions`: a full-container `<canvas>` (DPR-aware, resize observer), injected `styles.css`, and `paused` handling (stops the loop and audio). `unmount` removes the canvas, listeners, RAF, timers and the AudioContext.
  - Note: index.js delegates game state to a new game/session.js (the glue object owning player, world, clock, jobs and the debug hook) so index.js stays a thin mount/wiring layer.
- ✅ `engine/loop.js`: fixed 60 Hz update with an accumulator (max 5 steps per frame), and a render callback with an interpolation alpha. Pure scheduler logic is testable with a fake clock.
- ✅ `engine/input.js`: keyboard (W/S/arrows throttle/brake/reverse, A/D steer, Space handbrake, C couple, Q/E indicators, H horn, M map, V camera toggle, Z/X zoom) and a normalised control state `{throttle, brake, steer, handbrake}` with steering smoothing. `ui/touch-controls.js`: on-screen steering slider/wheel, throttle and brake pedals, reverse toggle, buttons, shown when `pointer: coarse`.
  - Note: Gamepad (Phase 9 optional item) is already read here: left stick steers, RT/LT pedals, A handbrake. Keyboard pedals use arcade auto-reverse (hold S at a standstill to select reverse). Extra keys: F/Enter interact, J jobs, G gearbox mode, Shift/Ctrl gear up/down, Esc.
- ✅ `engine/camera.js` + `render/projection.js`: oblique faux-3D projection (world to screen with a tilt factor and height offset for extruded shapes), chase mode (rotates with heading, smoothed) and north-up mode, zoom, and automatic zoom-out while reversing.
- ✅ `config.js` with `WORLD_SCALE`, `TIME_SCALE`, quality presets (low/medium/high: traffic cap, draw distance, sprite cache size) and the lat/long-to-world projection helper.
- ✅ A flat test area with a grid floor and a placeholder box vehicle that moves with the controls, proving the loop, input, camera and projection end to end.
  - Note: Phase 1 placeholder kinematics live in game/session.js step(); Phase 2 replaces them with sim/vehicle.js. Stubs created for render/renderer.js, ui/hud.js, ui/menus.js, audio/sound.js (filled in by later phases).

### Verification Plan
- `dotnet build Games.slnx` gives 0 errors; `dotnet test Games.slnx` passes, including the new registry `features` tests.
- `npm test` passes `tests/js/delivery-driver.engine.test.mjs`: the loop runs exactly N steps for a simulated elapsed time, clamps the spiral of death, and the projection round-trips (world to screen to world within 1e-6) in both camera modes.
- `npm run test:e2e`: new `delivery-driver.spec.mjs` opens `/play/delivery-driver`, sees a canvas, holds W for 1 s, and `window.__dd.state.player.x` changes. Existing specs still pass. The Options page shows no Level row for Delivery Driver.

### Phase Summary
- **Shell:** `GameInfo` gained optional `Features` (`GameFeatures(bool Hardcore = true, bool Levels = true)`) with `HasHardcore`/`HasLevels` helpers. `ParentCorner.razor` injects `GameRegistry` and hides Hardcore when off; `Options.razor` filters the Levels list by `HasLevels`. 3 new xUnit tests (defaults, partial object, both off). `delivery-driver` is registered with both features off.
- **Engine:** `engine/loop.js` (`advance()` pure scheduler + `createLoop` with injectable now/raf/caf), `engine/input.js` (`pedals()` arcade auto-reverse, `smoothSteer()`, actions via `onAction`, `setOverride` for the debug hook, gamepad read already included), `engine/camera.js` (chase/north, `ZOOMS`, reversing fit-zoom with a rig `length`), `render/projection.js` (`toScreen`/`toWorld`/`depth`/`viewRadius`, TILT 0.78, HEIGHT 0.62), `config.js` (WORLD_SCALE 1/13, TIME_SCALE 15, `latLonToWorld`, QUALITY presets, BAY/COUPLE tolerances), `ui/touch-controls.js` (slider/wheel, pedals, R toggle, action buttons, shown on `pointer: coarse`).
- **Glue:** new `game/session.js` (not in the original layout) owns game state and `debugHook()`; `index.js` only mounts/wires. Phase 1 session uses placeholder kinematics and the renderer draws a 10 m grid + extruded box; `ui/hud.js`, `ui/menus.js`, `audio/sound.js` are minimal stubs to be filled by later phases.
- **Verification:** `dotnet build` 0 errors/0 warnings; `dotnet test` 30/30; `npm test` 69/69 (11 new in `delivery-driver.engine.test.mjs`); `npm run test:e2e` 83/84 on the full run — the one failure (`animal-feeding` "past level 100 they bounce around") is timing-flaky under load and passed 3/3 when rerun alone. The new `delivery-driver.spec.mjs` (drives with W; no Level row; no Hardcore button) passes.
- **Code docs:** refreshed `_docs/code-docs/Games/application/GameInfo.md`, added `GameFeatures.md`, updated the index.

## Phase 2: Vehicle physics (rigid vehicles)
Status: Complete

- ✅ `sim/vehicle.js`: kinematic bicycle model (wheelbase, max steer angle, steer rate falling with speed), longitudinal force from an engine torque curve through `sim/gearbox.js` (auto by default, manual optional with up/down keys), rolling resistance, aero drag, brake force, and acceleration/braking that depend on mass (vehicle + cargo). Reverse gear. A handbrake.
  - Note: Pose is the rear-axle centre (needed for trailer kinematics later); bodyCentre() gives the drawing/collision centre. Damage/fuel enter via v.power and env.drive; rain via env.grip.
- ✅ `sim/gearbox.js`: gear ratios, RPM from wheel speed, auto shift points, clutch-less shift delay, and RPM output for audio.
  - Note: Top speed is set by the governor (torque cut at engine.maxRpm in top gear): gearedTopSpeed(spec) is the cap. Manual mode = gb.manual with shift(gb, spec, +/-1) from the gear keys.
- ✅ `sim/collision.js`: oriented-bounding-box (OBB) collision (SAT) between vehicles and static obstacles (buildings, walls). Resolves penetration and returns impact speed for damage. A broad phase uses a spatial hash grid.
  - Note: vehicle.js adds vehicleObb(v) and collideVehicle(v, other) on top of collision.js (sat/resolve/createSpatialHash).
- ✅ Spec for the 1919 van in `game/catalogue.js` (first entry): "Tamar T-Ton" light van, 1 t payload, ~25 mph top speed, 2-speed epicyclic feel (auto), with dimensions and mass.
  - Note: Sim check: geared top speed 25.04 mph; 0-20 mph 6.1 s empty / 13.0 s with 1 t; stop from 25 mph 13.9 m empty / 25.4 m loaded.
- ✅ `render/draw-vehicles.js`: faux-3D vehicle drawing from the catalogue (chassis/cab/body boxes extruded by height, wheels, headlights, livery colour slots) for the van.
  - Note: Shared prism/ground/rect/shade helpers live in a new render/shapes.js (back-face culling + sun shading). The renderer interpolates poses with lerpPose().

### Verification Plan
- `npm test` passes `delivery-driver.physics.test.mjs` (deterministic at 60 Hz):
  - The van reaches 25 ±2 mph from 0 on flat ground and doesn't exceed it.
  - A heavier load gives a longer 0-20 mph time and a longer stopping distance.
  - A full-lock turning circle radius matches wheelbase / tan(max steer) within 5%.
  - Reversing with straight wheels moves backwards along the heading.
  - SAT separates two overlapping boxes, and the reported impact speed equals the closing speed.

### Phase Summary
- **Done:** `sim/vehicle.js` (bicycle model on the rear-axle pose; `stepVehicle(v, controls, dt, env)`, `steerLimit`, `turningRadius`, `bodyCentre`, `vehicleObb`, `collideVehicle`, `totalMass` incl. trailer), `sim/gearbox.js` (torque parabola + soft governor over the last 5% RPM, auto shifting with throttle-dependent up-shift points, shift delay with no drive, manual mode via `shift()`, `gearedTopSpeed`), `sim/collision.js` (`obb`, `sat`, `resolve` returning the closing speed, `createSpatialHash`), `game/catalogue.js` with the Tamar T-Ton (Phase 6 extends `VEHICLES`), `render/shapes.js` (prism with back-face culling + sun shading, `ground`, `rect`, cached `shade`) and `render/draw-vehicles.js` (`drawVehicle(ctx, proj, spec, rearAxlePose, {livery, light, lamps, brake})`).
- **Wiring:** `game/session.js` now drives a real `createVehicle(tamar-t-ton)`; G toggles manual gears, Shift/Ctrl shift. Camera zoom levels raised (`ZOOMS` 3..26 px/m, default 14) after a visual check showed the van at ~25 px.
- **Numbers:** top speed 24.6 mph (governor), 0-20 mph 6.1 s empty / 13.0 s with 1 t, 25-0 mph stop 13.4 m / 24.1 m.
- **Gotcha for future agents:** the dev server bakes script integrity hashes in at startup, so after editing ANY `wwwroot` JS (not only adding files) restart `dotnet run` or imports fail with "Failed to find a valid digest in the 'integrity' attribute".
- **Verification:** `npm test` 78/78 incl. 9 in `delivery-driver.physics.test.mjs` (top speed, load vs 0-20 and stopping, turning circle within 5%, straight reverse, reverse cap, gearbox, SAT + impact speed, wall impact, spatial hash). Visual check in Edge: van draws, drives, no console errors.
- **Code docs:** no C#/.NET types touched in this phase.

## Phase 3: World data, generator and road network (Exeter area first)
Status: Complete

- ✅ Write `world/seed/sw-england.json`, a region file with an origin (lat/long), a list of towns (name, lat/long, size class, industries: farms, quarries, china clay pits around St Austell, fishing ports, dairies, timber, fuel depot, markets, shops), main roads as polylines of lat/long with class (A-road, B-road, motorway, lane) plus `opened`/`upgraded`/`closed` years, a coast outline polygon, moor polygons (Dartmoor, Exmoor fringe, Bodmin Moor), rivers (Exe, Tamar, Fal, Taw, Dart), and ferry links with years. Only the Exeter area's detail is needed in this phase; all towns and main roads are listed so Phase 5 only extends.
  - Note: All 58 towns, 23 industry sites, ~70 road sections (with opened/closed/upgrades), 3 ferries, coast polygon, 3 moors and 9 rivers are already in, so Phase 5 mostly needs history wiring + rendering. River widths are given directly in WORLD metres (3rd value of each point). Newlyn is a site of Penzance (too close to be its own town); Torquay & Paignton and Redruth & Camborne are single towns.
- ✅ `world/region.js`: load the region JSON and project it to world space via `config.js`. Supports several regions (keyed by id) for a future UK expansion.
  - Note: Added engine/rng.js (seededRng, hashSeed, valueNoise). region.js also provides waterAt (cached 4 m grid; Infinity = sea, else river width), moorAt, crossesWater, inPolygon, segDistance, nearestTown. Town radii (world m): city 320, town 220, small 160, village 85.
- ✅ `world/generator.js` + `world/chunks.js`: deterministic per-chunk generation (seeded by region seed + chunk coordinates). Town street grids/organic streets sized by class, building plots with footprints/heights/types (terraces, shops, warehouse, church, farmhouse, barns), farms with field patchworks and hedgerows, villages along roads, lanes connecting farms, and trees/woods. Chunks are made on demand and evicted LRU.
  - Note: Town streets/buildings are generated per TOWN (deterministic per town id, cached), not per chunk, so streets stay connected and buildings never depend on load order; chunks (world/chunks.js, LRU cap 160) hold fields/hedges/trees/tors + the buildings centred in them + edge ids. Farms (113) and out-of-town sites are placed globally at world build (so A* can reach them before their chunks load). world/world.js is the facade (createWorld). Also added world/geom.js. World build ~120 ms in Node; Exeter 300+ buildings in ~20 ms.
- ✅ `world/roadgraph.js`: build a lane-level road graph (nodes at junctions, edges with lanes, left-hand driving, speed limits by class/era, junction types: give-way T, crossroads, roundabout with clockwise flow, signals from 1930s).
  - Note: Edges are centreline polylines; lanes are offsets via laneOffset()/lanePoint() (left-hand). Junction types are node data (giveway by class rank, signals in city centres from 1932, roundabouts at A-road meetings from 1960) resolved per year by junctionType(). cruiseSpeed(cls, year) gives era speeds; edgeClass() applies upgrades (dualling).
- ✅ `world/pathfind.js`: A* over the road graph by travel time, respecting the year (closed/unopened roads, ferries with a wait time), and returning a polyline for the route line.
  - Note: findRoute(graph, from, to, {year, vmax, maxSnap}) snaps both points to the nearest open edge and returns {pts, length, time (real s), steps, ferries}. Ferry wait is converted from game minutes to real seconds. Fixed while testing: road pieces lying wholly inside a village now join its streets (Saltash ferry/bridge), towns join to the nearest street node even across water if needed (Brixham), and in-village sites with no street room fall back to a yard just outside town.
- ✅ `render/draw-road.js`, `draw-terrain.js`, `draw-buildings.js`, `sprite-cache.js`: ground (fields, moor, water, coast), roads with markings by era, and extruded buildings with roofs, rendered with view culling. Building/field tiles are cached to offscreen canvases per chunk.
  - Note: Deviation: sprite-cache.js caches Path2D objects in WORLD coordinates (fields/hedges per chunk, road paths per edge, town/land/moor paths per region) drawn under an affine ground transform (groundTransform) instead of offscreen canvases: same caching benefit, sharp at every zoom, less memory. Buildings/trees/vehicles are depth-sorted in screen space; buildings between the camera and the player fade to 35%. Era road styles in draw-road.js roadStyle(year).
- ✅ Collision bodies for buildings/walls fed to `sim/collision.js`. The player van spawns at the Exeter depot and can drive the generated Exeter area.
  - Note: session.js loads the region async (loadRegion -> createWorld), spawns at depot-exeter's marker, streams chunks around the player, collides with world.colliders (buildings/trees/rocks) and treats wide water (>=30 m) off-road as a wall. Off-road driving adds 3.5x rolling resistance. __dd gains spawnAtDepot(), stats() {buildings, loadedBuildings, chunks, frameMs, samples}, resetPerf().

### Verification Plan
- `npm test` passes `delivery-driver.world.test.mjs`:
  - The same seed + chunk gives identical output, and different chunks differ.
  - No building footprint overlaps a road or another building (sampled over 200 chunks around Exeter).
  - The road graph is connected within a town.
  - A* finds a route from the Exeter depot to every generated drop point within 10 km.
  - The projection puts Exeter→Plymouth at the expected compressed distance ±10%.
- e2e: the game loads at the Exeter depot with buildings drawn, and `__dd` reports more than 50 buildings in loaded chunks. On a 1024x768 viewport the average frame time is under 20 ms over 5 s of scripted driving (sampled via `performance.now()` in `__dd`).

### Phase Summary
- **World pipeline:** `world/seed/sw-england.json` → `world/region.js` (`buildRegion`, water/moor queries) → `world/roadgraph.js` `buildRoadGraph` (town street lattices from `generator.generateTownStreets`, seed roads split at shared waypoints, Catmull-Rom smoothed, trimmed at 80% of town radius and joined to the nearest street node; farms along A/B roads; out-of-town sites with access roads; junction types) → `world/world.js` `createWorld` (depot + in-town site yards placed on streets with an `access` edge, farm/site layouts, `reservedNear`, lazy `buildingsOfTown`, `buildingsInRect`, `yardAt`, `yards`, `colliders` hash, `chunks`). Chunks (`world/chunks.js`, 160 m, LRU) hold fields/hedges/trees/tors + buildings + edge ids. Build ~120 ms in Node.
- **Key decisions:** streets and buildings are generated per town (not per chunk) so they're connected and order-independent; farms/sites are global so A* reaches them before their chunks load. Every yard has `yard.marker` = where the vehicle's REAR goes, heading = nose out of the yard. Ground rendering uses cached world-space `Path2D`s under an affine `groundTransform` (deviation from offscreen-canvas sprites, noted on the item).
- **New helpers:** `engine/rng.js` (seededRng/hashSeed/valueNoise), `world/geom.js` (polyline ops), `render/shapes.js` (from Phase 2). Lanes: `laneOffset`/`lanePoint` (drive on the left). Era: `cruiseSpeed(cls, year)`, `edgeClass` (upgrades), `edgeOpen`, `junctionType(node, year)`, `roadStyle(year)`.
- **Seed fixes made while testing:** St Ives coast point, Teign/Fowey river mouths, Fowey position, added A3122 Totnes–Dartmouth.
- **Verification:** `npm test` 85/85 incl. `delivery-driver.world.test.mjs` 7/7 (determinism across generation order; 200 chunks around Exeter, 300+ buildings, no road/building overlaps; every town's streets connected; A* from the Exeter depot to every yard + all Exeter doors + sampled doors within 10 km in 1919; Exeter→Plymouth 4.4 km = haversine × WORLD_SCALE within 10%). e2e `delivery-driver.spec.mjs` 3/3: starts in `depot-exeter`, >50 buildings loaded, 5 s scripted drive averages well under 20 ms CPU/frame (~1 ms measured), no console errors. Route timings: Exeter→Penzance 10.7 min at 50 mph in 1990; Plymouth→Saltash uses the Saltash Ferry in 1950 and the Tamar Bridge in 1965.
- **Code docs:** no C#/.NET types touched.

## Phase 4: 1919 Exeter MVP: depot, loading bay, contracts, traffic, HUD
Status: Complete

- ✅ `game/calendar.js`: game clock from 06:00 1 Jan 1919, advancing `TIME_SCALE` x real time only while driving (paused in menus and while the shell is paused). Day/time/date formatting. Year-change events.
- ✅ `game/depots.js`: Exeter depot with a yard, a loading bay with a bay marker (position + heading tolerance), and a parking area. A depot menu opens when stopped in the depot zone.
  - Note: The yard/bay geometry comes from world.depots (Phase 3). The depot menu opens with F/Enter (or the touch box button) when stopped in the yard, with a HUD prompt, rather than popping up by itself (an automatic pop-up would fire every time the player pauses in the yard).
- ✅ `game/contracts.js`: generate contracts from the world (customers = generated shops/houses/farms with names). Multi-drop types (N drops in a town) and collections (go to a farm, back up to its marker, collect, bring back). Each has cargo type, weight, pay (base + per mile + per tonne), a deadline in game time, and required vehicle tags. A contracts board with accept/abandon, and an active job state machine (`toLoad → loading → toDrop[i] → unloading → … → complete`).
  - Note: Offers are seeded by (region seed, depot, game day, refresh count). Pay = quote(distance, kg, stops) = 3 + 0.9/real mile + 4/tonne + 1/stop. Job flow uses stops [{action load|unload, kind bay|door}]; jobStage() gives toLoad/loading/toDrop/unloading/complete. settle() holds the late/bonus/damage rules. The contracts board UI lives in ui/menus.js (item 7).
- ✅ Loading/unloading: stop at the marker within tolerance (position ≤ 1.5 m, heading ≤ 15°, speed 0) and a timer scaled by cargo weight runs. Drops have their own small markers at the customer's door/yard.
  - Note: Door drops use doorCheck (rear or middle of the vehicle within 3.5 m of the kerb marker, stopped); bays use bayCheck (rear <= 1.5 m, heading <= 15 deg, stopped). Work time = workSeconds(kg) = 2.5 s + kg/200 and only counts while still parked. Career state moved to a new game/career.js (calendar, ledger, offers, job, client records); session.js wires it in (events via session.on/emit).
- ✅ `game/economy.js` (MVP part): money ledger (entries with date, description, amount), payment on completion with a deadline bonus/penalty and damage deduction.
  - Note: economy.js has the ledger (createLedger/post/summarise/formatMoney); the payout rules (late -10%/game hour down to 40%, +15% bonus when finished in the first half of the window undamaged, cargo damage deducted) live in contracts.settle() and are posted by career.completeJob().
- ✅ `traffic/traffic.js`: spawn era cars (1919: few cars, horse-and-cart-speed traffic, bicycles) on lanes near the player, capped by the quality preset. Lane following on the road graph, keeping distance, giving way at junctions, roundabouts, and despawning out of view. Collisions with the player use the OBB collision.
  - Note: Junction safety uses claims: the first vehicle cleared through a junction reserves it until its whole length is clear of the 6 m box; others hold at a hard 7.5 m stop line (box < stop line so a waiting vehicle never blocks it). Minor roads give way to higher-ranked roads; signals alternate E-W/N-S every 18 s. AI never uses farm lanes, yard access roads, ferries or the M5 before 1977. Era mix: horse and cart, bicycles, motor cars, buses, tractors..., density 35% in the 1920s. Bumping traffic stops it for 2.5 s and counts as an impact. Scripted crossroads: 0 overlaps / 0 lane errors over 10,000 steps.
- ✅ `ui/hud.js`: speedometer (mph), gear, clock/date, money, the current job step with distance, an indicator state, and a minimap (`render/minimap.js`) with the route line to the next target (from `pathfind.js`). `ui/menus.js` has the contracts board and depot menu.
  - Note: HUD: clock/date + company/money chips (top right, clear of the gear), job card (step, miles to go, due/late, cargo damage, hints), speedo + gear + load bar (bottom left), blinking indicators, toasts, 'rotate device' hint, minimap (render/minimap.js drawMap, redrawn 5x/s, turns with the chase camera; tap opens the map). ui/menus.js: menu framework (pauses the session), depot office (Contracts board with accept/abandon + Ledger; extra tabs via session.depotTabs/depotTabHtml/depotAct hooks for later phases), current job (J), basic pan/zoom map (M; Phase 5 extends it).
- ✅ `audio/sound.js`: an engine synth following RPM/load (era voice parameter), horn, indicators, loading clunks, and a pay "ka-ching". Respects `soundEnabled`. AudioContext unlocks on the first gesture.
  - Note: Engine: sawtooth at firing frequency (rpm/60*2, scaled by voice.base) + sub square + band-passed noise roughness through a load-dependent low-pass. Also includes horn (two-tone while held), indicator ticks, clunk, bump, ka-ching, plus airBrake/ferryHorn/coupling/beeper/ambience ready for Phases 5, 7 and 9. Suspended with the shell pause; nothing is created until the first gesture.

### Verification Plan
- `npm test` passes `delivery-driver.game.test.mjs`:
  - The calendar advances 15 game minutes per real minute and not while paused.
  - The contract state machine follows load → drops → complete. A late delivery pays less, an early undamaged one pays a bonus.
  - The bay check rejects a wrong heading or a moving vehicle.
  - Traffic agents never leave lanes over 10,000 seeded steps and give way so that no two agents overlap at a scripted crossroads.
- e2e: the debug hook accepts the first contract, teleports to the bay, completes loading and drops via `__dd.completeDrop()`, and the money increases by the contract pay.

### Phase Summary
- **Game loop now playable:** start at the Exeter depot (06:00, 1 Jan 1919, £400), F in the yard opens the depot office, take a multi-drop or farm collection, reverse onto the bay to load (timer), follow the yellow route (ground + minimap) to kerbside door rings or farm bays, get paid with bonus/late/damage rules, see it in the ledger.
- **New modules:** `game/calendar.js` (minutes since 1919-01-01; `advance`, `advanceHours`, formatters, `weekIndex` Monday-based), `game/depots.js` (`rearPoint`, `bayCheck`, `doorCheck`, `depotAt`, `parkingSpots`, `bayHint`), `game/contracts.js` (customers from buildings, `CARGO`, `generateOffers`, `quote`, job state machine `startJob/updateJob/jobStage/finishStop/cargoOnBoard`, `settle`), `game/economy.js` (ledger), `game/career.js` (career state: company, calendar, ledger, offers, job, client records; `refreshOffers/acceptOffer/abandonJob/completeJob`), `traffic/traffic.js` (era types, spawning, lane following, junction claims, signals, `agentDrawSpec`), `render/minimap.js` (`drawMap`, `createMinimap`), real `ui/hud.js`, `ui/menus.js` (screen registry; depot office tabs are extensible via `session.depotTabs/depotTabHtml/depotAct`), `audio/sound.js` (engine synth + effects).
- **Session (`game/session.js`):** `session.career`, `session.on/emit` events (startWork, stopDone, complete, accepted, impact, newDay, newWeek, newYear), `acceptOffer/abandonJob/offersAt/jobStage`, traffic step + player collisions, indicators with self-cancel, ground overlay. `__dd.completeDrop()` finishes the current stop; `__dd.advanceClock(hours)` jumps the calendar.
- **Gotchas:** `.dd-menu` sets `display:grid`, so `[hidden]` needed an explicit `display:none !important` rule. Junction safety relies on BOX (6 m) < STOP_LINE (7.5 m); don't change one without the other.
- **Verification:** `npm test` 94/94 incl. `delivery-driver.game.test.mjs` 9/9 (calendar rate and pause, deterministic offers, load→drops→complete, late/bonus/damage, bay check heading/moving/position, 10,000 traffic steps on lanes in 1919 and 1965, 0 overlaps at equal and major/minor crossroads with buses). e2e 4/4 incl. the contract flow (accept via the office UI, teleport to bay, loading starts, `completeDrop` to the end, money rises by the paid amount ≥ the quoted pay, "Paid" toast, no console errors).
- **Code docs:** no C#/.NET types touched.

## Phase 5: Full Devon and Cornwall map and road history
Status: Complete

- ✅ Fill in the detail for all seed towns (Exeter, Plymouth, Torquay/Paignton, Barnstaple, Okehampton, Bodmin, Truro, Falmouth, St Austell, Newquay, Penzance, St Ives, plus extra villages and market towns such as Tiverton, Newton Abbot, Tavistock, Launceston, Liskeard, Redruth/Camborne, Bideford), with industries placed at believable sites (china clay at St Austell, fishing at Newlyn/Brixham, dairies, quarries on Dartmoor edges).
  - Note: Towns and industry sites were already complete from Phase 3 (all listed towns; china clay pits and Par/Fowey docks, Newlyn/Brixham/Sutton Harbour fish, dairies at Torrington/Lifton/Crediton/Totnes, quarries at Meldon/Merivale/Moorcroft/Delabole, timber, fuel, livestock markets). Added here: every non-village town gets a reserved depot yard (24 depots; depot.home marks Exeter) so Phase 8 can sell them. Farms went 113 -> 106 as depot yards took some space.
- ✅ `world/history.js`: apply road events by year (Exeter bypass 1938; Torpoint and Saltash ferries until the Tamar Bridge opens 1961, Torpoint ferry continuing; M5 reaching Exeter 1977; A30/A38 dualling and bypasses through the 1970s-2000s per the seed data). Rebuild the affected graph edges and chunk caches when the year changes. Ferries: drive onto a ferry marker, wait/fade, cross for a fee.
  - Note: No graph rebuild is needed on a year change: edges keep opened/closed/upgrades and every query takes the year (edgeOpen/edgeClass), chunk caches are geometry only, and buildings/trees were already placed clear of future roads (+5 m for dualling). history.js provides roadEvents/eventsBetween/describeEvent (year-change news toasts) and ferrySlips/slipNear/crossingMinutes. Ferries: stop at the slipway, press F: fare posted to the ledger, clock advances by wait + crossing, player arrives at the far slip. Ferry approaches render as road; the crossing is dashed and counts as water (wall) when driven.
- ✅ Moors and coast rendering (open moor with no fields, tors, cliffs, beaches, harbours) and bridges over the main rivers.
  - Note: Coast: each coast segment is classed beach or cliff once (north coast mostly cliff) and stroked along the shore with a surf line (drawCoast). Moors: no fields, granite tors (Phase 3) + heather/gorse patches per chunk. Harbours: world.harbours at the 15 fish/dock towns (quay + two breakwaters as permanent colliders + moored boats). Bridges: parapets wherever a road crosses water (drawBridges). Town ground is now clipped to land so it no longer paints over the sea.
- ✅ `ui/menus.js`: full-screen map (pan/zoom, towns, depots, the active route, era-correct roads) with the route line always shown.
  - Note: The map screen (M, or tap the minimap) was built in Phase 4 on render/minimap.js drawMap: pan by drag, zoom by wheel/pinch, towns (villages hidden when zoomed out), depots, era-correct roads (closed/unopened hidden, dualled shown green), ferries dashed. Route line changed to magenta (with a dark outline) everywhere so it stands out from orange A-roads.
- ✅ Performance pass for the bigger map: a chunk budget per frame, background generation spread across frames, and a cap on cached sprite memory per quality preset.
  - Note: Chunk generation is budgeted per frame (renderer: QUALITY.drawChunks new chunks/frame; session: 1 per 0.2 s around the player). Town buildings (the one big job, 5-20 ms) are prefetched one town per tick when the player comes within radius + 700 m, before it's on screen. session.applyQuality(name) sets the chunk cache cap (spriteCache x 3; cached ground Path2Ds live on chunks and go with them) and the traffic cap. Also fixed while testing: ferries are no longer trimmed at towns (addFerryPiece) and the Torpoint/Dartmouth ferries got proper slipway waypoints (+ B3205 to Kingswear, a finer Dart estuary).

### Verification Plan
- `npm test` passes `delivery-driver.history.test.mjs`:
  - In 1950, the route Plymouth→Saltash uses a ferry edge; in 1965 it uses the Tamar Bridge.
  - The M5 edges are unusable before 1977 and usable after.
  - Exeter→Penzance by the fastest route in 1990 at 50 mph average takes 10 ±2 real minutes (computed from route length / WORLD_SCALE / speed / TIME_SCALE).
  - Every seed town is reachable from Exeter in 1919 and 2020.
- e2e: `__dd.teleport` to Penzance, Barnstaple and Plymouth each loads chunks and renders without console errors.

### Phase Summary
- **Done:** every non-village town has a depot plot (`world.depots`, 24; `home: true` = Exeter); `world/history.js` (road events + year-change news, ferry slips/crossings); ferries playable (stop at the slipway, F, fare + clock jump + arrive at the far slip); coast beaches/cliffs/surf, moor heather/gorse, 15 harbours with breakwaters (colliders) and boats, bridge parapets; town ground clipped to land; route line magenta everywhere; town-building prefetch and `session.applyQuality`.
- **Design note:** history needs no rebuilds: edges carry opened/closed/upgrades and all queries take the year; caches are geometry-only; generation keeps clear of future roads.
- **Seed/graph fixes:** ferries now use `addFerryPiece` (no town trimming; crossing between slipway waypoints; towns joined by short A-class links). Torpoint and Dartmouth ferries got slipway waypoints, the Dart estuary is finer, and a B3205 Brixham–Kingswear road was added. `nearestEdge` skips ferries unless a filter is passed (session's surface check passes `() => true` and treats the water part of a ferry as water).
- **Verification:** `npm test` 100/100 incl. `delivery-driver.history.test.mjs` 6/6 (Saltash ferry in 1950 / Tamar Bridge in 1965; M5 closed in 1976, open in 1977, used Exeter→Cullompton in 1980 but not 1970; Exeter→Penzance 1990 at 50 mph = 8.4 real min by length/WORLD_SCALE/speed/TIME_SCALE (target 10±2); all 58 towns reachable in 1919 and 2020; 1961 news includes the Tamar Bridge opening and the Saltash ferry closing; slips at both ends of all 3 ferries, Saltash closed by 1965, Torpoint still running in 2020). e2e 5/5 incl. teleporting to Penzance, Barnstaple and Plymouth (chunks generate, buildings load, no console errors).
- **Code docs:** no C#/.NET types touched.

## Phase 6: Economy, catalogue, eras and the dealer
Status: Complete

- ✅ `game/catalogue.js`, about 14 fictional, era-styled vehicles with year-available, price, payload, axles, top speed, fuel use, engine voice, tags (van, rigid, tipper, tanker, flatbed, tractor-unit, reefer, livestock), and drawing parameters:
  - 1919 Tamar T-Ton van
  - 1924 Exe 2-ton rigid
  - 1931 Dart 3-ton box lorry
  - 1934 Moorland tipper
  - 1937 three-wheel "mechanical horse" tractor unit
  - 1948 milk tanker rigid
  - 1953 Moorland 8-ton six-wheeler
  - 1956 Kestrel artic tractor
  - 1964 eight-wheel china clay tipper
  - 1972 tilt-cab 32 t artic tractor
  - 1984 38 t artic tractor
  - 1995 7.5 t box (multi-drop)
  - 2003 44 t 6x2 artic tractor
  - 2012 Luton van
  - 2022 electric van
  - Note: 15 vehicles (3 vans, 7 rigids, 5 tractor units). finalDrive is derived from topSpeedMph so each vehicle's governor gives its top speed; all reach >=96% of it fully loaded in the sim (tractors tested with trailerMax as dead weight). Tractor units carry trailerMax and fifthWheel (m forward of the rear axle); 1937 Mechanical Horse is threeWheeler. Electric van uses fuelTank/fuelUse as kWh. vehiclesOnSale(year) keeps a model on sale for 30 years.
- ✅ Catalogue trailer types with year-available, price, capacity and tags: flatbed, box, curtainsider (1970+), tanker (fuel/milk), reefer (1960+), livestock, low-loader, tipper.
  - Note: 10 trailer types in TRAILERS (light flatbed/box 1937; flatbed, box, tanker, livestock, low-loader 1956; tipper, reefer 1960; curtainsider 1970) with kingpin/axle geometry for Phase 7 and tags for special cargo.
- ✅ `game/economy.js`:
  - Fuel tank and consumption by load/speed, plus fuel stations in towns (era-styled pumps). Running out stops the truck and calls a costly tow.
  - Wear per mile and damage from collision impacts, which reduce top speed and pay. Repairs at a depot or garage.
  - Loans with weekly interest and repayments.
  - Weekly costs on Monday 00:00 game time: wages, loan interest, depot upkeep.
  - Bankruptcy below £0 at the weekly tick: first a forced bailout loan, then a forced sale of the cheapest trucks. Game over only with no trucks and no credit, then the "retired" save option.
  - Flat prices with no inflation.
  - Note: Fuel price £0.08/L (£0.05/kWh electric), burn = fuelUse/100 per real km x (1 + 0.7 x load) x (0.45 + 0.55 x throttle). Wear 0.02%/real mile; damage from impacts (impact-1.5)^1.5 x 2 %; power = 1 - damage/250 - wear/500. Repairs at depots and the 39 new town 'Motor Garages' (world.garages, era pumps: globe pumps < 1950, canopy >= 1960). Out of fuel: no drive; F calls a tow to the nearest owned depot (£15 + £1.5/mile, 1/4 tank, clock advances). Loans: limit 300 + half the fleet value + 500 per reputation tier; weekly interest 0.35% (bailout 0.8%), repayment 2% of principal. Weekly tick (Monday 00:00): wages, interest+repayments, depot upkeep (£1 home, £4 others), then bankruptcy: bailout -> forced sale of the cheapest vehicle -> game over only with no vehicles and no credit (career.retired). Career now has fleet records (fuel/wear/damage/mileage live on the record; session.player.rec), loans, depots, drivers. Bank/loan UI comes with the dealer item.
- ✅ `game/reputation.js`: per-client and company reputation from on-time/undamaged deliveries. Tiers (Local Carrier → Regional Haulier → … → National Haulage) unlock contract classes and depot purchases.
  - Note: Tiers: Local Carrier 0, District Haulier 40, Regional Haulier 120, County Haulage Co. 300, National Haulage 700 points; each tier sets haulage/special/depot unlocks and a contract range. Job points: on time +3 / late -3, undamaged +1 / damaged -2, +1 per 2 stops; abandon -5. Client rep stored on career.clients[id].rep. Tier-up and bankruptcy steps show as toasts.
- ✅ Contracts expanded: point-to-point haulage between towns/industries and special cargo needing tags (livestock, milk, china clay, fish, timber, fuel, refrigerated). Availability depends on year, tier and the player's fleet.
  - Note: Kinds: multidrop, collection (farms only), haul (point-to-point between town Goods Yards = depot plots, docks, fish, dairy, timber and livestock sites; District Haulier+), special (SPECIAL table: china clay, granite, bulk milk 1948+, chilled fish 1960+, frozen food 1960+, timber, petrol to garages 1956+, livestock, heavy machinery 1956+; needs the tag; District Haulier+). Offers only include specials the fleet can carry (career.fleetCapabilities: rigids as-is, tractors x owned trailers) and are sized to fit. Accepting checks the driven vehicle/trailer (career.cannotTake: tags, general-goods capability, weight; tractors need a trailer). Range grows with the tier.
- ✅ Dealer/garage UI: new vehicles (by year), a seeded used market with mileage/wear/price, trade-in value (depreciation by age and wear), buy/sell, repair, refuel, and company name + livery (two colours) at new game, editable later.
  - Note: Depot office tabs (ui/office.js): Garage (fuel/repair for the vehicle being driven; fleet list with Drive (swap to a vehicle parked here) and Sell; trailers), Dealer (new by year via vehiclesOnSale, this week's seeded used market, trailers, part-exchange tick box), Bank (borrow within the limit, pay off), Company (name, two livery colours, reputation tier and client standings). game/dealer.js holds the pure buy/sell logic. New vehicles park in the depot yard (parkingSpots) and are drawn and solid; part-exchange swaps you straight into the new one at the bay. The new-game company name/livery prompt itself is part of the Phase 10 save menu.
- ✅ Era visuals: road surface/markings, street lamps, signage, era traffic car styles and building variants switch by decade (1910s-20s, 30s-40s, 50s-60s, 70s-80s, 90s+). Traffic signals appear from the 1930s.
  - Note: render/era.js: eraOf(year); street lamps along town streets (gas lamps to the 1940s, concrete swan-necks 1950s-80s, steel columns after; glow when lit), signposts at country junctions (white finger posts before 1965, green Worboys signs after), traffic signal heads at 'signals' junctions from 1932 showing the live phase (traffic.signalPhase shared with the AI), shop/pub fascias (dark painted early, bright later), window tint by era. Roads: macadam with no lines before 1926, tarmac + white lines after, edge lines from 1970 (draw-road roadStyle). Era traffic mix from Phase 4; out-of-era traffic is cleared at New Year. Lamps/signposts are generated per chunk (deterministic).

### Verification Plan
- `npm test` passes `delivery-driver.economy.test.mjs`:
  - The catalogue has 12-15 vehicles, each with a unique id and year-available ascending within its class.
  - Trade-in value is below the purchase price and falls with wear/age.
  - The weekly tick charges wages and interest exactly once per game week.
  - The bankruptcy sequence goes loan → forced sale → game over.
  - Fuel consumption is higher when loaded.
  - Special-cargo contracts are only offered when the fleet has a vehicle with the required tag.
  - Reputation tiers unlock at their thresholds.
- e2e: `__dd.advanceClock` to 1931 makes the Dart 3-ton appear in the dealer list, and buying it reduces the money by its price.

### Phase Summary
- **Catalogue (`game/catalogue.js`):** 15 vehicles (vans 1919/2012/2022, rigids 1924/1931/1934/1948/1953/1964/1995, tractor units 1937/1956/1972/1984/2003) and 10 trailer types; `finalDrive` derived from `topSpeedMph`. Tractor units have `trailerMax` and `fifthWheel` (Phase 7 uses them); trailers have `kingpin`, `axle`, `rearOverhang`, `capacity`, `tags`, `body`.
- **Economy (`game/economy.js`):** ledger, fuel burn/price, wear/damage/performance, repair cost, trade-in and seeded used market, loans (`takeLoan/repayLoan/loanLimit/debt`), `weeklyTick` (wages, interest + repayment, depot upkeep) and `bankruptcyCheck` (bailout → forced sale → game over only with no vehicles and no credit; sets `career.retired`).
- **Career data model (`game/career.js`):** `fleet` records (model, built, mileage, wear, damage, fuel, depot, driver, trailer, pose), `activeVehicle`, `trailers`, `drivers`, `loans`, `depots`, `homeDepot`, `livery`, `reputation`, `bankruptcy`; `carryFor`, `fleetCapabilities`, `cannotTake`. The driven sim vehicle points at its record (`session.player.rec`).
- **World:** 39 town garages (`world.garages`; fuel/repairs menu, era pumps). Out of fuel → F calls a tow.
- **Reputation (`game/reputation.js`):** 5 tiers gating haulage/special work, contract range and depot purchases; client standings.
- **Contracts:** + `haul` (Goods Yards = depot plots, docks, etc.) and `special` (SPECIAL table with year and tag), sized to the fleet; accepting checks the driven vehicle.
- **UI:** depot office tabs Garage / Dealer / Bank / Company (`ui/office.js`, `game/dealer.js`); parked fleet vehicles are drawn and solid in yards.
- **Era visuals (`render/era.js`):** lamps, signposts, live traffic signals (`traffic.signalPhase`), shop fascias, window tint; out-of-era traffic cleared at New Year.
- **Verification:** `npm test` 110/110 incl. `delivery-driver.economy.test.mjs` 10/10 (15 vehicles unique + ascending per class; every vehicle hits its top speed fully loaded; trade-in < price and falls with age/wear/damage; fuel higher loaded; weekly wages/interest exactly once per week both by clock jump and by stepping; bailout → forced sale → game over; specials only with a tipper in the fleet; tier thresholds; part-exchange). e2e 6/6 incl. Dart 3-Ton absent in 1919, present in 1931, buying costs £950.
- **Code docs:** no C#/.NET types touched.

## Phase 7: Articulated trucks, trailers and coupling
Status: Complete

- ✅ `sim/trailer.js`: a kinematic trailer attached at the fifth wheel (hitch offset on the tractor, kingpin-to-axle length on the trailer). The trailer heading rate follows the standard tractor-trailer kinematics, so reversing is unstable as in real life. Jack-knife detection with an articulation-angle limit (~±85°), where the tractor stops and takes damage. The trailer's mass adds to the combined mass, and the trailer has its own OBB for collisions.
  - Note: Trailer pose = axle-group centre + heading; integrated with Heun's method using the tractor's heading at both ends of the step (plain Euler was 2% off the analytic steady state at 60 Hz; now <0.3%). stepTrailer returns 'jackknife' on the fold (damage 4% + 2%/m/s) and 'limit' while held at 85 deg: the session undoes the step so the rig can only move the way that unfolds it. Trailer OBB collides with static obstacles and loose trailers (blocks the rig). Load goes on the trailer when coupled. Reversing camera centres between tractor and trailer and fits the rig length.
- ✅ `sim/coupling.js`: coupling succeeds when the fifth wheel is within 0.4 m of the kingpin, the relative heading is within 10°, speed is under 0.5 m/s, and C is pressed. Uncoupling (C while stopped) lowers the landing legs and leaves the trailer in the world. Trailers persist in the save (position, heading, cargo, owner).
  - Note: sim/coupling.js: couplingCheck (fifth wheel within 0.4 m of the kingpin, headings within 10 deg, speed < 0.5 m/s), couple (snaps the last cm), uncouple (legs down, pose kept), nearestTrailer, couplingHint. Session: C toggles; company trailers are sim objects in session.trailerObjs built from career.trailers (pose on the record when loose, coupledTo vehicle id when coupled; new trailers stand at depot trailer spots, kingpin towards the gate). Loose trailers are solid, except the front overhang (kingpin + 3 m) for tractor units so they can reverse under. HUD prompts guide the line-up. Full save/load of trailers is Phase 10 (records are plain JSON already).
- ✅ Rendering: tractor units and the trailer types, an articulation pivot visual, landing legs, and an extended reversing camera (zooms to fit tractor + trailer, optional rear-view guide lines from the 1990s).
  - Note: draw-vehicles.js drawTrailer (bodies: flat, low-loader, box, curtain, reefer with fridge unit, tank, livestock slats, tipper; axle groups; landing legs when standing alone; a load on flatbeds), fifth-wheel plate on an uncoupled tractor, single front wheel for the three-wheeler. Trailers are separate depth-sorted drawables, so the articulation shows naturally. Reversing camera from item 1; guide lines (red/amber/green, 10 m) behind the rearmost body when reversing from 1990.
- ✅ Contracts using trailers: collect-trailer jobs (find a loaded trailer at a customer, couple, deliver, uncouple at the destination) and drop-and-swap at depots. A depot trailer pool with buy/sell.
  - Note: contracts.js trailerJob: 'trailer' (collect a client's loaded trailer, drop it on the destination bay) and 'swap' (depot to depot: full trailer there, their empty one back); offered at District Haulier+ when the fleet has a tractor unit; trailer model by year (light box / box-12 / curtainsider). New stop actions: 'couple' (done the moment that trailer is coupled) and 'drop' (bay check on the trailer's rear, then it is uncoupled and taken away). Client trailers (client colours) appear in the yard on accept and vanish on drop/abandon. cannotTake: needs a tractor unit with no trailer of its own. Depot trailer pool buy/sell is the Dealer tab (Phase 6).
- ✅ Reversing practice yard (off-map area reachable from the depot menu) with cones and bay markers, accessible from any year once the player owns an artic. A basic version for rigid vehicles is available from 1919 (used by the tutorial).
  - Note: world.practice: a 110 x 70 m concrete apron off the map to the east (x = bounds.maxX + 2500) with three painted bays along the back and two cone courses; it's a yard zone so no trees/fields intrude. Reached from the depot office ('Reversing practice yard' button, any year, any vehicle); no clock, traffic or jobs there. Tractor units get a practice trailer. F opens the practice menu (next bay / back to the depot). Cones are knocked over (counted), never block; bay success uses bayCheck (rear of the rig). Used by the Phase 10 tutorial.

### Verification Plan
- `npm test` passes `delivery-driver.trailer.test.mjs`:
  - Driving forward in a steady circle, the articulation angle converges to its analytic steady-state value within 2%.
  - Reversing straight with a small initial articulation, the angle grows (instability) unless corrected.
  - Exceeding the limit flags a jack-knife.
  - Coupling succeeds only inside the tolerances.
  - An uncoupled trailer keeps its pose, and save/load round-trips trailers.
- e2e: in the practice yard via `__dd`, scripted controls reverse under a trailer, couple, drive forward 50 m, and `__dd.state.player.trailer` is set.

### Phase Summary
- **Done:** `sim/trailer.js` (off-axle hitch kinematics with Heun integration, jack-knife at 85°, `trailerObb(t, cut)`, `underRun`, `steadyArticulation`), `sim/coupling.js` (`couplingCheck/couple/uncouple/nearestTrailer/couplingHint`), trailer drawing for all 8 body types + fifth-wheel plate + landing legs + 1990s guide lines, trailer contracts (`trailer`, `swap`) with client trailers, and the reversing practice yard (`world.practice`).
- **Session model:** `session.trailerObjs` (Map id → sim trailer; company trailers carry `rec`, client trailers `client: true`), `session.looseTrailers()`, `session.toggleCoupling()` (C), `stepRig` (jack-knife/collision → `undoStep` so the rig only moves the way that frees it), load on the trailer when coupled, `session.enterPractice(depot)/leavePractice()/nextPracticeBay()`. Career trailer records hold `pose` when loose and `coupledTo` when coupled; fleet records hold `trailer`.
- **Gotchas:** tractor units collide with loose trailers only behind the front overhang (`underRun`) so they can reverse under; cones are knocked (never block) by both tractor and trailer.
- **Verification:** `npm test` 116/116 incl. `delivery-driver.trailer.test.mjs` 6/6 (steady-state articulation within 2% for 4 rigs, reversing instability ×3 growth and forward self-straightening, jack-knife flag + clamp, kingpin stays on the fifth wheel, coupling tolerances incl. 'notTractor', uncoupled pose kept + trailer records JSON round-trip). e2e 7/7 incl. the practice-yard couple-and-pull test.
- **Code docs:** no C#/.NET types touched.

## Phase 8: Fleet, hired drivers and extra depots
Status: Complete

- ✅ `game/fleet.js`: owned vehicles roster (id, catalogue id, livery, mileage, wear, damage, fuel, location depot, assigned driver, attached trailer). The player picks which vehicle to drive from any depot that has it; others stay parked and can be seen in the depot yard.
  - Note: Fleet records (from Phase 6) carry model, built, mileage, wear, damage, fuel, depot, driver, trailer, pose; vehicles use the company livery (no per-vehicle livery). game/fleet.js adds vehiclesAt(depot), roster() for the Fleet screen. The player drives any vehicle parked at a depot (Garage tab, Phase 6); parked ones stand in the yard and hide while out on a driver's job.
- ✅ Hired drivers: a hire pool (seeded names, skill, wage), hire/fire, and assignment of a driver + vehicle + contract (or an "auto-take suitable contracts" toggle). Off-screen simulation: the job progresses by route time (`pathfind.js` length / era speed by vehicle), with a skill-based chance of delay/damage, and pays on completion minus fuel/wear. Shown as moving icons on the full map and minimap.
  - Note: Hire pool: 4 applicants a week (seeded by week), skill 1-5, wage £(2 + 1.5 x skill + up to 2)/week. Assign a driver a vehicle parked at their depot; give them one of the depot's offers or switch on auto-take. startAiJob plans depot -> stops -> depot with pathfind on route time at the vehicle's top speed + loading time; a seeded roll per contract/driver sets delay (up to +45% for skill 1) and damage chance (up to 35%). updateDrivers (run every ~10 game minutes, and per day while the clock jumps) pays the contract settlement once on completion, posts fuel separately, adds mileage/wear/damage and client reputation. Tractor units take a matching loose trailer from their depot; client-trailer jobs are player-only. Offers are now per-depot boards (career.boards) so depots keep their own lists and taken offers never come back the same day. Fleet markers show on the minimap and map.
- ✅ Extra depots: buy a depot in a town (price by town size, tier-gated), with weekly upkeep. Contracts are generated around every owned depot, and vehicles can be relocated between depots (driven by the player or sent with a driver).
  - Note: buyDepot needs the Regional Haulier tier; price by town size (city £4000, town £1500, small £700); upkeep £4/week (Phase 6 weekly tick). Each owned depot has its own contracts board (generated around it). Vehicles move between depots either by the player driving them there (opening an owned depot's office re-bases the vehicle) or with a driver (relocate(): an off-screen run on route time, no pay).
- ✅ Management UI: Fleet, Drivers and Depots screens in `ui/menus.js`, plus a weekly finance summary (income, wages, fuel, repairs, loans).
  - Note: Put in ui/office.js as depot-office tabs rather than separate menus: Fleet (all vehicles: where, who is driving/what job, value, Drive/Sell, plus service for the current vehicle), Drivers (drivers based here: assign vehicle, give a job from this depot's board, auto-take, send to another owned depot, fire; this week's hire pool), Depots (owned with vehicle/driver counts; others for sale, tier-gated) and Money (the last 7 days by category: income, wages, fuel, repairs, interest, loans, upkeep, purchases, tows/ferries/penalties, net; then the ledger).

### Verification Plan
- `npm test` passes `delivery-driver.fleet.test.mjs`:
  - An assigned AI job completes after its computed duration of game time and credits net pay once.
  - Fired drivers stop working and are not paid afterwards.
  - With auto-take on, an AI driver only takes contracts their vehicle's tags allow.
  - Contract generation includes towns near every owned depot.
  - Wages are deducted weekly.
- e2e: with `__dd` money set high, the player buys a second vehicle, hires a driver, assigns a contract, advances the clock 24 h, and the ledger shows the AI payment.

### Phase Summary
- **Done:** `game/fleet.js` (roster/vehiclesAt; seeded weekly hire pool, hire/fire/assign; `startAiJob` on route time with seeded skill-based delay and damage; `updateDrivers` pays once on completion, posts fuel, wear/damage, reputation, auto-take; `aiPosition` for map markers; `depotPrice`/`buyDepot` (Regional Haulier+); `relocate`/`finishRelocations`). Session wiring: `updateFleet` every ~10 game minutes and per day during clock jumps (`__dd.advanceClock` now steps a day at a time), `session.fleetMarkers/hirePool/hire/fire/assign/toggleAuto/giveJob/sendTo/buyDepot`, toasts for driver starts/finishes. Office tabs: Fleet, Drivers, Depots, Money (weekly summary + ledger).
- **Data model changes:** offers are per-depot boards `career.boards[depotId] = {day, refresh, taken, offers}` (`refreshOffers`, `takeOffer`); `career.offers` mirrors the board last looked at. Drivers live in `career.drivers` ({id, name, skill, wage, depot, vehicle, job, auto, earned}); `career.hiredIds` stops re-hiring the same applicant. Trailers taken by drivers get `withDriver`.
- **Rules:** client-trailer jobs (`trailer`/`swap`) are player-only; tractor units with drivers take a matching loose trailer from their depot; vehicles out on jobs disappear from their yard; opening an owned depot's office re-bases the vehicle you drove there.
- **Verification:** `npm test` 122/122 incl. `delivery-driver.fleet.test.mjs` 6/6 (job completes only after its duration and pays exactly once incl. early bonus; fired driver: no pay, no wages; auto-take with a tipper only takes tipper work within payload; offers around Exeter, Plymouth and Truro depots and depot buying is tier-gated; weekly wages; relocation moves vehicle + driver without pay). e2e 8/8 incl. buying a second van, hiring, assigning and giving a job through the UI, advancing 24 h, and seeing the driver's payment in the ledger.
- **Code docs:** no C#/.NET types touched.

## Phase 9: World polish: day/night, weather, sound
Status: Complete

- ✅ Day/night: sky tint and ambient darkening by game hour, headlight cones (era style), lit windows and street lamps by era. Traffic uses lights at night.
  - Note: game/environment.js: sunrise/sunset from the solar declination at 50.5N (GMT, solar noon 12:14), daylight() light 0.3..1 with an hour of twilight + dusk tint amount, isNight (30 min past sunset to 30 min before sunrise). Ground is darkened by a screen overlay; objects are shaded by the light level as drawn, so lit windows (2 in 3, seeded per building) and lamps stay bright. Era headlight cones (additive) for the player and motor traffic; traffic draws lamps at night. Practice yard is always daylight.
- ✅ Weather, seeded per day and region: clear, overcast, rain (screen streaks, wet road sheen, reduced grip = lower max brake/steer force, AI drives slower) and fog (Dartmoor/Bodmin more likely, reduced draw distance with an overlay). Shown in the HUD.
  - Note: weatherFor(seed, minutes, moor): seeded per day, wetter in winter; fog chance 5-10% normally, 25-60% when the player is on a moor. gripFor: rain 1 - 0.35 x intensity (fed to stepVehicle env.grip: weaker brakes/steering) and AI traffic slows with grip. Rain: streaks + darker wet roads with a sheen; fog: radial overlay clear to visibilityFor (90-30 m). HUD chip shows weather (and a moon at night). __dd.setWeather({kind, intensity}) forces it.
- ✅ Audio extras: reversing beeper (vehicles from 1980s+), air-brake hiss (artics 1950s+), rain/wind ambience, ferry horn, coupling clunk.
  - Note: index.js drives them each frame: beeper while reversing vehicles with spec.beeper (1984+ tractors, 1995 7.5 t, Luton); air-brake sigh when an airBrakes vehicle (1948+) brakes to a stop; ambience noise (rain heavier, fog light, a breath of wind otherwise); ferry horn on crossing (Phase 5); coupling clunk on couple/uncouple; a crunch + toast on a jack-knife; a toast when the weather changes.
- ✅ Optional Gamepad API support (sticks/triggers mapped to the control state) if time allows; skip without blocking the phase.
  - Note: Already in engine/input.js since Phase 1: the first connected gamepad's left stick steers, RT/LT are throttle/brake (with the same auto-reverse logic as the keyboard), A is the handbrake.

### Verification Plan
- `npm test` passes `delivery-driver.world-fx.test.mjs`:
  - Weather is deterministic per seed/day.
  - The fog probability is higher on moor chunks.
  - Grip in rain gives a longer stopping distance than dry in the physics test harness.
  - Night is detected between sunset and sunrise by month.
- e2e: `__dd.advanceClock` to 23:00 gives a darkened render (sampled canvas pixel luminance below the daytime luminance), with no console errors.

### Phase Summary
- **Done:** `game/environment.js` (sunTimes/isNight/daylight from the solar declination; seeded daily `weatherFor` with moor fog; `gripFor`, `visibilityFor`, `WEATHER_LABEL`), `render/draw-weather.js` (night ground overlay, dusk tint, era headlight cones, rain streaks, fog), wet-road style in `drawRoads(..., wet)`, lit windows (2 in 3) and lamp glows, weather chip in the HUD, `session.light/dusk/night/weather/grip/visibility` refreshed once a second (`updateEnvironment`), audio extras wired in `index.js` (beeper, air brakes, ambience, coupling clunk, jack-knife, weather toast). Gamepad support was already in `engine/input.js` (Phase 1).
- **Render order now:** ground (world space) → night overlay → additive headlights → depth-sorted objects shaded by `light` → dusk/rain/fog overlays.
- **Debug hook:** `__dd.setWeather({kind, intensity})` forces the weather; `__dd.advanceClock` refreshes light/weather immediately.
- **Verification:** `npm test` 126/126 incl. `delivery-driver.world-fx.test.mjs` 4/4 (weather deterministic per seed/day and differs by seed; fog >3x likelier on moors; rain grip gives a >10% longer stop than dry with the Dart 3-Ton; Jan/Jun sunrise/sunset in range, 18:00 dark in January but light in June, midnight/noon right all year). e2e 9/9 incl. canvas luminance at 23:00 < 70% of noon with no console errors.
- **Code docs:** no C#/.NET types touched.

## Phase 10: Saves, tutorial, settings, performance and docs
Status: Complete

- ✅ `game/save.js`: three slots (`games.dd.slot1-3`), a slot index in `saveProgress`, versioned schema with migrations, and autosave after each completed delivery and every 3 real minutes. Save-slot menu at start: new game (company name, livery), continue, delete with confirm, export to a `.json` download, and import from a file. The "retired" save state from bankruptcy is kept read-only.
  - Note: game/save.js: SAVE_VERSION 2 with migrate() from v1 (single offer list, career.money, no boards/client trailers); serializeCareer drops regenerable offers and thins driver routes; makeSave stores the career, the player's pose (or the depot when saved in the practice yard), cargo and the current job's client trailers; createSaveStore(localStorage, shell progress) writes games.dd.slot1-3 and an index {last, slots:[{slot, company, year, retired}]} via saveProgress, refuses saves over 500 KB, exports/imports JSON. ui/start.js: slots menu at start (Continue, New game with name + livery + tutorial tick box, Export, Import, Delete with a second tap), game menu (Esc / the new ☰ button: save now, slots, settings, controls, skip tutorial). Autosave after every completed delivery, every 3 real minutes and on exit. Going bust saves the company as a retired, read-only record and reopens the slots. __dd.newGame() starts an unsaved game (e2e helper startGame).
- ✅ `game/tutorial.js`: guided first job in 1919 (controls, follow the route line, reverse into the bay, load, drop, get paid), skippable, with step prompts in the HUD. Offer the practice yard after it.
  - Note: game/tutorial.js: 8 steps (drive 15 m, open the office, accept, start loading on the bay, finish loading, start a drop, finish a drop, get paid), each advancing only on its own session event (attachTutorial maps them); shown as a blue box at the top of the job panel; skippable from the game menu; offered by the new-game form. The practice yard (Phase 7) is available from the depot office afterwards.
- ✅ In-game settings panel: quality (low/medium/high), camera default (chase/north-up), manual gearbox toggle, touch-controls layout (wheel vs slider), and units shown. Saved per device in `games.dd.settings`.
  - Note: Settings (game menu > Settings) saved in games.dd.settings: quality (low/medium/high: DPR cap, traffic, chunk cache), camera default (chase/north-up), gearbox (auto/manual), touch steering (slider/wheel), units (mph+miles / km/h+km for the speedo and route distance). Applied live. Also: inside the game the shell's 96 px button minimum is reset.
- ✅ Landscape preference with a portrait "rotate device" hint. Check the phone layout on 390x844 and 844x390 viewports (shell gear doesn't overlap the HUD/touch controls).
  - Note: Portrait shows the 'turn your device sideways' hint but plays. Checked 390x844 and 844x390 with touch emulation (screenshots): short landscape puts the touch buttons in a 3x2 grid between the steering slider and the pedals (they ran off the top before); narrow portrait shrinks the chips, hides the weather chip, moves the job card under them and the minimap to the left. Nothing overlaps the shell gear (8-72 px) or each other; the e2e in item 'Verification' checks the bounding boxes.
- ✅ Performance pass on the low preset: profile and fix hotspots (sprite caching, traffic cap, chunk generation spread across frames, avoiding per-frame allocation in render loops).
  - Note: Measured (Edge, scripted driving): desktop 1024x768 ~0.7 ms CPU/frame on low, ~1.0 on high; low preset at 844x390 @2x with 6x CPU throttling (mid-range phone) ~4.2-4.7 ms/frame average. Spikes: one ~70-77 ms gap in 8 s with no chunk or town generation in that frame (GC under throttling, ~13 ms unthrottled) - left as is. Fixes: per-frame object allocation removed from the occlusion test, windscreen/stripe quads and shop fascias (shared scratch points). Already in place from earlier phases: Path2D ground caches per chunk/edge, chunk generation budget per frame, town-building prefetch one town per tick ahead of the player, traffic cap and DPR cap per preset.
- ✅ README: add a "Delivery Driver" section (controls, how contracts/eras/fleet work, saves, debug hook). Update the Layout table.
  - Note: README: intro lists both games; layout table gains the delivery-driver folder; 'Adding a game' documents the registry features flag; parent corner notes Hardcore can be switched off per game; new 'Delivery Driver' section (controls table incl. touch, how it plays, saves/settings, code layout, tests, debug hook).

### Verification Plan
- `npm test` passes `delivery-driver.save.test.mjs`:
  - A save → load round-trip equals the original state (deep equal).
  - A v1 save migrates to the current version.
  - A slot stays under 500 KB after a scripted 50-contract career with 10 vehicles and 20 dropped trailers.
  - The tutorial state machine advances only on its required events.
- `npm run test:e2e` passes all specs, including `delivery-driver.spec.mjs` extended with:
  - Start a new game in slot 1, then reload the page and see "Continue" with the same company name.
  - At a 390x844 viewport, the touch controls are visible and don't overlap the shell gear (bounding boxes).
- `dotnet test Games.slnx` and `npm test` pass (the CI gate).

### Phase Summary
- **Done:** `game/save.js` (3 slots, versioned + migrations, export/import, 500 KB cap, retired read-only saves), `ui/start.js` (slot menu, new-game form, game menu, settings, controls), `game/tutorial.js` (8 event-driven steps, skippable), in-game settings (`games.dd.settings`), portrait hint + phone layouts, low-preset performance pass, README section.
- **Verification:** `npm test` 132/132 (incl. `delivery-driver.save.test.mjs`: round-trip, v1 migration, <500 KB busy career, tutorial only advances on its own events). `dotnet test Games.slnx` 30/30. `npm run test:e2e` 93/93 after adding two specs to `delivery-driver.spec.mjs`: new game in slot 1 shows Continue (same company name) after a reload, and at 390x844 (touch emulation) the touch controls are visible, inside the viewport and clear of the shell gear.
- **Note:** the e2e "Continue" test drives the real slot UI (`[data-act="new"]`, `[data-field="company"]`, `[data-act="start"]`) rather than `__dd.newGame()`, which is unsaved.
- **Code docs:** no C#/.NET types touched in this phase (Phase 1 docs already refreshed).

## Final Recap
Delivery Driver is a new game in the Games shell (`Games.Client/wwwroot/games/delivery-driver/`): a Canvas 2D faux-3D haulage career set in Devon and Cornwall from 1919. It has a generated, deterministic world (58 towns, road graph with era history, ferries, moors, coast, farms, garages, 24 depots), a bicycle-model vehicle with gearbox and collisions, 15 vehicles and 10 trailer types with real articulated reversing and coupling, living era traffic, contracts (multi-drop, collection, haulage, special cargo, trailer jobs), a full economy (fuel, wear, loans, weekly costs, bankruptcy), reputation tiers, a dealer and used market, hired AI drivers and extra depots, day/night, weather, synthesized sound, 3 save slots with export/import, a tutorial, settings and phone layouts. The shell gained a per-game `features` flag (hide Hardcore/Levels). Tests: 132 Node, 30 xUnit, 93 Playwright, all passing.

## Deployment Plan
1. Review and commit the working tree (shell changes, `delivery-driver/` folder, tests, docs, plans). `.playwright-mcp/` should not be committed.
2. Run the CI gate locally: `dotnet test Games.slnx` and `npm test` (optionally `npm run test:e2e`).
3. Push/merge to `main`; `.github/workflows/pages.yml` runs both test suites and publishes to GitHub Pages. The service worker picks up the new `wwwroot` files automatically, and installed PWAs show the update banner.
4. After deploy, open `/play/delivery-driver` on the live site, start a new game on desktop and a phone, and confirm the save slot persists across a reload.
