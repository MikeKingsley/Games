// Caches of pre-built drawing data. Ground detail is turned into Path2D objects in WORLD coordinates once per
// chunk/edge and then filled every frame under the ground transform (cheaper than offscreen canvases here, and it
// stays sharp at every zoom). The cache is LRU-capped by the quality preset.

export function createSpriteCache(cap = 48) {
    const map = new Map();
    return {
        get(key, build) {
            let v = map.get(key);
            if (v) { map.delete(key); map.set(key, v); return v; }
            v = build();
            map.set(key, v);
            while (map.size > cap) map.delete(map.keys().next().value);
            return v;
        },
        setCap(next) { cap = next; while (map.size > cap) map.delete(map.keys().next().value); },
        clear() { map.clear(); },
        get size() { return map.size; },
    };
}

/** A Path2D of flat polygons ([x0, y0, ...] each). */
export function polygonsPath(list) {
    const path = new Path2D();
    for (const pts of list) {
        path.moveTo(pts[0], pts[1]);
        for (let k = 2; k < pts.length; k += 2) path.lineTo(pts[k], pts[k + 1]);
        path.closePath();
    }
    return path;
}

/** A Path2D of an open polyline. */
export function polylinePath(pts) {
    const path = new Path2D();
    path.moveTo(pts[0], pts[1]);
    for (let k = 2; k < pts.length; k += 2) path.lineTo(pts[k], pts[k + 1]);
    return path;
}

/**
 * Sets the canvas transform so that WORLD (x, y) on the ground plane maps to screen pixels: the oblique projection
 * of the ground is affine, so the canvas can draw world-space paths (and line widths in metres) directly.
 */
export function groundTransform(ctx, p, dpr) {
    const a = p.zoom * p.cos, b = -p.zoom * p.tilt * p.sin;
    const c = p.zoom * p.sin, d = p.zoom * p.tilt * p.cos;
    const e = p.ox - (a * p.cx + c * p.cy), f = p.oy - (b * p.cx + d * p.cy);
    ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
}
