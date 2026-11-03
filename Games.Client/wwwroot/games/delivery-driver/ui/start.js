// Start-up and in-game menus: save slots (continue, new game, export, import, delete), the new-company form,
// the game menu (Esc), device settings and the controls help.
import { formatMoney } from '../game/economy.js';
import { escape } from './hud.js';
import { tabs } from './menus.js';

export const DEFAULT_SETTINGS = { quality: 'medium', renderer: 'auto', camera: 'chase', manualGears: false, touchLayout: 'slider', units: 'imperial' };
const SETTINGS_KEY = 'games.dd.settings';

export function loadSettings(storage = globalThis.localStorage) {
    try { return { ...DEFAULT_SETTINGS, ...(JSON.parse(storage.getItem(SETTINGS_KEY)) ?? {}) }; } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(settings, storage = globalThis.localStorage) {
    try { storage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage full or blocked */ }
}

const when = t => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * ctx = {session, store (createSaveStore), startGame(slot, data|null, form), saveNow(), applySettings(next),
 * download(name, text)}.
 */
export function registerStartScreens(menus, ctx) {
    const { session, store } = ctx;
    let confirm = null;
    let message = '';

    menus.register('slots', {
        render(args) {
            const list = store.list();
            const any = list.some(s => !s.empty);
            let html = `<h2>🚚 Delivery Driver</h2><p>Run a haulage company in Devon and Cornwall from 1919.${args.note ? ` <b>${escape(args.note)}</b>` : ''}</p>`;
            if (message) html += `<p class="dd-muted">${escape(message)}</p>`;
            html += '<ul class="dd-list">';
            for (const s of list) {
                const busy = confirm === s.slot;
                if (s.empty) {
                    html += `<li class="dd-row"><div class="dd-grow"><b>Slot ${s.slot}</b><br><small>Empty</small></div><button class="dd-btn primary" data-act="new" data-slot="${s.slot}">New game</button>`
                        + `<label class="dd-btn">Import<input type="file" accept=".json,application/json" data-import="${s.slot}" hidden></label></li>`;
                    continue;
                }
                html += `<li class="dd-row"><div class="dd-grow"><b>${escape(s.company)}</b> <small>slot ${s.slot}${s.retired ? ' · retired (bust)' : ''}</small><br><small>${s.year} · ${formatMoney(s.money)} · ${s.vehicles} vehicles · saved ${when(s.savedAt)}</small></div>`
                    + `<button class="dd-btn primary" data-act="continue" data-slot="${s.slot}" ${s.retired ? 'disabled title="A bust company can only be kept as a record"' : ''}>Continue</button>`
                    + `<button class="dd-btn" data-act="export" data-slot="${s.slot}">Export</button>`
                    + `<button class="dd-btn danger" data-act="delete" data-slot="${s.slot}">${busy ? 'Really delete?' : 'Delete'}</button></li>`;
            }
            html += '</ul>';
            if (any && list.every(s => !s.empty)) html += '<p class="dd-muted">All slots are in use: delete one to start another company.</p>';
            if (session.career && args.inGame) html += '<p><button class="dd-btn" data-act="back">Back to the game</button></p>';
            return html;
        },
        mounted(panel) {
            panel.querySelectorAll('[data-import]').forEach(input => input.addEventListener('change', async () => {
                const file = input.files?.[0];
                if (!file) return;
                try { store.importJson(Number(input.dataset.import), await file.text()); message = 'Imported.'; } catch (e) { message = `Couldn't import that file: ${e.message}`; }
                menus.render();
            }));
        },
        act(action, data, m) {
            const slot = Number(data.slot);
            if (action !== 'delete') confirm = null;
            message = '';
            if (action === 'new') m.open('newgame', { slot });
            else if (action === 'continue') { ctx.startGame(slot, store.read(slot)); m.close(); }
            else if (action === 'export') ctx.download(`delivery-driver-slot${slot}.json`, store.exportJson(slot));
            else if (action === 'delete') {
                if (confirm !== slot) { confirm = slot; return; }
                confirm = null;
                store.remove(slot);
            } else if (action === 'back') m.close();
        },
    });

    menus.register('newgame', {
        render({ slot }) {
            return `<h2>New company</h2><p>Slot ${slot}. You start on 1 January 1919 at the Exeter depot with a Tamar T-Ton van and £400.</p>`
                + `<p><label>Company name <input class="dd-input" data-field="company" maxlength="32" value="Exe Valley Carriers"></label></p>`
                + `<p><label>Livery <input type="color" data-field="livery1" value="#2f5d8a"> <input type="color" data-field="livery2" value="#e8c547"></label></p>`
                + `<p><label><input type="checkbox" data-field="tutorial" checked> Show me how (guided first job)</label></p>`
                + `<p><button class="dd-btn primary" data-act="start">Start</button> <button class="dd-btn" data-act="cancel">Back</button></p>`;
        },
        act(action, data, m) {
            const get = f => m.panel.querySelector(`[data-field="${f}"]`);
            if (action === 'start') {
                const form = { company: get('company').value, livery: { livery1: get('livery1').value, livery2: get('livery2').value }, tutorial: get('tutorial').checked };
                ctx.startGame(m.currentArgs.slot, null, form);
                m.close();
            } else if (action === 'cancel') m.open('slots', {});
        },
    });

    menus.register('game', {
        render() {
            return `<h2>Game menu</h2><p>${escape(session.career.company)} · slot ${ctx.slot() ?? '-'}</p><p class="dd-tabs">`
                + '<button class="dd-btn primary" data-act="resume">Resume</button>'
                + '<button class="dd-btn" data-act="save">Save now</button>'
                + '<button class="dd-btn" data-act="slots">Save slots</button>'
                + '<button class="dd-btn" data-act="settings">Settings</button>'
                + '<button class="dd-btn" data-act="help">Controls</button>'
                + `${session.tutorial && !session.tutorial.done ? '<button class="dd-btn" data-act="skip">Skip the tutorial</button>' : ''}</p>${message ? `<p class="dd-muted">${escape(message)}</p>` : ''}`;
        },
        act(action, data, m) {
            message = '';
            if (action === 'resume') m.close();
            else if (action === 'save') message = ctx.saveNow() ? 'Saved.' : 'Couldn’t save (storage full or blocked).';
            else if (action === 'slots') { ctx.saveNow(); m.open('slots', { inGame: true }); }
            else if (action === 'settings') m.open('settings');
            else if (action === 'help') m.open('help');
            else if (action === 'skip') { ctx.skipTutorial(); m.close(); }
        },
    });

    menus.register('settings', {
        render() {
            const s = session.settings;
            const row = (label, field, options) => `<h3>${label}</h3>${tabs(options.map(([id, l]) => ({ id: `${field}:${id}`, label: l })), `${field}:${s[field]}`, 'set')}`;
            return `<h2>Settings</h2><p class="dd-muted">Saved on this device.</p>`
                + row('Quality', 'quality', [['low', 'Low (phones)'], ['medium', 'Medium'], ['high', 'High']])
                + row('Graphics', 'renderer', [['auto', 'Auto'], ['webgl', '3D (WebGL)'], ['canvas2d', 'Compatibility (Canvas)']])
                + row('Camera', 'camera', [['chase', 'Behind the truck'], ['north', 'North up']])
                + row('Gearbox', 'manualGears', [['false', 'Automatic'], ['true', 'Manual (Shift/Ctrl)']])
                + row('Touch steering', 'touchLayout', [['slider', 'Slider'], ['wheel', 'Wheel']])
                + row('Units', 'units', [['imperial', 'mph and miles'], ['metric', 'km/h and km']])
                + '<p><button class="dd-btn" data-act="back">Back</button></p>';
        },
        act(action, data, m) {
            if (action === 'set') {
                const [field, raw] = data.id.split(':');
                const value = raw === 'true' ? true : raw === 'false' ? false : raw;
                ctx.applySettings({ ...session.settings, [field]: value });
            } else if (action === 'back') m.open('game');
        },
    });

    menus.register('help', {
        render() {
            const rows = [
                ['W / ↑', 'Accelerate (hold S at a standstill to reverse)'], ['S / ↓', 'Brake'], ['A D / ← →', 'Steer'], ['Space', 'Handbrake'],
                ['F / Enter', 'Depot office, garage, ferry, tow'], ['C', 'Couple / uncouple a trailer'], ['Q / E', 'Indicators'], ['H', 'Horn'],
                ['M', 'Map'], ['J', 'Current job'], ['V', 'Camera: behind / north up'], ['Z / X', 'Zoom in / out'], ['G', 'Manual gears (Shift/Ctrl to change)'], ['Esc', 'Game menu'],
            ];
            return `<h2>Controls</h2><table class="dd-ledger">${rows.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`).join('')}</table>`
                + '<p>On a tablet or phone: the slider steers, the pedals drive, R selects reverse, and the buttons do the rest. A gamepad works too.</p><p><button class="dd-btn" data-act="back">Back</button></p>';
        },
        act(action, data, m) { if (action === 'back') m.open('game'); },
    });
}
