// Traffic soak test for Delivery Driver: runs seeded traffic around a town for N fixed steps in a year and reports
// vehicles on closed or wrong-way (against a one-way) edges, vehicles overlapping on the same level, vehicles inside
// a roundabout island, off its ring or circulating the wrong way, and how many agents were seen. Vehicles that overlap
// in plan on different levels (a flyover) are counted separately (layerOverlaps) and are fine.
//   node scripts/traffic-soak.mjs [--town exeter] [--steps 10000] [--years 1919,1965,2020]
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { seedWithBaked } from '../tests/js/helpers/delivery-seed.mjs';
import { createWorld } from '../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { createTraffic, otherLayer } from '../Games.Client/wwwroot/games/delivery-driver/traffic/traffic.js';
import { edgeOpen } from '../Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js';
import { obb, sat } from '../Games.Client/wwwroot/games/delivery-driver/sim/collision.js';

/** Runs the soak; returns {steps, maxAgents, wrongWay, closed, overlaps (same-level pairs seen overlapping), layerOverlaps (pairs overlapping in plan on different levels), samples, ringSamples, inIsland, offRing, ringWrong}. */
export function soak(world, { town = 'exeter', year = 2020, steps = 10000, seed = 11, cap = 24 } = {}) {
    const t = world.region.townById.get(town);
    const tr = createTraffic(world.graph, { seed, cap });
    const player = { x: t.x, y: t.y, heading: 0, speed: 0, len: 5, width: 2 };
    const out = { steps, maxAgents: 0, wrongWay: 0, closed: 0, overlaps: 0, samples: 0, layerOverlaps: 0, ringSamples: 0, inIsland: 0, offRing: 0, ringWrong: 0, junctionSamples: 0 };
    const ringAngle = new Map(); // agent id -> its angle about the ring centre last step
    for (let k = 0; k < steps; k++) {
        tr.step(1 / 30, { year, player, despawnAt: 600 });
        out.maxAgents = Math.max(out.maxAgents, tr.agents.length);
        for (const a of tr.agents) {
            const e = world.graph.edges[a.edge];
            if (!edgeOpen(e, year) && e.cls !== 'ferry') out.closed++;
            if (e.oneway && !a.forward) out.wrongWay++;
            const k = a.conn;
            if (!k) { ringAngle.delete(a.id); continue; }
            out.junctionSamples++;
            if (k.c.kind !== 'ring') continue;
            // round a roundabout: clockwise on screen (y points south, so the angle about the centre increases), on the ring
            const lay = k.c.layout, node = world.graph.nodes[k.c.nodeId];
            const dx = a.x - node.x, dy = a.y - node.y, r = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
            out.ringSamples++;
            if (r < lay.ring.ri) out.inIsland++;
            if (r > lay.ring.ro + 15) out.offRing++;
            const prev = ringAngle.get(a.id);
            if (prev !== undefined && r > lay.ring.ri && a.speed > 0.5) {
                const d = Math.atan2(Math.sin(ang - prev), Math.cos(ang - prev));
                if (d < -0.03 && r < lay.ring.ro + 0.5) out.ringWrong++;
            }
            ringAngle.set(a.id, ang);
        }
        if (k % 10 === 0) {
            out.samples++;
            const list = tr.agents;
            for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
                const a = list[i], b = list[j];
                if (Math.hypot(a.x - b.x, a.y - b.y) > 12) continue;
                if (sat(obb(a.x, a.y, a.spec.len, a.spec.width, a.heading), obb(b.x, b.y, b.spec.len, b.spec.width, b.heading))) {
                    if (otherLayer(a, b, 0)) out.layerOverlaps++; else out.overlaps++;
                }
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
        bad += r.wrongWay + r.closed + r.inIsland + r.offRing + r.ringWrong;
    }
    process.exitCode = bad ? 1 : 0;
}
