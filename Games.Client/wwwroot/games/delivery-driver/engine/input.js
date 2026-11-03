// Keyboard (+ touch, + optional gamepad) to a normalised control state {throttle, brake, steer, handbrake, reverse}.

const HOLD = {
    KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back',
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'handbrake',
};
/** One-shot actions; `horn` also reports key-up so it sounds while held. */
export const ACTIONS = {
    KeyC: 'couple', KeyQ: 'indicateLeft', KeyE: 'indicateRight', KeyH: 'horn', KeyM: 'map', KeyV: 'camera',
    KeyZ: 'zoomIn', KeyX: 'zoomOut', KeyF: 'interact', Enter: 'interact', KeyJ: 'jobs', KeyG: 'gearMode',
    ShiftLeft: 'gearUp', ShiftRight: 'gearUp', ControlLeft: 'gearDown', ControlRight: 'gearDown', Escape: 'escape',
};

const STEER_RATE = 2.2;     // keyboard steering: full lock in ~0.45 s
const CENTRE_RATE = 3.5;    // self-centring is quicker
const STOPPED = 0.3;        // m/s: below this, holding the opposite pedal swaps direction

/**
 * Pure: arcade pedal mapping. Moving forward, "back" brakes; once stopped, holding "back" selects reverse and
 * then drives backwards (and "fwd" brakes). Returns the new reverse flag with throttle/brake.
 */
export function pedals(fwd, back, speed, reverse) {
    if (!reverse && back && !fwd && Math.abs(speed) < STOPPED) reverse = true;
    else if (reverse && fwd && !back && Math.abs(speed) < STOPPED) reverse = false;
    return reverse
        ? { throttle: back ? 1 : 0, brake: fwd ? 1 : 0, reverse }
        : { throttle: fwd ? 1 : 0, brake: back ? 1 : 0, reverse };
}

/** Pure: moves the keyboard steering value toward its target (-1 left .. 1 right) at a limited rate. */
export function smoothSteer(current, target, dt) {
    const rate = target === 0 || Math.sign(target) !== Math.sign(current) ? CENTRE_RATE : STEER_RATE;
    const delta = target - current;
    const max = rate * dt;
    return Math.abs(delta) <= max ? target : current + Math.sign(delta) * max;
}

function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

function readGamepad() {
    const pads = globalThis.navigator?.getGamepads?.() ?? [];
    for (const p of pads) {
        if (!p?.connected) continue;
        const steer = Math.abs(p.axes[0] ?? 0) > 0.12 ? p.axes[0] : 0;
        const rt = p.buttons[7]?.value ?? 0;
        const lt = p.buttons[6]?.value ?? 0;
        if (steer || rt > 0.05 || lt > 0.05 || p.buttons[0]?.pressed) return { steer, fwd: rt, back: lt, handbrake: !!p.buttons[0]?.pressed };
    }
    return null;
}

export function createInput(target, signal) {
    const held = new Set();
    const listeners = new Set();
    const state = { throttle: 0, brake: 0, steer: 0, handbrake: false, reverse: false };
    let keySteer = 0;
    let override = null; // debug hook: fixed controls
    /** Written by ui/touch-controls.js when on-screen controls are in use. */
    const touch = { active: false, steer: 0, throttle: 0, brake: 0, reverse: false };

    const emit = (name, down = true) => listeners.forEach(fn => fn(name, down));

    target.addEventListener('keydown', e => {
        if (isTyping(e)) return;
        const hold = HOLD[e.code];
        const action = ACTIONS[e.code];
        if (hold || action) e.preventDefault();
        if (hold) held.add(hold);
        if (action && !e.repeat) emit(action, true);
    }, { signal });
    target.addEventListener('keyup', e => {
        const hold = HOLD[e.code];
        if (hold) held.delete(hold);
        if (ACTIONS[e.code] === 'horn') emit('horn', false);
    }, { signal });
    target.addEventListener('blur', () => held.clear(), { signal });

    return {
        state,
        touch,
        held,
        onAction(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        emit,
        /** Debug hook: force controls ({throttle, brake, steer, handbrake, reverse}); null returns control to the player. */
        setOverride(next) { override = next ? { throttle: 0, brake: 0, steer: 0, handbrake: false, reverse: false, ...next } : null; },
        /** Called once per simulation step with the vehicle's signed speed (m/s). */
        update(dt, speed) {
            if (override) { Object.assign(state, override); return state; }
            const pad = readGamepad();
            if (touch.active && held.size === 0) {
                state.steer = touch.steer;
                state.reverse = touch.reverse;
                state.throttle = touch.throttle;
                state.brake = touch.brake;
                state.handbrake = false;
                return state;
            }
            if (pad) {
                const p = pedals(pad.fwd > 0.05, pad.back > 0.05, speed, state.reverse);
                state.reverse = p.reverse;
                state.throttle = p.reverse ? pad.back : pad.fwd;
                state.brake = p.reverse ? pad.fwd : pad.back;
                state.steer = pad.steer;
                state.handbrake = pad.handbrake;
                return state;
            }
            const target = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
            keySteer = smoothSteer(keySteer, target, dt);
            const p = pedals(held.has('fwd'), held.has('back'), speed, state.reverse);
            state.steer = keySteer;
            state.throttle = p.throttle;
            state.brake = p.brake;
            state.reverse = p.reverse;
            state.handbrake = held.has('handbrake');
            touch.reverse = state.reverse; // keep the on-screen R toggle in step when a keyboard is used too
            return state;
        },
    };
}
