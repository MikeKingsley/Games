// Terrain and road-grade statistics for Delivery Driver (Phase 8 check): samples terrainHeight on a grid and prints the
// land height range and the share of road length steeper than each grade bracket, plus how far grading moved roads
// from the terrain.   node scripts/terrain-stats.mjs
import { seedWithBaked } from '../tests/js/helpers/delivery-seed.mjs';
import { createWorld } from '../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { terrainHeight, gradeLimit } from '../Games.Client/wwwroot/games/delivery-driver/world/terrain.js';
import { pointAt } from '../Games.Client/wwwroot/games/delivery-driver/world/geom.js';
import { WORLD_SCALE } from '../Games.Client/wwwroot/games/delivery-driver/config.js';

const w = createWorld(seedWithBaked()); const r = w.region;
let landMax = -Infinity, landMin = Infinity, seaMin = Infinity;
for (let x = r.bounds.minX; x < r.bounds.maxX; x += 60) for (let y = r.bounds.minY; y < r.bounds.maxY; y += 60) {
    const h = terrainHeight(r, x, y);
    if (h >= 0) { landMax = Math.max(landMax, h); landMin = Math.min(landMin, h); } else seaMin = Math.min(seaMin, h);
}
console.log(`land ${landMin.toFixed(1)} .. ${landMax.toFixed(1)} world m (${(landMax / WORLD_SCALE).toFixed(0)} real m), sea floor down to ${seaMin.toFixed(1)}`);
const brackets = [0.03, 0.05, 0.08, 0.1, 0.12, 0.15], above = Object.fromEntries(brackets.map(b => [b, 0]));
let total = 0, over = 0, moved = 0, maxMove = 0, edges = 0;
for (const e of w.graph.edges) {
    if (!e.z || e.cls === 'ferry' || e.bridge) continue;
    edges++;
    const n = e.z.length, step = e.len / (n - 1) || 1, lim = gradeLimit(r, e);
    let worst = 0, move = 0;
    for (let k = 0; k < n; k++) {
        if (k) { const g = Math.abs(e.z[k] - e.z[k - 1]) / step; worst = Math.max(worst, g); for (const b of brackets) if (g > b) above[b] += step; }
        const p = pointAt(e.pts, (k / (n - 1)) * e.len);
        move = Math.max(move, Math.abs(e.z[k] - terrainHeight(r, p.x, p.y)));
    }
    total += e.len;
    if (worst > lim * 1.05) over++;
    if (move > 1.5) moved++;
    maxMove = Math.max(maxMove, move);
}
console.log(`roads: ${edges} edges, ${(total / 1000).toFixed(0)} world km; over their class limit: ${over}; cut/fill > 1.5 m: ${moved}; largest cut/fill ${maxMove.toFixed(1)} m`);
console.log('share of road length steeper than', brackets.map(b => `${(b * 100).toFixed(0)}%: ${((100 * above[b]) / total).toFixed(1)}%`).join('  '));
