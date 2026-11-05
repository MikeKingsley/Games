// Canvas renderer: ground layers under an affine ground transform, then depth-sorted buildings, trees and
// vehicles in screen space. Culled to the chunks around the camera.
import { toScreen, depth, viewRadius } from './projection.js';
import { drawVehicle, drawTrailer } from './draw-vehicles.js';
import { drawBase, drawRivers, drawTowns, drawChunkGround, drawYard, drawCoast, drawMoorPatches, drawHarbours, drawPractice, COLOURS } from './draw-terrain.js';
import { drawRoads, drawJunctions, drawBridges } from './draw-road.js';
import { drawBuilding, drawTree, drawRock, drawCone } from './draw-buildings.js';
import { groundTransform } from './sprite-cache.js';
import { drawLamp, drawSign, drawSignals } from './era.js';
import { isLive } from '../world/furniture.js';
import { junctionType } from '../world/roadgraph.js';
import { bbox } from '../world/geom.js';
import { signalPhase } from '../traffic/traffic.js';
import { drawNightGround, drawDusk, drawHeadlights, drawRain, drawFog } from './draw-weather.js';
import { bodyCentre } from '../sim/vehicle.js';
import { QUALITY } from '../config.js';

/** Interpolated pose between the previous and current simulation step. */
export function lerpPose(v, alpha, out = { x: 0, y: 0, heading: 0 }) {
    let dh = v.heading - v.prevHeading;
    if (dh > Math.PI) dh -= 2 * Math.PI; else if (dh < -Math.PI) dh += 2 * Math.PI;
    out.x = v.prevX + (v.x - v.prevX) * alpha;
    out.y = v.prevY + (v.y - v.prevY) * alpha;
    out.heading = v.prevHeading + dh * alpha;
    return out;
}

export function createRenderer(ctx, view) {
    const pose = { x: 0, y: 0, heading: 0 };
    const trailerPoseTmp = { x: 0, y: 0, heading: 0 };
    const drawables = [];
    const edgeIds = new Set();
    const nodeIds = new Set();
    const sp = { x: 0, y: 0 };
    let pool = [];
    let used = 0;
    const item = (kind, ref, d) => {
        let it = pool[used];
        if (!it) pool[used] = it = { kind: '', ref: null, d: 0 };
        used++;
        it.kind = kind; it.ref = ref; it.d = d;
        return it;
    };

    function loading(text) {
        ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
        ctx.fillStyle = '#2b3a22';
        ctx.fillRect(0, 0, view.width, view.height);
        ctx.fillStyle = '#f4f1e8';
        ctx.font = '600 20px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(text, view.width / 2, view.height / 2);
        ctx.textAlign = 'start';
    }

    return {
        stats: { buildings: 0, chunks: 0, drawables: 0 },
        draw(session, camera, alpha) {
            const world = session.world;
            if (!world) { loading(session.loadingText ?? 'Loading Devon & Cornwall…'); return; }
            const p = camera.proj;
            const q = QUALITY[session.settings.quality] ?? QUALITY.medium;
            const year = session.year ?? 1919;
            const light = session.light ?? 1;
            const r = viewRadius(p, 25);
            const vw = { x: p.cx, y: p.cy, r };
            const chunks = world.chunks.around(p.cx, p.cy, r + 30, session.chunkBudget ?? 3);
            const detail = p.zoom > 2.5;

            // ---- ground (world coordinates) ----
            ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
            ctx.fillStyle = COLOURS.sea;
            ctx.fillRect(0, 0, view.width, view.height);
            groundTransform(ctx, p, view.dpr);
            drawBase(ctx, world.region, light);
            drawCoast(ctx, world.region, vw);
            drawTowns(ctx, world.region, vw);
            for (const c of chunks) { drawChunkGround(ctx, c, detail && q.trees > 0.5); drawMoorPatches(ctx, c); }
            drawRivers(ctx, world.region, vw);
            drawHarbours(ctx, world, vw);
            edgeIds.clear();
            nodeIds.clear();
            // only edges that reach into the view circle (a chunk's edge list also holds roads far off its corner), and
            // not the small streets and lanes when zoomed right out (the real network has thousands of short edges)
            for (const c of chunks) {
                for (const id of c.edges) {
                    const e = world.graph.edges[id];
                    if (!detail && (e.cls === 'street' || e.cls === 'lane' || e.cls === 'access')) continue;
                    const bb = (e._bb ??= bbox(e.pts));
                    const dx = Math.max(bb.minX - p.cx, 0, p.cx - bb.maxX), dy = Math.max(bb.minY - p.cy, 0, p.cy - bb.maxY);
                    if (dx * dx + dy * dy <= (r + 12) * (r + 12)) edgeIds.add(id);
                }
            }
            for (const id of edgeIds) { const e = world.graph.edges[id]; nodeIds.add(e.a); nodeIds.add(e.b); }
            for (const y of world.yards) {
                if (Math.hypot(y.yard.zone.x - p.cx, y.yard.zone.y - p.cy) < r + 40) drawYard(ctx, y, y === session.activeYard);
            }
            if (Math.hypot(world.practice.x - p.cx, world.practice.y - p.cy) < r + 120) drawPractice(ctx, world.practice, session.practiceBay ?? 1);
            drawRoads(ctx, world.graph, edgeIds, year, detail, world.region, session.weather?.kind === 'rain');
            drawJunctions(ctx, world.graph, nodeIds, year);
            drawBridges(ctx, world.graph, edgeIds, year, world.region);
            if (session.drawGroundOverlay) session.drawGroundOverlay(ctx);

            // ---- night on the ground, then headlights (objects are shaded by `light` as they're drawn) ----
            ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
            drawNightGround(ctx, view, light);
            if (light < 0.75) {
                ctx.globalCompositeOperation = 'lighter';
                const strength = (0.75 - light) / 0.45;
                const pl = session.player;
                const front = pl.spec.length - pl.spec.rearOverhang;
                drawHeadlights(ctx, p, pl.x + Math.cos(pl.heading) * front, pl.y + Math.sin(pl.heading) * front, pl.heading, year, strength);
                for (const v of session.vehicles ?? []) {
                    if (v.type === 'bicycle' || v.type === 'cart' || (v.x - p.cx) ** 2 + (v.y - p.cy) ** 2 > r * r) continue;
                    drawHeadlights(ctx, p, v.x + Math.cos(v.heading) * v.spec.len / 2, v.y + Math.sin(v.heading) * v.spec.len / 2, v.heading, year, strength * 0.8);
                }
                ctx.globalCompositeOperation = 'source-over';
            }

            // ---- objects (screen space, painter's order) ----
            used = 0;
            drawables.length = 0;
            let buildings = 0;
            const r2 = (r + 15) * (r + 15);
            const near = (x, y) => (x - p.cx) * (x - p.cx) + (y - p.cy) * (y - p.cy) < r2;
            for (const c of chunks) {
                for (const b of c.buildings) if (near(b.x, b.y)) { drawables.push(item('b', b, depth(p, b.x, b.y))); buildings++; }
                const treeStep = q.trees >= 1 ? 1 : q.trees >= 0.7 ? 1.4 : 2.5;
                for (let k = 0; k < c.trees.length; k += treeStep) {
                    const t = c.trees[Math.floor(k)];
                    if (near(t.x, t.y)) drawables.push(item('t', t, depth(p, t.x, t.y)));
                }
                for (const rk of c.rocks) if (near(rk.x, rk.y)) drawables.push(item('r', rk, depth(p, rk.x, rk.y)));
                if (detail) {
                    for (const l of c.lamps ?? []) if (isLive(l, year) && near(l.x, l.y)) drawables.push(item('l', l, depth(p, l.x, l.y)));
                    for (const sg of c.signs ?? []) if (isLive(sg, year) && near(sg.x, sg.y)) drawables.push(item('s', sg, depth(p, sg.x, sg.y)));
                }
            }
            for (const id of nodeIds) {
                const n = world.graph.nodes[id];
                if (n.junction === 'signals' && junctionType(n, year) === 'signals' && near(n.x, n.y)) drawables.push(item('tl', n, depth(p, n.x, n.y) + 7));
            }
            for (const cone of world.practice.cones) if (near(cone.x, cone.y)) drawables.push(item('cone', cone, depth(p, cone.x, cone.y)));
            for (const h of world.harbours) {
                if (!near(h.x, h.y)) continue;
                for (const w of h.walls) drawables.push(item('r', w, depth(p, w.x, w.y)));
                for (const b of h.boats) drawables.push(item('r', b, depth(p, b.x, b.y)));
            }
            for (const v of session.vehicles ?? []) if (near(v.x, v.y)) drawables.push(item('v', v, depth(p, v.x, v.y)));
            for (const pv of session.parked?.() ?? []) if (near(pv.pose.x, pv.pose.y)) drawables.push(item('pv', pv, depth(p, pv.pose.x, pv.pose.y)));
            for (const t of session.trailerObjs?.values() ?? []) if (near(t.x, t.y)) drawables.push(item('tr', t, depth(p, t.x, t.y)));
            const player = session.player;
            const pp = lerpPose(player, alpha, pose);
            const playerDepth = depth(p, pp.x, pp.y);
            drawables.push(item('p', player, playerDepth));
            drawables.sort((a, b) => a.d - b.d);
            const ps = toScreen(p, pp.x, pp.y, 1.5, sp);
            for (const it of drawables) {
                if (it.kind === 'b') {
                    // see-through when it stands between the viewer and the player's vehicle
                    const b = it.ref;
                    const fade = it.d > playerDepth && occludes(p, b, ps);
                    if (fade) ctx.globalAlpha = 0.35;
                    drawBuilding(ctx, p, b, light, detail && q.trees > 0.5, year);
                    if (fade) ctx.globalAlpha = 1;
                } else if (it.kind === 't') drawTree(ctx, p, it.ref, light);
                else if (it.kind === 'r') drawRock(ctx, p, it.ref, light);
                else if (it.kind === 'l') drawLamp(ctx, p, it.ref, year, light, light < 0.6);
                else if (it.kind === 'cone') drawCone(ctx, p, it.ref);
                else if (it.kind === 's') drawSign(ctx, p, it.ref, year, light);
                else if (it.kind === 'tl') drawSignals(ctx, p, it.ref, signalPhase(it.ref, session.traffic?.time ?? 0), light);
                else if (it.kind === 'v') session.drawTraffic?.(ctx, p, it.ref, alpha, light);
                else if (it.kind === 'pv') drawVehicle(ctx, p, it.ref.spec, it.ref.pose, { livery: session.livery, light });
                else if (it.kind === 'tr') {
                    const t = it.ref;
                    drawTrailer(ctx, p, t.spec, t.coupled || t.speed ? lerpPose(t, alpha, trailerPoseTmp) : t, { livery: t.client ? t.livery : session.livery, light, legsDown: !t.coupled, cargo: t.cargoMass > 0, brake: t.coupled && session.controls?.brake > 0 });
                }
                else drawVehicle(ctx, p, player.spec, pp, { livery: session.livery, brake: session.controls?.brake > 0, light, lamps: light < 0.6, coupled: !!player.trailer });
            }
            // ---- sky and weather over everything ----
            drawDusk(ctx, view, session.dusk ?? 0);
            const w = session.weather;
            if (w?.kind === 'rain') drawRain(ctx, view, w.intensity, performance.now() / 1000);
            if (w?.kind === 'fog' && session.visibility < Infinity) {
                const c = bodyCentre(player);
                const s = toScreen(p, c.x, c.y, 0, sp);
                drawFog(ctx, view, s.x, s.y, session.visibility * p.zoom, light);
            }
            this.stats.buildings = buildings;
            this.stats.chunks = chunks.length;
            this.stats.drawables = drawables.length;
        },
    };
}

/** Rough screen-space test: is the point inside the building's projected outline (with its height)? */
const occA = { x: 0, y: 0 }, occTop = { x: 0, y: 0 };
function occludes(p, b, ps) {
    const a = toScreen(p, b.x, b.y, 0, occA);
    const top = toScreen(p, b.x, b.y, b.h + 4, occTop);
    const rad = Math.hypot(b.len, b.dep) / 2 * p.zoom;
    return ps.x > a.x - rad && ps.x < a.x + rad && ps.y < a.y + rad * p.tilt && ps.y > top.y - rad * p.tilt;
}
