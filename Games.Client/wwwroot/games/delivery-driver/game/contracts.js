// Contracts and the active job. Customers are the generated shops, pubs, houses, warehouses, farms and industry
// sites; offers are seeded per depot and game day so the board is the same after a reload.
// Job flow: toLoad -> loading -> toDrop -> unloading -> ... -> complete (a stop is a load or unload point).
import { seededRng, hashSeed, pick, intRange, range, chance } from '../engine/rng.js';
import { findRoute } from '../world/pathfind.js';
import { hourIndex, GAME_MINUTES_PER_SECOND } from './calendar.js';
import { worldToMiles } from '../config.js';

const SURNAMES = ['Trelawny', 'Penrose', 'Hext', 'Chudleigh', 'Pascoe', 'Tremayne', 'Coombe', 'Ashford', 'Luxton', 'Vosper', 'Nankivell', 'Polglase', 'Kingdon', 'Snell', 'Widdicombe', 'Endacott', 'Rowe', 'Jago', 'Trethewey', 'Hosking', 'Bartlett', 'Pengelly', 'Hockin', 'Yeo', 'Westaway', 'Northcott', 'Babb', 'Coaker', 'Lethbridge', 'Symons'];
const TRADES = ['Grocers', 'Drapers', 'Ironmongers', 'Bakery', 'Butchers', 'Chemist', 'Stationers', 'Tobacconist', 'Outfitters', 'Hardware', 'Fishmonger', 'Saddlers', 'Cycle Shop', 'Tea Rooms'];
const PUB_A = ['Red', 'White', 'Golden', 'Royal', 'Jolly', 'Old', 'Black', 'Blue', 'Seven', 'Three'];
const PUB_B = ['Lion', 'Hart', 'Hind', 'Oak', 'Sailor', 'Plough', 'Anchor', 'Stars', 'Horseshoes', 'Bell', 'Ship', 'Swan'];

/** Cargo types. weight is per drop for multi-drop work; tags limit which vehicles may carry it (Phase 6). */
export const CARGO = {
    parcels: { name: 'Parcels', drop: [30, 120] },
    groceries: { name: 'Groceries', drop: [60, 220] },
    ale: { name: 'Barrels of ale', drop: [120, 300] },
    hardware: { name: 'Hardware', drop: [50, 200] },
    drapery: { name: 'Drapery', drop: [30, 110] },
    coal: { name: 'Coal sacks', drop: [100, 300] },
    milk: { name: 'Milk churns', load: [300, 900] },
    potatoes: { name: 'Sacks of potatoes', load: [400, 950] },
    wool: { name: 'Wool bales', load: [200, 600] },
    eggs: { name: 'Eggs and poultry', load: [150, 400] },
    goods: { name: 'Factory goods', load: [300, 900] },
};
const FARM_CARGO = { dairy: 'milk', arable: 'potatoes', sheep: 'wool', livestock: 'eggs', mixed: 'potatoes' };
const SHOP_CARGO = { shop: ['groceries', 'hardware', 'drapery', 'parcels'], pub: ['ale'], house: ['parcels', 'coal'], terrace: ['parcels', 'coal'], warehouse: ['goods', 'hardware'], church: ['parcels'] };

/** A customer for a building: a stable name from its id. */
export function customerOf(b) {
    const rng = seededRng(hashSeed('customer', b.id));
    let name;
    if (b.type === 'pub') name = `The ${pick(rng, PUB_A)} ${pick(rng, PUB_B)}`;
    else if (b.type === 'shop') name = `${pick(rng, SURNAMES)}'s ${pick(rng, TRADES)}`;
    else if (b.type === 'warehouse') name = `${pick(rng, SURNAMES)} Wholesale`;
    else if (b.type === 'church') name = 'St Peter\'s Church';
    else name = `${pick(rng, ['Mrs', 'Mr', 'Miss', 'Dr'])} ${pick(rng, SURNAMES)}`;
    return { id: b.id, name, kind: b.type, x: b.door.x, y: b.door.y };
}

const DROP_TYPES = new Set(['shop', 'pub', 'house', 'terrace', 'warehouse']);

/** Real seconds to load or unload `kg` at a stop. */
export const workSeconds = kg => 2.5 + kg / 200;

/**
 * Pay for a job: a base, per real mile driven, per tonne carried and per stop. Flat prices (no inflation).
 * `distance` is in world metres along the route; `hill` (the route's time / its time if level, >= 1) pays the
 * per-mile part more on hilly routes (slower, and dearer in fuel).
 */
export function quote(distance, weightKg, stops, specialFactor = 1, hill = 1) {
    const miles = worldToMiles(distance);
    return Math.round((3 + miles * 0.9 * Math.max(1, hill) + (weightKg / 1000) * 4 + stops * 1) * specialFactor);
}

/**
 * The legs of a job by road, with the same hill model the off-screen fleet uses (pathfind.js): {length, time,
 * flatTime, hill (time / flatTime)}, or null if any leg is unreachable.
 */
export function routeStats(world, pts, year, vmax, climb = undefined) {
    let length = 0, time = 0, flatTime = 0;
    for (let i = 1; i < pts.length; i++) {
        const r = findRoute(world.graph, pts[i - 1], pts[i], { year, vmax, climb });
        if (!r) return null;
        length += r.length;
        time += r.time;
        flatTime += r.flatTime;
    }
    return { length, time, flatTime, hill: flatTime > 0 ? Math.max(1, time / flatTime) : 1 };
}

/**
 * Special cargo: what it is, the vehicle tag it needs, where it comes from and goes to, and from which year.
 * from/to are yard selectors: a site type, 'farm:<type>', 'goodsyard' (a town's depot plot) or 'garage'.
 */
export const SPECIAL = [
    { cargo: 'chinaclay', name: 'China clay', needs: 'tipper', from: ['chinaclay'], to: ['docks'], kg: [3000, 22000], factor: 1.4, year: 1919 },
    { cargo: 'stone', name: 'Granite', needs: 'tipper', from: ['quarry'], to: ['goodsyard'], kg: [3000, 20000], factor: 1.35, year: 1919 },
    { cargo: 'bulkmilk', name: 'Bulk milk', needs: 'milk', from: ['farm:dairy'], to: ['dairy'], kg: [2000, 18000], factor: 1.5, year: 1948 },
    { cargo: 'fish', name: 'Fresh fish (chilled)', needs: 'reefer', from: ['fish'], to: ['goodsyard'], kg: [2000, 15000], factor: 1.6, year: 1960 },
    { cargo: 'frozen', name: 'Frozen food', needs: 'reefer', from: ['docks'], to: ['goodsyard'], kg: [4000, 18000], factor: 1.55, year: 1960 },
    { cargo: 'timber', name: 'Timber', needs: 'flatbed', from: ['timber'], to: ['docks', 'goodsyard'], kg: [2000, 18000], factor: 1.3, year: 1919 },
    { cargo: 'fuel', name: 'Petrol', needs: 'fuel', from: ['fuel'], to: ['garage'], kg: [3000, 18000], factor: 1.6, year: 1956 },
    { cargo: 'livestock', name: 'Livestock', needs: 'livestock', from: ['farm:livestock', 'farm:sheep'], to: ['livestock'], kg: [1000, 10000], factor: 1.45, year: 1919 },
    { cargo: 'machinery', name: 'Heavy machinery', needs: 'lowloader', from: ['docks'], to: ['quarry', 'chinaclay'], kg: [8000, 28000], factor: 1.7, year: 1956 },
];
/** Tags that can carry ordinary goods (parcels, groceries, crates). */
export const GENERAL_TAGS = ['van', 'box', 'flatbed', 'curtain', 'dropside'];

function yardsMatching(world, selector) {
    if (selector === 'goodsyard') return world.depots;
    if (selector === 'garage') return world.garages;
    if (selector.startsWith('farm:')) return world.farms.filter(f => f.type === selector.slice(5));
    return world.sites.filter(s => s.type === selector);
}

const goodsYardName = (world, y) => (y.type === 'depot' ? `${world.region.townById.get(y.town).name} Goods Yard` : y.name);

/**
 * Today's offers at a depot. ctx = {world, depot, minutes, year, payload (kg, the vehicle being driven), vmax, climb
 * (its sim/slope.js climbModel, unloaded: each offer adds its weight), count, refresh, tierInfo ({range, haulage,
 * special}), fleet: [{tags, capacity}] (what the fleet can carry)}. Hilly routes get longer windows and more pay.
 * Deterministic for the same depot, game day, refresh number and fleet.
 */
export function generateOffers(ctx) {
    const { world, depot, minutes, year, payload = 1000, vmax = 11, refresh = 0 } = ctx;
    const tier = ctx.tierInfo ?? { range: 3000, haulage: false, special: false };
    const fleet = ctx.fleet ?? [{ tags: ['van'], capacity: payload }];
    const capacityFor = tag => Math.max(0, ...fleet.filter(f => f.tags.includes(tag)).map(f => f.capacity));
    const generalCap = Math.max(0, ...GENERAL_TAGS.map(capacityFor));
    const rng = seededRng(hashSeed(world.region.seed, 'offers', depot.id, hourIndex(minutes), refresh));
    const count = ctx.count ?? intRange(rng, 4, 8); // a varying number of contracts on the board
    const town = world.region.townById.get(depot.town);
    const buildings = world.buildingsOfTown(town).filter(b => DROP_TYPES.has(b.type) && b.door);
    const farms = world.farms.filter(y => Math.hypot(y.yard.marker.x - depot.x, y.yard.marker.y - depot.y) < (ctx.collectRange ?? 1500));
    const specials = tier.special ? SPECIAL.filter(sp => year >= sp.year && capacityFor(sp.needs) > 0) : [];
    const tractorMax = Math.max(0, ...(ctx.tractors ?? []));
    const kinds = [['multidrop', 0.4], ['collection', farms.length ? 0.25 : 0], ['haul', tier.haulage ? 0.2 : 0], ['special', specials.length ? 0.3 : 0], ['trailer', tier.haulage && tractorMax ? 0.35 : 0]];
    const offers = [];
    for (let k = 0; k < count * 4 && offers.length < count; k++) {
        let r = rng() * kinds.reduce((t, [, w]) => t + w, 0), kind = 'multidrop';
        for (const [name, w] of kinds) { r -= w; if (r <= 0) { kind = name; break; } }
        let c = null;
        const small = Math.min(payload, generalCap || payload);
        if (kind === 'multidrop') c = multiDrop(rng, world, depot, buildings, small, year);
        else if (kind === 'collection') c = collection(rng, world, depot, pick(rng, farms), small);
        else if (kind === 'haul') c = haul(rng, world, depot, tier.range, generalCap);
        else if (kind === 'trailer') c = trailerJob(rng, world, depot, tier.range, tractorMax, year);
        else c = special(rng, world, depot, tier.range, pick(rng, specials), capacityFor);
        if (!c) continue;
        const legs = c.stops.map(s => ({ x: s.x, y: s.y }));
        const climb = ctx.climb ? { ...ctx.climb, mass: ctx.climb.mass + c.weight } : undefined;
        const route = routeStats(world, [depot.yard.marker, ...legs], year, vmax, climb);
        const limit = kind === 'multidrop' || kind === 'collection' ? (ctx.maxRoute ?? 6000) : tier.range * 2.2;
        if (route === null || route.length > limit) continue; // skip places that are a long way round by road
        const len = route.length;
        const driveSeconds = (len / (vmax * 0.65)) * route.hill + c.stops.reduce((t, s) => t + workSeconds(s.weight), 0);
        const window = Math.max(90, Math.round((driveSeconds * GAME_MINUTES_PER_SECOND * 2.2 + 45) / 15) * 15);
        offers.push({
            ...c,
            id: `c${hourIndex(minutes)}-${refresh}-${k}-${depot.id}`,
            depot: depot.id,
            distance: len,
            pay: quote(len, c.weight, c.stops.length, c.factor ?? 1, route.hill),
            window,
            offeredAt: minutes,
        });
    }
    return offers;
}

/** Point-to-point general haulage between two places (goods yards and industry sites) within range. */
function haul(rng, world, depot, reach, capacity) {
    if (capacity <= 0) return null;
    const places = [...world.depots, ...world.sites.filter(s => ['docks', 'fish', 'dairy', 'timber', 'livestock'].includes(s.type))];
    const near = places.filter(p => Math.hypot(p.x - depot.x, p.y - depot.y) < reach * 0.6);
    if (!near.length) return null;
    const from = pick(rng, near);
    const dest = places.filter(p => p !== from && Math.hypot(p.x - from.x, p.y - from.y) < reach && Math.hypot(p.x - from.x, p.y - from.y) > 300);
    if (!dest.length) return null;
    const to = pick(rng, dest);
    const weight = Math.round(Math.min(capacity, range(rng, 600, Math.max(800, capacity))) / 50) * 50;
    const cargoName = pick(rng, ['Crates of goods', 'Building materials', 'Furniture', 'Machine parts', 'Sacks of feed', 'Paper and print']);
    return bayJob(world, 'haul', `${cargoName}: ${goodsYardName(world, from)} to ${goodsYardName(world, to)}`, { id: to.id, name: goodsYardName(world, to) }, 'goods', cargoName, weight, from, to, [], 1);
}

/** Special cargo: needs a vehicle (or trailer) with the right tag, pays more. */
function special(rng, world, depot, reach, sp, capacityFor) {
    const sources = sp.from.flatMap(sel => yardsMatching(world, sel)).filter(y => Math.hypot(y.x - depot.x, y.y - depot.y) < reach * 0.7);
    if (!sources.length) return null;
    const from = pick(rng, sources);
    const dests = sp.to.flatMap(sel => yardsMatching(world, sel)).filter(y => y !== from && Math.hypot(y.x - from.x, y.y - from.y) < reach && Math.hypot(y.x - from.x, y.y - from.y) > 250);
    if (!dests.length) return null;
    const to = pick(rng, dests);
    const weight = Math.round(Math.min(capacityFor(sp.needs), range(rng, sp.kg[0], sp.kg[1])) / 100) * 100;
    if (weight < 300) return null;
    return bayJob(world, 'special', `${sp.name}: ${goodsYardName(world, from)} to ${goodsYardName(world, to)}`, { id: to.id, name: goodsYardName(world, to) }, sp.cargo, sp.name, weight, from, to, [sp.needs], sp.factor);
}

function bayJob(world, type, title, client, cargo, cargoName, weight, from, to, tags, factor) {
    const a = from.yard.marker, b = to.yard.marker;
    return {
        type, title, client, cargo, cargoName, weight, tags, factor,
        stops: [
            { action: 'load', kind: 'bay', name: goodsYardName(world, from), x: a.x, y: a.y, heading: a.heading, yard: from.id, weight },
            { action: 'unload', kind: 'bay', name: goodsYardName(world, to), x: b.x, y: b.y, heading: b.heading, yard: to.id, weight },
        ],
    };
}

function multiDrop(rng, world, depot, buildings, payload, year) {
    if (buildings.length < 4) return null;
    const n = intRange(rng, 1, year < 1930 ? 4 : 6);
    const first = chance(rng, 0.15) ? 'pub' : chance(rng, 0.25) ? 'house' : 'shop';
    const cargoId = pick(rng, SHOP_CARGO[first] ?? SHOP_CARGO.shop);
    const cargo = CARGO[cargoId];
    // drops near each other: pick an anchor, then the closest suitable buildings around it
    const anchor = pick(rng, buildings);
    const near = buildings
        .filter(b => (SHOP_CARGO[b.type] ?? []).includes(cargoId) || cargoId === 'parcels')
        .map(b => ({ b, d: Math.hypot(b.x - anchor.x, b.y - anchor.y) + rng() * 60 }))
        .sort((a, b) => a.d - b.d)
        .filter(({ b }, k, list) => list.findIndex(o => customerOf(o.b).name === customerOf(b).name) === k) // one drop per name
        .slice(0, n);
    if (near.length < 1) return null;
    const drops = near.map(({ b }) => {
        const c = customerOf(b);
        return { action: 'unload', kind: 'door', name: c.name, client: c.id, x: c.x, y: c.y, weight: Math.round(range(rng, ...cargo.drop) / 5) * 5 };
    });
    let total = drops.reduce((t, d) => t + d.weight, 0);
    if (total > payload) { // trim to fit the van
        const f = payload / total;
        drops.forEach(d => { d.weight = Math.max(5, Math.floor((d.weight * f) / 5) * 5); });
        total = drops.reduce((t, d) => t + d.weight, 0);
    }
    const m = depot.yard.marker;
    return {
        type: 'multidrop',
        title: `${cargo.name}: ${drops.length} drops in ${world.region.townById.get(depot.town).name}`,
        client: { id: `${depot.id}-wholesale`, name: `${world.region.townById.get(depot.town).name} Wholesale Co.` },
        cargo: cargoId, cargoName: cargo.name, weight: total, tags: [],
        stops: [{ action: 'load', kind: 'bay', name: depot.name, x: m.x, y: m.y, heading: m.heading, yard: depot.id, weight: total }, ...drops],
    };
}

function collection(rng, world, depot, owner, payload) {
    // farms send their produce; industry sites send general factory goods (special cargo comes in Phase 6)
    const cid = FARM_CARGO[owner.type] ?? 'goods';
    const cargo = CARGO[cid];
    const weight = Math.min(payload, Math.round(range(rng, ...cargo.load) / 10) * 10);
    const a = owner.yard.marker, m = depot.yard.marker;
    return {
        type: 'collection',
        title: `Collect ${cargo.name.toLowerCase()} from ${owner.name}`,
        client: { id: owner.id, name: owner.name },
        cargo: cid, cargoName: cargo.name, weight, tags: [],
        stops: [
            { action: 'load', kind: 'bay', name: owner.name, x: a.x, y: a.y, heading: a.heading, yard: owner.id, weight },
            { action: 'unload', kind: 'bay', name: depot.name, x: m.x, y: m.y, heading: m.heading, yard: depot.id, weight },
        ],
    };
}

// ---- The active job ------------------------------------------------------------------------------------------

export function startJob(contract, minutes) {
    return { contract, stop: 0, working: false, timer: 0, cargoDamage: 0, startedAt: minutes, deadline: minutes + contract.window, done: false };
}

/** The stage name for the HUD and tests: toLoad, loading, toDrop, unloading or complete. */
export function jobStage(job) {
    if (job.done) return 'complete';
    const s = job.contract.stops[job.stop];
    if (s.action === 'couple') return 'toTrailer';
    if (s.action === 'load') return job.working ? 'loading' : 'toLoad';
    return job.working ? 'unloading' : 'toDrop';
}

export const currentStop = job => (job.done ? null : job.contract.stops[job.stop]);

/**
 * Steps the job. `check` is the result of bayCheck/doorCheck for the current stop (ok when parked on it).
 * Work runs while the vehicle stays parked; moving off resets it. Returns an event name or null:
 * 'startWork', 'stopDone' (with the stop) or 'complete'.
 */
export function updateJob(job, check, dt) {
    if (job.done) return null;
    const stop = job.contract.stops[job.stop];
    if (stop.action === 'couple') return check.ok ? finishStop(job) : null; // done the moment it's coupled
    if (!job.working) {
        if (!check.ok) return null;
        job.working = true;
        job.timer = workSeconds(stop.weight);
        return 'startWork';
    }
    if (!check.ok) { job.working = false; return null; }
    job.timer -= dt;
    if (job.timer > 0) return null;
    return finishStop(job);
}

/** Completes the current stop at once (debug hook, or the timer running out). */
export function finishStop(job) {
    if (job.done) return null;
    job.working = false;
    job.timer = 0;
    job.stop++;
    if (job.stop >= job.contract.stops.length) { job.done = true; return 'complete'; }
    return 'stopDone';
}

/** The cargo weight on board after the stops completed so far. */
export function cargoOnBoard(job) {
    let kg = 0;
    const stops = job.contract.stops;
    for (let i = 0; i < Math.min(job.stop, stops.length); i++) kg += stops[i].action === 'load' || stops[i].action === 'couple' ? stops[i].weight : -stops[i].weight;
    return Math.max(0, kg);
}

/** Damage to the cargo from an impact (percent, only while carrying something). */
export function impactDamage(impactSpeed) {
    return impactSpeed > 1.5 ? Math.min(40, (impactSpeed - 1.5) * 4) : 0;
}

/**
 * The payment for a finished job: late delivery loses 10% per game hour (down to 40%); arriving within the
 * first half of the window undamaged earns a 15% bonus; cargo damage is deducted.
 */
export function settle(job, completedAt) {
    const pay = job.contract.pay;
    const lateMinutes = Math.max(0, completedAt - job.deadline);
    const early = completedAt <= job.startedAt + job.contract.window / 2;
    const lateFactor = lateMinutes > 0 ? Math.max(0.4, 1 - (lateMinutes / 60) * 0.1) : 1;
    const late = Math.round(pay * (1 - lateFactor));
    const damage = Math.round(pay * lateFactor * Math.min(1, job.cargoDamage / 100));
    const bonus = early && job.cargoDamage === 0 && lateMinutes === 0 ? Math.round(pay * 0.15) : 0;
    return { pay, late, damage, bonus, total: Math.max(0, pay - late - damage + bonus), onTime: lateMinutes === 0, lateMinutes };
}

/**
 * Trailer work for tractor units: collect a client's loaded trailer and drop it at the destination's bay, or a
 * drop-and-swap between two depots (take a full one there, bring their empty one back). The client trailers are
 * placed in the world when the job is accepted.
 */
function trailerJob(rng, world, depot, reach, tractorMax, year) {
    const model = year >= 1970 ? 'curtain' : year >= 1956 ? 'box-12' : 'box-light';
    const cap = Math.min(tractorMax, model === 'curtain' ? 26000 : model === 'box-12' ? 18000 : 5000);
    const places = [...world.depots, ...world.sites.filter(s => ['docks', 'dairy', 'timber', 'fish'].includes(s.type))];
    const from = pick(rng, places.filter(p => Math.hypot(p.x - depot.x, p.y - depot.y) < reach * 0.6));
    if (!from) return null;
    const to = pick(rng, places.filter(p => p !== from && Math.hypot(p.x - from.x, p.y - from.y) < reach && Math.hypot(p.x - from.x, p.y - from.y) > 300));
    if (!to) return null;
    const weight = Math.round(Math.min(cap, range(rng, cap * 0.3, cap)) / 100) * 100;
    const swap = from.type === 'depot' && to.type === 'depot' && chance(rng, 0.5);
    const a = from.yard.marker, b = to.yard.marker;
    const tA = { id: `ct-${Math.floor(rng() * 1e9)}`, model, weight, at: from.id };
    const stops = [
        { action: 'couple', kind: 'trailer', name: goodsYardName(world, from), x: a.x, y: a.y, yard: from.id, trailer: tA.id, weight },
        { action: 'drop', kind: 'bay', name: goodsYardName(world, to), x: b.x, y: b.y, heading: b.heading, yard: to.id, trailer: tA.id, weight },
    ];
    const trailers = [tA];
    if (swap) {
        const tB = { id: `ct-${Math.floor(rng() * 1e9)}`, model, weight: 0, at: to.id };
        trailers.push(tB);
        stops.push(
            { action: 'couple', kind: 'trailer', name: goodsYardName(world, to), x: b.x, y: b.y, yard: to.id, trailer: tB.id, weight: 0 },
            { action: 'drop', kind: 'bay', name: goodsYardName(world, from), x: a.x, y: a.y, heading: a.heading, yard: from.id, trailer: tB.id, weight: 0 },
        );
    }
    return {
        type: swap ? 'swap' : 'trailer',
        title: swap ? `Trailer swap: ${goodsYardName(world, from)} and ${goodsYardName(world, to)}` : `Trailer: ${goodsYardName(world, from)} to ${goodsYardName(world, to)}`,
        client: { id: to.id, name: goodsYardName(world, to) }, cargo: 'goods', cargoName: 'Loaded trailer', weight, tags: ['tractor-unit'],
        factor: swap ? 1.3 : 1.2, trailers, stops,
    };
}
