import { test } from 'node:test';
import { seedWithBaked } from './helpers/delivery-seed.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorld } from '../../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { buildRegion, isLand, waterAt } from '../../Games.Client/wwwroot/games/delivery-driver/world/region.js';
import {
    terrainHeight, waterLevel, groundZ, roadHeightAt, slopeAt, slopeFrom, groundNormal, gridHeight, GRID_N,
} from '../../Games.Client/wwwroot/games/delivery-driver/world/terrain.js';
import { pointAt } from '../../Games.Client/wwwroot/games/delivery-driver/world/geom.js';
import { CHUNK_SIZE } from '../../Games.Client/wwwroot/games/delivery-driver/config.js';

const json = () => seedWithBaked();
const world = createWorld(json());
const { region, graph } = world;
const exeter = region.townById.get('exeter');
const depot = world.depots.find(d => d.town === 'exeter');

/** A deterministic spread of points over the region's bounds. */
function scatter(count) {
    const b = region.bounds;
    let s = 20261103;
    const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
    return Array.from({ length: count }, () => ({ x: b.minX + rnd() * (b.maxX - b.minX), y: b.minY + rnd() * (b.maxY - b.minY) }));
}

/** Points spread over an OBB (up to `f` of its half sizes). */
function overBox(box, f = 0.95, steps = 7) {
    const out = [];
    const c = Math.cos(box.angle), s = Math.sin(box.angle);
    for (let a = 0; a < steps; a++) {
        for (let b = 0; b < steps; b++) {
            const u = (-1 + (2 * a) / (steps - 1)) * f, v = (-1 + (2 * b) / (steps - 1)) * f;
            out.push({ x: box.x + u * box.hx * c - v * box.hy * s, y: box.y + u * box.hx * s + v * box.hy * c });
        }
    }
    return out;
}

/** Steepest rise per metre of the driven surface under a footprint (along it or across it). */
const steepness = (x, y, heading, length = 3, width = 3) => {
    const s = slopeAt(world, x, y, heading, length, width);
    return Math.hypot(s.grade, Math.tan(s.roll));
};

test('heights are deterministic: repeated calls, a second region instance and a second world agree', () => {
    // (town centres move onto their real centre junction when the road graph is built, so compare two built worlds)
    const other = createWorld(json()).region;
    for (const p of scatter(3000)) {
        const h = terrainHeight(region, p.x, p.y);
        assert.ok(Number.isFinite(h));
        assert.equal(terrainHeight(region, p.x, p.y), h);
        assert.equal(terrainHeight(other, p.x, p.y), h);
    }
    // grading is deterministic too
    const again = createWorld(json());
    for (const e of graph.edges) assert.deepEqual(again.graph.edges[e.id].z, e.z, `edge ${e.id}`);
    for (const n of graph.nodes) assert.equal(again.graph.nodes[n.id].z, n.z);
    // and the noise is seeded from the region seed
    const reseeded = buildRegion({ ...json(), id: 'terrain-reseeded', seed: 7 });
    const differ = scatter(500).filter(p => isLand(region, p.x, p.y) && terrainHeight(reseeded, p.x, p.y) !== terrainHeight(region, p.x, p.y));
    assert.ok(differ.length > 100, `${differ.length} land points differ`);
});

test('the sea (and the shore strip) is at or below sea level, and deepens offshore', () => {
    let sea = 0;
    for (const p of scatter(20000)) {
        if (isLand(region, p.x, p.y) && waterAt(region, p.x, p.y) !== Infinity) continue;
        sea++;
        assert.ok(terrainHeight(region, p.x, p.y) <= 0, `sea at ${p.x.toFixed(1)},${p.y.toFixed(1)} is above 0`);
    }
    assert.ok(sea > 5000, `${sea} sea points`);
    const offshore = region.project(50.5, -3.2); // Lyme Bay
    assert.ok(terrainHeight(region, offshore.x, offshore.y) < -5);
    assert.equal(waterLevel(region, offshore.x, offshore.y), 0);
});

test('Dartmoor stands well above the Exeter pad, at its real height (621 m / 13)', () => {
    const moor = region.moors.find(m => m.id === 'dartmoor');
    let cx = 0, cy = 0;
    for (let i = 0; i < moor.pts.length; i += 2) { cx += moor.pts[i]; cy += moor.pts[i + 1]; }
    cx /= moor.pts.length / 2;
    cy /= moor.pts.length / 2;
    const dartmoor = terrainHeight(region, cx, cy);
    const pad = groundZ(world, depot.yard.marker.x, depot.yard.marker.y);
    assert.ok(dartmoor > pad + 15, `Dartmoor ${dartmoor.toFixed(2)} vs Exeter ${pad.toFixed(2)}`);
    let top = -Infinity;
    for (let x = cx - 1500; x <= cx + 1500; x += 25) for (let y = cy - 1500; y <= cy + 1500; y += 25) top = Math.max(top, terrainHeight(region, x, y));
    assert.ok(top >= 42 && top <= 48.5, `Dartmoor's highest point ${top.toFixed(2)} m (real: High Willhays 621 m / 13 = 47.8)`);
    // and Exeter's ground is a level pad
    for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        assert.ok(Math.abs(terrainHeight(region, exeter.x + Math.cos(a) * 150, exeter.y + Math.sin(a) * 150) - pad) < 0.5);
    }
});

test('the Exeter depot yard, its loading bay, the practice yard and every loading bay are level (< 2%)', () => {
    for (const p of overBox(depot.yard.zone)) assert.ok(steepness(p.x, p.y, depot.yard.angle) < 0.02, 'Exeter depot yard');
    const m = depot.yard.marker;
    assert.ok(steepness(m.x, m.y, m.heading, 7, 2.5) < 0.02, 'Exeter loading bay');
    const practice = world.practice;
    for (const p of overBox(practice.yard.zone)) assert.ok(steepness(p.x, p.y, 0) < 0.02, 'practice yard');
    for (const bay of practice.bays) assert.ok(steepness(bay.x, bay.y, bay.heading, 7, 2.5) < 0.02, 'practice bay');
    for (const y of world.yards) {
        const b = y.yard.marker;
        assert.ok(steepness(b.x, b.y, b.heading, 7, 2.5) < 0.02, `${y.id} loading bay`);
    }
});

test('no road is ever steeper than its class allows (and none climbs over 12% for 100 m)', () => {
    const bad = [];
    for (const e of graph.edges) {
        const limit = region.maxGrade[e.cls];
        assert.ok(limit > 0 && e.maxGrade <= limit, `edge ${e.id} ${e.cls}`);
        const { z, zStep } = e;
        for (let i = 1; i < z.length; i++) if (Math.abs(z[i] - z[i - 1]) / zStep > limit + 1e-4) bad.push(`${e.id}@${i}`);
        // between the samples too (roadHeightAt interpolates)
        for (let t = 0; t + 1 <= e.len; t += 2.3) if (Math.abs(roadHeightAt(e, t + 1) - roadHeightAt(e, t)) > limit + 1e-4) bad.push(`${e.id}@${t}m`);
        for (let t = 0; t + 100 <= e.len; t += 10) if (Math.abs(roadHeightAt(e, t + 100) - roadHeightAt(e, t)) / 100 > 0.12) bad.push(`${e.id} sustained@${t}m`);
    }
    assert.deepEqual(bad.slice(0, 10), []);
    // the relief makes some real hills: a share of the A-roads climb at 4% or more
    let steep = 0, total = 0;
    for (const e of graph.edges.filter(x => x.cls === 'A')) {
        for (let i = 1; i < e.z.length; i++) { total++; if (Math.abs(e.z[i] - e.z[i - 1]) / e.zStep >= 0.04) steep++; }
    }
    assert.ok(steep / total > 0.05, `${((100 * steep) / total).toFixed(1)}% of A-road at >= 4%`);
});

test('town streets are level (< 2%)', () => {
    // (streets inside the town's flat pad; the real streets at the town's edge follow the land up to the class limit)
    const inPad = e => {
        const t = region.townById.get(e.town);
        const m = pointAt(e.pts, e.len / 2);
        return t && Math.hypot(m.x - t.x, m.y - t.y) < t.radius * 0.6;
    };
    for (const e of graph.edges.filter(x => x.cls === 'street' && inPad(x))) {
        for (let i = 1; i < e.z.length; i++) assert.ok(Math.abs(e.z[i] - e.z[i - 1]) / e.zStep < 0.02, `street ${e.id} in ${e.town}`);
    }
});

test('every junction is one height: the roads meeting at a node agree within 1 cm', () => {
    for (const n of graph.nodes) {
        for (const id of n.edges) {
            const e = graph.edges[id];
            const h = e.a === n.id ? roadHeightAt(e, 0) : roadHeightAt(e, e.len);
            assert.ok(Math.abs(h - n.z) < 0.01, `node ${n.id} edge ${id}: ${h} vs ${n.z}`);
        }
    }
});

test('bridge decks are straight between their abutments and clear the water', () => {
    let spans = 0, wet = 0;
    for (const e of graph.edges) {
        const last = e.z.length - 1;
        if (e.bridge || e.cls === 'ferry') assert.deepEqual(e.zBridges, [[0, last]], `edge ${e.id} is one straight deck`);
        for (const [a, b] of e.zBridges) {
            spans++;
            for (let k = a; k <= b; k++) {
                const straight = e.z[a] + ((e.z[b] - e.z[a]) * (k - a)) / (b - a);
                assert.ok(Math.abs(e.z[k] - straight) < 0.01, `edge ${e.id} deck sample ${k}`);
                const p = pointAt(e.pts, k * e.zStep);
                if (e.cls === 'ferry' || k === a || k === b || !(waterAt(region, p.x, p.y) > 0)) continue;
                wet++;
                assert.ok(e.z[k] >= (waterLevel(region, p.x, p.y) ?? 0) + 0.25, `edge ${e.id} deck ${k} clears the water`);
            }
        }
        // anywhere a graded road crosses water, it is on a straight deck
        if (e.bridge || e.cls === 'ferry') continue;
        for (let k = 1; k < last; k++) {
            const p = pointAt(e.pts, k * e.zStep);
            if (waterAt(region, p.x, p.y) > 0) assert.ok(e.zBridges.some(([a, b]) => a < k && k < b), `edge ${e.id} sample ${k} over water`);
        }
    }
    assert.ok(spans > 50 && wet > 50, `${spans} spans, ${wet} deck samples over water`);
    const tamar = graph.edges.find(e => e.road === 'a38-tamar-bridge' && e.bridge && e.len > 25);
    assert.ok(tamar, 'the Tamar Bridge');
    assert.deepEqual(tamar.zBridges, [[0, tamar.z.length - 1]]);
});

test('slopeAt: grade, pitch and roll signs on a plane, and on a steady road climb', () => {
    // z rises 5% eastward (+x) and 2% northward (-y)
    const plane = (x, y) => 0.05 * x - 0.02 * y + 3;
    const close = (a, b) => Math.abs(a - b) < 1e-9;
    const east = slopeFrom(plane, 10, 20, 0, 6, 2.4);
    assert.ok(close(east.grade, 0.05) && east.pitch > 0 && close(east.roll, Math.atan(0.02)), 'east: uphill, left (north) side high');
    assert.ok(close(east.z, plane(10, 20)));
    const west = slopeFrom(plane, 10, 20, Math.PI, 6, 2.4);
    assert.ok(close(west.grade, -0.05) && west.pitch < 0 && west.roll < 0, 'west: downhill, right (north) side high');
    const south = slopeFrom(plane, 10, 20, Math.PI / 2, 6, 2.4);
    assert.ok(close(south.grade, -0.02) && south.pitch < 0 && close(south.roll, Math.atan(0.05)), 'south: downhill, left (east) side high');
    const north = slopeFrom(plane, 10, 20, -Math.PI / 2, 6, 2.4);
    assert.ok(close(north.grade, 0.02) && north.pitch > 0 && north.roll < 0, 'north: uphill, right (east) side high');
    for (const s of [east, west, south, north]) {
        const len = Math.hypot(0.05, 0.02, 1);
        assert.ok(close(s.nx, -0.05 / len) && close(s.ny, 0.02 / len) && close(s.nz, 1 / len), 'the normal leans downhill');
    }
    // on the world: a road sample climbing steadily at 4%+ (a plane-like stretch), queried along and against it
    let found = null;
    for (const e of graph.edges) {
        if (found || (e.cls !== 'A' && e.cls !== 'B') || e.bridge) continue;
        for (let i = 3; i < e.z.length - 3 && !found; i++) {
            const g = (e.z[i + 1] - e.z[i - 1]) / (2 * e.zStep);
            const steady = Math.abs((e.z[i + 3] - e.z[i - 3]) / (6 * e.zStep) - g) < 0.002;
            const p = pointAt(e.pts, i * e.zStep);
            if (g > 0.04 && steady && e.zBridges.length === 0 && Math.abs(groundZ(world, p.x, p.y) - e.z[i]) < 1e-3) found = { e, p, g };
        }
    }
    assert.ok(found, 'a steady 4% climb');
    const { p, g } = found;
    const up = slopeAt(world, p.x, p.y, p.angle, 4, 2), down = slopeAt(world, p.x, p.y, p.angle + Math.PI, 4, 2);
    assert.ok(Math.abs(up.grade - g) < 0.005 && up.pitch > 0, `uphill ${up.grade} vs ${g}`);
    assert.ok(Math.abs(down.grade + g) < 0.005 && down.pitch < 0);
    assert.ok(Math.abs(up.roll) < 0.005 && Math.abs(down.roll) < 0.005, 'roads are level across');
    assert.deepEqual(slopeAt(world, p.x, p.y, p.angle, 4, 2), up, 'repeat queries agree');
    const n = groundNormal(world, p.x, p.y);
    assert.ok(n.nz > 0.99 && n.nx * Math.cos(p.angle) + n.ny * Math.sin(p.angle) < 0, 'the normal leans back down the hill');
});

test('rivers run in channels below their banks and fall to sea level at the estuary', () => {
    for (const r of region.rivers) {
        const source = r.pts[0], mouth = r.pts[r.pts.length - 1];
        const top = waterLevel(region, source.x, source.y), bottom = waterLevel(region, mouth.x, mouth.y);
        assert.ok(top !== null && top >= 0, `${r.id} source level`);
        assert.equal(bottom, 0, `${r.id} reaches sea level`);
        assert.ok(top >= bottom);
        assert.ok(terrainHeight(region, source.x, source.y) < top, `${r.id} bed below its water`);
    }
});

test('chunks carry a 17x17 height grid matching the ground and their neighbours; their objects sit on the ground', () => {
    const i = Math.floor(exeter.x / CHUNK_SIZE), j = Math.floor(exeter.y / CHUNK_SIZE);
    const c = world.chunks.get(i, j), right = world.chunks.get(i + 1, j), below = world.chunks.get(i, j + 1);
    const g = c.terrain;
    assert.equal(g.n, GRID_N);
    assert.equal(g.z.length, GRID_N * GRID_N);
    assert.equal(g.step, CHUNK_SIZE / (GRID_N - 1));
    assert.equal(c.terrain, g, 'built once and kept');
    const n = g.n;
    for (let k = 0; k < n; k++) {
        assert.equal(g.z[k * n + n - 1], right.terrain.z[k * n], 'east seam');
        assert.equal(g.z[(n - 1) * n + k], below.terrain.z[k], 'south seam');
    }
    for (let k = 0; k < g.z.length; k += 7) {
        const x = g.x0 + (k % n) * g.step, y = g.y0 + Math.floor(k / n) * g.step;
        assert.ok(Math.abs(g.z[k] - groundZ(world, x, y, false)) < 1e-4);
        assert.ok(Math.abs(gridHeight(g, x, y) - g.z[k]) < 1e-6);
    }
    assert.ok(c.buildings.length && c.trees.length + c.lamps.length > 0);
    for (const b of c.buildings) assert.ok(Number.isFinite(b.z) && b.z <= groundZ(world, b.x, b.y) + 1e-9, `building ${b.id}`);
    for (const o of [...c.trees, ...c.lamps, ...c.signs, ...c.rocks]) assert.equal(o.z, groundZ(world, o.x, o.y));
});
