// Road history: which roads open, close or are upgraded in which year (Exeter bypass 1938, the Saltash ferry
// until the Tamar Bridge in 1961, the M5 to Exeter in 1977, A30/A38 dualling...). The graph keeps every edge
// for all years; edges carry opened/closed/upgrades and every query takes the year (edgeOpen, edgeClass), so a
// year change needs no rebuild: routes are recomputed and the renderer picks the new styles. Chunk caches hold
// geometry only (trees and buildings were placed clear of future roads, including room for dualling).
import { edgeOpen } from './roadgraph.js';
import { waterAt } from './region.js';
import { pointAt } from './geom.js';
import { GAME_MINUTES_PER_SECOND } from '../game/calendar.js';

/**
 * Every dated change in the region, oldest first: {year, kind: 'opened'|'closed'|'upgraded', name, road, cls}.
 * With the baked road data the events are the curated ones (scripts/bake-roads/history.json), carried in the baked
 * manifest as `region.events`; `road` is the curated tag also stored on the affected edges (`edge.tag`).
 */
export function roadEvents(world) {
    if (world._roadEvents) return world._roadEvents;
    const seen = new Set();
    const out = [];
    const push = e => {
        const key = `${e.road}:${e.year}:${e.kind}`;
        if (seen.has(key) || e.year <= 1919) return;
        seen.add(key);
        out.push({ year: e.year, kind: e.kind, name: e.name, road: e.road, cls: e.cls });
    };
    for (const e of world.region.events ?? []) push(e);
    out.sort((a, b) => a.year - b.year || a.name.localeCompare(b.name));
    world._roadEvents = out;
    return out;
}

/** Events that happen when the calendar moves from year y0 into y1 (y0 < year <= y1). */
export function eventsBetween(world, y0, y1) {
    return roadEvents(world).filter(e => e.year > y0 && e.year <= y1);
}

/** A sentence for the news when a road changes. */
export function describeEvent(e) {
    if (e.cls === 'ferry') return e.kind === 'closed' ? `The ${e.name} has made its last crossing.` : `The ${e.name} starts running.`;
    if (e.kind === 'opened') return e.cls === 'M' ? `The ${e.name} motorway opens.` : `The ${e.name} opens.`;
    if (e.kind === 'closed') return `The ${e.name} closes.`;
    return e.cls === 'dual' ? `The ${e.name} is now a dual carriageway.` : `The ${e.name} has been upgraded.`;
}

/**
 * Ferry slips: for each ferry edge, the points where the road meets the water at each end, in both directions.
 * The player stops at a slip and takes the ferry (fee, wait and crossing time), arriving at the other slip.
 */
export function ferrySlips(world) {
    if (world._slips) return world._slips;
    const slips = [];
    for (const e of world.graph.edges) {
        if (e.cls !== 'ferry') continue;
        const step = 3;
        const n = Math.floor(e.len / step);
        let first = -1, last = -1;
        for (let k = 0; k <= n; k++) {
            const p = pointAt(e.pts, k * step);
            if (waterAt(world.region, p.x, p.y) >= 15) { if (first < 0) first = k; last = k; }
        }
        if (first < 0) { first = 0; last = n; } // the baked water does not cover this crossing (the Dart): slip to slip along the edge
        const a = pointAt(e.pts, Math.max(0, (first - 2) * step), {});
        const b = pointAt(e.pts, Math.min(e.len, (last + 2) * step), {});
        const crossing = (last - first + 4) * step;
        const info = { edge: e.id, name: e.name, fee: e.ferry?.fee ?? 2, wait: e.ferry?.wait ?? 15, crossing };
        slips.push({ ...info, x: a.x, y: a.y, heading: a.angle + Math.PI, to: { x: b.x, y: b.y, heading: b.angle } });
        slips.push({ ...info, x: b.x, y: b.y, heading: b.angle, to: { x: a.x, y: a.y, heading: a.angle + Math.PI } });
    }
    world._slips = slips;
    return slips;
}

/** The open ferry slip within `radius` of a point in a year, or null. */
export function slipNear(world, x, y, year, radius = 10) {
    for (const s of ferrySlips(world)) {
        if (Math.hypot(s.x - x, s.y - y) <= radius && edgeOpen(world.graph.edges[s.edge], year)) return s;
    }
    return null;
}

/** Game minutes a crossing takes: the wait for the boat plus a slow chain-ferry crossing (~1.5 m/s on the map). */
export const crossingMinutes = slip => slip.wait + (slip.crossing / 1.5) * GAME_MINUTES_PER_SECOND;
