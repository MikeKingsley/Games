# Delivery Driver road system

How the roads in Delivery Driver get from OpenStreetMap to the screen. Plan: `_docs/plans/0008-delivery-driver-real-roads.md`.
Data © OpenStreetMap contributors (ODbL); see `scripts/bake-roads/NOTICE.md`.

## Pipeline

1. **Fetch** (`scripts/bake-roads/fetch-osm.mjs`, `fetch-elevation.mjs`): Overpass JSON tiles (0.25 degree grid for main roads, coast, rivers, signals, ferries, plus one request per town for residential/service streets) and Terrarium elevation tiles (zoom 11) are cached in `.cache/` (gitignored). Re-bakes are offline.
2. **Bake** (`scripts/bake-roads/bake.mjs`, about 15 s): projects lat/lon through `world/projection.js` (plain equirectangular at `WORLD_SCALE` = 1:4, no town lens; town street footprints are real-metre radii per size, `TOWN_RADIUS` is that times the scale), builds topology (shared vertices become nodes, ways split at junctions, degree-2 nodes merged, near endpoints snapped, overlaps and false crossings removed), collapses parallel one-way carriageways with the same ref into one `dual`/`M` centreline, collapses roundabouts (560 rings, 274 minis) to one node, types junctions (`end`, `through`, `giveway`, `signals`, `roundabout`, plus a `priority` flag), simplifies geometry (Douglas-Peucker, never creating a crossing), applies era rules and writes tiles.
3. **Era rules** (`scripts/bake-roads/era.mjs`, `history.json`): each edge gets `opened`, `closed`, `upgrades`. Precedence: curated table (M5 1977, Exeter bypass 1938, Tamar Bridge 1961, A30/A38 dualling...), OSM `start_date`, class rules (motorway opens 1977, dual carriageways start as `A` and upgrade), town growth rings (1919 core, then 1935/1955/1975/1995 with a small deterministic jitter), then propagation so nothing opens before it is reachable. The bake fails if any town centre is cut off in 1919, 1930, 1950, 1970, 1990 or 2024.
4. **Elevation** (`bake-elevation.mjs`): resampled onto a 24 world-metre grid (`elevation.bin`, format `ELV2`: heights in 1/4 world-metre steps, plane-predicted residuals as zig-zag varints with zero runs collapsed, about 1.5 MB and 0.6 MB gzipped; world metres = real metres x 1/4; sea floor clamped to 0).

## Tile format (`world/seed/baked/`, `world/baked-format.js`)

`manifest.json` (stats, era report, curated events, `elevation` entry), `main.json` (motorway down to unclassified/lanes), `town-<id>.json` x 58 (residential, living_street, service), `coast.json` (land rings), `rivers.json` (not used at runtime), `elevation.bin`. Coordinates are quantised to 0.1 m and delta encoded; nodes have global ids (main first, then towns). Edges: `a, b, cls, oneway (a->b), link, lit, dual, bridge, tunnel, spans, ref, name, maxspeed (mph), town, opened, closed, upgrades, tag`. Total about 1.5 MiB gzip.

## Runtime graph (`world/roadgraph.js`)

`buildRoadGraph(region)` builds nodes and edges from the baked data, then attaches gameplay data: ferries (`addFerry`: the shortest water crossing between real street/B/A nodes near the seed's shore points), farms on real lane/B frontages outside towns, industry-site access roads at a right angle off the nearest real road, and (in `world.js`) depots, garages and in-town sites on street frontages or the edge of town. Every edge keeps its dates; all queries take the year (`edgeOpen`, `edgeClass`, `junctionType`, `edgeSpeed`). `coreNodes` finds the main strongly connected network (one-way aware); town centres and route endpoints snap into it. Terrain (`world/terrain.js`) samples the elevation grid; `gradeRoads` cuts and fills each road to its class gradient limit (lane 12%, B 10%, A/street 8%, dual 6%, M 5%).

## Furniture (`world/furniture.js`)

Pure rules; geometry is independent of the year (each prop has `from`/`until`, see `isLive`). Lamps stand on lit (OSM `lit`) or town street/B/A/dual edges, staggered every 30/36/40/44 m beside the widest-ever carriageway plus kerb, never in junction mouths, on bridges, in water, buildings, yards, trees or within reach of another road; rural lit roads only from 1950. Corner lamps at town junctions. Signs: country signposts, give way (from 1965) on minor arms, roundabout-ahead plates, all on the left verge of the approach. Signal poles: one per arm at the stop line, signal group from the approach heading. Buildings are plotted along two-way street/B/A frontages two metres beyond the widest carriageway, starting beyond the junction mouths.

## Rendering (`render/gl/road-mesh.js`, Canvas fallback `render/draw-road.js`)

Per-edge ribbons (kerb strip, surface, pavements or verge, markings) and per-node patches (rounded kerb returns, roundabout ring, island and splitter islands, stop and give-way lines). Era gates: centre lines 1926/1935, stop lines at signals 1935, zebra crossings 1950, double white lines on bends and give-way lines 1960, edge lines 1970. Pavements are flagstone before 1950, tarmac after.

## Traffic (`traffic/traffic.js`, `world/pathfind.js`)

One-way edges are driven forward only (spawn, `pickNext`, A*); a vehicle leaves the map at a one-way dead end. Junction claims keep one vehicle in a junction box; roundabouts use the same rule. Speeds come from `edgeSpeed` (class speed capped by baked `maxspeed`). Slip roads and short stubs never spawn vehicles.

## Checks

`scripts/validate-roads.mjs` (graph, yards, furniture), `scripts/terrain-stats.mjs`, `scripts/traffic-soak.mjs`; unit tests `tests/js/delivery-driver.{bake,era,roads-validator,furniture,road-mesh,traffic-real}.test.mjs`.
