import { test } from 'node:test';
import { seedWithBaked } from './helpers/delivery-seed.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { VEHICLES, TRAILERS, vehicleById } from '../../Games.Client/wwwroot/games/delivery-driver/game/catalogue.js';
import { tradeInValue, fuelBurn, weeklyTick, bankruptcyCheck, takeLoan, post, usedMarket } from '../../Games.Client/wwwroot/games/delivery-driver/game/economy.js';
import { createCareer, newFleetVehicle, fleetCapabilities, cannotTake } from '../../Games.Client/wwwroot/games/delivery-driver/game/career.js';
import { buyVehicle } from '../../Games.Client/wwwroot/games/delivery-driver/game/dealer.js';
import { generateOffers } from '../../Games.Client/wwwroot/games/delivery-driver/game/contracts.js';
import { TIERS, tierOf, addReputation } from '../../Games.Client/wwwroot/games/delivery-driver/game/reputation.js';
import { createWorld } from '../../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { createSession } from '../../Games.Client/wwwroot/games/delivery-driver/game/session.js';
import { minutesAt } from '../../Games.Client/wwwroot/games/delivery-driver/game/calendar.js';
import { createVehicle, stepVehicle } from '../../Games.Client/wwwroot/games/delivery-driver/sim/vehicle.js';

const world = createWorld(seedWithBaked());

test('the catalogue has 12-15 vehicles with unique ids, years ascending within each class', () => {
    assert.ok(VEHICLES.length >= 12 && VEHICLES.length <= 15, `${VEHICLES.length}`);
    assert.equal(new Set(VEHICLES.map(v => v.id)).size, VEHICLES.length);
    for (const cls of new Set(VEHICLES.map(v => v.class))) {
        const years = VEHICLES.filter(v => v.class === cls).map(v => v.year);
        assert.deepEqual(years, [...years].sort((a, b) => a - b), cls);
    }
    assert.equal(new Set(TRAILERS.map(t => t.id)).size, TRAILERS.length);
    for (const t of ['flatbed', 'box', 'curtain', 'tanker', 'reefer', 'livestock', 'lowloader', 'tipper']) assert.ok(TRAILERS.some(x => x.tags.includes(t)), t);
});

test('every vehicle reaches its governed top speed (within 6%) with a full load', () => {
    for (const spec of VEHICLES) {
        const v = createVehicle(spec);
        v.cargoMass = spec.payload || spec.trailerMax;
        let max = 0;
        for (let i = 0; i < 60 * 240; i++) { stepVehicle(v, { throttle: 1, brake: 0, steer: 0 }, 1 / 60); max = Math.max(max, v.speed); }
        const mph = max / 0.44704;
        assert.ok(mph <= spec.topSpeedMph + 0.5 && mph >= spec.topSpeedMph * 0.94, `${spec.id}: ${mph.toFixed(1)} mph`);
    }
});

test('trade-in value is below the price and falls with age and wear', () => {
    for (const spec of VEHICLES) {
        const fresh = tradeInValue(spec, 0, 0, 0);
        assert.ok(fresh < spec.price);
        assert.ok(tradeInValue(spec, 5, 0, 0) < fresh);
        assert.ok(tradeInValue(spec, 0, 60, 0) < fresh);
        assert.ok(tradeInValue(spec, 0, 0, 40) < fresh);
    }
    for (const u of usedMarket(1919, 600, 1935)) assert.ok(vehicleById(u.model).year <= 1935 && u.price > 0);
});

test('fuel consumption is higher when loaded', () => {
    for (const spec of VEHICLES) assert.ok(fuelBurn(spec, 1000, 1, 1) > fuelBurn(spec, 1000, 0, 1));
});

test('the weekly tick charges wages and interest exactly once per game week', () => {
    const s = createSession({ world });
    s.input = { update: () => ({ throttle: 0, brake: 0, steer: 0 }), setOverride() {}, onAction() {} };
    s.career.ledger.money = 5000;
    s.career.drivers.push({ id: 'd1', name: 'Test Driver', wage: 3 });
    takeLoan(s.career, 1000);
    const count = cat => s.career.ledger.entries.filter(e => e.category === cat).length;
    // three weeks in one jump...
    s.debugHook().advanceClock(24 * 7 * 3);
    assert.equal(count('wages'), 3);
    assert.equal(count('interest'), 3);
    // ...and one more week driven minute by minute (the boundary is crossed once)
    const target = s.career.calendar.minutes + 7 * 24 * 60;
    while (s.career.calendar.minutes < target) s.step(1); // 1 s steps = 15 s of game time each
    assert.equal(count('wages'), 4);
    assert.equal(count('interest'), 4);
});

test('bankruptcy goes bailout loan -> forced sale -> game over', () => {
    const c = createCareer({ money: -100 });
    c.fleet.push(newFleetVehicle(c, 'exe-two-tonner', 1925, 'depot-exeter', 0));
    const kinds = [];
    for (let week = 0; week < 6 && !c.retired; week++) {
        post(c.ledger, c.calendar.minutes, 'Losses', -Math.max(400, c.ledger.money + 400), 'other');
        kinds.push(...bankruptcyCheck(c, { year: 1925, tier: 0 }).map(e => e.kind));
    }
    const first = k => kinds.indexOf(k);
    assert.ok(first('bailout') >= 0 && first('forcedSale') > first('bailout') && first('gameOver') > first('forcedSale'), kinds.join(','));
    assert.equal(c.retired, true);
    assert.equal(c.fleet.length, 0);
});

test('a company in the black is left alone at the weekly tick', () => {
    const c = createCareer({ money: 50 });
    const events = weeklyTick(c, { year: 1919 });
    assert.ok(!events.some(e => ['bailout', 'forcedSale', 'gameOver'].includes(e.kind)));
});

test('special-cargo contracts are only offered when the fleet has a vehicle with the right tag', () => {
    const depot = world.depots.find(d => d.home);
    const base = { world, depot, year: 1936, tierInfo: TIERS[2], count: 12 };
    const vanOnly = [{ tags: ['van'], capacity: 1000 }];
    const withTipper = [...vanOnly, { tags: ['rigid', 'tipper'], capacity: 4000 }];
    let sawSpecial = false;
    for (let day = 0; day < 6; day++) {
        const minutes = minutesAt(1936, 2, 1 + day, 8);
        const plain = generateOffers({ ...base, minutes, fleet: vanOnly });
        assert.ok(plain.every(o => o.type !== 'special'), 'no specials without the tag');
        const tip = generateOffers({ ...base, minutes, fleet: withTipper });
        for (const o of tip.filter(x => x.type === 'special')) {
            sawSpecial = true;
            assert.deepEqual(o.tags, ['tipper']);
            assert.ok(o.weight <= 4000);
        }
    }
    assert.ok(sawSpecial, 'a tipper in the fleet brings china clay or granite work');
    // the driven vehicle must match too
    const job = { tags: ['tipper'], weight: 3000 };
    assert.ok(cannotTake(job, vehicleById('tamar-t-ton')));
    assert.equal(cannotTake(job, vehicleById('moorland-tipper')), null);
    assert.ok(cannotTake({ tags: [], weight: 500 }, vehicleById('kestrel')), 'a tractor unit needs a trailer');
});

test('reputation tiers unlock at their thresholds', () => {
    for (let i = 0; i < TIERS.length; i++) {
        assert.equal(tierOf(TIERS[i].at), i);
        if (i > 0) assert.equal(tierOf(TIERS[i].at - 1), i - 1);
    }
    const c = createCareer();
    assert.equal(addReputation(c, 'client', TIERS[1].at - 1), null);
    assert.equal(addReputation(c, 'client', 1)?.name, TIERS[1].name);
    assert.ok(!TIERS[0].special && TIERS[1].special && !TIERS[1].depots && TIERS[2].depots);
});

test('buying with a part-exchange swaps vehicles and charges the difference', () => {
    const c = createCareer({ money: 2000, minutes: minutesAt(1932, 0, 1) });
    const before = c.ledger.money;
    const { rec, cost } = buyVehicle(c, { model: 'dart-3', depot: 'depot-exeter', tradeIn: c.activeVehicle });
    assert.ok(rec && cost < vehicleById('dart-3').price);
    assert.equal(c.ledger.money, before - cost);
    assert.deepEqual(c.fleet.map(v => v.model), ['dart-3']);
    assert.ok(fleetCapabilities(c).some(f => f.tags.includes('box')));
});
