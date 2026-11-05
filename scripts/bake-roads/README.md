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
node scripts/bake-roads/bake.mjs                  # .cache/osm -> world/seed/baked/ (about 12 s)
node scripts/bake-roads/bake.mjs --no-lens        # plain 1:13 projection, no town lenses
node scripts/validate-roads.mjs --baked --area all  # check the result
```

The bake is pure and deterministic from the cache: parse and classify (`OSM_CLASS` table in `bake.mjs`), build the
topology on shared vertices, collapse roundabouts and dual carriageways, keep minor streets only inside town
footprints, merge, contract, simplify, type junctions, then write the manifest, `main.json`, one `town-<id>.json`
per town, `coast.json` and `rivers.json` (format in `world/baked-format.js`). It fails if the output exceeds
10 MiB gzipped.

Coordinates are world metres from `world/projection.js`: the 1:13 projection of `config.js` plus a smooth town lens
per town, which magnifies each town's real street footprint (`footprintM`) to its game radius so real streets
stay drivable at the compressed scale. Everything placed in the world (towns, sites, coast, elevation samples)
must go through the same projection.


## Era rules (Phase 5)

`bake.mjs` reads `history.json` (curated dates: M5, Tamar Bridge, Exeter bypass, dualling years, ferries as events) and
`era.mjs` dates every edge (`opened`, `closed`, `upgrades`, `tag`) and signal/roundabout node (`signalsFrom`,
`roundaboutFrom`). Precedence: curated table, OSM `start_date`, class rules, town growth rings, then propagation so
nothing opens before it is reachable. The bake fails (exit 1, nothing written) if any town centre is cut off from the
main network in 1919, 1930, 1950, 1970, 1990 or 2024. Edit `history.json` and re-run `node scripts/bake-roads/bake.mjs`.

## Elevation bake

`bake.mjs` also runs `bake-elevation.mjs` when `.cache/elevation/grid.f32` exists (it can be run alone:
`node scripts/bake-roads/bake-elevation.mjs [--cell 12]`). It resamples the Mercator grid onto a 12 world-metre grid
through the town-lens projection and writes `elevation.bin` (format in `world/elevation-format.js`) plus an
`elevation` entry in `manifest.json`.

## Checks

```
node scripts/validate-roads.mjs --area all --check-yards --furniture --strict   # graph, yards, furniture (full game world)
node scripts/validate-roads.mjs --baked --area all                               # the baked graph alone
node scripts/terrain-stats.mjs                                                  # land heights and road grades
node scripts/traffic-soak.mjs --town exeter --steps 10000                        # seeded traffic soak
```
