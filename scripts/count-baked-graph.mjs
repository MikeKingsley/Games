// Builds the game world from the baked road data and prints the graph counts next to the bake report in
// world/seed/baked/manifest.json (the baked network must load into the runtime graph with nothing lost).
//   node scripts/count-baked-graph.mjs
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const GAME = new URL('../Games.Client/wwwroot/games/delivery-driver/', import.meta.url);
const game = rel => import(pathToFileURL(new URL(rel, GAME).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href);
const dir = new URL('world/seed/baked/', GAME);
const read = f => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));

const { decodeBaked } = await game('world/baked-loader.js');
const { buildRegion } = await game('world/region.js');
const { buildRoadGraph } = await game('world/roadgraph.js');
const manifest = read('manifest.json');
const baked = decodeBaked(manifest, manifest.tiles.map(t => read(t.file)), read(manifest.coast));
const region = buildRegion({ ...JSON.parse(readFileSync(new URL('world/seed/sw-england.json', GAME), 'utf8')), baked });
const { graph } = buildRoadGraph(region);

// farms and site access roads are added on top of the baked network (ids after the baked ones)
const nodes = graph.nodes.filter(n => n.id < baked.nodes.length).length;
const edges = graph.edges.filter(e => e.id < baked.edges.length).length;
const perClass = {};
for (const e of graph.edges.filter(e => e.id < baked.edges.length)) perClass[e.cls] = (perClass[e.cls] ?? 0) + 1;
const report = manifest.stats?.nodes !== undefined ? manifest.stats : manifest.stats?.graph ?? manifest.stats;
console.log('bake report :', JSON.stringify({ nodes: report?.nodes, edges: report?.edges }));
console.log('runtime     :', JSON.stringify({ nodes, edges }), `(+${graph.nodes.length - nodes} nodes, +${graph.edges.length - edges} edges for farms, sites and splits)`);
console.log('edges/class :', JSON.stringify(perClass));
const ok = nodes === report?.nodes && edges === report?.edges;
console.log(ok ? 'OK: runtime graph matches the bake report' : 'MISMATCH');
process.exit(ok ? 0 : 1);
