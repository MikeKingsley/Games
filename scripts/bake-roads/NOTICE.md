# Data notices

## OpenStreetMap (roads, coastline, rivers)

The baked road network, coastline and river data in
`Games.Client/wwwroot/games/delivery-driver/world/seed/baked/` is derived from OpenStreetMap data,
**© OpenStreetMap contributors**, available under the Open Database Licence (ODbL) 1.0:
<https://www.openstreetmap.org/copyright> and <https://opendatacommons.org/licenses/odbl/1-0/>.

- The baked files are a **derived database**: geometry is simplified, quantised and re-topologised (junctions merged,
  dual carriageways collapsed to one centreline, roundabouts collapsed to one node), and the game adds its own era
  dates and class names. Every baked file carries a licence header and `manifest.json` repeats the attribution.
- The game shows "© OpenStreetMap contributors" on its HUD (beside the minimap), on the start screen and in the game
  menu. Keep that credit in any build that ships these files.
- If you redistribute the baked files (or a database made from them), keep the ODbL terms: attribute OpenStreetMap,
  share the derived database under the ODbL, and keep it open (share-alike).
- Rendered game graphics (the "produced work") only need the attribution.

## Elevation

Heights come from the open terrain tiles hosted on AWS Open Data (Terrarium encoding,
<https://registry.opendata.aws/terrain-tiles/>), which combine SRTM, national DEMs and other public sources
(Mapzen Terrain Tiles; see <https://github.com/tilezen/joerd/blob/master/docs/attribution.md>). They are resampled
into `elevation.bin`; the game credits "Elevation: Mapzen terrain tiles (SRTM and other public sources)".

## Overpass etiquette

The fetch scripts send a descriptive User-Agent, request tiles one at a time with a pause and back-off, and never
re-request a cached tile. Do not remove those limits.
