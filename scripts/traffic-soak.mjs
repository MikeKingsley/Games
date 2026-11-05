// Traffic soak test for Delivery Driver: runs seeded traffic around a town for N fixed steps in a year and reports
// vehicles on closed or wrong-way (against a one-way) edges, vehicles overlapping, and how many agents were seen.
//   node scripts/traffic-soak.mjs [--town exeter] [--steps 10000] [--years 1919,1965,2020]
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { seedWithBaked } from '../tests/js/helpers/delivery-seed.mjs';
import { createWorld } from '../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { createTraffic } from '../Games.Client/wwwroot/games/delivery-driver/traffic/traffic.js';
import { edgeOpen } from '../Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js';
import { obb, sat } from '../Games.Client/wwwroot/games/delivery-driver/sim/collision.js';

/** Runs the soak; returns {steps, maxAgents, wrongWay, closed, overlaps (pairs seen overlapping), samples}. */
export function soak(world, { town = 'exeter', year = 2020, steps = 10000, seed = 11, cap = 24 } = {}) {
    const t = world.region.townById.get(town);
    const tr = createTraffic(world.graph, { seed, cap });
    const player = { x: t.x, y: t.y, heading: 0, speed: 0, len: 5, width: 2 };
    const out = { steps, maxAgents: 0, wrongWay: 0, closed: 0, overlaps: 0, samples: 0 };
    for (let k = 0; k < steps; k++) {
        tr.step(1 / 30, { year, player, despawnAt: 600 });
        out.maxAgents = Math.max(out.maxAgents, tr.agents.length);
        for (const a of tr.agents) {
            const e = world.graph.edges[a.edge];
            if (!edgeOpen(e, year) && e.cls !== 'ferry') out.closed++;
            if (e.oneway && !a.forward) out.wrongWay++;
        }
        if (k % 10 === 0) {
            out.samples++;
            const list = tr.agents;
            for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
                const a = list[i], b = list[j];
                if (Math.hypot(a.x - b.x, a.y - b.y) > 12) continue;
                if (sat(obb(a.x, a.y, a.spec.len, a.spec.width, a.heading), obb(b.x, b.y, b.spec.len, b.spec.width, b.heading))) out.overlaps++;
            }
        }
    }
    return out;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
    const world = createWorld(seedWithBaked());
    let bad = 0;
    for (const year of arg('--years', '1919,1965,2020').split(',').map(Number)) {
        const r = soak(world, { town: arg('--town', 'exeter'), year, steps: +arg('--steps', 10000) });
        console.log(year, JSON.stringify(r));
        bad += r.wrongWay + r.closed;
    }
    process.exitCode = bad ? 1 : 0;
}
