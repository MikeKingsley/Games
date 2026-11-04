// Rigid vehicle: kinematic bicycle model with an engine/gearbox driveline, rolling resistance, aero drag, brakes
// and the ground's slope (gravity along the heading, engine braking, brake fade). The pose (x, y) is the rear-axle
// centre; heading 0 = east, +y south. Speed is signed along the heading (m/s). z/pitch/roll are kept for drawing.
import { createGearbox, driveForce, updateGearbox } from './gearbox.js';
import { obb, sat, resolve } from './collision.js';
import { G, slopeForce, gradeCos, HOLD_GRADE, fadeFactor, brakeFade, engineBrakeForce } from './slope.js';
import { trailerHasBrakes, trailerMass, hitchPush, TRAILER_BRAKE } from './trailer.js';

export { G };
const AIR = 1.2;
const STEER_SPEED_REF = 5;   // m/s: full lock is available below this, and falls off as 1/speed above it
const HANDBRAKE_FORCE = 0.35; // fraction of the vehicle's weight
/** Below this speed with no throttle a vehicle counts as stopped (held in gear on gentle grades). */
const HOLD_SPEED = 0.05;
/** How fast the drawn pitch and roll follow the ground (per second): a little suspension lag. */
const TILT_RATE = 10;

export function createVehicle(spec, { x = 0, y = 0, heading = 0 } = {}) {
    return {
        spec,
        x, y, heading, speed: 0, steer: 0,
        prevX: x, prevY: y, prevHeading: heading,
        /** Ground height under the rear axle (world m), and the body's pitch (+ nose up) and roll (+ leaning right). */
        z: 0, prevZ: 0, pitch: 0, roll: 0,
        /** Service brake heat (sim/slope.js brakeFade): 0 cold, fading from 1. */
        brakeHeat: 0,
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

/** The centre of the wheelbase: where the ground's slope under a vehicle is measured (world/terrain.js slopeAt). */
export function wheelbaseCentre(v, out = { x: 0, y: 0 }) {
    out.x = v.x + Math.cos(v.heading) * v.spec.wheelbase / 2;
    out.y = v.y + Math.sin(v.heading) * v.spec.wheelbase / 2;
    return out;
}

/**
 * Gravity along the heading on the rig (N): the tractor and its cargo on `grade`, a trailer on its own grade (along
 * its heading) pulling through the hitch at the articulation angle.
 */
export function rigGravity(v, grade, trailerGrade = grade) {
    const t = v.trailer;
    if (!t) return slopeForce(totalMass(v), grade);
    const own = v.spec.mass + v.cargoMass, tm = t.spec.mass + t.cargoMass;
    return slopeForce(own, grade) + slopeForce(tm, trailerGrade) * Math.cos(v.heading - t.heading);
}

/**
 * One fixed step. controls = {throttle 0..1, brake 0..1, steer -1..1, handbrake, reverse}.
 * env = {grip: 0..1 (rain lowers brake/steer force), drive: bool (false when out of fuel or jack-knifed), rolling (x
 * rolling resistance), grade (rise per metre ahead under the wheelbase), trailerGrade (along the trailer's heading),
 * pitch, roll and groundZ (the ground under the rear axle, for drawing), engineBrake (false: none, for tests)}.
 * On a grade gravity pulls along the heading: a vehicle stopped in gear with no throttle is held on grades up to
 * HOLD_GRADE and rolls on steeper ones unless braked. Off the throttle the engine brakes in gear; the service
 * brakes heat up and fade (v.brakeHeat).
 * Returns the longitudinal force summary (for audio, fuel and wear): {engine, load, yawRate, grade (the rig's
 * effective grade), brakeForce (service brakes, N), brakeWork (J this step)}.
 */
export function stepVehicle(v, controls, dt, env = {}) {
    const spec = v.spec;
    const grip = env.grip ?? 1;
    const mass = totalMass(v);
    v.prevX = v.x; v.prevY = v.y; v.prevHeading = v.heading; v.prevZ = v.z;

    // steering: rate-limited toward the requested angle, limited at speed (and by grip)
    const want = controls.steer * steerLimit(spec, v.speed) * (0.75 + 0.25 * grip);
    const maxDelta = spec.steerRate * dt;
    v.steer += Math.max(-maxDelta, Math.min(maxDelta, want - v.steer));

    // the slope: gravity on the whole rig, and the grade it amounts to (for the gearbox and the hold)
    const grade = env.grade ?? 0;
    const gravity = rigGravity(v, grade, env.trailerGrade ?? grade);
    const effGrade = -gravity / (mass * G);

    // rolling resistance and drag (env.rolling > 1 off the road: grass, mud)
    const rolling = spec.crr * (env.rolling ?? 1) * mass * G * gradeCos(grade);
    const aero = 0.5 * AIR * spec.cda * v.speed * v.speed;

    // driveline: the gearbox picks the gear (changing down sooner on climbs, never up into a gear that can't pull the
    // hill); reverse only near a standstill
    const gb = v.gearbox;
    if (controls.reverse !== gb.reverse && Math.abs(v.speed) < 0.5) gb.reverse = controls.reverse;
    updateGearbox(gb, spec, v.speed, controls.throttle, dt, effGrade, { need: Math.max(0, -gravity) + rolling + aero, mass });
    const dir = gb.reverse ? -1 : 1;
    const canDrive = env.drive !== false;
    const engine = canDrive ? driveForce(gb, spec, v.speed, controls.throttle) * v.power : 0;
    // stopped in gear with the throttle closed, gentle grades don't move it; steeper ones roll it away
    const held = Math.abs(v.speed) < HOLD_SPEED && controls.throttle <= 0 && Math.abs(effGrade) <= HOLD_GRADE;
    const pull = held ? 0 : gravity;

    // resistances oppose motion; a trailer from 1956 brakes itself too (all the brakes share the heat)
    const pedal = controls.brake * (0.6 + 0.4 * grip) * fadeFactor(v.brakeHeat);
    const t = v.trailer;
    const tractorBrakes = pedal * spec.brakeForce;
    const trailerBrakes = t && trailerHasBrakes(t.spec) ? pedal * TRAILER_BRAKE * G * trailerMass(t) : 0;
    const service = tractorBrakes + trailerBrakes;
    const handbrake = controls.handbrake ? HANDBRAKE_FORCE * mass * G * grip : 0;
    const engineBrake = env.engineBrake === false ? 0 : engineBrakeForce(gb, spec, v.speed, controls.throttle);
    const resist = rolling + aero + service + handbrake + engineBrake;
    // braking on the tractor's wheels alone, a trailer pushes on the fifth wheel (jack-knife risk: sim/trailer.js)
    const push = t ? hitchPush(v, t, tractorBrakes + handbrake + engineBrake) : 0;

    // the engine and gravity accelerate; resistances slow the vehicle toward a standstill but never push it backwards
    const before = v.speed;
    const speed = v.speed + ((dir * engine + pull) / mass) * dt;
    v.speed = speed - Math.sign(speed) * Math.min(Math.abs(speed), (resist / mass) * dt);

    // the service brakes turn the work they did into heat (and fade as they get hot)
    const roadSpeed = (Math.abs(before) + Math.abs(v.speed)) / 2;
    v.brakeHeat = brakeFade(v.brakeHeat, dt, service, roadSpeed, mass).heat;

    // kinematic bicycle: the rear axle follows its heading, the heading turns by v/L * tan(steer)
    const yawRate = (v.speed / spec.wheelbase) * Math.tan(v.steer);
    v.heading += yawRate * dt;
    if (v.heading > Math.PI) v.heading -= 2 * Math.PI;
    else if (v.heading < -Math.PI) v.heading += 2 * Math.PI;
    const step = v.speed * dt;
    v.x += Math.cos(v.heading) * step;
    v.y += Math.sin(v.heading) * step;
    v.odometer += Math.abs(step);

    // for drawing: the height follows the ground (env.groundZ is under the rear axle before this step's move, carried
    // along the slope), pitch and roll with a little lag
    if (env.groundZ !== undefined) v.z = env.groundZ + grade * step;
    const k = Math.min(1, dt * TILT_RATE);
    v.pitch += ((env.pitch ?? 0) - v.pitch) * k;
    v.roll += ((env.roll ?? 0) - v.roll) * k;
    return { engine, load: controls.throttle, yawRate, grade: effGrade, brakeForce: service, brakeWork: service * roadSpeed * dt, push };
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
