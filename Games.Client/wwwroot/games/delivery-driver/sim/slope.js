// Slope physics (pure, DOM-free): gravity along a grade, brake heat and fade, and engine braking. A grade is the
// rise per metre along the heading (+ uphill, - downhill), as world/terrain.js slopeAt gives it. Forces in N,
// speeds in m/s (signed along the heading, as sim/vehicle.js keeps them), masses in kg.
import { rpmAt, ratio, torqueAt, EFFICIENCY } from './gearbox.js';

export const G = 9.81;

/** sin and cos of a grade's angle (atan(grade)). */
export const gradeSin = grade => grade / Math.sqrt(1 + grade * grade);
export const gradeCos = grade => 1 / Math.sqrt(1 + grade * grade);

/**
 * Gravity's component along the heading on a grade: -m g sin(theta), theta = atan(grade). Negative uphill (it pulls
 * the vehicle back), positive downhill. Add it to the driving force; it acts the same way whichever way the vehicle
 * is moving.
 */
export function slopeForce(mass, grade) {
    return -mass * G * gradeSin(grade);
}

/** Stopped in gear with no throttle, the drivetrain holds a vehicle on grades up to this; steeper, it rolls. */
export const HOLD_GRADE = 0.03;

/** Fuel per distance on a grade relative to the flat: +12% per 1% climbed, -8% per 1% descended, never below 0.3. */
export const FUEL_UPHILL = 12, FUEL_DOWNHILL = 8, FUEL_FLOOR = 0.3;
/** The fuel multiplier for driving along a grade (+ uphill in the direction of travel). Monotonic in the grade. */
export const gradeFuelFactor = grade => Math.max(FUEL_FLOOR, 1 + (grade > 0 ? FUEL_UPHILL : FUEL_DOWNHILL) * grade);

// ---- Brake heat and fade ---------------------------------------------------------------------------------------

/**
 * Brake heat is in units where fade starts at 1 (about 320 C) and is full at FADE_FULL, where the brakes keep
 * FADE_MIN of their force. Heat comes from the work the service brakes do, per kg of vehicle (brakes are sized to
 * the vehicle): a stop from 15 m/s adds ~0.55, so a few hard stops in a row or a long descent on the brakes fade
 * them. They cool toward ambient, faster with airflow.
 */
const HEAT_PER_J = 1 / 200, COOL_BASE = 0.01, COOL_SPEED = 0.001, FADE_FULL = 2.2;
export const FADE_MIN = 0.35;

const smoothstep = (e0, e1, x) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
};

/** Brake effectiveness (1 cold .. FADE_MIN) at a heat. */
export const fadeFactor = heat => 1 - (1 - FADE_MIN) * smoothstep(1, FADE_FULL, heat);

/** Brake temperature for the HUD (degrees C) from the heat. */
export const brakeTemperature = heat => Math.round(20 + 300 * heat);

/**
 * One step of brake heat. `brakeForce` is the force the service brakes applied this step (N, after fade), `speed`
 * the road speed and `mass` the vehicle's (or rig's) total mass. Returns {heat, factor}: the new heat and the
 * brakes' effectiveness at it (1 cold, falling to FADE_MIN when cooked). Holding a loaded lorry at 10 m/s down an
 * 8% grade on the brakes alone starts them fading after ~45 s; half a minute off the brakes cools them again.
 */
export function brakeFade(heat, dt, brakeForce, speed, mass) {
    const work = Math.abs(brakeForce * speed) * dt;
    const cool = Math.min(1, (COOL_BASE + COOL_SPEED * Math.abs(speed)) * dt);
    const next = Math.max(0, heat * (1 - cool) + (work / Math.max(1, mass)) * HEAT_PER_J);
    return { heat: next, factor: fadeFactor(next) };
}

// ---- Engine braking ---------------------------------------------------------------------------------------------

/**
 * Engine drag with the throttle closed, as a fraction of peak torque at max RPM (rising from nothing at idle, and
 * on past max RPM when the road over-revs the engine, up to OVER_REV). Lorries with air brakes (1948 on) also have
 * an exhaust brake. It fades out over the first OFF_THROTTLE of pedal travel (any real throttle drives).
 */
const ENGINE_DRAG = 0.25, EXHAUST_BRAKE = 1.6, OVER_REV = 1.6, OFF_THROTTLE = 0.1;
/** Below this road speed the clutch is slipping, so the engine neither drives nor brakes the wheels. */
const CLUTCH_SPEED = 1;

/** Engine braking torque (N m at the crank, >= 0) at an RPM and throttle: only off the throttle, none at idle. */
export function engineBraking(spec, rpm, throttle) {
    const closed = Math.max(0, 1 - Math.max(0, throttle) / OFF_THROTTLE);
    if (closed === 0) return 0;
    const e = spec.engine;
    const r = Math.min(OVER_REV, Math.max(0, (rpm - e.idleRpm) / (e.maxRpm - e.idleRpm)));
    return e.torque * ENGINE_DRAG * (spec.airBrakes ? EXHAUST_BRAKE : 1) * r * closed;
}

/**
 * Engine braking at the wheels (N, >= 0; the caller applies it against the motion): the drag torque through the
 * gear in use. None while shifting (clutch in), near a standstill, or when rolling against the selected direction
 * (a lorry rolling back in a forward gear).
 */
export function engineBrakeForce(gb, spec, speed, throttle) {
    if (gb.shiftTimer > 0 || Math.abs(speed) < CLUTCH_SPEED) return 0;
    if ((gb.reverse ? -1 : 1) * speed < 0) return 0;
    return (engineBraking(spec, rpmAt(gb, spec, speed), throttle) * ratio(gb, spec) * EFFICIENCY) / spec.wheelRadius;
}

// ---- Hills for route planning, the off-screen fleet and traffic ------------------------------------------------

/** Peak engine power (W at the crank), from the torque curve (sampled); cached per spec. */
const powers = new WeakMap();
export function enginePower(spec) {
    let p = powers.get(spec);
    if (p === undefined) {
        const e = spec.engine;
        p = 0;
        for (let k = 0; k <= 64; k++) {
            const rpm = e.idleRpm + ((e.maxRpm - e.idleRpm) * k) / 64;
            p = Math.max(p, torqueAt(spec, rpm) * ((rpm * 2 * Math.PI) / 60));
        }
        powers.set(spec, p);
    }
    return p;
}

/**
 * A vehicle's hill-climbing model for planning: {power (W at the wheels), mass (kg), crr}. `extraMass` is its load
 * (cargo, and a trailer with its cargo).
 */
export const climbModel = (spec, extraMass = 0) => ({ power: enginePower(spec) * EFFICIENCY, mass: spec.mass + extraMass, crr: spec.crr ?? 0.012 });

/** A typical loaded lorry (~7.5 W/kg), for routes planned without a vehicle. */
export const TYPICAL_CLIMB = { power: 60000, mass: 8000, crr: 0.012 };

/** The steady speed full power holds up a grade (m/s; drag ignored); Infinity when not climbing. */
export function climbSpeed(model, grade) {
    if (grade <= 0) return Infinity;
    return model.power / (model.mass * G * (grade + model.crr));
}

/** Descending, heavy vehicles hold back on steep grades: a speed factor, 1 down to 5% and 0.6 by 15%. */
export const descentFactor = grade => (grade >= -0.05 ? 1 : Math.max(0.6, 1 - 4 * (-grade - 0.05)));

/** Speed on a stretch of `grade` (along the travel) for a cruising speed: held down by power uphill, held back down steep hills. */
export const hillSpeed = (model, grade, cruise) => (grade > 0 ? Math.min(cruise, climbSpeed(model, grade)) : cruise * descentFactor(grade));
