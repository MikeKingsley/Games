// DOM-free quality decision: watches frame times and steps down from 'high' to 'low' on a slow device. Never steps back up (no flicker).
export const WINDOW_MS = 2000; // length of one measuring window
export const SLOW_MS = 22; // an average frame time above this makes a window "slow"
export const SLOW_WINDOWS = 2; // consecutive slow windows before stepping down
export const IGNORE_MS = 250; // single frames longer than this (a tab switch, a debugger pause) are ignored

/** createQualityMonitor({ reducedMotion }) -> { sample(dtMs), level, reducedMotion } */
export function createQualityMonitor({ reducedMotion = false } = {}) {
    let level = 'high';
    let elapsed = 0, frames = 0, slow = 0;
    return {
        reducedMotion,
        get level() { return level; },
        /** Feed one frame's duration in milliseconds. Returns the current level. */
        sample(dtMs) {
            if (level === 'low' || !(dtMs > 0) || dtMs > IGNORE_MS) return level;
            elapsed += dtMs;
            frames++;
            if (elapsed >= WINDOW_MS) {
                slow = elapsed / frames > SLOW_MS ? slow + 1 : 0;
                elapsed = 0;
                frames = 0;
                if (slow >= SLOW_WINDOWS) level = 'low';
            }
            return level;
        },
    };
}
