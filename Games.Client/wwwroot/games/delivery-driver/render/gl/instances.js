// Pure instancing data for the WebGL renderer (no DOM, no GL): the shared low-poly templates (broadleaf and conifer
// trees, rocks) and the per-chunk instance buffers that place them. One instance is INSTANCE_FLOATS floats:
// x y z rotation | sx sy sz | tint r g b. The template is in unit space: trees are 1 wide per metre of canopy radius
// (x, y scaled by the radius) and 1 tall per metre of total height (z scaled by the height); rocks are a 1 x 1 x 1 lump
// (x, y centred, z from 0) scaled to length, depth and height. The instanced shader applies scale, then rotation about
// z, then the offset; the tint multiplies the vertex colour.
import { createBuilder, compose } from './meshes.js';
import { hex } from './building-mesh.js';

export const INSTANCE_FLOATS = 10;

/** Fraction of a chunk's trees drawn at a quality's `trees` setting (the Canvas renderer's thinning rule). */
export const treeStep = trees => (trees >= 1 ? 1 : trees >= 0.7 ? 1.4 : 2.5);

/** A squashed sphere of `rings` x `segs` quads, centred at (0, 0, cz), radii (rx, rx, rz), shaded dark below to light above. */
function addBlob(b, cz, rx, rz, segs, rings, low, high) {
    const base = b.vertexCount;
    for (let i = 0; i <= rings; i++) {
        const phi = -Math.PI / 2 + (i / rings) * Math.PI, cp = Math.cos(phi), sp = Math.sin(phi);
        const t = (sp + 1) / 2, col = [low[0] + (high[0] - low[0]) * t, low[1] + (high[1] - low[1]) * t, low[2] + (high[2] - low[2]) * t];
        for (let j = 0; j < segs; j++) {
            const th = (j / segs) * Math.PI * 2 + (i % 2) * (Math.PI / segs);
            const nx = cp * Math.cos(th), ny = cp * Math.sin(th), nz = sp;
            b.vertex(nx * rx, ny * rx, cz + nz * rz, nx, ny, nz, col[0], col[1], col[2]);
        }
    }
    for (let i = 0; i < rings; i++) {
        for (let j = 0; j < segs; j++) {
            const a = base + i * segs + j, c = base + i * segs + (j + 1) % segs;
            b.quad(a, c, c + segs, a + segs);
        }
    }
}

const TRUNK = hex('#5a4632');

/** A broadleaf tree: trunk and a squashed round canopy. Unit height, unit canopy radius. */
export function broadleafTemplate() {
    const b = createBuilder();
    compose.cylinder(b, 0, 0, 0, 0.1, 0.55, 5, TRUNK, { radiusTop: 0.07 });
    addBlob(b, 0.68, 1, 0.32, 7, 4, hex('#3f6a2e'), hex('#6a9a48'));
    return b.finish();
}

/** A conifer: trunk and a tall cone (two tiers). */
export function coniferTemplate() {
    const b = createBuilder();
    compose.cylinder(b, 0, 0, 0, 0.08, 0.3, 5, TRUNK);
    compose.cylinder(b, 0, 0, 0.18, 1, 0.5, 7, hex('#2a5230'), { radiusTop: 0.35 });
    compose.cylinder(b, 0, 0, 0.5, 0.7, 0.5, 7, hex('#2f5a34'), { radiusTop: 0 });
    return b.finish();
}

/** A rock lump: a wide base block with a narrower, offset block on top. White so the instance tint is its colour. */
export function rockTemplate() {
    const b = createBuilder();
    compose.box(b, 0, 0, 0, 1, 1, 0.62, [0.92, 0.92, 0.92]);
    compose.box(b, 0.06, -0.05, 0.6, 0.66, 0.72, 0.4, [1, 1, 1]);
    return b.finish();
}

const colourOf = (c, fallback) => hex(c ?? fallback);

/**
 * Tree instances for a chunk, thinned for the quality (`trees` 0..1 as in QUALITY) and for far chunks (`far`).
 * Returns {broadleaf, conifer}: Float32Arrays of INSTANCE_FLOATS per tree, plus `count`.
 */
export function buildTreeInstances(chunk, trees = 1, far = false) {
    const step = far ? Math.max(2.5, treeStep(trees)) : treeStep(trees);
    const bl = [], co = [];
    for (let k = 0; k < chunk.trees.length; k += step) {
        const t = chunk.trees[Math.floor(k)];
        const tint = 0.8 + 0.3 * t.tone;
        (t.kind === 'conifer' ? co : bl).push(t.x, t.y, t.z ?? 0, t.tone * 6.2832, t.r, t.r, t.h, tint, tint, tint);
    }
    return { broadleaf: new Float32Array(bl), conifer: new Float32Array(co), count: (bl.length + co.length) / INSTANCE_FLOATS };
}

/** Rock (granite tor) instances for a chunk: one lump per rock, sunk 0.6 m so none float on a slope. */
export function buildRockInstances(chunk) {
    const out = [];
    for (const r of chunk.rocks) {
        const c = colourOf(r.colour, '#8f8c85');
        out.push(r.x, r.y, (r.z ?? 0) - 0.6, r.angle, r.len, r.dep, r.h + 0.6, c[0], c[1], c[2]);
    }
    return new Float32Array(out);
}
