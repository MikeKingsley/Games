// Pure sun, moon and sky model for the WebGL renderer (no DOM, no GL). From the game clock it gives the direction and
// colour of the one directional light (the sun by day, a dim blue moon at night), hemispheric ambient colours, the
// horizon/fog colour and how "night" it is, then `sceneLighting` folds the weather in. World coordinates: +x east,
// +y south (so north is -y), +z up; directions point TOWARDS the light. The Canvas renderer keeps its scalar
// `session.light`.
import { REF_LAT } from '../../config.js';
import { dateOf } from '../../game/calendar.js';
import { dayOfYear } from '../../game/environment.js';

const RAD = Math.PI / 180;
const SOLAR_NOON = 12 + 14 / 60; // matches game/environment.js

const clamp01 = x => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const scale = (a, k) => a.map(v => v * k);

/** Decimal hour of day (GMT) for game minutes, with the fractional minute. */
export const hourOfDay = minutes => { const d = dateOf(minutes); return d.hour + (d.minute + (minutes - Math.floor(minutes))) / 60; };

/** Sun elevation (radians above the horizon) and azimuth (radians clockwise from north) at game minutes. */
export function sunPosition(minutes, lat = REF_LAT) {
    const doy = dayOfYear(minutes);
    const decl = 23.44 * RAD * Math.sin((2 * Math.PI * (doy - 81)) / 365);
    const H = (hourOfDay(minutes) - SOLAR_NOON) * 15 * RAD; // hour angle, + in the afternoon
    const phi = lat * RAD;
    const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
    const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) + Math.PI;
    return { elevation: el, azimuth: az };
}

/** Unit vector towards a body at azimuth `az` (from north, clockwise) and elevation `el` in world coordinates. */
export function directionOf(az, el, out = [0, 0, 0]) {
    const c = Math.cos(el);
    out[0] = Math.sin(az) * c; out[1] = -Math.cos(az) * c; out[2] = Math.sin(el);
    return out;
}

const SUN_WARM = [1, 0.58, 0.32], SUN_WHITE = [1, 0.95, 0.86], MOON = [0.5, 0.6, 0.95];
const SKY = { day: [0.62, 0.74, 0.86], dusk: [0.9, 0.52, 0.34], night: [0.02, 0.03, 0.08] };

/**
 * The lighting for game minutes (clear weather): {dir, color, elevation, day (0..1), night (0..1), sky, horizon, ambientSky,
 * ambientGround, warmth}. `dir` points to the sun above the horizon and to the moon at night; `color` is the light's
 * colour times its strength, which fades to ~0 as the sun sets and rises again as the moon takes over (so it is
 * continuous in time, even though the direction swaps).
 */
export function sunLight(minutes) {
    const { elevation, azimuth } = sunPosition(minutes);
    const deg = elevation / RAD;
    const sunI = smooth(-3, 14, deg) * (0.55 + 0.45 * smooth(0, 40, deg));
    const moonI = 0.16 * (1 - smooth(-8, 2, deg));
    const warmth = (1 - smooth(4, 22, deg)) * smooth(-4, 3, deg); // reddest as it touches the horizon
    const sunColor = scale(mix(SUN_WHITE, SUN_WARM, warmth), sunI);
    const moonColor = scale(MOON, moonI);
    const sunDir = directionOf(azimuth, elevation);
    const moonDir = [-sunDir[0], -sunDir[1], Math.max(0.35, -sunDir[2])];
    const ml = Math.hypot(...moonDir);
    // the one light: blend the two by strength (their strengths cross near zero, so the swap is invisible)
    const w = sunI + moonI || 1;
    const dir = [0, 1, 2].map(i => (sunDir[i] * sunI + (moonDir[i] / ml) * moonI) / w);
    const dl = Math.hypot(...dir) || 1;
    const day = smooth(-10, 12, deg), night = 1 - smooth(-14, -2, deg);
    const horizon = mix(mix(SKY.night, SKY.dusk, smooth(-12, -1, deg)), SKY.day, smooth(-1, 16, deg));
    return {
        dir: dir.map(v => v / dl), sunDir, elevation, day, night, warmth,
        color: [0, 1, 2].map(i => sunColor[i] + moonColor[i]),
        sky: mix(SKY.night, [0.3, 0.5, 0.82], day),
        horizon,
        ambientSky: mix([0.05, 0.07, 0.15], [0.42, 0.5, 0.62], day),
        ambientGround: mix([0.03, 0.035, 0.05], [0.22, 0.2, 0.17], day),
    };
}

/**
 * The scene's lighting and fog for a clock time and weather {kind, intensity} (and visibility in metres for fog):
 * everything the shaders need, with cloud and rain dimming the sun and greying the sky, fog shortening the view.
 * `viewDistance` is how far the scene is drawn; the fog reaches full strength just beyond it.
 */
export function sceneLighting(minutes, weather = { kind: 'clear', intensity: 0 }, viewDistance = 500, visibility = Infinity) {
    const s = sunLight(minutes);
    const k = weather.intensity ?? 0;
    const cloud = weather.kind === 'rain' ? 0.55 + 0.35 * k : weather.kind === 'overcast' ? 0.4 : weather.kind === 'fog' ? 0.5 : 0;
    const grey = l => { const g = (l[0] + l[1] + l[2]) / 3; return mix(l, [g, g, g], cloud * 0.8); };
    const sunStrength = 1 - 0.78 * cloud;
    const horizon = grey(scale(s.horizon, 1 - 0.28 * cloud));
    const fogNear = Math.min(viewDistance * 0.5, visibility * 0.15), fogFar = Math.min(viewDistance * 1.1, visibility);
    const fogColor = weather.kind === 'fog' ? scale(mix(horizon, [0.74, 0.76, 0.78], 0.7), 0.35 + 0.65 * s.day) : horizon;
    return {
        sunDir: s.dir, sunColor: scale(s.color, sunStrength),
        skyColor: grey(scale(s.ambientSky, 1 - 0.15 * cloud)), groundColor: grey(s.ambientGround),
        horizon, zenith: grey(scale(s.sky, 1 - 0.35 * cloud)), fogColor, fogNear, fogFar,
        night: s.night, day: s.day, warmth: s.warmth, elevation: s.elevation, shadowStrength: clamp01(sunStrength * (1 - s.night)),
        wet: weather.kind === 'rain' ? 0.4 + 0.6 * k : 0, cloud,
        sunVisible: weather.kind === 'clear' ? 1 : 0,
    };
}

/** The shadow-casting direction: the light direction but never lower than `minElevation` (long dawn shadows are not worth it). */
export function shadowDirection(dir, minElevation = 18 * RAD) {
    const h = Math.hypot(dir[0], dir[1]);
    const el = Math.max(minElevation, Math.atan2(dir[2], h));
    const hx = h > 1e-6 ? dir[0] / h : 0, hy = h > 1e-6 ? dir[1] / h : 1;
    return [hx * Math.cos(el), hy * Math.cos(el), Math.sin(el)];
}
