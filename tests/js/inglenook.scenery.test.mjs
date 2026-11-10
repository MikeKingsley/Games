import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLayout } from '../../Games.Client/wwwroot/games/inglenook/layouts.js';
import { planScenery, leverKeepout, CLEAR, SHED_CLEAR, SUN, shadowOffset } from '../../Games.Client/wwwroot/games/inglenook/scenery-plan.js';

const LAYOUTS = ['classic', 'classic-long', 'ladder4', 'ladder5'];
const FIXED = ['shed', 'apron', 'signalbox', 'staithe', 'watertower', 'watercrane', 'office', 'lamp', 'tree', 'fence', 'gate'];
const rectOf = it => ({ x0: it.x - it.w / 2, y0: it.y - it.h / 2, x1: it.x + it.w / 2, y1: it.y + it.h / 2 });
const overlap = (a, b, eps = 1e-9) => a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.y0 < b.y1 - eps && b.y0 < a.y1 - eps;
const dist = (r, x, y) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.y0 - y, 0, y - r.y1));
const isFixed = it => !['sleepers', 'drums', 'barrow', 'coalheap', 'lorry'].includes(it.type);

test('every layout has the fixed anchors', () => {
    for (const id of LAYOUTS) {
        const types = new Set(planScenery(getLayout(id), 1).map(i => i.type));
        for (const t of FIXED) assert.ok(types.has(t), `${id} is missing ${t}`);
    }
});

test('placement rules hold for seeds 1-50 on every layout', () => {
    for (const id of LAYOUTS) {
        const layout = getLayout(id), b = layout.bounds;
        const keepouts = layout.pointIds.map(p => leverKeepout(layout, p));
        for (let seed = 1; seed <= 50; seed++) {
            const items = planScenery(layout, seed);
            items.forEach((it, i) => {
                const r = rectOf(it), tag = `${id} seed ${seed} ${it.type}#${i}`;
                assert.ok(r.x0 >= b.x && r.y0 >= b.y && r.x1 <= b.x + b.w && r.y1 <= b.y + b.h, `${tag} outside bounds`);
                for (const t of Object.values(layout.tracks)) {
                    const need = ['shed', 'apron', 'lorry'].includes(it.type) && t.id === layout.goal ? SHED_CLEAR : CLEAR;
                    for (const [x, y] of t.pts) assert.ok(dist(r, x, y) >= need - 1e-6, `${tag} within ${need} of track ${t.id}`);
                }
                for (const k of keepouts) assert.ok(!overlap(r, k), `${tag} covers a lever`);
                for (let j = i + 1; j < items.length; j++) {
                    const o = items[j];
                    if ((it.type === 'lorry' && o.type === 'apron') || (it.type === 'apron' && o.type === 'lorry')) continue;
                    assert.ok(!overlap(r, rectOf(o)), `${tag} overlaps ${o.type}#${j}`);
                }
            });
        }
    }
});

test('the plan is deterministic and the fixed anchors do not depend on the seed', () => {
    for (const id of LAYOUTS) {
        const layout = getLayout(id);
        assert.deepEqual(planScenery(layout, 7), planScenery(layout, 7));
        const base = planScenery(layout, 1).filter(isFixed);
        for (let seed = 2; seed <= 20; seed++) assert.deepEqual(planScenery(layout, seed).filter(isFixed), base);
    }
});

test('clutter varies with the seed', () => {
    const layout = getLayout('classic');
    const seen = new Set();
    for (let seed = 1; seed <= 20; seed++) seen.add(JSON.stringify(planScenery(layout, seed).filter(i => !isFixed(i))));
    assert.ok(seen.size > 5);
});

test('shadows fall down and to the right, longer for taller items', () => {
    assert.ok(SUN.dx > 0 && SUN.dy > 0);
    const a = shadowOffset(0.5), c = shadowOffset(2);
    assert.ok(a.x > 0 && a.y > 0 && c.x > a.x && c.y > a.y);
});
