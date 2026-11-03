// Depots, loading bays and drop markers. A bay marker is where the REAR of the vehicle (or of its trailer) must
// stop, with the nose pointing out of the yard; door markers at customers only need the rear close by.
import { BAY } from '../config.js';

/** The rearmost point of the rig: the back of the trailer if one is coupled, else the back of the body. */
export function rearPoint(v, out = { x: 0, y: 0 }) {
    const t = v.trailer;
    if (t) {
        out.x = t.x - Math.cos(t.heading) * t.spec.rearOverhang;
        out.y = t.y - Math.sin(t.heading) * t.spec.rearOverhang;
        return out;
    }
    out.x = v.x - Math.cos(v.heading) * v.spec.rearOverhang;
    out.y = v.y - Math.sin(v.heading) * v.spec.rearOverhang;
    return out;
}

const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/**
 * Is the vehicle parked on a loading bay? Checks the rear position (<= 1.5 m), the heading of the rearmost body
 * (<= 15 degrees) and that it has stopped. Returns {ok, dist, angle, moving, reason}.
 */
export function bayCheck(v, marker, tol = BAY) {
    const rear = rearPoint(v);
    const dist = Math.hypot(rear.x - marker.x, rear.y - marker.y);
    const heading = v.trailer ? v.trailer.heading : v.heading;
    const angle = angleDiff(heading, marker.heading);
    const moving = Math.abs(v.speed) > tol.speed;
    let reason = null;
    if (dist > tol.position) reason = dist > 12 ? 'far' : 'position';
    else if (angle > tol.heading) reason = 'angle';
    else if (moving) reason = 'moving';
    return { ok: !reason, dist, angle, moving, reason };
}

/** Kerbside drops: any part of the rear within `radius` of the door marker, stopped. */
export function doorCheck(v, door, radius = 3.5) {
    const rear = rearPoint(v);
    const mid = { x: (v.x + rear.x) / 2, y: (v.y + rear.y) / 2 };
    const dist = Math.min(Math.hypot(rear.x - door.x, rear.y - door.y), Math.hypot(mid.x - door.x, mid.y - door.y));
    const moving = Math.abs(v.speed) > BAY.speed;
    const reason = dist > radius ? (dist > 15 ? 'far' : 'position') : moving ? 'moving' : null;
    return { ok: !reason, dist, angle: 0, moving, reason };
}

/** The depot whose yard the point is in, or null. */
export function depotAt(world, x, y) {
    const owner = world.yardAt(x, y);
    return owner?.type === 'depot' ? owner : null;
}

/** Spots along the side of a depot yard where spare vehicles park (nose out). */
export function parkingSpots(depot, count = 6) {
    const y = depot.yard;
    const vx = -y.uy, vy = y.ux;
    const out = [];
    for (let k = 0; k < count; k++) {
        const side = k % 2 ? 1 : -1;
        const row = Math.floor(k / 2);
        const along = 6 + row * 7;
        const off = side * (y.width / 2 - 3);
        out.push({ x: y.entry.x + y.ux * along + vx * off, y: y.entry.y + y.uy * along + vy * off, heading: Math.atan2(vy * -side, vx * -side) });
    }
    return out;
}

/** A short hint for the HUD from a bay/door check. */
export function bayHint(check, kind = 'bay') {
    switch (check.reason) {
        case 'far': return null;
        case 'position': return kind === 'door' ? `Pull up by the door marker (${check.dist.toFixed(1)} m off)` : `Reverse onto the bay marker (${check.dist.toFixed(1)} m off)`;
        case 'angle': return `Straighten up (${Math.round((check.angle * 180) / Math.PI)}° off)`;
        case 'moving': return kind === 'door' ? 'Stop to unload' : 'Stop to load';
        default: return null;
    }
}

/**
 * Where loose trailers stand in a depot yard: rear to the back wall, kingpin towards the gate (heading = nose-out),
 * either side of the loading bay. Returns axle-centre poses for a trailer spec.
 */
export function trailerSpots(depot, spec, count = 4) {
    const y = depot.yard;
    const vx = -y.uy, vy = y.ux;
    const along = y.depth - 1 - spec.rearOverhang;
    return [5.5, -5.5, 9.5, -9.5].slice(0, count).map(off => ({
        x: y.entry.x + y.ux * along + vx * off, y: y.entry.y + y.uy * along + vy * off, heading: y.marker.heading,
    }));
}
