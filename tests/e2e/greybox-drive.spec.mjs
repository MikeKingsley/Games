import { test, expect } from '@playwright/test';

// Greybox drive test (plan 0010 phase 7): the dev-only greybox page renders all six pieces with no console errors, and a
// simulated vehicle drives over and under the overbridge in the browser's own modules (the same code the game runs).
const BASE = '/games/delivery-driver';

test('greybox page renders and a vehicle drives over and under the overbridge', async ({ page }) => {
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`${BASE}/greybox/greybox.html`);
    await page.waitForFunction(() => window.__greybox && window.__greybox.frames > 2, null, { timeout: 30_000 });
    const status = await page.evaluate(() => window.__greybox);
    expect(status.error).toBeNull();
    expect(status.triangles).toBeGreaterThan(1000);

    const result = await page.evaluate(async base => {
        const { buildGreyboxWorld } = await import(`${base}/greybox/graph.js`);
        const { createVehicle, stepVehicle } = await import(`${base}/sim/vehicle.js`);
        const { vehicleById } = await import(`${base}/game/catalogue.js`);
        const { roadHeightAt, roadGradeAt } = await import(`${base}/world/terrain.js`);
        const world = buildGreyboxWorld();
        const spec = vehicleById('dart-3');
        const drive = (edge, vertical) => {
            // straight north-south or east-west edge: the driver steers by the cross-track error
            const ax = edge.pts[0], ay = edge.pts[1], bx = edge.pts[edge.pts.length - 2], by = edge.pts[edge.pts.length - 1];
            const len = Math.hypot(bx - ax, by - ay), h = Math.atan2(by - ay, bx - ax);
            const v = createVehicle(spec, { x: ax, y: ay, heading: h });
            v.speed = 6;
            let worstOff = 0, worstTop = -Infinity, peak = 0, steps = 0;
            while (steps++ < 60 * 90) {
                const along = (v.x - ax) * Math.cos(h) + (v.y - ay) * Math.sin(h);
                if (along >= len - 10) break;
                const cross = -(v.x - ax) * Math.sin(h) + (v.y - ay) * Math.cos(h);
                const g = { z: roadHeightAt(edge, along), grade: roadGradeAt(edge, along) };
                stepVehicle(v, { throttle: v.speed < 6 ? 0.6 : 0.1, brake: 0, steer: Math.max(-1, Math.min(1, -cross * 0.2 - (v.heading - h))) }, 1 / 60, { grade: g.grade, groundZ: g.z });
                worstOff = Math.max(worstOff, Math.abs(v.z - roadHeightAt(edge, along)));
                peak = Math.max(peak, v.z);
                // the crossing is at the middle of both edges: the deck underside there is the over road's height minus the slab
                if (Math.abs(along - len / 2) < 8) worstTop = Math.max(worstTop, v.z + spec.height);
            }
            return { worstOff, worstTop, peak, finished: steps < 60 * 90 };
        };
        const over = world.graph.edges.find(e => e.tag === 'overbridge-over');
        const under = world.graph.edges.find(e => e.tag === 'overbridge-under');
        return { over: drive(over), under: drive(under), deckTop: Math.max(...over.z) };
    }, BASE);

    expect(result.over.finished && result.under.finished).toBe(true);
    expect(result.over.worstOff).toBeLessThan(0.3);
    expect(result.over.peak).toBeGreaterThan(result.deckTop - 0.2);
    expect(result.under.worstOff).toBeLessThan(0.05);
    expect(result.under.worstTop).toBeLessThan(result.deckTop - 0.6);
    expect(errors).toEqual([]);
});

// Plan 0011 phase 8: every road-type, junction and roundabout piece loads in the greybox page with no console errors.
const NEW_PIECES = [
    'single-track', 'one-way-lane', 'two-way', 'multi-one-way', 'asymmetric', 'no-pavement',
    'signals-cross', 'tee-give-way', 'give-way-cross', 'crossroads-plain',
    'roundabout-small', 'roundabout-medium', 'roundabout-large', 'roundabout-double',
];
for (const id of NEW_PIECES) {
    test(`greybox piece ${id} renders with no console errors`, async ({ page }) => {
        const errors = [];
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${BASE}/greybox/greybox.html?piece=${id}`);
        await page.waitForFunction(() => window.__greybox && window.__greybox.frames > 2, null, { timeout: 30_000 });
        const status = await page.evaluate(() => window.__greybox);
        expect(status.error).toBeNull();
        expect(status.triangles).toBeGreaterThan(1000);
        expect(errors).toEqual([]);
    });
}
