# Road bake scripts

Offline pipeline that turns OpenStreetMap and open terrain data into the road network, coastline and elevation
used by Delivery Driver (plan `_docs/plans/0008-delivery-driver-real-roads.md`). Raw downloads live in the
gitignored `.cache/` folder; the baked output is written under
`Games.Client/wwwroot/games/delivery-driver/world/seed/baked/`.

Map data © OpenStreetMap contributors (ODbL). Elevation: AWS Open Data terrain tiles (Terrarium). See `NOTICE.md`.

## Prerequisites

- Node 20 or later (uses built-in `fetch`; no npm dependencies).
- Internet access to Overpass (`overpass-api.de`, with mirrors) and `s3.amazonaws.com` for the fetch step only.
  Baking and the game itself work offline from the cache and the committed baked files.

## Fetch

```
node scripts/bake-roads/fetch-osm.mjs          # region grid tiles + one request per town
node scripts/bake-roads/fetch-elevation.mjs    # terrain tiles, stitched to .cache/elevation/grid.f32
node scripts/bake-roads/fetch-osm.mjs --check        # every request cached, with way counts
node scripts/bake-roads/fetch-elevation.mjs --check  # coverage and min/max heights
```

Region bounds, towns and their footprints come from `world/seed/sw-england.json` (`common.mjs`).

### Resuming

Each response is written to its own file (via a `.part` file renamed on success) and a cached file is never
requested again, so re-running a script simply continues where it stopped. Delete a single file in
`.cache/osm/` to refetch it. To work offline, copy a populated `.cache/` folder into the repo root.

### Overpass etiquette

- A descriptive `User-Agent` is sent with every request.
- Requests run one at a time with a pause (2.5 s) between them.
- On 429/5xx or a timeout the script backs off exponentially (10 s doubling to 2 min), rotating across mirrors.
- Tiles are small enough (0.25 degrees) not to time out; use `--tile 0.15` if a tile keeps failing.
- Never hammer the public servers; if they stay busy, wait and re-run, or point `--endpoint` at your own instance.

## Elevation notes

Zoom 11 tiles give about 49 m cells. The source contains isolated spike pixels (a bogus 1093 m on Bodmin Moor),
so the stitcher replaces any pixel more than 60 m from the mean of its neighbours. Sea-floor values are kept
(negative); the baker clamps them.

## Bake

```
node scripts/bake-roads/bake.mjs                  # .cache/osm -> world/seed/baked/ (about 13 s)
node scripts/validate-roads.mjs --baked --area all  # check the result
```

The bake is pure and deterministic from the cache: parse and classify (`OSM_CLASS` table in `bake.mjs`), build the
topology on shared vertices, collapse roundabouts and dual carriageways, keep minor streets only inside town
footprints, merge, contract, simplify, then keep roads one carriageway-plus-pavement apart at the same level (below),
type junctions, then write the manifest, `main.json`, one `town-<id>.json`
per town, `coast.json` and `rivers.json` (format in `world/baked-format.js`). It fails if the output exceeds
10 MiB gzipped.

### Generalisation (plan 0009 phase 4)

At 1:4 life-size roads still overlap in dense grids and interchanges, so `bake()` runs, after the simplify/trim/crossing
steps and before junction typing and the era pass: `consolidateJunctions` (two or three junctions closer than their
footprints become one), `absorbIntoRoundabouts` (a junction inside a roundabout's ring joins the roundabout; ring =
island 7.2 m + widest arm), then up to three rounds of `generaliseSeparation` + `repairCrossings`. Separation finds
same-level strip overlaps (`findStripOverlaps`: carriageway/2 + 2 m pavement per road, ignoring the patch around a
junction node of either road, 30 m either side of a bridge or tunnel = its approach ramp) and resolves each by dropping
the lower-ranked road if the network and the M5/A30/A38 chain stay connected, else joining a nearby end node onto the
other road, contracting a short link, or nudging the road sideways. Bridge and tunnel stretches are never edited.
Spans carry a `level` (OSM `layer`, else +1 bridge / -1 tunnel); roundabout nodes carry `ringRadius` (world metres).
`bake` logs the counts (`separation {...}`) and `validate-roads.mjs --baked --area all --strict` must exit 0.

Coordinates are world metres from `world/projection.js`: a plain equirectangular projection at `WORLD_SCALE` in
`config.js` (1:4 since plan 0009; there is no town lens any more). Clean-up tolerances in `bake()` are written in real
metres and converted by the scale. Town street footprints are real-metre radii per size (`TOWN_FOOTPRINT` in
`world/projection.js`: city 1210, town 910, small 730, village 505, exactly what the OSM cache covers); the game's
`TOWN_RADIUS` is that times the scale. Enlarging them needs a fresh `fetch-osm.mjs` run (it reads `townBoxes`).
Everything placed in the world (towns, sites, coast, elevation samples) must go through the same projection.


## Era rules (Phase 5)

`bake.mjs` reads `history.json` (curated dates: M5, Tamar Bridge, Exeter bypass, dualling years, ferries as events) and
`era.mjs` dates every edge (`opened`, `closed`, `upgrades`, `tag`) and signal/roundabout node (`signalsFrom`,
`roundaboutFrom`). Precedence: curated table, OSM `start_date`, class rules, town growth rings, then propagation so
nothing opens before it is reachable. The bake fails (exit 1, nothing written) if any town centre is cut off from the
main network in 1919, 1930, 1950, 1970, 1990 or 2024. Edit `history.json` and re-run `node scripts/bake-roads/bake.mjs`.

## Elevation bake

`bake.mjs` also runs `bake-elevation.mjs` when `.cache/elevation/grid.f32` exists (it can be run alone:
`node scripts/bake-roads/bake-elevation.mjs [--cell 24]`). It resamples the Mercator grid onto a 24 world-metre grid
(~96 real m) through the game projection and writes `elevation.bin` (format `ELV2` in `world/elevation-format.js`:
plane-predicted residuals, zig-zag varints, zero runs collapsed; about 1.5 MB, 0.6 MB gzipped) plus an `elevation`
entry in `manifest.json`.

## Checks

```
node scripts/validate-roads.mjs --area all --check-yards --furniture --strict   # graph, yards, furniture (full game world)
node scripts/validate-roads.mjs --baked --area all                               # the baked graph alone
node scripts/terrain-stats.mjs                                                  # land heights and road grades
node scripts/traffic-soak.mjs --town exeter --steps 10000                        # seeded traffic soak
```
