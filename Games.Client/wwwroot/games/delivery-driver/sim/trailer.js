// Semi-trailer kinematics. The trailer pivots on the tractor's fifth wheel (f metres ahead of the tractor's rear
// axle); its axle is L1 (kingpin-to-axle) behind the kingpin. With tractor speed v and yaw rate w0, the standard
// off-axle hitch model gives the trailer's yaw rate:
//     theta1' = (v sin(phi) + w0 f cos(phi)) / L1,   phi = theta0 - theta1 (articulation)
// Driving forward the articulation settles; reversing it grows unless corrected (just like a real artic).
import { obb } from './collision.js';

export const JACKKNIFE = (85 * Math.PI) / 180;

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

/** A trailer at a pose: (x, y) is the centre of its axle group, heading points from the axle to the kingpin. */
export function createTrailer(spec, { x = 0, y = 0, heading = 0 } = {}) {
    return { spec, x, y, heading, prevX: x, prevY: y, prevHeading: heading, cargoMass: 0, coupled: false, jackknifed: false };
}

/** The fifth-wheel (hitch) point of a tractor. */
export function hitchPoint(tractor, out = { x: 0, y: 0 }) {
    const f = tractor.spec.fifthWheel ?? 0;
    out.x = tractor.x + Math.cos(tractor.heading) * f;
    out.y = tractor.y + Math.sin(tractor.heading) * f;
    return out;
}

/** The trailer's kingpin. */
export function kingpin(trailer, out = { x: 0, y: 0 }) {
    out.x = trailer.x + Math.cos(trailer.heading) * trailer.spec.axle;
    out.y = trailer.y + Math.sin(trailer.heading) * trailer.spec.axle;
    return out;
}

export const articulation = (tractor, trailer) => wrap(tractor.heading - trailer.heading);

/** Puts a coupled trailer's kingpin exactly on the hitch, keeping its heading. */
export function attach(tractor, trailer) {
    const h = hitchPoint(tractor);
    trailer.x = h.x - Math.cos(trailer.heading) * trailer.spec.axle;
    trailer.y = h.y - Math.sin(trailer.heading) * trailer.spec.axle;
}

/**
 * Advances a coupled trailer after the tractor has moved (call with the tractor's speed and yaw rate for the step).
 * Returns null normally, 'jackknife' on the step it first folds past the limit, and 'limit' while it is held
 * there (the caller stops the tractor in both cases: the rig can only move in the direction that unfolds it).
 */
export function stepTrailer(tractor, trailer, dt, v = tractor.speed, w0 = 0) {
    trailer.prevX = trailer.x; trailer.prevY = trailer.y; trailer.prevHeading = trailer.heading;
    const L1 = trailer.spec.axle;
    const f = tractor.spec.fifthWheel ?? 0;
    // Heun's method: the tractor's heading at the start and the end of the step (it has already moved)
    const rate = phi => (v * Math.sin(phi) + w0 * f * Math.cos(phi)) / L1;
    const h0 = tractor.prevHeading ?? tractor.heading;
    const k1 = rate(wrap(h0 - trailer.heading));
    const k2 = rate(wrap(tractor.heading - (trailer.heading + k1 * dt)));
    trailer.heading = wrap(trailer.heading + ((k1 + k2) / 2) * dt);
    let result = null;
    const after = wrap(tractor.heading - trailer.heading);
    if (Math.abs(after) > JACKKNIFE) {
        trailer.heading = wrap(tractor.heading - Math.sign(after) * JACKKNIFE);
        result = trailer.jackknifed ? 'limit' : 'jackknife';
        trailer.jackknifed = true;
    } else if (Math.abs(after) < JACKKNIFE - 0.1) {
        trailer.jackknifed = false;
    }
    attach(tractor, trailer);
    return result;
}

/** Steady-state articulation when the tractor's rear axle runs on a circle of radius R0 (analytic). */
export function steadyArticulation(R0, f, L1) {
    return Math.asin(Math.min(1, L1 / Math.hypot(R0, f))) - Math.atan2(f, R0);
}

/**
 * The trailer body as an OBB. `cut` trims that many metres off the front (the overhang a tractor unit reverses
 * under to couple).
 */
export function trailerObb(trailer, cut = 0) {
    const s = trailer.spec;
    const len = Math.max(1, s.length - cut);
    const off = len / 2 - s.rearOverhang;
    return obb(trailer.x + Math.cos(trailer.heading) * off, trailer.y + Math.sin(trailer.heading) * off, len, s.width, trailer.heading);
}

/** Front overhang a tractor's rear can slide under: from the nose to 3 m behind the kingpin. */
export const underRun = spec => spec.kingpin + 3;

/** Rear-axle-style pose for drawing (the drawer measures from the rear of the body by rearOverhang). */
export const trailerPose = t => ({ x: t.x, y: t.y, heading: t.heading });

/** Plain data for saving (the career keeps this on its trailer record). */
export const trailerState = t => ({ x: t.x, y: t.y, heading: t.heading, cargoMass: t.cargoMass });
