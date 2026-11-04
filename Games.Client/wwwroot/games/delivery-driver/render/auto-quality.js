// Automatic quality: when the average frame time stays above a limit for a whole window, drop one quality level.
// It never raises the quality. Pure (the caller supplies frame times), so it is testable in Node.

export const LEVELS = ['high', 'medium', 'low'];

/**
 * `sample(frameMs)` takes the real time between two frames and returns the quality to drop to, or null.
 * Frames longer than `ignoreMs` (a hidden tab, a menu, a load hitch) are not counted.
 */
export function createAutoQuality({ limitMs = 40, windowMs = 5000, ignoreMs = 250 } = {}) {
    let sum = 0, count = 0, elapsed = 0;
    return {
        reset() { sum = count = elapsed = 0; },
        sample(frameMs, current) {
            if (frameMs <= 0 || frameMs > ignoreMs) return null;
            sum += frameMs; count++; elapsed += frameMs;
            if (elapsed < windowMs) return null;
            const slow = sum / count > limitMs;
            sum = count = elapsed = 0;
            if (!slow) return null;
            const i = LEVELS.indexOf(current);
            return i >= 0 && i < LEVELS.length - 1 ? LEVELS[i + 1] : null;
        },
    };
}
