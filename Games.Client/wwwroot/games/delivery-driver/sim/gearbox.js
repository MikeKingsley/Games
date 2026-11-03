// Gearbox and engine: RPM from wheel speed, a torque curve, automatic shift points with a short drive-less
// shift delay, and an optional manual mode (gear up/down keys). spec.engine = {torque, peakRpm, idleRpm, maxRpm}.

const EFFICIENCY = 0.85;
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

/** Automatic shifting (or manual gear holding), and the shift delay. Also sets gb.rpm for audio. */
export function updateGearbox(gb, spec, speed, throttle, dt) {
    if (gb.shiftTimer > 0) gb.shiftTimer = Math.max(0, gb.shiftTimer - dt);
    const n = spec.gears.length;
    if (!gb.manual && !gb.reverse && gb.shiftTimer === 0) {
        const rpm = rpmAt(gb, spec, speed);
        const upAt = spec.engine.maxRpm * (throttle > 0.5 ? 0.92 : 0.75);
        if (rpm > upAt && gb.gear < n) shift(gb, spec, +1);
        else if (gb.gear > 1 && rpmAt(gb, spec, speed, gb.gear - 1) < spec.engine.maxRpm * 0.68) shift(gb, spec, -1);
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
