// Developer tools panel (only mounted when the shell reports the Development environment): jump the clock to any year or
// hour, force the weather, change traffic density or spawn a given vehicle, add money, fix the vehicle, swap the model
// being driven, and teleport to depots, towns or the next stop. A floating wrench opens it; it is touch friendly.
import { VEHICLES } from '../game/catalogue.js';

const WEATHER = [['', 'Auto'], ['clear', '☀️ Clear'], ['overcast', '☁️ Overcast'], ['rain', '🌧️ Rain'], ['fog', '🌫️ Fog']];
const ERAS = [1919, 1930, 1945, 1955, 1965, 1975, 1985, 1995, 2005, 2015, 2024];
const HOURS = [['Dawn', 6], ['Noon', 12], ['Dusk', 18], ['Night', 0]];

export function createDebugPanel(root, session, signal) {
    const tools = session.debugTools;
    const button = Object.assign(document.createElement('button'), { className: 'dd-dbg-btn', textContent: '🛠', title: 'Debug tools' });
    const panel = Object.assign(document.createElement('div'), { className: 'dd-dbg-panel' });
    panel.hidden = true;
    root.append(button, panel);

    const sec = (title, body) => `<section><h4>${title}</h4>${body}</section>`;
    const btns = list => list.map(([act, label, data = '']) => `<button data-act="${act}" data-v="${data}">${label}</button>`).join('');

    function render() {
        const places = tools.places();
        panel.innerHTML = `<div class="dd-dbg-head"><b>Debug tools</b><span class="dd-dbg-info"></span><button data-act="close">✕</button></div>`
            + sec('Era / year', `<div class="dd-dbg-row">${btns(ERAS.map(y => ['year', y, y]))}</div>
                <div class="dd-dbg-row"><input type="number" class="dd-dbg-year" min="1919" max="2025" value="${session.year}"><button data-act="yearInput">Set year</button></div>`)
            + sec('Time of day', `<div class="dd-dbg-row">${btns(HOURS.map(([l, h]) => ['hour', l, h]))}</div>`)
            + sec('Weather', `<div class="dd-dbg-row">${btns(WEATHER.map(([k, l]) => ['weather', l, k]))}</div>`)
            + sec('Traffic', `<div class="dd-dbg-row"><label>Density <b class="dd-dbg-dens">${tools.density.toFixed(2)}×</b></label>
                <input type="range" class="dd-dbg-density" min="0" max="4" step="0.25" value="${tools.density}"></div>
                <div class="dd-dbg-row">${btns([['clearTraffic', 'Clear all']])}
                <select class="dd-dbg-type">${tools.trafficTypes().map(t => `<option value="${t.id}">${t.name} (${t.from}-${t.to > 2050 ? 'now' : t.to})</option>`).join('')}</select>
                <button data-act="spawn">Spawn ahead</button></div>`)
            + sec('Money & vehicle', `<div class="dd-dbg-row">${btns([['money', '+£100', 100], ['money', '+£1,000', 1000], ['money', '+£10,000', 10000], ['money', '-£1,000', -1000], ['fix', 'Fix & refuel']])}</div>
                <div class="dd-dbg-row"><select class="dd-dbg-spec">${VEHICLES.map(v => `<option value="${v.id}">${v.year} ${v.name}</option>`).join('')}</select>
                <button data-act="spec">Show model (visual only)</button></div>`)
            + sec('Teleport', `<div class="dd-dbg-row"><select class="dd-dbg-place">${places.map((p, i) => `<option value="${i}">${p.name}</option>`).join('')}</select>
                <button data-act="go">Go</button><button data-act="stop">Next stop</button></div>`);
        refreshInfo();
    }
    function refreshInfo() {
        const info = panel.querySelector('.dd-dbg-info');
        if (info) info.textContent = `${session.year} · ${session.weather?.kind ?? ''} · ${session.vehicles?.length ?? 0} vehicles`;
    }

    const toggle = open => {
        panel.hidden = open === undefined ? !panel.hidden : !open;
        if (!panel.hidden) render();
    };
    button.addEventListener('click', () => toggle(), { signal });
    panel.addEventListener('input', e => {
        if (e.target.matches('.dd-dbg-density')) {
            tools.setDensity(+e.target.value);
            panel.querySelector('.dd-dbg-dens').textContent = `${(+e.target.value).toFixed(2)}×`;
        }
    }, { signal });
    panel.addEventListener('click', e => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const v = b.dataset.v, q = sel => panel.querySelector(sel);
        switch (b.dataset.act) {
            case 'close': toggle(false); return;
            case 'year': tools.setYear(+v); break;
            case 'yearInput': tools.setYear(Math.max(1919, Math.min(2025, +q('.dd-dbg-year').value || session.year))); break;
            case 'hour': tools.setHour(+v); break;
            case 'weather': tools.setWeather(v || null); break;
            case 'clearTraffic': tools.clearTraffic(); break;
            case 'spawn': tools.spawnTraffic(q('.dd-dbg-type').value); break;
            case 'money': tools.addMoney(+v); break;
            case 'fix': tools.fixVehicle(); break;
            case 'spec': tools.setSpec(q('.dd-dbg-spec').value); break;
            case 'go': tools.goTo(tools.places()[+q('.dd-dbg-place').value]); break;
            case 'stop': if (!tools.goToStop()) session.emit('toast', 'No active job stop to go to'); break;
            default: return;
        }
        refreshInfo();
        if (b.dataset.act === 'year' || b.dataset.act === 'yearInput') q('.dd-dbg-year').value = session.year;
    }, { signal });
    const timer = setInterval(() => { if (!panel.hidden) refreshInfo(); }, 1000);
    signal.addEventListener('abort', () => clearInterval(timer));
    return { toggle, dispose() { button.remove(); panel.remove(); clearInterval(timer); } };
}
