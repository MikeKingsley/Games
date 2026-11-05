// Road centreline splines: centripetal Catmull-Rom through ordered {x, y} points,
// arc-length re-parameterised, plus adaptive sampling and a true circle-arc helper.
// Pure maths, no dependencies. Normal is the left normal: (-ty, tx).

export const SAMPLE_MIN_STEP = 1;      // metres where curvature is high
export const SAMPLE_MAX_STEP = 4;      // metres on straights
export const CHORD_TOLERANCE = 0.05;   // metres

const SUBDIV = 48; // arc-length table resolution per segment

function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

// Barry-Goldman evaluation of one centripetal segment p1->p2 at u in [0,1].
function evalSegment(p0, p1, p2, p3, alpha, u) {
  const t0 = 0;
  const t1 = t0 + Math.pow(dist(p0, p1), alpha) || 1e-6;
  const t2 = t1 + (Math.pow(dist(p1, p2), alpha) || 1e-6);
  const t3 = t2 + (Math.pow(dist(p2, p3), alpha) || 1e-6);
  const t = t1 + (t2 - t1) * u;
  const lerp = (a, b, ta, tb) => {
    const k = (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/**
 * Build a spline through `points` ([{x,y}, ...], at least 2).
 * Returns { length, closed, at(s), positionAt(s), sample(ss) }.
 * at(s) -> { x, y, tx, ty, nx, ny, s } for arc-length s (clamped, or wrapped if closed).
 */
export function createSpline(points, opts = {}) {
  const alpha = opts.alpha ?? 0.5;
  const closed = !!opts.closed;
  const pts = points.map((p) => ({ x: p.x, y: p.y }));
  if (pts.length < 2) throw new Error('createSpline needs at least 2 points');
  const n = pts.length;
  const segCount = closed ? n : n - 1;

  const get = (i) => {
    if (closed) return pts[((i % n) + n) % n];
    // Phantom end points extrapolate quadratically (keeps curvature, exact on lines).
    if (i < 0) {
      if (n === 2) return { x: 2 * pts[0].x - pts[1].x, y: 2 * pts[0].y - pts[1].y };
      return { x: 3 * pts[0].x - 3 * pts[1].x + pts[2].x, y: 3 * pts[0].y - 3 * pts[1].y + pts[2].y };
    }
    if (i >= n) {
      if (n === 2) return { x: 2 * pts[1].x - pts[0].x, y: 2 * pts[1].y - pts[0].y };
      return { x: 3 * pts[n - 1].x - 3 * pts[n - 2].x + pts[n - 3].x, y: 3 * pts[n - 1].y - 3 * pts[n - 2].y + pts[n - 3].y };
    }
    return pts[i];
  };

  const evalParam = (seg, u) => evalSegment(get(seg - 1), get(seg), get(seg + 1), get(seg + 2), alpha, u);

  // Arc-length table: cumulative length at each (seg, u) sample.
  const tabS = [0];
  const tabSeg = [0];
  const tabU = [0];
  let prev = evalParam(0, 0);
  let total = 0;
  for (let seg = 0; seg < segCount; seg++) {
    for (let k = 1; k <= SUBDIV; k++) {
      const u = k / SUBDIV;
      const p = evalParam(seg, u);
      total += dist(prev, p);
      prev = p;
      tabS.push(total);
      tabSeg.push(seg);
      tabU.push(u);
    }
  }

  // Map arc length to (seg, u) via binary search + linear interpolation.
  const locate = (s) => {
    let lo = 0, hi = tabS.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tabS[mid] <= s) lo = mid; else hi = mid;
    }
    const span = tabS[hi] - tabS[lo];
    const f = span > 0 ? (s - tabS[lo]) / span : 0;
    // Entries at u=1 of seg k and u=1/SUBDIV of seg k+1 never straddle a seg change
    // except at index boundaries; handle by working in global segment coordinates.
    const g0 = tabSeg[lo] + tabU[lo];
    const g1 = tabSeg[hi] + tabU[hi];
    const g = g0 + (g1 - g0) * f;
    let seg = Math.min(segCount - 1, Math.floor(g));
    let u = g - seg;
    if (u < 0) u = 0;
    if (u > 1) u = 1;
    return { seg, u };
  };

  const clampS = (s) => {
    if (closed) return ((s % total) + total) % total;
    return Math.max(0, Math.min(total, s));
  };

  const H = 1e-4;
  const at = (sIn) => {
    const s = clampS(sIn);
    const { seg, u } = locate(s);
    const p = evalParam(seg, u);
    // Tangent from a one-sided-safe central difference inside the segment.
    const ua = Math.max(0, u - H), ub = Math.min(1, u + H);
    const pa = evalParam(seg, ua), pb = evalParam(seg, ub);
    let tx = pb.x - pa.x, ty = pb.y - pa.y;
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    return { x: p.x, y: p.y, tx, ty, nx: -ty, ny: tx, s };
  };

  return {
    length: total,
    closed,
    at,
    positionAt: (s) => { const r = at(s); return { x: r.x, y: r.y }; },
    sample: (ss) => ss.map(at),
  };
}

/** Evenly spaced samples (arc length) of at most `step` metres apart, including both ends. */
export function sampleEven(spline, step = SAMPLE_MAX_STEP) {
  const count = Math.max(1, Math.ceil(spline.length / step));
  const out = [];
  for (let i = 0; i <= count; i++) out.push(spline.at((spline.length * i) / count));
  return out;
}

/**
 * Adaptive sampling: step between minStep and maxStep, shrinking until the chord
 * between consecutive samples deviates from the curve by no more than `tol`.
 * Returns an array of at() results, always including both ends.
 */
export function sampleAdaptive(spline, opts = {}) {
  const minStep = opts.minStep ?? SAMPLE_MIN_STEP;
  const maxStep = opts.maxStep ?? SAMPLE_MAX_STEP;
  const tol = opts.tol ?? CHORD_TOLERANCE;
  const L = spline.length;
  const out = [spline.at(0)];
  let s = 0;
  while (s < L - 1e-9) {
    let h = Math.min(maxStep, L - s);
    for (;;) {
      const a = spline.at(s), b = spline.at(s + h), m = spline.at(s + h / 2);
      const cx = b.x - a.x, cy = b.y - a.y;
      const cl = Math.hypot(cx, cy);
      const err = cl > 0 ? Math.abs((m.x - a.x) * cy - (m.y - a.y) * cx) / cl : 0;
      if (err <= tol || h <= minStep) break;
      h = Math.max(minStep, h / 2);
    }
    // Avoid a tiny trailing sliver.
    if (L - (s + h) < minStep * 0.5) h = L - s;
    s += h;
    out.push(spline.at(s));
  }
  return out;
}

/**
 * True circular arc (roundabout rings). Angles in radians, a1 may be less than a0
 * for clockwise travel. Returns samples { x, y, tx, ty, nx, ny, s, a } with the
 * chord error held to `tol` (step limited by maxStep and by minStep).
 */
export function arcSamples(cx, cy, radius, a0, a1, opts = {}) {
  const minStep = opts.minStep ?? SAMPLE_MIN_STEP;
  const maxStep = opts.maxStep ?? SAMPLE_MAX_STEP;
  const tol = opts.tol ?? CHORD_TOLERANCE;
  const sweep = a1 - a0;
  const dir = sweep >= 0 ? 1 : -1;
  const length = Math.abs(sweep) * radius;
  // Sagitta r(1 - cos(d/2)) <= tol  ->  d = 2 acos(1 - tol/r)
  const maxAng = tol < radius ? 2 * Math.acos(1 - tol / radius) : Math.PI;
  const stepLen = Math.max(minStep, Math.min(maxStep, maxAng * radius));
  const count = Math.max(1, Math.ceil(length / stepLen - 1e-9));
  const out = [];
  for (let i = 0; i <= count; i++) {
    const a = a0 + (sweep * i) / count;
    const ca = Math.cos(a), sa = Math.sin(a);
    const tx = -sa * dir, ty = ca * dir;
    out.push({
      x: cx + radius * ca, y: cy + radius * sa,
      tx, ty, nx: -ty, ny: tx,
      s: (length * i) / count, a,
    });
  }
  return out;
}
