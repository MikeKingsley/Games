// Money and running costs: the ledger, fuel, wear and damage, repairs, vehicle values and the used market,
// loans, the Monday weekly tick (wages, interest, upkeep) and the bankruptcy sequence
// (forced bailout loan -> forced sale -> game over). Prices are flat across the decades (no inflation).
import { WORLD_SCALE, TRIP_RATE } from '../config.js';
import { vehicleById, VEHICLES } from './catalogue.js';
import { seededRng, hashSeed, pick, range } from '../engine/rng.js';
import { gradeFuelFactor } from '../sim/slope.js';

export { gradeFuelFactor };

const MAX_ENTRIES = 400;
export const FUEL_PRICE = 0.08;       // £ per litre
export const POWER_PRICE = 0.05;      // £ per kWh (electric vans)
export const LOAN_RATE = 0.0035;      // weekly interest
export const BAILOUT_RATE = 0.008;    // the forced loan costs more
export const REPAY_SHARE = 0.02;      // weekly repayment as a share of the original loan
export const HOME_UPKEEP = 1;         // £ per week for the home depot
export const DEPOT_UPKEEP = 4;        // £ per week for each other depot

export function createLedger(money = 0) {
    return { money, entries: [] };
}

/** Adds an entry (amount may be negative) and returns it. Old entries roll off past MAX_ENTRIES. */
export function post(ledger, minutes, text, amount, category = 'other') {
    const entry = { t: Math.floor(minutes), text, amount: Math.round(amount * 100) / 100, category };
    ledger.money = Math.round((ledger.money + entry.amount) * 100) / 100;
    ledger.entries.push(entry);
    if (ledger.entries.length > MAX_ENTRIES) ledger.entries.splice(0, ledger.entries.length - MAX_ENTRIES);
    return entry;
}

/** Totals by category over entries since `fromMinutes`. */
export function summarise(ledger, fromMinutes = -Infinity) {
    const out = {};
    for (const e of ledger.entries) if (e.t >= fromMinutes) out[e.category] = (out[e.category] ?? 0) + e.amount;
    return out;
}

export const formatMoney = n => `${n < 0 ? '-' : ''}£${Math.abs(Math.round(n)).toLocaleString('en-GB')}`;

// ---- Fuel, wear and damage -----------------------------------------------------------------------------------

/**
 * Fuel (litres, or kWh for electric) used to drive `worldMetres`: the vehicle's rate per 100 real km (times TRIP_RATE, so a minute of driving burns what it did at 1:13), up to 70%
 * more when fully loaded, a little less when coasting, and more climbing / less descending (gradeFuelFactor: +12%
 * per 1% up, -8% per 1% down, floor 0.3; `grade` is along the direction of travel).
 */
export function fuelBurn(spec, worldMetres, loadFraction = 0, throttle = 1, grade = 0) {
    const realKm = (worldMetres / WORLD_SCALE / 1000) * TRIP_RATE;
    return (spec.fuelUse / 100) * realKm * (1 + 0.7 * Math.min(1, Math.max(0, loadFraction))) * (0.45 + 0.55 * throttle) * gradeFuelFactor(grade);
}

export const fuelPrice = spec => (spec.electric ? POWER_PRICE : FUEL_PRICE);
/** Cost to fill the tank from `fuel`. */
export const refuelCost = (spec, fuel) => Math.max(0, spec.fuelTank - fuel) * fuelPrice(spec);

/** Wear in percent per real mile driven. */
export const WEAR_PER_MILE = 0.02;
/** Wear for driving `miles` real miles: per-mile wear times TRIP_RATE, so wear per minute of driving is as at 1:13. */
export const wearForMiles = miles => miles * WEAR_PER_MILE * TRIP_RATE;

/**
 * Hills: a full-throttle climb steeper than CLIMB_GRADE strains the engine once it has gone on for CLIMB_AFTER
 * seconds: CLIMB_WEAR percent a second at 8% (more on steeper climbs, up to double; ~3x the wear of the distance).
 */
export const CLIMB_GRADE = 0.05, CLIMB_AFTER = 5, CLIMB_WEAR = 0.006;
/** Engine wear (percent) for a step `dt` of a climb that has lasted `seconds` at `grade` (along the travel). */
export function climbWear(seconds, grade, dt) {
    if (seconds <= CLIMB_AFTER || grade <= CLIMB_GRADE) return 0;
    return CLIMB_WEAR * Math.min(2, grade / 0.08) * dt;
}

/**
 * Brake wear: percent per J/kg of braking work (a stop from 15 m/s, ~110 J/kg, is ~0.01%), up to 4x when the
 * brakes are overheating (heat over 1, i.e. fading: sim/slope.js).
 */
export const BRAKE_WEAR = 1e-4;
export function brakeWear(work, mass, heat = 0) {
    return (Math.max(0, work) / Math.max(1, mass)) * BRAKE_WEAR * (1 + 3 * Math.min(1, Math.max(0, heat - 1)));
}
/** Damage (percent) from a collision at `impact` m/s. Gentle bumps do nothing. */
export const impactToDamage = impact => (impact > 1.5 ? Math.min(60, Math.pow(impact - 1.5, 1.5) * 2) : 0);
/** Engine power multiplier from wear and damage (a battered lorry is slower). */
export const performanceFactor = (wear, damage) => Math.max(0.45, 1 - damage / 250 - wear / 500);
export function repairCost(spec, wear, damage) {
    return Math.round(spec.price * (damage * 0.004 + wear * 0.0015) * 100) / 100;
}

// ---- Values and the dealer -----------------------------------------------------------------------------------

/** What a dealer pays for a vehicle: falls with age (12% a year), wear and damage; never below 12% of new. */
export function tradeInValue(spec, ageYears, wear = 0, damage = 0) {
    const age = Math.max(0, ageYears);
    return Math.round(spec.price * Math.max(0.12, 0.88 ** age) * (1 - wear / 250) * (1 - damage / 150) * 0.85);
}

/** This week's used vehicles: models from up to 25 years back, with mileage and wear, seeded per week. */
export function usedMarket(seed, week, year, count = 5) {
    const rng = seededRng(hashSeed(seed, 'used', week));
    const models = VEHICLES.filter(v => v.year <= year && year - v.year <= 25);
    const out = [];
    for (let k = 0; k < count && models.length; k++) {
        const spec = pick(rng, models);
        const age = Math.min(year - spec.year, Math.floor(range(rng, 1, 12)));
        const wear = Math.round(range(rng, 10, 70));
        const mileage = Math.round(age * range(rng, 6000, 20000));
        const price = Math.round(tradeInValue(spec, age, wear) * 1.3);
        out.push({ id: `used-${week}-${k}`, model: spec.id, age, wear, mileage, price, built: year - age });
    }
    return out;
}

/** Value of the whole fleet in a year (for loan limits). */
export function fleetValue(fleet, year) {
    return fleet.reduce((sum, v) => sum + tradeInValue(vehicleById(v.model), year - v.built, v.wear, v.damage), 0);
}

// ---- Loans -----------------------------------------------------------------------------------------------------

export const debt = career => career.loans.reduce((s, l) => s + l.balance, 0);
/** How much the bank will lend in total: a base, half the fleet's value and more for a good reputation. */
export const loanLimit = (career, year, tier = 0) => Math.round(300 + fleetValue(career.fleet, year) * 0.5 + tier * 500);

export function takeLoan(career, amount, { rate = LOAN_RATE, forced = false, text = 'Bank loan' } = {}) {
    amount = Math.round(amount);
    if (amount <= 0) return null;
    const loan = { id: `loan-${career.loans.length + 1}-${Math.floor(career.calendar.minutes)}`, principal: amount, balance: amount, rate, forced, taken: career.calendar.minutes };
    career.loans.push(loan);
    post(career.ledger, career.calendar.minutes, text, amount, 'loan');
    return loan;
}

/** Pays a loan off (in part or full) from the bank balance. */
export function repayLoan(career, id, amount) {
    const loan = career.loans.find(l => l.id === id);
    if (!loan) return 0;
    const pay = Math.min(amount, loan.balance);
    loan.balance = Math.round((loan.balance - pay) * 100) / 100;
    post(career.ledger, career.calendar.minutes, 'Loan repayment', -pay, 'loan');
    if (loan.balance <= 0.005) career.loans.splice(career.loans.indexOf(loan), 1);
    return pay;
}

// ---- The weekly tick -------------------------------------------------------------------------------------------

/**
 * Monday 00:00: wages, loan interest and repayments, depot upkeep; then the bankruptcy check.
 * ctx = {year, tier}. Returns a list of events: {kind: 'wages'|'interest'|'upkeep'|'bailout'|'forcedSale'|'gameOver', ...}.
 */
export function weeklyTick(career, ctx = {}) {
    const t = career.calendar.minutes;
    const events = [];
    const wages = (career.drivers ?? []).reduce((s, d) => s + d.wage, 0);
    if (wages) { post(career.ledger, t, 'Drivers’ wages', -wages, 'wages'); events.push({ kind: 'wages', amount: wages }); }
    for (const loan of [...career.loans]) {
        const interest = Math.round(loan.balance * loan.rate * 100) / 100;
        if (interest > 0) { post(career.ledger, t, 'Loan interest', -interest, 'interest'); events.push({ kind: 'interest', amount: interest }); }
        repayLoan(career, loan.id, Math.max(1, Math.round(loan.principal * REPAY_SHARE)));
    }
    const upkeep = (career.depots ?? []).reduce((s, id) => s + (id === career.homeDepot ? HOME_UPKEEP : DEPOT_UPKEEP), 0);
    if (upkeep) { post(career.ledger, t, 'Depot upkeep', -upkeep, 'upkeep'); events.push({ kind: 'upkeep', amount: upkeep }); }
    events.push(...bankruptcyCheck(career, ctx));
    return events;
}

/**
 * Below £0 at the weekly tick: first the bank forces a bailout loan; if the company is still in the red at the
 * next tick (or no more credit), the cheapest vehicle is sold; with no vehicles and no credit, it's game over.
 */
export function bankruptcyCheck(career, { year = 1919, tier = 0 } = {}) {
    const b = (career.bankruptcy ??= { stage: 0 });
    const money = career.ledger.money;
    if (money >= 0) { b.stage = 0; return []; }
    const need = Math.ceil(-money + 50);
    const credit = loanLimit(career, year, tier) - debt(career);
    if (b.stage === 0 && credit >= need) {
        takeLoan(career, need, { rate: BAILOUT_RATE, forced: true, text: 'Bailout loan (forced by the bank)' });
        b.stage = 1;
        return [{ kind: 'bailout', amount: need }];
    }
    if (career.fleet.length) {
        const cheapest = [...career.fleet].sort((a, c) => value(a) - value(c))[0];
        const amount = value(cheapest);
        career.fleet.splice(career.fleet.indexOf(cheapest), 1);
        post(career.ledger, career.calendar.minutes, `Forced sale: ${vehicleById(cheapest.model).name}`, amount, 'sale');
        b.stage = 2;
        return [{ kind: 'forcedSale', vehicle: cheapest.id, amount }];
    }
    if (credit >= need) { // no vehicles left but the bank will still lend: one more chance
        takeLoan(career, need, { rate: BAILOUT_RATE, forced: true, text: 'Bailout loan (forced by the bank)' });
        return [{ kind: 'bailout', amount: need }];
    }
    career.retired = true;
    return [{ kind: 'gameOver' }];

    function value(v) { return tradeInValue(vehicleById(v.model), year - v.built, v.wear, v.damage); }
}
