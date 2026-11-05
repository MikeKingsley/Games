// Bridge and tunnel meshes, parapet colliders and the chase camera under decks (plan 0009 phase 10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedWithBaked } from './helpers/delivery-seed.mjs';
import { railHitsAlong, RIGS } from './helpers/drive-through.mjs';
import { createWorld } from '../../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { roadHeightAt, decksAt, cameraGroundZ, tunnelFloorNear } from '../../Games.Client/wwwroot/games/delivery-driver/world/terrain.js';
import { SLAB, drawLevel } from '../../Games.Client/wwwroot/games/delivery-driver/world/crossings.js';
import { edgeOpen, edgeWidth } from '../../Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js';
import { closestOnPoly, pointAt } from '../../Games.Client/wwwroot/games/delivery-driver/world/geom.js';
import { railsNear, railTouches } from '../../Games.Client/wwwroot/games/delivery-driver/world/rails.js';
import { createVehicle, collideVehicle } from '../../Games.Client/wwwroot/games/delivery-driver/sim/vehicle.js';
import { vehicleById } from '../../Games.Client/wwwroot/games/delivery-driver/game/catalogue.js';
import * as R from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/road-mesh.js';
import { BRIDGE, TUNNEL, deckRuns, tunnelRuns, railOffset } from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/structure-mesh.js';
import { buildChunkMesh } from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/terrain-mesh.js';
import { clearSolids } from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/camera3d.js';
import { CHUNK_SIZE } from '../../Games.Client/wwwroot/games/delivery-driver/config.js';

const world = createWorld(seedWithBaked());
const { graph } = world;
const E = graph.edges;
const YEAR = 2024;
const colour = (mesh, rgb, eps = 1e-3) => {
    const out = [];
    for (let i = 0; i < mesh.positions.length / 3; i++) if ([0, 1, 2].every(k => Math.abs(mesh.colors[i * 3 + k] - rgb[k]) < eps)) out.push([mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]]);
    return out;
};
const open = e => edgeOpen(e, YEAR) && e.cls !== 'ferry' && e.z;
/** Separated crossings whose upper road is a deck over a ground-level road, both open in 2024. */
const overpasses = graph.crossings.filter(c => !c.atGrade && c.levels[0] > 0 && c.levels[1] === 0 && open(E[c.upper.edge]) && open(E[c.lower.edge]));

test('the region has deck and tunnel runs to build', () => {
    assert.ok(E.filter(e => deckRuns(e).length).length > 1000);
    assert.ok(E.filter(e => tunnelRuns(e).length).length >= 20);
    assert.ok(overpasses.length > 100, `${overpasses.length} overpasses`);
});

test('decks: parapets stand 0.9 m above the deck, with a dark soffit and a slab as thick as the grading assumes', () => {
    const e = E.find(x => open(x) && x.cls === 'A' && deckRuns(x).some(([a, b]) => b - a > 30 && a > 12 && b < x.len - 12));
    assert.ok(e, 'a long A-road bridge');
    const mesh = R.buildEdgeMesh(world, e, YEAR);
    const [a, b] = deckRuns(e).find(([p, q]) => q - p > 30 && p > 12 && q < e.len - 12);
    const parapets = colour(mesh, BRIDGE.concrete);
    assert.ok(parapets.length > 20, 'concrete parapets from 1960');
    // every parapet vertex stands between the deck and 0.9 m above it (plus the rise over one 4 m sample on a ramp)
    let tallest = 0;
    for (const [x, y, z] of parapets) {
        const rel = z - roadHeightAt(e, closestOnPoly(e.pts, x, y).along);
        assert.ok(rel > -0.2 && rel < BRIDGE.parapet + 1.2, `parapet vertex ${rel.toFixed(2)} m over the deck`);
        tallest = Math.max(tallest, rel);
    }
    assert.ok(tallest > BRIDGE.parapet - 0.1, `tallest parapet ${tallest.toFixed(2)} m`);
    assert.ok(colour(mesh, BRIDGE.soffit).length > 0, 'soffit');
    assert.equal(BRIDGE.slab, SLAB);
    const old = R.buildEdgeMesh(world, e, 1930);
    assert.ok(colour(old, BRIDGE.stone).length > 0 && colour(old, BRIDGE.concrete).length === 0, 'stone parapets before 1960');
});

test('decks over a road are a clear span: no pier, abutment or slab part stands in the carriageway below', () => {
    let checked = 0;
    for (const c of overpasses) {
        const U = E[c.upper.edge], L = E[c.lower.edge];
        const mesh = R.buildEdgeMesh(world, U, YEAR);
        if (!mesh) continue;
        const half = edgeWidth(L, YEAR) / 2 - 0.2;
        for (const col of [BRIDGE.under, BRIDGE.pier]) {
            for (const [x, y, z] of colour(mesh, col)) {
                if (Math.hypot(x - c.x, y - c.y) > 80) continue;
                const near = closestOnPoly(L.pts, x, y);
                if (near.d >= half) continue;
                // anything inside the lower carriageway's plan must stay above the deck's underside clearance
                const lowerZ = roadHeightAt(L, near.along);
                assert.ok(z > lowerZ + 5.5 - 0.3, `edge ${U.id} over ${L.id} at ${x.toFixed(0)},${y.toFixed(0)}: part at ${(z - lowerZ).toFixed(2)} m over the road below`);
            }
        }
        checked++;
        if (checked >= 80) break;
    }
    assert.ok(checked >= 50, `${checked} overpasses checked`);
});

test('tunnels: walls, roof beams, lamps from 1935, and portal walls where the tunnel meets daylight', () => {
    const tunnels = E.filter(e => open(e) && tunnelRuns(e).some(([a, b]) => b - a > 12 && a > 6 && b < e.len - 6));
    assert.ok(tunnels.length >= 3, `${tunnels.length} tunnels with both portals on the edge`);
    for (const e of tunnels.slice(0, 6)) {
        const now = R.buildEdgeMesh(world, e, YEAR), early = R.buildEdgeMesh(world, e, 1930);
        assert.ok(colour(now, TUNNEL.wall).length > 0, `edge ${e.id} walls`);
        assert.ok(colour(now, TUNNEL.beam).length > 0, `edge ${e.id} roof beams`);
        const portal = colour(now, TUNNEL.portal);
        assert.ok(portal.length >= 16, `edge ${e.id} has a portal at each end (${portal.length} vertices)`);
        const zs = portal.map(p => p[2]);
        assert.ok(Math.max(...zs) - Math.min(...zs) > TUNNEL.height, 'the portal wall stands above the opening');
        assert.ok(colour(now, TUNNEL.lamp).length > 0 && colour(early, TUNNEL.lamp).length === 0, 'lamps from 1935 only');
    }
});

test('the ground under a bridge follows the ground or the road below, never the deck', () => {
    let checked = 0, vertices = 0;
    for (const c of overpasses.slice(0, 40)) {
        const U = E[c.upper.edge];
        const chunk = world.chunks.get(Math.floor(c.x / CHUNK_SIZE), Math.floor(c.y / CHUNK_SIZE));
        const { ground } = buildChunkMesh(world, chunk, { lod: 0 });
        for (let i = 0; i < ground.positions.length; i += 3) {
            const x = ground.positions[i], y = ground.positions[i + 1], z = ground.positions[i + 2];
            if (Math.hypot(x - c.x, y - c.y) > 40) continue;
            const near = closestOnPoly(U.pts, x, y);
            const zone = U.zones?.find(w => w.kind === 'deck' && near.along >= w.from + 2 && near.along <= w.to - 2);
            if (!zone || near.d > U.zHalf) continue;
            assert.ok(z <= roadHeightAt(U, near.along) - SLAB + 0.01, `ground at ${x.toFixed(0)},${y.toFixed(0)} is ${z.toFixed(2)}, deck ${roadHeightAt(U, near.along).toFixed(2)}`);
            vertices++;
        }
        checked++;
    }
    assert.ok(checked >= 30 && vertices > 20, `${checked} overpasses, ${vertices} ground vertices under decks`);
});

test('a tunnel is a covered cutting: the ground mesh is cut down to the road over and beside it', () => {
    let low = 0;
    for (const e of E.filter(x => open(x) && tunnelRuns(x).length)) {
        for (const [a, b] of tunnelRuns(e)) {
            const m = pointAt(e.pts, (a + b) / 2);
            const chunk = world.chunks.get(Math.floor(m.x / CHUNK_SIZE), Math.floor(m.y / CHUNK_SIZE));
            const { ground } = buildChunkMesh(world, chunk, { lod: 0 });
            for (let i = 0; i < ground.positions.length; i += 3) {
                const x = ground.positions[i], y = ground.positions[i + 1], z = ground.positions[i + 2];
                const near = closestOnPoly(e.pts, x, y);
                if (near.along < a + 1 || near.along > b - 1 || near.d > e.zHalf + 5) continue;
                assert.ok(z <= roadHeightAt(e, near.along) + 1e-3, `ground over tunnel ${e.id} at ${near.along.toFixed(0)} m is ${z.toFixed(2)} above the road ${roadHeightAt(e, near.along).toFixed(2)}`);
                low++;
            }
        }
        if (low > 30) break;
    }
    assert.ok(low > 5, `${low} cut vertices`);
});

test('parapet colliders: one per ~4 m, both sides, at the parapet offset, standing from the deck to the parapet top', () => {
    const e = E.find(x => open(x) && x.cls === 'A' && deckRuns(x).some(([a, b]) => b - a > 40 && a > 20 && b < x.len - 20));
    const [a, b] = deckRuns(e).find(([p, q]) => q - p > 40 && p > 20 && q < e.len - 20);
    const m = pointAt(e.pts, (a + b) / 2);
    const rails = railsNear(world, m.x, m.y, 20, YEAR);
    const mine = rails.filter(r => r.edge === e && r.kind === 'rail');
    assert.ok(mine.length >= 8 && mine.some(r => r.side === 1) && mine.some(r => r.side === -1));
    for (const r of mine) {
        const near = closestOnPoly(e.pts, r.box.x, r.box.y);
        assert.ok(Math.abs(near.d - railOffset(edgeWidth(e, YEAR))) < 0.8, `rail ${near.d.toFixed(2)} m from the centreline`);
        assert.ok(r.z1 - r.z0 >= BRIDGE.parapet - 1e-6);
    }
    // not drawn where the road is closed in the year
    const closed = E.find(x => deckRuns(x).length && !edgeOpen(x, 1919) && x.z);
    if (closed) {
        const p = pointAt(closed.pts, deckRuns(closed)[0][0] + 1);
        assert.equal(railsNear(world, p.x, p.y, 10, 1919).filter(r => r.edge === closed).length, 0);
    }
});

test('a car at 30 mph into a parapet is stopped; a car on the road below, or one that is level with the deck, is judged by height', () => {
    const e = E.find(x => open(x) && x.cls === 'A' && !x.dual && deckRuns(x).some(([a, b]) => b - a > 40 && a > 20 && b < x.len - 20));
    const [a, b] = deckRuns(e).find(([p, q]) => q - p > 40 && p > 20 && q < e.len - 20);
    const along = (a + b) / 2, m = pointAt(e.pts, along), deckZ = roadHeightAt(e, along);
    const spec = vehicleById('exe-two-tonner') ?? vehicleById('tourer');
    const car = createVehicle(spec ?? { length: 4.2, width: 1.7, rearOverhang: 0.9, mass: 1200 });
    // drive towards the left-hand parapet from the middle of the road, square on
    const nx = Math.sin(m.angle), ny = -Math.cos(m.angle);
    car.heading = Math.atan2(ny, nx);
    car.x = m.x + nx * (railOffset(edgeWidth(e, YEAR)) - 3.5); car.y = m.y + ny * (railOffset(edgeWidth(e, YEAR)) - 3.5);
    car.speed = 13.4;
    car.z = deckZ;
    const near = railsNear(world, car.x, car.y, 14, YEAR).filter(r => railTouches(r, car.z));
    assert.ok(near.length > 0);
    let impact = 0;
    for (let i = 0; i < 40; i++) {
        car.x += Math.cos(car.heading) * car.speed * 0.05; car.y += Math.sin(car.heading) * car.speed * 0.05;
        for (const r of railsNear(world, car.x, car.y, 14, YEAR)) if (railTouches(r, car.z)) impact = Math.max(impact, collideVehicle(car, r.box));
    }
    assert.ok(impact > 5, `impact ${impact.toFixed(1)} m/s`);
    assert.ok(Math.abs(car.speed) < 1, 'the car is stopped');
    // the same position, 6 m lower (the road below the deck): the rail is another layer
    assert.ok(near.every(r => !railTouches(r, deckZ - 6.1)), 'a vehicle on the road below never touches the parapet above');
});

test('parapet colliders never trap a vehicle driving in its lane along straight bridges, or on the road below them', () => {
    let drives = 0, hits = 0;
    for (const e of E) {
        if (!open(e) || e.len < 25) continue;
        for (const [a0, b0] of deckRuns(e)) {
            if (b0 - a0 < 15) continue;
            // straight stretches only (the baked decks sometimes bend at their ends, which pinches the rail inside the bend)
            const a = Math.max(0, a0 - 30), b = Math.min(e.len, b0 + 30);
            let turn = 0;
            for (let d = a; d < b - 4; d += 4) { const p = pointAt(e.pts, d).angle, q = pointAt(e.pts, d + 4).angle; turn = Math.max(turn, Math.abs(Math.atan2(Math.sin(q - p), Math.cos(q - p)))); }
            if (turn >= 0.05) continue;
            for (const rig of RIGS) for (const forward of [true, false]) {
                const r = railHitsAlong(world, e, a, b, { forward, rig, step: 2 });
                drives++;
                // a road's own parapets never trap its traffic; the few touches are interchange decks laid side by side by the bake
                assert.equal(r.hits.filter(h => h.rail.edge === e).length, 0, `edge ${e.id} ${rig.name} ${forward ? 'a>b' : 'b>a'} touched its own parapet at ${r.hits[0]?.along.toFixed(0)} m`);
                if (r.hits.length) hits++;
            }
        }
    }
    assert.ok(drives >= 150, `${drives} drives`);
    assert.ok(hits <= 0.05 * drives, `${hits} of ${drives} drives touched a neighbouring deck's parapet`);
    // driving the lower road of every overpass: the rails above are another layer
    let under = 0;
    for (const c of overpasses.slice(0, 60)) {
        const L = E[c.lower.edge];
        for (const rig of RIGS) {
            const r = railHitsAlong(world, L, Math.max(0, c.lower.d - 40), Math.min(L.len, c.lower.d + 40), { forward: true, rig, step: 2 });
            assert.equal(r.hits.filter(h => h.rail.edge === E[c.upper.edge]).length, 0, `lower road ${L.id} under ${c.upper.edge}`);
            under++;
        }
    }
    assert.ok(under >= 80);
});

test('camera: the ground a vehicle is on is not the deck above it; a deck above blocks the boom, one under the vehicle does not', () => {
    const c = overpasses.find(o => E[o.upper.edge].cls !== 'lane' && E[o.lower.edge].len > 60);
    const L = E[c.lower.edge], U = E[c.upper.edge];
    const lowerZ = roadHeightAt(L, c.lower.d), deckZ = roadHeightAt(U, c.upper.d);
    const tops = decksAt(world, c.x, c.y);
    assert.ok(tops.some(t => Math.abs(t - deckZ) < 0.5), 'the deck is found over the crossing');
    // a vehicle on the lower road: the camera's ground there is the road, not the deck 6 m above
    assert.ok(cameraGroundZ(world, c.x, c.y, lowerZ) < lowerZ + 1.5);
    // a camera boom from the lower road straight up is stopped by the slab; from the deck it is not
    const blocked = (x, y, z, look) => {
        const base = look[2] - 1.2;
        for (const top of decksAt(world, x, y)) {
            if (Math.abs(top - base) < 1.5) continue;
            if (top > base && z > top - SLAB - 0.6 && z < top + 1.4) return true;
        }
        return false;
    };
    const under = { look: [c.x, c.y, lowerZ + 1.2], eye: [c.x, c.y, lowerZ + 25] };
    clearSolids(under, () => -Infinity, 1.2, 0.1, blocked);
    assert.ok(under.eye[2] < deckZ - SLAB, `eye at ${(under.eye[2] - lowerZ).toFixed(1)} m over the road, deck at ${(deckZ - lowerZ).toFixed(1)}`);
    const over = { look: [c.x, c.y, deckZ + 1.2], eye: [c.x, c.y, deckZ + 25] };
    clearSolids(over, () => -Infinity, 1.2, 0.1, blocked);
    assert.ok(Math.abs(over.eye[2] - (deckZ + 25)) < 1e-6, 'a vehicle on the deck keeps its camera');
});

test('camera: over a tunnel the ground to clear is the road floor', () => {
    const e = E.find(x => open(x) && tunnelRuns(x).some(([a, b]) => b - a > 12));
    const [a, b] = tunnelRuns(e).find(([p, q]) => q - p > 12);
    const m = pointAt(e.pts, (a + b) / 2), z = roadHeightAt(e, (a + b) / 2);
    assert.ok(tunnelFloorNear(world, m.x, m.y, 3) !== null);
    assert.ok(cameraGroundZ(world, m.x, m.y, z) <= z + 1e-6);
});

test('plan views draw bridges over the roads below and tunnels under them', () => {
    const up = overpasses[0], U = E[up.upper.edge], L = E[up.lower.edge];
    assert.equal(drawLevel(U), 1);
    assert.equal(drawLevel(L) <= 0, true);
    const tunnel = E.find(x => x.underGround);
    assert.equal(drawLevel(tunnel), tunnel.zones.some(z => z.kind === 'deck') ? 1 : -1);
});

test('abutments and piers are solid from the bed to the slab, stand clear of every carriageway, and are another layer from the deck', () => {
    let supports = 0;
    for (const c of overpasses.slice(0, 40)) {
        const U = E[c.upper.edge];
        const m = pointAt(U.pts, c.upper.d);
        for (const r of railsNear(world, m.x, m.y, 60, YEAR).filter(s => s.edge === U && s.kind !== 'rail')) {
            supports++;
            assert.ok(r.z1 - r.z0 >= 0.4, 'a support has height');
            assert.ok(!railTouches(r, r.z1 + 1.5), 'a vehicle on the deck above it never touches it');
            for (const sg of graph.index.near(r.box.x, r.box.y, 15)) {
                const o = E[sg.edge];
                if (o === U || o.cls === 'ferry' || !edgeOpen(o, YEAR)) continue;
                assert.ok(closestOnPoly(o.pts, r.box.x, r.box.y).d > edgeWidth(o, YEAR) / 2 - 0.3, `a ${r.kind} of edge ${U.id} stands in the carriageway of ${o.id}`);
            }
        }
    }
    assert.ok(supports > 10, `${supports} supports`);
});

test('the 3D route ribbon under an overpass stays on the road beneath, not on the deck above', async () => {
    const { buildRouteMesh } = await import('../../Games.Client/wwwroot/games/delivery-driver/render/gl/prop-mesh.js');
    let checked = 0;
    for (const c of overpasses.slice(0, 40)) {
        const L = E[c.lower.edge], U = E[c.upper.edge];
        const deck = roadHeightAt(U, c.upper.d);
        const low = roadHeightAt(L, c.lower.d);
        if (deck - low < 4) continue;
        const mesh = buildRouteMesh(world, L.pts, c.x, c.y, 60, 3, roadHeightAt(L, Math.max(0, c.lower.d - 50)));
        if (!mesh) continue;
        for (let i = 0; i < mesh.positions.length / 3; i++) {
            const x = mesh.positions[i * 3], y = mesh.positions[i * 3 + 1], z = mesh.positions[i * 3 + 2];
            if (Math.hypot(x - c.x, y - c.y) < 8) { assert.ok(z < low + 2, `ribbon at ${z.toFixed(1)} m under a deck at ${deck.toFixed(1)} (road ${low.toFixed(1)})`); checked++; }
        }
    }
    assert.ok(checked > 10, `${checked} ribbon vertices under decks`);
});
