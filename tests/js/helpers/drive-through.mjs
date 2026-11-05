// Test helper (plan 0009 phase 7): drive a simulated vehicle along a road through a grade-separated crossing on the
// layered driven surface, the way game/session.js does it (slopeAt under the wheelbase, on the layer at the vehicle's
// own height), and report what it felt. Pure: needs only a built world.
import { slopeAt, roadHeightAt, roadGradeAt, crossingGap } from '../../../Games.Client/wwwroot/games/delivery-driver/world/terrain.js';
import { lanePoint, laneOffset, edgeOpen } from '../../../Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js';
import { CLEARANCE } from '../../../Games.Client/wwwroot/games/delivery-driver/world/crossings.js';
import { railsNear, railTouches } from '../../../Games.Client/wwwroot/games/delivery-driver/world/rails.js';
import { obb, sat } from '../../../Games.Client/wwwroot/games/delivery-driver/sim/collision.js';

/**
 * How much steeper than its own road (and than 0.15 m per metre) a vehicle's height step may be: the blend across a
 * junction, where the front wheels are already on the next road, stays under it; a fall or a jump between layers does not.
 */
export const STEP_EXCESS = 0.25;

/** A car and a rigid lorry: wheelbase and track (m). */
export const RIGS = [{ name: 'car', wheelbase: 2.7, width: 1.6 }, { name: 'lorry', wheelbase: 5.2, width: 2.2 }];

/**
 * Drives `rig` along `edge` in its nearside lane (`forward`: from a to b) over [from, to] m (measured from a), every
 * `step` m. Returns {steps, worstJump (largest |dz| per metre between steps), worstExcess (largest amount by which a
 * step was steeper than both 0.15 m per metre and its own road's grade there plus 0.1), worstOff (largest gap between
 * the vehicle's height and its own road's profile there), off: [{along, z, road}] where it left its road}.
 */
export function driveAlong(world, edge, from, to, { forward = true, year = 2024, rig = RIGS[0], step = 1 } = {}) {
    const off = laneOffset(edge, year);
    const p = { x: 0, y: 0, angle: 0 };
    const travel = d => (forward ? d : edge.len - d); // distance along the travel direction, from the start end
    const start = travel(forward ? from : to), end = travel(forward ? to : from);
    // put the rear axle on the road at the start, pitched to it (as session.js settle does on the carriageway it
    // stands on); the first steps settle the rig, so its height steps count from the third
    const a0 = forward ? start : edge.len - start;
    let z = roadHeightAt(edge, a0), pitch = Math.atan((forward ? 1 : -1) * roadGradeAt(edge, a0 + (forward ? 1 : -1) * rig.wheelbase / 2));
    const out = { steps: 0, worstJump: 0, worstExcess: 0, worstOff: 0, off: [] };
    let last = z, lastRoad = z;
    for (let s = start; s <= end - rig.wheelbase; s += step) {
        lanePoint(edge, s + rig.wheelbase / 2, forward, off, p);
        const hint = z + (Math.tan(pitch) * rig.wheelbase) / 2;
        const g = slopeAt(world, p.x, p.y, p.angle, rig.wheelbase, rig.width, hint);
        z = g.z - (g.grade * rig.wheelbase) / 2;
        pitch = g.pitch;
        const along = forward ? s : edge.len - s;
        const road = roadHeightAt(edge, along);
        out.worstOff = Math.max(out.worstOff, Math.abs(z - road));
        if (Math.abs(z - road) > 0.5) out.off.push({ along, z, road });
        if (out.steps >= 2) {
            const jump = Math.abs(z - last) / step;
            out.worstJump = Math.max(out.worstJump, jump);
            out.worstExcess = Math.max(out.worstExcess, jump - Math.max(0.15, Math.abs(road - lastRoad) / step + 0.1));
        }
        last = z;
        lastRoad = road;
        out.steps++;
    }
    return out;
}

/** The first of `years` in which both roads of a crossing are open (null if they never are together). */
export function crossingYear(world, c, years = [2024, 1965, 1919]) {
    const U = world.graph.edges[c.upper.edge], L = world.graph.edges[c.lower.edge];
    return years.find(y => edgeOpen(U, y) && edgeOpen(L, y)) ?? null;
}

/**
 * Drives both roads of a crossing in both directions, `reach` m either side of it, with each rig. Returns
 * {gap (the clearance, m), runs: [{road: 'upper'|'lower', forward, rig, ...driveAlong}], failures: [text]}: a failure
 * is a clearance under CLEARANCE, a vehicle more than 0.5 m off its own road's surface (it fell through or climbed
 * onto the other road), or a height step steeper than 0.15 m per metre that its own road does not climb there (by more
 * than STEP_EXCESS).
 */
export function driveThroughCrossing(world, c, { reach = 50, year = crossingYear(world, c) ?? 2024 } = {}) {
    const edges = world.graph.edges;
    const gap = crossingGap(edges, c);
    const failures = [];
    if (gap < CLEARANCE - 0.01) failures.push(`clearance ${gap.toFixed(2)} m`);
    const runs = [];
    for (const [role, side] of [['upper', c.upper], ['lower', c.lower]]) {
        const e = edges[side.edge];
        const from = Math.max(0, side.d - reach), to = Math.min(e.len, side.d + reach);
        if (to - from < 8) continue;
        for (const forward of [true, false]) {
            for (const rig of RIGS) {
                const r = driveAlong(world, e, from, to, { forward, year, rig });
                runs.push({ road: role, forward, rig: rig.name, ...r });
                if (r.off.length) failures.push(`${role} ${forward ? 'a>b' : 'b>a'} ${rig.name}: off its road by ${r.worstOff.toFixed(2)} m at ${r.off[0].along.toFixed(0)} m`);
                if (r.worstExcess > STEP_EXCESS) failures.push(`${role} ${forward ? 'a>b' : 'b>a'} ${rig.name}: height step ${r.worstJump.toFixed(2)} m/m, ${r.worstExcess.toFixed(2)} over its road's`);
            }
        }
    }
    return { gap, runs, failures };
}

/** Body lengths (m) of the rigs, for the parapet check. */
const BODY = { car: 4.2, lorry: 8 };

/**
 * Drives `rig` along `edge` over [from, to] m in its nearside lane, as driveAlong does, and counts the steps where its
 * body overlaps a bridge parapet on its own layer (phase 10: a vehicle in its lane must never touch a rail, at a deck's
 * ends or anywhere on it, nor one on the deck above when it drives the road below). Returns {steps, hits: [{along, z}]}.
 */
export function railHitsAlong(world, edge, from, to, { forward = true, year = 2024, rig = RIGS[0], step = 1 } = {}) {
    const off = laneOffset(edge, year), p = { x: 0, y: 0, angle: 0 }, buf = [];
    const out = { steps: 0, hits: [] };
    for (let s = forward ? from : edge.len - to; s <= (forward ? to : edge.len - from); s += step) {
        const along = forward ? s : edge.len - s;
        lanePoint(edge, s, forward, off, p);
        const z = roadHeightAt(edge, along);
        const box = obb(p.x, p.y, BODY[rig.name], rig.width, p.angle);
        for (const r of railsNear(world, p.x, p.y, 10, year, buf)) {
            if (railTouches(r, z) && sat(box, r.box)) { out.hits.push({ along, z, rail: r }); break; }
        }
        out.steps++;
    }
    return out;
}
