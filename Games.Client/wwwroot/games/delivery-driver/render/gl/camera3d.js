// Pure camera, frustum culling and LOD maths for the WebGL renderer (no DOM, no GL).
//
// World coordinates are +x east, +y south, +z up. That frame is left-handed, so the camera works in a mirrored frame
// (y negated) and the view-projection matrix it returns already includes the flip: apply it straight to world points.
import * as mat4 from './mat4.js';
import { CHUNK_SIZE } from '../../config.js';

const FLIP_Y = mat4.scaling(mat4.create(), 1, -1, 1);

/**
 * A fixed oblique camera south of `target` looking north (placeholder until the chase camera of phase 7).
 * Writes the combined view-projection (including the y flip) into `out.vp` and the eye (world coordinates) into `out.eye`.
 */
export function obliqueCamera(out, target, aspect, { back = 95, height = 75, fov = 0.9, near = 1, far = 5000 } = {}) {
    out.vp ??= mat4.create();
    out.eye ??= [0, 0, 0];
    out.proj ??= mat4.create();
    out.view ??= mat4.create();
    out.eye[0] = target.x; out.eye[1] = target.y + back; out.eye[2] = target.z + height;
    mat4.perspective(out.proj, fov, aspect, near, far);
    mat4.lookAt(out.view, [out.eye[0], -out.eye[1], out.eye[2]], [target.x, -target.y, target.z], [0, 0, 1]);
    mat4.multiply(out.vp, out.proj, out.view);
    mat4.multiply(out.vp, out.vp, FLIP_Y);
    return out;
}

/**
 * The six frustum planes (left, right, bottom, top, near, far) of a view-projection matrix, as [a, b, c, d] with the
 * normal pointing into the frustum and normalised, so `a x + b y + c z + d` is the signed distance to the plane.
 */
export function frustumPlanes(vp, out = Array.from({ length: 6 }, () => [0, 0, 0, 0])) {
    const row = (r, s) => [vp[3] + s * vp[r], vp[7] + s * vp[r + 4], vp[11] + s * vp[r + 8], vp[15] + s * vp[r + 12]];
    const sets = [row(0, 1), row(0, -1), row(1, 1), row(1, -1), row(2, 1), row(2, -1)];
    sets.forEach((p, i) => {
        const len = Math.hypot(p[0], p[1], p[2]) || 1;
        out[i][0] = p[0] / len; out[i][1] = p[1] / len; out[i][2] = p[2] / len; out[i][3] = p[3] / len;
    });
    return out;
}

/** False only when the sphere lies completely outside one of the planes. */
export function sphereVisible(planes, x, y, z, r) {
    for (const p of planes) if (p[0] * x + p[1] * y + p[2] * z + p[3] < -r) return false;
    return true;
}

/** False only when the axis-aligned box lies completely outside one of the planes (the "positive vertex" test). */
export function boxVisible(planes, minX, minY, minZ, maxX, maxY, maxZ) {
    for (const p of planes) {
        const x = p[0] >= 0 ? maxX : minX, y = p[1] >= 0 ? maxY : minY, z = p[2] >= 0 ? maxZ : minZ;
        if (p[0] * x + p[1] * y + p[2] * z + p[3] < 0) return false;
    }
    return true;
}

/** Height range of a chunk (from its height grid, with room for roads and bridges); a loose default if it has none. */
export function chunkHeightRange(chunk) {
    if (chunk._zRange) return chunk._zRange;
    let lo = Infinity, hi = -Infinity;
    const z = chunk.terrain?.z;
    if (z) for (let i = 0; i < z.length; i++) { if (z[i] < lo) lo = z[i]; if (z[i] > hi) hi = z[i]; }
    if (!Number.isFinite(lo)) { lo = -5; hi = 60; }
    // bridges, parapets and trees stand above the ground; seas and river beds sit below the water plane
    return (chunk._zRange = [Math.min(lo, 0) - 1, hi + 12]);
}

/** Whether a chunk's box intersects the frustum. */
export function chunkVisible(planes, chunk) {
    const [lo, hi] = chunkHeightRange(chunk);
    const x0 = chunk.i * CHUNK_SIZE, y0 = chunk.j * CHUNK_SIZE;
    return boxVisible(planes, x0, y0, lo, x0 + CHUNK_SIZE, y0 + CHUNK_SIZE, hi);
}

/** Chunks (those loaded around the target) that intersect the frustum. */
export function visibleChunks(planes, chunks) {
    return chunks.filter(c => chunkVisible(planes, c));
}

/** Distances (in chunk widths) at which the ground mesh drops to its next coarser level. */
export const LOD_CHUNKS = [2];

/** Level of detail for a chunk at `distance` metres from the camera target: 0 = full, higher = coarser. Never decreases with distance. */
export function lodFor(distance, thresholds = LOD_CHUNKS) {
    let lod = 0;
    for (const t of thresholds) if (distance >= t * CHUNK_SIZE) lod++;
    return lod;
}

/**
 * `lodFor` with hysteresis: a chunk currently at `current` keeps it until it is `margin` chunk widths past the threshold
 * on the other side, so a chunk standing on a boundary does not swap back and forth as the camera jitters.
 */
export function lodWithHysteresis(current, distance, thresholds = LOD_CHUNKS, margin = 0.25) {
    let lod = 0;
    for (let i = 0; i < thresholds.length; i++) {
        const t = thresholds[i] * CHUNK_SIZE, edge = current > i ? t - margin * CHUNK_SIZE : t + margin * CHUNK_SIZE;
        if (distance >= edge) lod++; else break;
    }
    return lod;
}

/** How far the scene is drawn for a quality preset: `drawChunks` chunk widths plus half a chunk. */
export const viewDistance = quality => quality?.viewDistance ?? ((quality?.drawChunks ?? 3) + 0.5) * CHUNK_SIZE;

// ---- the chase camera (phase 7) -----------------------------------------------------------------------------------

/** Camera tilt (degrees above the horizon): the range and the default. */
export const TILT = { min: 15, max: 75, default: 35, step: 10 };
/** Vertical field of view (radians) by screen shape: portrait screens see more vertically. */
export const fovFor = aspect => (aspect < 1 ? 1.15 : 0.9);
/** How high above the ground the camera aims at the vehicle, metres. */
export const LOOK_HEIGHT = 1.2;

/**
 * Lifts `eye` (in place) so it stays at least `clearance` above the ground and the line of sight from `look` to the eye
 * clears the terrain by `margin`: hills between the truck and the camera push the camera up instead of hiding the truck.
 * `ground(x, y)` is the surface height (the sea counts as 0).
 */
export function clearTerrain(eye, look, ground, clearance = 2.5, margin = 1.2, minSamples = 14) {
    const gz = (x, y) => Math.max(0, ground(x, y));
    let z = Math.max(eye[2], gz(eye[0], eye[1]) + clearance);
    const samples = Math.max(minSamples, Math.ceil(Math.hypot(eye[0] - look[0], eye[1] - look[1]) / 2)); // about every 2 m
    for (let i = 1; i <= samples; i++) {
        const s = i / samples;
        const x = look[0] + (eye[0] - look[0]) * s, y = look[1] + (eye[1] - look[1]) * s;
        // the sight line at fraction s is look.z + (z - look.z) * s; it must be above ground + margin
        const need = look[2] + (gz(x, y) + margin - look[2]) / s;
        if (need > z) z = need;
    }
    eye[2] = z;
    return eye;
}

/**
 * Pulls the camera in along its boom (in place on `out.eye`) when a solid, such as a building, stands between the look
 * point and the eye: `solidTop(x, y)` is the roof height there (-Infinity for open ground). It snaps in at once so the
 * lens never passes through a wall, and eases back out once the way is clear (`out.boom` holds the fraction).
 */
export function clearSolids(out, solidTop, margin = 1.2, minFrac = 0.22, blocked = null) {
    const { eye, look } = out;
    const dx = eye[0] - look[0], dy = eye[1] - look[1], dz = eye[2] - look[2];
    const samples = Math.max(8, Math.ceil(Math.hypot(dx, dy, dz) / 1.5));
    let frac = 1;
    for (let i = 1; i <= samples; i++) {
        const s = i / samples;
        const x = look[0] + dx * s, y = look[1] + dy * s, z = look[2] + dz * s;
        if (solidTop(x, y) + margin > z || (blocked && blocked(x, y, z, look))) { frac = Math.max(minFrac, (i - 1) / samples); break; }
    }
    const prev = out.boom ?? 1;
    const boom = frac < prev ? frac : prev + (frac - prev) * 0.08;
    out.boom = boom;
    eye[0] = look[0] + dx * boom; eye[1] = look[1] + dy * boom; eye[2] = look[2] + dz * boom;
}

const noSolid = () => -Infinity;

/**
 * Builds the perspective camera for a view `{tx, ty, tz, az, distance, tilt, ahead}` (see engine/camera.js): it looks
 * along world heading `az` (0 = east, +y south) at the point `ahead` metres in front of (tx, ty), from `distance` metres
 * away at `tilt` radians above the horizon. Writes `vp` (including the y flip), `eye`, `view`, `proj`, `inv`, `look`.
 * `opts.ground` enables terrain clearance (`opts.cameraGround`, if given, is the surface to clear instead: the one the
 * vehicle drives on, so a bridge deck above it does not lift the camera), `opts.solidTop` keeping out of buildings and
 * `opts.blocked` out of bridge slabs (see clearSolids); `opts.far` is the far plane.
 */
export function cameraFromView(out, v, aspect, { ground = null, solidTop = null, blocked = null, cameraGround = null, far = 3000, near = 0.5 } = {}) {
    out.vp ??= mat4.create(); out.inv ??= mat4.create(); out.proj ??= mat4.create(); out.view ??= mat4.create();
    out.eye ??= [0, 0, 0]; out.look ??= [0, 0, 0];
    const ca = Math.cos(v.az), sa = Math.sin(v.az), ct = Math.cos(v.tilt), st = Math.sin(v.tilt);
    out.look[0] = v.tx + ca * v.ahead; out.look[1] = v.ty + sa * v.ahead; out.look[2] = v.tz + LOOK_HEIGHT;
    out.eye[0] = out.look[0] - ca * v.distance * ct;
    out.eye[1] = out.look[1] - sa * v.distance * ct;
    out.eye[2] = out.look[2] + v.distance * st;
    if (solidTop || blocked) clearSolids(out, solidTop ?? noSolid, 1.2, 0.22, blocked);
    if (ground) clearTerrain(out.eye, out.look, cameraGround ?? ground);
    out.fov = fovFor(aspect);
    mat4.perspective(out.proj, out.fov, aspect, near, far);
    mat4.lookAt(out.view, [out.eye[0], -out.eye[1], out.eye[2]], [out.look[0], -out.look[1], out.look[2]], [0, 0, 1]);
    mat4.multiply(out.vp, out.proj, out.view);
    mat4.multiply(out.vp, out.vp, FLIP_Y);
    mat4.invert(out.inv, out.vp);
    return out;
}

/** World point to screen pixels (y down) and depth (NDC z); `out` = {x, y, z}. */
export function projectPoint(vp, x, y, z, width, height, out = { x: 0, y: 0, z: 0 }) {
    const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    const nx = (vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w;
    const ny = (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w;
    out.x = (nx * 0.5 + 0.5) * width;
    out.y = (0.5 - ny * 0.5) * height;
    out.z = (vp[2] * x + vp[6] * y + vp[10] * z + vp[14]) / w;
    return out;
}

const rayA = [0, 0, 0], rayB = [0, 0, 0];

/**
 * The ground point under a screen pixel: unprojects a ray through `inv` (the inverse view-projection) and marches it
 * until it passes below `ground(x, y)`, then bisects. Returns {x, y, z} or null when the ray never reaches the ground.
 */
export function screenToGround(inv, sx, sy, width, height, ground, out = { x: 0, y: 0, z: 0 }) {
    const nx = (sx / width) * 2 - 1, ny = 1 - (sy / height) * 2;
    mat4.transformPoint(rayA, inv, [nx, ny, -1]);
    mat4.transformPoint(rayB, inv, [nx, ny, 1]);
    const f = t => {
        const x = rayA[0] + (rayB[0] - rayA[0]) * t, y = rayA[1] + (rayB[1] - rayA[1]) * t, z = rayA[2] + (rayB[2] - rayA[2]) * t;
        return z - ground(x, y);
    };
    const N = 160;
    let lo = 0, prev = f(0);
    if (prev <= 0) return null;
    let hi = -1;
    for (let i = 1; i <= N; i++) {
        const t = i / N, g = f(t);
        if (g <= 0) { hi = t; break; }
        lo = t; prev = g;
    }
    if (hi < 0) return null;
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (f(mid) > 0) lo = mid; else hi = mid;
    }
    const t = (lo + hi) / 2;
    out.x = rayA[0] + (rayB[0] - rayA[0]) * t; out.y = rayA[1] + (rayB[1] - rayA[1]) * t; out.z = rayA[2] + (rayB[2] - rayA[2]) * t;
    return out;
}
