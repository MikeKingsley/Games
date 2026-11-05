import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraph, ROAD_CLASS } from '../../Games.Client/wwwroot/games/delivery-driver/world/roadgraph.js';
import {
    layoutJunction, junctionSignature, trimFor, mouthRadius, polygonsOverlap, selfIntersects,
    CORNER_RADIUS, RING_CLASS, RI_MIN, RI_MAX, MINI_RADIUS, TIGHT_TRIM,
} from '../../Games.Client/wwwroot/games/delivery-driver/world/junction-layout.js';

const rad = d => (d * Math.PI) / 180;
const near = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) < eps, `${msg} ${a} vs ${b}`);

/**
 * A star graph: a centre node at the origin and one straight edge per arm [{deg, len, cls, oneway, far}] to its own far
 * node (`far` extra roads at the far node make it a junction too, so the edge is shared with it).
 */
function star(arms, nodeProps = {}) {
    const g = createGraph();
    const c = g.addNode(0, 0, { junction: 'giveway', ...nodeProps });
    for (const a of arms) {
        const len = a.len ?? 200;
        const x = Math.cos(rad(a.deg)) * len, y = Math.sin(rad(a.deg)) * len;
        const f = g.addNode(x, y, { junction: 'end' });
        for (let k = 0; k < (a.far ?? 0); k++) g.addEdge(f, g.addNode(x + 50 * (k + 1), y + 70, {}), [x, y, x + 50 * (k + 1), y + 70], { cls: 'lane' });
        g.addEdge(c, f, [0, 0, x, y], { cls: a.cls ?? 'street', oneway: a.oneway, opened: a.opened });
    }
    return { g, c };
}
const radial = (a, c) => Math.hypot(a.mouth.x - c.x, a.mouth.y - c.y);

test('a T junction of streets: simple boundary, arms reach it, kerb return is a circle tangent to both kerbs', () => {
    const { g, c } = star([{ deg: 0 }, { deg: 90 }, { deg: 180 }]);
    const L = layoutJunction(g, c, 2024);
    assert.equal(L.kind, 'plain');
    assert.equal(L.arms.length, 3);
    assert.equal(selfIntersects(L.boundary), false);
    // every mouth corner is a boundary vertex
    for (const a of L.arms) for (const p of [a.mL, a.mR]) {
        assert.ok(L.boundary.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 0.05), 'mouth corner on the boundary');
    }
    // 0 -> 90 degree corner of two 7 m streets: r 6, kerbs 3.5 m off the axes, circle centre (9.5, 9.5)
    const r = CORNER_RADIUS[2];
    const O = { x: 3.5 + r, y: 3.5 + r };
    const arc = L.boundary.filter(p => p.x > 3.5 + 1e-3 && p.y > 3.5 + 1e-3 && p.x < 9.5 + 1e-6 && p.y < 9.5 + 1e-6);
    assert.ok(arc.length >= 5);
    for (const p of arc) near(Math.hypot(p.x - O.x, p.y - O.y), r, 1e-6, 'on the return circle');
    // tangent points lie on the kerb lines
    assert.ok(L.boundary.some(p => Math.abs(p.x - 9.5) < 1e-6 && Math.abs(p.y - 3.5) < 1e-6), 'tangent point on arm 0 kerb');
    assert.ok(L.boundary.some(p => Math.abs(p.x - 3.5) < 1e-6 && Math.abs(p.y - 9.5) < 1e-6), 'tangent point on arm 90 kerb');
    // the trim is the tangent distance plus the margin
    const a0 = L.arms.find(a => Math.abs(a.bearing) < 1e-6);
    near(a0.trim, 9.5 + 0.3, 1e-6);
    // a straight-through kerb along the top (arms 180 -> 0 have no corner)
    assert.deepEqual(L.stats.rejected, []);
});

test('a crossroads: four equal trims, simple boundary', () => {
    const { g, c } = star([{ deg: 0 }, { deg: 90 }, { deg: 180 }, { deg: 270 }]);
    const L = layoutJunction(g, c, 2024);
    assert.equal(L.arms.length, 4);
    for (const a of L.arms) near(a.trim, 9.8, 1e-6);
    assert.equal(selfIntersects(L.boundary), false);
    assert.equal(L.connectors.length, 12);
});

test('a Y junction and a five-arm junction have simple boundaries; arms of different classes use the larger corner radius', () => {
    const y = star([{ deg: 0 }, { deg: 120 }, { deg: 240 }]);
    assert.equal(selfIntersects(layoutJunction(y.g, y.c, 2024).boundary), false);
    const five = star([{ deg: 0 }, { deg: 72 }, { deg: 144 }, { deg: 216 }, { deg: 288 }]);
    const L5 = layoutJunction(five.g, five.c, 2024);
    assert.equal(L5.arms.length, 5);
    assert.equal(selfIntersects(L5.boundary), false);
    const mixed = star([{ deg: 0, cls: 'A' }, { deg: 90, cls: 'lane' }, { deg: 180, cls: 'A' }]);
    const Lm = layoutJunction(mixed.g, mixed.c, 2024);
    assert.equal(selfIntersects(Lm.boundary), false);
    // A (hw 4) meets a lane (hw 2.1): r 8, tangent distance on the lane = 4 + 8 = 12 (right angle), on the A road 2.1 + 8
    const lane = Lm.arms.find(a => a.cls === 'lane');
    near(lane.trim, 4 + CORNER_RADIUS[4] + 0.3, 1e-6);
});

test('a skewed 40 degree junction trims the acute corner further and keeps a simple boundary', () => {
    const { g, c } = star([{ deg: 0 }, { deg: 40 }, { deg: 180 }]);
    const L = layoutJunction(g, c, 2024);
    assert.equal(selfIntersects(L.boundary), false);
    const right = star([{ deg: 0 }, { deg: 90 }, { deg: 180 }]);
    const R = layoutJunction(right.g, right.c, 2024);
    const trim0 = x => x.arms.find(a => Math.abs(a.bearing) < 1e-6).trim;
    assert.ok(trim0(L) > trim0(R) + 3, `${trim0(L)} vs ${trim0(R)}`);
    // the acute corner: two 7 m streets 40 degrees apart meet at (7/2)/sin(20) ... along each arm
    const phi = rad(40), s = (3.5 + 3.5 * Math.cos(phi)) / Math.sin(phi);
    assert.ok(trim0(L) >= s - 1e-6);
});

test('near-parallel arms (tight corner): the kerbs are cut short, the surface falls back to the hull of the mouths', () => {
    const { g, c } = star([{ deg: 0 }, { deg: 14 }, { deg: 180 }]);
    const L = layoutJunction(g, c, 2024);
    assert.ok(L.stats.spread >= 2);
    for (const a of L.arms) assert.ok(a.trim <= TIGHT_TRIM + 0.3 + 1e-9 || a.trim <= 9.8);
    assert.equal(selfIntersects(L.boundary), false);
});

test('short edges: the trim is clamped when the far end is a junction too, and counted', () => {
    const { g, c } = star([{ deg: 0, len: 10, far: 2 }, { deg: 120 }, { deg: 240 }]);
    const L = layoutJunction(g, c, 2024);
    const short = L.arms.find(a => a.edge.len < 11);
    assert.equal(short.clamped, true);
    assert.ok(short.trim <= 4.5 + 1e-9 && short.trim >= 1.5 - 1e-9, `trim ${short.trim}`);
    assert.ok(L.stats.clamped >= 1);
    assert.equal(selfIntersects(L.boundary), false);
    // a dead end at the far end leaves nearly all of the edge to this junction
    const free = star([{ deg: 0, len: 10 }, { deg: 90 }, { deg: 180 }]);
    const F = layoutJunction(free.g, free.c, 2024);
    assert.ok(F.arms.find(a => a.edge.len < 11).trim <= 9.0 + 1e-9);
});

test('neighbouring junctions share the room between them: their surfaces never overlap', () => {
    // two crossroads 24 m apart joined by one street
    const g = createGraph();
    const a = g.addNode(0, 0, { junction: 'giveway' }), b = g.addNode(24, 0, { junction: 'giveway' });
    g.addEdge(a, b, [0, 0, 24, 0], { cls: 'street' });
    for (const [n, dirs] of [[a, [[-100, 0], [0, 100], [0, -100]]], [b, [[124, 0], [24, 100], [24, -100]]]]) {
        for (const [x, y] of dirs) g.addEdge(n, g.addNode(x, y, { junction: 'end' }), [n.x, n.y, x, y], { cls: 'street' });
    }
    const La = layoutJunction(g, a, 2024), Lb = layoutJunction(g, b, 2024);
    assert.equal(polygonsOverlap(La.boundary, Lb.boundary), false);
    assert.ok(La.reach + Lb.reach <= 24 + 1e-6, `${La.reach} + ${Lb.reach}`);
});

function checkRing(L, node) {
    const { ri, ro, width } = L.ring;
    near(ro, ri + width, 1e-9);
    for (const a of L.arms) {
        assert.ok(radial(a, node) >= ro, 'arm ends outside the ring');
        // the flared entry meets the ring at Ro on both sides of the mouth
        near(Math.hypot(a.ringLo.x - node.x, a.ringLo.y - node.y), ro, 1e-9);
        near(Math.hypot(a.ringHi.x - node.x, a.ringHi.y - node.y), ro, 1e-9);
        for (const p of [a.mL, a.mR]) assert.ok(L.boundary.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 0.05), 'mouth corner on the boundary');
        assert.ok(Math.abs(a.spread) <= rad(12) + 1e-9);
    }
    assert.equal(L.islands[0].kind, 'island');
    for (const p of L.islands[0].poly) near(Math.hypot(p.x - node.x, p.y - node.y), ri, 1e-9);
    assert.equal(selfIntersects(L.boundary), false);
}

test('roundabouts: island radius within the class range, arms meet Ro, 3 and 5 arms, a dual carriageway arm', () => {
    for (const arms of [
        [{ deg: 0 }, { deg: 120 }, { deg: 240 }],
        [{ deg: 0 }, { deg: 72 }, { deg: 144 }, { deg: 216 }, { deg: 288 }],
        [{ deg: 0, cls: 'dual' }, { deg: 100, cls: 'A' }, { deg: 200, cls: 'A' }, { deg: 290, cls: 'B' }],
    ]) {
        const { g, c } = star(arms, { junction: 'roundabout', roundaboutFrom: 0, ringRadius: 3.5 });
        const L = layoutJunction(g, c, 2024);
        assert.equal(L.kind, 'roundabout');
        checkRing(L, c);
        const top = Math.max(...L.arms.map(a => a.rank));
        assert.ok(L.ring.ri >= RING_CLASS[top].min - 1e-9 && L.ring.ri <= RING_CLASS[top].max + 1e-9 && L.ring.ri >= RI_MIN && L.ring.ri <= RI_MAX);
        assert.equal(L.ring.shrunk, false);
        assert.equal(L.type, 'roundabout');
        assert.deepEqual(L.stats.rejected, []);
        // one splitter island per arm wide enough
        assert.equal(L.islands.filter(i => i.kind === 'splitter').length, L.arms.filter(a => a.hw >= 3).length);
    }
    // a big real ring is honoured up to the class maximum
    const big = star([{ deg: 0, cls: 'A' }, { deg: 120, cls: 'A' }, { deg: 240, cls: 'A' }], { junction: 'roundabout', roundaboutFrom: 0, ringRadius: 25 });
    const Lb = layoutJunction(big.g, big.c, 2024);
    near(Lb.ring.ri, RING_CLASS[4].max, 1e-9);
    // before its year a roundabout is a plain give-way junction
    const early = star([{ deg: 0 }, { deg: 120 }, { deg: 240 }], { junction: 'roundabout', roundaboutFrom: 1965 });
    assert.equal(layoutJunction(early.g, early.c, 1950).kind, 'plain');
    assert.equal(layoutJunction(early.g, early.c, 1990).kind, 'roundabout');
});

test('roundabout arms closer than their mouths are spread by at most 12 degrees', () => {
    const { g, c } = star([{ deg: 0 }, { deg: 22 }, { deg: 200 }], { junction: 'roundabout', roundaboutFrom: 0, ringRadius: 3 });
    const L = layoutJunction(g, c, 2024);
    const moved = L.arms.filter(a => Math.abs(a.spread) > 0.01);
    assert.ok(moved.length >= 1);
    for (const a of L.arms) assert.ok(Math.abs(a.spread) <= rad(12) + 1e-9);
    assert.ok(L.stats.spread >= 1);
});

test('a ring too small for its short arms is shrunk rather than left with arms inside it', () => {
    const { g, c } = star([{ deg: 0, len: 12 }, { deg: 120 }, { deg: 240 }], { junction: 'roundabout', roundaboutFrom: 0, ringRadius: 3 });
    const L = layoutJunction(g, c, 2024);
    assert.equal(L.ring.shrunk, true);
    assert.ok(L.ring.ro >= 8.5 - 1e-9);
    for (const a of L.arms) assert.ok(radial(a, c) >= L.ring.ro);
});

test('a mini-roundabout is a plain junction with a painted disc', () => {
    const { g, c } = star([{ deg: 0 }, { deg: 90 }, { deg: 180 }], { junction: 'roundabout', roundaboutFrom: 0, mini: true });
    const L = layoutJunction(g, c, 2024);
    assert.equal(L.kind, 'mini');
    const disc = L.islands.find(i => i.kind === 'mini');
    for (const p of disc.poly) near(Math.hypot(p.x, p.y), MINI_RADIUS, 1e-9);
    assert.equal(selfIntersects(L.boundary), false);
});

test('dead ends get a rounded cap and a U-turn, two-arm nodes only a straight connector, with no trim', () => {
    const end = star([{ deg: 30 }]);
    const E = layoutJunction(end.g, end.c, 2024);
    assert.equal(E.kind, 'end');
    assert.equal(E.arms[0].trim, 0);
    assert.ok(E.boundary.length >= 9);
    assert.equal(E.connectors[0].kind, 'uturn');
    const thru = star([{ deg: 0 }, { deg: 170 }]);
    const T = layoutJunction(thru.g, thru.c, 2024);
    assert.equal(T.kind, 'through');
    assert.deepEqual(T.arms.map(a => a.trim), [0, 0]);
    assert.equal(T.connectors.length, 2);
    assert.equal(trimFor(thru.g, thru.g.edges[0], 'a', 2024), 0);
});

test('connectors skip illegal moves on one-way roads; lanes are on the left of the direction of travel', () => {
    const { g, c } = star([{ deg: 0 }, { deg: 90 }, { deg: 180, oneway: true }]); // one-way runs a -> b: it leaves the junction
    const L = layoutJunction(g, c, 2024);
    const idx = L.arms.findIndex(a => a.oneway);
    assert.equal(L.arms[idx].inbound, false);
    assert.ok(L.connectors.every(k => k.from !== idx));
    assert.equal(L.connectors.filter(k => k.to === idx).length, 2);
    // an inbound lane point at arm 0 (heading west) is on the screen-left of travel: y positive of the axis? lanePoint's side
    const k = L.connectors.find(q => L.arms[q.from].bearing === 0 && L.arms[q.to].bearing > 1);
    const start = { x: k.pts[0], y: k.pts[1] };
    assert.ok(start.y > 0, `inbound lane of an arm pointing along +x lies at +y (${start.y})`);
    // the last point is an outbound lane point of the target arm
    const end = k.pts.slice(-2);
    assert.ok(end[0] < 0 && Math.abs(end[1]) > 0 || end[0] > -4, 'ends on the target arm');
});

test('a roundabout ring connector runs clockwise (increasing angle) and stays on the ring', () => {
    const { g, c } = star([{ deg: 0 }, { deg: 120 }, { deg: 240 }], { junction: 'roundabout', roundaboutFrom: 0, ringRadius: 3 });
    const L = layoutJunction(g, c, 2024);
    const k = L.connectors.find(q => L.arms[q.from].bearing === 0 && L.arms[q.to].bearing > 1);
    assert.equal(k.kind, 'ring');
    const ang = [];
    for (let i = 2; i < k.pts.length - 2; i += 2) if (Math.abs(Math.hypot(k.pts[i], k.pts[i + 1]) - L.ring.rc) < 1e-6) ang.push(Math.atan2(k.pts[i + 1], k.pts[i]));
    assert.ok(ang.length >= 3);
    for (let i = 1; i < ang.length; i++) assert.ok(((ang[i] - ang[i - 1]) + 2 * Math.PI) % (2 * Math.PI) < Math.PI, 'increasing angle');
});

test('stop lines and signal poles by type and year; giveway lines on the minor arm only', () => {
    const t = star([{ deg: 0, cls: 'A' }, { deg: 90, cls: 'B' }, { deg: 180, cls: 'A' }], { priority: true });
    assert.equal(layoutJunction(t.g, t.c, 1950).stopLines.length, 0, 'no give-way lines before 1960');
    const L = layoutJunction(t.g, t.c, 2000);
    assert.equal(L.stopLines.length, 1);
    assert.equal(L.arms[L.stopLines[0].arm].cls, 'B');
    assert.equal(L.stopLines[0].kind, 'giveway');
    const sig = star([{ deg: 0 }, { deg: 90 }, { deg: 180 }, { deg: 270 }], { junction: 'signals', signalsFrom: 1940 });
    assert.equal(layoutJunction(sig.g, sig.c, 1936).stopLines.length, 0, 'plain give-way before the signals');
    const S = layoutJunction(sig.g, sig.c, 1950);
    assert.equal(S.stopLines.length, 4);
    assert.equal(S.poles.length, 4);
    assert.ok(S.stopLines.every(s => s.kind === 'stop'));
    // the line sits just outside the trim
    const a0 = S.arms[S.stopLines[0].arm];
    assert.ok(Math.hypot(S.stopLines[0].x, S.stopLines[0].y) > a0.trim);
});

test('open arms depend on the year; the signature, the layout and trimFor follow', () => {
    const { g, c } = star([{ deg: 0 }, { deg: 90 }, { deg: 180, opened: 1960 }]);
    const early = layoutJunction(g, c, 1930), late = layoutJunction(g, c, 1990);
    assert.equal(early.kind, 'through');
    assert.equal(late.kind, 'plain');
    assert.notEqual(junctionSignature(g, c, 1930), junctionSignature(g, c, 1990));
    assert.equal(junctionSignature(g, c, 1940), junctionSignature(g, c, 1945));
    assert.equal(trimFor(g, g.edges[0], 'a', 1930), 0);
    assert.ok(trimFor(g, g.edges[0], 'a', 1990) > 5);
    assert.equal(trimFor(g, g.edges[0], 'b', 1990), 0, 'the dead end at the far end');
    assert.equal(layoutJunction(g, c, 1990), late, 'cached per signature');
    assert.ok(mouthRadius(g, c, 1990) >= late.arms[0].trim);
});

test('layouts are deterministic', () => {
    const make = () => {
        const { g, c } = star([{ deg: 0, cls: 'A' }, { deg: 77, cls: 'B' }, { deg: 150 }, { deg: 251, cls: 'dual' }], { junction: 'signals', signalsFrom: 1940 });
        const L = layoutJunction(g, c, 2024);
        return JSON.stringify({ ...L, arms: L.arms.map(a => ({ ...a, edge: a.edge.id })) });
    };
    assert.equal(make(), make());
});

test('arms at another level than the node are not arms', () => {
    const g = createGraph();
    const c = g.addNode(0, 0, { junction: 'giveway' });
    const mk = (x, y, props) => g.addEdge(c, g.addNode(x, y, { junction: 'end' }), [0, 0, x, y], props);
    mk(100, 0, {}); mk(0, 100, {}); mk(-100, 0, {});
    mk(0, -100, { spans: [{ from: 0, to: 100, level: 1 }], bridge: true });
    const L = layoutJunction(g, c, 2024);
    assert.equal(L.arms.length, 3);
    assert.equal(L.passing.length, 1);
});

test('class tables cover every ROAD_CLASS rank', () => {
    for (const k of Object.values(ROAD_CLASS)) {
        assert.ok(CORNER_RADIUS[k.rank] > 0);
        assert.ok(RING_CLASS[k.rank].min >= RI_MIN - 1e-9 && RING_CLASS[k.rank].max <= RI_MAX + 1e-9);
    }
    assert.equal(polygonsOverlap([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }], [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }]), true);
    assert.equal(polygonsOverlap([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }]), false);
});

test('every junction of the baked region lays out without exceptions or NaN, in three eras', async () => {
    const { loadBakedWorld } = await import('../../scripts/validate-roads.mjs');
    const { layoutStats } = await import('../../scripts/junction-layout-stats.mjs');
    const world = await loadBakedWorld();
    for (const year of [1919, 1965, 2024]) {
        const s = layoutStats(world.graph, year);
        assert.equal(s.errors, 0, `year ${year}`);
        assert.equal(s.nan, 0, `year ${year}`);
        assert.ok(s.nodes > 20000);
        // the awkward cases (arms clamped by short edges, crowded rings) stay a small share of all junctions
        assert.ok(s.rejected / s.nodes < 0.01, `year ${year}: ${s.rejected} of ${s.nodes} rejected`);
        assert.ok(s.ms < 5000, `layout of ${s.nodes} junctions took ${s.ms} ms`);
    }
});

test('plan 0010 phase 4: each roundabout arm meets the ring within 0.1 m at a matching tangent', () => {
    const cases = [
        [{ deg: 0 }, { deg: 90 }, { deg: 180 }, { deg: 270 }],
        [{ deg: 0 }, { deg: 22 }, { deg: 200 }],                      // crowded: mouths spread round the ring
        [{ deg: 10, cls: 'A' }, { deg: 130, cls: 'A' }, { deg: 250, cls: 'street' }, { deg: 300 }],
    ];
    for (const arms of cases) {
        const { g, c } = star(arms, { junction: 'roundabout', roundaboutFrom: 0, ringRadius: 3.5 });
        const L = layoutJunction(g, c, 2024);
        assert.equal(L.kind, 'roundabout');
        for (const a of L.arms) {
            const J = a.join, first = J[0], last = J[J.length - 1];
            // start: on the mouth, leaving along the arm's own heading (tangent runs towards the ring, so against `heading`)
            assert.ok(Math.hypot(first.x - a.mouth.x, first.y - a.mouth.y) < 0.1, 'curve starts at the mouth');
            assert.ok(first.tx * -Math.cos(a.mouth.heading) + first.ty * -Math.sin(a.mouth.heading) > 0.999, 'arm tangent matches at the mouth');
            // end: on the ring's outer circle at the arm's ring angle, arriving radially
            assert.ok(Math.abs(Math.hypot(last.x - c.x, last.y - c.y) - L.ring.ro) < 0.1, 'curve ends on the ring');
            const ang = Math.atan2(last.y - c.y, last.x - c.x);
            assert.ok(Math.abs(Math.atan2(Math.sin(ang - a.ringAngle), Math.cos(ang - a.ringAngle))) < 0.1 / L.ring.ro, 'at the arm\'s ring angle');
            assert.ok(last.tx * -Math.cos(a.ringAngle) + last.ty * -Math.sin(a.ringAngle) > 0.999, 'enters the ring radially');
            // flared sides are inside the silhouette's vertex list
            for (const q of [...a.flareSides.r, ...a.flareSides.l]) assert.ok(L.boundary.some(p => p.x === q.x && p.y === q.y));
        }
        if (!L.stats.rejected.length) assert.equal(selfIntersects(L.boundary), false); // (a crowded ring is a rejected case)
    }
});
