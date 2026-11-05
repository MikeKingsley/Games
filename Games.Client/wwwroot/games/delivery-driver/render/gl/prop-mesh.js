// Pure street furniture and chunk "props" meshes for the WebGL renderer (no DOM, no GL): street lamps, signposts,
// hedges, harbour quays and boats, traffic signals and cones, and `buildChunkProps`, which merges a chunk's buildings,
// lamps, signs, hedges and harbours into one static mesh. Trees and rocks are instanced (instances.js); signals and
// cones change every frame, so `buildDynamicProps` makes a tiny fresh mesh for them.
import { createBuilder, compose, addStrip } from './meshes.js';
import { addBuilding, buildingEra, hex, shade, rectPoly, emissive } from './building-mesh.js';
import { eraOf } from '../era.js';
import { CHUNK_SIZE } from '../../config.js';
import { groundZ } from '../../world/terrain.js';
import { clearOfRoads, junctionType } from '../../world/roadgraph.js';
import { isLive, signalPolesOf } from '../../world/furniture.js';
import { obb } from '../../sim/collision.js';
import { waterAt } from '../../world/region.js';

/** Lamp height and colours by era (matches era.js drawLamp). */
export function lampStyle(year) {
    const era = eraOf(year);
    return {
        era,
        height: era <= 1 ? 3.6 : era <= 3 ? 7.5 : 8,
        pole: hex(era <= 1 ? '#2f3a2f' : era <= 3 ? '#b8b3a6' : '#8d9399'),
        head: hex(era <= 1 ? '#c9c2a0' : '#d9d6cc'),
        arm: era >= 2,
    };
}

/** A street lamp: a cast-iron gas lamp (to the 1940s), a concrete swan-neck (1950s-80s) or a slim steel column (1990s on). */
export function addLamp(b, lamp, year) {
    const st = lampStyle(year), z = lamp.z ?? 0;
    const r = st.era <= 1 ? 0.1 : 0.08;
    compose.cylinder(b, lamp.x, lamp.y, z, r * 1.4, st.height, 6, st.pole, { radiusTop: r });
    if (st.arm) {
        const ex = lamp.x + Math.cos(lamp.angle) * 1.4, ey = lamp.y + Math.sin(lamp.angle) * 1.4;
        compose.prism(b, rectPoly((lamp.x + ex) / 2, (lamp.y + ey) / 2, 1.5, 0.12, lamp.angle), 0.12, st.pole, { z0: z + st.height - 0.3 });
        compose.prism(b, rectPoly(ex, ey, 0.55, 0.28, lamp.angle), 0.16, emissive(st.head, true), { z0: z + st.height - 0.4, roofColor: emissive(st.head, true) });
    } else {
        compose.prism(b, rectPoly(lamp.x, lamp.y, 0.36, 0.36, lamp.angle), 0.5, emissive(st.head, true), { z0: z + st.height, roofColor: st.pole });
    }
}

/** A signpost: a white finger post before 1965, a Worboys-style green sign on two posts after. */
export function addSign(b, sign, year) {
    const z = sign.z ?? 0;
    if (sign.kind === 'giveway' || sign.kind === 'roundabout') {
        // a post with a plate facing oncoming traffic: a red-edged white triangle (approximated by a square plate) / a blue disc
        compose.cylinder(b, sign.x, sign.y, z, 0.04, 2.1, 5, hex('#777777'));
        const plate = sign.kind === 'giveway' ? hex('#f1efe9') : hex('#1f4f9a');
        compose.prism(b, rectPoly(sign.x, sign.y, 0.06, 0.7, sign.angle), 0.7, plate, { z0: z + 1.5, roofColor: sign.kind === 'giveway' ? hex('#c0261d') : plate });
        return;
    }
    if (year < 1965) {
        const white = hex('#ece8dc');
        compose.cylinder(b, sign.x, sign.y, z, 0.07, 2.8, 5, white);
        for (const a of [sign.angle + 0.9, sign.angle - 0.9, sign.angle + Math.PI]) {
            compose.prism(b, rectPoly(sign.x + Math.cos(a) * 0.5, sign.y + Math.sin(a) * 0.5, 1, 0.1, a), 0.25, white, { z0: z + 2.25, roofColor: shade(white, 0.95) });
        }
        return;
    }
    const c = Math.cos(sign.angle + Math.PI / 2), s = Math.sin(sign.angle + Math.PI / 2);
    for (const side of [-0.9, 0.9]) compose.cylinder(b, sign.x + c * side, sign.y + s * side, z, 0.05, 1.3, 5, hex('#777777'));
    compose.prism(b, rectPoly(sign.x, sign.y, 0.12, 2.4, sign.angle), 1.6, hex('#1f6b3a'), { z0: z + 1.2, roofColor: hex('#e8e8e8') });
}

const HEDGE = { wall: hex('#46672f'), top: hex('#5a8140'), width: 1.0, height: 1.3, step: 12, sink: 0.25 };

/**
 * Hedges along field edges: for each edge of each field quad (shared edges once) a low trapezoid ribbon on the ground,
 * sampled every ~12 m, skipped where it would cross a road or water. `zAt(x, y)` gives the ground height.
 */
export function addHedges(b, hedges, zAt, graph, region) {
    const seen = new Set();
    for (const quad of hedges) {
        for (let k = 0; k < 4; k++) {
            const ax = quad[k * 2], ay = quad[k * 2 + 1], bx = quad[((k + 1) % 4) * 2], by = quad[((k + 1) % 4) * 2 + 1];
            const key = ax < bx || (ax === bx && ay < by) ? `${ax},${ay},${bx},${by}` : `${bx},${by},${ax},${ay}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const len = Math.hypot(bx - ax, by - ay);
            if (len < 1) continue;
            const n = Math.max(1, Math.round(len / HEDGE.step));
            const ang = Math.atan2(by - ay, bx - ax), tx = (bx - ax) / len, ty = (by - ay) / len;
            // left of travel: (ty, -tx), as in meshes.js
            const lx = ty, ly = -tx;
            let prev = null;
            for (let i = 0; i <= n; i++) {
                const x = ax + (bx - ax) * (i / n), y = ay + (by - ay) * (i / n);
                let ok = !waterAt(region, x, y);
                if (ok && i > 0) {
                    const mx = (x + prev.x) / 2, my = (y + prev.y) / 2;
                    ok = clearOfRoads(graph, obb(mx, my, len / n, HEDGE.width, ang), 0.6);
                }
                const z = zAt(x, y);
                const hw = HEDGE.width / 2, tw = hw * 0.55;
                const p = { x, y, z, ok, base: b.vertexCount };
                // three faces (left wall, top, right wall), two vertices per face edge per sample
                const L = (off, up, nxl, nzl, col) => b.vertex(x + lx * off, y + ly * off, z + up, lx * nxl, ly * nxl, nzl, col[0], col[1], col[2]);
                // left wall: base, top
                L(hw, -HEDGE.sink, 0.949, 0.316, HEDGE.wall); L(tw, HEDGE.height, 0.949, 0.316, HEDGE.wall);
                // top: left edge, right edge
                L(tw, HEDGE.height, 0, 1, HEDGE.top); L(-tw, HEDGE.height, 0, 1, HEDGE.top);
                // right wall: top, base
                L(-tw, HEDGE.height, -0.949, 0.316, HEDGE.wall); L(-hw, -HEDGE.sink, -0.949, 0.316, HEDGE.wall);
                if (i > 0 && ok && prev.ok) {
                    for (let f = 0; f < 3; f++) b.quad(prev.base + f * 2, p.base + f * 2, p.base + f * 2 + 1, prev.base + f * 2 + 1);
                }
                prev = p;
            }
        }
    }
}

/** A harbour's breakwaters (rising out of the water) and moored boats. */
export function addHarbour(b, harbour) {
    for (const w of harbour.walls) {
        compose.prism(b, rectPoly(w.x, w.y, w.len, w.dep, w.angle), w.h + 1.2, hex(w.colour ?? '#8d877b'), { z0: -1.2, roofColor: hex('#a39d90') });
    }
    for (const bt of harbour.boats) {
        const hull = hex(bt.colour);
        compose.prism(b, rectPoly(bt.x, bt.y, bt.len, bt.dep, bt.angle), bt.h + 0.2, hull, { z0: -0.2, roofColor: hex('#c9b48a') });
        const c = Math.cos(bt.angle), s = Math.sin(bt.angle);
        compose.prism(b, rectPoly(bt.x - c * bt.len * 0.15, bt.y - s * bt.len * 0.15, bt.len * 0.28, bt.dep * 0.6, bt.angle), 1.3, hex('#e8e2d0'), { z0: bt.h, roofColor: hex('#d8d0bc') });
    }
}

/** The per-chunk static props mesh signature input: rebuild when this changes (a year crossing an era). */
export const propsEra = year => `${buildingEra(year)}:${year < 1965 ? 0 : 1}`;
/** Props signature of a chunk in a year: the era plus which of its lamps and signs stand (they come and go with their roads). */
export const chunkPropsSig = (chunk, year) => `${propsEra(year)}:${(chunk.lamps ?? []).filter(l => isLive(l, year)).length}:${(chunk.signs ?? []).filter(s => isLive(s, year)).length}`;

/**
 * One merged mesh for a chunk: its buildings, plus (when `detail`) lamps, signs, hedges and the harbours whose centre
 * lies in the chunk. Far chunks (detail off) get just the buildings.
 */
export function buildChunkProps(world, chunk, year, { detail = true } = {}) {
    const b = createBuilder();
    for (const bd of chunk.buildings) addBuilding(b, bd, year, detail);
    if (detail) {
        for (const l of chunk.lamps ?? []) if (isLive(l, year)) addLamp(b, l, year);
        for (const s of chunk.signs ?? []) if (isLive(s, year)) addSign(b, s, year);
        if (chunk.hedges?.length) addHedges(b, chunk.hedges, (x, y) => groundZ(world, x, y), world.graph, world.region);
    }
    const x0 = chunk.i * CHUNK_SIZE, y0 = chunk.j * CHUNK_SIZE;
    for (const h of world.harbours ?? []) {
        if (h.x >= x0 && h.x < x0 + CHUNK_SIZE && h.y >= y0 && h.y < y0 + CHUNK_SIZE) addHarbour(b, h);
    }
    return b.finish();
}

/** The signalled junctions owned by a chunk (node inside it) in a year: [node]. */
export function chunkSignalNodes(world, chunk, year) {
    const x0 = chunk.i * CHUNK_SIZE, y0 = chunk.j * CHUNK_SIZE, out = [], seen = new Set();
    for (const id of chunk.edges) {
        const e = world.graph.edges[id];
        for (const nid of [e.a, e.b]) {
            if (seen.has(nid)) continue;
            seen.add(nid);
            const n = world.graph.nodes[nid];
            if (n.junction === 'signals' && n.x >= x0 && n.x < x0 + CHUNK_SIZE && n.y >= y0 && n.y < y0 + CHUNK_SIZE && junctionType(n, year) === 'signals') out.push(n);
        }
    }
    return out;
}

/** Corner positions of a junction's four signal poles, in the same order as era.js drawSignals. */
export function signalCorners(node) {
    return [0, 1, 2, 3].map(k => {
        const a = (k * Math.PI) / 2 + Math.PI / 4;
        return { k, x: node.x + Math.cos(a) * 6.5, y: node.y + Math.sin(a) * 6.5, face: a + Math.PI };
    });
}

const SIGNAL = { pole: hex('#2b2b2b'), head: hex('#111111'), green: hex('#3cff6a'), red: hex('#ff3b2f') };

/**
 * A signalled junction: four poles with a head each, the lit lamp showing green on the corners whose axis has the
 * phase (`phase` is 0 or 1 from traffic.js signalPhase; corners 0/2 are east-west, 1/3 north-south).
 */
export function addSignals(b, world, node, phase) {
    for (const c of signalPolesOf(world, node)) {
        const z = groundZ(world, c.x, c.y);
        compose.cylinder(b, c.x, c.y, z, 0.07, 3, 5, SIGNAL.pole);
        const cs = Math.cos(c.face), sn = Math.sin(c.face); // the head looks back along the arm toward oncoming traffic
        compose.prism(b, rectPoly(c.x, c.y, 0.3, 0.36, c.face), 0.95, SIGNAL.head, { z0: z + 2.4 });
        const green = c.group === phase;
        // the lamp: a small quad on the face turned toward the junction
        const nx = cs, ny = sn, tx = -sn, ty = cs;
        const ox = c.x + nx * 0.17, oy = c.y + ny * 0.17, zc = z + (green ? 2.55 : 3.2);
        const col = green ? SIGNAL.green : SIGNAL.red;
        const base = b.vertexCount;
        for (const [du, dz] of [[-0.11, -0.11], [0.11, -0.11], [0.11, 0.11], [-0.11, 0.11]]) b.vertex(ox + tx * du, oy + ty * du, zc + dz, nx, ny, 0, col[0], col[1], col[2]);
        b.quad(base, base + 1, base + 2, base + 3);
    }
}

const GLOW = hex('#ffc24a');

/**
 * The active loading bay's glow: a low amber curtain around the bay rectangle `{x, y, len, dep, angle}` (centre, length
 * along `angle`, width across), pulsing in height with `time`, so the stop to reverse into is easy to see.
 */
export function addBayGlow(b, bay, z, time = 0) {
    const h = 0.55 + 0.25 * Math.sin(time * 4), c = Math.cos(bay.angle), s = Math.sin(bay.angle);
    for (const [u, v, l, d, a] of [[bay.len / 2, 0, 0.12, bay.dep, bay.angle], [-bay.len / 2, 0, 0.12, bay.dep, bay.angle],
        [0, bay.dep / 2, bay.len, 0.12, bay.angle], [0, -bay.dep / 2, bay.len, 0.12, bay.angle]]) {
        compose.prism(b, rectPoly(bay.x + u * c - v * s, bay.y + u * s + v * c, l, d, a), h, GLOW, { z0: z + 0.05, roofColor: GLOW });
    }
}

const CONE = { body: hex('#f26b1d'), band: hex('#f4f4f0') };

/** A traffic cone, upright, or lying on its side once knocked over. */
export function addCone(b, cone, z = 0) {
    if (cone.knocked) {
        const a = (cone.x * 12.9898 + cone.y * 78.233) % 6.28;
        const tx = Math.cos(a), ty = Math.sin(a);
        const base = b.vertexCount;
        // a flat triangle fan lying on the ground, wide end first
        const pts = [[-0.22, -0.22], [-0.22, 0.22], [0.5, 0]];
        for (const [u, v] of pts) b.vertex(cone.x + tx * u - ty * v, cone.y + ty * u + tx * v, z + 0.12, 0, 0, 1, CONE.body[0], CONE.body[1], CONE.body[2]);
        b.tri(base, base + 1, base + 2);
        return;
    }
    compose.cylinder(b, cone.x, cone.y, z, 0.22, 0.75, 8, CONE.body, { radiusTop: 0.05 });
    compose.cylinder(b, cone.x, cone.y, z + 0.3, 0.13, 0.1, 8, CONE.band, { radiusTop: 0.13, caps: false });
}

/**
 * The small per-frame mesh: signals for the given nodes (with `phaseOf(node)`) and the practice yard's cones.
 * Returns null when there is nothing to draw.
 */
export function buildDynamicProps(world, { signalNodes = [], phaseOf = () => 0, cones = null, bays = [], rings = [], time = 0 } = {}) {
    if (!signalNodes.length && !cones?.length && !bays.length && !rings.length) return null;
    const b = createBuilder();
    for (const bay of bays) addBayGlow(b, bay, groundZ(world, bay.x, bay.y), time);
    for (const r of rings) addRing(b, r, groundZ(world, r.x, r.y), time);
    for (const n of signalNodes) addSignals(b, world, n, phaseOf(n));
    for (const c of cones ?? []) addCone(b, c, groundZ(world, c.x, c.y));
    return b.finish();
}

/** Self-lit colour: a negative red and blue channel makes the scene shader skip the lighting (see shaders.js). */
export const glowColour = hex => { const c = hexTriple(hex); return [-c[0], c[1], -c[2]]; };
const hexTriple = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

/** The kerbside drop marker: a pulsing flat ring and a faint disc, {x, y, ok} (green once the vehicle is in place). */
export function addRing(b, ring, z, time = 0) {
    const pulse = 1 + 0.15 * Math.sin(time * 4), r = 2.2 * pulse, colour = glowColour(ring.ok ? '#6fd26f' : '#f2b33d');
    const pts = [];
    for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; pts.push({ x: ring.x + Math.cos(a) * r, y: ring.y + Math.sin(a) * r, z: z + 0.16 }); }
    addStrip(b, pts, 0.5, undefined, colour);
    const fill = glowColour(ring.ok ? '#3f8f3f' : '#9c7424');
    const base = b.vertexCount;
    b.vertex(ring.x, ring.y, z + 0.14, 0, 0, 1, fill[0], fill[1], fill[2]);
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; b.vertex(ring.x + Math.cos(a) * r, ring.y + Math.sin(a) * r, z + 0.14, 0, 0, 1, fill[0], fill[1], fill[2]); }
    for (let i = 0; i < 24; i++) b.tri(base, base + 1 + i, base + 1 + ((i + 1) % 24));
    // a short beacon so the stop can be found from a distance
    compose.cylinder(b, ring.x, ring.y, z, 0.12, 5 + Math.sin(time * 4) * 0.4, 6, glowColour(ring.ok ? '#6fd26f' : '#ffd37a'), { radiusTop: 0.05 });
}

/**
 * The route line as a ribbon draped on the roads, from a flat [x0, y0, x1, y1, ...] polyline; only within `radius` of
 * (cx, cy). Each point takes the surface at (or just below) the height of the one before, so a route that passes under
 * a bridge stays on the road beneath and one over a road stays on the deck; `startZ` (the player's height) picks the
 * layer at the first point (the topmost surface if omitted).
 */
export function buildRouteMesh(world, flat, cx, cy, radius = 260, step = 3, startZ = undefined) {
    const b = createBuilder(), colour = glowColour('#ff3fb4');
    let run = [];
    const flush = () => { if (run.length >= 2) addStrip(b, run, 0.8, undefined, colour); run = []; };
    const r2 = radius * radius;
    let hint = startZ;
    for (let i = 0; i + 3 < flat.length; i += 2) {
        const ax = flat[i], ay = flat[i + 1], dx = flat[i + 2] - ax, dy = flat[i + 3] - ay, len = Math.hypot(dx, dy);
        const n = Math.max(1, Math.ceil(len / step));
        for (let k = i === 0 ? 0 : 1; k <= n; k++) {
            const x = ax + (dx * k) / n, y = ay + (dy * k) / n;
            if ((x - cx) ** 2 + (y - cy) ** 2 > r2) { flush(); continue; }
            hint = groundZ(world, x, y, hint);
            run.push({ x, y, z: hint + 0.2 });
        }
    }
    flush();
    return b.vertexCount ? b.finish() : null;
}
