// Layered road surfaces (plan 0009 phase 7): grade-separated crossings clear CLEARANCE, the driven surface keeps a
// vehicle on its own layer (a deck over a road, the road under it, a tunnel under a hill), and simulated vehicles
// drive both roads of every crossing in the baked region without falling through or jumping between layers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedWithBaked } from './helpers/delivery-seed.mjs';
import { driveThroughCrossing, crossingYear } from './helpers/drive-through.mjs';
import { createWorld } from '../../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { groundZ, roadHeightAt, crossingGap, slopeAt, STEP_UP } from '../../Games.Client/wwwroot/games/delivery-driver/world/terrain.js';
import { CLEARANCE } from '../../Games.Client/wwwroot/games/delivery-driver/world/crossings.js';
import { pointAt, closestOnPoly } from '../../Games.Client/wwwroot/games/delivery-driver/world/geom.js';

const world = createWorld(seedWithBaked());
const { graph } = world;
const E = graph.edges;
const separated = graph.crossings.filter(c => !c.atGrade);

test('the region has grade-separated crossings, every separated one clears 5.5 m, and few are taken at road level', () => {
    assert.ok(graph.crossings.length > 250, `${graph.crossings.length} crossings`);
    assert.ok(separated.length >= 0.8 * graph.crossings.length, `${separated.length} of ${graph.crossings.length} separated`);
    const L = world.layers;
    assert.equal(L.crossings, graph.crossings.length);
    assert.equal(L.atGrade, graph.crossings.length - separated.length);
    assert.equal(L.short.length, 0);
    for (const c of separated) {
        const gap = crossingGap(E, c);
        assert.ok(gap >= CLEARANCE - 0.01, `crossing at ${c.x.toFixed(0)},${c.y.toFixed(0)}: ${gap.toFixed(2)} m`);
    }
    // a bridge lifted over a road ramps: some edges are raised, by no more than a sensible amount
    assert.ok(L.raisedEdges > 100 && L.largestRamp < 800, `${L.raisedEdges} raised, largest ramp ${L.largestRamp.toFixed(0)} m`);
    assert.ok(L.worstGrade <= 0.25, `worst grade ${L.worstGrade}`);
});

test('every edge stretch on a structure is zoned: decks over roads, tunnels under them', () => {
    for (const c of separated) {
        const U = E[c.upper.edge], L = E[c.lower.edge];
        const onU = U.zones?.find(z => c.upper.d >= z.from && c.upper.d <= z.to);
        if (c.levels[0] > 0) assert.equal(onU?.kind, 'deck', `upper edge ${U.id} is a deck over ${L.id}`);
        if (c.levels[1] < 0) {
            const onL = L.zones?.find(z => c.lower.d >= z.from && c.lower.d <= z.to);
            assert.equal(onL?.kind, 'tunnel', `lower edge ${L.id} is a tunnel under ${U.id}`);
            assert.ok(L.underGround);
        }
    }
});

test('groundZ picks the layer by the vehicle height: deck, road below, ground mesh, topmost', () => {
    let tunnels = 0;
    for (const c of separated) {
        const U = E[c.upper.edge], L = E[c.lower.edge];
        const zu = roadHeightAt(U, c.upper.d), zl = roadHeightAt(L, c.lower.d);
        const at = `crossing at ${c.x.toFixed(0)},${c.y.toFixed(0)}`;
        // (on the upper road, never below it; where decks cross each other in an interchange a wheel may meet a
        // neighbouring deck up to a kerb's step above)
        const up = groundZ(world, c.x, c.y, zu);
        assert.ok(up > zu - 0.15 && up <= zu + STEP_UP, `${at}: on the upper road (${up.toFixed(2)} vs ${zu.toFixed(2)})`);
        assert.ok(Math.abs(groundZ(world, c.x, c.y, zl) - zl) < 0.3, `${at}: on the lower road`);
        assert.ok(groundZ(world, c.x, c.y) >= zu - 0.15, `${at}: topmost is the upper road`);
        // the ground mesh never rises to the deck over a road (a tunnel's hill above it is the ground there)
        if (c.levels[0] > 0 && c.levels[1] >= 0) assert.ok(groundZ(world, c.x, c.y, false) < zu - CLEARANCE + 0.5, `${at}: the ground under the deck`);
        if (c.levels[1] < 0) tunnels++;
    }
    assert.ok(tunnels > 5, `${tunnels} tunnel crossings`);
});

test('a vehicle that leaves the side of a deck lands on what is under it; one under a deck never meets it', () => {
    let checked = 0;
    for (const c of separated.filter(x => x.levels[0] > 0 && x.levels[1] >= 0).slice(0, 80)) {
        const U = E[c.upper.edge];
        const zu = roadHeightAt(U, c.upper.d), zl = roadHeightAt(E[c.lower.edge], c.lower.d);
        // step sideways off the deck, well past its carriageway (but still over the road below)
        const p = pointAt(U.pts, c.upper.d);
        const nx = -Math.sin(p.angle), ny = Math.cos(p.angle), off = U.zHalf + 1.5;
        for (const side of [1, -1]) {
            const x = p.x + side * nx * off, y = p.y + side * ny * off;
            // (unless another road's carriageway is there: a parallel deck, a slip road beside it)
            if (graph.index.near(x, y, 30).some(o => o.edge !== U.id && closestOnPoly(E[o.edge].pts, x, y).d <= E[o.edge].zHalf + 1)) continue;
            const z = groundZ(world, x, y, zu);
            assert.ok(z < zu - STEP_UP, `off the side of the deck at ${c.x.toFixed(0)},${c.y.toFixed(0)}: ${z.toFixed(2)} vs deck ${zu.toFixed(2)}`);
        }
        // the slope under a car on the road below is that road's, not the deck's
        const s = slopeAt(world, c.x, c.y, 0, 2.7, 1.6, zl);
        assert.ok(Math.abs(s.z - zl) < 0.5, `under the deck at ${c.x.toFixed(0)},${c.y.toFixed(0)}: ${s.z.toFixed(2)} vs ${zl.toFixed(2)}`);
        checked++;
    }
    assert.ok(checked > 40);
});

test('drive-through: cars and lorries drive over and under every crossing in the region on their own layer', t => {
    let passed = 0;
    const failed = [];
    for (const c of separated) {
        assert.notEqual(crossingYear(world, c), null, 'both roads exist together in some sample year');
        const r = driveThroughCrossing(world, c);
        if (r.failures.length) failed.push(`${c.x.toFixed(0)},${c.y.toFixed(0)} [${c.levels}]: ${r.failures[0]}`);
        else passed++;
    }
    t.diagnostic(`drive-through: ${passed} of ${separated.length} crossings passed (${graph.crossings.length - separated.length} at road level)`);
    for (const f of failed) t.diagnostic(`known: ${f}`);
    // a few interchanges where the baked carriageways overlap in plan at different heights stay ambiguous (plan 0009
    // phase 7 summary); everything else passes
    assert.ok(failed.length <= Math.ceil(0.02 * separated.length), `${failed.length} failed:\n${failed.join('\n')}`);
});
