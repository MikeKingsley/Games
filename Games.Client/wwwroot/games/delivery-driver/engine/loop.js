// Fixed-timestep game loop: the simulation always steps at 60 Hz, rendering interpolates between steps.

export const STEP = 1 / 60;
export const MAX_STEPS = 5;

/**
 * Pure scheduler core: adds the elapsed real time to the accumulator and says how many fixed steps to run.
 * When more than maxSteps are due (a long frame or a background tab) the backlog is dropped, so the
 * simulation slows down instead of spiralling.
 */
export function advance(accumulator, elapsed, step = STEP, maxSteps = MAX_STEPS) {
    let acc = accumulator + Math.max(0, elapsed);
    let steps = Math.floor(acc / step + 1e-9);
    if (steps > maxSteps) { steps = maxSteps; acc = steps * step; }
    acc -= steps * step;
    return { steps, accumulator: Math.max(0, acc), alpha: Math.min(1, Math.max(0, acc / step)) };
}

/**
 * Runs step(dt) at a fixed rate and render(alpha) once per animation frame.
 * now/raf/caf can be replaced by a fake clock in tests.
 */
export function createLoop({ step, render, now = () => performance.now() / 1000, raf = cb => requestAnimationFrame(cb), caf = id => cancelAnimationFrame(id) }) {
    let running = false;
    let frame = 0;
    let last = 0;
    let accumulator = 0;

    function tick() {
        if (!running) return;
        const t = now();
        const r = advance(accumulator, t - last);
        last = t;
        accumulator = r.accumulator;
        for (let i = 0; i < r.steps; i++) step(STEP);
        render(r.alpha);
        frame = raf(tick);
    }

    return {
        start() {
            if (running) return;
            running = true;
            last = now();
            accumulator = 0;
            frame = raf(tick);
        },
        stop() {
            running = false;
            caf(frame);
        },
        get running() { return running; },
        /** Test helper: run one frame immediately. */
        tick,
    };
}
