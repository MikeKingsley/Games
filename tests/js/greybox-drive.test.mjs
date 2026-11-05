// Drive-through tests on the greybox test level (plan 0010 phase 7). A real simulated vehicle (sim/vehicle.js stepVehicle)
// follows a path with a pure-pursuit driver over the greybox world (greybox/graph.js), and the tests fail if it falls
// through the overbridge, touches the deck from below, steps in height, or leaves the road surface on the curve and the
// roundabout. The same spec feeds the dev page and scripts/validate-roads.mjs --greybox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGreyboxWorld } from '../../Games.Client/wwwroot/games/delivery-driver/greybox/graph.js';
import { GREYBOX_SPEC, DECK_LIFT } from '../../Games.Client/wwwroot/games/delivery-driver/greybox/spec.js';
import { createVehicle, stepVehicle, steerLimit, bodyCentre } from '../../Games.Client/wwwroot/games/delivery-driver/sim/vehicle.js';
import { VEHICLES, vehicleById } from '../../Games.Client/wwwroot/games/delivery-driver/game/catalogue.js';
import { roadHeightAt, roadGradeAt } from '../../Games.Client/wwwroot/games/delivery-driver/world/terrain.js';
import { halfWidthOf, CLEARANCE, SLAB } from '../../Games.Client/wwwroot/games/delivery-driver/world/crossings.js';
import { closestOnPoly } from '../../Games.Client/wwwroot/games/delivery-driver/world/geom.js';
import { createSpline, sampleEven } from '../../Games.Client/wwwroot/games/delivery-driver/world/road-spline.js';
import { edgeSpline, layoutJunction } from '../../Games.Client/wwwroot/games/delivery-driver/world/junction-layout.js';
import { corners } from '../../Games.Client/wwwroot/games/delivery-driver/sim/collision.js';

const DT = 1 / 60;
const world = buildGreyboxWorld(GREYBOX_SPEC);
const edgeOf = tag => world.graph.edges.find(e => e.tag === tag);
const nodeOf = tag => world.graph.nodes.find(n => n.tag === tag);

/** Dense samples [{x, y}] along a spline through `pts`, every 0.5 m. */
const dense = pts => sampleEven(createSpline(pts), 0.5);
/** Points {x, y} of an edge's flat point list. */
const edgePoints = (e, reverse = false) => {
    const out = [];
    for (let i = 0; i < e.pts.length; i += 2) out.push({ x: e.pts[i], y: e.pts[i + 1] });
    return reverse ? out.reverse() : out;
};

/**
 * Drives `spec` along `path` (dense {x, y} samples) at about `speed` m/s with a pure-pursuit steerer. `ground(x, y)` gives
 * {z, grade} under the rear axle (default flat); `onStep(v, i)` sees every fixed step. Returns the vehicle and step count;
 * throws if the path is not finished in `maxSeconds`.
 */
function drive(spec, path, { speed = 6, look = 6, ground = () => ({ z: 0, grade: 0 }), onStep = () => { }, maxSeconds = 120 } = {}) {
    const dx = path[1].x - path[0].x, dy = path[1].y - path[0].y;
    const v = createVehicle(spec, { x: path[0].x, y: path[0].y, heading: Math.atan2(dy, dx) });
    v.speed = speed;
    let near = 0, steps = 0;
    const end = path.length - 1;
    while (near < end - 1 && steps < maxSeconds / DT) {
        while (near < end && Math.hypot(path[near + 1].x - v.x, path[near + 1].y - v.y) < Math.hypot(path[near].x - v.x, path[near].y - v.y)) near++;
        let t = near;
        while (t < end && Math.hypot(path[t].x - v.x, path[t].y - v.y) < look) t++;
        const alpha = Math.atan2(path[t].y - v.y, path[t].x - v.x) - v.heading;
        const a = Math.atan2(Math.sin(alpha), Math.cos(alpha));
        const delta = Math.atan2(2 * spec.wheelbase * Math.sin(a), look);
        const err = speed - v.speed;
        const g = ground(v.x, v.y);
        stepVehicle(v, { throttle: Math.max(0, Math.min(1, err * 0.5 + 0.2)), brake: Math.max(0, Math.min(1, -err * 0.5)), steer: Math.max(-1, Math.min(1, delta / steerLimit(spec, v.speed))) }, DT, { grade: g.grade, groundZ: g.z });
        onStep(v, steps++);
    }
    assert.ok(near >= end - 1, `${spec.id} did not finish the path in ${maxSeconds} s (stopped at sample ${near} of ${end})`);
    return { v, steps };
}

/** Height and grade of an edge's profile under the rear axle (the vehicle drives that edge's road, not the one below). */
const roadGround = edge => (x, y) => {
    const c = closestOnPoly(edge.pts, x, y);
    return { z: roadHeightAt(edge, c.along), grade: roadGradeAt(edge, c.along) };
};

const RIGS = [vehicleById('dart-3'), VEHICLES.reduce((a, b) => (b.height > a.height ? b : a))];

test('greybox world has the six pieces and the overbridge profile', () => {
    for (const tag of ['straight', 'curve', 'crossroads-0', 'tee-0', 'roundabout-0', 'overbridge-under', 'overbridge-over']) assert.ok(edgeOf(tag), `edge ${tag}`);
    const over = edgeOf('overbridge-over');
    assert.ok(Math.abs(Math.max(...over.z) - DECK_LIFT) < 1e-3, 'deck lifted by DECK_LIFT');
    assert.equal(Math.min(...edgeOf('overbridge-under').z), 0);
    for (const tag of ['crossroads', 'tee', 'roundabout']) assert.ok(nodeOf(tag), `junction node ${tag}`);
});

for (const spec of RIGS) {
    for (const forward of [true, false]) {
        test(`${spec.id} drives over the overbridge ${forward ? 'a to b' : 'b to a'}: stays on the deck, no height jump`, () => {
            const over = edgeOf('overbridge-over');
            const path = dense(edgePoints(over, !forward));
            const ground = roadGround(over);
            const [d0, d1] = over.zones[0].from < over.zones[0].to ? [over.zones[0].from, over.zones[0].to] : [0, 0];
            let peak = -Infinity, worstOff = 0, worstStep = 0, last = null;
            drive(spec, path, {
                speed: 6, ground,
                onStep: v => {
                    const along = closestOnPoly(over.pts, v.x, v.y).along;
                    const road = roadHeightAt(over, along);
                    worstOff = Math.max(worstOff, Math.abs(v.z - road));          // fell through, or floated off, the road
                    if (along > d0 && along < d1) peak = Math.max(peak, v.z);
                    if (last !== null) worstStep = Math.max(worstStep, Math.abs(v.z - last) / Math.max(1e-6, Math.abs(v.speed) * DT));
                    last = v.z;
                },
            });
            assert.ok(worstOff < 0.3, `vehicle left its road surface by ${worstOff.toFixed(2)} m`);
            assert.ok(peak > DECK_LIFT - 0.2, `reached the deck (peak ${peak.toFixed(2)} m)`);
            // the ramp is a 10% grade: a step of the height steeper than that plus a little is a jump
            assert.ok(worstStep < 0.2, `height step ${worstStep.toFixed(3)} m per metre`);
        });

        test(`${spec.id} drives under the overbridge ${forward ? 'a to b' : 'b to a'}: clears the deck, stays level`, () => {
            const under = edgeOf('overbridge-under'), over = edgeOf('overbridge-over');
            const path = dense(edgePoints(under, !forward));
            const ground = roadGround(under);
            // where the roads cross: the closest approach of the over road's points to the under road
            let cross = null;
            for (let d = 0; d <= over.len; d += 0.5) {
                const p = pointOn(over, d), c = closestOnPoly(under.pts, p.x, p.y);
                if (!cross || c.d < cross.gap) cross = { gap: c.d, x: p.x, y: p.y, overAlong: d };
            }
            assert.ok(cross.gap < 0.5, 'the roads cross');
            const underside = roadHeightAt(over, cross.overAlong) - SLAB;
            const reach = halfWidthOf(over) + spec.length;
            let inUnder = 0, worstTop = -Infinity, worstOff = 0;
            drive(spec, path, {
                speed: 6, ground,
                onStep: v => {
                    worstOff = Math.max(worstOff, Math.abs(v.z));
                    if (Math.hypot(v.x - cross.x, v.y - cross.y) < reach) { inUnder++; worstTop = Math.max(worstTop, v.z + spec.height); }
                },
            });
            assert.ok(inUnder > 20, 'the vehicle went under the deck');
            assert.ok(underside >= CLEARANCE - 0.01, `deck underside ${underside.toFixed(2)} m, clearance rule ${CLEARANCE} m`);
            assert.ok(worstTop < underside, `vehicle top ${worstTop.toFixed(2)} m reaches the deck underside ${underside.toFixed(2)} m`);
            assert.ok(worstOff < 0.05, `the road below stayed level (${worstOff.toFixed(3)} m)`);
        });
    }
}

/** Point at distance `d` along an edge's polyline. */
function pointOn(edge, d) {
    let acc = 0;
    for (let i = 2; i < edge.pts.length; i += 2) {
        const len = Math.hypot(edge.pts[i] - edge.pts[i - 2], edge.pts[i + 1] - edge.pts[i - 1]);
        if (acc + len >= d) { const t = (d - acc) / len; return { x: edge.pts[i - 2] + (edge.pts[i] - edge.pts[i - 2]) * t, y: edge.pts[i - 1] + (edge.pts[i + 1] - edge.pts[i - 1]) * t }; }
        acc += len;
    }
    return { x: edge.pts[edge.pts.length - 2], y: edge.pts[edge.pts.length - 1] };
}

/** Largest distance from a body corner to the nearest point of `samples` ({x, y}), over the whole drive. */
function worstCornerGap(spec, path, samples, opts) {
    const box = { x: 0, y: 0, hx: spec.length / 2, hy: spec.width / 2, angle: 0 };
    let worst = 0;
    drive(spec, path, {
        ...opts,
        onStep: v => {
            const c = bodyCentre(v);
            box.x = c.x; box.y = c.y; box.angle = v.heading;
            for (const p of corners(box)) {
                let best = Infinity;
                for (const s of samples) { const d = Math.hypot(s.x - p.x, s.y - p.y); if (d < best) best = d; }
                worst = Math.max(worst, best);
            }
        },
    });
    return worst;
}

for (const spec of RIGS) {
    test(`${spec.id} follows the tight curve without leaving the road surface`, () => {
        const curve = edgeOf('curve');
        const centre = sampleEven(edgeSpline(curve), 0.5);
        const path = centre.map(p => ({ x: p.x, y: p.y }));
        const half = halfWidthOf(curve);
        // the road goes on straight past the ends, so the body overhanging the last sample is not off the road
        const tail = (a, b) => Array.from({ length: 30 }, (_, k) => ({ x: b.x + ((b.x - a.x) / Math.hypot(b.x - a.x, b.y - a.y)) * 0.5 * (k + 1), y: b.y + ((b.y - a.y) / Math.hypot(b.x - a.x, b.y - a.y)) * 0.5 * (k + 1) }));
        const n = path.length;
        const samples = [...tail(path[1], path[0]), ...path, ...tail(path[n - 2], path[n - 1])];
        const worst = worstCornerGap(spec, path, samples, { speed: 5, look: 5 });
        assert.ok(worst < half, `a corner was ${worst.toFixed(2)} m from the centreline, the surface is ${half} m each side`);
    });

    for (const [from, to] of [[180, 270], [90, 0]]) {
        test(`${spec.id} enters the roundabout from the ${from} deg arm and leaves by the ${to} deg arm without leaving the road`, () => {
            const node = nodeOf('roundabout');
            const L = layoutJunction(world.graph, node, GREYBOX_SPEC.year);
            const { rc, ro } = L.ring;
            const ring = a => ({ x: node.x + rc * Math.cos(a), y: node.y + rc * Math.sin(a) });
            const rad = d => (d * Math.PI) / 180;
            const armPts = (deg, from, to, n) => Array.from({ length: n + 1 }, (_, i) => {
                const r = from + ((to - from) * i) / n;
                return { x: node.x + Math.cos(rad(deg)) * r, y: node.y + Math.sin(rad(deg)) * r };
            });
            // clockwise on the page (angle increasing, y down) = the way the greybox's drivers circulate; a short ring
            // run joins the entry arm to the exit arm, entering and leaving along the arms
            const sweep = (((to - from) % 360) + 360) % 360;
            const ringPts = [];
            const mid = 3;
            for (let k = 0; k <= mid; k++) ringPts.push(ring(rad(from + 15 + ((sweep - 30) * k) / mid)));
            const waypoints = [...armPts(from, 90, 40, 4), ...ringPts, ...armPts(to, 40, 90, 4)];
            const path = dense(waypoints);
            // the road surface here: the junction's boundary polygon plus each arm's strip
            const arms = ['roundabout-0', 'roundabout-90', 'roundabout-180', 'roundabout-270'].map(edgeOf);
            const poly = L.boundary;
            const onRoad = p => inside(poly, p) || arms.some(e => closestOnPoly(e.pts, p.x, p.y).d <= halfWidthOf(e));
            const box = { x: 0, y: 0, hx: spec.length / 2, hy: spec.width / 2, angle: 0 };
            let off = null, minR = Infinity, maxR = 0;
            drive(spec, path, {
                speed: 4, look: 5,
                onStep: v => {
                    const c = bodyCentre(v);
                    box.x = c.x; box.y = c.y; box.angle = v.heading;
                    for (const p of corners(box)) {
                        if (!onRoad(p) && !off) off = { x: p.x.toFixed(1), y: p.y.toFixed(1) };
                    }
                    const r = Math.hypot(v.x - node.x, v.y - node.y);
                    if (r < 30) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); }
                },
            });
            assert.equal(off, null, `body corner left the road surface at ${JSON.stringify(off)}`);
            assert.ok(minR > L.ring.ri - 0.5 && maxR <= ro + 20, `stayed round the ring (radius ${minR.toFixed(1)} to ${maxR.toFixed(1)} m)`);
        });
    }
}

/** Even-odd point in polygon; `poly` is [{x, y}, ...] or a flat [x, y, ...] list. */
function inside(poly, p) {
    const pts = typeof poly[0] === 'number' ? Array.from({ length: poly.length / 2 }, (_, i) => ({ x: poly[2 * i], y: poly[2 * i + 1] })) : poly;
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        if ((pts[i].y > p.y) !== (pts[j].y > p.y) && p.x < ((pts[j].x - pts[i].x) * (p.y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) c = !c;
    }
    return c;
}
