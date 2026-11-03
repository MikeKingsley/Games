// Oriented bounding boxes, separating-axis test, penetration resolution and a spatial-hash broad phase.
// An OBB is {x, y, hx, hy, angle}: centre, half-length along its angle, half-width across it.

export function obb(x, y, length, width, angle) {
    return { x, y, hx: length / 2, hy: width / 2, angle };
}

/** The four corners of an OBB, anticlockwise from front-left. */
export function corners(b, out = []) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    const pts = [[b.hx, b.hy], [b.hx, -b.hy], [-b.hx, -b.hy], [-b.hx, b.hy]];
    for (let i = 0; i < 4; i++) {
        const [u, v] = pts[i];
        out[i] = { x: b.x + u * c - v * s, y: b.y + u * s + v * c };
    }
    return out;
}

/** Projection radius of a box onto a unit axis. */
function radiusOn(b, ax, ay) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    return b.hx * Math.abs(c * ax + s * ay) + b.hy * Math.abs(-s * ax + c * ay);
}

/**
 * SAT test. Returns null when separated, otherwise {nx, ny, depth}: the minimum translation axis pointing from
 * b toward a (move a by +n*depth, or b by -n*depth, to separate them).
 */
export function sat(a, b) {
    const axes = [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2];
    const dx = a.x - b.x, dy = a.y - b.y;
    let best = null;
    for (const ang of axes) {
        const ax = Math.cos(ang), ay = Math.sin(ang);
        const dist = dx * ax + dy * ay;
        const overlap = radiusOn(a, ax, ay) + radiusOn(b, ax, ay) - Math.abs(dist);
        if (overlap <= 0) return null;
        if (!best || overlap < best.depth) {
            const sgn = dist < 0 ? -1 : 1;
            best = { nx: ax * sgn, ny: ay * sgn, depth: overlap };
        }
    }
    return best;
}

/**
 * Resolves a contact between two bodies with velocities (vx, vy) and inverse masses (0 = static).
 * Pushes them apart and removes the closing velocity along the normal (with a little bounce).
 * Returns the impact (closing) speed in m/s; 0 if they were already separating.
 */
export function resolve(a, b, contact, restitution = 0.15) {
    const { nx, ny, depth } = contact;
    const wa = a.invMass ?? 1, wb = b.invMass ?? 0;
    const w = wa + wb || 1;
    a.x += nx * depth * (wa / w); a.y += ny * depth * (wa / w);
    b.x -= nx * depth * (wb / w); b.y -= ny * depth * (wb / w);
    const rvx = (a.vx ?? 0) - (b.vx ?? 0), rvy = (a.vy ?? 0) - (b.vy ?? 0);
    const closing = -(rvx * nx + rvy * ny);
    if (closing <= 0) return 0;
    const j = (closing * (1 + restitution)) / w;
    if (a.vx !== undefined) { a.vx += j * wa * nx; a.vy += j * wa * ny; }
    if (b.vx !== undefined) { b.vx -= j * wb * nx; b.vy -= j * wb * ny; }
    return closing;
}

/** Spatial hash grid for static obstacles (and, rebuilt per step, moving ones). */
export function createSpatialHash(cell = 16) {
    const cells = new Map();
    const key = (i, j) => i * 73856093 ^ j * 19349663;
    function range(b) {
        const r = Math.hypot(b.hx, b.hy);
        return [Math.floor((b.x - r) / cell), Math.floor((b.y - r) / cell), Math.floor((b.x + r) / cell), Math.floor((b.y + r) / cell)];
    }
    return {
        insert(item) {
            const [i0, j0, i1, j1] = range(item.box);
            for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
                const k = key(i, j);
                let list = cells.get(k);
                if (!list) cells.set(k, (list = []));
                list.push(item);
            }
        },
        remove(item) {
            const [i0, j0, i1, j1] = range(item.box);
            for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
                const list = cells.get(key(i, j));
                const at = list ? list.indexOf(item) : -1;
                if (at >= 0) list.splice(at, 1);
            }
        },
        /** Items whose cells overlap the box (deduplicated). */
        query(box, out = []) {
            out.length = 0;
            const seen = new Set();
            const [i0, j0, i1, j1] = range(box);
            for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
                const list = cells.get(key(i, j));
                if (!list) continue;
                for (const it of list) if (!seen.has(it)) { seen.add(it); out.push(it); }
            }
            return out;
        },
        clear() { cells.clear(); },
        get size() { return cells.size; },
    };
}
