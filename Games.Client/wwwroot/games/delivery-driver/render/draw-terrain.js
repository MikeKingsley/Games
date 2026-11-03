// Ground: sea, land, moors, rivers, town ground, field patchwork with hedgerows, yards. Drawn under the ground
// transform, so everything is in world coordinates.
import { polygonsPath } from './sprite-cache.js';

export const COLOURS = {
    sea: '#2d5d82', land: '#6b8f4e', moor: '#8f8a5c', river: '#3a6d93', town: '#8a9278', sand: '#d9c58f', cliff: '#7d7466', surf: '#a9c9dc',
    quay: '#a7a196', heather: '#7a5f6e', gorse: '#b9a23c',
    hedge: '#3f5f2c', yard: '#a49d8d', yardLine: '#f2efe4', bay: '#f2b33d',
};

/** Whole-region paths, built once per region. */
export function regionPaths(region) {
    if (region._paths) return region._paths;
    const rivers = region.rivers.map(r => r.pts);
    region._paths = {
        land: polygonsPath([region.coast]),
        // east of the seed region carries on as land (the rest of England)
        east: polygonsPath([[region.bounds.maxX - 2, region.bounds.minY - 5000, region.bounds.maxX + 50000, region.bounds.minY - 5000, region.bounds.maxX + 50000, region.bounds.maxY + 5000, region.bounds.maxX - 2, region.bounds.maxY + 5000]]),
        moors: polygonsPath(region.moors.map(m => m.pts)),
        // land plus the open east, for clipping town ground to the shore
        all: polygonsPath([region.coast, [region.bounds.maxX - 2, region.bounds.minY - 5000, region.bounds.maxX + 50000, region.bounds.minY - 5000, region.bounds.maxX + 50000, region.bounds.maxY + 5000, region.bounds.maxX - 2, region.bounds.maxY + 5000]]),
        rivers,
    };
    return region._paths;
}

/** Background layers that cover the whole view (cheap: a few big paths). */
export function drawBase(ctx, region, light = 1) {
    const paths = regionPaths(region);
    ctx.fillStyle = COLOURS.land;
    ctx.fill(paths.land);
    ctx.fill(paths.east);
    ctx.fillStyle = COLOURS.moor;
    ctx.fill(paths.moors);
    void light;
}

/** Rivers and estuaries: each segment stroked at its own width (world metres). */
export function drawRivers(ctx, region, view) {
    ctx.strokeStyle = COLOURS.river;
    ctx.lineCap = 'round';
    for (const pts of regionPaths(region).rivers) {
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i], b = pts[i + 1];
            if (!segNear(a, b, view)) continue;
            // long segments taper in steps so estuaries widen smoothly
            const steps = Math.max(1, Math.ceil(Math.abs(b.w - a.w) / 6));
            for (let s = 0; s < steps; s++) {
                const t0 = s / steps, t1 = (s + 1) / steps;
                ctx.lineWidth = a.w + (b.w - a.w) * (t0 + t1) / 2;
                ctx.beginPath();
                ctx.moveTo(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0);
                ctx.lineTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
                ctx.stroke();
            }
        }
    }
}

function segNear(a, b, view) {
    const minX = Math.min(a.x, b.x) - 200, maxX = Math.max(a.x, b.x) + 200;
    const minY = Math.min(a.y, b.y) - 200, maxY = Math.max(a.y, b.y) + 200;
    return view.x > minX - view.r && view.x < maxX + view.r && view.y > minY - view.r && view.y < maxY + view.r;
}

/** Town ground discs (pavements, gardens) under the streets. */
export function drawTowns(ctx, region, view) {
    ctx.fillStyle = COLOURS.town;
    let clipped = false;
    for (const t of region.towns) {
        if (Math.hypot(t.x - view.x, t.y - view.y) > t.radius * 1.1 + view.r) continue;
        if (!clipped) { ctx.save(); ctx.clip(regionPaths(region).all, 'nonzero'); clipped = true; } // not over the sea
        if (!t._ground) t._ground = townPath(t);
        ctx.fill(t._ground);
    }
    if (clipped) ctx.restore();
}

function townPath(t) {
    const pts = [];
    for (let k = 0; k < 28; k++) {
        const a = (k / 28) * Math.PI * 2;
        const r = t.radius * (0.98 + 0.08 * Math.sin(a * 5 + t.x));
        pts.push(t.x + Math.cos(a) * r, t.y + Math.sin(a) * r);
    }
    return polygonsPath([pts]);
}

/** A chunk's fields and hedgerows (paths cached on the chunk itself; they go when the chunk is evicted). */
export function drawChunkGround(ctx, chunk, detail = true) {
    if (!chunk._fields) {
        const byColour = new Map();
        for (const f of chunk.fields) (byColour.get(f.colour) ?? byColour.set(f.colour, []).get(f.colour)).push(f.pts);
        chunk._fields = [...byColour].map(([colour, list]) => ({ colour, path: polygonsPath(list) }));
        chunk._hedges = polygonsPath(chunk.hedges);
    }
    for (const f of chunk._fields) { ctx.fillStyle = f.colour; ctx.fill(f.path); }
    if (detail && chunk.hedges.length) {
        ctx.strokeStyle = COLOURS.hedge;
        ctx.lineWidth = 1.8;
        ctx.lineJoin = 'round';
        ctx.stroke(chunk._hedges);
    }
}

/** Yard surfaces with their loading bay markings; `active` highlights the bay the player is heading for. */
export function drawYard(ctx, owner, active) {
    const y = owner.yard;
    const z = y.zone;
    ctx.save();
    ctx.translate(z.x, z.y);
    ctx.rotate(z.angle);
    ctx.fillStyle = COLOURS.yard;
    ctx.fillRect(-z.hx, -z.hy, z.hx * 2, z.hy * 2);
    ctx.restore();
    const m = y.marker;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.heading);
    // the bay: a box 3.4 m wide reaching 7 m forward from the back line (the rear of the vehicle goes on the line)
    ctx.strokeStyle = active ? COLOURS.bay : COLOURS.yardLine;
    ctx.lineWidth = active ? 0.35 : 0.22;
    ctx.strokeRect(0, -1.7, 7, 3.4);
    ctx.beginPath();
    ctx.moveTo(0, -1.7); ctx.lineTo(0, 1.7);
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.restore();
}

/**
 * Coastline: sandy beaches and dark cliffs. Each coast segment is classed once (north coasts and headlands are
 * mostly cliff), then stroked along the shore with a pale surf line on the sea side.
 */
export function drawCoast(ctx, region, view) {
    if (!region._coastParts) {
        const c = region.coast;
        const parts = [];
        for (let i = 0; i < c.length - 2; i += 2) {
            const ax = c[i], ay = c[i + 1], bx = c[i + 2], by = c[i + 3];
            if (ax > region.bounds.maxX - 5 && bx > region.bounds.maxX - 5) continue; // the open eastern edge
            const north = (ay + by) / 2 < region.project(50.75, -4).y;
            const hash = Math.abs(Math.sin(ax * 12.9898 + ay * 78.233)) % 1;
            parts.push({ ax, ay, bx, by, cliff: north ? hash < 0.75 : hash < 0.4 });
        }
        region._coastParts = parts;
    }
    ctx.lineCap = 'round';
    for (const p of region._coastParts) {
        if (!segNear({ x: p.ax, y: p.ay }, { x: p.bx, y: p.by }, view)) continue;
        ctx.beginPath();
        ctx.moveTo(p.ax, p.ay);
        ctx.lineTo(p.bx, p.by);
        ctx.strokeStyle = COLOURS.surf;
        ctx.lineWidth = p.cliff ? 7 : 14;
        ctx.stroke();
        ctx.strokeStyle = p.cliff ? COLOURS.cliff : COLOURS.sand;
        ctx.lineWidth = p.cliff ? 5 : 10;
        ctx.stroke();
    }
}

/** Heather and gorse patches on the moor (from the chunk). */
export function drawMoorPatches(ctx, chunk) {
    if (!chunk.patches?.length) return;
    for (const p of chunk.patches) {
        ctx.fillStyle = p.gorse ? COLOURS.gorse : COLOURS.heather;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.rx, p.ry, p.a, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

/** Harbour quays (ground) — the breakwaters and boats are drawn as objects. */
export function drawHarbours(ctx, world, view) {
    ctx.fillStyle = COLOURS.quay;
    for (const h of world.harbours ?? []) {
        if (Math.hypot(h.x - view.x, h.y - view.y) > view.r + 80) continue;
        const q = h.quay;
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(q.angle);
        ctx.fillRect(-q.hx, -q.hy, q.hx * 2, q.hy * 2);
        ctx.restore();
    }
}

/** The practice yard: concrete, painted bays along the back (the selected one highlighted). */
export function drawPractice(ctx, practice, active) {
    const z = practice.yard.zone;
    ctx.fillStyle = '#b9b5ab';
    ctx.fillRect(z.x - z.hx, z.y - z.hy, z.hx * 2, z.hy * 2);
    ctx.strokeStyle = '#f2efe4';
    ctx.lineWidth = 0.3;
    ctx.strokeRect(z.x - z.hx + 1, z.y - z.hy + 1, z.hx * 2 - 2, z.hy * 2 - 2);
    practice.bays.forEach((b, k) => {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.heading);
        ctx.strokeStyle = k === active ? COLOURS.bay : COLOURS.yardLine;
        ctx.lineWidth = k === active ? 0.35 : 0.22;
        ctx.strokeRect(0, -1.8, 16, 3.6);
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(0, -1.8); ctx.lineTo(0, 1.8); ctx.stroke();
        ctx.restore();
    });
}
