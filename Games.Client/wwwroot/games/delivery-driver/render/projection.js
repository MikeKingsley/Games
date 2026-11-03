// Oblique faux-3D projection. The ground plane is rotated about the camera centre, squashed vertically by `tilt`,
// and heights (z, metres) lift points straight up the screen by `height` px per metre per zoom.

/** Default faux-3D look: the ground is seen at an angle and buildings rise up the screen. */
export const TILT = 0.78;
export const HEIGHT = 0.62;

export function createProjection() {
    return { cx: 0, cy: 0, rot: 0, zoom: 8, tilt: TILT, height: HEIGHT, ox: 0, oy: 0, cos: 1, sin: 0, width: 1, height_px: 1 };
}

/** Sets the camera centre (world), rotation (radians: world angle that points up the screen) and screen anchor. */
export function setProjection(p, { cx, cy, rot, zoom, ox, oy, width, height }) {
    p.cx = cx; p.cy = cy; p.rot = rot; p.zoom = zoom; p.ox = ox; p.oy = oy;
    p.cos = Math.cos(rot); p.sin = Math.sin(rot);
    if (width !== undefined) p.width = width;
    if (height !== undefined) p.height_px = height;
    return p;
}

/** World (x, y, z) to screen pixels. Writes into `out` (to avoid per-frame allocation) and returns it. */
export function toScreen(p, x, y, z = 0, out = { x: 0, y: 0 }) {
    const dx = x - p.cx, dy = y - p.cy;
    const rx = dx * p.cos + dy * p.sin;
    const ry = -dx * p.sin + dy * p.cos;
    out.x = p.ox + rx * p.zoom;
    out.y = p.oy + ry * p.zoom * p.tilt - z * p.zoom * p.height;
    return out;
}

/** Screen pixels to the world point on the ground (z = 0). */
export function toWorld(p, sx, sy, out = { x: 0, y: 0 }) {
    const rx = (sx - p.ox) / p.zoom;
    const ry = (sy - p.oy) / (p.zoom * p.tilt);
    out.x = p.cx + rx * p.cos - ry * p.sin;
    out.y = p.cy + rx * p.sin + ry * p.cos;
    return out;
}

/** Depth for painter's sorting: larger = nearer the viewer (drawn later). */
export function depth(p, x, y) {
    return -(x - p.cx) * p.sin + (y - p.cy) * p.cos;
}

/** World-space radius around the camera centre that covers the whole screen (for culling), plus a margin. */
export function viewRadius(p, margin = 20) {
    const w = Math.max(p.ox, p.width - p.ox) / p.zoom;
    const h = Math.max(p.oy, p.height_px - p.oy) / (p.zoom * p.tilt);
    return Math.hypot(w, h) + margin;
}
