// Track drawing: ballast, sleepers, rails, buffer stops, point blades and the tappable point levers.
import { pointAt, LEGS } from './track.js';
import { el, polyline } from './svg.js';

/** Points along a track every `step`, with the heading there (for sleepers). */
function along(layout, track, step) {
    const out = [];
    for (let d = step / 2; d < track.length; d += step) out.push({ d, ...pointAt(layout, track.id, d) });
    return out;
}

function drawBuffer(root, x, y, angle) {
    const g = el('g', { transform: `translate(${x} ${y}) rotate(${angle})` }, root);
    el('rect', { x: -0.12, y: -0.32, width: 0.12, height: 0.64, fill: '#5a4a3a' }, g);
    el('rect', { x: -0.3, y: -0.24, width: 0.18, height: 0.12, fill: '#7a1a1a' }, g);
    el('rect', { x: -0.3, y: 0.12, width: 0.18, height: 0.12, fill: '#7a1a1a' }, g);
    el('circle', { cx: -0.05, cy: 0, r: 0.07, fill: '#e8c040' }, g); // buffer stop lamp
}

/**
 * Draws the yard's ground, ballast, sleepers, rails, buffers and point levers into the layers.
 * ctx.labelEls collects functions that re-apply upright counter-rotation; ctx.isTurned() says whether the yard is turned.
 * Returns { update(sim, dt), onEvent(e) }.
 */
export function drawTrack(layers, layout, ctx) {
    const b = layout.bounds;
    el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: '#3d6b3a' }, layers.ground);
    for (const t of Object.values(layout.tracks)) {
        el('polyline', { points: polyline(t.pts), fill: 'none', stroke: '#8d7f6a', 'stroke-width': 1.0, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, layers.ballast);
    }
    for (const t of Object.values(layout.tracks)) {
        for (const s of along(layout, t, 0.34)) {
            el('line', { x1: -0.3, y1: 0, x2: 0.3, y2: 0, stroke: '#4a3a2a', 'stroke-width': 0.1, transform: `translate(${s.x} ${s.y}) rotate(${s.angle * 180 / Math.PI + 90})` }, layers.sleepers);
        }
    }
    for (const t of Object.values(layout.tracks)) {
        for (const off of [-0.18, 0.18]) {
            const pts = t.pts.map((p, i) => {
                const q = t.pts[Math.min(i + 1, t.pts.length - 1)], r = t.pts[Math.max(i - 1, 0)];
                const a = Math.atan2(q[1] - r[1], q[0] - r[0]);
                return [p[0] - Math.sin(a) * off, p[1] + Math.cos(a) * off];
            });
            el('polyline', { points: polyline(pts), fill: 'none', stroke: '#c9ced4', 'stroke-width': 0.05, 'stroke-linejoin': 'round' }, layers.rails);
        }
    }
    for (const t of Object.values(layout.tracks)) {
        for (const end of ['a', 'b']) {
            if (t.ends[end].type !== 'buffer') continue;
            const p = end === 'a' ? t.pts[0] : t.pts[t.pts.length - 1];
            const q = end === 'a' ? t.pts[1] : t.pts[t.pts.length - 2];
            drawBuffer(layers.rails, p[0], p[1], Math.atan2(p[1] - q[1], p[0] - q[0]) * 180 / Math.PI + 180);
        }
    }

    // points: a bright blade on the active leg and a tappable lever beside the point
    const pointEls = {};
    layout.pointIds.forEach((id, i) => {
        const p = layout.points[id];
        const q = pointAt(layout, p.legs.diverging.track, p.legs.diverging.end === 'a' ? 1 : layout.tracks[p.legs.diverging.track].length - 1);
        let side = q.y < p.y ? 1 : -1; // lever on the opposite side to the diverging leg ...
        const spot = s => [p.x - 0.6, p.y + s * 0.95];
        const own = new Set(LEGS.map(leg => p.legs[leg].track));
        const crowding = s => { // ... unless a curving track of another point runs through that spot
            const [lx, ly] = spot(s);
            let best = Infinity;
            for (const t of Object.values(layout.tracks)) {
                if (own.has(t.id)) continue;
                for (let i = 0; i < t.pts.length; i += 4) best = Math.min(best, Math.hypot(t.pts[i][0] - lx, t.pts[i][1] - ly));
            }
            return best;
        };
        if (crowding(side) < 1.2 && crowding(-side) > crowding(side)) side = -side;
        const g = el('g', { class: 'ig-point', 'data-point': id, transform: `translate(${p.x - 0.6} ${p.y + side * 0.95})` }, layers.points);
        el('circle', { r: 0.95, fill: 'transparent' }, g); // generous hit area
        el('circle', { r: 0.38, fill: '#2a2a2a', stroke: '#e8e0c8', 'stroke-width': 0.05 }, g);
        const arrow = el('path', { d: 'M-0.2,0 H0.2 M0.06,-0.12 L0.2,0 L0.06,0.12', stroke: '#ffdf50', 'stroke-width': 0.07, fill: 'none', 'stroke-linecap': 'round' }, g);
        const label = el('text', { y: side > 0 ? 0.78 : -0.55, 'text-anchor': 'middle', 'font-size': 0.34, fill: '#fff', 'font-weight': 700, 'font-family': 'system-ui, sans-serif' }, g);
        label.textContent = i < 9 ? String(i + 1) : '';
        const labelY = side > 0 ? 0.78 : -0.55;
        ctx.labelEls.push(() => label.setAttribute('transform', ctx.isTurned() ? `rotate(-90 0 ${labelY - 0.12})` : '')); // keep the lever number upright
        const blade = el('polyline', { fill: 'none', stroke: '#ffdf50', 'stroke-width': 0.1, 'stroke-linecap': 'round', opacity: 0.9 }, layers.points);
        pointEls[id] = { g, arrow, blade, side };
    });

    function legBlade(p, leg) {
        const ref = p.legs[leg];
        const t = layout.tracks[ref.track];
        const pts = [];
        const n = 6, len = Math.min(1.4, t.length);
        for (let i = 0; i <= n; i++) {
            const d = ref.end === 'a' ? (len * i) / n : t.length - (len * i) / n;
            const q = pointAt(layout, t.id, d);
            pts.push([q.x, q.y]);
        }
        return polyline(pts);
    }

    return {
        update(sim, dt) {
            for (const [id, pe] of Object.entries(pointEls)) {
                const state = sim.points[id];
                const p = layout.points[id];
                pe.blade.setAttribute('points', legBlade(p, state));
                const dir = layout.tracks[p.legs[state].track];
                const q = pointAt(layout, p.legs[state].track, p.legs[state].end === 'a' ? Math.min(1, dir.length) : Math.max(0, dir.length - 1));
                const ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
                pe.arrow.setAttribute('transform', `rotate(${ang})`);
            }
        },
        onEvent(e) {},
    };
}
