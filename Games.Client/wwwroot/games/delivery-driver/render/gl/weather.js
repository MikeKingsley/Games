// Pure weather settings for the WebGL renderer (no DOM, no GL): how many rain streaks to draw and how they fall. The
// shaders (shaders.js RAIN, and the wet-road term in the lit programs) do the drawing; the weather state and grip stay
// with game/environment.js (`session.weather`). Fog and cloud are folded into the lighting by sun.js `sceneLighting`.

/** Share of the full rain count drawn at each quality preset. */
export const RAIN_QUALITY = { low: 0.35, medium: 0.7, high: 1 };

/**
 * Rain streak settings for a weather {kind, intensity} and a quality name: {count, speed (m/s), length (m), wind (m),
 * area (half-size of the box round the camera, m), color}. `count` is 0 unless it is raining.
 */
export function rainSettings(weather, quality = 'medium') {
    if (weather?.kind !== 'rain') return { count: 0, speed: 0, length: 0, wind: 0, area: 28, color: [0.72, 0.8, 0.92] };
    const k = Math.max(0, Math.min(1, weather.intensity ?? 0.5));
    const q = RAIN_QUALITY[quality] ?? RAIN_QUALITY.medium;
    return {
        count: Math.round((500 + 2200 * k) * q),
        speed: 16 + 10 * k,
        length: 0.6 + 0.8 * k,
        wind: 1.5 + 3.5 * k,
        area: 28,
        color: [0.72, 0.8, 0.92],
    };
}

/** True when the weather wets the roads (the lit shaders add the sheen from `wet`). */
export const wetRoads = weather => weather?.kind === 'rain';
