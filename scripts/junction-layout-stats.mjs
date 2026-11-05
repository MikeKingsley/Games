// Runs the junction layout (world/junction-layout.js) over every junction of the baked road network in one or more
// years and prints counts: kinds, clamped trims, spread arms, rejected cases, NaNs, exceptions, timing.
//   node scripts/junction-layout-stats.mjs [--years 1919,1965,2024] [--list]
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadBakedWorld } from './validate-roads.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(here, '../Games.Client/wwwroot/games/delivery-driver');
const { layoutJunction } = await import(pathToFileURL(`${GAME}/world/junction-layout.js`).href);

/** Layout counts for a graph in a year. Exported for tests. */
export function layoutStats(graph, year, { list = false } = {}) {
    const out = { year, nodes: 0, kinds: {}, clamped: 0, clampedNodes: 0, hull: 0, spread: 0, spreadNodes: 0, rejected: 0, rejectedReasons: {}, nan: 0, errors: 0, ms: 0, examples: [] };
    const t0 = performance.now();
    for (const node of graph.nodes) {
        let lay;
        try { lay = layoutJunction(graph, node, year); } catch (err) {
            out.errors++;
            if (out.examples.length < 5) out.examples.push(`node ${node.id}: ${err.message}`);
            continue;
        }
        if (lay.kind === 'none') continue;
        out.nodes++;
        out.kinds[lay.kind] = (out.kinds[lay.kind] ?? 0) + 1;
        out.clamped += lay.stats.clamped; if (lay.stats.clamped) out.clampedNodes++;
        out.hull += lay.stats.hull; out.spread += lay.stats.spread; if (lay.stats.spread) out.spreadNodes++;
        if (lay.stats.rejected.length) {
            out.rejected++;
            for (const r of new Set(lay.stats.rejected)) out.rejectedReasons[r] = (out.rejectedReasons[r] ?? 0) + 1;
            if (list && out.examples.length < 12) out.examples.push(`node ${node.id} (${node.x.toFixed(0)}, ${node.y.toFixed(0)}) ${lay.kind}: ${[...new Set(lay.stats.rejected)].join(', ')}`);
        }
        const bad = v => !Number.isFinite(v);
        let nan = lay.boundary.some(p => bad(p.x) || bad(p.y)) || bad(lay.reach);
        for (const a of lay.arms) if (bad(a.trim) || !a.mouth || bad(a.mouth.x) || bad(a.mouth.y)) nan = true;
        for (const c of lay.connectors) if (c.pts.some(bad)) nan = true;
        if (nan) out.nan++;
    }
    out.ms = Math.round(performance.now() - t0);
    return out;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const argv = process.argv.slice(2);
    const years = (argv.includes('--years') ? argv[argv.indexOf('--years') + 1] : '1919,1965,2024').split(',').map(Number);
    const world = await loadBakedWorld();
    for (const year of years) {
        const s = layoutStats(world.graph, year, { list: argv.includes('--list') });
        console.log(`year ${year}: ${s.nodes} junction layouts in ${s.ms} ms, kinds ${JSON.stringify(s.kinds)}`);
        console.log(`  clamped trims ${s.clamped} (${s.clampedNodes} nodes), spread arms ${s.spread} (${s.spreadNodes} nodes), hull fallbacks ${s.hull}, rejected ${s.rejected} ${JSON.stringify(s.rejectedReasons)}, NaN ${s.nan}, exceptions ${s.errors}`);
        for (const e of s.examples) console.log(`    ${e}`);
    }
}
