// Full-screen menus over the game. While one is open the session is paused (the clock stands still).
// Screens register themselves by name; each renders into the panel and re-renders after an action.
import { formatDateTime, formatDuration, formatDate } from '../game/calendar.js';
import { formatMoney } from '../game/economy.js';
import { OFFICE_TABS, officeHtml, officeAct, serviceHtml, financeHtml } from './office.js';
import { worldToMiles } from '../config.js';
import { escape } from './hud.js';
import { drawMap } from '../render/minimap.js';
import { mapTransform } from '../render/gl/minimap-gl.js';

export function createMenus(root, session, signal) {
    const overlay = document.createElement('div');
    overlay.className = 'dd-menu';
    overlay.hidden = true;
    const panel = document.createElement('div');
    panel.className = 'dd-panel';
    overlay.appendChild(panel);
    root.appendChild(overlay);
    const screens = new Map();
    let current = null;
    let currentArgs = null;

    overlay.addEventListener('pointerdown', e => { if (e.target === overlay) menus.close(); }, { signal });
    panel.addEventListener('click', e => {
        const btn = e.target.closest('[data-act]');
        if (!btn || btn.disabled) return;
        const screen = screens.get(current);
        screen?.act?.(btn.dataset.act, btn.dataset, menus);
        if (current) menus.render();
    }, { signal });
    window.addEventListener('keydown', e => { if (current && e.code === 'Escape') { e.stopPropagation(); menus.close(); } }, { signal, capture: true });

    const menus = {
        screens,
        get isOpen() { return current !== null; },
        get current() { return current; },
        get currentArgs() { return currentArgs; },
        register(name, screen) { screens.set(name, screen); },
        open(name, args = {}) {
            if (!screens.has(name)) return;
            current = name;
            currentArgs = args;
            overlay.hidden = false;
            session.menuOpen = true;
            session.onMenuChange?.();
            menus.render();
        },
        render() {
            const screen = screens.get(current);
            if (!screen) return;
            panel.innerHTML = screen.render(currentArgs, menus);
            screen.mounted?.(panel, currentArgs, menus);
        },
        close() {
            if (!current) return;
            screens.get(current)?.closed?.();
            current = null;
            overlay.hidden = true;
            panel.innerHTML = '';
            session.menuOpen = false;
            session.onMenuChange?.();
        },
        toggle(name, args) { if (current === name) menus.close(); else menus.open(name, args); },
        panel,
    };

    registerCoreScreens(menus, session);
    return menus;
}

/** Tabs strip helper: [{id, label}] with the active one marked. */
export function tabs(list, active, act = 'tab') {
    return `<div class="dd-tabs">${list.map(t => `<button class="dd-btn${t.id === active ? ' on' : ''}" data-act="${act}" data-id="${t.id}">${t.label}</button>`).join('')}</div>`;
}

function registerCoreScreens(menus, session) {
    let depotTab = 'contracts';

    // ---- Depot office ----------------------------------------------------------------------------------------
    menus.register('depot', {
        render({ depot }) {
            const extra = session.depotTabs?.() ?? [];
            const list = [{ id: 'contracts', label: '📋 Contracts' }, ...OFFICE_TABS, ...extra, { id: 'ledger', label: '💷 Money' }];
            if (!list.some(t => t.id === depotTab)) depotTab = 'contracts';
            let body;
            if (depotTab === 'contracts') body = contractsHtml(session, depot);
            else if (depotTab === 'ledger') body = financeHtml(session) + ledgerHtml(session);
            else if (OFFICE_TABS.some(t => t.id === depotTab)) body = officeHtml(depotTab, session, depot);
            else body = session.depotTabHtml?.(depotTab, depot) ?? '';
            return `<h2>${escape(depot.name)}</h2><p class="dd-muted">${formatDateTime(session.career.calendar.minutes)} · ${escape(session.career.company)} · ${formatMoney(session.career.ledger.money)}</p>${tabs(list, depotTab)}${body}<p><button class="dd-btn" data-act="close">Back to the road (Esc)</button> <button class="dd-btn" data-act="practice">🚧 Reversing practice yard</button></p>`;
        },
        act(action, data, m) {
            if (action === 'tab') depotTab = data.id;
            else if (action === 'accept') { if (session.acceptOffer(data.id)) m.close(); }
            else if (action === 'abandon') session.abandonJob();
            else if (action === 'close') m.close();
            else if (action === 'practice') { if (session.enterPractice(m.currentArgs.depot)) m.close(); }
            else if (!officeAct(action, data, session, menus.currentArgs?.depot ?? null, m.panel)) session.depotAct?.(action, data, m);
        },
    });

    // ---- Garage (fuel and repairs in town) ------------------------------------------------------------------
    menus.register('garage', {
        render({ garage }) {
            const p = session.player;
            return `<h2>${escape(garage.name)}</h2>${serviceHtml(session, p)}<p><button class="dd-btn" data-act="close">Back to the road (Esc)</button></p>`;
        },
        act(action, data, m) {
            if (action === 'refuel') session.refuel();
            else if (action === 'repair') session.repair();
            else if (action === 'close') m.close();
        },
    });

    // ---- Reversing practice yard ---------------------------------------------------------------------------
    menus.register('practice', {
        render() {
            const sc = session.practiceScore ?? { bays: 0, knocks: 0 };
            return `<h2>Reversing practice</h2><p>Bays done: ${sc.bays} · cones knocked: ${sc.knocks}</p><p>Back into the yellow bay: the rear of the vehicle (or trailer) on the line, straight, and stop.</p>`
                + `<p><button class="dd-btn primary" data-act="nextBay">Next bay</button> <button class="dd-btn" data-act="leave">Back to the depot</button> <button class="dd-btn" data-act="close">Keep practising (Esc)</button></p>`;
        },
        act(action, data, m) {
            if (action === 'nextBay') { session.nextPracticeBay(); m.close(); }
            else if (action === 'leave') { session.leavePractice(); m.close(); }
            else if (action === 'close') m.close();
        },
    });

    // ---- Current job (anywhere) ------------------------------------------------------------------------------
    menus.register('job', {
        render() {
            const job = session.career.job;
            const body = job ? jobCard(session, job, true) : '<p>No job at the moment. Drive to a depot office (F when stopped in the yard) to take one.</p>';
            return `<h2>Current job</h2>${body}<p><button class="dd-btn" data-act="close">Close (Esc)</button></p>`;
        },
        act(action, data, m) {
            if (action === 'abandon') session.abandonJob();
            if (action === 'close') m.close();
        },
    });

    // ---- Map -------------------------------------------------------------------------------------------------
    let view = null;
    menus.register('map', {
        render() {
            return `<h2>Map of ${escape(session.world?.region.name ?? '')}</h2><canvas class="dd-fullmap"></canvas><p class="dd-muted">Drag to move, wheel or pinch to zoom. The pink line is your route.</p><p><button class="dd-btn" data-act="centre">Centre on me</button> <button class="dd-btn" data-act="close">Close (Esc)</button></p>`;
        },
        mounted(panel) {
            const canvas = panel.querySelector('.dd-fullmap');
            view ??= { x: session.player.x, y: session.player.y, range: 14000 };
            const draw = () => {
                const dpr = Math.min(2, window.devicePixelRatio || 1);
                const w = canvas.clientWidth, h = canvas.clientHeight;
                canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
                drawMap(canvas.getContext('2d'), session, { w, h, cx: view.x, cy: view.y, range: view.range, dpr });
            };
            const pointers = new Map();
            let pinch = 0;
            canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
            canvas.addEventListener('pointermove', e => {
                const prev = pointers.get(e.pointerId);
                if (!prev) return;
                const scale = Math.min(canvas.clientWidth, canvas.clientHeight) / 2 / view.range;
                if (pointers.size === 1) { view.x -= (e.clientX - prev.x) / scale; view.y -= (e.clientY - prev.y) / scale; }
                pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
                if (pointers.size === 2) {
                    const [a, b] = [...pointers.values()];
                    const d = Math.hypot(a.x - b.x, a.y - b.y);
                    if (pinch) view.range = clampRange(view.range * (pinch / d));
                    pinch = d;
                }
                draw();
            });
            const up = e => { pointers.delete(e.pointerId); pinch = 0; };
            canvas.addEventListener('pointerup', up);
            canvas.addEventListener('pointercancel', up);
            // zoom about the point under the cursor, so it stays put on the map
            const zoomAt = (sx, sy, factor) => {
                const w = canvas.clientWidth, h = canvas.clientHeight;
                const before = mapTransform({ w, h, cx: view.x, cy: view.y, range: view.range }).unproject(sx, sy);
                view.range = clampRange(view.range * factor);
                const after = mapTransform({ w, h, cx: view.x, cy: view.y, range: view.range }).unproject(sx, sy);
                view.x += before[0] - after[0]; view.y += before[1] - after[1];
            };
            canvas.addEventListener('wheel', e => {
                e.preventDefault();
                const box = canvas.getBoundingClientRect();
                zoomAt(e.clientX - box.left, e.clientY - box.top, e.deltaY > 0 ? 1.2 : 1 / 1.2);
                draw();
            }, { passive: false });
            requestAnimationFrame(draw);
        },
        act(action, data, m) {
            if (action === 'centre') view = { x: session.player.x, y: session.player.y, range: view?.range ?? 7000 };
            if (action === 'close') m.close();
        },
    });
}

const clampRange = r => Math.max(150, Math.min(64000, r));

function contractsHtml(session, depot) {
    const job = session.career.job;
    let html = '';
    if (job) html += `<h3>Your current job</h3>${jobCard(session, job, true)}`;
    const offers = session.offersAt(depot);
    html += `<h3>Work on offer today</h3>`;
    if (!offers.length) return `${html}<p>No more work today. Come back tomorrow.</p>`;
    html += '<ul class="dd-list">';
    for (const o of offers) {
        const can = !job && (session.canTake?.(o) ?? true);
        const reason = job ? 'Finish your current job first' : (session.whyNot?.(o) ?? '');
        html += `<li class="dd-row"><div class="dd-grow"><b>${escape(o.title)}</b><br><small>${escape(o.client.name)} · ${o.weight} kg · ${worldToMiles(o.distance).toFixed(1)} mi · ${o.stops.length} stops · ${formatDuration(o.window)} to deliver</small></div>`
            + `<span class="dd-price">${formatMoney(o.pay)}</span><button class="dd-btn primary" data-act="accept" data-id="${o.id}" ${can ? '' : 'disabled'} title="${escape(reason)}">Accept</button></li>`;
    }
    return `${html}</ul>`;
}

function jobCard(session, job, withAbandon) {
    const stops = job.contract.stops.map((s, i) => `<li class="dd-row"${i < job.stop ? ' style="opacity:.5"' : ''}>${i < job.stop ? '✅' : i === job.stop ? '➡️' : '⬜'} ${{ load: 'Load', couple: 'Collect trailer', drop: 'Drop trailer' }[s.action] ?? 'Unload'} ${s.weight} kg at ${escape(s.name)}</li>`).join('');
    const left = job.deadline - session.career.calendar.minutes;
    return `<p><b>${escape(job.contract.title)}</b> for ${escape(job.contract.client.name)} · pays ${formatMoney(job.contract.pay)} · ${left >= 0 ? `due in ${formatDuration(left)}` : `late by ${formatDuration(-left)}`}</p><ul class="dd-list">${stops}</ul>`
        + (withAbandon ? `<p><button class="dd-btn danger" data-act="abandon">Abandon (costs ${formatMoney(Math.max(1, Math.round(job.contract.pay * 0.1)))})</button></p>` : '');
}

function ledgerHtml(session) {
    const rows = session.career.ledger.entries.slice(-40).reverse()
        .map(e => `<tr><td>${formatDate(e.t)}</td><td>${escape(e.text)}</td><td class="${e.amount < 0 ? 'neg' : 'pos'}">${formatMoney(e.amount)}</td></tr>`).join('');
    return rows ? `<table class="dd-ledger">${rows}</table>` : '<p>No entries yet.</p>';
}

