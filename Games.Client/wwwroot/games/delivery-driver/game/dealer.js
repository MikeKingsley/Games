// Buying and selling: new vehicles and trailers from the catalogue, the weekly used market, trade-ins and
// straight sales. Pure functions on the career (the session places the vehicles in the world).
import { vehicleById, trailerById, vehiclesOnSale, trailersOnSale } from './catalogue.js';
import { post, tradeInValue, usedMarket } from './economy.js';
import { newFleetVehicle } from './career.js';
import { weekIndex, dateOf } from './calendar.js';

export const yearOf = career => dateOf(career.calendar.minutes).year;

/** What's for sale this week: new vehicles, new trailers and the used market. */
export function showroom(career, seed) {
    const year = yearOf(career);
    return {
        vehicles: vehiclesOnSale(year),
        trailers: trailersOnSale(year),
        used: usedMarket(seed, weekIndex(career.calendar.minutes), year).filter(u => !(career.usedSold ?? []).includes(u.id)),
    };
}

/** The dealer's offer for a fleet vehicle. */
export function valueOf(career, rec) {
    return tradeInValue(vehicleById(rec.model), yearOf(career) - rec.built, rec.wear, rec.damage);
}

/**
 * Buys a vehicle (new by model id, or a used-market entry) into a depot. With tradeIn set, that fleet vehicle is
 * part-exchanged. Returns {rec, cost} or {error}.
 */
export function buyVehicle(career, { model, used = null, depot, tradeIn = null }) {
    const year = yearOf(career);
    const spec = vehicleById(used?.model ?? model);
    if (!spec) return { error: 'Unknown vehicle' };
    const price = used ? used.price : spec.price;
    const part = tradeIn ? career.fleet.find(v => v.id === tradeIn) : null;
    const credit = part ? valueOf(career, part) : 0;
    const cost = price - credit;
    if (career.ledger.money < cost) return { error: 'Not enough money' };
    const rec = newFleetVehicle(career, spec.id, year, depot, career.calendar.minutes, used ? { wear: used.wear, mileage: used.mileage, built: used.built } : {});
    career.fleet.push(rec);
    post(career.ledger, career.calendar.minutes, `${used ? 'Used' : 'New'} ${spec.name}`, -price, 'vehicles');
    if (part) {
        post(career.ledger, career.calendar.minutes, `Part-exchange: ${vehicleById(part.model).name}`, credit, 'vehicles');
        career.fleet.splice(career.fleet.indexOf(part), 1);
    }
    if (used) (career.usedSold ??= []).push(used.id);
    return { rec, cost };
}

/** Sells a fleet vehicle to the dealer (not the one being driven, and never the last one). */
export function sellVehicle(career, id) {
    const rec = career.fleet.find(v => v.id === id);
    if (!rec) return { error: 'Unknown vehicle' };
    if (id === career.activeVehicle) return { error: 'You are driving it' };
    if (career.fleet.length <= 1) return { error: 'You need at least one vehicle' };
    const value = valueOf(career, rec);
    career.fleet.splice(career.fleet.indexOf(rec), 1);
    for (const d of career.drivers ?? []) if (d.vehicle === id) d.vehicle = null;
    post(career.ledger, career.calendar.minutes, `Sold ${vehicleById(rec.model).name}`, value, 'vehicles');
    return { value };
}

/** Buys a trailer into a depot's trailer pool. */
export function buyTrailer(career, model, depot) {
    const spec = trailerById(model);
    if (!spec) return { error: 'Unknown trailer' };
    if (career.ledger.money < spec.price) return { error: 'Not enough money' };
    const rec = { id: `t${career.nextId++}`, model, built: yearOf(career), depot, pose: null, cargo: null };
    (career.trailers ??= []).push(rec);
    post(career.ledger, career.calendar.minutes, `New ${spec.name}`, -spec.price, 'vehicles');
    return { rec };
}

export function sellTrailer(career, id) {
    const rec = (career.trailers ?? []).find(t => t.id === id);
    if (!rec) return { error: 'Unknown trailer' };
    if (rec.coupledTo) return { error: 'Uncouple it first' };
    const spec = trailerById(rec.model);
    const value = Math.round(spec.price * Math.max(0.15, 0.9 ** (yearOf(career) - rec.built)) * 0.8);
    career.trailers.splice(career.trailers.indexOf(rec), 1);
    post(career.ledger, career.calendar.minutes, `Sold ${spec.name}`, value, 'vehicles');
    return { value };
}
