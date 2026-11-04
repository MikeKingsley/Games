// Modelling kit for the era vehicle models (pure, no DOM/GL). Bodies are lofted: a list of cross-section "stations"
// along the vehicle (+x forward, +y right, +z up), each an 8-point ring, joined by quads whose material comes from a
// per-segment code (paint, glass, roof, dark). Plus axis-aligned blocks, tubes (wheel arches, lamps, tanks, stacks),
// and the wheel templates the renderer instances (each a unit wheel: radius 1, width 1, axle along y).
import { createBuilder, compose, mergeMeshes, transformMesh } from './meshes.js';
import { hex, shade } from './building-mesh.js';

export { hex, shade };

export const COL = {
    glass: hex('#5c7584'), dark: hex('#17181a'), black: hex('#222222'), chrome: hex('#c4c8cc'), steel: hex('#6c7176'),
    rubber: hex('#121212'), wood: hex('#8b6b47'), canvas: hex('#c8bd9c'), plate: hex('#ece4b4'), red: hex('#a31f1a'),
    brass: hex('#b08d3c'), rust: hex('#6b4a36'), white: hex('#ecebe6'), amber: hex('#e0a020'),
};

/** Axis-aligned block between (x0..x1, y0..y1, z0..z1). */
export function blk(b, x0, x1, y0, y1, z0, z1, col) {
    const sx = Math.abs(x1 - x0), sy = Math.abs(y1 - y0), sz = Math.abs(z1 - z0);
    if (sx < 1e-4 || sy < 1e-4 || sz < 1e-4) return;
    compose.box(b, (x0 + x1) / 2, (y0 + y1) / 2, Math.min(z0, z1), sx, sy, sz, col);
}

/** Calls fn(side) for side = -1 (left) and +1 (right). */
export const both = fn => { fn(-1); fn(1); };

/**
 * A frustum / cylinder along an axis: `axis` 'x' (centre y = c1, z = c2), 'y' (centre x = c1, z = c2) or 'z' (centre x = c1, y = c2), from a0 to a1, radius r0 -> r1.
 */
export function tube(b, axis, a0, a1, c1, c2, r0, r1, seg, col, caps = true) {
    const pos = (a, th, r) => (axis === 'x' ? [a, c1 + Math.cos(th) * r, c2 + Math.sin(th) * r] : axis === 'y' ? [c1 + Math.cos(th) * r, a, c2 + Math.sin(th) * r] : [c1 + Math.cos(th) * r, c2 + Math.sin(th) * r, a]);
    const nor = th => (axis === 'x' ? [0, Math.cos(th), Math.sin(th)] : axis === 'y' ? [Math.cos(th), 0, Math.sin(th)] : [Math.cos(th), Math.sin(th), 0]);
    const base = b.vertexCount;
    for (let i = 0; i <= seg; i++) {
        const th = (i / seg) * Math.PI * 2, n = nor(th);
        let p = pos(a0, th, r0); b.vertex(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2]);
        p = pos(a1, th, r1); b.vertex(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2]);
    }
    for (let i = 0; i < seg; i++) {
        const k = base + i * 2;
        b.tri(k, k + 2, k + 1); b.tri(k + 1, k + 2, k + 3);
    }
    if (!caps) return;
    for (const [a, r, dir] of [[a1, r1, 1], [a0, r0, -1]]) {
        if (r <= 0) continue;
        const n = axis === 'x' ? [dir, 0, 0] : axis === 'y' ? [0, dir, 0] : [0, 0, dir];
        const centre = axis === 'x' ? [a, c1, c2] : axis === 'y' ? [c1, a, c2] : [c1, c2, a];
        const ci = b.vertex(centre[0], centre[1], centre[2], n[0], n[1], n[2], col[0], col[1], col[2]);
        const first = b.vertexCount;
        for (let i = 0; i < seg; i++) { const p = pos(a, (i / seg) * Math.PI * 2, r); b.vertex(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2]); }
        for (let i = 0; i < seg; i++) b.tri(ci, first + i, first + ((i + 1) % seg));
    }
}

/** Mirror a block pair about y = 0. */
export const blkBoth = (b, x0, x1, ya, yb, z0, z1, col) => { blk(b, x0, x1, ya, yb, z0, z1, col); blk(b, x0, x1, -yb, -ya, z0, z1, col); };

// ---- lofted hulls ---------------------------------------------------------------------------------------------

/**
 * An 8-point cross-section: half-width `wb` at the shoulder (zs), `wr` at the roof (zr, rounded by `rd`), floor at zb.
 * zr == zs gives a flat top (a bonnet, a deck); wr < wb then chamfers it.
 */
export function ring({ wb, wr = wb, zb, zs, zr = zs, rd = 0.06, bb = 0.94 }) {
    const r = zr > zs + 0.03 ? Math.min(rd, zr - zs, wr) : 0;
    return [[-wb * bb, zb], [-wb, zs], [-wr, zr - r], [-wr + r, zr], [wr - r, zr], [wr, zr - r], [wb, zs], [wb * bb, zb]];
}

/** A circular ring (for tanks and drums): n points, radius r, centre height cz. */
export function circle(r, cz, n = 16, ry = r) {
    const out = [];
    for (let i = 0; i < n; i++) { const a = -Math.PI + (i / n) * Math.PI * 2; out.push([Math.sin(a) * ry, cz + Math.cos(a) * r]); }
    return out;
}

/** The 8 edge colours for a segment code: P paint, T all paint, G side glass, W glass all round the top, K dark upper, D dark. */
function mats(code, c) {
    const P = c.paint, R = c.roof ?? P, G = c.glass ?? COL.glass, D = c.dark ?? COL.dark, X = c.trim ?? P;
    switch (code) {
        case 'T': return [P, P, P, P, P, P, P, D];
        case 'G': return [P, G, X, R, X, G, P, D];
        case 'W': return [P, G, G, G, G, G, P, D];
        case 'K': return [P, D, D, R, D, D, P, D];
        case 'H': return [P, X, X, R, X, X, P, D]; // trim-coloured upper (a visible rail)
        case 'D': return [D, D, D, D, D, D, D, D];
        case 'C': return [X, X, X, X, X, X, X, D];
        default: return [P, P, P, R, P, P, P, D];
    }
}

/**
 * Joins consecutive stations ({x, r: ring}) with quads. `codes`: one code per segment (a string like 'PPWG' or array;
 * an [r,g,b] array colours the whole segment). `cols` = {paint, roof, glass, dark, trim}. `caps` = [rearColour, frontColour]
 * (null leaves an end open). `smooth` shades with radial normals (tanks). Winding is fixed by the ring order, so quads
 * with zero length along x (steps) still face the right way.
 */
export function loft(b, stations, codes, cols, { caps = [null, null], smooth = false } = {}) {
    const n = stations[0].r.length;
    for (let i = 0; i < stations.length - 1; i++) {
        const A = stations[i], B = stations[i + 1];
        const code = codes[i];
        const m = typeof code === 'string' ? mats(code, cols) : Array.isArray(code) && typeof code[0] === 'number' ? Array(n).fill(code) : code;
        for (let e = 0; e < n; e++) {
            const e2 = (e + 1) % n, col = m[e];
            if (!col) continue;
            const p0 = [A.x, A.r[e][0], A.r[e][1]], p1 = [A.x, A.r[e2][0], A.r[e2][1]], p2 = [B.x, B.r[e2][0], B.r[e2][1]], p3 = [B.x, B.r[e][0], B.r[e][1]];
            const ux = p3[0] - p1[0], uy = p3[1] - p1[1], uz = p3[2] - p1[2], vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const l = Math.hypot(nx, ny, nz);
            if (l < 1e-8) continue;
            nx /= l; ny /= l; nz /= l;
            const base = b.vertexCount;
            for (const [p, S] of [[p0, A], [p1, A], [p2, B], [p3, B]]) {
                let a = nx, bb = ny, cc = nz;
                if (smooth) {
                    const cz = S.r.reduce((s, q) => s + q[1], 0) / n;
                    const dy = p[1], dz = p[2] - cz, d = Math.hypot(dy, dz) || 1;
                    a = 0; bb = dy / d; cc = dz / d;
                }
                b.vertex(p[0], p[1], p[2], a, bb, cc, col[0], col[1], col[2]);
            }
            b.quad(base, base + 1, base + 2, base + 3);
        }
    }
    [[stations[0], caps[0], -1], [stations[stations.length - 1], caps[1], 1]].forEach(([S, col, dir]) => {
        if (!col) return;
        const cz = S.r.reduce((s, q) => s + q[1], 0) / n;
        const c = b.vertex(S.x, 0, cz, dir, 0, 0, col[0], col[1], col[2]);
        const first = b.vertexCount;
        for (const q of S.r) b.vertex(S.x, q[0], q[1], dir, 0, 0, col[0], col[1], col[2]);
        for (let i = 0; i < n; i++) b.tri(c, first + i, first + ((i + 1) % n));
    });
}

/** Stations from a table of [x, zb, zs, zr, wb, wr] rows (x metres, widths already half-widths). */
export const stations = rows => rows.map(([x, zb, zs, zr, wb, wr, rd]) => ({ x, r: ring({ wb, wr, zb, zs, zr, rd }) }));

// ---- wheels ---------------------------------------------------------------------------------------------------

const toLateral = () => { const m = new Float64Array(16); m[0] = 1; m[6] = -1; m[9] = 1; m[15] = 1; return m; }; // z axis -> y axis

/** A wheel with a tyre of the given thickness (fraction of radius), a rim/disc colour and spoke bars. */
function wheel({ tyre = 0.2, width = 1, disc = '#9a9a9a', hub = '#c8c8c8', spokes = 0, spokeCol = '#b8b8b8', spokeW = 0.1, dish = 0.04, seg = 14, tyreCol = '#131313' }) {
    const t = createBuilder(), hw = width / 2;
    const inner = 1 - tyre;
    compose.cylinder(t, 0, 0, -hw, 1, width, seg, hex(tyreCol));
    for (const z of [-hw - dish, hw + dish - 0.001]) compose.cylinder(t, 0, 0, z, inner, 0.001 + dish, seg, hex(disc), { caps: true });
    compose.cylinder(t, 0, 0, -hw - dish * 1.5, inner * 0.28, hw * 2 + dish * 3, 8, hex(hub));
    const turned = transformMesh(t.finish(), toLateral());
    const parts = [turned];
    if (spokes) {
        const s = createBuilder();
        for (let k = 0; k < spokes; k++) {
            const a = (k / spokes) * Math.PI; // each bar crosses the hub: spokes bars => 2 * spokes spokes
            const c = Math.cos(a), sn = Math.sin(a);
            const half = inner * 1.02, y = hw + dish + 0.002;
            for (const side of [-1, 1]) {
                const q = [[-half, -spokeW], [half, -spokeW], [half, spokeW], [-half, spokeW]].map(([u, v]) => [u * c - v * sn, side * y, u * sn + v * c]);
                const base = s.vertexCount;
                for (const p of q) s.vertex(p[0], p[1], p[2], 0, side, 0, ...hex(spokeCol));
                s.quad(base, base + 1, base + 2, base + 3);
            }
        }
        parts.push(s.finish());
    }
    return mergeMeshes(parts);
}

/** Wheel templates by kind: 'spoke' wooden/wire spokes on a thin tyre, 'disc' pressed steel, 'alloy' five-spoke, 'truck' wide steel wheel, 'tread' chunky tractor tyre, 'cycle' thin spoked. */
export const WHEEL_KINDS = {
    spoke: () => wheel({ tyre: 0.14, width: 0.7, disc: '#6a4e30', hub: '#b9a46a', spokes: 6, spokeCol: '#a9885a', spokeW: 0.06, dish: 0.0 }),
    disc: () => wheel({ tyre: 0.26, width: 1, disc: '#8d9296', hub: '#d3d6d9', dish: 0.03 }),
    alloy: () => wheel({ tyre: 0.3, width: 1, disc: '#2a2c2e', hub: '#9ea3a8', spokes: 5, spokeCol: '#b6bbc0', spokeW: 0.11, dish: 0.03, seg: 16 }),
    truck: () => wheel({ tyre: 0.3, width: 1, disc: '#7e8286', hub: '#4a4d50', dish: 0.04 }),
    tread: () => wheel({ tyre: 0.42, width: 1, disc: '#c0392b', hub: '#e0e0e0', dish: 0.03, tyreCol: '#181818' }),
    cycle: () => wheel({ tyre: 0.07, width: 1, disc: '#2d2d2d', hub: '#b0b0b0', spokes: 8, spokeCol: '#9a9a9a', spokeW: 0.012, dish: 0.0, seg: 16 }),
};
