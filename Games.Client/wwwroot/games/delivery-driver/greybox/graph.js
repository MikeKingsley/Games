// Builds a road graph, and the minimal world the road mesh pipeline needs, from the greybox spec (spec.js), bypassing the
// real map baking. Pure: no DOM, no GL, so tests can build the same world the dev page draws.
import { createGraph, createSegmentIndex } from '../world/roadgraph.js';
import { halfWidthOf } from '../world/crossings.js';
import { DECK_LIFT, GREYBOX_SPEC } from './spec.js';

const Z_STEP = 4;
const key = (x, y) => `${Math.round(x * 10)},${Math.round(y * 10)}`;

/**
 * A flat stand-in for the real region: a huge square island over a zero elevation grid. `groundZ` (bridge abutments and
 * piers ask it for the ground under a deck) then reads about half a metre everywhere, and `waterAt` says dry.
 */
function flatRegion(R = 20000) {
    return {
        seed: 'greybox', bounds: { minX: -R, minY: -R, maxX: R, maxY: R },
        coast: [-R, -R, R, -R, R, R, -R, R], islands: [], moors: [], relief: [], towns: [], rivers: [], sites: [], townById: new Map(),
        elevation: { width: 4, height: 4, minX: -R, minY: -R, cell: R, unit: 1, data: new Int16Array(16) },
        waterCache: new Map(), maxGrade: {},
    };
}

/** Height profile of a road (one value every Z_STEP m): flat, or with the deck lifted `DECK_LIFT` m between `deck` ramps `ramp` m long. */
function profile(road, len) {
    const n = Math.ceil(len / Z_STEP) + 1;
    return Float32Array.from({ length: n }, (_, i) => {
        if (!road.deck) return 0;
        const d = i * Z_STEP, [d0, d1] = road.deck, ramp = road.ramp ?? 60;
        return DECK_LIFT * Math.max(0, Math.min(1, (d - (d0 - ramp)) / ramp, (d1 + ramp - d) / ramp));
    });
}

/**
 * The world for a spec: `{ graph, region, yards: [], harbours: [], spec, year }`. Nodes are shared by position, so roads
 * that start at the same point meet there; junction points get their control type, every other end is a dead end.
 */
export function buildGreyboxWorld(spec = GREYBOX_SPEC) {
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
        edge.z = profile(road, edge.len);
        edge.zStep = Z_STEP;
        edge.zFill = new Float32Array(edge.z.length);
        edge.zHalf = halfWidthOf(edge);
        if (road.deck) edge.zones = [{ kind: 'deck', from: road.deck[0], to: road.deck[1] }];
    }
    for (const n of graph.nodes) n.z = 0;
    graph.index = createSegmentIndex(graph);
    for (const e of graph.edges) graph.index.add(e);
    return { graph, region: flatRegion(), yards: [], harbours: [], spec, year: spec.year };
}
