// Game calendar: minutes since 00:00 on 1 January 1919. It only advances while the player is driving in the
// world (TIME_SCALE game minutes per real minute); menus and the shell's pause stop it.
import { TIME_SCALE, START_YEAR } from '../config.js';

const EPOCH = Date.UTC(START_YEAR, 0, 1);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const START_MINUTES = 9 * 60 + 30; // the career starts at 09:30
/** Game minutes per real second (0.25 with TIME_SCALE 15). */
export const GAME_MINUTES_PER_SECOND = TIME_SCALE / 60;

export function createCalendar(minutes = START_MINUTES) {
    return { minutes };
}

/** Breaks game minutes into a date. weekday: 0 = Sunday. */
export function dateOf(minutes) {
    const d = new Date(EPOCH + Math.floor(minutes) * 60000);
    return {
        year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(),
        hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay(),
    };
}

/** Game minutes at a date (month 0-based). */
export function minutesAt(year, month = 0, day = 1, hour = 0, minute = 0) {
    return (Date.UTC(year, month, day, hour, minute) - EPOCH) / 60000;
}

const pad = n => String(n).padStart(2, '0');
export const formatTime = minutes => { const d = dateOf(minutes); return `${pad(d.hour)}:${pad(d.minute)}`; };
export const formatDate = minutes => { const d = dateOf(minutes); return `${DAYS[d.weekday]} ${d.day} ${MONTHS[d.month]} ${d.year}`; };
export const formatDateTime = minutes => `${formatDate(minutes)}, ${formatTime(minutes)}`;

/** Duration in game minutes as "2 h 15 min" / "45 min" / "3 days". */
export function formatDuration(mins) {
    mins = Math.max(0, Math.round(mins));
    if (mins >= 48 * 60) return `${Math.round(mins / 1440)} days`;
    const h = Math.floor(mins / 60), m = mins % 60;
    return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

/** Day number since the epoch (for daily refreshes and seeded weather). */
export const dayIndex = minutes => Math.floor(minutes / 1440);
/** Game hour number since the epoch (contract boards regenerate each hour). */
export const hourIndex = minutes => Math.floor(minutes / 60);
/** Week number, weeks starting Monday 00:00 (1 Jan 1919 was a Wednesday). */
export const weekIndex = minutes => Math.floor((minutes + 2 * 1440) / (7 * 1440));

/**
 * Advances by `realSeconds` of driving. Returns the events crossed: {newDay, newWeek, newYear, year}.
 * Several can happen at once when the clock is advanced in a big step (debug hook).
 */
export function advance(cal, realSeconds) {
    const before = cal.minutes;
    cal.minutes += realSeconds * GAME_MINUTES_PER_SECOND;
    return events(before, cal.minutes);
}

/** Jumps the clock forward by game hours (debug hook, waiting at a ferry). */
export function advanceHours(cal, hours) {
    const before = cal.minutes;
    cal.minutes += hours * 60;
    return events(before, cal.minutes);
}

function events(before, after) {
    const y0 = dateOf(before).year, y1 = dateOf(after).year;
    return {
        newDay: dayIndex(after) - dayIndex(before),
        newWeek: weekIndex(after) - weekIndex(before),
        newYear: y1 - y0,
        year: y1,
    };
}

