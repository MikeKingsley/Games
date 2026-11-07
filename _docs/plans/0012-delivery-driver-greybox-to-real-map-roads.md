# Delivery Driver: bring real-map roads in line with the greybox

Bring the real map's roads, junctions and markings up to the greybox reference. Real map and greybox already share `render/gl/road-mesh.js` and the spline code, so the work is to find and fix where the real map still differs: flicker at distance, roads sinking or floating on slopes, junctions misaligned on slopes, and wrong markings or pavements. The loop is iterative: measure, fix, screenshot, review, repeat (at most 3 passes per visual phase). Geometry and visuals only: no baked-data format change and no vehicle AI change.

## Decisions & Answers

- **Q:** What should "updating the roads in the map from the greybox" change on the real map? (multi-select) — **A:** Visual parity; Terrain grading; Flicker and z-fighting; Junctions on hills.
- **Q:** The greybox has uncommitted work (rolling-hills terrain via `?terrain=rolling`, draped roads, top-down camera). Should it be part of this plan? — **A:** "Commit it first (Recommended)".
- **Q:** Which real-map areas and years must the roads be checked against? — **A:** "Default set (Recommended)": Exeter, Plymouth, Truro, Penzance at 2024 via `validate-roads.mjs --strict`, plus year-gate spot checks (1930 to 1975).
- **Q:** This will be iterative. How should each iteration end? — **A:** "Fixed iteration cap (Recommended)": each visual phase runs check, fix, screenshot until the checks pass, at most 3 passes; anything still failing is recorded as a known issue in the phase summary, not asked about.
- **Q:** Which symptoms have you actually seen on the real map that the greybox does not show? (multi-select) — **A:** Flicker at distance; Roads sink or float; Junctions misaligned on slopes; Markings or pavements wrong.
- **Q:** How do we decide a visual phase passes? — **A:** "Checks plus screenshots (Recommended)": `validate-roads.mjs --strict` exits 0 with no hard failures, and the agent reviews before/after screenshots of the affected spots and records what it saw. No pixel-diff threshold.
- **Q:** Should the e2e suite (`npm run test:e2e`) be a gate? — **A:** "Final phase only (Recommended)". Known failures from plan 0011 are not blocking; any new failure is a regression to fix.
- **Q:** Commit policy? — **A:** "Local commit per verified phase, never push (Recommended)".
- **Q:** Flicker at distance can come from the corridor LOD (roads swap between full and coarse detail as the camera moves) as well as depth fighting. Should the fix cover both? — **A:** "Both (Recommended)": fix depth fighting, and check the corridor LOD switch for visible pops; fix the pop if found.
- **Q:** Scope summary confirmed? — **A:** "Yes, write the plan (Recommended)".
- **Q (added during execution, phase 3 and 4 blockers):** May `world/terrain.js` be changed to fix grading along the spline and the junction trim landing? — **A:** "go for it". The coast-grid change already in that file stays uncommitted: the grading commit must stage only the grading hunks (via a patch applied to the index), never the coast-grid hunk.

**Assumptions (not asked; confirm if wrong):**
- Reference is the greybox. Where the greybox and the real map differ, the real map changes, not the greybox, unless the greybox itself is wrong (then record it in the phase summary).
- Terrain reference for hills: the greybox `?terrain=rolling` mode grades roads with the real `gradeRoads` (`world/terrain.js`). The flat mode drapes roads and is not a test of real grading.
- `world/terrain.js` has a small pre-existing uncommitted change (4 lines) that `greybox/graph.js` depends on through `gradeRoads`. It is committed with phase 1 only if `npm test` passes with it; this is the only pre-existing file that goes into a commit.
- Pre-existing unrelated uncommitted files stay out of every commit: `.vscode/launch.json`, `.vscode/tasks.json`, `Games.Client/wwwroot/games/delivery-driver/styles.css`, `ui/start.js`, `_docs/plans/0009-delivery-driver-road-geometry-overhaul.md`, `scripts/qa-screenshots.mjs` (do not edit it; write new scripts instead).
- Plan 0011 is complete and its code stays. Its known open items are carried here only where they are on the symptom list: the dual-flag two-way A/B assumption in `world/lane-profile.js` is reviewed in phase 5 and changed only if the screenshots show it wrong.
- Flicker fix uses existing layer offsets and polygon offset (plan 0010 phase 5); a new layer scheme is out of scope unless the measurements show the existing one cannot work.
- Baseline `npm test`: 487 pass, 0 fail (from plan 0011). Baseline e2e: 124 pass, 2 fail, both flaky under load (draw-call budget, `phone-fit` at 390x844); a new e2e failure is a regression.
- Phone check: the user tests on a phone. The dev server runs on port 5210 and is restarted after every change; after any `Games.Client` asset change, run `dotnet build Games.Client` first (assets are fingerprinted). Phone checks are listed in the Deployment Plan; they do not block phases.
- Known real-map status (from plan 0011 recap): the validator shows only soft issues (sharp-angle, no-priority, odd-degree, junction-cluster, roundabout-crowded). Those are not failures here.
- Screenshot output goes to `_docs/qa/roads-parity/`. Existing scripts `scripts/road-types-screenshots.mjs`, `scripts/junction-angles-screenshots.mjs` and `scripts/zfight-check.mjs` may be run; read their header comments for flags before use.

## For Future Agents
As work proceeds: set a phase's status to `In progress` when you start it and flip each item to `- ✅` as soon as it completes; when a phase is done, run its **Verification Plan**, write its **Phase Summary** (max ~5 lines), and set its status to `Complete` (`execute-plan` then makes a local checkpoint commit). If a verification fails, retry up to two times; if still failing, set the phase to `⛔` with a `**Blocked:**` note containing the output, and continue with phases that do not depend on it. For visual phases, the iteration cap is 3 passes; record unresolved items as known issues. Never ask the user questions; record any assumption inline. Never push. When all phases are done, fill in **Final Recap** and **Deployment Plan**.

Test commands in this repo: `npm test` (runs `tests/js/**/*.test.mjs`), `npm run test:e2e` (Playwright, final gate only), `node scripts/validate-roads.mjs --strict` (real map), `node scripts/validate-roads.mjs --greybox` (greybox). Greybox: `http://localhost:5210/games/delivery-driver/greybox/greybox.html` (`?piece=<id>`, `?terrain=rolling`, `?view=oblique`, `?year=`).

## Recommended Model

| Phase | Model | Effort | Why |
|---|---|---|---|
| 1 Commit greybox WIP | haiku | medium | Git staging and commits, running `npm test` |
| 2 Parity measurements and baseline | sonnet | medium | New read-only check script over existing world and mesh code |
| 3 Terrain: roads and ground agree on slopes | sonnet | medium | Height sampling follows existing `edge.z` and `groundZ` patterns |
| 4 Junctions and roundabouts on slopes | sonnet | medium | Node and arm height joins in existing `junction-layout.js` and `road-mesh.js` |
| 5 Markings and pavements match the rules | sonnet | medium | Audit and fix against existing `lane-profile.js` |
| 6 Flicker: depth and corridor LOD | sonnet | medium | Renderer offsets and LOD hysteresis already exist; tuning them |
| 7 Iterate: check, fix, screenshot across towns | sonnet | medium | Repeats the checks from phases 3 to 6 across the default set |
| 8 Final gates and recap | haiku | medium | Runs the test gates and writes the recap |

## Phase 1: Commit greybox WIP
Status: Complete
Depends on: none
Files: `Games.Client/wwwroot/games/delivery-driver/greybox/graph.js`, `greybox/main.js`, `greybox/mesh.js`, `greybox/terrain.js` (new), `world/terrain.js` (only if `npm test` passes with its pre-existing change)
Model: haiku
Effort: medium

- ✅ Confirm the branch is `feature/delivery-driver-spline-roads`; record `git status` in the phase summary
- ✅ Run `npm test` with the current working tree and record pass and fail counts; expect 487 pass, 0 fail
  - **Result:** 485 pass, 2 fail. Both are wall-clock budget assertions, not logic failures. See the Phase Summary.
- ✅ Review `git diff -- world/terrain.js` (4 lines); if `npm test` passes, stage it with the greybox files
  - **Note:** the diff is not a greybox change. It changes the coast lookup grid (`GRID` 512 to 1024, `COARSE_CELL` 24 to 48, for the 1:4 map). Since `npm test` does not pass, it is not staged.
- ✅ Stage only `greybox/graph.js`, `greybox/main.js`, `greybox/mesh.js`, `greybox/terrain.js` and (if confirmed) `world/terrain.js`; leave every file listed under Assumptions out
  - **Decision (user, after the failure):** `world/terrain.js` left out of the commit. Also staged: `tests/js/delivery-driver.road-mesh.test.mjs` and `tests/js/delivery-driver.junction-layout.test.mjs`, the two budget loosenings that make `npm test` pass (user decision 1: loosen the budget).
- ✅ Commit with message `Plan 0012 phase 1: greybox rolling terrain, graded roads and timing budgets` (commit `d33f7ba`), ending with the attribution lines from the system reminder
- ✅ Restart the dev server on port 5210 and confirm `http://localhost:5210/games/delivery-driver/greybox/greybox.html?terrain=rolling` returns 200
  - **Note:** nothing was listening on 5210 at the start, so the server was started fresh after `dotnet build Games.Client`. `/play/delivery-driver` and the greybox route both return 200.

### Verification Plan
- `git log -1 --oneline` shows the phase 1 commit: `d33f7ba` ✅
- `git status --short` no longer lists the four greybox files: ✅ (`world/terrain.js` is still modified, as decided)
- `npm test` 487 pass, 0 fail: ✅ (487 pass, 0 fail, after loosening two budgets; the first run had 485 pass, 2 fail)
- `node scripts/validate-roads.mjs --greybox` exits 0: ✅ (exit 0, 0 hard failures)

### Phase Summary
- Commit `d33f7ba`: greybox rolling terrain (`?terrain=rolling`, roads graded by the real `gradeRoads`) and the `?cam=` exact camera, plus two loosened timing budgets. `npm test` 487 pass, 0 fail. Greybox validator exit 0 (76 nodes, 55 edges, 0 overlaps).
- Budgets loosened, on user decision: road-mesh edge build `3000 * TRIP_RATE` to `10000 * TRIP_RATE` (measured about 21 s against the old 9.75 s); junction layout 5 s to 15 s (measured 6 s under load, passes alone).
- Left uncommitted on user decision: `world/terrain.js` (coast grid `GRID` 512 to 1024, `COARSE_CELL` 24 to 48). Review it separately before any real-map phase relies on it.
- Dev server on port 5210 started after `dotnet build Games.Client`; `/play/delivery-driver` and the greybox route return 200.

## Phase 2: Parity measurements and baseline
Status: Complete
Depends on: 1
Files: `scripts/roads-parity-check.mjs` (new), `_docs/qa/roads-parity/` (new output folder)
Model: sonnet
Effort: medium

- ✅ Add `scripts/roads-parity-check.mjs` (new file; do not edit `scripts/qa-screenshots.mjs`) that loads the default-set towns (Exeter, Plymouth, Truro, Penzance at 2024) and reports, per edge and per junction: road surface height vs ground height under it (sink or float, in metres), junction node height vs its arm heights (mismatch), and marking and pavement presence vs the `laneProfile` rules
- ✅ Add a `--json` output and a `--out <dir>` option, writing to `_docs/qa/roads-parity/baseline.json`
- ✅ Add a short header comment listing its flags (same style as `scripts/validate-roads.mjs`)
- ✅ Run it and record the counts per check in the phase summary as the baseline
- ✅ Take a baseline set of real-map screenshots at the worst spots reported (the same spots the user saw), saved as `_docs/qa/roads-parity/before-*.png`, using the existing screenshot scripts for the camera setup
  - **Assumption:** the user's own spots are unknown, so the spots are the worst ones from `baseline.json` (all Exeter, 2024): `before-sink-float.png` (edge 18725, tilt 55), `before-junction-slope.png` (roundabout node 25670, tilt 55), `before-marking-pavement.png` (edge 18748 pavement missing, top-down), `before-flicker.png` (A-road strip at 34041,-11333 with pavement-extra, tilt 30, zoom 4: a distance view; flicker is not measured by the check, so this is a candidate spot, not a confirmed one). Camera setup reused from `scripts/road-types-screenshots.mjs` (`__dd.teleport`, `camera.tilt`, `camera.zoomIndex`) via a scratch script outside the repo.

### Verification Plan
- `node scripts/roads-parity-check.mjs --json --out _docs/qa/roads-parity` exits 0 and writes `baseline.json` with non-empty results for all four towns
- `npm test` 487 pass, 0 fail (no regression from the new script)
- Screenshot folder contains at least one `before-*.png` per symptom listed in the plan (flicker, sink or float, junction on slope, marking or pavement)

### Phase Summary
- `scripts/roads-parity-check.mjs` (read-only; flags `--area --year --radius --step --tol --json --out`) writes `_docs/qa/roads-parity/baseline.json` (7 s run). Assumptions: ground = exact `groundZ(...,false)` not the chunk mesh grid; marking/pavement rules re-derived from `road-mesh.js` + `laneProfile`, not from vertices. Tol 0.15 m.
- Baseline per town (Exeter / Plymouth / Truro / Penzance). Sink/float samples float: 2942 / 2223 / 3836 / 2821; sink: 1667 / 659 / 2159 / 1715 (max float 6.8 / 13.4 / 9.4 / 23.9 m, max sink 6.9 / 4.2 / 8.3 / 2.0 m; many are at crossings or deck approaches, to triage in phase 3). Junction arms off > 0.15 m: 176 of 1127 / 117 of 1473 / 96 of 635 / 171 of 572 (max 1.9 / 3.2 / 1.8 / 1.8 m).
- Marking/pavement (all pavement; no centre-line, divider or edge-line mismatches): extra 28 / 62 / 10 / 12, missing 92 / 75 / 39 / 40.
- Screenshots: four `before-*.png` (sink-float, junction-slope, marking-pavement, flicker). `npm test` 487 pass, 0 fail.

## Phase 3: Terrain: roads and ground agree on slopes
Status: Complete
Depends on: 2
Files: `Games.Client/wwwroot/games/delivery-driver/render/gl/road-mesh.js`, `world/terrain.js` (only if the baseline shows the grading itself is at fault), `render/gl/terrain-mesh.js` (only if the ground mesh is at fault), `tests/js/delivery-driver.road-mesh.test.mjs`
Model: sonnet
Effort: medium

- ✅ Using the baseline from phase 2, find the edges where road surface height and ground height differ by more than the tolerance used by the check; record the cause for each group (sampling, grading, ground mesh, or cut and embankment) in the phase summary
  - **Result:** see Phase Summary. The road mesh matches its own graded profile (0 samples off by more than 0.02 m); causes are (a) the mesh follows the spline but grading and groundZ follow the polyline, (b) the ground mesh capped to the nearest (higher) road at crossings, (c) intended embankments at the kerb and pavement offsets.
- ✅ Fix the cause found: prefer aligning the road mesh sampling to `edge.z` and `roadHeightAt` over changing grading; change grading only if the baseline proves it is the cause
  - Fixed in `render/gl/terrain-mesh.js` (new `roadFloorNear`, replacing `roadDeckNear` for the ground cap): it walks the edge splines and takes the lowest deck within 6 m of the nearest road's, so the ground no longer hides the road. Updated `tests/js/delivery-driver.terrain-mesh.test.mjs` to use it (one import and one call).
  - **Blocked:** grading and `groundZ` along the spline instead of the polyline (the dominant cause of exact-ground sink/float on sparse lanes) needs `world/terrain.js`, which is held out of commits; not changed. Also edited `scripts/roads-parity-check.mjs` (phase 2's script) to add the `drawn` metric.
- ✅ Add a test in `tests/js/delivery-driver.road-mesh.test.mjs` for one sloped real-map edge: surface, kerb and marking heights stay within the tolerance of ground
  - Checks the surface, kerb and marking vertices against the graded profile (0.05 m) and the surface against exact ground (0.15 m) on a sloped edge whose spline stays within 0.5 m of its polyline.
- ✅ Add a `?terrain=rolling` greybox check that the same edge types in the greybox sit within tolerance (use `greybox/graph.js` `buildGreyboxWorld`)
  - Added in the same test file; all 55 greybox edges sit within 0.07 m of exact ground (spline deviation from the polyline 0 to 0.25 m).
- ✅ Restart the dev server on port 5210 after the change; run `dotnet build Games.Client` if any asset changed
  - Built and restarted; `/play/delivery-driver` returns 200 on the final code.

### Verification Plan
- `node scripts/roads-parity-check.mjs --json --out _docs/qa/roads-parity` shows the sink or float count reduced to 0 for the default set, or any remaining cases listed with their cause
- `npm test` passes, including the new test; no count below 487 pass
- `node scripts/validate-roads.mjs --strict` exits 0 with no hard failures
- Before and after screenshots of two sloped spots saved to `_docs/qa/roads-parity/terrain-*.png`; the agent records what changed in the phase summary

### Phase Summary
- Triage: the road mesh matches its own graded profile (0 samples off by over 0.02 m), so the baseline float/sink is not a mesh bug. Of the exact-ground centreline misses, ~95% (1123 of 1180 in Exeter) lie where the spline the mesh follows is over 2 m from the polyline that grading and `groundZ` use (sparse lanes, up to 42 m): a real defect, fix needs `world/terrain.js` (**Blocked**, held out). Kerb and pavement offsets are intended embankments/cuttings; the rest are crossings and ramps. Greybox edges (spline within 0.25 m) sit within 0.07 m of ground.
- Fixed: the ground mesh hid roads (cap used the nearest polyline road). `terrain-mesh.js` `roadFloorNear` walks the splines and holds the ground under the lowest deck within 6 m of the nearest. New `drawn` metric in the parity script (ground mesh as drawn, tol 0.15; gap threshold 0.36). Ground-hides-road samples Exeter/Plymouth/Truro/Penzance: 312/44/264/186 to 44/10/0/5 (806 to 59). Exact-ground float/sink unchanged (it depends on `groundZ`): 2942/2223/3836/2821 and 1667/659/2159/1715. Road-above-ground gap rose 11.6k to 14.5k samples (the spline-aware cap now lowers ground the polyline cap missed; embankment-like).
- Remaining: 59 ground-hides-road samples (lane beside a ramp over 6 m higher, edges 29607 and 11783), plus the spline/polyline grading mismatch above. Tests: `npm test` 489 pass, 0 fail; `validate-roads --strict` exit 0. Screenshots `terrain-{before,after}-slope{A,B}.png`: after, the lower ramp beside the A road is clean of ground patches.
- Files: `render/gl/terrain-mesh.js`, `tests/js/delivery-driver.road-mesh.test.mjs`, `tests/js/delivery-driver.terrain-mesh.test.mjs` (import swap), `scripts/roads-parity-check.mjs`, `_docs/qa/roads-parity/`.

## Phase 4: Junctions and roundabouts on slopes
Status: Complete
Depends on: 3
Files: `Games.Client/wwwroot/games/delivery-driver/world/junction-layout.js`, `render/gl/road-mesh.js` (junction surfaces, `buildNodeMesh`), `tests/js/junction-layout.test.mjs` (or the closest existing junction test)
Model: sonnet
Effort: medium

- ✅ Find where junction surface height comes from in `buildNodeMesh` (`node.z` vs arm `roadHeightAt`) and where the approach curves in `junction-layout.js` take their height; record the mismatch in the phase summary
  - `buildNodeMesh` draws the centre, ring islands and the stop lines of a roundabout from `node.z`; arm mouth corners take `roadHeightAt` of their own edge exactly and the rest blend (inverse distance). `junction-layout.js` takes no heights at all (plan-view only). The mismatch is arm height at the trim vs `node.z`: see the Phase Summary triage.
- ⛔ Make junction surfaces take heights from the same source as the arm and ring surfaces, so that a junction is flat where its arms meet it
  - **Blocked:** the surface already joins every arm exactly at its mouth; the remaining mismatch is the grading landing (`halfWidth + 2` m in `gradeRoads`, `world/terrain.js`) being shorter than the junction trim (6 to 25 m), so arms climb away from `node.z` before reaching the trim. Fixing it needs `terrain.js` (held out). A trial that drew the centre at the arm mean instead of `node.z` (added `armMouthHeights` and `junctionLevel` to `junction-layout.js`) fixed 113 pit/hump centres on paper but showed ground through a sloped roundabout ring (the ground pad is graded to `node.z`), so `road-mesh.js` was reverted; screenshots of the trial are `junction-trial-meanlevel-*.png`.
- ⛔ Make roundabout rings sample the ground under them, or the grade of their arms, so the ring is level and the arms join at the ring height
  - **Blocked:** same cause as above. A ring at the arm mean regressed visually (ground wedge through the ring at node 25698); a ring at `node.z` is level and matches the ground pad, so it stays. Needs the grading landing to reach the trim (`terrain.js`).
- ✅ Add a test for a sloped crossroads and roundabout: junction surface and arm ends agree within tolerance
  - `tests/js/delivery-driver.junction-layout.test.mjs` (the closest junction test): bowl and cross-slope crossroads and roundabouts; asserts arm mouth corners of `buildNodeMesh` sit at their arm's `roadHeightAt` within 0.15 m and `junctionLevel` is the arm mean (bowl cases: every arm within 0.15 m of it).
- ✅ Restart the dev server on port 5210 after the change
  - Built and restarted on the final code; `/play/delivery-driver` returns 200.

### Verification Plan
- `node scripts/roads-parity-check.mjs --json --out _docs/qa/roads-parity` shows the junction mismatch count at 0 for the default set, or lists the remaining cases with their cause
- `npm test` passes, including the new test; no count below 487 pass
- `node scripts/validate-roads.mjs --strict` exits 0; `roundabout-arm-gap` does not appear
- Before and after screenshots of one sloped crossroads and one sloped roundabout saved to `_docs/qa/roads-parity/junction-*.png`

### Phase Summary
- Triage (263 junction nodes with an arm off `node.z` by over 0.15 m, 4 towns, 2024): (a) surface centre off the arms' height 94 (arms agree but node.z off 20, node.z off the mean with arms differing 74); (a2) genuine slope between arms, node.z at their mean 96; (b) spline/polyline grading defect 19; (c) ramps, decks and structure zones 54 (intended). Cause of (a): grading's flat landing (`halfWidth+2` m) is shorter than the trim, so arms climb before the mouth.
- Before and after junction mismatch (arms off node.z by over 0.15 m, Exeter/Plymouth/Truro/Penzance): 176/117/96/171, max 1.9/3.2/1.8/1.8 m; after: unchanged (176/117/96/171). The real fix needs `world/terrain.js` (blocked), so the count is not reduced; the mesh change tried (centre and ring at the arm mean) fixed 113 centres on paper but showed the ground through a ring, and was reverted.
- Kept: `armMouthHeights` and `junctionLevel` in `junction-layout.js` (measurement helpers) and a new test. `npm test` 490 pass, 0 fail; `validate-roads --strict` exit 0, no `roundabout-arm-gap`. Screenshots `junction-before-{crossroads,roundabout}.png` (node 21076, 25698) and the reverted trial `junction-trial-meanlevel-*.png`; no after set since road-mesh is unchanged.
- Files: `world/junction-layout.js`, `tests/js/delivery-driver.junction-layout.test.mjs`, `_docs/qa/roads-parity/`.

## Phase 5: Markings and pavements match the rules
Status: Complete
Depends on: 4
Files: `Games.Client/wwwroot/games/delivery-driver/render/gl/road-mesh.js` (markings and pavements), `world/lane-profile.js` (only if the dual-flag assumption is shown wrong), `tests/js/lane-profile.test.mjs`, `tests/js/delivery-driver.road-mesh.test.mjs`
Model: sonnet
Effort: medium

- ✅ Run the marking and pavement part of the parity check (phase 2) and list each real-map road whose drawn markings or pavements differ from `laneProfile` (centre line, edge lines, passing places, lane dividers, pavement sides)
  - Only pavements differed (134 missing, 112 extra). Causes: bridge and tunnel decks (mesh draws parapets, no pavement), rural dual carriageways (mesh keeps a verge by design), and the check's own sampling of short edges (see summary).
- ✅ Fix the drawing so markings and pavements follow `laneProfile` on the real map, using the same code the greybox uses
  - No mesh change needed: `road-mesh.js` already follows `laneProfile`. The rule in `scripts/roads-parity-check.mjs` was wrong (see summary).
- ✅ Review the dual-flag two-way A or B assumption (plan 0011 follow-up) with the screenshots; change `world/lane-profile.js` only if a real two-way A or B road is shown to need a different rule, and record the evidence
  - Unchanged: no pavement or marking mismatch involves the dual flag (centre line, dividers, edge lines had 0 mismatches); the screenshot of a two-way A road shows a centre line and edge lines as expected. `lane-profile.js` not edited.
- ✅ Add or update a test per fixed case in `tests/js/delivery-driver.road-mesh.test.mjs`
  - Three tests: bridge deck has no pavement; rural dual keeps its verge and a spec of none wins; long town streets draw pavement by default, none for `none`, fewer strips for one side (the existing test already covers per-side placement). `tests/js/lane-profile.test.mjs` unchanged.
- ✅ Restart the dev server on port 5210 after the change
  - Nothing under `Games.Client` changed, so no rebuild was needed; the server on 5210 was left running and `/play/delivery-driver` returns 200.

### Verification Plan
- `node scripts/roads-parity-check.mjs --json --out _docs/qa/roads-parity` shows the marking and pavement mismatch count at 0 for the default set, or lists the remaining cases with their cause
- `npm test` passes, including the new tests; no count below 487 pass
- `node scripts/validate-roads.mjs --strict` exits 0
- Before and after screenshots of one single-track road, one two-way A road and one pavement-one-side road saved to `_docs/qa/roads-parity/markings-*.png`

### Phase Summary
- The mesh was right; the check's rule was wrong. Fixes in `scripts/roads-parity-check.mjs`: expected pavement is none on a bridge or tunnel deck and a verge on a rural dual carriageway without a spec; the strip survival test now uses the mesh's own trimmed samples (interpolated ends) and end-dropping, not the sparse sample count. Strips dropped because the whole side lies on another carriageway are counted as intended (`pavementBlocked`, 31 sides), not as mismatches.
- Pavement mismatches before and after (Exeter / Plymouth / Truro / Penzance): extra 28/62/10/12 to 0/0/0/0; missing 92/75/39/40 to 0/0/0/0. Centre line, dividers, edge lines, single-track centre line stay at 0. Dual-flag rule in `lane-profile.js` kept.
- `npm test` 493 pass, 0 fail; `validate-roads --strict` exit 0. Screenshots `markings-{single-track,two-way-A,pavement-one-side}.png` (no mesh change, so one set, no before/after pair; one-side is the greybox one-way-lane piece, as the real map has none).
- Files: `scripts/roads-parity-check.mjs`, `tests/js/delivery-driver.road-mesh.test.mjs`, `_docs/qa/roads-parity/`.

## Phase 6: Flicker: depth and corridor LOD
Status: Complete
Depends on: 5
Files: `Games.Client/wwwroot/games/delivery-driver/render/gl/road-mesh.js` (layer offsets), `render/gl/gl-renderer.js` (polygon offset), `render/gl/chunk-build.js` (corridor LOD, hysteresis in `lodWithHysteresis` and `roadLevelFor`), `tests/js/delivery-driver.road-mesh.test.mjs`
Model: sonnet
Effort: medium

- ✅ Run `node scripts/zfight-check.mjs` (read its header for flags) on the default set and record its output as the baseline in the phase summary
  - Baseline in the summary. The script covers the greybox only; the real map was measured with a scratch script (see summary).
- ✅ Find the cause of flicker: depth fighting between layers (surface, kerb, markings) at distance, and/or a visible pop when a chunk switches road detail level in the corridor LOD
  - Depth fighting is not measurable (greybox 0.02 to 0.46 percent, only edge shifts; real map nudge indistinguishable from scene noise). The corridor LOD is the likelier cause (whole chunks swap markings and pavements; band was +-40 m).
- ✅ Fix depth fighting with the existing layer offsets and polygon offset first; change the layer scheme only if the measurements show it cannot work
  - No scheme change needed. The offset formula moved into `road-mesh.js` as `layerPolygonOffset` (same values), used by `gl-renderer.js`, so a test can check it.
- ✅ Fix the corridor LOD pop if found: widen the hysteresis or fade the detail, not the whole LOD scheme
  - New `ROAD_HYSTERESIS` (half a chunk, 80 m each side; was 40 m) in `chunk-build.js`, used by `roadLevelFor` only. Ground LOD hysteresis (`lodWithHysteresis`) unchanged. **Assumption:** no fade, since the road shader has no alpha path; a pop of thin lines at 250 m or more is accepted.
- ✅ Add a test that the road layer offsets and the LOD switch level stay consistent for a given distance
  - Two tests at the end of `tests/js/delivery-driver.road-mesh.test.mjs`.
- ✅ Restart the dev server on port 5210 after the change
  - Built and restarted; `/play/delivery-driver` returns 200.

### Verification Plan
- `node scripts/zfight-check.mjs` output shows no new z-fight pairs versus the phase's baseline; any remaining pairs are listed with their cause
- `npm test` passes, including the new test; no count below 487 pass
- Frame-to-frame screenshots at three distances saved to `_docs/qa/roads-parity/flicker-*.png`, reviewed by the agent; the phase summary records what changed
- `node scripts/validate-roads.mjs --strict` exits 0

### Phase Summary
- Cause: depth fighting is not the flicker. `zfight-check` (greybox, 40 piece/terrain runs): flicker 0.02 to 0.46 percent of frame, the same before and after; the diff images show only 1-pixel edge shifts from the 1 cm nudge. Real map (scratch nudge script, node 25670, 3 distances): nudged diff 2.02/1.51/1.12 percent vs 1.94/1.46/1.10 static (no nudge), so scene noise, not depth. Layer steps already hold: polygon offset is in depth units, 2 apart per layer, at any range. Likelier cause is the corridor LOD: a whole 160 m chunk swaps markings and pavements together, on a +-40 m band.
- Fix: `ROAD_HYSTERESIS` = half a chunk (+-80 m) for the road detail edge only (`chunk-build.js`); drive test along a 6.8 km A road, 600 m forth and back, swaps 12/11 to 9/8, 60 m jitter 1 swap. `layerPolygonOffset` exported from `road-mesh.js` (same values). Not fixed: the pop itself remains (no fade path); the swap is at the chunk centre, so a chunk's near edge swaps about 100 m closer than the corridor reach.
- Before and after (real map after: nudged 2.02/1.65/1.33 vs static 1.91/1.57/1.33 percent, still within noise): z-fight pairs 0 before, 0 after; screenshots `_docs/qa/roads-parity/flicker-{before,after}-{near,mid,far}.png` look identical apart from traffic.
- Tests: `npm test` 495 pass, 0 fail; `validate-roads --strict` exit 0. Files: `render/gl/chunk-build.js`, `render/gl/road-mesh.js`, `render/gl/gl-renderer.js`, `tests/js/delivery-driver.road-mesh.test.mjs`, `_docs/qa/roads-parity/`.

## Phase 7: Iterate: check, fix, screenshot across towns
Status: Complete
Depends on: 6
Files: whichever of the phase 3 to 6 files the checks point to; `scripts/roads-parity-check.mjs`, `_docs/qa/roads-parity/`
Model: sonnet
Effort: medium

- ✅ Pass 1: run `node scripts/roads-parity-check.mjs --json --out _docs/qa/roads-parity` for the default set and `node scripts/validate-roads.mjs --strict`; list every remaining item and fix each with the smallest change
  - Nothing new and fixable: counts equal the phase 3 to 6 results (only the four known issues remain). Validator: 0 hard failures, soft issues only. No code changed.
- ✅ Pass 1: take after-screenshots of the worst spots per town (Exeter, Plymouth, Truro, Penzance) into `_docs/qa/roads-parity/after-*.png`; review them and record what is still wrong
- ✅ Spot-check the year gates at 1930, 1950 and 1975 on one junction per town (`?year=` on the greybox and the real map), and record any road type that appears at the wrong year
- ✅ Passes 2 and 3 (at most, stop early if clean): repeat the first two items for whatever is still failing; any item still failing after pass 3 is recorded as a known issue in the phase summary, not asked about
- ✅ Commit each pass that changed code as its own local commit `Plan 0012 phase 7 pass <n>: <what was fixed>`, ending with the attribution lines from the system reminder; never push
- ✅ Restart the dev server on port 5210 after each change; run `dotnet build Games.Client` if any asset changed
  - No code or asset changed, so no rebuild or restart; the server on 5210 stays up.

### Verification Plan
- `node scripts/roads-parity-check.mjs --json --out _docs/qa/roads-parity` shows no hard mismatch for the default set, or the remaining items are listed as known issues with their cause
- `node scripts/validate-roads.mjs --strict` exits 0 with no hard failures
- `npm test` 487 pass or more, 0 fail
- `_docs/qa/roads-parity/` holds before and after screenshots for each town and each year checked

### Phase Summary
- One pass, clean: no code changed (passes 2 and 3 not needed, so no phase 7 code commit). Parity check (rewrote `baseline.json`): markings extra/missing 0 in all towns; junction arms off 176/117/96/171; ground-hides-road and exact-ground float/sink as in phase 3. `validate-roads --strict` exit 0 (0 hard failures). `npm test` 495 pass, 0 fail.
- Screenshots in `_docs/qa/roads-parity/`: `after-{exeter,plymouth,truro,penzance}-{sink-float,junction}.png` (worst spots, matching the `before-*` set) and `year-{town}-{1930,1950,1975}.png` plus `year-greybox-roundabout-{1930,1950,1975}.png`, data in `year-gates.json`. Reviewed: remaining defects are the known ones (roundabout arms climbing at the mouth, ground steps beside a ramp); no new problems.
- Year gates (one roundabout per town, the Truro node is a plain give-way): real map is right: Exeter, Plymouth, Penzance roundabouts show as give-way at 1930 and 1950 and roundabouts from 1960 (seen at 1975); arm classes and profiles do not change between 1930 and 2024 except Penzance's arm to a `dual` carriageway at 2024 only. Wrong-year road type found: none on the real map. Greybox note: its `roundabout` piece shows a roundabout in 1950 (its spec has no year gate), so it is not a year-gate reference.
- Known issues left (unchanged, blocked on `world/terrain.js`): (1) grading and `groundZ` follow the polyline, not the spline; (2) junction arms climb at the trim; (3) LOD pop at the corridor band (no fade path); (4) 59 ground-hides-road samples beside a ramp over 6 m higher (edges 29607, 11783).

## Phase 9: Grading along the spline and junction landing (unblocks phases 3 and 4)
Status: Complete
Depends on: 7
Files: `Games.Client/wwwroot/games/delivery-driver/world/terrain.js` (grading hunks only), `tests/js/delivery-driver.terrain.test.mjs` (or the closest existing terrain test), `scripts/roads-parity-check.mjs` (only to re-measure), `_docs/qa/roads-parity/`
Model: sonnet
Effort: medium

- ✅ Make `gradeRoads` / `groundZ` sample the road's spline (as `edgeSpline` in `world/junction-layout.js` and `render/gl/road-mesh.js` do), not the raw polyline, so the graded profile matches the surface the mesh draws (phase 3 blocker: 1123 of 1180 Exeter centreline misses lie where spline and polyline are over 2 m apart)
  - **Assumption:** vehicles drive the baked polyline (sim unchanged), so `groundZ` reads the spline track for the ground mesh (`hint === false`) and both the spline and the polyline for vehicles and props; otherwise 121 drive-through crossings failed.
- ✅ Extend the flat landing at each junction to at least the junction trim (6 to 25 m), so arms do not climb away from node.z before the mouth (phase 4 blocker)
- ✅ Keep the coast-grid change (GRID 512 to 1024, COARSE_CELL 24 to 48) in place and out of the commit; stage only the grading hunks for the commit (write the grading hunks to a patch and `git apply --cached` it, then verify `git diff --cached -- world/terrain.js` shows no coast-grid lines)
- ✅ Add a test: on one sparse-lane edge the graded profile is within 0.05 m of the spline's own height; on one junction, arm mouth heights are within 0.15 m of node.z
- ✅ Rebuild and restart the dev server on 5210; confirm /play/delivery-driver returns 200

### Verification Plan
- `node scripts/roads-parity-check.mjs --json --out _docs/qa/roads-parity` shows the exact-ground sink/float counts and the junction mismatch counts (baseline 176/117/96/171 junction; float/sink baseline in the phase 2 summary) reduced, with before and after numbers in the phase summary
- `npm test` 495 pass or more, 0 fail
- `node scripts/validate-roads.mjs --strict` exit 0; `node scripts/validate-roads.mjs --greybox` exit 0
- `git diff -- world/terrain.js` still shows the coast-grid lines as uncommitted, and the staged diff contains only grading hunks

### Phase Summary
- `world/terrain.js`: `landUnder`/`townLength`/bridge test sample the edge's spline (`sampleRoad`); `setTrack` gives edges whose spline is over 0.25 m off the polyline a spline track (`zPts`, `zPtsCum`, in `graph.roadIndex`); `groundZ` (`nearestHits`), `roadDeckNear`, `tunnelFloorNear`, `decksAt` read it (the ground mesh on the track alone; vehicles and props on both track and polyline). Junction flat landing is each arm's layout trim (`armTrims`, years 1950 and 2100). Formats of `edge.z`, `zStep`, `zFill` unchanged. Coast-grid lines stay uncommitted.
- Exact-ground float/sink (Exeter/Plymouth/Truro/Penzance) 2942/2223/3836/2821 and 1667/659/2159/1715 to 1986/1604/1783/1742 and 958/431/1151/613. Junction arms off node.z 176/117/96/171 to 20/18/4/8. Ground-hides-road 59 to 50 (45/5/0/0).
- Tests: `npm test` 496 pass, 0 fail; `validate-roads --strict` and `--greybox` exit 0. New test in `delivery-driver.terrain.test.mjs`; two tests adjusted to the new geometry (bridge-over-water sampling uses the spline; the roundabout island test picks a ring with an island, the first one was a flat mini disc whose mesh only stood above the node because its arms used to climb).
- Known: the remaining float/sink is mostly kerb and pavement embankments, crossings and ramps; crossings are still found on polylines (`crossings.js`), so a deck zone can sit a few metres off the drawn spline on sparse edges.

## Phase 8: Final gates and recap
Status: Not started
Depends on: 7, 9
Files: `_docs/plans/0012-delivery-driver-greybox-to-real-map-roads.md`
Model: haiku
Effort: medium

- [ ] Run `npm run test:e2e` once (final gate) and record the pass and fail counts; compare with the baseline (124 pass, 2 fail, both flaky under load); any new failure is a regression and must be fixed or recorded as a blocker
- [ ] Run `npm test`, `node scripts/validate-roads.mjs --greybox` and `node scripts/validate-roads.mjs --strict` and record the results
- [ ] Run `dotnet build Games.Client`, restart the dev server on port 5210 and confirm `/play/delivery-driver` returns 200
- [ ] Fill in **Final Recap** and **Deployment Plan** with the actual results

### Verification Plan
- `npm run test:e2e` has no new failure versus the baseline (124 pass, 2 known flaky)
- `npm test` passes, 0 fail
- `node scripts/validate-roads.mjs --strict` and `--greybox` exit 0
- `dotnet build Games.Client` succeeds; `/play/delivery-driver` returns 200

### Phase Summary
_(write when phase completes)_

## Final Recap
_(write when all phases complete: summary of the entire piece of work)_

## Deployment Plan
_(write when all phases complete: step-by-step deployment instructions)_
