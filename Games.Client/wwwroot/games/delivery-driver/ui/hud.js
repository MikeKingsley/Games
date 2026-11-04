// Heads-up display: speed, gear, clock and date, money, the current job step with distance and deadline, hints,
// indicators, toasts and the minimap. Text only changes when its value does (cheap per frame).
import { formatDate, formatTime, formatDuration } from '../game/calendar.js';
import { formatMoney } from '../game/economy.js';
import { currentStop } from '../game/contracts.js';
import { worldToMiles, MPH } from '../config.js';
import { createMinimap } from '../render/minimap.js';
import { WEATHER_LABEL } from '../game/environment.js';
import { STEPS } from '../game/tutorial.js';
import { brakeTemperature, fadeFactor } from '../sim/slope.js';

/** Shown from this grade (along the direction of travel); highlighted from STEEP_GRADE. */
const SHOW_GRADE = 0.02, STEEP_GRADE = 0.06;

/**
 * The gradient readout for the speedo: "Hill 8% up" / "Hill 8% down" along the direction of travel (`grade` is
 * along the heading, so it flips when reversing), or '' on gentle ground.
 */
export function gradeLabel(grade, speed = 0) {
    const g = speed < -0.1 ? -grade : grade;
    if (Math.abs(g) < SHOW_GRADE) return '';
    return `Hill ${Math.round(Math.abs(g) * 100)}% ${g > 0 ? 'up' : 'down'}`;
}

/** The brake warning: {text, level: 'hot' | 'fade'} once the brakes are hot (heat 0.7, ~230 C), or null. */
export function brakeWarning(heat) {
    if (heat < 0.7) return null;
    if (heat < 1) return { text: `Brakes hot ${brakeTemperature(heat)}°C`, level: 'hot' };
    return { text: `Brakes fading ${Math.round(fadeFactor(heat) * 100)}%`, level: 'fade' };
}

export function createHud(root, { onMinimap } = {}) {
    const top = el('div', 'dd-hud-top');
    const clock = el('div', 'dd-chip dd-clock');
    const weather = el('div', 'dd-chip dd-weather');
    const money = el('div', 'dd-chip dd-money');
    top.append(clock, weather, money);
    const job = el('div', 'dd-job');
    const gauges = el('div', 'dd-gauges');
    gauges.innerHTML = '<div class="dd-speedo"><div class="dd-mph">0</div><div class="dd-unit">mph</div><div class="dd-gear">N</div>'
        + '<div class="dd-grade"></div><div class="dd-brakes"></div></div><div class="dd-bars"></div>';
    const mph = gauges.querySelector('.dd-mph');
    const unit = gauges.querySelector('.dd-unit');
    const gear = gauges.querySelector('.dd-gear');
    const grade = gauges.querySelector('.dd-grade');
    const brakes = gauges.querySelector('.dd-brakes');
    const bars = gauges.querySelector('.dd-bars');
    const indL = el('div', 'dd-ind left'); indL.textContent = '◀';
    const indR = el('div', 'dd-ind right'); indR.textContent = '▶';
    const toast = el('div', 'dd-toast hide');
    const rotate = el('div', 'dd-rotate'); rotate.textContent = 'Turn your device sideways for a bigger view';
    const mini = el('canvas', 'dd-minimap');
    mini.title = 'Map (M)';
    mini.addEventListener('click', () => onMinimap?.());
    root.append(top, job, gauges, indL, indR, toast, rotate, mini);
    const minimap = createMinimap(mini);

    const cache = new Map();
    const set = (node, key, value, html = false) => {
        if (cache.get(key) === value) return;
        cache.set(key, value);
        if (html) node.innerHTML = value; else node.textContent = value;
    };
    let toastTimer = 0;

    function el(tag, className) {
        const n = document.createElement(tag);
        n.className = className;
        return n;
    }

    return {
        element: top,
        toast(text, ms = 2600) {
            toast.innerHTML = text;
            toast.classList.remove('hide');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => toast.classList.add('hide'), ms);
        },
        update(session, camera) {
            const p = session.player;
            const career = session.career;
            const metric = session.settings.units === 'metric';
            set(mph, 'mph', String(Math.round((Math.abs(p.speed) / MPH) * (metric ? 1.609 : 1))));
            set(unit, 'unit', metric ? 'km/h' : 'mph');
            const gb = p.gearbox;
            set(gear, 'gear', gb.reverse ? 'R' : `${gb.gear}${gb.manual ? ' M' : ''}`);
            // the hill under the wheels and hot brakes
            const g = session.slope?.grade ?? 0;
            set(grade, 'grade', gradeLabel(g, p.speed));
            grade.classList.toggle('steep', Math.abs(g) >= STEEP_GRADE);
            const warn = brakeWarning(p.brakeHeat ?? 0);
            set(brakes, 'brakes', warn?.text ?? '');
            brakes.classList.toggle('fade', warn?.level === 'fade');
            const t = career.calendar.minutes;
            set(clock, 'clock', `<b>${formatTime(t)}</b> ${formatDate(t)}`, true);
            set(weather, 'weather', `${session.night ? '🌙 ' : ''}${WEATHER_LABEL[session.weather?.kind ?? 'clear']}`);
            set(money, 'money', `${escape(career.company)} <b>${formatMoney(career.ledger.money)}</b>`, true);
            money.classList.toggle('neg', career.ledger.money < 0);
            set(job, 'job', jobHtml(session), true);
            set(bars, 'bars', barsHtml(session), true);
            const blink = Math.floor(performance.now() / 400) % 2 === 0;
            indL.classList.toggle('on', session.indicator === 'left' && blink);
            indR.classList.toggle('on', session.indicator === 'right' && blink);
            if (camera) minimap.draw(session, camera);
        },
    };
}

function jobHtml(session) {
    const tut = session.tutorial && !session.tutorial.done ? `<div class="dd-tutorial">🎓 ${escape(STEPS[session.tutorial.step].text)}</div>` : '';
    return tut + jobBody(session);
}

function jobBody(session) {
    const job = session.career.job;
    const hint = session.jobHint ? `<div class="dd-hint">${escape(session.jobHint)}</div>` : '';
    if (!job) {
        return session.world ? `<div>No job. Visit the depot office for work.</div>${hint}` : '';
    }
    const stop = currentStop(job);
    const n = job.contract.stops.length;
    const verbs = { couple: 'Collect the trailer at', drop: 'Drop the trailer at', load: 'Load at' };
    const verb = verbs[stop.action] ?? (job.contract.type === 'multidrop' ? `Drop ${job.stop}/${n - 1}:` : 'Unload at');
    const metric = session.settings.units === 'metric';
    const dist = session.route ? `${(worldToMiles(session.route.length) * (metric ? 1.609 : 1)).toFixed(1)} ${metric ? 'km' : 'mi'}` : '';
    const left = job.deadline - session.career.calendar.minutes;
    const due = left >= 0 ? `Due in ${formatDuration(left)}` : `<span style="color:var(--dd-bad)">Late by ${formatDuration(-left)}</span>`;
    return `<div><b>${escape(job.contract.title)}</b></div><div class="dd-step">${verb} ${escape(stop.name)} ${dist ? `· ${dist}` : ''}</div><div class="dd-hint">${due}${job.cargoDamage ? ` · cargo damage ${Math.round(job.cargoDamage)}%` : ''}</div>${hint}`;
}

function barsHtml(session) {
    const p = session.player;
    // an artic's load is on its trailer (and limited by what the tractor may pull)
    const t = p.trailer;
    const kg = Math.round(t ? t.cargoMass : p.cargoMass);
    const cap = t ? Math.min(t.spec.capacity, p.spec.trailerMax) : p.spec.payload;
    const label = p.spec.tags.includes('tractor-unit') && !t ? 'No trailer' : `Load ${kg.toLocaleString('en-GB')} / ${cap.toLocaleString('en-GB')} kg`;
    let html = `<div>${label}</div><div class="dd-bar"><i style="width:${cap ? Math.min(100, (kg / cap) * 100) : 0}%"></i></div>`;
    if (p.fuel !== undefined) {
        const f = p.fuel / p.spec.fuelTank;
        html += `<div>Fuel</div><div class="dd-bar${f < 0.15 ? ' low' : ''}"><i style="width:${Math.round(f * 100)}%"></i></div>`;
    }
    if (p.damage !== undefined) html += `<div>Condition ${Math.round(100 - p.damage)}%</div>`;
    return html;
}

const escape = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export { escape };
