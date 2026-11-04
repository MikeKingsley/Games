// Gearbox and engine: RPM from wheel speed, a torque curve, automatic shift points with a short drive-less
// shift delay, and an optional manual mode (gear up/down keys). spec.engine = {torque, peakRpm, idleRpm, maxRpm}.

/** Driveline efficiency (crank to wheels), both driving and engine braking. */
export const EFFICIENCY = 0.85;
const RAD_TO_RPM = 60 / (2 * Math.PI);

export function createGearbox(spec) {
    return { gear: 1, reverse: false, manual: false, shiftTimer: 0, rpm: spec.engine.idleRpm };
}

/** Overall ratio (gear x final drive) for the current gear or reverse. */
export function ratio(gb, spec, gear = gb.gear) {
    return (gb.reverse ? spec.reverseRatio : spec.gears[gear - 1]) * spec.finalDrive;
}

/** Engine RPM the wheels would turn it at in a gear (no clutch slip; never below idle). */
export function rpmAt(gb, spec, speed, gear = gb.gear) {
    return Math.max(spec.engine.idleRpm, (Math.abs(speed) / spec.wheelRadius) * ratio(gb, spec, gear) * RAD_TO_RPM);
}

/** Torque curve: a parabola peaking at peakRpm, 55% at idle, faded to zero by a governor over the last 5% of RPM. */
export function torqueAt(spec, rpm) {
    const e = spec.engine;
    if (rpm >= e.maxRpm) return 0;
    const span = rpm < e.peakRpm ? e.peakRpm - e.idleRpm : e.maxRpm - e.peakRpm;
    const k = (rpm - e.peakRpm) / Math.max(1, span);
    const drop = rpm < e.peakRpm ? 0.45 : 0.35;
    const governor = Math.min(1, (e.maxRpm - rpm) / (0.05 * e.maxRpm));
    return e.torque * Math.max(0, 1 - drop * k * k) * governor;
}

/**
 * Shift points as fractions of max RPM, for a grade (rise per metre ahead). On the flat: up at 92% (75% on a light
 * throttle), down when the lower gear would turn under 68%. Climbing (full effect from 6%), the box changes down
 * sooner (up to 85%) and holds the lower gear longer (up to 97% / 95%) for the torque; coasting down a descent
 * steeper than 3% it holds its gear (up at 95%) so the engine keeps braking.
 */
export function shiftPoints(throttle, grade = 0) {
    const climb = Math.max(0, Math.min(1, grade / 0.06));
    if (grade < -0.03 && throttle <= 0.05) return { up: 0.95, down: 0.68 };
    return { up: throttle > 0.5 ? 0.92 + 0.05 * climb : 0.75 + 0.2 * climb, down: 0.68 + 0.17 * climb };
}

/** Tractive force (N) a gear would give at a road speed and throttle (forward gears). */
const forceIn = (gb, spec, gear, speed, throttle) => (throttle * torqueAt(spec, rpmAt(gb, spec, speed, gear)) * ratio(gb, spec, gear) * EFFICIENCY) / spec.wheelRadius;

/**
 * On a climb, an up-shift has to leave the next gear able to pull: at the speed it will have slowed to by the end of
 * the shift (no drive meanwhile), it must give UPSHIFT_MARGIN x the force needed to hold speed, or the box keeps the
 * lower gear (no hunting between a gear that can't hold the hill and one that can).
 */
const UPSHIFT_MARGIN = 1.15;
function canPullUp(gb, spec, speed, throttle, load) {
    const after = Math.max(0, Math.abs(speed) - (load.need / Math.max(1, load.mass)) * (spec.shiftTime ?? 0.3));
    return forceIn(gb, spec, gb.gear + 1, after, throttle) >= load.need * UPSHIFT_MARGIN;
}

/**
 * Automatic shifting (or manual gear holding), and the shift delay. Also sets gb.rpm for audio. `grade` (rise per
 * metre ahead) moves the shift points (shiftPoints); on a climb `load` = {need (N to hold the speed), mass (kg)}
 * stops up-shifts the next gear couldn't pull.
 */
export function updateGearbox(gb, spec, speed, throttle, dt, grade = 0, load = null) {
    if (gb.shiftTimer > 0) gb.shiftTimer = Math.max(0, gb.shiftTimer - dt);
    const n = spec.gears.length;
    if (!gb.manual && !gb.reverse && gb.shiftTimer === 0) {
        const rpm = rpmAt(gb, spec, speed);
        const at = shiftPoints(throttle, grade);
        const climbing = grade > 0.01 && load && throttle > 0;
        if (rpm > spec.engine.maxRpm * at.up && gb.gear < n && (!climbing || canPullUp(gb, spec, speed, throttle, load))) shift(gb, spec, +1);
        else if (gb.gear > 1 && rpmAt(gb, spec, speed, gb.gear - 1) < spec.engine.maxRpm * at.down) shift(gb, spec, -1);
    }
    if (gb.reverse) gb.gear = 1;
    // free revving with the clutch in while shifting, or at a standstill
    const wheelRpm = rpmAt(gb, spec, speed);
    const freeRpm = spec.engine.idleRpm + throttle * (spec.engine.maxRpm - spec.engine.idleRpm) * 0.6;
    const target = gb.shiftTimer > 0 || Math.abs(speed) < 0.3 ? Math.max(wheelRpm, freeRpm) : wheelRpm;
    gb.rpm += (target - gb.rpm) * Math.min(1, dt * 12);
}

export function shift(gb, spec, delta) {
    const next = Math.max(1, Math.min(spec.gears.length, gb.gear + delta));
    if (next === gb.gear) return false;
    gb.gear = next;
    gb.shiftTimer = spec.shiftTime ?? 0.3;
    return true;
}

/** Tractive force at the wheels (N, always >= 0; the caller applies the direction). Zero while shifting. */
export function driveForce(gb, spec, speed, throttle) {
    if (throttle <= 0 || gb.shiftTimer > 0) return 0;
    const rpm = rpmAt(gb, spec, speed);
    return (throttle * torqueAt(spec, rpm) * ratio(gb, spec) * EFFICIENCY) / spec.wheelRadius;
}

/** Top speed the gearing allows (m/s): the governed max RPM in top gear (or reverse). */
export function gearedTopSpeed(spec, reverse = false) {
    const r = (reverse ? spec.reverseRatio : spec.gears[spec.gears.length - 1]) * spec.finalDrive;
    return ((spec.engine.maxRpm / RAD_TO_RPM) / r) * spec.wheelRadius;
}
