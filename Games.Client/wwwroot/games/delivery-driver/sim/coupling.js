// Coupling and uncoupling a tractor unit and a semi-trailer. Reverse the fifth wheel under the kingpin (within
// 0.4 m, headings within 10 degrees, almost stopped, the kingpin within 0.25 m of the fifth wheel's height on
// uneven ground) and press C. Uncoupling (C while stopped) lowers the landing legs and leaves the trailer where it
// stands, with its parking brake on if the ground is gentle; on a steeper grade the driver has to set it (hold the
// handbrake beside it) or it rolls away.
import { COUPLE } from '../config.js';
import { hitchPoint, kingpin, attach, trailerObb } from './trailer.js';

const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** Uncoupled on grades gentler than this, a trailer's parking brake goes on by itself. */
export const PARK_AUTO_GRADE = 0.03;
/** Fifth wheel and kingpin plate height above the ground (the landing legs hold a loose trailer at this). */
const PLATE_HEIGHT = 1.1;
/** The landing legs stand this far behind the kingpin. */
const LEGS_BEHIND = 1;

/**
 * Heights (world m) of a tractor's fifth wheel and a loose trailer's kingpin on a ground height function
 * `ground(x, y)`: the fifth wheel rides the tractor's chassis (the line through its axles' contact points), the
 * kingpin the trailer's (its axle and its legs). {fifth, pin, dz = pin - fifth}.
 */
export function couplingHeights(tractor, trailer, ground) {
    const wb = tractor.spec.wheelbase, f = tractor.spec.fifthWheel ?? 0;
    const c = Math.cos(tractor.heading), s = Math.sin(tractor.heading);
    const zr = ground(tractor.x, tractor.y), zf = ground(tractor.x + c * wb, tractor.y + s * wb);
    const fifth = zr + ((zf - zr) * f) / wb + PLATE_HEIGHT;
    const L1 = trailer.spec.axle, legs = Math.max(0.5, L1 - LEGS_BEHIND);
    const ct = Math.cos(trailer.heading), st = Math.sin(trailer.heading);
    const za = ground(trailer.x, trailer.y), zl = ground(trailer.x + ct * legs, trailer.y + st * legs);
    const pin = za + ((zl - za) * L1) / legs + PLATE_HEIGHT;
    return { fifth, pin, dz: pin - fifth };
}

/**
 * Why a tractor can't couple to a trailer right now (null if it can): {reason, dist, angle, dz}. With a ground
 * height function, the kingpin must also be within tol.height of the fifth wheel (uneven ground can put them apart).
 */
export function couplingCheck(tractor, trailer, tol = COUPLE, ground = null) {
    if (!tractor.spec.tags?.includes('tractor-unit')) return { reason: 'notTractor' };
    if (tractor.trailer) return { reason: 'hasTrailer' };
    if (trailer.coupled) return { reason: 'taken' };
    const h = hitchPoint(tractor), k = kingpin(trailer);
    const dist = Math.hypot(h.x - k.x, h.y - k.y);
    const angle = angleDiff(tractor.heading, trailer.heading);
    if (dist > tol.distance) return { reason: dist > 8 ? 'far' : 'position', dist, angle };
    if (angle > tol.heading) return { reason: 'angle', dist, angle };
    if (Math.abs(tractor.speed) > tol.speed || Math.abs(trailer.speed ?? 0) > tol.speed) return { reason: 'moving', dist, angle };
    if (ground) {
        const { dz } = couplingHeights(tractor, trailer, ground);
        if (Math.abs(dz) > (tol.height ?? COUPLE.height)) return { reason: 'height', dist, angle, dz };
    }
    return null;
}

/** Couples if the check passes (on `ground`, if given). Returns true on success. */
export function couple(tractor, trailer, ground = null) {
    if (couplingCheck(tractor, trailer, COUPLE, ground)) return false;
    tractor.trailer = trailer;
    trailer.coupled = true;
    trailer.legsDown = false;
    trailer.jackknifed = false;
    trailer.parkBrake = false; // its brakes are worked from the tractor now
    trailer.speed = 0;
    attach(tractor, trailer); // snap the last few centimetres
    trailer.prevX = trailer.x; trailer.prevY = trailer.y; trailer.prevHeading = trailer.heading;
    return true;
}

/**
 * Uncouples when (almost) stopped; the trailer keeps its pose. `grade` is the ground's grade along the trailer:
 * gentler than PARK_AUTO_GRADE its parking brake goes on by itself, steeper it is left off (hold the handbrake
 * beside it to set it). Returns the trailer or null.
 */
export function uncouple(tractor, grade = 0) {
    const t = tractor.trailer;
    if (!t || Math.abs(tractor.speed) > COUPLE.speed) return null;
    tractor.trailer = null;
    t.coupled = false;
    t.legsDown = true;
    t.speed = 0;
    t.parkBrake = Math.abs(grade) < PARK_AUTO_GRADE;
    return t;
}

/** The nearest loose trailer to the fifth wheel within `range` metres. */
export function nearestTrailer(tractor, trailers, range = 10) {
    const h = hitchPoint(tractor);
    let best = null, bestD = range;
    for (const t of trailers) {
        if (t.coupled) continue;
        const k = kingpin(t);
        const d = Math.hypot(h.x - k.x, h.y - k.y);
        if (d < bestD) { best = t; bestD = d; }
    }
    return best;
}

/** Distance from a point to an OBB (0 inside). */
function boxDistance(b, x, y) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    const lx = (x - b.x) * c + (y - b.y) * s, ly = -(x - b.x) * s + (y - b.y) * c;
    return Math.hypot(Math.max(0, Math.abs(lx) - b.hx), Math.max(0, Math.abs(ly) - b.hy));
}

/** The nearest loose trailer with its parking brake off within `range` m of a point (the driver's cab), or null. */
export function unbrakedTrailerNear(trailers, x, y, range = 12) {
    let best = null, bestD = range;
    for (const t of trailers) {
        if (t.coupled || t.parkBrake) continue;
        const d = boxDistance(trailerObb(t), x, y);
        if (d < bestD) { best = t; bestD = d; }
    }
    return best;
}

/** HUD hint for lining up under a trailer. */
export function couplingHint(check) {
    if (!check) return 'Press C to couple';
    switch (check.reason) {
        case 'position': return `Reverse under the trailer (${check.dist.toFixed(1)} m to the kingpin)`;
        case 'angle': return `Line up with the trailer (${Math.round((check.angle * 180) / Math.PI)}° off)`;
        case 'moving': return 'Stop to couple';
        case 'height': return `The ground is too uneven to couple here (kingpin ${Math.abs(check.dz).toFixed(2)} m ${check.dz > 0 ? 'high' : 'low'})`;
        default: return null;
    }
}
