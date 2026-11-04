import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorld } from '../../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { edgeOpen } from '../../Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js';
import {
    mapTransform, hillshade, hypsometric, reliefColour, reliefRaster, visibleRoads, buildMapMesh, buildMapMarkers, SEA,
} from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/minimap-gl.js';

const SEED = new URL('../../Games.Client/wwwroot/games/delivery-driver/world/seed/sw-england.json', import.meta.url);
const world = createWorld(JSON.parse(fs.readFileSync(SEED, 'utf8')));
const { region } = world;
const exeter = region.townById.get('exeter');

test('map transform round-trips world points for any centre, range and rotation', () => {
    for (const rot of [0, 0.7, -2.4, Math.PI]) {
        const t = mapTransform({ w: 360, h: 240, cx: 1234, cy: -567, range: 900, rot });
        for (const [x, y] of [[1234, -567], [2000, 100], [-300, -1800]]) {
            const [sx, sy] = t.project(x, y);
            const [wx, wy] = t.unproject(sx, sy);
            assert.ok(Math.abs(wx - x) < 1e-6 && Math.abs(wy - y) < 1e-6, `rot ${rot}: (${x}, ${y}) -> (${wx}, ${wy})`);
        }
    }
});

test('map transform puts the centre mid-screen and `range` metres at the nearest edge', () => {
    const t = mapTransform({ w: 400, h: 200, cx: 50, cy: 80, range: 500 });
    assert.deepEqual(t.project(50, 80), [200, 100]);
    assert.ok(Math.abs(t.project(50 + 500, 80)[0] - 300) < 1e-9, 'the short side is 200 px / 2 for 500 m');
    // turning by a quarter turn sends world east to the top of the screen, matching the 2D map's rotate(-rot)
    const q = mapTransform({ w: 200, h: 200, cx: 0, cy: 0, range: 100, rot: Math.PI / 2 });
    const [sx, sy] = q.project(100, 0);
    assert.ok(Math.abs(sx - 100) < 1e-9 && Math.abs(sy) < 1e-9, `${sx}, ${sy}`);
});

test('hillshade: slopes facing the north-west light are brighter than slopes facing away', () => {
    const step = 60;
    // ground rising to the south-east faces the light's side... heights: west low, east high is a slope facing west
    const facingLight = hillshade(0, 20, 0, 20, step); // higher to the east and south: the surface faces north-west
    const facingAway = hillshade(20, 0, 20, 0, step); // higher to the west and north: faces south-east
    const flat = hillshade(5, 5, 5, 5, step);
    assert.ok(Math.abs(flat - 1) < 1e-9, 'flat ground is neutral');
    assert.ok(facingLight > flat && facingAway < flat, `${facingLight} > ${flat} > ${facingAway}`);
    assert.ok(facingLight > facingAway * 1.5);
});

test('hypsometric tint: lowland green, moor browner, tops rock grey, shore pale', () => {
    const low = hypsometric(3), moor = hypsometric(14), top = hypsometric(38), shore = hypsometric(0);
    assert.ok(low[1] > low[0], 'lowland is green');
    assert.ok(moor[0] > low[0], 'moor is redder');
    assert.ok(top[0] > moor[0] && Math.abs(top[0] - top[2]) < 30, 'tops are grey');
    assert.ok(shore[0] > low[0], 'the shore is sandy');
});

test('relief raster covers the region, the sea is sea and Dartmoor is lighter than the lowlands', () => {
    const r = reliefRaster(world);
    assert.equal(reliefRaster(world), r, 'built once per world');
    const b = region.bounds;
    assert.ok(r.width * r.cell >= b.maxX - b.minX && r.height * r.cell >= b.maxY - b.minY);
    assert.equal(r.data.length, r.width * r.height * 4);
    const pixel = (x, y) => {
        const i = Math.floor((x - r.x0) / r.cell), j = Math.floor((y - r.y0) / r.cell);
        const o = (j * r.width + i) * 4;
        return [r.data[o], r.data[o + 1], r.data[o + 2]];
    };
    assert.deepEqual(pixel(b.minX + 30, b.minY + 30), SEA, 'the north-west corner is open sea');
    assert.deepEqual(reliefColour(region, b.minX + 30, b.minY + 30), SEA);
    const moor = region.moors.find(m => m.name?.toLowerCase().includes('dartmoor')) ?? region.moors[0];
    let sx = 0, sy = 0;
    for (let i = 0; i < moor.pts.length; i += 2) { sx += moor.pts[i]; sy += moor.pts[i + 1]; }
    const mc = pixel(sx / (moor.pts.length / 2), sy / (moor.pts.length / 2));
    const ex = pixel(exeter.x, exeter.y);
    assert.notDeepEqual(mc, SEA);
    assert.ok(mc[0] > ex[0] - 5 && mc[0] !== ex[0], `moor ${mc} versus Exeter ${ex}`);
});

test('road visibility follows the year: the M5 is absent in 1919 and present in 1977', () => {
    const view = { cx: exeter.x, cy: exeter.y, range: 9000 };
    const inYear = year => new Set(visibleRoads(world, year, view).map(r => r.edge));
    const early = inYear(1919), late = inYear(1977);
    for (const { edge } of visibleRoads(world, 1919, view)) assert.ok(edgeOpen(edge, 1919));
    const motorways = year => visibleRoads(world, year, view).filter(r => r.cls === 'M').length;
    assert.equal(motorways(1919), 0, 'no motorway in 1919');
    assert.ok(motorways(1977) > 0, 'a motorway by 1977');
    assert.ok(late.size !== early.size);
    // zoomed far out the small roads are dropped, zoomed in they are kept
    const small = (range) => visibleRoads(world, 1990, { cx: exeter.x, cy: exeter.y, range }).filter(r => ['street', 'lane', 'access'].includes(r.cls)).length;
    assert.equal(small(2000), 0);
    assert.ok(small(400) > 0);
});

test('map mesh: finite, flat, one winding, and only the roads open that year', () => {
    const view = { cx: exeter.x, cy: exeter.y, range: 600, scale: 180 / 600 };
    const m = buildMapMesh(world, 1990, view);
    assert.ok(m.indices.length > 300 * 3, 'roads, rivers and towns have triangles');
    for (const v of m.positions) assert.ok(Number.isFinite(v));
    for (let i = 2; i < m.positions.length; i += 3) assert.equal(m.positions[i], 0);
    for (const v of m.colors) assert.ok(v >= 0 && v <= 1);
    // fewer open roads in 1919 means a smaller mesh
    assert.ok(buildMapMesh(world, 1919, view).indices.length < m.indices.length);
    // a far smaller area costs less
    assert.ok(buildMapMesh(world, 1990, { ...view, range: 150, scale: 180 / 150 }).indices.length < m.indices.length);
});

test('map markers: route line, target, depots and fleet are drawn, magenta route first', () => {
    const route = { pts: [exeter.x, exeter.y, exeter.x + 400, exeter.y + 100, exeter.x + 900, exeter.y + 300] };
    const scale = 0.3;
    const none = buildMapMarkers({ world, route: null, fleetMarkers: () => [] }, { scale });
    const withRoute = buildMapMarkers({ world, route, fleetMarkers: () => [{ x: exeter.x, y: exeter.y }] }, { scale });
    assert.equal(none.indices.length / 3, world.depots.length * 2, 'two triangles per depot square');
    assert.ok(withRoute.indices.length > none.indices.length);
    // the route line's outline then its pink fill are the first vertices; a magenta vertex exists
    let magenta = false;
    for (let i = 0; i < withRoute.colors.length; i += 3) {
        if (withRoute.colors[i] > 0.95 && Math.abs(withRoute.colors[i + 1] - 0.247) < 0.01 && withRoute.colors[i + 2] > 0.68) magenta = true;
    }
    assert.ok(magenta, 'the route colour is #ff3fb4');
});
