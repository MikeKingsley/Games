// Minimap: roads around the player, towns, the route line to the next stop and the target, drawn on a small
// round canvas. It turns with the chase camera (or stays north-up) and is redrawn a few times a second.
import { edgeOpen, edgeClass } from '../world/roadgraph.js';

const RANGE = 420; // world metres from the centre to the edge of the map
export const ROUTE_COLOUR = '#ff3fb4';

const ROAD_COLOURS = { M: '#5aa0e0', dual: '#7fd07f', A: '#e8a33a', B: '#e6d27a', street: '#d9d4c6', lane: '#b8ad8e', access: '#b8ad8e', ferry: '#9fc6dd' };

/** Draws a map view onto a 2D context of size w x h centred on (cx, cy), `range` metres to the nearest edge. */
export function drawMap(ctx, session, { w, h, cx, cy, range = RANGE, rot = 0, player = true, labels = true, dpr = 1 }) {
    const world = session.world;
    const scale = Math.min(w, h) / 2 / range;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    const r = range * 1.5;
    const ids = world.graph.index.edgesIn(cx - r, cy - r, cx + r, cy + r);
    const year = session.year;
    const big = range > 1500;
    for (const id of ids) {
        const e = world.graph.edges[id];
        if (!edgeOpen(e, year)) continue;
        const cls = edgeClass(e, year);
        if (big && (cls === 'street' || cls === 'lane' || cls === 'access')) continue;
        ctx.strokeStyle = ROAD_COLOURS[cls] ?? '#ccc';
        ctx.lineWidth = (cls === 'M' || cls === 'dual' ? 3.2 : cls === 'A' ? 2.6 : cls === 'B' ? 2 : 1.4) / scale;
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

export function createMinimap(canvas) {
    const ctx = canvas.getContext('2d');
    let last = 0;
    return {
        draw(session, camera, force = false) {
            const now = performance.now();
            if (!force && now - last < 200) return;
            last = now;
            if (!session.world) return;
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            const w = canvas.clientWidth || 180, h = canvas.clientHeight || 180;
            if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
            const rot = camera.mode === 'chase' ? camera.rot : 0;
            drawMap(ctx, session, { w, h, cx: session.player.x, cy: session.player.y, rot, dpr, labels: false });
        },
    };
}
