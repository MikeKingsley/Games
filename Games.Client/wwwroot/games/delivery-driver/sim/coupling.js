// Coupling and uncoupling a tractor unit and a semi-trailer. Reverse the fifth wheel under the kingpin (within
// 0.4 m, headings within 10 degrees, almost stopped) and press C. Uncoupling (C while stopped) lowers the landing
// legs and leaves the trailer where it stands.
import { COUPLE } from '../config.js';
import { hitchPoint, kingpin, attach } from './trailer.js';

const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** Why a tractor can't couple to a trailer right now (null if it can): {reason, dist, angle}. */
export function couplingCheck(tractor, trailer, tol = COUPLE) {
    if (!tractor.spec.tags?.includes('tractor-unit')) return { reason: 'notTractor' };
    if (tractor.trailer) return { reason: 'hasTrailer' };
    if (trailer.coupled) return { reason: 'taken' };
    const h = hitchPoint(tractor), k = kingpin(trailer);
    const dist = Math.hypot(h.x - k.x, h.y - k.y);
    const angle = angleDiff(tractor.heading, trailer.heading);
    if (dist > tol.distance) return { reason: dist > 8 ? 'far' : 'position', dist, angle };
    if (angle > tol.heading) return { reason: 'angle', dist, angle };
    if (Math.abs(tractor.speed) > tol.speed) return { reason: 'moving', dist, angle };
    return null;
}

/** Couples if the check passes. Returns true on success. */
export function couple(tractor, trailer) {
    if (couplingCheck(tractor, trailer)) return false;
    tractor.trailer = trailer;
    trailer.coupled = true;
    trailer.legsDown = false;
    trailer.jackknifed = false;
    attach(tractor, trailer); // snap the last few centimetres
    trailer.prevX = trailer.x; trailer.prevY = trailer.y; trailer.prevHeading = trailer.heading;
    return true;
}

/** Uncouples when (almost) stopped; the trailer keeps its pose. Returns the trailer or null. */
export function uncouple(tractor) {
    const t = tractor.trailer;
    if (!t || Math.abs(tractor.speed) > COUPLE.speed) return null;
    tractor.trailer = null;
    t.coupled = false;
    t.legsDown = true;
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

/** HUD hint for lining up under a trailer. */
export function couplingHint(check) {
    if (!check) return 'Press C to couple';
    switch (check.reason) {
        case 'position': return `Reverse under the trailer (${check.dist.toFixed(1)} m to the kingpin)`;
        case 'angle': return `Line up with the trailer (${Math.round((check.angle * 180) / Math.PI)}° off)`;
        case 'moving': return 'Stop to couple';
        default: return null;
    }
}
