// Rigid vehicle: kinematic bicycle model with an engine/gearbox driveline, rolling resistance, aero drag and brakes.
// The pose (x, y) is the rear-axle centre; heading 0 = east, +y south. Speed is signed along the heading (m/s).
import { createGearbox, driveForce, updateGearbox } from './gearbox.js';
import { obb, sat, resolve } from './collision.js';

export const G = 9.81;
const AIR = 1.2;
const STEER_SPEED_REF = 5;   // m/s: full lock is available below this, and falls off as 1/speed above it
const HANDBRAKE_FORCE = 0.35; // fraction of the vehicle's weight

export function createVehicle(spec, { x = 0, y = 0, heading = 0 } = {}) {
    return {
        spec,
        x, y, heading, speed: 0, steer: 0,
        prevX: x, prevY: y, prevHeading: heading,
        cargoMass: 0,
        gearbox: createGearbox(spec),
        /** 0..1 multipliers set by the economy (damage, wear, out of fuel). */
        power: 1,
        trailer: null,
        odometer: 0,
    };
}

export function totalMass(v) {
    return v.spec.mass + v.cargoMass + (v.trailer ? v.trailer.spec.mass + v.trailer.cargoMass : 0);
}

/** Steering lock available at a speed: the full max steer at low speed, less at speed (stability). */
export function steerLimit(spec, speed) {
    const s = Math.abs(speed);
    return spec.maxSteer * (s <= STEER_SPEED_REF ? 1 : Math.max(0.12, STEER_SPEED_REF / s));
}

/** Turning radius of the rear axle at a steer angle (bicycle model). */
export const turningRadius = (spec, steer) => spec.wheelbase / Math.tan(Math.abs(steer));

/** Body centre (for drawing and collision): forward of the rear axle by length/2 - rearOverhang. */
export function bodyCentre(v, out = { x: 0, y: 0 }) {
    const off = v.spec.length / 2 - v.spec.rearOverhang;
    out.x = v.x + Math.cos(v.heading) * off;
    out.y = v.y + Math.sin(v.heading) * off;
    return out;
}

/**
 * One fixed step. controls = {throttle 0..1, brake 0..1, steer -1..1, handbrake, reverse}.
 * env = {grip: 0..1 (rain lowers brake/steer force), drive: bool (false when out of fuel or jack-knifed), rolling (x rolling resistance)}.
 * Returns the longitudinal force summary (useful for audio and fuel).
 */
export function stepVehicle(v, controls, dt, env = {}) {
    const spec = v.spec;
    const grip = env.grip ?? 1;
    const mass = totalMass(v);
    v.prevX = v.x; v.prevY = v.y; v.prevHeading = v.heading;

    // steering: rate-limited toward the requested angle, limited at speed (and by grip)
    const want = controls.steer * steerLimit(spec, v.speed) * (0.75 + 0.25 * grip);
    const maxDelta = spec.steerRate * dt;
    v.steer += Math.max(-maxDelta, Math.min(maxDelta, want - v.steer));

    // driveline: the gearbox picks the gear; reverse is selected only near a standstill
    const gb = v.gearbox;
    if (controls.reverse !== gb.reverse && Math.abs(v.speed) < 0.5) gb.reverse = controls.reverse;
    updateGearbox(gb, spec, v.speed, controls.throttle, dt);
    const dir = gb.reverse ? -1 : 1;
    const canDrive = env.drive !== false;
    const engine = canDrive ? driveForce(gb, spec, v.speed, controls.throttle) * v.power : 0;

    // resistances oppose motion
    const rolling = spec.crr * (env.rolling ?? 1) * mass * G; // env.rolling > 1 off the road (grass, mud)
    const aero = 0.5 * AIR * spec.cda * v.speed * v.speed;
    const brake = controls.brake * spec.brakeForce * (0.6 + 0.4 * grip) + (controls.handbrake ? HANDBRAKE_FORCE * mass * G * grip : 0);
    const resist = rolling + aero + brake;

    // resistances slow the vehicle toward a standstill but never push it backwards
    const speed = v.speed + ((dir * engine) / mass) * dt;
    v.speed = speed - Math.sign(speed) * Math.min(Math.abs(speed), (resist / mass) * dt);

    // kinematic bicycle: the rear axle follows its heading, the heading turns by v/L * tan(steer)
    const yawRate = (v.speed / spec.wheelbase) * Math.tan(v.steer);
    v.heading += yawRate * dt;
    if (v.heading > Math.PI) v.heading -= 2 * Math.PI;
    else if (v.heading < -Math.PI) v.heading += 2 * Math.PI;
    const step = v.speed * dt;
    v.x += Math.cos(v.heading) * step;
    v.y += Math.sin(v.heading) * step;
    v.odometer += Math.abs(step);
    return { engine, load: controls.throttle, yawRate };
}

/** The vehicle body as an OBB (for collisions). */
export function vehicleObb(v) {
    const c = bodyCentre(v);
    return obb(c.x, c.y, v.spec.length, v.spec.width, v.heading);
}

/**
 * Collides the vehicle against an obstacle OBB (static, or moving with {vx, vy, invMass}). Pushes the vehicle out,
 * kills the speed going into the obstacle and returns the impact speed (m/s), or 0 when not touching.
 */
export function collideVehicle(v, other) {
    const box = vehicleObb(v);
    const contact = sat(box, other);
    if (!contact) return 0;
    const body = { x: box.x, y: box.y, vx: Math.cos(v.heading) * v.speed, vy: Math.sin(v.heading) * v.speed, invMass: 1 };
    const impact = resolve(body, other, contact, 0.1);
    v.x += body.x - box.x;
    v.y += body.y - box.y;
    v.speed = body.vx * Math.cos(v.heading) + body.vy * Math.sin(v.heading);
    return impact;
}
