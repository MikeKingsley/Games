import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorld } from '../../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { buildRegion } from '../../Games.Client/wwwroot/games/delivery-driver/world/region.js';
import { generateChunk } from '../../Games.Client/wwwroot/games/delivery-driver/world/generator.js';
import { clearOfRoads, edgeOpen } from '../../Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js';
import { findRoute } from '../../Games.Client/wwwroot/games/delivery-driver/world/pathfind.js';
import { sat, createSpatialHash } from '../../Games.Client/wwwroot/games/delivery-driver/sim/collision.js';
import { CHUNK_SIZE, WORLD_SCALE } from '../../Games.Client/wwwroot/games/delivery-driver/config.js';

const SEED = new URL('../../Games.Client/wwwroot/games/delivery-driver/world/seed/sw-england.json', import.meta.url);
const json = () => JSON.parse(fs.readFileSync(SEED, 'utf8'));
const world = createWorld(json());
const exeter = world.region.townById.get('exeter');
const depot = world.depots.find(d => d.town === 'exeter');

const strip = c => JSON.stringify(c, (k, v) => (k === 'colliders' ? undefined : v));

test('the same seed and chunk give identical output; different chunks differ', () => {
    const other = createWorld(json());
    const i = Math.floor(exeter.x / CHUNK_SIZE), j = Math.floor(exeter.y / CHUNK_SIZE);
    // generate in a different order in the second world: output must not depend on it
    other.chunks.get(i + 5, j + 3);
    assert.equal(strip(generateChunk(world, i, j)), strip(generateChunk(other, i, j)));
    assert.equal(strip(generateChunk(world, i + 9, j - 4)), strip(generateChunk(other, i + 9, j - 4)));
    assert.notEqual(strip(generateChunk(world, i, j)), strip(generateChunk(world, i + 1, j)));
    // countryside west of Exeter: fields and trees differ chunk to chunk
    const far = generateChunk(world, i - 6, j - 3), far2 = generateChunk(world, i - 7, j - 3);
    assert.ok(far.fields.length && far2.fields.length);
    assert.notEqual(strip(far), strip(far2));
});

test('no building footprint overlaps a road or another building (200 chunks around Exeter)', () => {
    const i0 = Math.floor(exeter.x / CHUNK_SIZE) - 7, j0 = Math.floor(exeter.y / CHUNK_SIZE) - 7;
    const seen = new Map();
    let chunks = 0;
    for (let i = i0; i < i0 + 15 && chunks < 200; i++) {
        for (let j = j0; j < j0 + 14 && chunks < 200; j++, chunks++) {
            for (const b of world.chunks.get(i, j).buildings) seen.set(b.id, b);
        }
    }
    assert.equal(chunks, 200);
    const buildings = [...seen.values()];
    assert.ok(buildings.length > 300, `${buildings.length} buildings`);
    const hash = createSpatialHash(24);
    for (const b of buildings) {
        assert.ok(clearOfRoads(world.graph, b.box, 0), `building ${b.id} (${b.type}) overlaps a road`);
        for (const o of hash.query(b.box)) assert.equal(sat(o.box, b.box), null, `${b.id} overlaps ${o.id}`);
        hash.insert(b);
    }
});

test('every town street network is connected', () => {
    const g = world.graph;
    for (const town of world.region.towns) {
        const nodes = g.nodes.filter(n => n.town === town.id && n.kind === 'street');
        if (!nodes.length) continue;
        const seen = new Set([town.centreNode]);
        const stack = [town.centreNode];
        while (stack.length) {
            const n = stack.pop();
            for (const id of g.nodes[n].edges) {
                const e = g.edges[id];
                if (e.town !== town.id) continue;
                const m = g.other(e, n);
                if (!seen.has(m)) { seen.add(m); stack.push(m); }
            }
        }
        for (const n of nodes) assert.ok(seen.has(n.id), `${town.id}: street node ${n.id} is cut off`);
    }
});

test('A* finds a route from the Exeter depot to every drop point within 10 km', () => {
    const from = depot.yard.marker;
    const within = p => Math.hypot(p.x - from.x, p.y - from.y) <= 10000;
    const targets = [];
    for (const y of world.yards) if (within(y.yard.marker)) targets.push(y.yard.marker);
    for (const town of world.region.towns) {
        if (!within(town)) continue;
        const list = world.buildingsOfTown(town);
        // every building in Exeter, a deterministic sample elsewhere (each is one A* search)
        list.forEach((b, k) => { if (town === exeter || k % 25 === 0) targets.push(b.door); });
    }
    assert.ok(targets.length > 400, `${targets.length} targets`);
    for (const t of targets) {
        const r = findRoute(world.graph, from, t, { year: 1919, vmax: 11.2 });
        assert.ok(r && r.length > 0, `no route to ${t.x.toFixed(0)},${t.y.toFixed(0)}`);
        assert.ok(r.steps.every(s => edgeOpen(s.edge, 1919)));
    }
});

test('Exeter to Plymouth is at the expected compressed distance (+-10%)', () => {
    const ply = world.region.townById.get('plymouth');
    const rad = d => (d * Math.PI) / 180;
    const [a, b] = [exeter, ply];
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
    const real = 2 * 6371000 * Math.asin(Math.sqrt(h));
    const expected = real * WORLD_SCALE;
    const actual = Math.hypot(a.x - b.x, a.y - b.y);
    assert.ok(Math.abs(actual - expected) / expected < 0.1, `actual ${actual} expected ${expected}`);
});

test('regions are registered by id for future UK expansion', () => {
    const r = buildRegion({ ...json(), id: 'test-region' });
    assert.equal(r.id, 'test-region');
    assert.ok(r.towns.length > 50 && r.roads.length > 50);
});

test('the Exeter depot has a loading marker inside its yard', () => {
    assert.ok(depot);
    const m = depot.yard.marker;
    assert.equal(world.yardAt(m.x - Math.cos(m.heading) * -2, m.y - Math.sin(m.heading) * -2), depot);
});
