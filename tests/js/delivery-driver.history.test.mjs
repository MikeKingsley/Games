import { test } from 'node:test';
import { seedWithBaked } from './helpers/delivery-seed.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorld } from '../../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { findRoute } from '../../Games.Client/wwwroot/games/delivery-driver/world/pathfind.js';
import { edgeOpen, edgeClass } from '../../Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js';
import { eventsBetween, ferrySlips, slipNear, roadEvents } from '../../Games.Client/wwwroot/games/delivery-driver/world/history.js';
import { WORLD_SCALE, TIME_SCALE, MPH } from '../../Games.Client/wwwroot/games/delivery-driver/config.js';

const world = createWorld(seedWithBaked());
const town = id => world.region.townById.get(id);

test('Plymouth to Saltash takes the Saltash ferry in 1950 and the Tamar Bridge in 1965', () => {
    const r1950 = findRoute(world.graph, town('plymouth'), town('saltash'), { year: 1950 });
    const r1965 = findRoute(world.graph, town('plymouth'), town('saltash'), { year: 1965 });
    assert.ok(r1950.steps.some(s => s.edge.road === 'a38-ply-saltash-ferry' && s.edge.cls === 'ferry'));
    assert.ok(!r1950.steps.some(s => s.edge.road === 'a38-tamar-bridge'));
    assert.ok(r1965.steps.some(s => s.edge.road === 'a38-tamar-bridge'));
    assert.ok(!r1965.steps.some(s => s.edge.cls === 'ferry'));
});

test('the M5 is closed before 1977 and open after', () => {
    const m5 = world.graph.edges.filter(e => e.road === 'm5' && e.cls === 'M');
    assert.ok(m5.length > 0);
    for (const e of m5) {
        assert.equal(edgeOpen(e, 1976), false);
        assert.equal(edgeOpen(e, 1977), true);
        assert.equal(edgeClass(e, 1980), 'M');
    }
    const cullompton = town('cullompton');
    const exeter = town('exeter');
    const r = findRoute(world.graph, exeter, cullompton, { year: 1980, vmax: 30 });
    assert.ok(r.steps.some(s => s.edge.road === 'm5'), 'the 1980 route to Cullompton uses the M5');
    const old = findRoute(world.graph, exeter, cullompton, { year: 1970, vmax: 30 });
    assert.ok(!old.steps.some(s => s.edge.road === 'm5'));
});

test('Exeter to Penzance in 1990 at 50 mph is about 10 real minutes', () => {
    const r = findRoute(world.graph, town('exeter'), town('penzance'), { year: 1990, vmax: 50 * MPH });
    const realSeconds = r.length / WORLD_SCALE / (50 * MPH) / TIME_SCALE;
    assert.ok(Math.abs(realSeconds / 60 - 10) <= 2, `${(realSeconds / 60).toFixed(1)} min`);
});

test('every seed town is reachable from Exeter in 1919 and 2020', () => {
    for (const year of [1919, 2020]) {
        for (const t of world.region.towns) {
            const r = findRoute(world.graph, town('exeter'), t, { year });
            assert.ok(r, `${t.id} unreachable in ${year}`);
            assert.ok(r.steps.every(s => edgeOpen(s.edge, year)));
        }
    }
});

test('road history events are reported when the year changes', () => {
    const e1961 = eventsBetween(world, 1960, 1961).map(e => `${e.road}:${e.kind}`);
    assert.ok(e1961.includes('a38-tamar-bridge:opened'));
    assert.ok(e1961.includes('a38-ply-saltash-ferry:closed'));
    assert.ok(eventsBetween(world, 1937, 1938).some(e => e.road === 'a30-exeter-bypass'));
    const years = roadEvents(world).map(e => e.year);
    assert.deepEqual(years, [...years].sort((a, b) => a - b));
});

test('ferry slips exist at both ends of every ferry and close with the ferry', () => {
    const slips = ferrySlips(world);
    const names = new Set(slips.map(s => s.name));
    for (const n of ['Torpoint Ferry', 'Saltash Ferry', 'Dartmouth Ferry']) assert.ok(names.has(n), n);
    const saltash = slips.find(s => s.name === 'Saltash Ferry');
    assert.ok(slipNear(world, saltash.x, saltash.y, 1950));
    assert.equal(slipNear(world, saltash.x, saltash.y, 1965)?.name === 'Saltash Ferry', false);
    const torpoint = slips.find(s => s.name === 'Torpoint Ferry');
    assert.ok(slipNear(world, torpoint.x, torpoint.y, 2020), 'the Torpoint ferry still runs');
});
