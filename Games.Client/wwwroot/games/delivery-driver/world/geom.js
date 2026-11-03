// Polyline helpers. Polylines are flat arrays [x0, y0, x1, y1, ...].

export function polyLength(pts) {
    let len = 0;
    for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    return len;
}

/** Point and direction at distance `d` along a polyline (clamped to its ends). */
export function pointAt(pts, d, out = { x: 0, y: 0, angle: 0, seg: 0 }) {
    let acc = 0;
    for (let i = 2; i < pts.length; i += 2) {
        const dx = pts[i] - pts[i - 2], dy = pts[i + 1] - pts[i - 1];
        const len = Math.hypot(dx, dy);
        if (acc + len >= d || i === pts.length - 2) {
            const t = len ? Math.max(0, Math.min(1, (d - acc) / len)) : 0;
            out.x = pts[i - 2] + dx * t;
            out.y = pts[i - 1] + dy * t;
            out.angle = Math.atan2(dy, dx);
            out.seg = i / 2 - 1;
            return out;
        }
        acc += len;
    }
    out.x = pts[0]; out.y = pts[1]; out.angle = 0; out.seg = 0;
    return out;
}

/** Closest point on a polyline: {d (distance), x, y, along (distance from the start), seg, angle}. */
export function closestOnPoly(pts, px, py) {
    let best = { d: Infinity, x: 0, y: 0, along: 0, seg: 0, angle: 0 };
    let acc = 0;
    for (let i = 2; i < pts.length; i += 2) {
        const ax = pts[i - 2], ay = pts[i - 1], bx = pts[i], by = pts[i + 1];
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const len = Math.sqrt(len2);
        const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
        const cx = ax + dx * t, cy = ay + dy * t;
        const d = Math.hypot(px - cx, py - cy);
        if (d < best.d) best = { d, x: cx, y: cy, along: acc + len * t, seg: i / 2 - 1, angle: Math.atan2(dy, dx) };
        acc += len;
    }
    return best;
}

/** Splits a polyline at a distance along it into two polylines sharing the split point. */
export function splitPoly(pts, d) {
    const p = pointAt(pts, d);
    const k = p.seg + 1; // first vertex after the split
    const a = pts.slice(0, k * 2);
    a.push(p.x, p.y);
    const b = [p.x, p.y, ...pts.slice(k * 2)];
    return [dedupe(a), dedupe(b)];
}

function dedupe(pts) {
    const out = [pts[0], pts[1]];
    for (let i = 2; i < pts.length; i += 2) {
        if (Math.hypot(pts[i] - out[out.length - 2], pts[i + 1] - out[out.length - 1]) > 0.01) out.push(pts[i], pts[i + 1]);
    }
    if (out.length < 4) out.push(pts[pts.length - 2] + 0.01, pts[pts.length - 1]);
    return out;
}

/** Centripetal-ish Catmull-Rom smoothing through the points, resampled every `step` metres. */
export function smooth(pts, step = 20) {
    const n = pts.length / 2;
    if (n < 3) return resample(pts, step);
    const P = i => [pts[2 * Math.max(0, Math.min(n - 1, i))], pts[2 * Math.max(0, Math.min(n - 1, i)) + 1]];
    const out = [pts[0], pts[1]];
    for (let i = 0; i < n - 1; i++) {
        const [x0, y0] = P(i - 1), [x1, y1] = P(i), [x2, y2] = P(i + 1), [x3, y3] = P(i + 2);
        const segs = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step));
        for (let s = 1; s <= segs; s++) {
            const t = s / segs, t2 = t * t, t3 = t2 * t;
            const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
            out.push(f(x0, x1, x2, x3), f(y0, y1, y2, y3));
        }
    }
    return out;
}

/** Straight-line resampling every `step` metres (keeps the original vertices). */
export function resample(pts, step) {
    const out = [pts[0], pts[1]];
    for (let i = 2; i < pts.length; i += 2) {
        const ax = pts[i - 2], ay = pts[i - 1], bx = pts[i], by = pts[i + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
        for (let s = 1; s <= n; s++) out.push(ax + ((bx - ax) * s) / n, ay + ((by - ay) * s) / n);
    }
    return out;
}

/** Polyline bounding box. */
export function bbox(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
        if (pts[i] < minX) minX = pts[i];
        if (pts[i] > maxX) maxX = pts[i];
        if (pts[i + 1] < minY) minY = pts[i + 1];
        if (pts[i + 1] > maxY) maxY = pts[i + 1];
    }
    return { minX, minY, maxX, maxY };
}

export const reversePoly = pts => {
    const out = new Array(pts.length);
    for (let i = 0; i < pts.length; i += 2) { out[pts.length - 2 - i] = pts[i]; out[pts.length - 1 - i] = pts[i + 1]; }
    return out;
};
