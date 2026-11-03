// Depot office tabs beyond the contracts board: Garage (the fleet here, fuel and repairs), Dealer (new and used
// vehicles, trailers, part-exchange), Bank (loans) and Company (name, livery, reputation).
import { vehicleById, trailerById } from '../game/catalogue.js';
import { formatMoney, debt, loanLimit, refuelCost, repairCost } from '../game/economy.js';
import { showroom, valueOf, yearOf } from '../game/dealer.js';
import { TIERS, tierOf, nextTier, clientStanding, tierInfo } from '../game/reputation.js';
import { roster, vehiclesAt, depotPrice, aiCannotTake } from '../game/fleet.js';
import { summarise } from '../game/economy.js';
import { formatDuration } from '../game/calendar.js';
import { escape } from './hud.js';

export const OFFICE_TABS = [
    { id: 'garage', label: '🔧 Fleet' },
    { id: 'drivers', label: '🧑‍✈️ Drivers' },
    { id: 'depots', label: '🏭 Depots' },
    { id: 'dealer', label: '🚚 Dealer' },
    { id: 'bank', label: '🏦 Bank' },
    { id: 'company', label: '🏢 Company' },
];

let tradeIn = false;

export function officeHtml(tab, session, depot) {
    switch (tab) {
        case 'garage': return garageHtml(session, depot);
        case 'drivers': return driversHtml(session, depot);
        case 'depots': return depotsHtml(session, depot);
        case 'dealer': return dealerHtml(session, depot);
        case 'bank': return bankHtml(session);
        case 'company': return companyHtml(session);
        default: return '';
    }
}

function specLine(spec) {
    const carry = spec.tags.includes('tractor-unit') ? `pulls trailers up to ${(spec.trailerMax / 1000).toFixed(0)} t` : `${spec.payload.toLocaleString('en-GB')} kg`;
    return `${escape(spec.make)} · ${carry} · ${spec.topSpeedMph} mph · ${spec.tags.filter(t => t !== 'rigid').join(', ')}`;
}

function garageHtml(session, depot) {
    const c = session.career;
    const p = session.player;
    let html = serviceHtml(session, p);
    html += '<h3>Your fleet</h3><ul class="dd-list">';
    const name = id => session.world.depots.find(d => d.id === id)?.name ?? id;
    for (const { rec, spec, where: base, status } of roster(c, name)) {
        const here = rec.depot === depot.id && rec.id !== c.activeVehicle && !rec.driver;
        const where = `${escape(base)} · ${escape(status)}`;
        html += `<li class="dd-row"><div class="dd-grow"><b>${escape(spec.name)}</b> <small>(${rec.built})</small><br><small>${where} · wear ${Math.round(rec.wear)}% · damage ${Math.round(rec.damage)}% · worth ${formatMoney(valueOf(c, rec))}</small></div>`
            + `<button class="dd-btn primary" data-act="drive" data-id="${rec.id}" ${here && !c.job ? '' : 'disabled'} title="${c.job ? 'Finish your job first' : ''}">Drive</button>`
            + `<button class="dd-btn" data-act="sell" data-id="${rec.id}" ${rec.id !== c.activeVehicle && c.fleet.length > 1 ? '' : 'disabled'}>Sell</button></li>`;
    }
    html += '</ul>';
    if (c.trailers?.length) {
        html += '<h3>Trailers</h3><ul class="dd-list">';
        for (const t of c.trailers) {
            const spec = trailerById(t.model);
            html += `<li class="dd-row"><div class="dd-grow"><b>${escape(spec.name)}</b><br><small>${t.coupledTo ? 'coupled' : escape(session.world.depots.find(d => d.id === t.depot)?.name ?? 'out on the road')}</small></div><button class="dd-btn" data-act="sellTrailer" data-id="${t.id}" ${t.coupledTo ? 'disabled' : ''}>Sell</button></li>`;
        }
        html += '</ul>';
    }
    return html;
}

function dealerHtml(session, depot) {
    const c = session.career;
    const room = showroom(c, session.world.region.seed);
    const active = c.fleet.find(v => v.id === c.activeVehicle);
    const credit = tradeIn && active ? valueOf(c, active) : 0;
    let html = `<p><label><input type="checkbox" data-act="tradeIn" ${tradeIn ? 'checked' : ''} ${c.job ? 'disabled' : ''}> Part-exchange the ${escape(session.player.spec.name)} (${formatMoney(active ? valueOf(c, active) : 0)})</label></p>`;
    html += '<h3>New vehicles</h3><ul class="dd-list">';
    for (const spec of room.vehicles) {
        const cost = spec.price - credit;
        html += `<li class="dd-row"><div class="dd-grow"><b>${escape(spec.name)}</b> <small>(${spec.year})</small><br><small>${specLine(spec)}</small></div><span class="dd-price">${formatMoney(spec.price)}</span><button class="dd-btn primary" data-act="buy" data-model="${spec.id}" ${c.ledger.money >= cost ? '' : 'disabled'}>Buy</button></li>`;
    }
    html += '</ul><h3>Used this week</h3><ul class="dd-list">';
    for (const u of room.used) {
        const spec = vehicleById(u.model);
        html += `<li class="dd-row"><div class="dd-grow"><b>${escape(spec.name)}</b> <small>(${u.built}, ${u.mileage.toLocaleString('en-GB')} miles, wear ${u.wear}%)</small><br><small>${specLine(spec)}</small></div><span class="dd-price">${formatMoney(u.price)}</span><button class="dd-btn" data-act="buyUsed" data-id="${u.id}" ${c.ledger.money >= u.price - credit ? '' : 'disabled'}>Buy</button></li>`;
    }
    if (!room.used.length) html += '<li class="dd-row">Nothing this week.</li>';
    html += '</ul>';
    if (room.trailers.length) {
        html += '<h3>Trailers (for tractor units)</h3><ul class="dd-list">';
        for (const t of room.trailers) {
            html += `<li class="dd-row"><div class="dd-grow"><b>${escape(t.name)}</b> <small>(${t.year})</small><br><small>${(t.capacity / 1000).toFixed(0)} t · ${t.length} m · ${t.tags.join(', ')}</small></div><span class="dd-price">${formatMoney(t.price)}</span><button class="dd-btn" data-act="buyTrailer" data-model="${t.id}" ${c.ledger.money >= t.price ? '' : 'disabled'}>Buy</button></li>`;
        }
        html += '</ul>';
    }
    void depot;
    return html;
}

function bankHtml(session) {
    const c = session.career;
    const year = yearOf(c);
    const limit = loanLimit(c, year, tierOf(c.reputation.points));
    const owed = debt(c);
    const room = Math.max(0, limit - owed);
    let html = `<p>Borrowing limit ${formatMoney(limit)} · owed ${formatMoney(owed)} · interest ${'0.35%'} a week, 2% of each loan repaid every Monday.</p>`;
    html += `<p>${[100, 500, 2000, 10000].filter(a => a <= room).map(a => `<button class="dd-btn" data-act="loan" data-amount="${a}">Borrow ${formatMoney(a)}</button>`).join(' ') || 'The bank won’t lend you any more.'}</p>`;
    if (c.loans.length) {
        html += '<h3>Loans</h3><ul class="dd-list">';
        for (const l of c.loans) {
            html += `<li class="dd-row"><div class="dd-grow">${l.forced ? 'Bailout loan' : 'Loan'} of ${formatMoney(l.principal)} · ${formatMoney(l.balance)} left · ${(l.rate * 100).toFixed(2)}% a week</div><button class="dd-btn" data-act="repay" data-id="${l.id}" ${c.ledger.money >= l.balance ? '' : 'disabled'}>Pay off</button></li>`;
        }
        html += '</ul>';
    }
    return html;
}

function companyHtml(session) {
    const c = session.career;
    const points = c.reputation.points;
    const tier = TIERS[tierOf(points)];
    const next = nextTier(points);
    let html = `<p><label>Company name <input class="dd-input" data-field="company" maxlength="32" value="${escape(c.company)}"></label></p>`
        + `<p><label>Livery <input type="color" data-field="livery1" value="${c.livery.livery1}"> <input type="color" data-field="livery2" value="${c.livery.livery2}"></label> <button class="dd-btn" data-act="saveCompany">Save</button></p>`
        + `<h3>Reputation: ${escape(tier.name)}</h3><p>${points} points${next ? ` · ${next.at - points} more to become a ${escape(next.name)}` : ''}. ${c.stats.jobs} jobs done, ${c.stats.onTime} on time, ${formatMoney(c.stats.earned)} earned.</p>`;
    const clients = Object.values(c.clients).sort((a, b) => (b.rep ?? 0) - (a.rep ?? 0)).slice(0, 8);
    if (clients.length) html += `<ul class="dd-list">${clients.map(cl => `<li class="dd-row"><div class="dd-grow">${escape(cl.name)}</div><small>${cl.jobs} jobs · ${clientStanding(cl.rep)}</small></li>`).join('')}</ul>`;
    return html;
}

/** Handles a button in one of the office tabs. */
export function officeAct(action, data, session, depot, panel) {
    switch (action) {
        case 'tradeIn': tradeIn = !tradeIn; break;
        case 'buy': session.buyVehicle({ model: data.model, depot, tradeIn }); tradeIn = false; break;
        case 'buyUsed': session.buyVehicle({ usedId: data.id, depot, tradeIn }); tradeIn = false; break;
        case 'buyTrailer': session.buyTrailer(data.model, depot); break;
        case 'sell': session.sellVehicle(data.id); break;
        case 'sellTrailer': session.sellTrailer(data.id); break;
        case 'drive': session.driveFrom(data.id, depot); break;
        case 'refuel': session.refuel(); break;
        case 'repair': session.repair(); break;
        case 'loan': session.takeLoan(Number(data.amount)); break;
        case 'repay': session.repayLoan(data.id); break;
        case 'hire': session.hire(data.id, depot); break;
        case 'fire': session.fire(data.id); break;
        case 'auto': session.toggleAuto(data.id); break;
        case 'assign': session.assign(data.id, panel.querySelector(`[data-assign="${data.id}"]`)?.value); break;
        case 'give': session.giveJob(data.id, panel.querySelector(`[data-give="${data.id}"]`)?.value, depot); break;
        case 'send': session.sendTo(data.id, panel.querySelector(`[data-send="${data.id}"]`)?.value); break;
        case 'buyDepot': session.buyDepot(data.id); break;
        case 'saveCompany': {
            const get = f => panel.querySelector(`[data-field="${f}"]`)?.value;
            session.renameCompany(get('company'), { livery1: get('livery1'), livery2: get('livery2') });
            break;
        }
        default: return false;
    }
    return true;
}

/** Fuel and repair buttons for the vehicle being driven (garages and depot offices). */
export function serviceHtml(session, p) {
    const spec = p.spec;
    const fuelCost = refuelCost(spec, p.rec.fuel);
    const fix = repairCost(spec, p.rec.wear, p.rec.damage);
    const unit = spec.electric ? 'kWh' : 'L';
    return `<h3>${escape(spec.name)}</h3><p>${spec.electric ? 'Battery' : 'Fuel'} ${Math.round(p.rec.fuel)} / ${spec.fuelTank} ${unit} · wear ${Math.round(p.rec.wear)}% · damage ${Math.round(p.rec.damage)}% · ${Math.round(p.rec.mileage).toLocaleString('en-GB')} miles</p>`
        + `<p><button class="dd-btn primary" data-act="refuel" ${fuelCost > 0.004 ? '' : 'disabled'}>${spec.electric ? 'Charge' : 'Fill up'} (${formatMoney(fuelCost)})</button> `
        + `<button class="dd-btn" data-act="repair" ${fix > 0 ? '' : 'disabled'}>Repair (${formatMoney(fix)})</button></p>`;
}

function driversHtml(session, depot) {
    const c = session.career;
    const here = c.drivers.filter(d => d.depot === depot.id);
    const away = c.drivers.filter(d => d.depot !== depot.id);
    const offers = session.offersAt(depot);
    const free = vehiclesAt(c, depot.id).filter(v => !v.driver);
    let html = `<p>Drivers work on their own: give them a job from this depot's board, or tick auto-take. Wages are paid every Monday.</p><h3>Drivers based here</h3>`;
    if (!here.length) html += '<p class="dd-muted">None yet. Hire one below.</p>';
    html += '<ul class="dd-list">';
    for (const d of here) {
        const v = c.fleet.find(x => x.id === d.vehicle);
        const status = d.job ? `on a job: ${escape(d.job.title)} (back in ${formatDuration(d.job.end - c.calendar.minutes)})` : v ? `waiting with the ${escape(vehicleById(v.model).name)}` : 'needs a vehicle';
        let controls = '';
        if (!d.job) {
            const choices = [...(v ? [v] : []), ...free].map(x => `<option value="${x.id}" ${x.id === d.vehicle ? 'selected' : ''}>${escape(vehicleById(x.model).name)}</option>`).join('');
            controls += `<select class="dd-input" data-assign="${d.id}"><option value="">(no vehicle)</option>${choices}</select><button class="dd-btn" data-act="assign" data-id="${d.id}">Set</button>`;
            if (v) {
                const fit = offers.filter(o => !aiCannotTake(c, d, o));
                controls += fit.length
                    ? `<select class="dd-input" data-give="${d.id}">${fit.map(o => `<option value="${o.id}">${escape(o.title)} (${formatMoney(o.pay)})</option>`).join('')}</select><button class="dd-btn primary" data-act="give" data-id="${d.id}">Give job</button>`
                    : '<small>No suitable work on the board</small>';
                const others = session.world.depots.filter(x => c.depots.includes(x.id) && x.id !== depot.id);
                if (others.length) controls += `<select class="dd-input" data-send="${d.id}">${others.map(x => `<option value="${x.id}">${escape(x.name)}</option>`).join('')}</select><button class="dd-btn" data-act="send" data-id="${d.id}">Send there</button>`;
            }
        }
        html += `<li class="dd-row"><div class="dd-grow"><b>${escape(d.name)}</b> <small>skill ${'★'.repeat(d.skill)}${'☆'.repeat(5 - d.skill)} · ${formatMoney(d.wage)}/week · earned ${formatMoney(d.earned)}</small><br><small>${status}</small></div>`
            + `<label><input type="checkbox" data-act="auto" data-id="${d.id}" ${d.auto ? 'checked' : ''}> auto-take</label>${controls}<button class="dd-btn danger" data-act="fire" data-id="${d.id}">Fire</button></li>`;
    }
    html += '</ul>';
    if (away.length) html += `<p class="dd-muted">Elsewhere: ${away.map(d => `${escape(d.name)} (${escape(session.world.depots.find(x => x.id === d.depot)?.name ?? '')})`).join(', ')}</p>`;
    html += '<h3>Looking for work this week</h3><ul class="dd-list">';
    for (const a of session.hirePool()) {
        html += `<li class="dd-row"><div class="dd-grow"><b>${escape(a.name)}</b> <small>skill ${'★'.repeat(a.skill)}${'☆'.repeat(5 - a.skill)}</small></div><span class="dd-price">${formatMoney(a.wage)}/week</span><button class="dd-btn primary" data-act="hire" data-id="${a.id}">Hire</button></li>`;
    }
    return `${html}</ul>`;
}

function depotsHtml(session, depot) {
    const c = session.career;
    const canBuy = tierInfo(c.reputation.points).depots;
    const owned = session.world.depots.filter(d => c.depots.includes(d.id));
    const forSale = session.world.depots.filter(d => !c.depots.includes(d.id)).sort((a, b) => Math.hypot(a.x - depot.x, a.y - depot.y) - Math.hypot(b.x - depot.x, b.y - depot.y));
    let html = '<h3>Your depots</h3><ul class="dd-list">';
    for (const d of owned) {
        const vehicles = c.fleet.filter(v => v.depot === d.id).length;
        const drivers = c.drivers.filter(x => x.depot === d.id).length;
        html += `<li class="dd-row"><div class="dd-grow"><b>${escape(d.name)}</b>${d.id === c.homeDepot ? ' <small>(head office)</small>' : ''}<br><small>${vehicles} vehicles · ${drivers} drivers</small></div></li>`;
    }
    html += `</ul><h3>Depots for sale</h3>${canBuy ? '' : `<p class="dd-muted">Become a ${escape(TIERS[2].name)} to buy depots.</p>`}<ul class="dd-list">`;
    for (const d of forSale) {
        const price = depotPrice(session.world, d);
        html += `<li class="dd-row"><div class="dd-grow"><b>${escape(d.name)}</b></div><span class="dd-price">${formatMoney(price)}</span><button class="dd-btn" data-act="buyDepot" data-id="${d.id}" ${canBuy && c.ledger.money >= price ? '' : 'disabled'}>Buy</button></li>`;
    }
    return `${html}</ul>`;
}

/** Last week's money in and out, by kind (shown above the ledger). */
export function financeHtml(session) {
    const c = session.career;
    const since = c.calendar.minutes - 7 * 1440;
    const t = summarise(c.ledger, since);
    const rows = [['Income', t.income], ['Wages', t.wages], ['Fuel', t.fuel], ['Repairs', t.repairs], ['Loan interest', t.interest], ['Loans (in/out)', t.loan], ['Depot upkeep', t.upkeep], ['Vehicles and depots', (t.vehicles ?? 0) + (t.depots ?? 0)], ['Tows, ferries, penalties', (t.tow ?? 0) + (t.ferry ?? 0) + (t.penalty ?? 0)]]
        .filter(([, v]) => v);
    const total = Object.values(t).reduce((a, b) => a + b, 0);
    return `<h3>The last 7 days</h3><table class="dd-ledger">${rows.map(([k, v]) => `<tr><td>${k}</td><td class="${v < 0 ? 'neg' : 'pos'}">${formatMoney(v)}</td></tr>`).join('')}<tr><td><b>Net</b></td><td class="${total < 0 ? 'neg' : 'pos'}"><b>${formatMoney(total)}</b></td></tr></table><h3>Ledger</h3>`;
}
