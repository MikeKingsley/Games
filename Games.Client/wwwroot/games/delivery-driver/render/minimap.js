// Minimap: roads around the player, towns, the route line to the next stop and the target, drawn on a small
// round canvas. It turns with the chase camera (or stays north-up) and is redrawn a few times a second.
import { RANGE, ROUTE_COLOUR, ROAD_COLOURS, roadColour, roadPixels, visibleRoads, reliefRaster, sharedGlMap } from './gl/minimap-gl.js';

export { ROUTE_COLOUR };

/** The relief raster as a canvas (once per world): the Canvas map's hillshade hint, laid over the flat land colours. */
function reliefCanvas(world) {
    if (world._mapRelief) return world._mapRelief;
    const r = reliefRaster(world);
    const c = document.createElement('canvas');
    c.width = r.width; c.height = r.height;
    c.getContext('2d').putImageData(new ImageData(r.data, r.width, r.height), 0, 0);
    world._mapRelief = c;
    return c;
}

/** Draws a map view onto a 2D context of size w x h centred on (cx, cy), `range` metres to the nearest edge. */
export function drawMap(ctx, session, { w, h, cx, cy, range = RANGE, rot = 0, player = true, labels = true, dpr = 1 }) {
    const world = session.world;
    const scale = Math.min(w, h) / 2 / range;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const gl = session.mapKind === 'webgl' ? sharedGlMap() : null;
    const glCanvas = gl?.render(session, { w, h, cx, cy, range, rot, dpr });
    if (glCanvas) {
        ctx.drawImage(glCanvas, 0, 0, w, h); // terrain, rivers, roads, route and markers came from WebGL
        drawOverlay(ctx, session, { w, h, cx, cy, rot, scale, range, player, labels });
        return;
    }
    ctx.fillStyle = '#2d5d82';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-rot);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
    if (!world._mapLand) {
        world._mapLand = new Path2D();
        const c = world.region.coast;
        world._mapLand.moveTo(c[0], c[1]);
        for (let i = 2; i < c.length; i += 2) world._mapLand.lineTo(c[i], c[i + 1]);
        world._mapLand.closePath();
        world._mapMoor = new Path2D();
        for (const m of world.region.moors) {
            world._mapMoor.moveTo(m.pts[0], m.pts[1]);
            for (let i = 2; i < m.pts.length; i += 2) world._mapMoor.lineTo(m.pts[i], m.pts[i + 1]);
            world._mapMoor.closePath();
        }
    }
    ctx.fillStyle = '#5b7a45';
    ctx.fill(world._mapLand);
    ctx.fillRect(world.region.bounds.maxX - 2, world.region.bounds.minY - 9000, 60000, 30000);
    ctx.fillStyle = '#7f7a52';
    ctx.fill(world._mapMoor);
    // a hint of relief: the hillshaded raster over the land only
    ctx.save();
    ctx.clip(world._mapLand);
    ctx.globalAlpha = 0.6;
    const rr = reliefRaster(world);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(reliefCanvas(world), rr.x0, rr.y0, rr.width * rr.cell, rr.height * rr.cell);
    ctx.restore();
    ctx.strokeStyle = '#3a6d93';
    ctx.lineCap = 'round';
    for (const r of world.region.rivers) {
        for (let i = 0; i < r.pts.length - 1; i++) {
            ctx.lineWidth = Math.max(r.pts[i].w, 2 / scale);
            ctx.beginPath(); ctx.moveTo(r.pts[i].x, r.pts[i].y); ctx.lineTo(r.pts[i + 1].x, r.pts[i + 1].y); ctx.stroke();
        }
    }
    // towns as soft discs
    ctx.fillStyle = 'rgba(210, 200, 180, 0.35)';
    for (const t of world.region.towns) {
        if (Math.abs(t.x - cx) > range * 1.6 + t.radius || Math.abs(t.y - cy) > range * 1.6 + t.radius) continue;
        ctx.beginPath(); ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2); ctx.fill();
    }
    // roads: small ones only when zoomed in
    const year = session.year;
    for (const { edge: e, cls } of visibleRoads(world, year, { cx, cy, range })) {
        ctx.strokeStyle = roadColour(e, cls);
        ctx.lineWidth = roadPixels(cls) / scale;
        if (cls === 'ferry') ctx.setLineDash([4 / scale, 4 / scale]);
        ctx.beginPath();
        ctx.moveTo(e.pts[0], e.pts[1]);
        for (let i = 2; i < e.pts.length; i += 2) ctx.lineTo(e.pts[i], e.pts[i + 1]);
        ctx.stroke();
        if (cls === 'ferry') ctx.setLineDash([]);
    }
    // the route and the target
    const route = session.route;
    if (route?.pts.length >= 4) {
        ctx.strokeStyle = '#000a';
        ctx.lineWidth = 6 / scale;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(route.pts[0], route.pts[1]);
        for (let i = 2; i < route.pts.length; i += 2) ctx.lineTo(route.pts[i], route.pts[i + 1]);
        ctx.stroke();
        ctx.strokeStyle = ROUTE_COLOUR;
        ctx.lineWidth = 3.6 / scale;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(route.pts[0], route.pts[1]);
        for (let i = 2; i < route.pts.length; i += 2) ctx.lineTo(route.pts[i], route.pts[i + 1]);
        ctx.stroke();
        const tx = route.pts[route.pts.length - 2], ty = route.pts[route.pts.length - 1];
        ctx.fillStyle = '#ff5a3c';
        ctx.beginPath(); ctx.arc(tx, ty, 6 / scale, 0, Math.PI * 2); ctx.fill();
    }
    // depots
    ctx.fillStyle = '#f2b33d';
    for (const d of world.depots) { ctx.fillRect(d.x - 5 / scale, d.y - 5 / scale, 10 / scale, 10 / scale); }
    // other company vehicles (Phase 8)
    for (const v of session.fleetMarkers?.() ?? []) {
        ctx.fillStyle = '#7fd0ff';
        ctx.beginPath(); ctx.arc(v.x, v.y, 4 / scale, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    drawOverlay(ctx, session, { w, h, cx, cy, rot, scale, range, player, labels });
}

/** Town names and the player arrow, drawn in screen space over either map. */
function drawOverlay(ctx, session, { w, h, cx, cy, rot, scale, range, player, labels }) {
    const world = session.world;
    const big = range > 1500;
    if (labels) {
        ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        const c = Math.cos(-rot), s = Math.sin(-rot);
        for (const t of world.region.towns) {
            const dx = (t.x - cx) * scale, dy = (t.y - cy) * scale;
            const sx = w / 2 + dx * c - dy * s, sy = h / 2 + dx * s + dy * c;
            if (sx < 0 || sx > w || sy < 0 || sy > h) continue;
            if (big && t.size === 'village') continue;
            ctx.fillStyle = '#000a';
            ctx.fillText(t.name, sx + 1, sy + 1);
            ctx.fillStyle = '#fff';
            ctx.fillText(t.name, sx, sy);
        }
        ctx.textAlign = 'start';
    }
    if (player) {
        // the player arrow at its position
        const p = session.player;
        const dx = (p.x - cx) * scale, dy = (p.y - cy) * scale;
        const c = Math.cos(-rot), s = Math.sin(-rot);
        ctx.save();
        ctx.translate(w / 2 + dx * c - dy * s, h / 2 + dx * s + dy * c);
        ctx.rotate(p.heading - rot);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-6, 5); ctx.lineTo(-3, 0); ctx.lineTo(-6, -5); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
    }
}

/** Minimap half-height in metres: close in when stopped or crawling (to follow turns), widening with speed (m/s). */
export const MINI_RANGE = { near: 110, far: 420, fullSpeed: 28 };
export const miniRangeFor = speed => MINI_RANGE.near + (MINI_RANGE.far - MINI_RANGE.near) * Math.min(1, Math.abs(speed) / MINI_RANGE.fullSpeed);

export function createMinimap(canvas) {
    const ctx = canvas.getContext('2d');
    let last = 0, range = 0;
    return {
        draw(session, camera, force = false) {
            const now = performance.now();
            if (!force && now - last < 200) return;
            const dt = Math.min(1, (now - last) / 1000);
            last = now;
            if (!session.world) return;
            // ease towards the speed's range (about a 1.5 s time constant) so the zoom drifts rather than jumps
            const target = miniRangeFor(session.player.speed);
            range = range ? range + (target - range) * (1 - Math.exp(-dt / 1.5)) : target;
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            const w = canvas.clientWidth || 180, h = canvas.clientHeight || 180;
            if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
            const rot = camera.mode === 'chase' ? camera.rot : 0;
            drawMap(ctx, session, { w, h, cx: session.player.x, cy: session.player.y, range, rot, dpr, labels: false });
        },
    };
}
