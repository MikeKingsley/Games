# Delivery Driver: road types, lane layouts, pavements and junctions

Add the road types a driver meets in the real world (single-track lanes with passing places, one-lane one-way, two-lane two-way, multi-lane one-way, asymmetric roads, with and without pavements) and the junction types (traffic lights, T-junctions with give-way, give-way lines, uncontrolled crossroads, four roundabout sizes, double roundabouts). Build and test them in the greybox page first, then apply them to the real map. Geometry and visuals only: vehicle AI is unchanged.

## Decisions & Answers

- **Q:** Where should the new road types and junctions first appear? — **A:** "Greybox first, then real map (Recommended)".
- **Q:** Which lane configurations should be supported? (multi-select) — **A:** "Single-track lane with passing places", "One lane, one way", "Two lanes, two way", "Multi-lane, one way". Also: "all these need different style too, not all 2 way roads have a white line in the middle of the road for example".
- **Q:** What does "asymmetric road" mean? — **A:** "Different lane count per direction (Recommended)".
- **Q:** Should vehicles drive on the new lane layouts, or is this geometry and visuals only? — **A:** "Geometry and visuals only (Recommended)".
- **Q:** Which roads get pavements (footways), and should it vary per road? — **A:** "Per road, from the existing data (Recommended)".
- **Q:** Which lines should each road type get? — **A:** "Choose markings per road in the spec".
- **Q:** Which junction types must the greybox show? (multi-select) — **A:** "Traffic lights (signal junction)", "T-junction with give-way", "Give-way lines on any junction", "Crossroads (4-way, uncontrolled)".
- **Q:** How many roundabout size tiers? — **A:** "Four tiers: mini, small, medium, large (Recommended)".
- **Q:** What is a "double roundabout"? — **A:** "Two roundabouts linked by a short road (Recommended)".
- **Q:** Where should per-road pavement flags come from for the real map (the baked OSM data has no sidewalk tags)? — **A:** "Derive from class and town (Recommended)" (no re-bake).
- **Q:** Should the new layouts follow the existing year rules (signals from 1935, roundabouts from 1960)? — **A:** "Yes, follow era rules (Recommended)".
- **Q:** Where should asymmetric lane counts come from for the real map (baked data has only oneway and dual flags)? — **A:** "Derive from class, oneway and dual (Recommended)".
- **Q:** How should traffic-light timing change? — **A:** "Keep the current two-phase timing (Recommended)" (18 s phases, as `SIGNAL_PHASE` in `traffic/traffic.js`).
- **Q:** Which git branch? — **A:** "Continue on current branch" (`feature/delivery-driver-spline-roads`).
- **Q:** Commit policy? — **A:** "Local commit per verified phase, never push (Recommended)".
- **Q:** If a phase's verification fails and cannot be fixed, what should happen? — **A:** "Retry twice, then block and continue (Recommended)".
- **Q:** Where should passing places go? — **A:** "Auto on the real map, spec in greybox (Recommended)": on the real map, single-track lanes longer than about 150 m get passing places about 100 m apart; in the greybox, the spec places them.
- **Q:** Proposed roundabout tier mapping (mini stays; small = lane, access, street, ring 4 to 7 m; medium = B and A, ring 4.5 to 11 m; large = dual and motorway, ring 8 to 14 m). Is that right? — **A:** "Yes, use this mapping (Recommended)".
- **Q:** Where should double roundabouts be joined? — **A:** "Greybox spec, and real map where two roundabouts are close (Recommended)": on the real map, two roundabouts within about 80 m with a road between them.
- **Q:** Is the full scope summary correct and complete? — **A:** "Yes, write the plan (Recommended)".

**Assumptions (not asked; confirm if wrong):**
- Real-map markings are rule-based from the lane layout (centre line only on two-lane two-way roads, edge lines on every carriageway); the greybox spec can override per road.
- Single-track lanes and one-way roads get edge lines only, with no centre line.
- Pavements are per road with a both / one side / none setting; on the real map they default to both sides for town, A and B roads and none for lanes and access roads.
- Asymmetric lane counts on the real map come from the class rules only (no per-direction tags). Asymmetric roads are therefore mainly greybox-built in this plan.
- The four roundabout tiers already exist in part: `RING_CLASS` in `world/junction-layout.js` has ranks 1 and 2 with the same numbers (small) and ranks 3 to 6 for medium and large. Phase 6 makes small and medium distinct and adds the large tier's visual difference, instead of building new ring logic.
- Double roundabouts reuse `layoutRing` for each ring and add a link road between the two; they are not a new junction kind in the sim.
- Give-way lines on any junction follow the existing `stopLines` rule (minor arms yield to the higher-ranked road); crossroads without lights or give-way show no line.
- Files that are uncommitted and pre-existing stay out of every phase commit: `.vscode/launch.json`, `.vscode/tasks.json`, `Games.Client/wwwroot/games/delivery-driver/world/terrain.js`, `_docs/plans/0009-delivery-driver-road-geometry-overhaul.md`, `scripts/qa-screenshots.mjs`, `_docs/plans/0010-delivery-driver-spline-roads-greybox.md`, `_docs/qa/greybox/`. Do not edit `scripts/qa-screenshots.mjs`; write new scripts instead.
- The baked map format is not changed in this plan (see the re-bake decisions above). If a later need requires new baked data, that is a follow-up plan.
- Dev server: start/restart on port 5210 after every change, because the user tests on a phone. After any `Games.Client` asset change, run `dotnet build Games.Client` first (assets are fingerprinted).
- The existing 4 e2e failures (map minimap, full map colours, bridge drive) fail at the pre-plan commit `9b26550`; they are known and not this plan's to fix. Record any new e2e failure as a regression.

## For Future Agents
As work proceeds: set a phase's status to `In progress` when you start it and flip each item to `- ✅` as soon as it completes; when a phase is done, run its **Verification Plan**, write its **Phase Summary** (max ~5 lines), and set its status to `Complete` (`execute-plan` then makes a local checkpoint commit). If a verification fails, retry up to two times; if still failing, set the phase to `⛔` with a `**Blocked:**` note containing the output, and continue with phases that do not depend on it. Never ask the user questions; record any assumption inline. When all phases are done, fill in **Final Recap** and **Deployment Plan**.

Test commands in this repo: `npm test` (runs `tests/js/**/*.test.mjs`), `npm run test:e2e` (Playwright), `node scripts/validate-roads.mjs` (overlap and roundabout checks; `--greybox` for the greybox spec, `--strict` for the real map), `node scripts/junction-layout-stats.mjs`. Greybox page: `http://localhost:5210/games/delivery-driver/greybox/greybox.html` (`?piece=<id>`).

Baseline at the start of this plan (from plan 0010): `npm test` 467 pass, 0 fail.

## Recommended Model

| Phase | Model | Effort | Why |
|---|---|---|---|
| 1 Baseline | haiku | medium | Running the existing test suite and recording counts |
| 2 Lane profile model | sonnet | medium | Pure logic that maps class, oneway, dual, pavement and spec flags to a lane profile |
| 3 Lane markings and pavements in the mesh | sonnet | medium | Extends the spline road mesh builders from plan 0010 |
| 4 Greybox spec for lane types and asymmetric roads | sonnet | medium | Adds pieces to the existing greybox spec and graph |
| 5 Junction layouts: lights, T-junction, give-way, crossroads | sonnet | medium | Pattern-following changes to the existing junction layout and stop lines |
| 6 Roundabout tiers and double roundabouts | sonnet | medium | Ring sizing exists; adds the tier split and the linked pair |
| 7 Years and real-map application | sonnet | medium | Wires the new rules into the real map graph and era gating |
| 8 Validation, drive checks and screenshots | sonnet | medium | Extends the validator and tests, and runs the real-map checks |

## Phase 1: Baseline
Status: Complete
Depends on: none
Files: git only
Model: haiku
Effort: medium

- ✅ Run `git status` and confirm the pre-existing uncommitted files listed in the assumptions are still uncommitted; record the output in the phase summary
  - **Assumption:** `Games.Client/wwwroot/games/delivery-driver/styles.css` and `Games.Client/wwwroot/games/delivery-driver/ui/start.js` are also modified now (not in the original exclusion list, not changed by planning). Treated as pre-existing user work: kept out of every phase commit.
- ✅ Confirm the branch is `feature/delivery-driver-spline-roads`
- ✅ Run `npm test` and record the pass and fail counts as the baseline

### Verification Plan
- `git rev-parse --abbrev-ref HEAD` prints `feature/delivery-driver-spline-roads`
- `npm test` completes; the counts are recorded (expect 467 pass, 0 fail as at plan 0010)

### Phase Summary
- Branch confirmed `feature/delivery-driver-spline-roads`. Baseline `npm test`: 467 pass, 0 fail, 0 cancelled (matches plan 0010).
- Uncommitted at start (keep out of phase commits): `.vscode/launch.json`, `.vscode/tasks.json`, `world/terrain.js`, `styles.css`, `ui/start.js`, plan 0009, plan 0010 (untracked), plan 0011 (untracked), `_docs/qa/greybox/`, `scripts/qa-screenshots.mjs`.
- Git-only phase, no commit.

## Phase 2: Lane profile model
Status: Complete
Depends on: 1
Files: `Games.Client/wwwroot/games/delivery-driver/world/lane-profile.js` (new), `tests/js/lane-profile.test.mjs` (new)
Model: sonnet
Effort: medium

- ✅ Add `world/lane-profile.js` exporting `laneProfile(edge, year, overrides?)` that returns `{ lanesFwd, lanesBack, singleTrack, passingPlaces, centreLine, edgeLines, pavements: {left, right}, width }`
- ✅ Define the four lane types: single-track with passing places (`singleTrack: true`, one shared lane), one lane one-way, two lanes two-way (`centreLine: true`), multi-lane one-way (`lanesFwd >= 2`, `lanesBack: 0`)
- ✅ Support asymmetric lane counts: `lanesFwd` and `lanesBack` can differ (e.g. 2 up and 1 down) and the rule comes from class, `oneway` and `dual` (no per-direction tags)
- ✅ Support pavements per road: `pavements` is `both`, `left`, `right` or `none`, defaulting from class and town (town, A and B: both; lane and access: none)
- ✅ Support spec overrides: any field may be set by the greybox spec and wins over the derived value
- ✅ Add `tests/js/lane-profile.test.mjs` with one case per lane type, the asymmetric case, the pavement defaults and an override case

### Verification Plan
- `node --test tests/js/lane-profile.test.mjs` passes all cases
- `npm test` passes with no new failures versus the Phase 1 baseline

### Phase Summary
- Added `world/lane-profile.js` (`laneProfile`, `pavementSides`, `defaultPavement`, `PAVEMENT_MODES`) and 8 tests; no other file touched.
- Rules: two-way `lane` = single track (1 shared lane, passing places); one-way = lanesFwd 1 (2 if `dual` flag; class lanes for dual/M); two-way A/B with `dual` flag = 2 fwd / 1 back (assumption); centre line only on plain 1+1 two-way. Edge lines always on.
- Pavements default: both for A, B, street; dual only in town; none for lane, access, M, ferry. Overrides may give `pavements` as mode string or `{left,right}`; result is always `{left,right}`.
- Verification: lane-profile test 8 pass, 0 fail; `npm test` 475 pass, 0 fail (467 + 8).

## Phase 3: Lane markings and pavements in the mesh
Status: Complete
Depends on: 2
Files: `Games.Client/wwwroot/games/delivery-driver/render/gl/road-mesh.js`, `tests/js/delivery-driver.road-mesh.test.mjs`
Model: sonnet
Effort: medium

- ✅ In `road-mesh.js`, draw the centre line only when `laneProfile().centreLine` is true (single-track and one-way roads get none)
- ✅ Draw edge lines on every carriageway, using the profile's `edgeLines` setting
  - **Assumption:** lanes and yard accesses stay unmarked by default (existing test, real-map look); they get edge lines only when `edge.profile` (a spec override) is set. Phase 7 decides the real-map default.
- ✅ Draw passing-place bays on single-track roads: a widened strip on the verge at the profile's `passingPlaces` positions, with an edge-line break
  - **Assumption:** `profile.passingPlaces` is `true` (auto: about 100 m apart on edges over 150 m) or an array of metres along the edge; bays are 12 m x 2.6 m on the left verge.
- ✅ Draw lane dividers on multi-lane one-way roads (between lanes, not a centre line)
- ✅ Build pavements per side from `profile.pavements`: kerb and pavement strips only on the chosen sides, reusing the existing pavement layer (`LAYER.pavement`)
  - **Assumption:** `edge.profile` carries spec overrides into `laneProfile`; rural dual carriageways keep their legacy verge unless a profile is set (profile default is none there). Left of travel is the -1 offset side.
- ✅ Keep the existing `DETAIL` levels working (coarse skips passing-place bays and lane dividers)
- ✅ Add a test: a two-way road has one centre line; a single-track road has none; a one-way road has none; a pavement-on-one-side road has pavement strips on that side only

### Verification Plan
- `npm test` passes, including the new road-mesh tests
- `node scripts/validate-roads.mjs --greybox` still exits 0 (run after Phase 4 too)
- Greybox screenshot of one single-track and one two-way road saved to `_docs/qa/road-types/phase3-*.png`, 0 console errors

### Phase Summary
- `road-mesh.js` now reads `laneProfile(edge, year, edge.profile)`: centre line only if `centreLine`, edge lines from `edgeLines` (left line breaks at bays), passing-place bays (basic+), lane dividers on multi-lane roads (dashes; solid where fwd/back meet), pavements per side (left = -1 offset). Defaults for ordinary roads unchanged.
- Phase 4 spec must set `edge.profile` (graph.js does not copy it yet) and a `lane` class for single-track pieces; a mesh.js/graph.js hook was route-injected for the screenshot only.
- Verification: `npm test` 478 pass, 0 fail (475 + 3 new); `validate-roads.mjs --greybox` exit 0; screenshots `_docs/qa/road-types/phase3-two-way.png`, `phase3-single-track.png`, 0 console errors (dev server restarted on 5210).

## Phase 4: Greybox spec for lane types, asymmetric roads and junctions
Status: Complete
Depends on: 3
Files: `Games.Client/wwwroot/games/delivery-driver/greybox/spec.js`, `greybox/graph.js`, `greybox/mesh.js`, `greybox/main.js` (piece buttons)
Model: sonnet
Effort: medium

- ✅ Add greybox pieces: `single-track` (lane with two passing places), `one-way-lane` (one lane one-way), `two-way` (two lanes two-way, the existing baseline), `multi-one-way` (three lanes one-way), `asymmetric` (2 lanes up, 1 lane down, with a climbing lane)
  - **Assumption:** pieces sit in two new grid rows (y = 600 and 900) at the existing 300 m spacing, so `PIECE_SPACING` is unchanged; the overview camera moved back to y 760, z 560. Piece ids are `single-track`, `one-way-lane`, `two-way`, `multi-one-way`, `asymmetric`, `no-pavement`.
- ✅ Add a pavement variant to the `two-way` piece (`pavements: 'both'`) and to a `no-pavement` piece (`pavements: 'none'`)
- ✅ Let each road in the spec set its own marking types and pavement setting, overriding the rule-based defaults from Phase 2
- ✅ Pass the spec's fields through `graph.js` into the edge so `laneProfile()` sees them as overrides
- ✅ Update the piece buttons in `greybox/main.js` and the grid spacing in `PIECE_SPACING` so the new pieces do not overlap
- ✅ Keep the six existing pieces unchanged so Phase 7 of plan 0010 still passes

### Verification Plan
- `node scripts/validate-roads.mjs --greybox` exits 0 with the new pieces
- `node --test tests/js/greybox-drive.test.mjs` still passes (15 tests, as at plan 0010)
- Greybox page renders each new piece (`?piece=<id>`) with 0 console errors (Playwright); screenshots saved to `_docs/qa/road-types/` with names `greybox-<id>.png`

### Phase Summary
- Spec gained six straight-road pieces (single-track with passing places at 60 and 140 m, one-way lane, two-way + pavements, three-lane one-way, asymmetric 2+1, no-pavement); each road carries `oneway/dual/town` and a `profile` override object (markings, pavements, lane counts). `graph.js` now copies `oneway`, `dual`, `town`, `profile` onto the edge, so `road-mesh.js` sees them. Six original pieces untouched.
- Later phases: junction pieces (Phase 5/6) can add their own pieces/rows below row 3 (y >= 1200); pieces are buttons automatically from `spec.pieces`.
- Verification: `validate-roads.mjs --greybox` exit 0 (21 edges, no issues); greybox-drive 15 pass; `npm test` 478 pass, 0 fail; each new piece 0 console errors, screenshots `_docs/qa/road-types/greybox-<id>.png` (dev server rebuilt and restarted on 5210).

## Phase 5: Junction layouts: lights, T-junction, give-way, crossroads
Status: Complete
Depends on: 3
Files: `Games.Client/wwwroot/games/delivery-driver/world/junction-layout.js` (`layoutPlain`, stop-line code near line 646), `Games.Client/wwwroot/games/delivery-driver/render/gl/road-mesh.js` (`buildNodeMesh`)
Model: sonnet
Effort: medium

- ✅ Signal junction layout: stop lines on every arm that has a signal group, signal poles at the corners, two-phase timing unchanged (`SIGNAL_PHASE` 18 s)
- ✅ T-junction with give-way: give-way lines (dashed) on the minor arm only, with the triangle marking, using the existing `stopLines` rule
  - **Assumption:** the existing `markStops` rule already produced stop lines, poles and give-way lines, so `junction-layout.js` is unchanged; the new work is the give-way triangle in `road-mesh.js` (`addStopLines`, plain junctions only) and spec pieces.
- ✅ Give-way lines on any junction: a plain or crossroads junction gets give-way lines on arms that yield (the rule in `stopLines`), not only on T-junctions
- ✅ Uncontrolled crossroads: four arms, no lights, no give-way lines, same spacing as the other layouts
- ✅ Greybox pieces for each: `signals-cross`, `tee-give-way`, `give-way-cross`, `crossroads-plain` (add to `greybox/spec.js`)
  - **Assumption:** `graph.js` now passes an optional `priority` flag from the spec's junction onto the node (needed because the graph rule gives no priority to an A-B-A tee); the uncontrolled crossroads uses `priority: false`. Greybox row 4 (y = 1200), columns 0 to 3.
- ✅ Add a test in `tests/js/delivery-driver.junction-layout.test.mjs`: each new junction type produces the expected stop-line kinds (`stop`, `giveway`, none) and each arm has a mouth

### Verification Plan
- `npm test` passes, including the new junction tests
- `node scripts/junction-layout-stats.mjs` runs without error and reports no arm missing its junction
- `node scripts/validate-roads.mjs --greybox` exits 0
- Greybox screenshots of the four new junctions saved to `_docs/qa/road-types/junction-<id>.png`, 0 console errors

### Phase Summary
- Existing `markStops` already gave signals stop lines + poles and minor arms give-way lines, so layout code is unchanged (`SIGNAL_PHASE` untouched). Added the give-way triangle to `road-mesh.js` `addStopLines` (plain junctions, not rings) and four greybox pieces (`signals-cross`, `tee-give-way`, `give-way-cross`, `crossroads-plain`, row y = 1200); `graph.js` passes a junction `priority` flag.
- Later phases: spec junctions may carry `priority`; new test covers stop-line kinds (4 stop + 4 poles, 1 giveway, 2 giveway, none) and arm mouths.
- Verification: `npm test` 479 pass, 0 fail; stats script ran (NaN 0, exceptions 0, no missing arms); `validate-roads.mjs --greybox` exit 0 (no issues); screenshots `_docs/qa/road-types/junction-<id>.png` x4, 0 console errors (dev server restarted on 5210).

## Phase 6: Roundabout tiers and double roundabouts
Status: Complete
Depends on: 5
Files: `Games.Client/wwwroot/games/delivery-driver/world/junction-layout.js` (`RING_CLASS`, `layoutRing`), `Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js` (node junction typing), `Games.Client/wwwroot/games/delivery-driver/greybox/spec.js`
Model: sonnet
Effort: medium

- ✅ Make the four tiers distinct: mini (existing `node.mini`), small (rank 1 to 2, ring 4 to 7 m), medium (rank 3 to 4, ring 4.5 to 11 m), large (rank 5 to 6, ring 8 to 14 m), per the confirmed mapping. Ranks 1 and 2 currently share numbers, so give small its own visible difference (e.g. a smaller island radius range) and record the change
  - **Assumption:** mapping already matched the existing ranks 3 to 6 numbers. Only change: rank 1 (lane, access) `RING_CLASS[1]` is now `{min 4, max 6, width 6.5}` (was 4 to 7, width 7); rank 2 (street) unchanged at 4 to 7, width 7. Added `RING_TIER_RANK`, `ringTierOf` and a `ringClass(node, rank)` helper in `junction-layout.js`; roadgraph.js untouched.
- ✅ Add a `tier` override on a roundabout node in the spec, which wins over the rank-derived tier
  - **Assumption:** `node.tier` ('small' | 'medium' | 'large') maps to representative ranks 2, 4, 5 (`RING_TIER_RANK`); added to the layout cache signature and quick-cache check; `graph.js` passes `tier` and `ringRadius` from the spec junction.
- ✅ Add a double roundabout: two `layoutRing` rings joined by a link road of 20 to 60 m, with the link road's two arms each meeting their own ring at the matching tangent
  - **Assumption:** no new layout code: two ordinary ring nodes (50 m apart, `DOUBLE_LINK`) with an A-road link edge; each ring's `layoutRing` already joins its arms at the matching tangent. Real-map double detection is left to Phase 7.
- ✅ Greybox pieces: `roundabout-small`, `roundabout-medium`, `roundabout-large`, `roundabout-double` (add to `greybox/spec.js`)
  - **Assumption:** row 6 (y = 1500), columns 0 to 3; small/medium/large use street/B/dual arms plus an explicit `tier`; double rings use `tier: 'medium'`.
- ✅ Add a test: each tier's ring radius is inside its range; the double roundabout's link arms meet both rings within 0.1 m (reuse the join test pattern from plan 0010 Phase 4)

### Verification Plan
- `npm test` passes, including the tier and double roundabout tests
- `node scripts/validate-roads.mjs --greybox` exits 0; `roundabout-arm-gap` and `roundabout-crowded` are not raised for the new pieces
- Greybox screenshots of the four roundabout pieces saved to `_docs/qa/road-types/roundabout-<tier>.png`, 0 console errors

### Phase Summary
- Tiers: mini unchanged; small = rank 1 to 2, medium 3 to 4, large 5 to 6 (numbers matched the confirmed mapping). Only visible change: rank 1 ring is 4 to 6 m island, 6.5 m wide (rank 2 stays 4 to 7, 7 m). Node `tier` override (`small|medium|large`) wins over rank; `graph.js` passes `tier`/`ringRadius` from spec junctions.
- Double roundabout = two ring nodes 50 m apart plus a link road (no new layout code); pieces `roundabout-small|medium|large|double` in row y = 1500. Tests added in `delivery-driver.junction-layout.test.mjs` (tier ranges, double link joins within 0.1 m).
- Later phases: real-map double detection (rings within ~80 m) is still to do in Phase 7; `roadgraph.js` not touched.
- Verification: `npm test` 481 pass, 0 fail; `validate-roads.mjs --greybox` exit 0 (no issues); 4 screenshots `_docs/qa/road-types/roundabout-<tier>.png`, 0 console errors each (dev server rebuilt and restarted on 5210).

## Phase 7: Years and real-map application
Status: Complete
Depends on: 2, 5, 6
Files: `Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js` (`junctionType`, double-roundabout detection), `Games.Client/wwwroot/games/delivery-driver/world/lane-profile.js`, `Games.Client/wwwroot/games/delivery-driver/world/junction-layout.js` (year gating)
Model: sonnet
Effort: medium

- ✅ Gate new layouts by era: give-way lines on minor arms from 1960 (as roundabouts use now), passing places from 1930, double roundabouts from 1975 (choose the year from `junctionType` rules and record it), signal stop lines stay from 1935
  - **Assumption:** give-way lines (1960) and signal stop lines (1935) were already gated in `markStops`, unchanged. Passing places now gated by `laneProfile` (`PASSING_PLACES_FROM` 1930). Double roundabouts from 1975 (`DOUBLE_ROUNDABOUT_FROM`; ordinary roundabouts keep their baked `roundaboutFrom`); before 1975 a double pair is a plain give-way via `junctionType` (`node.doubleFrom`).
- ✅ Real map: derive `lanesFwd`/`lanesBack` from class, `oneway` and `dual` in `laneProfile()` (no baked-format change)
  - **Assumption:** already done by `laneProfile()` in Phase 2 (class, oneway, dual); no change needed.
- ✅ Real map: derive pavements from class and town (town, A, B: both; lane and access: none)
  - **Assumption:** already done by `defaultPavement` in Phase 2 and used by the mesh; no change needed.
- ✅ Real map: place passing places on single-track lanes (`cls === 'lane'`) longer than about 150 m, about 100 m apart, skipping junction mouths
  - **Assumption:** the mesh already auto-places bays (about 100 m apart on lanes over 150 m); added a filter keeping bays 2 m clear of the junction-mouth ends.
- ✅ Real map: detect double roundabouts where two roundabout nodes are within about 80 m with a road between them, and build them as a double layout
  - **Assumption:** `detectDoubleRoundabouts(g)` in `roadgraph.js` (called from `buildRoadGraph`): two non-mini roundabout nodes within 80 m joined directly by an edge get `doubleWith`/`doubleFrom`; layout unchanged (two rings plus link, as in the greybox).
- ✅ Keep the existing per-year colour and rebuild path (`roadKey` in `road-mesh.js`) working; the new profile fields must be part of the key so a rebuild happens when they change
  - **Assumption:** `roadKey` is now a function that appends the profile (lanes, centre/edge lines, pavements, passing places); `junction-layout.js` quick-cache stamp includes `doubleFrom`.

### Verification Plan
- `npm test` passes; no new failures versus the Phase 1 baseline
- `node scripts/validate-roads.mjs --strict` (real map, exeter, plymouth, truro, penzance, 2024) reports 0 hard failures; compare to the plan 0010 Phase 8 output and record any new soft issues
- `node scripts/junction-layout-stats.mjs` runs and reports no exception or NaN

### Phase Summary
- Era gating: passing places from 1930 (`laneProfile`), double roundabouts from 1975 (`junctionType` holds a detected pair back as give-way), give-way lines 1960 and signal stop lines 1935 already in `markStops`. Real-map lane counts, pavements and bays already flowed from `laneProfile`; added `detectDoubleRoundabouts` (80 m, direct link), bay clearance from junction mouths, and the profile in `roadKey`.
- Later phases: no baked-format change; `node.doubleWith`/`doubleFrom` mark real-map doubles.
- Verification: `npm test` 481 pass, 0 fail; `validate-roads.mjs --strict` exit 0, 0 hard failures (soft: no-priority, sharp-angle, odd-degree, junction-cluster, roundabout-crowded as before, none new); `junction-layout-stats.mjs` NaN 0, exceptions 0. `dotnet build Games.Client` ok; 5210 serves HTTP 200 (still bound to 127.0.0.1 only, not restarted).

## Phase 8: Validation, drive checks and screenshots
Status: Complete
Depends on: 4, 6, 7
Files: `scripts/validate-roads.mjs` (greybox checks), `tests/js/greybox-drive.test.mjs`, `tests/e2e/greybox-drive.spec.mjs`, `scripts/road-types-screenshots.mjs` (new, do not edit `scripts/qa-screenshots.mjs`)
Model: sonnet
Effort: medium

- ✅ Extend `validateGreybox()` in `scripts/validate-roads.mjs` to check the new pieces: passing-place bays do not overlap the carriageway; single-track roads have no centre line; double roundabout link arms meet both rings
- ✅ Extend `tests/js/greybox-drive.test.mjs` with a drive-through of the asymmetric piece (the vehicle stays on the road surface) and the double roundabout (two entry/exit pairs stay inside the layout boundary)
- ✅ Add a greybox e2e case in `tests/e2e/greybox-drive.spec.mjs` that loads each new piece with no console errors
- ✅ Add `scripts/road-types-screenshots.mjs` that screenshots the real-map spots for the new layouts (passing place, double roundabout, signal junction, T-junction with give-way) into `_docs/qa/road-types/`
- ✅ Run the real-map validator and record the output in the phase summary

### Verification Plan
- `node scripts/validate-roads.mjs --greybox` exits 0
- `node --test tests/js/greybox-drive.test.mjs` passes
- `npm test` passes, with the count recorded versus the baseline
- `npm run test:e2e` runs; the only failures are the 4 known pre-existing ones from plan 0010 (record each, and any new one as a regression to fix)
- `node scripts/road-types-screenshots.mjs` writes its PNGs to `_docs/qa/road-types/` without console errors
- Dev server restarted on port 5210 and serves the game and the greybox page (200)

### Phase Summary
- Added `validateGreyboxRoadTypes` to `scripts/validate-roads.mjs --greybox` (no centre line on single track; passing-place bays inside the road, clear of mouths and each other; double-roundabout link joins both rings within 0.1 m); 6 new drive tests in `greybox-drive.test.mjs` (asymmetric 2+1 and double roundabout both ways, two rigs); 14 new greybox e2e cases (one per new piece, 0 console errors); new `scripts/road-types-screenshots.mjs` (14 top-down greybox pieces plus 4 real-map spots: passing place, double roundabout, signal junction, T give-way; 18 PNGs in `_docs/qa/road-types/`, 0 console errors, years via `debugTools.setYear(2024)`).
- Verification: `validate-roads.mjs --greybox` exit 0; greybox-drive 21 pass; `npm test` 487 pass, 0 fail (baseline 481); `--strict` real map exit 0, 0 hard failures (soft counts exeter: no-priority 139, sharp-angle 49, odd-degree 2, grade 1, junction-cluster 3, roundabout-crowded 2; plymouth, truro, penzance similar; plan 0010 recorded no counts, kinds unchanged, none new).
- e2e (run against a scratch server on 5213, config not kept): 124 pass, 2 fail (draw-call budget `delivery-driver.spec.mjs:45` and `phone-fit` 390x844 options), both flaky under load and pass on rerun alone (65 of 65). The earlier 3 to 4 real-map failures (minimap, full map, bridge drive) did not occur against the fresh build. No new regression.
- Port 5210: listener (pid 35460, 127.0.0.1 only) serves pages (200) but its `_framework/dotnet.*.js` fingerprint is stale (404), so the game WASM will not boot there until it is restarted after `dotnet build Games.Client` (not killed by this phase).

## Final Recap
Road types and junctions are now built from lane profiles instead of one generic road. Phase 2 added `world/lane-profile.js`, which derives lanes per direction, centre line, edge lines, passing places and pavements per side from class, one-way, dual and town, with per-road spec overrides. Phase 3 drew those markings in `road-mesh.js`: no centre line on single-track or one-way roads, passing-place bays, lane dividers, and one-sided pavements. Phases 4 to 6 added greybox pieces for single-track, one-way, two-way, multi-lane, asymmetric and no-pavement roads; signal, T-junction give-way, give-way crossroads and uncontrolled crossroads junctions; and small, medium, large and double roundabouts. Phase 7 applied the rules to the real map with era gating (passing places from 1930, double roundabouts from 1975, give-way from 1960, signals from 1935) and detected double roundabout pairs within 80 m. Phase 8 added validator checks, drive tests, e2e cases and a screenshot script. The greybox camera was changed to top-down by default at the user's request, with `?view=oblique` for the angled view. The baked map format was not changed, and vehicle AI is unchanged.

**Final state:** `npm test` 487 pass, 0 fail. `validate-roads.mjs --greybox` exit 0. `validate-roads.mjs --strict` exit 0, 0 hard failures. `greybox-drive.test.mjs` 21 pass.

**Commits (local, nothing pushed):** `61181be` phase 2, `1de82a5` phase 3, `fbdaea1` phase 4, `cf89cbf` phase 5, `f9228d5` phase 6, `ffd7659` phase 7, `8d8dbed` phase 8, `9fa959e` greybox top-down camera.

**Known issues / not done:**
- `npm run test:e2e` (phase 8, against a fresh build on a scratch port): 124 pass, 2 fail. Both failures pass when rerun alone (draw-call budget, which is flaky under load, and `phone-fit` 390x844). The 3 to 4 real-map failures recorded at plan 0010 did not reproduce on the fresh build.
- Phase 2 assumption to review: a two-way A or B road flagged `dual` is treated as asymmetric (2 forward, 1 back). The baked data has no per-direction tags, so this is a guess from the flag.
- Several things are only checked by still frames and need the phone: markings and passing-place bays on real roads, and the double roundabout on the real map.
- Real-map validator soft-issue counts were recorded but not diffed numerically against plan 0010 (it recorded no counts). No new issue kinds appeared.
- Port 5210: the old listener (PID 35460, bound to 127.0.0.1 only and serving a stale build) was stopped and the dev server restarted bound to `0.0.0.0:5210`, so a phone on the same network can reach it. Phase 6 had already replaced the old process once. Phone access may also use port 5220 via `scripts/run-lan.ps1`.
- Still uncommitted and pre-existing (kept out of phase commits): `.vscode/launch.json`, `.vscode/tasks.json`, `styles.css`, `ui/start.js`, `world/terrain.js`, plan 0009, plan 0010, `_docs/qa/greybox/`, `scripts/qa-screenshots.mjs`. Plan 0011 and `_docs/qa/road-types/` are also untracked.
- Code docs: no C#/.NET types changed, so `doc-code` was not run.

## Deployment Plan
1. Review the branch `feature/delivery-driver-spline-roads` (local commits only, nothing pushed). Decide what to do with the uncommitted pre-existing files listed above, and whether to commit the plan file and `_docs/qa/road-types/`.
2. Run `npm test` (expect 487 pass, 0 fail), `node scripts/validate-roads.mjs --greybox` and `node scripts/validate-roads.mjs --strict` (expect exit 0).
3. Run `dotnet build Games.Client` (assets are fingerprinted), then restart the dev server. For phone testing on the same Wi-Fi: `dotnet run --project Games.Client --urls http://0.0.0.0:5210 --no-launch-profile`, or `scripts/run-lan.ps1` (port 5220). Confirm `/play/delivery-driver` returns 200 and that the `_framework/dotnet.*.js` it references also returns 200.
4. Phone checks: a single-track lane with passing places, a one-way street, a two-way A road (centre line), a signal junction, a T-junction with give-way, a small and a large roundabout, and a double roundabout. Look for flicker at distance and close up. Open `/games/delivery-driver/greybox/greybox.html` (top-down by default; `&view=oblique` for the angled view) to check all 20 pieces.
5. When happy, push the branch and open a PR to `main`. The greybox page is dev-only and unlinked; it ships as static files with the client.
6. Follow-ups: review the dual-flag two-way A/B assumption in `world/lane-profile.js`; the two flaky e2e tests; the pre-existing real-map e2e failures from plan 0010 if they reappear.
