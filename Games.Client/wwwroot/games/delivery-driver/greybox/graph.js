// Builds a road graph, and the minimal world the road mesh pipeline needs, from the greybox spec (spec.js), bypassing the
// real map baking. Pure: no DOM, no GL, so tests can build the same world the dev page draws.
import { createGraph, createSegmentIndex } from '../world/roadgraph.js';
import { halfWidthOf } from '../world/crossings.js';
import { gradeRoads } from '../world/terrain.js';
import { DECK_LIFT, GREYBOX_SPEC } from './spec.js';
import { groundHeightFn, GRID, CELL } from './terrain.js';

const Z_STEP = 4;
const key = (x, y) => `${Math.round(x * 10)},${Math.round(y * 10)}`;

/**
 * A stand-in for the real region: a huge square island over an elevation grid. `flat` gives a zero grid; `elevation` is a
 * grid of the same shape as the ground (greybox/terrain.js), so the real grading (gradeRoads) and groundZ see the hills.
 */
function greyboxRegion(elevation = null, R = 20000) {
    return {
        seed: 'greybox', bounds: { minX: -R, minY: -R, maxX: R, maxY: R },
        coast: [-R, -R, R, -R, R, R, -R, R], islands: [], moors: [], relief: [], towns: [], rivers: [], sites: [], townById: new Map(),
        elevation: elevation ?? { width: 4, height: 4, minX: -R, minY: -R, cell: R, unit: 1, data: new Int16Array(16) },
        waterCache: new Map(), maxGrade: {},
    };
}

/** An elevation grid (the region's DEM format: row-major, `unit` metres per value) of `groundAt` over GRID, in centimetres. */
function demOf(groundAt) {
    const width = Math.round((GRID.maxX - GRID.minX) / CELL) + 1, height = Math.round((GRID.maxY - GRID.minY) / CELL) + 1;
    const data = new Int16Array(width * height);
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) data[j * width + i] = Math.round(groundAt(GRID.minX + i * CELL, GRID.minY + j * CELL) * 100);
    return { width, height, minX: GRID.minX, minY: GRID.minY, cell: CELL, unit: 0.01, data };
}

/** The point at distance `d` along a flat polyline `flat` ([x0, y0, x1, y1, ...]), clamped to its ends. */
function pointAlong(flat, d) {
    let acc = 0;
    for (let i = 0; i + 3 < flat.length; i += 2) {
        const seg = Math.hypot(flat[i + 2] - flat[i], flat[i + 3] - flat[i + 1]);
        if (acc + seg >= d || i + 4 >= flat.length) {
            const f = seg ? Math.min(1, Math.max(0, (d - acc) / seg)) : 0;
            return [flat[i] + (flat[i + 2] - flat[i]) * f, flat[i + 1] + (flat[i + 3] - flat[i + 1]) * f];
        }
        acc += seg;
    }
    return [flat[0], flat[1]];
}

/** Distance along a flat polyline at each of its points (the first is 0). */
function cumulativeLengths(flat) {
    const out = new Float64Array(flat.length / 2);
    for (let k = 1; k < out.length; k++) out[k] = out[k - 1] + Math.hypot(flat[2 * k] - flat[2 * k - 2], flat[2 * k + 1] - flat[2 * k - 1]);
    return out;
}

/**
 * Height profile of a road (one value every Z_STEP m): the ground under it, plus the deck lifted `DECK_LIFT` m between
 * `deck` ramps `ramp` m long. Roads are draped on the ground (no grading), so the greybox shows the geometry, not the game's cuts.
 */
function profile(road, flat, len, ground) {
    const n = Math.ceil(len / Z_STEP) + 1;
    return Float32Array.from({ length: n }, (_, i) => {
        const d = i * Z_STEP, [x, y] = pointAlong(flat, d);
        const lift = road.deck ? (() => {
            const [d0, d1] = road.deck, ramp = road.ramp ?? 60;
            return DECK_LIFT * Math.max(0, Math.min(1, (d - (d0 - ramp)) / ramp, (d1 + ramp - d) / ramp));
        })() : 0;
        return ground(x, y) + lift;
    });
}

/**
 * The world for a spec: `{ graph, region, yards: [], harbours: [], spec, year, groundAt, groundKind }`, its roads graded by the
 * game's own pass (world/terrain.js gradeRoads, as createWorld does). Nodes are shared by position, so roads that start at
 * the same point meet there; junction points get their control type, every other end is a dead end.
 * `terrain` is 'flat' (the default) or 'rolling' (greybox/terrain.js hills); `groundAt(x, y)` gives the ground height.
 */
export function buildGreyboxWorld(spec = GREYBOX_SPEC, { terrain = 'flat' } = {}) {
    const groundAt = groundHeightFn(terrain);
    const graph = createGraph();
    const nodes = new Map();
    const junctionAt = new Map(spec.junctions.map(j => [key(j.x, j.y), j]));
    const nodeAt = (x, y) => {
        const k = key(x, y);
        if (!nodes.has(k)) {
            const j = junctionAt.get(k);
            nodes.set(k, graph.addNode(x, y, j ? { junction: j.kind, roundaboutFrom: 0, signalsFrom: 0, tag: j.id, ...(j.priority !== undefined ? { priority: j.priority } : {}), ...(j.tier ? { tier: j.tier } : {}), ...(j.ringRadius !== undefined ? { ringRadius: j.ringRadius } : {}) } : { junction: 'end' }));
        }
        return nodes.get(k);
    };
    for (const road of spec.roads) {
        const flat = road.pts.flat();
        const a = nodeAt(flat[0], flat[1]), b = nodeAt(flat[flat.length - 2], flat[flat.length - 1]);
        const extra = { cls: road.cls, name: road.id, tag: road.id };
        for (const k of ['oneway', 'dual', 'town', 'profile']) if (road[k] !== undefined) extra[k] = road[k]; // lane layout + per-road overrides (world/lane-profile.js)
        const edge = graph.addEdge(a, b, flat, extra);
        edge.z = profile(road, flat, edge.len, groundAt);
        edge.zStep = Z_STEP;
        // what the real grading pipeline (world/terrain.js) also stores: the cumulative length at each point (its deck and
        // support lookups read it), and the road's height above the ground under it (no embankment or cutting: it is draped)
        edge.zCum = cumulativeLengths(flat);
        edge.zFill = Float32Array.from(edge.z, (v, i) => v - groundAt(...pointAlong(flat, i * Z_STEP)));
        edge.zHalf = halfWidthOf(edge);
        if (road.deck) edge.zones = [{ kind: 'deck', from: road.deck[0], to: road.deck[1] }];
    }
    for (const n of graph.nodes) n.z = groundAt(n.x, n.y);
    graph.index = createSegmentIndex(graph);
    for (const e of graph.edges) graph.index.add(e);
    const world = { graph, region: greyboxRegion(terrain === 'rolling' ? demOf(groundAt) : null), yards: [], harbours: [], spec, year: spec.year, groundAt, groundKind: terrain };
    // on hills the graph is final, so grade the roads and nodes as the game does (sets edge.z, node.z, zones and world.terrain
    // for groundZ). Flat keeps the draped profile above, whose overbridge deck is exactly DECK_LIFT (tests/js/greybox-drive.test.mjs).
    if (terrain === 'rolling') gradeRoads(world);
    else world.terrain = { cells: new Map() }; // groundZ (the overbridge supports) reads only the pad cells, and the greybox has no pads
    return world;
}
