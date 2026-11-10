# Delivery Driver: spline-driven roads and a greybox test page

Rebuild road geometry so every road, kerb, marking and junction is generated from a smooth spline rather than straight 4 m chords, and build a separate greybox test page with a fixed layout (straight, curve, crossroads, T junction, roundabout, overbridge) that the drive-through tests and overlap validator run against first. Keep the custom WebGL2 renderer and the road meshes; no three.js port, no painted-ground splat map.

## Decisions & Answers

- **Q:** Painting roads into the ground (splat map) vs keeping road meshes? — **A:** "whatever other games do to make smooth non flickering roads" (first answer, then) "i think meshes are probably the correct answer, but other games will connect them to a spline and manipulate them to the curves".
- **Q:** Which road parts go into painted ground? — **A:** Meshes. Painting is dropped for this plan.
- **Q:** Should roads be smooth curves or finer sampling of the current polyline? — **A:** "Smooth curve geometry (Recommended)": the centreline is a true curve (spline), sampled finely, and the surface and markings are built from it.
- **Q:** Where does the greybox test level live? — **A:** "Separate test page (Recommended)": a standalone page in the same WebGL renderer.
- **Q:** Hand-authored or generated? — **A:** "Simple spec in code (Recommended)": a small list of roads, junctions and bridges in code, reusable in automated tests.
- **Q:** Should the greybox become the reference for the real map? — **A:** "Yes, use it as the reference (Recommended)": the same drive-through and overlap checks run on the greybox first; the real map follows once they pass there.
- **Q:** Eras (1926 to 1970) road colours? — **A:** "at this point im not concerned about the era part". Out of scope. The existing per-year colour and rebuild path must keep working unchanged.
- **Q:** Commit policy and branch? — **A:** "Branch from current, commit per phase (Recommended)": new branch from `feature/delivery-driver-road-geometry`, local commit after each verified phase, never push. Uncommitted work already in the tree (`.vscode/launch.json`, `.vscode/tasks.json`, `world/terrain.js`, plan 0009, `scripts/qa-screenshots.mjs`) stays out of these commits.
- **Q:** Which parts stay as meshes, and at what detail? — **A:** Surface, kerbs, pavements, markings and parapets are meshes extruded along the spline. Bridge decks, ramps, tunnels and piers were already meshes and stay so.
- **Q:** Greybox core set? — **A:** "Core set (Recommended)": straight road, tight curve, 4-way crossroads, T junction, 4-arm roundabout, one overbridge across a road. Each has a drive-through test and a screenshot. No traffic in the greybox at first.
- **Q:** Approach confirmed? — **A:** "Yes, spline-driven meshes (Recommended)": each road is a smooth spline; surface, kerbs and markings are extruded along it with proper frames; junctions and roundabouts join splines at matching tangents; flicker is fixed with layer offsets and depth bias.

**Assumptions (not asked, confirm if wrong):**
- Spline type: centripetal Catmull-Rom through the existing graph nodes and sampled points, with arcs for roundabout rings. Tangent continuity at joins.
- Sample spacing on the spline: about 1 m on curves, up to 4 m on straights. Tolerance for the chord-error check: 0.05 m.
- The existing world pipeline (`world/roadgraph.js`, `world/terrain.js`, `world/junction-layout.js`) stays the source of topology and heights. Splines are built on top of it, not a rewrite of baking.
- Flicker is handled by layer offsets (kerb, surface, marking) plus a per-layer polygon offset in the renderer. No splat map.
- Save format is unchanged in this plan. If geometry changes require new baked data, that is a follow-up plan.
- The greybox page is a dev-only route, not linked from the game menu.

## For Future Agents
As work proceeds: set a phase's status to `In progress` when you start it and flip each item to `- ✅` as soon as it completes; when a phase is done, run its **Verification Plan**, write its **Phase Summary** (max ~5 lines), and set its status to `Complete` (`execute-plan` then makes a local checkpoint commit). Never ask the user questions; record any assumption inline. When all phases are done, fill in **Final Recap** and **Deployment Plan**.

Test commands in this repo: `npm test` (runs `tests/js/**/*.test.mjs`), `npm run test:e2e` (Playwright), `node scripts/validate-roads.mjs` (overlap and roundabout checks, to be extended), `node scripts/qa-screenshots.mjs` (screenshots). The dev server runs on port 5210 and must be restarted after every change, because the user tests on a phone.

## Recommended Model

| Phase | Model | Effort | Why |
|---|---|---|---|
| 1 Branch and baseline | haiku | medium | Git branching and running the existing test suite |
| 2 Spline centreline | sonnet | medium | Pure maths on existing sample data, follows existing patterns |
| 3 Spline ribbons for surface, kerbs and markings | sonnet | medium | Porting the mesh builders to spline frames |
| 4 Junctions and roundabouts on splines | sonnet | medium | Joins at matching tangents, reuses the layout code |
| 5 Flicker: layers and depth bias | sonnet | medium | Renderer change against existing polygon offset |
| 6 Greybox test page | sonnet | medium | Wiring a fixed spec into the existing renderer |
| 7 Validator and drive-through tests on greybox | sonnet | medium | Extends existing scripts |
| 8 Apply checks to the real map | sonnet | medium | Runs the same checks and fixes regressions |

## Phase 1: Branch and baseline
Status: Complete
Depends on: none
Files: git only
Model: haiku
Effort: medium

- ✅ Create branch `feature/delivery-driver-spline-roads` from `feature/delivery-driver-road-geometry`
- ✅ Record the uncommitted files in `git status` in the phase summary, so they are kept out of phase commits
- ✅ Run `npm test` and record the pass/fail counts as the baseline

### Verification Plan
- `git rev-parse --abbrev-ref HEAD` prints `feature/delivery-driver-spline-roads`
- `npm test` completes; the pass/fail counts are recorded in the phase summary (any pre-existing failures are noted, not fixed here)

### Phase Summary
- Branch `feature/delivery-driver-spline-roads` created from `feature/delivery-driver-road-geometry` (working tree carried over, no commit).
- Uncommitted files to keep OUT of phase commits: `.vscode/launch.json`, `.vscode/tasks.json`, `Games.Client/wwwroot/games/delivery-driver/world/terrain.js`, `_docs/plans/0009-delivery-driver-road-geometry-overhaul.md`, `_docs/plans/0010-delivery-driver-spline-roads-greybox.md`, `scripts/qa-screenshots.mjs`.
- Baseline `npm test`: 443 pass, 0 fail, 0 cancelled.
- No phase commit for Phase 1 (git-only phase).

## Phase 2: Spline centreline
Status: Complete
Depends on: 1
Files: `Games.Client/wwwroot/games/delivery-driver/world/road-spline.js` (new), `tests/js/road-spline.test.mjs` (new)
Model: sonnet
Effort: medium

- ✅ Add `world/road-spline.js` with a centripetal Catmull-Rom spline through an ordered list of points, returning position, tangent and normal at any arc-length distance
- ✅ Add arc-length re-parameterisation so sampling is even along the curve
- ✅ Add adaptive sampling: about 1 m where curvature is high, up to 4 m on straights, with the chord-error tolerance of 0.05 m
- ✅ Add arc helper for roundabout rings (a true circle of given centre, radius and angles)
- ✅ Add unit tests: straight line is exact, circle arc chord error is under 0.05 m, arc-length sampling is even within 1%, tangents are continuous at joins

### Verification Plan
- `node --test tests/js/road-spline.test.mjs` passes all cases
- `npm test` has no new failures versus the Phase 1 baseline

### Phase Summary
- Added `world/road-spline.js` (points are `{x,y}`; normal is left normal `(-ty, tx)`; end phantom points extrapolate quadratically to keep curvature) and `tests/js/road-spline.test.mjs` (6 cases).
- API: `createSpline(points, {alpha=0.5, closed}) -> {length, closed, at(s), positionAt(s), sample(ss)}` where `at(s) -> {x,y,tx,ty,nx,ny,s}` is by arc length; `sampleEven(spline, step=4)`; `sampleAdaptive(spline, {minStep=1,maxStep=4,tol=0.05})`; `arcSamples(cx,cy,radius,a0,a1,opts) -> [{x,y,tx,ty,nx,ny,s,a}]` (a1<a0 = clockwise); constants `SAMPLE_MIN_STEP`, `SAMPLE_MAX_STEP`, `CHORD_TOLERANCE`.
- Note: min step 1 m means the 0.05 m tolerance holds for radii above about 2.5 m.
- Verification: road-spline tests 6 pass, 0 fail; `npm test` 449 pass, 0 fail (baseline 443 + 6 new).

## Phase 3: Spline ribbons for surface, kerbs and markings
Status: Complete
Depends on: 2
Files: `Games.Client/wwwroot/games/delivery-driver/render/gl/road-mesh.js`, `Games.Client/wwwroot/games/delivery-driver/render/draw-road.js` (offsetPolyline)
Model: sonnet
Effort: medium

- ✅ In `buildEdgeMesh`, replace the 4 m `edgeSamples` polyline with spline samples from Phase 2, keeping the graded height from `roadHeightAt`
  - **Note:** `edgeSamples(edge, step?, {minStep,maxStep,tol})` now samples the spline (adaptive 1 to 4 m, tol 0.02 m, which is what keeps a 30 m radius bend under 5 degrees per sample; `step` gives even spacing). `d` stays the distance along the edge's own polyline. A pin point 1 m in from each end keeps the end tangent on the first/last chord so junction mouths still match.
- ✅ Offset surface, kerb, reservation and marking strips along the spline normal (not per-chord offsets), so bends stay smooth
  - **Note:** samples carry `tx, ty`; `offsetSamples` and `trimSamples` use them and `addStrip` (meshes.js) uses a point's `tx, ty` when present.
- ✅ Update `centreLine`, `dashes` and `addZebra` to take spline samples, keeping their existing spacing in metres
  - **Note:** the centre-line bend threshold is now per STEP m of travel, as samples are 1 to 4 m apart; the zebra takes its point and tangent from the spline.
- ✅ Keep the `DETAIL` levels (coarse, basic, full) working by sampling the spline at the level's step
  - **Note:** coarse samples the spline at 2 to 8 m (tol 0.15 m).
- ✅ Add a test that a 90 degree bend built from splines has no edge-to-edge angle over 5 degrees per sample
  - **Note:** in `tests/js/delivery-driver.road-mesh.test.mjs`.

### Verification Plan
- `npm test` passes, including the new bend test
- `node scripts/validate-roads.mjs` reports no new overlaps on the real map versus the Phase 1 baseline
- Screenshot a tight bend before and after (`node scripts/qa-screenshots.mjs`), and note the change in the phase summary

### Phase Summary
- Edge strips, kerbs, pavements, markings, zebra and decks now come from the Phase 2 spline: `edgeSamples(edge, step?, opts)` returns `{x,y,z,d,tx,ty}` (adaptive 1 to 4 m at tol 0.02 m; coarse 2 to 8 m); offsets run along the spline normal (`offsetSamples`, `addStrip` honours `tx,ty`). Edge splines cached as `edge._spl` (`splineOf`, not exported).
- Phase 4 note: the layout still assumes polyline arms, so a pin point 1 m in from each end holds the end tangent to the end chord; short 3-point edges with a sharp corner still stray up to about 1.3 m inside 4 junction surfaces (6 of 300 offenders versus a 9 allowed in the existing overlap test).
- Verification: `npm test` 450 pass, 0 fail (449 + bend test); `validate-roads.mjs` output identical before and after (graph-only, 0 hard failures). After screenshot (rural junction, 2024) renders cleanly with 0 console errors; a "before" shot was not taken (would have meant reverting the working tree), so no side-by-side. Needed `dotnet build` of Games.Client plus a 5210 restart because assets are fingerprinted.

## Phase 4: Junctions and roundabouts on splines
Status: Complete
Depends on: 3
Files: `Games.Client/wwwroot/games/delivery-driver/world/junction-layout.js`, `Games.Client/wwwroot/games/delivery-driver/render/gl/road-mesh.js` (`buildNodeMesh`, `addBand`)
Model: sonnet
Effort: medium

- ✅ Build each arm's end as a spline that joins the junction footprint at the arm's tangent, so arms curve into the junction
  - **Note:** `edgeSpline(edge)` moved into `world/junction-layout.js` (exported; road-mesh imports it). Arm mouths, kerb points, ring trim search and stop lines now take position and heading from the edge spline (`armPoint`), so mouths sit exactly where the strips end. Cost: hull fallbacks in `junction-layout-stats` 888 to 954 and ring-crowded rejects 43 to 50 (year 2024) from the mouths no longer lying on the chords.
- ✅ Build roundabout rings as arcs from Phase 2, with arms joining the ring at their angle with flared entries
  - **Note:** ring silhouette arcs use `arcSamples`; each arm gets `arm.join` (cubic from the mouth, leaving along the arm tangent, to the ring's outer circle at `ringAngle`, arriving radially) and `arm.flareSides` (the curve widened from the half width to the mouth's half span on the ring).
- ✅ Replace the chord-based junction bands in `addBand` with spline-edge bands, so the corner returns follow curves
  - **Assumption:** `addBand` itself is unchanged; its boundary now carries curve samples (kerb returns about 1 m per segment, up to 16; ring arcs and flare curves from the spline code), and its per-vertex mean normals follow them, so the bands follow the curves.
- ✅ Keep stop lines and signal poles in place, now placed from the spline's tangent
  - **Note:** plain junctions use the arm spline's point and heading; roundabout stop lines sit on the arm's approach curve 2.5 m outside the ring.
- ✅ Add a test: each roundabout arm meets the ring within 0.1 m and at matching tangent
  - **Note:** in `tests/js/delivery-driver.junction-layout.test.mjs` (3 star layouts incl. a crowded one).

### Verification Plan
- `npm test` passes, including the roundabout join test
- `node scripts/junction-layout-stats.mjs` runs without error and reports no arm missing its junction
- Screenshot the real map roundabout before and after

### Phase Summary
- Layout arms now follow the edge spline: `edgeSpline(edge)` is exported from `world/junction-layout.js`; mouths, kerb points, ring trims and stop lines use its position and tangent. Roundabout arms get `arm.join` (cubic approach curve, mouth to ring outer circle, radial arrival) and `arm.flareSides`; ring arcs use `arcSamples`; kerb returns carry about 1 m per segment so the unchanged `addBand` follows curves.
- Stray-strip count (road-mesh overlap test, 300 junctions): 6 before, now 0 (mouths sit on the spline the strips use). Cost: `junction-layout-stats` 2024 hull fallbacks 888 to 954 and ring-crowded rejects 43 to 50, no exceptions or NaN.
- Verification: `npm test` 451 pass, 0 fail (450 + roundabout join test). Screenshots `test-results/p4/before-*.png` and `after-*.png` (roundabout and rural junction, 2024): clean, 0 console errors. Needed `dotnet build` plus a 5210 restart.

## Phase 5: Flicker: layers and depth bias
Status: Complete
Depends on: 3
Files: `Games.Client/wwwroot/games/delivery-driver/render/gl/gl-renderer.js` (polygon offset around line 342), `Games.Client/wwwroot/games/delivery-driver/render/gl/road-mesh.js` (`LAYER` constants)
Model: sonnet
Effort: medium

- ✅ Give each road layer (kerb, surface, reservation, marking, junction, pavement) a distinct, fixed height step, and make sure stacked layers never share a height
  - **Note:** LAYER is now kerb .04, surface .06, junction .08, reservation .10, marking .12, pavement .14 (2 cm apart; junction was .07 and unused: the junction fan and islands now use it). Test added in `delivery-driver.road-mesh.test.mjs`.
- ✅ Set the per-layer polygon offset in the renderer from the layer, not one global offset
  - **Note:** the mesh builder tags each triangle with a layer (`b.layer`, set by `addStrip`/`addBand`/junction fan from the LAYER height via `layerRanks`) and `finish()` sorts triangles into `mesh.groups`; `drawMeshLayers` (gpu-mesh.js) draws each group with `polygonOffset(-1, -2 - 2*layer)`. The shadow-pass offset (line 342) is unchanged.
- ✅ Check that bridge decks and junction surfaces at different layers do not fight (the layer offset must be larger than the depth precision error at max view distance)
  - **Note:** 24-bit depth, near 0.5, far up to ~1550 m gives ~0.29 m of depth quantum at max range, so a 2 cm height step alone cannot separate layers there; the polygon offset is in depth units (2 per layer), so the gap holds at any range. Decks and ramps sit metres from junction layers and only meet at joins, where they share the base group.
- ✅ Keep the existing LAYER constant names so other callers still work

### Verification Plan
- `npm test` passes
- Screenshot a surface-on-surface junction from a distance and close up (`node scripts/qa-screenshots.mjs`); no flicker visible in the captured frames
- `node scripts/validate-roads.mjs` still reports no same-layer overlap

### Phase Summary
- Layer heights (m): kerb .04, surface .06, junction .08, reservation .10, marking .12, pavement .14 (`LAYER`, names unchanged; `LAYER_ORDER` bottom first). Each is also a draw layer (1 to 6; 0 = untagged, e.g. yards, islands, decks): offset `polygonOffset(-1, -2 - 2*layer)` per group via `drawMeshLayers`, so roads cost up to 7 draw calls per chunk instead of 1.
- Builder API: `b.layer`, `layerRanks` (meshes.js), `mesh.groups` (index ranges; `append`/`mergeMeshes` drop groups). Shader and vertex format unchanged.
- Verification: `npm test` 452 pass, 0 fail (451 + layer test); `validate-roads.mjs` 0 hard failures (graph-only, so it cannot see same-layer mesh overlap; the road-mesh overlap test still passes). Screenshots `test-results/p5/p5-*-2024.png` (rural, roundabout, flyover; close-up only, software GL, 0 console errors) show no visible flicker, but a still frame cannot prove flicker is gone and no distant frame was taken, so confirm on the phone. Needed `dotnet build` and a 5210 restart.

## Phase 6: Greybox test page
Status: Complete
Depends on: 5
Files: `Games.Client/wwwroot/games/delivery-driver/greybox/` (new folder), a dev route in `Games.Client/wwwroot/games/delivery-driver/index.js` or a separate `greybox.html`
Model: sonnet
Effort: medium

- ✅ Add a spec file `greybox/spec.js` describing the core set in code: straight road, tight curve, 4-way crossroads, T junction, 4-arm roundabout, one overbridge across a road
- ✅ Build a road graph from the spec and feed it to the existing road mesh pipeline, bypassing the real map baking
  - **Note:** `greybox/graph.js` (`buildGreyboxWorld`) builds the graph, flat road heights and a stand-in flat region (zero elevation grid, because bridge supports call `groundZ`); `greybox/mesh.js` (`buildGreyboxMesh`) runs `buildEdgeMesh`/`buildNodeMesh` over it.
- ✅ Add a dev-only entry point (`greybox.html` or a query flag) that loads the spec with the WebGL renderer and a free camera
  - **Assumption:** separate page `greybox/greybox.html` + `greybox/main.js` with its own small lit shader (not the full game renderer, which needs the whole session); uses the game's context, program, mesh upload and per-layer polygon offset.
- ✅ Make sure the dev-only entry is not linked from the game menu
  - **Note:** grep of Games.Client (razor, cs, json, index.js) finds no reference to greybox.

### Verification Plan
- Start the dev server on port 5210 and open the greybox entry; the page renders all six pieces with no console errors (check with the Playwright browser)
- Screenshot the greybox page and save to `_docs/qa/greybox/` for the phase summary

### Phase Summary
- Added `greybox/spec.js` (exports `GREYBOX_SPEC` {year, pieces, junctions, roads}, `roadsOf`, `PIECE_SPACING`, `ARM`, `DECK_LIFT`; roads are point lists with `cls`, optional `deck` and `ramp`; 6 pieces on a 300 m grid), `graph.js` (`buildGreyboxWorld(spec) -> {graph, region, yards, harbours, spec, year}`), `mesh.js` (`buildGreyboxMesh`), `main.js` and `greybox.html`.
- Entry: `http://localhost:5210/games/delivery-driver/greybox/greybox.html` (`?piece=<id>`, `?year=`, `?view=low`); free camera (drag, WASD, Q/E, wheel/pinch, piece buttons). Not linked from the game (grep clean).
- For Phase 7: edge tags are the spec road ids (`edge.tag`, e.g. `overbridge-over`), junction node tags `crossroads`/`tee`/`roundabout`; the bridge is `overbridge-over` (deck 110 to 170 m, top 6.1 m) over `overbridge-under`; edges have flat `z` (4 m step), no `spans`, so use `edge.zones` for deck runs. The stand-in region is flat, so no terrain checks beyond that.
- Verification: page renders all six pieces, 0 console errors (a favicon 404 was fixed with an inline icon); screenshots `_docs/qa/greybox/greybox-overview.png` and `greybox-overbridge.png`; `npm test` 452 pass, 0 fail. Dev server restarted on 5210.

## Phase 7: Validator and drive-through tests on greybox
Status: Complete
Depends on: 6
Files: `scripts/validate-roads.mjs`, `tests/js/greybox-drive.test.mjs` (new), `tests/e2e/` (drive test, if the Playwright config needs it)
Model: sonnet
Effort: medium

- ✅ Extend `scripts/validate-roads.mjs` to take a `--greybox` flag and check the greybox spec: same-layer overlaps, roundabout arms missing the ring, bridges lacking clearance
  - **Note:** new exported `validateGreybox()` reuses `validateGraph`; deck `zones` are mapped to bridge `spans` in the validator only (graph.js untouched). `disconnected` and `dead-end` are ignored (pieces are separate by design); `--greybox` always exits 1 on a hard failure, and a hard `greybox-expectation` fires if the roundabout ring or the bridge clearance was not actually checked. Result: 0 issues.
- ✅ Add a drive-through test that drives a vehicle over and under the overbridge on the greybox, failing if it falls through, hits the deck, or the height jumps
  - **Note:** `tests/js/greybox-drive.test.mjs` drives the real `stepVehicle` with a pure-pursuit driver, both directions, with the Dart 3-ton and the tallest catalogue vehicle (3.8 m). Over: height within 0.3 m of the road profile, reaches deck height, height step under 0.2 m/m. Under: vehicle top below the deck underside (6.1 m minus 0.6 m slab, at least the 5.5 m rule), road below stays level.
  - **Assumption:** the plan 0009 helper `tests/js/helpers/drive-through.mjs` needs `slopeAt` and a baked terrain/layers, which the flat greybox world does not have, so the test uses the road profile (`roadHeightAt`/`roadGradeAt`) for ground height instead.
- ✅ Add a drive-through test that follows the curve and the roundabout without leaving the road surface
  - **Note:** curve: all four body corners within the edge half width (4 m) of the spline centreline. Roundabout: two entry/exit pairs (180 to 270 and 90 to 0 deg) round the 9 m ring; every corner must lie inside the layout boundary polygon or an arm strip. Both rigs pass (15 tests total).

### Verification Plan
- `node scripts/validate-roads.mjs --greybox` exits 0
- `node --test tests/js/greybox-drive.test.mjs` passes
- `npm run test:e2e` passes the greybox drive test

### Phase Summary
- Added `validateGreybox()` and `--greybox` to `scripts/validate-roads.mjs` (reuses `validateGraph`; deck zones become bridge spans in the validator only; ignores disconnected/dead-end; exits 1 on any hard failure or when the ring or bridge was not actually checked), `tests/js/greybox-drive.test.mjs` (15 tests: real `stepVehicle` + pure-pursuit driver, two rigs, over/under the bridge both ways, curve, two roundabout routes) and `tests/e2e/greybox-drive.spec.mjs` (page renders with no console errors, then drives over and under the bridge in the browser).
- For Phase 8: `validateGreybox` and the `drive()`/`worstCornerGap` helpers in the test are the reference checks to apply to the real map; the plan 0009 helper `helpers/drive-through.mjs` already covers real-map crossings (needs `slopeAt`/baked layers, which the greybox lacks).
- Verification: `node scripts/validate-roads.mjs --greybox` exit 0 (0 issues); `node --test tests/js/greybox-drive.test.mjs` 15 pass, 0 fail; `npm test` 467 pass, 0 fail (452 + 15); greybox e2e spec passes; dev server on 5210 restarted and serves the greybox page (200).
- Note: full `npm run test:e2e` is 108 pass, 4 fail, all in the existing real-map `tests/e2e/delivery-driver.spec.mjs` (webgl terrain/roads draw-call budget, minimap and full map x2, layered-roads bridge drive: the vehicle never reached the crossing beneath). None touch files changed in this phase; not investigated here, so Phase 8 should check whether they are pre-existing or due to phases 2 to 5 / the uncommitted `world/terrain.js`.

## Phase 8: Apply checks to the real map
Status: Complete
**Assumption:** marked Complete although `npm run test:e2e` is not fully green: the 3 remaining failures are identical at the pre-plan commit `9b26550`, so they are not caused by this plan (see summary). They are carried into the Final Recap as a known issue.
Depends on: 7
Files: `scripts/validate-roads.mjs`, `scripts/qa-screenshots.mjs`, any road-mesh fix found by the checks
Model: sonnet
Effort: medium

- ✅ Run the greybox validator and drive-through checks against the real map region
  - **Note:** `node scripts/validate-roads.mjs --strict` (exeter, plymouth, truro, penzance, 2024) and with `--baked`: 0 hard failures, no `overlap-same-layer`, no `roundabout-arm-gap`, no `bridge-clearance` (only soft sharp-angle/no-priority/odd-degree/junction-cluster/roundabout-crowded as before). The real-map drive-through (plan 0009 `helpers/drive-through.mjs`) runs in `npm test`.
- ✅ Fix any real-map failure that the greybox check now catches (record each fix as an item in the phase summary)
  - **Note:** the checks found nothing to fix (0 hard failures, no overlap, no missing roundabout arm); no road-mesh change was made in this phase.
- ✅ Take before and after screenshots of the three worst junctions and bends (`node scripts/qa-screenshots.mjs`), and save to `_docs/qa/spline-roads/`
  - **Assumption:** "worst" = the script's roundabout, M5 interchange and flyover spots (2024). Before = commit `9b26550` (pre-plan) served from a scratch worktree on port 5212 via the script's `--url`; after = the working tree on 5210. `qa-screenshots.mjs` was not edited.

### Verification Plan
- `node scripts/validate-roads.mjs` reports no overlap and no missing roundabout arm on the real map
- `npm test` and `npm run test:e2e` both pass
- Restart the dev server on port 5210 and confirm the game loads with no console errors

### Phase Summary
- Ran the validator on the real map (`node scripts/validate-roads.mjs --strict`, and `--baked --strict`): 0 hard failures, no overlap, no missing roundabout arm, no clearance issue; so no road-mesh fixes were needed or made. `npm test`: 467 pass, 0 fail. Before/after screenshots (roundabout, M5 interchange, flyover; 2024) in `_docs/qa/spline-roads/` (`before-*.png` = pre-plan commit `9b26550`, `after-*.png` = working tree; 0 console errors; `places.json` lists the spots).
- Baseline check of the 4 e2e failures (scratch worktrees, port 5212, removed afterwards): at `a239880` without the uncommitted `terrain.js` only 3 fail (both map tests, layered-roads bridge drive); at pre-plan `9b26550` the same 3 fail with identical numbers, so those 3 are PRE-EXISTING and not caused by this plan. The draw-call-budget test (`delivery-driver.spec.mjs:45`) passed on the baseline and on a rerun of the working tree, so it is flaky under load, not a regression. The full e2e run on the working tree: 107 pass, 5 fail (the 3 pre-existing, plus that budget test and `phone-fit.spec.mjs:106` 390x844, both of which pass when rerun alone, 9 of 9).
- Verification NOT fully passed: `npm run test:e2e` still has the 3 pre-existing failures (map minimap/full map x2: full map colours 1 instead of over 8; bridge drive never reaches the crossing beneath), which belong to the real-map work before this plan and are left unfixed. Dev server on 5210 serves the game (200) and the screenshot run showed 0 console errors.

## Final Recap
Roads are now built from smooth splines instead of 4 m chords. Phase 2 added `world/road-spline.js` (centripetal Catmull-Rom, arc-length sampling, adaptive 1 to 4 m spacing, roundabout arcs). Phase 3 moved surface, kerbs, pavements, markings, zebras and decks onto spline frames. Phase 4 made junction arms, roundabout rings and flared entries follow the edge spline. Phase 5 gave each road layer its own height step and per-layer polygon offset to stop flicker. Phase 6 added a dev-only greybox page (`greybox/greybox.html`, six pieces from a code spec). Phase 7 added `validate-roads.mjs --greybox` and drive-through tests (15 unit tests plus an e2e spec). Phase 8 ran the same checks on the real map: 0 hard failures, no overlaps, no missing roundabout arms, so no fixes were needed; before/after screenshots are in `_docs/qa/spline-roads/`. No C#/.NET types changed, so code docs were not refreshed.

**Final state:** `npm test` 467 pass, 0 fail.

**Known issues / not done:**
- `npm run test:e2e` has 3 failures (map minimap, full map colours, layered-roads bridge drive) that also fail at the pre-plan commit `9b26550`; left unfixed. Two other e2e tests (draw-call budget, phone-fit 390x844) are flaky under load and pass alone.
- Flicker fix is verified only by still frames; confirm on the phone, including at distance.
- Junction layout cost: 2024 hull fallbacks 888 to 954 and ring-crowded rejects 43 to 50.
- Eras/colours, painted ground and save-format changes were out of scope.
- Uncommitted files from before the plan stay out of the phase commits: `.vscode/*`, `world/terrain.js`, plan 0009, `scripts/qa-screenshots.mjs`, plan 0010, and `_docs/qa/` (other than the phase 8 screenshots).

## Deployment Plan
1. Review the branch `feature/delivery-driver-spline-roads` (local commits only, nothing pushed). Decide what to do with the pre-existing uncommitted files listed above.
2. `npm test` (expect 467 pass) and `node scripts/validate-roads.mjs --strict` and `--greybox` (expect 0 hard failures).
3. `dotnet build Games.Client` (assets are fingerprinted), then restart the dev server on port 5210.
4. Test on the phone: drive a roundabout, the M5 interchange and a flyover; look for flicker at a distance and close up. Open `/games/delivery-driver/greybox/greybox.html` to check the six pieces.
5. When happy, push the branch and open a PR to `main`. The greybox page is dev-only and unlinked; it ships as static files with the client.
6. Follow up separately: the 3 pre-existing e2e failures, and apply spline geometry to any new baked data.
