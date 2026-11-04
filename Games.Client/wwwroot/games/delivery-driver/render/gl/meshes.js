// Pure indexed-triangle mesh builders for the WebGL renderer (no DOM, no GL). A mesh is
// `{ positions: Float32Array(3n), normals: Float32Array(3n), colors: Float32Array(3n), indices: Uint32Array }`
// in world coordinates (+x east, +y south, +z up). Winding convention: for every triangle, the numeric cross product
// (b - a) x (c - a) points the same way as its vertex normals (so flat ground has +z). `tri` enforces this by swapping
// two indices when needed. NB east/south/up is a left-handed frame, so camera3d must account for the mirror when it
// picks `gl.frontFace`. Colours are linear 0..1 RGB, one per vertex.

/** A growable mesh. Call `finish()` for the typed arrays. */
export function createBuilder() {
    const pos = [], nor = [], col = [], idx = [];
    const b = {
        get vertexCount() { return pos.length / 3; },
        get triangleCount() { return idx.length / 3; },
        /** Add a vertex, returns its index. */
        vertex(x, y, z, nx, ny, nz, r, g, bl) {
            pos.push(x, y, z);
            nor.push(nx, ny, nz);
            col.push(r, g, bl);
            return pos.length / 3 - 1;
        },
        tri(a, c, d) {
            const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
            const e1x = pos[c * 3] - ax, e1y = pos[c * 3 + 1] - ay, e1z = pos[c * 3 + 2] - az;
            const e2x = pos[d * 3] - ax, e2y = pos[d * 3 + 1] - ay, e2z = pos[d * 3 + 2] - az;
            const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
            const dot = cx * (nor[a * 3] + nor[c * 3] + nor[d * 3]) + cy * (nor[a * 3 + 1] + nor[c * 3 + 1] + nor[d * 3 + 1])
                + cz * (nor[a * 3 + 2] + nor[c * 3 + 2] + nor[d * 3 + 2]);
            if (dot < 0) idx.push(a, d, c); else idx.push(a, c, d);
        },
        quad(a, c, d, e) { b.tri(a, c, d); b.tri(a, d, e); },
        finish() {
            return {
                positions: new Float32Array(pos), normals: new Float32Array(nor), colors: new Float32Array(col),
                indices: new Uint32Array(idx),
            };
        },
    };
    return b;
}

export const vertexCount = mesh => mesh.positions.length / 3;
export const triangleCount = mesh => mesh.indices.length / 3;

const rgb = c => (Array.isArray(c) || ArrayBuffer.isView(c) ? c : [c, c, c]);

/** Colour argument: an [r,g,b] triple, or a function (x, y, z) => [r,g,b]. */
function colourAt(color, x, y, z) {
    return typeof color === 'function' ? rgb(color(x, y, z)) : rgb(color);
}

/**
 * A regular grid of (nx+1) x (ny+1) vertices over [x0, x0+w] x [y0, y0+h], z from `heightFn(x, y)`. Normals come from
 * central differences of the same function, so neighbouring grids share edge normals. Every triangle faces up.
 */
export function grid(x0, y0, w, h, nx, ny, heightFn, color = [0.4, 0.6, 0.3]) {
    const b = createBuilder();
    const dx = w / nx, dy = h / ny, e = Math.min(dx, dy) * 0.5;
    for (let j = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++) {
            const x = x0 + i * dx, y = y0 + j * dy, z = heightFn(x, y);
            const gx = (heightFn(x + e, y) - heightFn(x - e, y)) / (2 * e);
            const gy = (heightFn(x, y + e) - heightFn(x, y - e)) / (2 * e);
            const inv = 1 / Math.hypot(gx, gy, 1);
            const c = colourAt(color, x, y, z);
            b.vertex(x, y, z, -gx * inv, -gy * inv, inv, c[0], c[1], c[2]);
        }
    }
    const row = nx + 1;
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            const a = j * row + i;
            b.tri(a, a + row, a + 1);
            b.tri(a + 1, a + row, a + row + 1);
        }
    }
    return b.finish();
}

/** Axis-aligned box centred on (cx, cy) in x/y with its base at z0 (sizes along x, y, z). */
export function box(cx, cy, z0, sx, sy, sz, color = [0.7, 0.7, 0.7]) {
    const b = createBuilder();
    addBox(b, cx, cy, z0, sx, sy, sz, color);
    return b.finish();
}

function addBox(b, cx, cy, z0, sx, sy, sz, color) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z1 = z0 + sz;
    const c = rgb(color);
    // [normal], then the four corners of the face (`tri` fixes the winding)
    const faces = [
        [[0, 0, 1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]],
        [[0, 0, -1], [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]],
        [[1, 0, 0], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1], [x1, y1, z1]],
        [[-1, 0, 0], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]],
        [[0, 1, 0], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
        [[0, -1, 0], [x1, y0, z0], [x0, y0, z0], [x0, y0, z1], [x1, y0, z1]],
    ];
    for (const [n, ...p] of faces) {
        const base = b.vertexCount;
        for (const q of p) b.vertex(q[0], q[1], q[2], n[0], n[1], n[2], c[0], c[1], c[2]);
        b.quad(base, base + 1, base + 2, base + 3);
    }
}

/** Signed area of a polygon in the x/y plane (positive when counter-clockwise with +y up, i.e. clockwise on screen). */
export function polygonArea(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
}

/** True when point (px, py) lies inside triangle abc (any winding). */
function inTri(px, py, a, b, c) {
    const d1 = (px - b.x) * (a.y - b.y) - (a.x - b.x) * (py - b.y);
    const d2 = (px - c.x) * (b.y - c.y) - (b.x - c.x) * (py - c.y);
    const d3 = (px - a.x) * (c.y - a.y) - (c.x - a.x) * (py - a.y);
    const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
}

/** Ear-clipping triangulation of a simple polygon; returns triangles as index triples into `poly` (counter-clockwise). */
export function triangulate(poly) {
    const n = poly.length;
    if (n < 3) return [];
    const order = Array.from({ length: n }, (_, i) => i);
    if (polygonArea(poly) < 0) order.reverse();
    const out = [];
    let guard = n * n;
    while (order.length > 3 && guard-- > 0) {
        let clipped = false;
        for (let k = 0; k < order.length; k++) {
            const ia = order[(k + order.length - 1) % order.length], ib = order[k], ic = order[(k + 1) % order.length];
            const a = poly[ia], b = poly[ib], c = poly[ic];
            if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) <= 1e-12) continue; // reflex or degenerate
            let ear = true;
            for (const j of order) {
                if (j === ia || j === ib || j === ic) continue;
                if (inTri(poly[j].x, poly[j].y, a, b, c)) { ear = false; break; }
            }
            if (!ear) continue;
            out.push([ia, ib, ic]);
            order.splice(k, 1);
            clipped = true;
            break;
        }
        if (!clipped) break; // degenerate input: stop rather than loop forever
    }
    if (order.length === 3) out.push([order[0], order[1], order[2]]);
    return out;
}

/**
 * A vertical prism: `polygon` ([{x, y}, ...], any winding) extruded from z0 up by `height`, with a flat roof (or none
 * with `cap: false`). Walls get flat normals; `roofColor` defaults to `color`.
 */
export function prism(polygon, height, color = [0.7, 0.6, 0.5], { z0 = 0, roofColor = color, cap = true } = {}) {
    const b = createBuilder();
    addPrism(b, polygon, height, color, roofColor, z0, cap);
    return b.finish();
}

function addPrism(b, polygon, height, color, roofColor, z0, cap) {
    const poly = polygonArea(polygon) < 0 ? polygon.slice().reverse() : polygon;
    const n = poly.length, z1 = z0 + height, c = rgb(color), rc = rgb(roofColor);
    for (let i = 0; i < n; i++) {
        const p = poly[i], q = poly[(i + 1) % n];
        const ex = q.x - p.x, ey = q.y - p.y, len = Math.hypot(ex, ey) || 1;
        // Counter-clockwise (area > 0 with y up) means the outward normal is to the right of the edge in (x, y)
        const nx = ey / len, ny = -ex / len;
        const base = b.vertexCount;
        b.vertex(p.x, p.y, z0, nx, ny, 0, c[0], c[1], c[2]);
        b.vertex(q.x, q.y, z0, nx, ny, 0, c[0], c[1], c[2]);
        b.vertex(q.x, q.y, z1, nx, ny, 0, c[0], c[1], c[2]);
        b.vertex(p.x, p.y, z1, nx, ny, 0, c[0], c[1], c[2]);
        b.quad(base, base + 1, base + 2, base + 3);
    }
    if (cap) {
        const base = b.vertexCount;
        for (const p of poly) b.vertex(p.x, p.y, z1, 0, 0, 1, rc[0], rc[1], rc[2]);
        for (const [i, j, k] of triangulate(poly)) b.tri(base + i, base + j, base + k);
    }
}

/**
 * An upright cylinder (or cone/frustum with a different top radius) with `segments` sides, axis along z from z0. Side
 * normals are smooth; the caps are flat. Use `radiusTop = 0` for a cone.
 */
export function cylinder(cx, cy, z0, radius, height, segments = 8, color = [0.5, 0.5, 0.5], { radiusTop = radius, caps = true } = {}) {
    const b = createBuilder();
    addCylinder(b, cx, cy, z0, radius, height, segments, color, radiusTop, caps);
    return b.finish();
}

function addCylinder(b, cx, cy, z0, radius, height, segments, color, radiusTop, caps) {
    const c = rgb(color), z1 = z0 + height, slope = (radius - radiusTop) / (height || 1);
    const base = b.vertexCount;
    for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const inv = 1 / Math.hypot(1, slope);
        b.vertex(cx + ca * radius, cy + sa * radius, z0, ca * inv, sa * inv, slope * inv, c[0], c[1], c[2]);
        b.vertex(cx + ca * radiusTop, cy + sa * radiusTop, z1, ca * inv, sa * inv, slope * inv, c[0], c[1], c[2]);
    }
    for (let i = 0; i < segments; i++) {
        const p = base + i * 2;
        // vertices run anticlockwise about +z: bottom p, top p+1, next bottom p+2, next top p+3
        b.tri(p, p + 2, p + 1);
        b.tri(p + 1, p + 2, p + 3);
    }
    if (!caps) return;
    for (const [z, nz, r] of [[z1, 1, radiusTop], [z0, -1, radius]]) {
        if (r <= 0) continue;
        const centre = b.vertex(cx, cy, z, 0, 0, nz, c[0], c[1], c[2]);
        const ring = b.vertexCount;
        for (let i = 0; i < segments; i++) {
            const a = (i / segments) * Math.PI * 2;
            b.vertex(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z, 0, 0, nz, c[0], c[1], c[2]);
        }
        for (let i = 0; i < segments; i++) {
            const p = ring + i, q = ring + ((i + 1) % segments);
            if (nz > 0) b.tri(centre, p, q); else b.tri(centre, q, p);
        }
    }
}

/**
 * A ribbon laid along a polyline: `width` across (metres, or a function of the distance along it), `heightProfile`
 * giving z along the strip (a number, an array with one z per point, or a function of the point index and (x, y)).
 * Normals tilt with the profile's cross-slope along the strip so draped roads shade with the ground. `z` of each point
 * may also come straight from `points[i].z`. Faces +z.
 *
 * Returns the mesh; `info.length` on the result is the length of the polyline.
 */
export function extrudeStrip(points, width, heightProfile = 0, color = [0.3, 0.3, 0.3], opts = {}) {
    const b = createBuilder();
    const length = addStrip(b, points, width, heightProfile, color, opts);
    const mesh = b.finish();
    mesh.length = length;
    return mesh;
}

/** Adds a ribbon (see `extrudeStrip`) to an existing builder; returns the polyline length. */
export function addStrip(b, points, width, heightProfile = 0, color = [0.3, 0.3, 0.3], { bias = 0 } = {}) {
    const n = points.length;
    const first = b.vertexCount;
    const zAt = (i) => {
        if (typeof heightProfile === 'function') return heightProfile(i, points[i].x, points[i].y);
        if (Array.isArray(heightProfile) || ArrayBuffer.isView(heightProfile)) return heightProfile[i];
        return points[i].z ?? heightProfile;
    };
    let dist = 0;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(dist += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    const widthAt = (i) => (typeof width === 'function' ? width(cum[i], i) : width);
    for (let i = 0; i < n; i++) {
        const prev = points[Math.max(0, i - 1)], next = points[Math.min(n - 1, i + 1)];
        let tx = next.x - prev.x, ty = next.y - prev.y;
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl; ty /= tl;
        // Left of travel in a +y-south frame: (ty, -tx) is the side towards "left" when looking along +x with y down.
        const lx = ty, ly = -tx, half = widthAt(i) / 2, z = zAt(i) + bias;
        // grade along the strip for the shading normal
        const zPrev = zAt(Math.max(0, i - 1)), zNext = zAt(Math.min(n - 1, i + 1));
        const run = Math.hypot(next.x - prev.x, next.y - prev.y) || 1;
        const g = (zNext - zPrev) / run;
        const inv = 1 / Math.hypot(g, 1);
        const nx = -g * tx * inv, ny = -g * ty * inv, nz = inv;
        const c = colourAt(color, points[i].x, points[i].y, z);
        b.vertex(points[i].x + lx * half, points[i].y + ly * half, z, nx, ny, nz, c[0], c[1], c[2]);
        b.vertex(points[i].x - lx * half, points[i].y - ly * half, z, nx, ny, nz, c[0], c[1], c[2]);
    }
    for (let i = 0; i < n - 1; i++) {
        const a = first + i * 2;
        b.tri(a, a + 1, a + 2);
        b.tri(a + 1, a + 3, a + 2);
    }
    return cum[n - 1] || 0;
}

/** Row-major-free affine transform: `m` is a column-major 4x4 (from `mat4`) applied to positions, rotation part to normals. */
export function transformMesh(mesh, m) {
    const n = vertexCount(mesh);
    const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3);
    // Normals use the upper 3x3 (exact for rotation + uniform scale; normalised afterwards so non-uniform scale is approximate)
    for (let i = 0; i < n; i++) {
        const x = mesh.positions[i * 3], y = mesh.positions[i * 3 + 1], z = mesh.positions[i * 3 + 2];
        positions[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        positions[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        positions[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        const nx = mesh.normals[i * 3], ny = mesh.normals[i * 3 + 1], nz = mesh.normals[i * 3 + 2];
        const tx = m[0] * nx + m[4] * ny + m[8] * nz, ty = m[1] * nx + m[5] * ny + m[9] * nz, tz = m[2] * nx + m[6] * ny + m[10] * nz;
        const inv = 1 / (Math.hypot(tx, ty, tz) || 1);
        normals[i * 3] = tx * inv; normals[i * 3 + 1] = ty * inv; normals[i * 3 + 2] = tz * inv;
    }
    return { positions, normals, colors: mesh.colors, indices: mesh.indices };
}

/**
 * Merge meshes into one. Each entry is a mesh or `{ mesh, matrix }` (a column-major 4x4 applied first). Indices are
 * rebased; vertex and triangle counts add up exactly.
 */
export function mergeMeshes(list) {
    const parts = list.map(e => {
        if (e.mesh) return e.matrix ? transformMesh(e.mesh, e.matrix) : e.mesh;
        return e;
    });
    let nv = 0, ni = 0;
    for (const p of parts) { nv += vertexCount(p); ni += p.indices.length; }
    const out = {
        positions: new Float32Array(nv * 3), normals: new Float32Array(nv * 3), colors: new Float32Array(nv * 3),
        indices: new Uint32Array(ni),
    };
    let vo = 0, io = 0;
    for (const p of parts) {
        out.positions.set(p.positions, vo * 3);
        out.normals.set(p.normals, vo * 3);
        out.colors.set(p.colors, vo * 3);
        for (let i = 0; i < p.indices.length; i++) out.indices[io + i] = p.indices[i] + vo;
        vo += vertexCount(p);
        io += p.indices.length;
    }
    return out;
}

/** Bounding box `{ min: [x,y,z], max: [x,y,z] }` of a mesh. */
export function meshBounds(mesh) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.positions.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            const v = mesh.positions[i + k];
            if (v < min[k]) min[k] = v;
            if (v > max[k]) max[k] = v;
        }
    }
    return { min, max };
}

/** Add the primitive builders onto an existing builder (for composing several shapes into one mesh). */
export const compose = {
    strip: (b, ...a) => addStrip(b, ...a),
    box: (b, ...a) => addBox(b, ...a),
    prism: (b, polygon, height, color, { z0 = 0, roofColor = color, cap = true } = {}) => addPrism(b, polygon, height, color, roofColor, z0, cap),
    cylinder: (b, cx, cy, z0, radius, height, segments = 8, color = [0.5, 0.5, 0.5], { radiusTop = radius, caps = true } = {}) =>
        addCylinder(b, cx, cy, z0, radius, height, segments, color, radiusTop, caps),
};
