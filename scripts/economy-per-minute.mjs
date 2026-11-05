// Plan 0009 phase 6: pay and fuel per minute of driving, before (1:13 constants) and after (1:4 with TRIP_RATE).
// Usage: node scripts/economy-per-minute.mjs   (Node world build, about 5 s)
// "Before" is the same real route as it was at 1:13: world length and drive time divided by TRIP_RATE, pay at 0.9 per
// real mile with no rate multiplier, fuel per real km with no multiplier. "After" calls the live game code.
import { createWorld } from '../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { findRoute } from '../Games.Client/wwwroot/games/delivery-driver/world/pathfind.js';
import { quote, workSeconds } from '../Games.Client/wwwroot/games/delivery-driver/game/contracts.js';
import { fuelBurn } from '../Games.Client/wwwroot/games/delivery-driver/game/economy.js';
import { climbModel } from '../Games.Client/wwwroot/games/delivery-driver/sim/slope.js';
import { vehicleById } from '../Games.Client/wwwroot/games/delivery-driver/game/catalogue.js';
import { GAME_MINUTES_PER_SECOND } from '../Games.Client/wwwroot/games/delivery-driver/game/calendar.js';
import { WORLD_SCALE, LEGACY_SCALE, TRIP_RATE, worldToMiles, MPH } from '../Games.Client/wwwroot/games/delivery-driver/config.js';
import { seedWithBaked } from '../tests/js/helpers/delivery-seed.mjs';

const world = createWorld(seedWithBaked());
const town = id => world.region.townById.get(id);
const spec = vehicleById('exe-two-tonner'), YEAR = 1930, WEIGHT = 1000, STOPS = 2, LOAD = 0.5, THROTTLE = 0.7;
const vmax = spec.topSpeedMph * MPH;
const climb = climbModel(spec, spec.payload);

/** Figures for one route between two towns, before and after. */
function figures(r) {
    const hill = Math.max(1, r.hill);
    const workMin = STOPS * workSeconds(WEIGHT / STOPS) * GAME_MINUTES_PER_SECOND;
    const realKm = r.length / WORLD_SCALE / 1000, miles = worldToMiles(r.length);
    const after = {
        len: r.length, pay: quote(r.length, WEIGHT, STOPS, 1, r.hill), driveMin: r.time * GAME_MINUTES_PER_SECOND,
        fuel: fuelBurn(spec, r.length, LOAD, THROTTLE) * r.fuel,
    };
    const before = {
        len: r.length / LEGACY_SCALE * WORLD_SCALE, // old world metres
        pay: Math.round(3 + miles * 0.9 * hill + (WEIGHT / 1000) * 4 + STOPS * 1), driveMin: (r.time / TRIP_RATE) * GAME_MINUTES_PER_SECOND,
        fuel: (spec.fuelUse / 100) * realKm * (1 + 0.7 * LOAD) * (0.45 + 0.55 * THROTTLE) * r.fuel,
    };
    before.len = r.length / TRIP_RATE;
    for (const f of [before, after]) {
        f.perMinute = f.pay / (f.driveMin + workMin);       // pay per minute of the whole job
        f.perDriveMinute = f.pay / f.driveMin;               // pay per minute of driving alone
        f.fuelPerMinute = f.fuel / f.driveMin;               // litres per minute of driving
        f.window = Math.max(90, Math.round((((f.len / (vmax * 0.65)) * hill + STOPS * workSeconds(WEIGHT / STOPS)) * GAME_MINUTES_PER_SECOND * 2.2 + 45) / 15) * 15);
    }
    return { miles, before, after, workMin };
}

const PAIRS = [['exeter', 'tiverton'], ['exeter', 'exmouth'], ['exeter', 'newtonabbot'], ['exeter', 'plymouth'], ['plymouth', 'truro'], ['barnstaple', 'okehampton'], ['exeter', 'truro'], ['exeter', 'penzance'], ['ilfracombe', 'penzance'], ['lynton', 'stives']];
{
    const pct = (a, b) => `${((b / a - 1) * 100).toFixed(1)}%`;
    console.log(`TRIP_RATE ${TRIP_RATE}; ${spec.name}, ${YEAR}, ${WEIGHT} kg over ${STOPS} stops, load ${LOAD}\n`);
    console.log('route                    real mi | pay old->new   | pay/min(job) old->new (diff) | pay/drive-min old->new (diff) | fuel/drive-min diff | window old->new | drive min old->new');
    let worst = 0;
    for (const [a, b] of PAIRS) {
        const r = findRoute(world.graph, town(a), town(b), { year: YEAR, vmax, climb });
        if (!r) { console.log(a, b, 'no route'); continue; }
        const f = figures(r), o = f.before, n = f.after;
        const d = [n.perMinute / o.perMinute - 1, n.perDriveMinute / o.perDriveMinute - 1, n.fuelPerMinute / o.fuelPerMinute - 1];
        if (f.miles > 8) worst = Math.max(worst, ...d.map(Math.abs));
        console.log(`${(a + ' - ' + b).padEnd(24)} ${f.miles.toFixed(1).padStart(5)} | £${o.pay} -> £${n.pay}`.padEnd(46) + ` | ${o.perMinute.toFixed(2)} -> ${n.perMinute.toFixed(2)} (${pct(o.perMinute, n.perMinute)}) | ${o.perDriveMinute.toFixed(2)} -> ${n.perDriveMinute.toFixed(2)} (${pct(o.perDriveMinute, n.perDriveMinute)}) | ${pct(o.fuelPerMinute, n.fuelPerMinute)} | ${o.window} -> ${n.window} min | ${o.driveMin.toFixed(0)} -> ${n.driveMin.toFixed(0)}`);
    }
    console.log(`\nworst difference on routes over 8 miles: ${(worst * 100).toFixed(1)}%`);
    console.log(`\nLongest contracts (${spec.name}, ${YEAR}): real miles | drive time | window | pay`);
    for (const [a, b] of [['exeter', 'penzance'], ['ilfracombe', 'penzance'], ['lynton', 'stives']]) {
        const r = findRoute(world.graph, town(a), town(b), { year: YEAR, vmax, climb }), f = figures(r), h = m => (m / 60).toFixed(1) + ' h';
        console.log((a + ' - ' + b).padEnd(24) + f.miles.toFixed(1).padStart(6) + ' mi | drive ' + h(f.after.driveMin) + ' game (' + (f.after.driveMin / 15).toFixed(0) + ' real min) vs ' + h(f.before.driveMin) + ' before | window ' + h(f.after.window) + ' vs ' + h(f.before.window) + ' before | pay £' + f.after.pay + ' vs £' + f.before.pay + ' before');
    }
}
