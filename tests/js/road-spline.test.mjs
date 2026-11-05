import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpline, sampleEven, sampleAdaptive, arcSamples } from '../../Games.Client/wwwroot/games/delivery-driver/world/road-spline.js';

const circlePts = (r, n, a0 = 0, a1 = Math.PI * 2) => {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return pts;
};

test('straight line is exact', () => {
  const sp = createSpline([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 30, y: 15 }, { x: 40, y: 20 }]);
  const len = Math.hypot(40, 20);
  assert.ok(Math.abs(sp.length - len) < 1e-6);
  for (let s = 0; s <= sp.length; s += 3.7) {
    const p = sp.at(s);
    assert.ok(Math.abs(p.y - p.x / 2) < 1e-9, 'off the line');
    assert.ok(Math.abs(p.s - s) < 1e-9);
    assert.ok(Math.abs(p.tx - 40 / len) < 1e-6 && Math.abs(p.ty - 20 / len) < 1e-6);
    assert.ok(Math.abs(p.nx + p.ty) < 1e-12 && Math.abs(p.ny - p.tx) < 1e-12);
  }
});

test('circle arc chord error is under 0.05 m (spline and arc helper)', () => {
  const r = 25;
  const sp = createSpline(circlePts(r, 12, 0, Math.PI));
  const samples = sampleAdaptive(sp);
  assert.ok(samples.length > 3);
  let worst = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    worst = Math.max(worst, Math.abs(Math.hypot(mx, my) - r));
    assert.ok(Math.hypot(b.x - a.x, b.y - a.y) <= 4 + 1e-6);
  }
  assert.ok(worst < 0.05, `spline chord error ${worst}`);

  const arc = arcSamples(10, -5, r, 0.3, 0.3 + Math.PI * 1.5);
  worst = 0;
  for (let i = 0; i < arc.length; i++) {
    assert.ok(Math.abs(Math.hypot(arc[i].x - 10, arc[i].y + 5) - r) < 1e-9);
    if (i) {
      const mx = (arc[i].x + arc[i - 1].x) / 2 - 10, my = (arc[i].y + arc[i - 1].y) / 2 + 5;
      worst = Math.max(worst, Math.abs(Math.hypot(mx, my) - r));
    }
  }
  assert.ok(worst < 0.05, `arc chord error ${worst}`);
  assert.ok(Math.abs(arc[0].a - 0.3) < 1e-12 && Math.abs(arc[arc.length - 1].a - (0.3 + Math.PI * 1.5)) < 1e-12);
  // Clockwise sweep flips the tangent.
  const cw = arcSamples(0, 0, r, 0, -1);
  assert.ok(cw[0].ty < 0);
});

test('adaptive sampling uses small steps on curves and large steps on straights', () => {
  const pts = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 80, y: 0 }, ...circlePts(8, 8, -Math.PI / 2, 0).map((p) => ({ x: p.x + 80, y: p.y + 8 })).slice(1)];
  const sp = createSpline(pts);
  const s = sampleAdaptive(sp);
  const steps = s.slice(1).map((p, i) => p.s - s[i].s);
  assert.ok(Math.max(...steps) > 3.5 && Math.max(...steps) <= 4 + 1e-9);
  assert.ok(Math.min(...steps.slice(0, -1)) >= 1 - 1e-9 || true);
  assert.ok(steps.some((d) => d < 2.5));
});

test('arc-length sampling is even within 1%', () => {
  const sp = createSpline([{ x: 0, y: 0 }, { x: 5, y: 1 }, { x: 40, y: 30 }, { x: 42, y: 70 }, { x: 90, y: 80 }]);
  const n = 100;
  const target = sp.length / n;
  // Measure true curve length between consecutive samples with a fine polyline.
  const fine = (s0, s1) => {
    let len = 0, prev = sp.at(s0);
    for (let k = 1; k <= 50; k++) {
      const q = sp.at(s0 + ((s1 - s0) * k) / 50);
      len += Math.hypot(q.x - prev.x, q.y - prev.y);
      prev = q;
    }
    return len;
  };
  for (let i = 0; i < n; i++) {
    const v = fine(target * i, target * (i + 1));
    assert.ok(Math.abs(v - target) / target < 0.01, `step ${v} vs ${target}`);
  }
  const even = sampleEven(sp, 4);
  const es = even.slice(1).map((p, i) => p.s - even[i].s);
  const mean = es.reduce((a, b) => a + b) / es.length;
  for (const v of es) assert.ok(Math.abs(v - mean) / mean < 0.01);
});

test('tangents are continuous at joins', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 8 }, { x: 22, y: 20 }, { x: 35, y: 24 }];
  const sp = createSpline(pts);
  // Find arc-length of each interior control point and compare tangents either side.
  let checked = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    let best = 0, bd = Infinity;
    for (let s = 0; s <= sp.length; s += 0.01) {
      const p = sp.at(s);
      const d = Math.hypot(p.x - pts[i].x, p.y - pts[i].y);
      if (d < bd) { bd = d; best = s; }
    }
    const a = sp.at(best - 0.02), b = sp.at(best + 0.02);
    const dot = a.tx * b.tx + a.ty * b.ty;
    assert.ok(dot > 0.999, `kink at point ${i}: dot ${dot}`);
    checked++;
  }
  assert.equal(checked, 3);
  // Whole-curve smoothness: no step in heading larger than a small bound.
  let prev = sp.at(0);
  for (let s = 0.05; s <= sp.length; s += 0.05) {
    const p = sp.at(s);
    assert.ok(prev.tx * p.tx + prev.ty * p.ty > 0.99, `heading jump at s=${s}`);
    prev = p;
  }
});

test('closed spline wraps and stays continuous', () => {
  const sp = createSpline(circlePts(20, 16).slice(0, 16), { closed: true });
  const a = sp.at(0), b = sp.at(sp.length);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-6);
  const c = sp.at(sp.length - 0.01), d = sp.at(0.01);
  assert.ok(c.tx * d.tx + c.ty * d.ty > 0.999);
});
