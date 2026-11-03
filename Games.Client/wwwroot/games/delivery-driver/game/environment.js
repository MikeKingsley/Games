// Daylight and weather. Sunrise and sunset follow the season at 50.5°N (Devon and Cornwall, GMT); the weather is
// seeded per day (the same day always has the same weather), with fog far more likely up on the moors.
import { REF_LAT } from '../config.js';
import { dateOf, dayIndex } from './calendar.js';
import { seededRng, hashSeed } from '../engine/rng.js';

const RAD = Math.PI / 180;
const SOLAR_NOON = 12 + 14 / 60; // about 12:14 GMT this far west

/** Day of the year (1..366) for game minutes. */
export function dayOfYear(minutes) {
    const d = dateOf(minutes);
    return Math.floor((Date.UTC(d.year, d.month, d.day) - Date.UTC(d.year, 0, 0)) / 86400000);
}

/** Sunrise and sunset (decimal hours, GMT) on a day of the year. */
export function sunTimes(doy) {
    const decl = 23.44 * RAD * Math.sin((2 * Math.PI * (doy - 81)) / 365);
    const cosH = -Math.tan(REF_LAT * RAD) * Math.tan(decl);
    const H = Math.acos(Math.max(-1, Math.min(1, cosH))) / RAD; // degrees
    return { sunrise: SOLAR_NOON - H / 15, sunset: SOLAR_NOON + H / 15 };
}

const hourOf = minutes => { const d = dateOf(minutes); return d.hour + d.minute / 60; };

/** Dark between half an hour after sunset and half an hour before sunrise. */
export function isNight(minutes) {
    const { sunrise, sunset } = sunTimes(dayOfYear(minutes));
    const h = hourOf(minutes);
    return h < sunrise - 0.5 || h > sunset + 0.5;
}

/**
 * Ambient light 0.3 (night) .. 1 (day), easing through an hour of twilight either side of sunrise and sunset.
 * Also returns `dusk` (0..1): how strongly the sky is tinted orange.
 */
export function daylight(minutes) {
    const { sunrise, sunset } = sunTimes(dayOfYear(minutes));
    const h = hourOf(minutes);
    const ramp = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));
    const up = ramp(h, sunrise - 0.75, sunrise + 0.5);
    const down = 1 - ramp(h, sunset - 0.5, sunset + 0.75);
    const day = Math.min(up, down);
    const light = 0.3 + 0.7 * day * day * (3 - 2 * day);
    const dusk = Math.max(0, 1 - Math.abs(h - sunrise) / 0.9, 1 - Math.abs(h - sunset) / 0.9);
    return { light, dusk, night: isNight(minutes) };
}

/**
 * The day's weather: {kind: 'clear'|'overcast'|'rain'|'fog', intensity 0..1}. Seeded per region and day; damper
 * in winter. `moor` (the player is up on Dartmoor, Bodmin Moor or Exmoor) makes low cloud and fog much likelier.
 */
export function weatherFor(seed, minutes, moor = false) {
    const day = dayIndex(minutes);
    const rng = seededRng(hashSeed(seed, 'weather', day));
    const month = dateOf(minutes).month;
    const wet = 0.35 + 0.15 * Math.cos(((month - 0.5) / 12) * 2 * Math.PI); // wetter in winter
    const r = rng(), fogRoll = rng(), intensity = 0.35 + rng() * 0.65;
    let kind = r < wet * 0.75 ? 'rain' : r < wet + 0.25 ? 'overcast' : 'clear';
    const fogChance = moor ? (kind === 'clear' ? 0.25 : 0.6) : (kind === 'clear' ? 0.05 : 0.1);
    if (fogRoll < fogChance) kind = 'fog';
    return { kind, intensity };
}

/** Road grip for the weather: rain lowers braking and steering force, fog barely. */
export const gripFor = w => (w.kind === 'rain' ? 1 - 0.35 * w.intensity : w.kind === 'fog' ? 0.95 : 1);
/** How far you can see in fog (world metres). */
export const visibilityFor = w => (w.kind === 'fog' ? 90 - 60 * w.intensity : Infinity);

export const WEATHER_LABEL = { clear: '☀️ Clear', overcast: '☁️ Overcast', rain: '🌧️ Rain', fog: '🌫️ Fog' };
