// Semi-trailer kinematics. The trailer pivots on the tractor's fifth wheel (f metres ahead of the tractor's rear
// axle); its axle is L1 (kingpin-to-axle) behind the kingpin. With tractor speed v and yaw rate w0, the standard
// off-axle hitch model gives the trailer's yaw rate:
//     theta1' = (v sin(phi) + w0 f cos(phi)) / L1,   phi = theta0 - theta1 (articulation)
// Driving forward the articulation settles; reversing it grows unless corrected (just like a real artic).
// Braking hard with a trailer that has no brakes of its own, the trailer pushes on the fifth wheel and swings out
// (jack-knife risk). A loose trailer on its legs rolls down a grade steeper than ~3% unless its parking brake is on.
import { obb } from './collision.js';
import { G, slopeForce, gradeCos } from './slope.js';

export const JACKKNIFE = (85 * Math.PI) / 180;

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

/** A trailer at a pose: (x, y) is the centre of its axle group, heading points from the axle to the kingpin. */
export function createTrailer(spec, { x = 0, y = 0, heading = 0 } = {}) {
    return {
        spec, x, y, heading, prevX: x, prevY: y, prevHeading: heading, cargoMass: 0, coupled: false, jackknifed: false,
        /** Loose trailers: rolling speed along the heading (m/s) and the parking brake (on unless left off on a hill). */
        speed: 0, parkBrake: true,
        /** Ground under the axle (world m), pitch (+ kingpin end up) and roll, for drawing. */
        z: 0, prevZ: 0, pitch: 0, roll: 0,
    };
}

export const trailerMass = t => t.spec.mass + t.cargoMass;

/** Trailers from 1956 have air brakes of their own, worked from the tractor (a spec can say otherwise). */
export const trailerHasBrakes = spec => spec.brakes ?? (spec.year ?? 0) >= 1956;
/** A braked trailer's brakes: this much deceleration per kg of trailer (x g) at full pedal. */
export const TRAILER_BRAKE = 0.2;

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

/** A braked trailer still puts this share of its push on the tractor (its own brakes take the rest). */
const BRAKED_PUSH = 0.2;
/**
 * The swing a push gives the trailer: PUSH_GAIN x (push / the tractor's weight - PUSH_FREE), against the
 * straightening of driving forward (1). Above 1 the articulation grows: an unbraked trailer much heavier than the
 * tractor, braked hard, swings out; a light one, or a braked one, does not.
 */
const PUSH_GAIN = 4, PUSH_FREE = 0.1;

/**
 * The trailer's push on the fifth wheel (N) when the tractor's own wheels slow the rig with `retard` N (service
 * brakes, handbrake, engine braking): its share of the rig's mass, for a trailer that can't brake itself; a braked
 * trailer (1956 on) takes most of its share.
 */
export function hitchPush(tractor, trailer, retard) {
    const tm = trailerMass(trailer);
    const push = (Math.max(0, retard) * tm) / (tractor.spec.mass + tractor.cargoMass + tm);
    return trailerHasBrakes(trailer.spec) ? push * BRAKED_PUSH : push;
}

/**
 * Advances a coupled trailer after the tractor has moved (call with the tractor's speed and yaw rate for the step,
 * and the push on the fifth wheel from hitchPush when braking). Returns null normally, 'jackknife' on the step it
 * first folds past the limit, and 'limit' while it is held there (the caller stops the tractor in both cases: the
 * rig can only move in the direction that unfolds it).
 */
export function stepTrailer(tractor, trailer, dt, v = tractor.speed, w0 = 0, push = 0) {
    trailer.prevX = trailer.x; trailer.prevY = trailer.y; trailer.prevHeading = trailer.heading;
    const L1 = trailer.spec.axle;
    const f = tractor.spec.fifthWheel ?? 0;
    // a push while going forward swings the trailer out (the articulation grows if it beats the straightening)
    const weight = (tractor.spec.mass + tractor.cargoMass) * G;
    const swing = PUSH_GAIN * Math.max(0, push / weight - PUSH_FREE) * Math.max(0, v);
    // Heun's method: the tractor's heading at the start and the end of the step (it has already moved)
    const rate = phi => ((v - swing) * Math.sin(phi) + w0 * f * Math.cos(phi)) / L1;
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

/**
 * A loose trailer standing on its legs rolls along its heading when the grade beats the drag of its legs and
 * tyres (LEG_DRAG, so from about 3%), unless its parking brake is on. `grade` is along its heading (+ when the
 * kingpin end is higher). Returns the distance moved (m, signed along the heading); the caller checks collisions.
 */
export const LEG_DRAG = 0.03;
export function stepLooseTrailer(trailer, grade, dt) {
    trailer.prevX = trailer.x; trailer.prevY = trailer.y; trailer.prevHeading = trailer.heading;
    if (trailer.coupled || trailer.parkBrake) { trailer.speed = 0; return 0; }
    const mass = trailerMass(trailer);
    const speed = (trailer.speed ?? 0) + (slopeForce(mass, grade) / mass) * dt;
    const drag = LEG_DRAG * G * gradeCos(grade) * dt;
    trailer.speed = speed - Math.sign(speed) * Math.min(Math.abs(speed), drag);
    const step = trailer.speed * dt;
    trailer.x += Math.cos(trailer.heading) * step;
    trailer.y += Math.sin(trailer.heading) * step;
    return step;
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

/** Plain data for saving (the career keeps this on its trailer record; the height settles onto the ground on load). */
export const trailerState = t => ({ x: t.x, y: t.y, heading: t.heading, cargoMass: t.cargoMass, parkBrake: t.parkBrake !== false });
