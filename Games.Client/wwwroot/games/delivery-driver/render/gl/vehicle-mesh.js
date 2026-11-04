// Pure vehicle, trailer and wheel meshes plus pose matrices for the WebGL renderer (no DOM, no GL): the 3D counterpart
// of render/draw-vehicles.js. Meshes are in a vehicle-local frame: origin on the ground under the REAR AXLE (a trailer:
// under the centre of its axle group), +x forward, +y to the vehicle's right (world +y is south, so with heading 0 the
// right-hand side is south), +z up. `poseMatrix` places that frame in the world from (x, y, z, heading, pitch, roll),
// the same quantities the sim keeps on a vehicle. Bodies are built from the catalogue's `draw.parts`; windows, livery
// stripes, lamps and (for tractor units) the fifth-wheel plate are added; wheels are a separate unit template that the
// renderer instances (so they can steer and spin); lamps are separate meshes so their colour can follow the brake state.
import { createBuilder, compose, mergeMeshes, transformMesh } from './meshes.js';
import { hex, shade } from './building-mesh.js';
import { axlePositions, TRAILER_BODY, DEFAULT_LIVERY } from '../draw-vehicles.js';
import { WHEEL_KINDS } from './model-kit.js';
import { buildTrafficModel } from './car-models.js';
import { buildTruckModel, buildTrailerModel } from './truck-models.js';
import * as mat4 from './mat4.js';

/** Height of the fifth-wheel plate and of the trailer's kingpin plate (same as sim/coupling.js). */
export const PLATE_Z = 1.1;
export const TRAILER_WHEEL = { r: 0.5, w: 0.4, gap: 1.3 };

const GLASS = hex('#82a9bb');

const colourOf = (c, livery) => hex(c === 'livery1' || c === 'livery2' ? livery[c] ?? DEFAULT_LIVERY[c] : c);

/** A flat quad centred at c, spanned by half-vectors u and v (3-arrays), with normal n. */
function plane(b, c, u, v, n, col) {
    const base = b.vertexCount;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        b.vertex(c[0] + u[0] * su + v[0] * sv, c[1] + u[1] * su + v[1] * sv, c[2] + u[2] * su + v[2] * sv, n[0], n[1], n[2], col[0], col[1], col[2]);
    }
    b.quad(base, base + 1, base + 2, base + 3);
}

/** A quad on a body's front/rear face (normal +x/-x) centred at (x, y, z) with half sizes (hy, hz). */
const faceX = (b, x, y, z, hy, hz, dir, col) => plane(b, [x, y, z], [0, hy, 0], [0, 0, hz], [dir, 0, 0], col);
/** A quad on a side (normal +y/-y), half sizes (hx, hz). */
const faceY = (b, x, y, z, hx, hz, dir, col) => plane(b, [x, y, z], [hx, 0, 0], [0, 0, hz], [0, dir, 0], col);

const boxPart = (b, x0, x1, w, z0, h, side, roof) => {
    compose.prism(b, [{ x: x0, y: -w / 2 }, { x: x1, y: -w / 2 }, { x: x1, y: w / 2 }, { x: x0, y: w / 2 }], h, side, { z0, roofColor: roof });
};

/**
 * A rigid vehicle's (or tractor unit's) body, head lamps and tail lamps, in the local frame. `livery` = {livery1,
 * livery2}; `coupled` hides the fifth-wheel plate. Returns {body, head, tail} (head/tail may be empty meshes).
 */
export function buildVehicleMesh(spec, livery = DEFAULT_LIVERY, { coupled = false } = {}) {
    const model = spec.model ? buildTrafficModel(spec) : buildTruckModel(spec, livery, { coupled });
    if (model) return model;
    const ro = spec.rearOverhang, body = createBuilder(), head = createBuilder(), tail = createBuilder();
    const parts = spec.draw?.parts ?? [{ u0: 0, u1: spec.length, w: spec.width, z0: 0.4, h: spec.height - 0.4, color: 'livery1', roof: 'livery1' }];
    const stripeCol = colourOf('livery2', livery);
    for (const part of parts) {
        const x0 = part.u0 - ro, x1 = part.u1 - ro, len = x1 - x0;
        const side = colourOf(part.color, livery), roof = shade(colourOf(part.roof ?? part.color, livery), 1.12);
        boxPart(body, x0, x1, part.w, part.z0, part.h, side, roof);
        if (part.glass) {
            const zc = part.z0 + part.h * 0.685, hz = part.h * 0.235;
            faceX(body, x1 + 0.01, 0, zc, part.w * 0.42, hz, 1, shade(GLASS, 0.9));
            for (const s of [-1, 1]) faceY(body, x0 + len * 0.55, s * (part.w / 2 + 0.01), zc, len * 0.32, hz, s, shade(GLASS, 0.8));
        }
        if (part.sign) {
            for (const s of [-1, 1]) faceY(body, (x0 + x1) / 2, s * (part.w / 2 + 0.012), part.z0 + part.h * 0.65, len * 0.45, part.h * 0.1, s, stripeCol);
        }
        if (part.lamps) for (const s of [-1, 1]) faceX(head, x1 + 0.012, s * part.w * 0.38, part.z0 + part.h * 0.6, 0.11, 0.1, 1, [1, 1, 1]);
    }
    for (const s of [-1, 1]) faceX(tail, -ro - 0.012, s * spec.width * 0.4, 0.85, 0.1, 0.08, -1, [1, 1, 1]);
    if (spec.fifthWheel !== undefined && !coupled) compose.cylinder(body, spec.fifthWheel, 0, PLATE_Z - 0.12, 0.7, 0.12, 10, hex('#3a3a3a'));
    return { body: body.finish(), head: head.finish(), tail: tail.finish() };
}

/**
 * A semi-trailer: body by type, landing legs when `legs`, a load on flatbeds when `cargo`. Local origin is the centre of
 * its axle group, +x towards the kingpin. Returns {body, tail}.
 */
export function buildTrailerMesh(spec, livery = DEFAULT_LIVERY, { legs = false, cargo = false } = {}) {
    const model = buildTrailerModel(spec, livery, { legs, cargo });
    if (model) return model;
    const ro = spec.rearOverhang, body = createBuilder(), tail = createBuilder();
    const parts = (TRAILER_BODY[spec.body] ?? TRAILER_BODY.box)(spec.length, spec.width, spec.height);
    const stripeCol = colourOf('livery2', livery);
    for (const part of parts) {
        const x0 = part.u0 - ro, x1 = part.u1 - ro;
        boxPart(body, x0, x1, part.w, part.z0, part.h, colourOf(part.color, livery), shade(colourOf(part.roof ?? part.color, livery), 1.1));
        if (part.sign) for (const s of [-1, 1]) faceY(body, (x0 + x1) / 2, s * (part.w / 2 + 0.012), part.z0 + part.h * 0.65, (x1 - x0) * 0.45, part.h * 0.1, s, stripeCol);
    }
    // a kingpin plate under the front, and a mudguard-ish chassis rail so flat trailers read as a frame
    compose.cylinder(body, spec.axle, 0, PLATE_Z - 0.2, 0.45, 0.1, 8, hex('#3a3a3a'));
    if (legs) {
        for (const s of [-1, 1]) compose.cylinder(body, spec.length - ro - spec.kingpin - 1.8, s * (spec.width / 2 - 0.35), 0, 0.13, 1.2, 5, hex('#444444'));
    }
    if (cargo && (spec.body === 'flat' || spec.body === 'low')) {
        const cx = spec.length * 0.45 - ro, len = spec.length * 0.6;
        boxPart(body, cx - len / 2, cx + len / 2, spec.width * 0.85, 1.35, 1.15, hex('#8a6d4f'), hex('#a58660'));
    }
    for (const s of [-1, 1]) faceX(tail, -ro - 0.012, s * spec.width * 0.4, 0.85, 0.1, 0.08, -1, [1, 1, 1]);
    return { body: body.finish(), tail: tail.finish() };
}

/** The wheel kind a catalogue vehicle wears when its draw spec names none: spoked until the 1930s, alloys on modern vans. */
const defaultKind = spec => (spec.year && spec.year < 1932 ? 'spoke' : spec.class === 'van' ? (spec.year >= 2010 ? 'alloy' : 'disc') : 'truck');

/**
 * Wheels of a rigid vehicle: [{x, y, z, r, w, steer, kind}] in the local frame (`steer`: turns with the steering wheel).
 * `draw.axles[k]` ({r, w, kind}) overrides `draw.wheel` for axle k; `draw.skipAxles` leaves axles bare (a cart's horse end)
 * and `draw.centreWheels` puts a single wheel on the centre line (a bicycle).
 */
export function vehicleWheels(spec) {
    const dr = spec.draw ?? {}, out = [];
    axlePositions(spec).forEach((u, k) => {
        if (dr.skipAxles?.includes(k)) return;
        const a = dr.axles?.[k] ?? dr.wheel ?? {}, r = a.r ?? 0.45, w = a.w ?? 0.3, kind = a.kind ?? dr.wheel?.kind ?? defaultKind(spec);
        for (const side of dr.centreWheels || (spec.threeWheeler && k === 1) ? [0] : [-1, 1]) {
            out.push({ x: u - spec.rearOverhang, y: (spec.width / 2 - w / 2) * side, z: r, r, w, steer: k === 1, kind });
        }
    });
    return out;
}

/** Wheels of a trailer: an axle group 1.3 m apart about the origin. */
export function trailerWheels(spec) {
    const n = spec.axles ?? 1, { r, w, gap } = TRAILER_WHEEL, out = [];
    for (let k = 0; k < n; k++) for (const side of [-1, 1]) out.push({ x: (k - (n - 1) / 2) * gap, y: (spec.width / 2 - 0.2) * side, z: r, r, w, steer: false, kind: 'truck' });
    return out;
}

/**
 * The unit wheel: radius 1, width 1, axle along y, centred on the origin; a dark tyre with a light hub disc each side and
 * a spoke bar so spinning is visible. Scale it by (r, w, r).
 */
export function wheelTemplate() {
    const tyre = createBuilder();
    compose.cylinder(tyre, 0, 0, -0.5, 1, 1, 12, hex('#151515'));
    compose.cylinder(tyre, 0, 0, -0.51, 0.55, 0.02, 10, hex('#9a9a9a'));
    compose.cylinder(tyre, 0, 0, 0.49, 0.55, 0.02, 10, hex('#9a9a9a'));
    // z -> y so the axle lies along the vehicle's lateral axis
    const m = new Float64Array(16);
    m[0] = 1; m[6] = -1; m[9] = 1; m[15] = 1;
    const turned = transformMesh(tyre.finish(), m);
    const spoke = createBuilder();
    compose.box(spoke, 0, 0, -0.07, 1.02, 1.05, 0.14, hex('#b8b8b8'));
    return mergeMeshes([turned, spoke.finish()]);
}

/** Meshes of every wheel kind (built on demand): {spoke, disc, alloy, truck, tread, cycle}. */
export const wheelTemplates = () => Object.fromEntries(Object.entries(WHEEL_KINDS).map(([k, make]) => [k, make()]));

// ---- poses -----------------------------------------------------------------------------------------------------

const rotZ = (out, a) => { mat4.identity(out); out[0] = Math.cos(a); out[1] = Math.sin(a); out[4] = -Math.sin(a); out[5] = Math.cos(a); return out; };
const rotY = (out, a) => { mat4.identity(out); out[0] = Math.cos(a); out[2] = -Math.sin(a); out[8] = Math.sin(a); out[10] = Math.cos(a); return out; };
const rotX = (out, a) => { mat4.identity(out); out[5] = Math.cos(a); out[6] = Math.sin(a); out[9] = -Math.sin(a); out[10] = Math.cos(a); return out; };
const t1 = new Float64Array(16), t2 = new Float64Array(16), t3 = new Float64Array(16);

/** Rotation only: Rz(heading) * Ry(-pitch) * Rx(-roll); pitch + is nose up, roll + is the right side lower. */
export function rotationMatrix(out, heading, pitch = 0, roll = 0) {
    mat4.multiply(t3, rotZ(t1, heading), rotY(t2, -pitch));
    return mat4.multiply(out, t3, rotX(t1, -roll));
}

/** The local-to-world matrix of a vehicle whose rear axle is at (x, y) on ground height z. */
export function poseMatrix(out, x, y, z, heading, pitch = 0, roll = 0) {
    rotationMatrix(out, heading, pitch, roll);
    out[12] = x; out[13] = y; out[14] = z;
    return out;
}

/** The world position of a tractor's fifth-wheel plate, given its pose matrix. */
export function hitchWorld(out3, tractorMatrix, spec) {
    return mat4.transformPoint(out3, tractorMatrix, [spec.fifthWheel ?? 0, 0, PLATE_Z]);
}

/**
 * A trailer's matrix. Uncoupled (`hitch` null) it stands at its own pose; coupled it is pinned so its kingpin plate sits
 * exactly on the tractor's fifth wheel `hitch` ([x, y, z] world), keeping its own heading, pitch and roll.
 */
export function trailerMatrix(out, spec, pose, hitch = null) {
    rotationMatrix(out, pose.heading, pose.pitch ?? 0, pose.roll ?? 0);
    if (!hitch) { out[12] = pose.x; out[13] = pose.y; out[14] = pose.z ?? 0; return out; }
    const kx = spec.axle, kz = PLATE_Z; // kingpin in the trailer frame (y = 0)
    out[12] = hitch[0] - (out[0] * kx + out[8] * kz);
    out[13] = hitch[1] - (out[1] * kx + out[9] * kz);
    out[14] = hitch[2] - (out[2] * kx + out[10] * kz);
    return out;
}

/** A wheel's matrix: vehicle matrix, then its position, steering about z, spin about the axle, and its size. */
export function wheelMatrix(out, vehicle, wheel, steer = 0, spin = 0) {
    mat4.translation(t1, wheel.x, wheel.y, wheel.z);
    mat4.multiply(t2, t1, rotZ(t3, wheel.steer ? steer : 0));
    mat4.multiply(t1, t2, rotY(t3, spin));
    mat4.multiply(t3, t1, mat4.scaling(t2, wheel.r, wheel.w, wheel.r));
    return mat4.multiply(out, vehicle, t3);
}

// ---- appearance ------------------------------------------------------------------------------------------------

/** Body tint for a damage level (0..100): dents and scuffs darken the paint a little. */
export const damageTint = d => { const k = 1 - 0.4 * Math.max(0, Math.min(1, (d ?? 0) / 100)); return [k, k, k]; };

/** Lamp colours: tail lamps dim red, bright red on the brake, and head lamps cream. */
export const TAIL = { off: hex('#6a1a14'), brake: hex('#ff3b2f') };
export const HEAD = { off: hex('#d8d2b0'), on: hex('#fff6c0') };

/**
 * Engine smoke for a badly damaged vehicle: a few grey puffs rising off the bonnet, a function of `now` (seconds).
 * Adds to a builder; nothing below 60% damage. `pose` = {x, y, z, heading}.
 */
export function addSmoke(b, now, pose, spec, damage) {
    if (damage < 60) return;
    const n = damage >= 85 ? 5 : 3;
    const c = Math.cos(pose.heading), s = Math.sin(pose.heading);
    const front = spec.length - (spec.rearOverhang ?? 0) - 0.6;
    for (let k = 0; k < n; k++) {
        const t = (now * 0.7 + k / n) % 1, size = 0.25 + 0.55 * t, g = 0.35 + 0.4 * t;
        compose.box(b, pose.x + c * front + Math.sin(now * 3 + k) * 0.15, pose.y + s * front + Math.cos(now * 2.4 + k) * 0.15, (pose.z ?? 0) + 1.1 + t * 2.4, size, size, size, [g, g, g]);
    }
}

/** A small least-recently-used cache of built meshes: `get(key, build)`; `onEvict(value)` frees GPU copies. */
export function createMeshCache(max = 48, onEvict = null) {
    const map = new Map();
    return {
        map,
        get(key, build) {
            let v = map.get(key);
            if (v) { map.delete(key); map.set(key, v); return v; }
            v = build();
            map.set(key, v);
            while (map.size > max) {
                const [k, old] = map.entries().next().value;
                map.delete(k);
                onEvict?.(old);
            }
            return v;
        },
        clear() { for (const v of map.values()) onEvict?.(v); map.clear(); },
        get size() { return map.size; },
    };
}

export const vehicleKey = (spec, livery, variant = '') => `${spec.id ?? spec.draw?.parts?.length}:${spec.length}:${livery?.livery1 ?? ''}:${livery?.livery2 ?? ''}:${variant}`;
