// Solid parapets of bridge decks (plan 0009 phase 10), in the style of Slow Roads' rail checks: a collision shape per
// ~4 m of rail along the distance-to-centreline of each deck run, standing from the deck up to the parapet's top. The
// shapes are made on demand around a point for the year being played (the road width, and so the rail offset, changes
// with the era) and carry a height band, so a vehicle on the road below, five metres under the deck, never touches the
// rail above it, and a vehicle on the deck cannot leave it by driving at the parapet. Abutments and piers are solid
// too (`kind` 'abutment' / 'pier', from deckSupports): they stand clear of every carriageway, so they are only hit by
// vehicles that have left the road, and the same band test keeps them out of the way of the traffic passing above.
import { obb } from '../sim/collision.js';
import { pointAt, closestOnPoly } from './geom.js';
import { roadHeightAt } from './terrain.js';
import { edgeOpen, edgeWidth } from './roadgraph.js';
import { trimFor } from './junction-layout.js';
import { deckRuns, deckSupports, mergesAt, railOffset, BRIDGE } from '../render/gl/structure-mesh.js';

/** Length of one rail shape, metres. */
export const RAIL_STEP = 4;
/** A vehicle this far below a rail's foot, or further, is on another layer and cannot touch it. */
export const RAIL_BELOW = 0.8;
const tmp = { x: 0, y: 0, angle: 0, seg: 0 };

/**
 * The rail shapes within `reach` m of (x, y) for `year`: `{box, kind: 'rail' | 'abutment' | 'pier', edge, side, z0, z1}` pushed onto `out`
 * (cleared first). `z0` is the foot of the rail (the deck there) and `z1` the top of the parapet.
 */
export function railsNear(world, x, y, reach, year, out = []) {
    out.length = 0;
    const graph = world.graph;
    const seen = new Set();
    for (const s of graph.index.near(x, y, reach + 8)) {
        if (seen.has(s.edge)) continue;
        seen.add(s.edge);
        const e = graph.edges[s.edge];
        if (!e.z || e.cls === 'ferry') continue;
        const runs = deckRuns(e);
        if (!runs.length || !edgeOpen(e, year)) continue;
        const off = railOffset(edgeWidth(e, year)), tA = trimFor(graph, e, 'a', year), tB = trimFor(graph, e, 'b', year);
        const here = closestOnPoly(e.pts, x, y).along, lo = here - reach - 6, hi = here + reach + 6;
        for (const [t0, t1] of runs) {
            if (t1 < lo || t0 > hi) continue;
            // abutments and piers are solid from the bed up to the slab's underside
            for (const sp of deckSupports(world, e, t0, t1, year, tA, tB)) {
                if (Math.abs(sp.x - x) > reach + 6 || Math.abs(sp.y - y) > reach + 6) continue;
                out.push({ box: obb(sp.x, sp.y, sp.kind === 'pier' ? sp.r * 2 : sp.hl * 2, sp.kind === 'pier' ? sp.r * 2 : sp.hw * 2, sp.angle), kind: sp.kind, edge: e, side: 0, z0: sp.bottom, z1: sp.z - BRIDGE.slab });
            }
            const n = Math.max(1, Math.ceil((t1 - t0) / RAIL_STEP));
            const k0 = Math.max(0, Math.floor(((lo - t0) / (t1 - t0)) * n)), k1 = Math.min(n, Math.ceil(((hi - t0) / (t1 - t0)) * n));
            for (let k = k0; k < k1; k++) {
                const d0 = t0 + ((t1 - t0) * k) / n, d1 = t0 + ((t1 - t0) * (k + 1)) / n;
                const dm = (d0 + d1) / 2;
                if (dm < tA || dm > e.len - tB) continue; // the junction surface carries on from here, with no parapet
                pointAt(e.pts, dm, tmp);
                if (Math.abs(tmp.x - x) > reach + 4 || Math.abs(tmp.y - y) > reach + 4) continue;
                const a = pointAt(e.pts, d0), b = pointAt(e.pts, d1);
                const heading = Math.atan2(b.y - a.y, b.x - a.x), len = Math.hypot(b.x - a.x, b.y - a.y) + 0.1;
                const z0 = Math.min(roadHeightAt(e, d0), roadHeightAt(e, d1)), z1 = Math.max(roadHeightAt(e, d0), roadHeightAt(e, d1)) + BRIDGE.parapet;
                for (const side of [1, -1]) {
                    // the left side of the heading in this frame is (sin, -cos)
                    const cx = (a.x + b.x) / 2 + Math.sin(heading) * off * side, cy = (a.y + b.y) / 2 - Math.cos(heading) * off * side;
                    // no parapet (so no rail) across a road that merges onto the deck
                    if (mergesAt(world, year, cx, cy, e, (z0 + z1 - BRIDGE.parapet) / 2)) continue;
                    out.push({ box: obb(cx, cy, len, BRIDGE.parapetWidth, heading), kind: 'rail', edge: e, side, z0, z1 });
                }
            }
        }
    }
    return out;
}

/** True when a vehicle whose wheels are at height `z` can touch a rail shape (they share a layer). */
export const railTouches = (rail, z) => z >= rail.z0 - RAIL_BELOW && z <= rail.z1;
