# Delivery Driver: realistic roads from real maps (OpenStreetMap)

Replace Delivery Driver's hand-written road waypoints and procedural jittered town street grids with a real road network baked offline from OpenStreetMap (plus real elevation and coastline), rebuilt into a clean graph with proper junctions, era-filtered for 1919-2025, with rule-based street furniture and matching road rendering. Gameplay data (towns, depots, sites, industries, ferries) is kept and attached to the real roads.

## Decisions & Answers

Brief (user, 2026-11-03): "i think we may need to rethink the road system, is a mess. Road connections all over the place, street furniture like signs and lampost all over the road. not real logic or realism to where the roads go. can we /planout a solution to create roads realistically based on real maps"

- **Q:** Where should the real map data come from, and when is it fetched? — **A:** Bake OpenStreetMap offline (Recommended). A Node script downloads OSM data, cleans it, and writes compact tile files committed to the repo; the game loads them at runtime with no network dependency; ODbL attribution added.
- **Q:** How much of the real road network should the game contain? — **A:** Main network plus real streets in towns (Recommended). Motorway/trunk/primary/secondary/tertiary/unclassified everywhere, and real residential/service streets inside the 58 towns.
- **Q:** OSM only shows today's roads, but the game runs 1919-2025. How should eras work? — **A:** Modern network filtered by era rules (Recommended). Use road class, OSM `start_date` where present, distance from the historic town core, plus a curated table (M5, A30/A38 dualling, bypasses...) migrated from the current seed's opened/closed/upgrades data.
- **Q:** What should happen to buildings and street furniture? — **A:** Fix furniture placement; keep procedural buildings but align them to real streets (Recommended). Lamps, signs, signals placed by rules; buildings plotted along the real street frontages.
- **Q:** How should the bake script get OSM data? — **A:** Overpass API in tiles, raw JSON cached locally (Recommended). Plain Node fetch (no new dependencies), tiles over the region bounds, raw responses cached in a gitignored folder so re-bakes are offline and repeatable.
- **Q:** How big may the baked road data be? — **A:** Up to ~10 MB compressed (Recommended). Simplified geometry and tiled lazy loading where useful.
- **Q:** Existing saves reference the current world. What about them? — **A:** Break old saves, start fresh. New save version rejects old saves cleanly with a message.
- **Q:** The terrain uses seeded relief, not real elevation. What should I do? — **A:** Bake real elevation (SRTM/terrain tiles) into a coarse heightmap (Recommended). Roads and hills agree; grades come from real terrain; existing grading logic still smooths road profiles.
- **Q:** Scope check (in: bake OSM roads + real elevation, keep gameplay data and attach it to real roads, clean graph with real junctions/roundabouts/bridges, real town streets, era filtering, rule-based furniture, buildings along real frontages, old saves rejected, tests + map validator; out: OSM building footprints, live Overpass at runtime, rural estates outside the 58 towns, old-save migration). Anything missing? — **A:** "farm lanes and rendering upgrades". So both are IN scope: farms and rural lanes attach to real unclassified/service roads rather than generated lanes, and the road rendering is upgraded (pavements, kerbs, road markings, junction meshes matching the real topology: kerb lines, stop lines, roundabout geometry).

Assumptions (not asked; defaults chosen while planning, change only with the user):
- **Real coastline and rivers are baked too.** Real roads laid over the seed's 67-point hand-drawn coast and 9 hand-drawn rivers would run through sea or across water without bridges, so the coast and the main rivers/estuaries also come from OSM (`natural=coastline`, `waterway=river`, tidal water). Moors (`moors` in the seed) stay as hand data.
- **Dual carriageways and motorways stay one centreline.** The sim models `dual`/`M` as one edge, 17 m / 24 m wide, two lanes each way (`ROAD_CLASS` in `world/roadgraph.js`). OSM draws them as two one-way ways, so the bake must collapse parallel one-way pairs into one centreline. Roundabout rings collapse into one node with `junction: 'roundabout'` (already supported by `junctionType`).
- **One-way streets are real now.** OSM `oneway` is baked onto edges and honoured by traffic and the router.
- **Ferries, named bridges and the hand-curated history events are kept as data** (ferry slips, Tamar Bridge 1961, etc.) and overlaid on the real graph; they attach to the nearest real nodes. `world/history.js` event refs move from seed road ids to curated tags.
- **Towns keep their ids, sizes, industries and depot flags** from the seed. A town's footprint (where real streets are baked) is the existing `radius` scaled by size, adjusted per town if needed.
- **The whole main network loads at start** (the router needs it across the region); town street detail may load lazily per tile if profiling shows start-up or memory is too heavy.
- **Network access:** the fetch phase needs internet access to the Overpass API and an elevation tile host. If the agent cannot reach them, stop and ask the user to supply an OSM extract (`.osm.json`/PBF converted) or the cached raw folder; do not fabricate data.
- **Branching:** work on a new branch `feature/delivery-driver-osm-roads` branched from the current branch `feature/delivery-driver-webgl`. The working tree has many uncommitted changes; do not commit them without asking the user.
- **Tests:** `npm test` (node --test over `tests/js/**/*.test.mjs`) must stay green; existing tests that assert the old seeded-road structure are updated to the new structure, not deleted. After every change that affects the running app, restart the dev server on port 5210 (project memory rule: the user tests on a phone).
- **Attribution:** "Map data © OpenStreetMap contributors (ODbL)" appears in the game's credits/about and in `README.md`; baked data files carry a licence header/manifest.

## For Future Agents
As work proceeds: mark the item you are actively working on `- 🔄` (at most one per phase) and flip it to `- ✅` when it completes; when a phase is done, set its status to `Complete` and write its **Phase Summary** (what was done, key decisions, anything needed to continue with zero context); run the phase's **Verification Plan** and record the result before moving on. When all phases are done, fill in **Final Recap** and **Deployment Plan**.

Orientation (current state, before this plan):
- Region data: `Games.Client/wwwroot/games/delivery-driver/world/seed/sw-england.json` (58 towns, 23 sites, 71 roads as town ids or `[lat, lon]` waypoints, 67-point coast, 3 moors, 9 rivers, 17 relief points, `maxGrade` per class). Loaded by `world/region.js` (`loadRegion`, `buildRegion`, projection to world metres, `waterAt`, `moorAt`, `crossesWater`, `nearestTown`).
- Graph: `world/roadgraph.js` (`buildRoadGraph`, `ROAD_CLASS`, `createGraph`, `createSegmentIndex`, `nearestEdge`, `lanePoint`, `laneOffset`, `classifyJunctions`, `junctionType`). Edges carry `cls, pts, len, opened, closed, upgrades, town, bridge, z`. Town streets from `world/generator.js` `generateTownStreets` (jittered rotated lattice), farms and site access roads added inside `buildRoadGraph`.
- World build: `world/world.js` (`createWorld`: yards, depots, farms, sites, `gradeRoads`), chunk generation in `world/generator.js` `generateChunk` (buildings, trees, hedges, **lamps and signs** at the end of the function), road profiles/terrain in `world/terrain.js` (`terrainHeight`, `gradeRoads`, `roadHeightAt`, `MAX_GRADE`).
- Rendering: `render/gl/road-mesh.js`, `render/gl/prop-mesh.js` (lamps, signs, signals), `render/draw-road.js` (Canvas fallback), minimap in `render/minimap.js` and `render/gl/minimap-gl.js`.
- Consumers of the graph: `traffic/traffic.js`, `world/pathfind.js`, `game/session.js`, `game/fleet.js`, `world/history.js`.
- Debug panel (Development builds, 🛠 button): year, weather, traffic, teleport to depots and towns. Use it for visual checks, and Playwright screenshots against `http://localhost:5210/play/delivery-driver`.
- Scratch preview harness for meshes lives outside the repo (see git history of the vehicle-models work); not required here.

Overpass etiquette for the fetch phase: set a descriptive `User-Agent`, run tile requests sequentially with a pause and exponential back-off on 429/504, keep tiles small enough not to time out, cache each raw response to disk first and never re-request a cached tile.

## Recommended Model

| Phase | Model | Effort | Why |
|---|---|---|---|
| 1 Branch and baseline | haiku | medium | Mechanical: branch, run tests, record numbers |
| 2 Map validator | sonnet | medium | New test tooling over existing graph/furniture code |
| 3 Fetch OSM, coast and elevation | sonnet | medium | Scripted downloads with caching and retries |
| 4 Bake the road graph | opus | medium | Subtle topology: dual carriageway collapse, roundabouts, snapping, simplification |
| 5 Era rules | sonnet | medium | Rule tables and per-year connectivity checks |
| 6 Runtime loader and region data | sonnet | medium | Port loaders onto the existing graph API |
| 7 Attach gameplay data | sonnet | medium | Towns, depots, sites, farms, ferries onto real roads |
| 8 Terrain from real elevation | sonnet | medium | Replace seeded height source behind existing functions |
| 9 Street furniture and building alignment | sonnet | medium | Rule-based placement plus validator assertions |
| 10 Road rendering upgrades | sonnet | medium | Mesh work on existing road-mesh code |
| 11 Traffic, router and junction logic | sonnet | medium | One-way, roundabouts, speed limits on existing systems |
| 12 Saves, tests, docs, attribution | sonnet | medium | Version bump, test updates, docs |
| 13 QA, performance and sign-off | sonnet | medium | Measure, screenshot, fix regressions |

## Phase 1: Branch and baseline
Status: Complete
Model: haiku
Effort: medium

- ✅ Create branch `feature/delivery-driver-osm-roads` from the current branch without committing the existing uncommitted work (carry the working tree over; ask the user first if anything blocks this)
  - Done: `git switch -c` from `feature/delivery-driver-webgl`; 84 uncommitted entries carried over, nothing committed.
- ✅ Run `npm test` and record the pass/fail count as the baseline in the Phase Summary
  - Baseline: 295 tests, 295 pass, 0 fail, 0 skipped (about 3.1 s).
- ✅ Record baseline graph stats for the current world (node count, edge count, edge count per class, connected components) in the Phase Summary, using a small throwaway node script that builds the world from `sw-england.json`
  - Script: `C:\Users\Mike\AppData\Local\Temp\claude\f--Documents-Files-Apps-Games\098446e7-a13a-4a16-9e09-3181d4e77d7f\scratchpad\baseline-graph-stats.mjs` (uses `createWorld(json)`, the same path the game uses).
  - Note: the seed has no `dual` or `M`-plus-dual pairs; there are only 2 `M` edges, so the dual collapse in Phase 4 starts from a different shape than the plan implies.

### Verification Plan
- `git branch --show-current` prints `feature/delivery-driver-osm-roads`
- `npm test` completes; its pass/fail counts are recorded

### Phase Summary
- Done: created branch `feature/delivery-driver-osm-roads` from `feature/delivery-driver-webgl` with `git switch -c`. The working tree (84 uncommitted entries) carried over; nothing was committed.
- Baseline `npm test`: 295 tests, 295 pass, 0 fail, 0 cancelled, 0 skipped (about 3.1 s).
- Baseline graph (seeded `sw-england.json`, built via `createWorld`, which uses `generateTownStreets`, farms and site access roads):
  - Nodes: 1523. Edges: 1869.
  - Edges per class: street 1301, A 268, lane 111, access 86, B 98, M 2, ferry 3. No `dual` edges.
  - Connected components: 1 (all 1523 nodes in one component; no isolated nodes).
  - Towns 58, farms 111, sites 23.
- Decisions: none. Stats script lives in the scratchpad, not the repo.
- Code docs: no C#/.NET changes in this phase, so no doc-code refresh needed.
- Verification: branch check prints `feature/delivery-driver-osm-roads`; `npm test` completed with the counts above. Passed.

## Phase 2: Map validator
Status: Complete
Model: sonnet
Effort: medium

- ✅ Add `scripts/validate-roads.mjs` that builds the world (all chunks in a configurable box, default around Exeter, Plymouth, Truro and Penzance) and prints a report: connected components, dead ends outside yards, nodes with unusual degree, edges shorter than 3 m, edges crossing each other without a node, sharp (<30 degrees) junction angles, T-junctions with no priority, road points in water without a bridge, grade violations
- ✅ Add furniture checks: count lamps, signs and signal props within the carriageway or kerb of any edge (using `edgeWidth` plus a margin), and props inside buildings
  - Implemented in the same file (`validateFurniture`, `collectFurniture`, `--furniture`); props are lamps/signs/signals pulled from generated chunks.
- ✅ Add `tests/js/delivery-driver.roads-validator.test.mjs` that runs the validator on a small fixture graph and asserts it detects a planted lamp-on-road and a crossing-without-node
- ✅ Run the validator on the current seeded world and record the counts as the "before" numbers in the Phase Summary

### Verification Plan
- `node scripts/validate-roads.mjs --area exeter` exits 0 and prints the report
- `npm test` passes including the new validator test

### Phase Summary
Done. `scripts/validate-roads.mjs` exports pure `validateGraph(world, {year, box})`, `validateFurniture(world, props, {year, margin, buildings})` and `collectFurniture(world, box)`, plus a CLI: `--area exeter|plymouth|truro|penzance|all|<town ids>`, `--year` (default 2024), `--radius` (default 1500 m), `--furniture`, `--strict` (non-zero exit on hard failures), `--json`. `--baked` and `--check-yards` are accepted but print a "not implemented yet" note (to be wired in phases 4/7). Hard checks: disconnected components, crossing-without-node (skips bridge/tunnel/ferry edges), road-in-water without bridge, furniture-on-road, furniture-in-building. Soft: dead-end (outside depot/site/farm nodes), odd-degree (>5), short-edge (<3 m), sharp-angle (<30 degrees), no-priority (equal-rank T), grade (>110% of `gradeLimit`). Furniture "on road" = within `edgeWidth/2 + 0.5 m` of a centreline. Props come from `chunk.lamps`, `chunk.signs` (and `chunk.signals` if phase 9 adds it). Tests: `tests/js/delivery-driver.roads-validator.test.mjs` (5 tests, fixture graphs).

"Before" numbers on the seeded world (year 2024, 1500 m box per town; hard failures = 148 over the whole region):

| Area | no-priority | dead-end | sharp-angle | crossing-no-node | road-in-water | furniture-on-road | props |
|---|---|---|---|---|---|---|---|
| exeter | 36 | 19 | 3 | 19 | 2 | 27 | 296 |
| plymouth | 21 | 10 | 3 | 1 | 1 | 11 | 271 |
| truro | 57 | 21 | 6 | 8 | 0 | 16 | 501 |
| penzance | 23 | 14 | 1 | 0 | 0 | 5 | 259 |
| all (whole region) | 240 | 120 | 22 | 31 | 11 | 106 | 2071 |

(Truro also has 1 odd-degree node. Phase 9 target: furniture-on-road = 0.) `npm test`: 300 pass, 0 fail (295 baseline + 5 new). No C#/.NET changes, so no doc-code refresh. Note: `world.constants.CHUNK_SIZE` is set by the CLI for `collectFurniture`; callers must set it too.

## Phase 3: Fetch OSM, coastline and elevation
Status: Complete
Model: sonnet
Effort: medium

- ✅ Add `scripts/bake-roads/fetch-osm.mjs`: split the region bounds from `sw-england.json` into tiles, query Overpass for `highway=motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|*_link|roundabouts` ways (with geometry and tags `ref, name, oneway, junction, bridge, tunnel, layer, lit, maxspeed, start_date, surface`), traffic-signal and mini-roundabout nodes, ferry routes, `natural=coastline`, `waterway=river` and tidal water; cache each raw response under a gitignored `.cache/osm/` folder; sequential requests with back-off
  - Implemented as 0.25 degree grid tiles (`main-i-j`, 130 requests incl. towns) for main roads/coast/rivers/signals/ferries plus one `town-<id>` request per town for residential/living_street/service; shared helpers in `scripts/bake-roads/common.mjs`. Public Overpass was returning 502 (at capacity) at first; the script retries across three mirrors.
- ✅ Add `scripts/bake-roads/fetch-elevation.mjs`: download terrain tiles (for example AWS open terrain tiles in Terrarium format) covering the bounds at a zoom giving roughly 40-80 m cells, cache raw PNGs under `.cache/elevation/`, decode to a single float grid
  - Zoom 11 (~49 m cells): 238 tiles, stitched to `.cache/elevation/grid.f32` (4352x3584, Web Mercator pixel space) + `grid.json`. 133 isolated spike pixels (e.g. a bogus 1093 m on Bodmin Moor) are smoothed by the stitcher. Max 610.5 m after smoothing.
- ✅ Add `.cache/` to `.gitignore`
- ✅ Add a `scripts/bake-roads/README.md` describing prerequisites, how to run the fetch, how to resume, and the Overpass etiquette above
- ✅ Run both fetches for the whole region; record tile counts, raw sizes and any gaps in the Phase Summary. If the network is blocked, stop and ask the user for an extract
  - Both complete: elevation 238/238 tiles; OSM 130/130 tiles, 87.4 MB raw, no gaps. Log file removed.

### Verification Plan
- `node scripts/bake-roads/fetch-osm.mjs --check` lists every tile as cached with a non-zero way count
- `node scripts/bake-roads/fetch-elevation.mjs --check` reports full coverage of the bounds and min/max heights plausible for Devon and Cornwall (about 0 to 621 m)

### Phase Summary
Done. Raw data is cached under gitignored `.cache/` (`.cache/osm/`, `.cache/elevation/`).
- OSM: 130/130 tiles cached (0.25 degree grid main tiles plus one `town-<id>` tile per town), 87.4 MB raw, no town tile empty. `fetch-osm.mjs --check` passes.
- Elevation: 238/238 Terrarium tiles at zoom 11 (~49 m cells), stitched grid 4352x3584 in `.cache/elevation/grid.f32` + `grid.json`. Heights min -280.2 m (sea floor bathymetry), max 610.5 m; 133 spike pixels smoothed. `fetch-elevation.mjs --check` passes.
- Key decisions: public Overpass was heavily overloaded (502s and timeouts for hours). `overpass.openstreetmap.fr` responded in under a second with full data, so it was added first in `ENDPOINTS` (`fetch-osm.mjs:16`); other mirrors tried (maps.mail.ru, overpass.osm.jp) were unreachable. Fetch is resumable and skips cached tiles.
- Notes for later phases: Phase 8 must clamp negative elevation (sea floor) to sea level when building the heightmap. Elevation grid is in Web Mercator pixel space, so the bake needs the matching projection.
- Code docs: no C#/.NET changes, so no doc-code refresh needed.

## Phase 4: Bake the road graph
Status: Complete
Model: opus
Effort: medium

- ✅ Add `scripts/bake-roads/bake.mjs` pipeline stage 1: parse cached raw OSM, project lat/lon to the same world metres as `region.js` (shared projection module), drop unusable ways, map OSM highway classes to game classes (`M`, `dual`, `A`, `B`, `street`, `lane`) with a documented table and keep `ref`/`name`
  - Shared projection: new `world/projection.js` (`createProjection(seed)`). **Deviation:** the world is compressed 1:13 (`WORLD_SCALE`), so real streets would be ~6 m apart; the projection adds a smooth, invertible "town lens" per town that magnifies the real footprint (`footprintM`, e.g. 1210 m for a city) to the town's game radius (320 m), with a compression ring back to plain 1:13 (Exeter ring ends ~700 world m out). Inter-town distances are unchanged. `--no-lens` gives the plain projection. Phase 6 must build `region.js` positions (towns, sites, coast) through the same module; phase 8 must sample elevation through `unproject`.
  - Overpass `out geom` has no node ids, so topology keys on exact vertex coordinates (shared OSM nodes have identical lat/lon). Class table is `OSM_CLASS`/`gameClass` in `bake.mjs` (tertiary = B outside towns, unclassified = lane outside towns, both street inside; refs override). Format module `world/baked-format.js`.
- ✅ Stage 2, topology: build nodes at shared OSM nodes, split ways at intersections, merge degree-2 nodes into polylines, snap near-coincident endpoints, remove duplicate and overlapping ways, keep bridges, tunnels and layers as edge flags without false junctions
  - `buildTopology` (coordinate-keyed nodes, 2.5 m endpoint snap), `mergeDegree2`, `contractShort` (edges < 3.5 world m contract; bridges/tunnels never), `dropOverlaps` (an unnumbered minor road lying inside a higher-ranked road's carriageway at 1:13 is removed only if its neighbours stay connected), `trimOvershoots`, `repairCrossings` (straighten tangled short edges; 11 untagged at-grade data crossings become junctions). Bridges/tunnels are per-segment flags exported as edge `spans` (vertex ranges) plus `bridge`/`tunnel` booleans; the validator is span-aware now.
- ✅ Stage 3, dual carriageways and motorways: detect pairs of parallel one-way ways with the same `ref` within about 60 m and collapse each pair into one centreline edge of class `dual` or `M`; keep slip roads and grade-separated junctions as links; record the unit tests below
  - `collapseDuals`: carriageways (motorway/trunk/primary one-way, not links/rings) cut into 30 m pieces, paired with an antiparallel same-ref (or same-name) piece within 60 m, shifted to the midline; the longest carriageway is kept and a piece is dropped only where the other carriageway's kept run lies over it; side roads and slips on a dropped carriageway re-attach to the centreline; a dropped piece is restored if its loss leaves a kept run dangling (flares into roundabouts). Kept edges are two-way with `dual: true`; slips stay `link` edges. Tests in `delivery-driver.bake.test.mjs` (item below).
- ✅ Stage 4, roundabouts: collapse each `junction=roundabout` ring into one node with `junction: 'roundabout'`, re-attaching the arms; mini-roundabouts become nodes with the same type
  - `collapseRoundabouts`: 560 rings + 274 minis (`mini: true`). Arms keep their ring vertex and gain the centre. Grade separation survives: arms of a ring on bridges get their ring-to-centre stretch flagged, and a road passing over/under the ring without joining it is flagged across the whole island (M5 J24/J25). One-arm rings (turning circles) become real dead ends.
- ✅ Stage 5, junction typing and signals: set `junction` to `signals` where OSM has traffic signals, `giveway` or `priority` elsewhere using road class rank, and store the data `classifyJunctions` needs
  - `typeJunctions`: keeps the existing vocabulary (`end`, `through`, `giveway`, `signals`, `roundabout`) so `junctionType` and the renderers keep working; "priority" is a node flag (`priority: true` when one road outranks the others, `majorRank` = top rank) rather than a new junction value. Signals = an OSM `traffic_signals` node within ~30 real m of a junction (421 junctions). `signalsFrom` 1932 / `roundaboutFrom` 1960 (minis 1975) are placeholders for phase 5 and are not yet written to the tiles. Dead ends carry `end: osm|boundary|cut`.
- ✅ Stage 6, town streets: select residential/service/living_street/unclassified inside each town footprint, drop service roads that are driveways, car parks or too short, and simplify geometry with Douglas-Peucker (about 1.5 m tolerance in towns, 4 m outside) to meet the size budget
  - `clipToRegion` keeps minor streets only where the edge midpoint is inside a town footprint (and drops anything outside the region bounds); `parseOsm` drops `service=driveway|parking_aisle|parking|drive-through|emergency_access|slipway|bus|fuel`, `area=yes` and private minor roads; `pruneSpurs` removes service spurs < 80 m and streets left dangling by clipping. `simplifyGuarded` = Douglas-Peucker 1.5 / 4 world m that re-simplifies more finely any edge whose simplified line would cross a road (757k -> 116k vertices). Tolerances are world metres (4 m = ~52 real m in the country).
- ✅ Stage 7, output: write the region manifest plus tile files (quantised int coordinates with delta encoding, one file for the main network and per-town street tiles) under `Games.Client/wwwroot/games/delivery-driver/world/seed/baked/` with an ODbL licence header; also bake simplified coast and rivers; fail the bake if total gzip size exceeds 10 MB
  - 62 files: `manifest.json`, `main.json`, 58 `town-<id>.json`, `coast.json` (land polygon rings assembled from the OSM coastline, closed anticlockwise along the region bounds), `rivers.json` (river lines with OSM `width` where tagged, tidal water rings). Format documented in `world/baked-format.js` (0.1 m quantisation, delta-encoded, global node ids, string tables, edge flags). Total 0.75 MiB gzip. Geometry is quantised inside the bake before the final crossing check, so checks see exactly what is written.
- ✅ Add unit tests with small hand-built OSM fixtures: dual carriageway collapse, roundabout collapse, T-junction snapping, bridge over road (no junction), degree-2 merge, one-way tag carried through (`tests/js/delivery-driver.bake.test.mjs`)
  - 8 tests: the six listed plus mini-roundabout marking and the town lens (monotonic, invertible, footprint -> game radius). Fixtures are built in real metres and baked with `lens: false`.

### Verification Plan
- `node scripts/bake-roads/bake.mjs` finishes and prints node/edge counts per class and total gzip size under 10 MB
- `node scripts/validate-roads.mjs --baked --area all` reports a single connected main network, no edges crossing without a node, no dead ends except real ones, and an M5/A30/A38 chain that is continuous
- `npm test` passes including `delivery-driver.bake.test.mjs`

### Phase Summary
Done. `node scripts/bake-roads/bake.mjs` turns the `.cache/osm` raw data into `world/seed/baked/` in about 11 s, offline and deterministically. Verification passed:
- Bake: 31,944 nodes, 41,030 edges. Edges per class (count / world km): M 42 / 7.1, dual 968 / 33.2, A 3,883 / 152.6, B 7,417 / 322.4, street 9,787 / 183.4, lane 18,933 / 1,010.7. Junctions: 19,807 giveway (6,641 with priority), 421 signals, 785 roundabouts (274 mini), 4,701 through, 6,230 ends. 62 files, 2.86 MB raw, **0.75 MiB gzip** (budget 10 MiB).
- `validate-roads.mjs --baked --area all`: 1 connected component (31,944 nodes), **0 crossings without a node**, **0 artificial dead ends** (every dead end is a real OSM end or the map edge), **M5/A30/A38 chain is 1 component** (851 edges, 46 world km). Soft warnings: no-priority 11,400 (equal-rank T junctions; most are lane/lane), sharp-angle 1,592, short-edge 65, odd-degree 27. Hard failures left: 106 `road-in-water`, which Phase 4 does not check. They are shoreline roads (The Strand at Topsham, Blue Anchor Bay Road, Richmond Walk) that end up within one 4 m water-cache cell of the coast at 1:13, plus a few edges just past the north bound. Phase 6 must deal with them (finer water test near roads, or pull the coast back from roads).
- `npm test`: 308 pass, 0 fail (300 + 8 new in `delivery-driver.bake.test.mjs`).

Key decisions and things the next phases need:
- **Town lens projection (deviation, worth showing the user):** `world/projection.js` `createProjection(seed)` is the shared projection. The game world is compressed 1:13, which would leave real streets ~6 m apart, so each town's real footprint (`footprintM`, real m) is magnified smoothly to its game radius (`TOWN_RADIUS`, world m) and blends back to plain 1:13 by about 2x the radius (city ring ends ~700 world m out). The map is one-to-one and invertible (`unproject`), and distances between towns are unchanged. Towns inside a bigger town's ring move slightly (Saltash 68 m, Torpoint 144 m). **Phase 6** must project towns, sites, ferries and moors through `createProjection` (not `latLonToWorld`). **Phase 8** must sample elevation through `unproject`. `--no-lens` exists if the user prefers plain 1:13.
- Overpass `out geom` carries no node ids, so topology keys on exact vertex coordinates.
- At 1:13, real curves are 13x tighter and parallel roads within ~100 real m overlap. The bake removes unnumbered minor roads that lie inside a bigger road's carriageway (1,640, only where connectivity survives), but tight bends remain: a real 100 m radius bend becomes ~8 m. Phase 6/10 may need curvature smoothing for driving.
- Tile format (`world/baked-format.js`, `decodeTiles`): global node ids (main tile first, then towns in seed order); edges carry `cls, ref, name, oneway (a->b), link, lit, dual, maxspeed (mph), town, bridge, tunnel, spans [{from, to, type}]`; nodes carry `junction, end, priority, mini, town`. Town tiles hold only residential/living_street/service streets; the main tile is a connected network on its own except where rural lanes link only through town streets. `signalsFrom`/`roundaboutFrom` and `opened`/`closed`/`upgrades` are not written yet: that is Phase 5. Ferries are not baked: Phase 7 attaches the seed ferries.
- Coast: `coast.json` holds closed land rings (27; mainland built by closing the OSM coastline anticlockwise along the region bounds). To test points with even-odd, join the rings through a shared anchor point, as `loadBakedWorld` in the validator does. Do not just concatenate them. Rivers carry OSM `width` (real m) where tagged, else null. Torquay's seed centre sits in Tor Bay, so its town tile is small (43 edges); check it in Phase 7.
- Validator: `--baked` (`loadBakedWorld`, `validateChains`) is implemented, and the crossing and water checks now honour bridge/tunnel `spans`. `--furniture` and `--check-yards` are not available with `--baked` yet (phases 9/7).
- Files: new `scripts/bake-roads/bake.mjs`, `world/projection.js`, `world/baked-format.js`, `world/seed/baked/*` (62 generated files), `tests/js/delivery-driver.bake.test.mjs`; edited `scripts/validate-roads.mjs`, `scripts/bake-roads/common.mjs` (footprint now re-exported from `projection.js`) and `scripts/bake-roads/README.md` (bake section). Nothing in the running game imports the new modules yet, so no dev-server restart was needed. Nothing committed.
- Code docs: no C#/.NET changes, so no doc-code refresh needed.

## Phase 5: Era rules
Status: Complete
Model: sonnet
Effort: medium

- ✅ Add `scripts/bake-roads/era.mjs`: derive `opened`, `closed` and `upgrades` for every edge from the rules below and write them into the baked tiles
  - `era.mjs` (`applyEra`, `checkEraConnectivity`, `parseStartYear`, `buildEvents`); `bake.mjs` calls it when given `history.json`; `baked-format.js` is now format 2: edge rows gain `opened, closed, upgrades, tag`, tiles gain `nodeEra` (`signalsFrom`/`roundaboutFrom`), all optional/sparse. Precedence: curated table, OSM `start_date`, class rules, town growth, then minimax propagation so nothing opens before it is reachable from the 1919 network.
- ✅ ] Class rules: motorways closed before the first motorway year; `dual` edges start as `A` and upgrade in the year given by the curated table; `trunk`/`primary` roads that were not roads in 1919 are dated by the curated table
  - Motorway/M5 edges and their slip links open 1977 via the `m5` entry (`defaults.motorwayOpened`, first motorway 1958). Dual carriageways reset to base class `A` plus an `upgrades` entry to `dual` (curated year, else 1985, 1965 in towns); upgrades only apply to edges the bake found to be dual.
- ✅ ] Curated table `scripts/bake-roads/history.json`: migrate every opened/closed/upgrade from the seed's roads (Exeter bypass 1938, Tamar Bridge 1961 and Saltash ferry until then, M5 to Exeter 1977, A30/A38 dualling, others present in `sw-england.json`) mapped to OSM `ref` + endpoints
  - `scripts/bake-roads/history.json`: 18 entries migrated from the seed (m5, Tamar Bridge, Saltash/Dartmouth/Torpoint ferries as event-only, Exeter bypass, all A30/A38/A361/A380 dualling years). Matching is by ref/name within a corridor (default 300 world m) of the seed line, nearest entry wins; 15 entries matched edges.
- ✅ ] Town growth rule: inside each town, streets within the historic core radius exist from 1919; residential streets beyond it are dated by ring (distance bands mapped to 1930s, 1950s, 1970s, 1990s) with a deterministic per-street jitter; OSM `start_date` overrides where parseable
  - `town.coreFraction` per size, four distance bands 1935/1955/1975/1995, jitter +-4 years by a hash of the OSM id; applies to town `street` edges with no ref.
- ✅ ] Add a per-year connectivity check to the baker: for each of 1919, 1930, 1950, 1970, 1990, 2024 every town centre is connected to the main network; fail the bake otherwise
  - Years 1919, 1930, 1950, 1970, 1990, 2024: nearest open node to every town centre must be in the biggest open component. `bake.mjs` exits 1 without writing if it fails; the report is stored in `manifest.json` (`era`).
- ✅ Update `world/history.js` to read events from the baked curated tags instead of seed road ids; keep its public API (`roadEvents`, `eventsBetween`, `describeEvent`)
  - `roadEvents` reads `world.region.events` (the curated events the bake writes into `manifest.events`; `road` = the curated tag also stored on edges) and falls back to the seed roads' dates when absent, so the seeded world and its tests keep working until Phase 6 builds the world from baked data. The validator's `loadBakedWorld` sets `region.events`.
- ✅ Add `tests/js/delivery-driver.era.test.mjs` asserting M5 absent in 1919, present from its opening year, Tamar Bridge vs ferry switching in 1961, and every town reachable in each sample year
  - 11 tests on the baked data (M5 and its slips, Tamar Bridge vs the Saltash Ferry event, Exeter bypass 1938, dualling year, town growth, connectivity in all six years, node eras, format round trip, minimax propagation). The Tamar Bridge/ferry switch is checked as bridge edges opening in 1961 plus the ferry's `closed` event, because ferries are not baked until Phase 7.

### Verification Plan
- `node scripts/bake-roads/bake.mjs` passes the per-year connectivity check
- `npm test` passes including `delivery-driver.era.test.mjs` and the updated history tests

### Phase Summary
Done. Verification passed: `node scripts/bake-roads/bake.mjs` exits 0 and passes the per-year connectivity check (1919, 1930, 1950, 1970, 1990, 2024: all 58 town centres in the single main component; open nodes 26,338 / 26,338 / 27,542 / 29,020 / 30,441 / 31,944); gzip 0.77 MiB. `npm test`: 319 pass, 0 fail (308 + 11 new in `delivery-driver.era.test.mjs`). Validator `--baked --area all` at 2024 is unchanged from Phase 4 (1 component, 0 crossings, M5/A30/A38 chain whole, same 106 road-in-water).

What exists:
- `scripts/bake-roads/era.mjs` (`applyEra`, `checkEraConnectivity`, `parseStartYear`, `buildEvents`, `SAMPLE_YEARS`) and `scripts/bake-roads/history.json` (curated table + defaults + town-growth parameters). `bake(elements, seed, {history})` runs the era step after junction typing; `main()` loads `history.json`, aborts with exit 1 and writes nothing if connectivity fails, and stores `events` and an `era` report in `manifest.json`.
- Rules, in precedence order: (1) curated entries matched by OSM `ref` (or `names`, `bridge` flag) with the edge's mean distance to the seed line under a corridor (default 300 world m; the nearest entry wins, dated entries are favoured); `anywhere` entries (M5) match by ref alone. 15 entries matched 625 edges; the 3 ferry entries are event-only (`edges:false`) for Phase 7. (2) OSM `start_date` (parsed; only ~25 ways in the region have one, none used in the end). (3) Class rules: M and M-slip edges open 1977 (via the `m5` entry; `defaults.motorwayOpened`), carriageways the bake collapsed to `dual` get stored class `A` plus an upgrade to `dual` (curated year for 259 edges, default 1985 / 1965 in towns for 709). (4) Town growth: `street` edges without a ref inside a town are 1919 within `coreFraction` of the town radius (city 0.4, town 0.45, small 0.55, village 0.7) and otherwise dated 1935/1955/1975/1995 by distance band, +-4 years deterministic jitter. (5) Minimax propagation: an edge cannot open before it is reachable from the biggest 1919 component (2,881 edges pushed later), so M5 slips, ring streets and similar never exist as islands.
- Junction eras: `signalsFrom` 1932 for signals, `roundaboutFrom` 1960 (mini 1975) on nodes; the existing year-aware `junctionType` already consumes them.
- Format 2 (`world/baked-format.js`): edge rows gain optional trailing `opened, closed, upgrades, tag`; tiles gain sparse `nodeEra`. `decodeTiles` returns `opened` (0), `closed` (Infinity), `upgrades [{year, class}]`, `tag`, and node `signalsFrom`/`roundaboutFrom`. Stored `cls` is the class before upgrades, so use `edgeClass(edge, year)`.
- `world/history.js`: `roadEvents` reads `world.region.events` (from `manifest.events`) and falls back to the seed roads' dates; public API unchanged. `scripts/validate-roads.mjs` `loadBakedWorld` now passes node eras and `region.events`.

Things to know:
- The Tamar Bridge matches only 2 edges (name `Tamar Bridge`); the bridge's viaduct approaches stay open in 1919. Ferries are not baked, so the Saltash Ferry vs bridge switch is only an event pair until Phase 7 attaches the ferry edges with `closed: 1961` (history.json has the fee/wait data).
- The Exeter bypass entry matched only 8 A30 edges; the real 1938 bypass line is approximate against modern OSM. Unlisted dual carriageways (modern bypasses) exist from 1919 as plain `A`. These are known limits of dating one modern network; tune `history.json` if the user wants more.
- In 1919 the validator reports the M5/A30/A38 chain in 6 pieces and 386 dead ends (the bypass, Tamar Bridge, M5 and later streets are absent); that is expected, and connectivity of towns is what the bake enforces.
- Per-class bake stats in the manifest are the class in 2025. Nothing in the running game imports the baked data yet, so no dev-server restart. Nothing committed.
- Code docs: no C#/.NET changes, so no doc-code refresh needed.

## Phase 6: Runtime loader and region data
Status: Not started
Model: sonnet
Effort: medium

- [ ] Add `world/baked-loader.js` that fetches the manifest and tiles, decodes the quantised coordinates and returns region data (towns, coast, rivers, moors, relief grid) plus the road graph input
- [ ] Change `world/region.js` `loadRegion` to use the baked coast and rivers for `waterAt`, `crossesWater` and bridge detection; keep the seed for towns, sites, moors and ferries
- [ ] Replace the seeded road construction in `world/roadgraph.js` `buildRoadGraph` with building the graph from baked edges (same node/edge shape, `createSegmentIndex`, `splitEdge`, `junctionType`, `edgeClass`, `edgeOpen`); keep `ROAD_CLASS` and lane helpers; add `oneway` and `maxspeed` edge fields
- [ ] Remove `generateTownStreets` and the lattice code from `world/generator.js` once nothing references it (keep exported helpers still used by yard placement)
- [ ] Load town street tiles lazily if the profiling in phase 13 requires; for now load everything but keep the loader tile-based so this can change without touching callers
- [ ] Update `tests/js/delivery-driver.world.test.mjs` and other tests that built the graph from seed roads to build from baked fixtures (a small baked fixture region committed under `tests/js/fixtures/`)

### Verification Plan
- `npm test` passes
- A Node script building the world from the baked data prints node/edge counts equal to the bake report

### Phase Summary
_(write when phase completes)_

## Phase 7: Attach gameplay data
Status: Not started
Model: sonnet
Effort: medium

- [ ] Town centre node: snap each town's `centreNode` to the nearest real junction of a street or main road within the town footprint
- [ ] Depots and in-town sites: adapt `findStreetYardSpot` / `layoutSite` in `world/generator.js` to choose frontage spots along real streets (side of the road, clear of junction mouths, orientation along the street), keep the yard access edge model
- [ ] Out-of-town sites and farms: replace generated `lane` and `access` roads from `buildRoadGraph` with attachment to real `unclassified`/`service` roads where one is within reach, and otherwise a short generated lane that leaves the nearest real road at a right angle on the correct side; farms prefer real minor-road frontages (rural lanes are baked within a corridor around each farm/site seed point)
- [ ] Ferries and named bridges: attach seed ferry slips and bridge links to the nearest real nodes; keep their `opened`/`closed` and fee data
- [ ] Add validator checks: every depot, site and farm is connected to the main network in all sample years; no yard overlaps a road or another yard
- [ ] Update the contract generator and route tests only where they depended on old node ids

### Verification Plan
- `node scripts/validate-roads.mjs --baked --area all --check-yards` reports every depot, site and farm connected, none overlapping a road
- `npm test` passes

### Phase Summary
_(write when phase completes)_

## Phase 8: Terrain from real elevation
Status: Not started
Model: sonnet
Effort: medium

- [ ] Bake the elevation grid into `world/seed/baked/elevation.bin` (quantised 16-bit heights with a small header), decoded by the baked loader
- [ ] Change `world/terrain.js` `terrainHeight` to bilinear-sample the real grid (keeping the same signature and determinism), adding the existing fine detail noise on top at small amplitude; keep tors from the seed as local knolls only if they still make sense at real heights
- [ ] Keep `gradeRoads` cut-and-fill logic but re-tune `MAX_GRADE`/`gradeLimit` using the real grades baked roads need (log how many edges need smoothing and the largest correction)
- [ ] Update `render/gl/terrain-mesh.js` and the terrain tests to the new height range and sampling; sea level and water depth must agree with the baked coastline
- [ ] Re-check slope physics assumptions (gradient readout, `hillSpeed`) on steep real roads such as Dartmoor and Exmoor climbs

### Verification Plan
- `npm test` passes (terrain, slope, physics suites updated)
- A Node script samples `terrainHeight` on a grid and prints min/max (about 0 to 621 m) and the share of road length above each grade bracket

### Phase Summary
_(write when phase completes)_

## Phase 9: Street furniture and building alignment
Status: Not started
Model: sonnet
Effort: medium

- [ ] Add `world/furniture.js` (pure) computing furniture from the graph: lamps, signs, signals, bollards and give-way/stop signs by explicit rules instead of the code at the end of `generateChunk`
- [ ] Lamp rules: only on roads that are lit (OSM `lit=yes` baked, plus all town streets) and only in eras that had lighting (gas to the 1940s, electric after); placed at `carriageway half-width + kerb + 0.6 m` on the verge/pavement, spacing by class and era, alternating or staggered by road width, none within the junction mouth radius or across driveways/yard accesses, none on bridges, none inside building colliders or water; corner lamps at junctions
- [ ] Sign rules: junction signs on the approach verge on the left of each arm, facing the oncoming traffic, offset beyond the kerb; fingerposts before 1965 and Worboys signs after; speed limit, give way and stop signs by junction type; chevrons on roundabout approaches; signals at `signals` junctions at each stop line on the left, plus a far-side head
- [ ] Remove the old lamp and sign code from `generateChunk` and have chunks pull their share from `furniture.js` (keep `chunk.lamps` and `chunk.signs` fields so renderers and colliders keep working)
- [ ] Buildings: plot `generateTownBuildings` along real frontages (setback from the kerb, facing the street, party walls in terraces, corner plots at junctions), clear of roads and furniture; trees, hedges and rocks use the same clearance (`clearOfRoads`)
- [ ] Extend the validator and add `tests/js/delivery-driver.furniture.test.mjs`: across the sampled areas and years, zero props within the carriageway plus 0.5 m of any edge, zero overlapping buildings, lamp spacing within tolerance, signs facing their arm
- [ ] Run the validator and record the furniture-on-road count against the phase 2 "before" number (target zero)

### Verification Plan
- `node scripts/validate-roads.mjs --baked --area all --furniture` reports zero props on the carriageway and zero inside buildings
- `npm test` passes including `delivery-driver.furniture.test.mjs`

### Phase Summary
_(write when phase completes)_

## Phase 10: Road rendering upgrades
Status: Not started
Model: sonnet
Effort: medium

- [ ] Junction geometry: build junction patches at nodes from the incoming edge widths and angles (rounded kerb returns), replacing overlapping strip ends in `render/gl/road-mesh.js`; roundabouts get a central island, circulating carriageway and splitter islands on the arms
- [ ] Kerbs and pavements: kerb lines and pavements on town streets (raised slightly, era-appropriate surface colour), grass or hedge verges on rural roads, no pavements on lanes
- [ ] Markings by class and era: none on early roads, centre lines from the 1930s, edge lines and dashed centre lines later, double white lines on bends of A roads, lane lines and hatching on dual carriageways and motorways, stop lines and give-way triangles at junction mouths, zebra crossings in towns from the 1950s
- [ ] Mirror the changes in the Canvas 2D fallback `render/draw-road.js` at reduced fidelity, and update the minimap road drawing in `render/minimap.js` and `render/gl/minimap-gl.js` for one-way and class styling
- [ ] Update `tests/js/delivery-driver.road-mesh.test.mjs` for the new meshes (no overlapping z-fighting strips at a node, marking positions inside carriageway)
- [ ] Capture Playwright screenshots of a T-junction, a signal junction, a roundabout and a dual carriageway at three eras into `test-results/` for visual review

### Verification Plan
- `npm test` passes including the updated road-mesh tests
- Playwright script saves screenshots for the four junction types without console errors

### Phase Summary
_(write when phase completes)_

## Phase 11: Traffic, router and junction logic
Status: Not started
Model: sonnet
Effort: medium

- [ ] `world/pathfind.js`: honour `oneway` (directed edges), per-edge speed limits from `maxspeed` and class by era, and avoid penalising real dual carriageway links wrongly
- [ ] `traffic/traffic.js`: respect one-way edges when choosing `pickNext`, drive on the correct lane of dual carriageways and motorways, follow roundabout priority (give way to circulating traffic), and handle junctions with more than four arms and slip roads without deadlock (extend the claim system and its test)
- [ ] Use baked `maxspeed`/class for `cruiseSpeed` by era instead of the fixed table where available
- [ ] Spawn rules: do not spawn on motorway slip roads or yard accesses; ensure `spawnNear` still avoids the player's view (keep behaviour from earlier work)
- [ ] Update the existing crossroads and lane tests and add tests for a one-way street, a roundabout and a dual carriageway with the real graph shape

### Verification Plan
- `npm test` passes including the new one-way, roundabout and dual carriageway traffic tests
- A Node soak script runs 10,000 seeded steps around Exeter in 1919, 1965 and 2020 with no vehicle on a closed or wrong-way edge and no overlaps at junctions

### Phase Summary
_(write when phase completes)_

## Phase 12: Saves, tests, docs and attribution
Status: Not started
Model: sonnet
Effort: medium

- [ ] Bump `SAVE_VERSION` in `game/save.js` and make older saves load as "start fresh" with a clear message in the start screen (no migration)
- [ ] Add OSM attribution to the game's credits/about, the minimap, `README.md`, and the baked data manifest; add `scripts/bake-roads/NOTICE.md` with the ODbL notes
- [ ] Update `_docs` (road system overview: pipeline, tile format, era rules, furniture rules) and the delivery-driver docs, and note the new scripts in the README
- [ ] Update e2e specs under `tests/e2e/` that depend on world positions or ids; run the full unit suite and the Delivery Driver e2e spec
- [ ] Remove dead seed road code and unused seed fields once nothing references them (keep `sw-england.json` towns/sites/ferries/moors/maxGrade)

### Verification Plan
- `npm test` passes
- `npm run test:e2e -- delivery-driver` passes (or failures are recorded with causes)
- An old-format save is rejected with the new message in a unit test

### Phase Summary
_(write when phase completes)_

## Phase 13: QA, performance and sign-off
Status: Not started
Model: sonnet
Effort: medium

- [ ] Measure start-up: time to a playable world, graph memory, tile size on the wire (gzip), and the per-frame cost with traffic on Medium quality; if start-up or memory is too heavy, move town street tiles to lazy loading
- [ ] Measure router cost for the longest contract and for fleet AI jobs; add hierarchical routing hints (main network first) if it exceeds the budget
- [ ] Walk the map with the debug panel: teleport to Exeter, Plymouth, Truro, Penzance, Barnstaple and a rural junction in 1919, 1955 and 2020; screenshot and fix visible defects (floating props, bad junction angles, roads in water, steep spikes)
- [ ] Run the validator over the whole region in six sample years; all hard checks must pass; list any accepted soft warnings with reasons in the Phase Summary
- [ ] Restart the dev server on port 5210 and confirm HTTP 200 and no console errors on a fresh load

### Verification Plan
- `node scripts/validate-roads.mjs --baked --area all --furniture --check-yards` exits 0
- `npm test` passes; Playwright load of `/play/delivery-driver` shows no console errors and reaches a drivable state
- Recorded numbers: start-up time, gzip size under 10 MB, frame ms on Medium

### Phase Summary
_(write when phase completes)_

## Final Recap
_(write when all phases complete: summary of the entire piece of work)_

## Deployment Plan
_(write when all phases complete: step-by-step deployment instructions)_
