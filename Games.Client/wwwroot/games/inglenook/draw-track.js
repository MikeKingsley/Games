// Track drawing: ground, ballast, sleepers, rails, pointwork, buffer stops and the tappable point levers.
import { pointAt, LEGS } from './track.js';
import { el, polyline } from './svg.js';

const GAUGE = 0.18; // rail centre-line offset from the track centre-line (wagon lengths)
const BLADE_LEN = 1.0; // switch blade length
const BLADE_GAP = 0.1; // how far an open blade stands off its stock rail
const THROW_TIME = 0.15; // seconds for the blades and lever to move
const YELLOW = '#ffdf50';

const normal = h => [-Math.sin(h), Math.cos(h)];

/** `pts` moved sideways by `off` along the normal of the heading at each vertex (offset rails, check rails). Pure. */
export function offsetPolyline(pts, hdg, off) {
    return pts.map((p, i) => [p[0] - Math.sin(hdg[i]) * off, p[1] + Math.cos(hdg[i]) * off]);
}

/**
 * Where the tappable lever of point `id` stands: [x, y] and `side` (+1 below the toe track, -1 above). It sits just behind the point on
 * the side away from the diverging leg, and flips to the other side when another point's track passes within 1.2 of that spot. Pure.
 */
export function leverPosition(layout, id) {
    const p = layout.points[id];
    const dTrack = layout.tracks[p.legs.diverging.track];
    const q = pointAt(layout, dTrack.id, p.legs.diverging.end === 'a' ? 1 : dTrack.length - 1);
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
    const [x, y] = spot(side);
    return { x, y, side };
}

/** Every `k`th vertex (and the last) of a polyline, with the matching headings. */
function thin(t, k) {
    const pts = [], hdg = [];
    for (let i = 0; i < t.pts.length; i += k) { pts.push(t.pts[i]); hdg.push(t.hdg[i]); }
    if ((t.pts.length - 1) % k) { pts.push(t.pts[t.pts.length - 1]); hdg.push(t.hdg[t.pts.length - 1]); }
    return { pts, hdg };
}

const pathOf = pts => 'M' + pts.map(p => `${+p[0].toFixed(3)},${+p[1].toFixed(3)}`).join('L');

/** Position and heading (pointing away from the point) at distance s along a leg of a point. */
function legAt(layout, p, leg, s) {
    const ref = p.legs[leg], t = layout.tracks[ref.track];
    const d = Math.min(s, t.length);
    const q = pointAt(layout, ref.track, ref.end === 'a' ? d : t.length - d);
    return { x: q.x, y: q.y, h: ref.end === 'a' ? q.angle : q.angle + Math.PI };
}

/** Geometry of a turnout: which side the diverging leg lies on and where the two inner rails cross (the frog). */
function turnoutGeometry(layout, p) {
    const reach = Math.min(layout.tracks[p.legs.straight.track].length, layout.tracks[p.legs.diverging.track].length) - 0.3;
    const sep = s => { const a = legAt(layout, p, 'straight', s), b = legAt(layout, p, 'diverging', s); return { a, b, d: Math.hypot(a.x - b.x, a.y - b.y) }; };
    const ref = sep(Math.min(2, reach));
    const n = normal(ref.a.h);
    const dv = (ref.b.x - ref.a.x) * n[0] + (ref.b.y - ref.a.y) * n[1] >= 0 ? 1 : -1;
    let sf = Math.min(1.6, reach);
    for (let s = 0.2; s <= reach; s += 0.02) if (sep(s).d >= 2 * GAUGE) { sf = s; break; }
    return { dv, sf };
}

function drawBuffer(root, x, y, angle, tex) {
    const g = el('g', { transform: `translate(${x} ${y}) rotate(${angle})` }, root); // local -x runs out beyond the end of the track
    for (const s of [-1, 1]) {
        el('rect', { x: -0.55, y: s * GAUGE - 0.06, width: 0.55, height: 0.12, fill: `url(#${tex.timber})`, stroke: '#2b1f14', 'stroke-width': 0.012 }, g); // timber runners
        el('line', { x1: 0, y1: s * GAUGE, x2: -0.5, y2: s * GAUGE, stroke: '#2e2a27', 'stroke-width': 0.085 }, g); // rail-built uprights lying along the track
        el('line', { x1: 0, y1: s * GAUGE, x2: -0.5, y2: s * GAUGE, stroke: '#cdd2d7', 'stroke-width': 0.03 }, g);
    }
    el('rect', { x: -0.62, y: -0.38, width: 0.14, height: 0.76, rx: 0.02, fill: '#a3221c', stroke: '#4a0e0c', 'stroke-width': 0.02 }, g); // red buffer beam
    el('line', { x1: -0.55, y1: -0.3, x2: -0.55, y2: 0.3, stroke: '#e8e0c8', 'stroke-width': 0.03, 'stroke-dasharray': '0.1 0.08' }, g);
    el('line', { x1: -0.55, y1: 0.38, x2: -0.55, y2: 0.52, stroke: '#2e2a27', 'stroke-width': 0.04 }, g); // lamp post
    el('circle', { cx: -0.55, cy: 0.56, r: 0.12, fill: '#ffb030', opacity: 0.35 }, g);
    el('circle', { cx: -0.55, cy: 0.56, r: 0.065, fill: '#ffe070', stroke: '#4a3a10', 'stroke-width': 0.015 }, g); // lamp
}

/**
 * Draws the yard's ground, ballast, sleepers, rails, pointwork, buffer stops and point levers into the layers.
 * ctx.textures holds the pattern ids from textures.js; ctx.labelEls collects functions that re-apply upright counter-rotation;
 * ctx.isTurned() says whether the yard is turned; ctx.quality 'low' or ctx.reducedMotion make the blades jump instead of tween.
 * Returns { update(sim, dt), onEvent(e) }.
 */
export function drawTrack(layers, layout, ctx) {
    const tex = ctx.textures;
    const tracks = Object.values(layout.tracks);
    const b = layout.bounds;

    // ground: grass, with the trodden cinder yard following every track
    el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: `url(#${tex.grass})` }, layers.ground);
    for (const t of tracks) el('polyline', { points: polyline(thin(t, 8).pts), fill: 'none', stroke: '#4d5a30', 'stroke-width': 4.1, 'stroke-opacity': 0.55, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, layers.ground);
    for (const t of tracks) el('polyline', { points: polyline(thin(t, 8).pts), fill: 'none', stroke: `url(#${tex.cinder})`, 'stroke-width': 3.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, layers.ground);

    // ballast shoulder, ballast, and the dark oily strip between the rails
    for (const t of tracks) el('polyline', { points: polyline(thin(t, 6).pts), fill: 'none', stroke: '#1c1812', 'stroke-opacity': 0.35, 'stroke-width': 1.3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, layers.ballast);
    for (const t of tracks) el('polyline', { points: polyline(thin(t, 6).pts), fill: 'none', stroke: `url(#${tex.ballast})`, 'stroke-width': 1.12, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, layers.ballast);
    for (const t of tracks) el('polyline', { points: polyline(thin(t, 6).pts), fill: 'none', stroke: '#14100a', 'stroke-opacity': 0.32, 'stroke-width': 0.28, 'stroke-linejoin': 'round' }, layers.ballast);

    // sleepers: one wide dashed stroke per track, square to the track on curves
    for (const t of tracks) el('polyline', { points: polyline(thin(t, 2).pts), fill: 'none', stroke: `url(#${tex.timber})`, 'stroke-width': 0.64, 'stroke-dasharray': '0.13 0.21', 'stroke-dashoffset': -0.1 }, layers.sleepers);

    // rails: dark web with a thin bright running surface, joints every 2 wagon lengths
    for (const t of tracks) {
        const th = thin(t, 3);
        const d = [-GAUGE, GAUGE].map(off => pathOf(offsetPolyline(th.pts, th.hdg, off))).join('');
        el('path', { d, fill: 'none', stroke: '#2e2a27', 'stroke-width': 0.085, 'stroke-linejoin': 'round' }, layers.rails);
        el('path', { d, fill: 'none', stroke: '#cdd2d7', 'stroke-width': 0.03, 'stroke-linejoin': 'round' }, layers.rails);
        let joints = '';
        for (let s = 2; s < t.length - 0.5; s += 2) {
            const q = pointAt(layout, t.id, s), n = normal(q.angle);
            for (const off of [-GAUGE, GAUGE]) joints += `M${(q.x + n[0] * (off - 0.06)).toFixed(3)},${(q.y + n[1] * (off - 0.06)).toFixed(3)}L${(q.x + n[0] * (off + 0.06)).toFixed(3)},${(q.y + n[1] * (off + 0.06)).toFixed(3)}`;
        }
        if (joints) el('path', { d: joints, fill: 'none', stroke: '#14110e', 'stroke-width': 0.024 }, layers.rails);
    }

    // buffer stops
    for (const t of tracks) {
        for (const end of ['a', 'b']) {
            if (t.ends[end].type !== 'buffer') continue;
            const i = end === 'a' ? 0 : t.pts.length - 1, q = pointAt(layout, t.id, end === 'a' ? 0 : t.length);
            drawBuffer(layers.rails, t.pts[i][0], t.pts[i][1], (end === 'a' ? q.angle + Math.PI : q.angle) * 180 / Math.PI + 180, tex);
        }
    }

    // pointwork, levers and their markers
    const pointEls = {};
    layout.pointIds.forEach((id, i) => {
        const p = layout.points[id];
        const { dv, sf } = turnoutGeometry(layout, p);
        const t0 = legAt(layout, p, 'straight', 0), n0 = normal(t0.h);

        // long timbers under the point, from the toe to just past the frog
        for (let s = 0.2; s <= sf + 0.6; s += 0.34) {
            const a = legAt(layout, p, 'straight', s), c = legAt(layout, p, 'diverging', s);
            const len = Math.hypot(a.x - c.x, a.y - c.y) + 0.72;
            el('rect', { x: -0.065, y: -len / 2, width: 0.13, height: len, fill: `url(#${tex.timber})`, stroke: '#2b1f14', 'stroke-width': 0.012, transform: `translate(${(a.x + c.x) / 2} ${(a.y + c.y) / 2}) rotate(${a.h * 180 / Math.PI})` }, layers.sleepers);
        }

        // frog: the vee where the two inner rails cross, with check rails on the opposite rails
        const fa = legAt(layout, p, 'straight', sf), fb = legAt(layout, p, 'diverging', sf);
        const nose = [(fa.x + fb.x) / 2, (fa.y + fb.y) / 2];
        const ba = legAt(layout, p, 'straight', sf + 0.55), bb = legAt(layout, p, 'diverging', sf + 0.55);
        const na = normal(ba.h), nb = normal(bb.h);
        const innerA = [ba.x + na[0] * dv * GAUGE, ba.y + na[1] * dv * GAUGE], innerB = [bb.x - nb[0] * dv * GAUGE, bb.y - nb[1] * dv * GAUGE];
        el('polygon', { points: polyline([nose, innerA, innerB]), fill: '#4b5056', stroke: '#cdd2d7', 'stroke-width': 0.03, 'stroke-linejoin': 'round' }, layers.rails);
        let check = '';
        for (const [leg, sideSign] of [['straight', -dv], ['diverging', dv]]) {
            const seg = [];
            for (let s = Math.max(0.3, sf - 0.55); s <= sf + 0.55; s += 0.11) {
                const q = legAt(layout, p, leg, s), n = normal(q.h);
                seg.push([q.x + n[0] * sideSign * (GAUGE - 0.1), q.y + n[1] * sideSign * (GAUGE - 0.1)]);
            }
            check += pathOf(seg);
        }
        el('path', { d: check, fill: 'none', stroke: '#2e2a27', 'stroke-width': 0.06, 'stroke-linecap': 'round' }, layers.rails);
        el('path', { d: check, fill: 'none', stroke: '#cdd2d7', 'stroke-width': 0.02, 'stroke-linecap': 'round' }, layers.rails);

        // switch blades: one against the straight route's rail on the diverging side, one against the diverging route's inner rail
        const tipStock = sg => [p.x + n0[0] * sg * GAUGE, p.y + n0[1] * sg * GAUGE];
        const tipOpen = sg => [p.x + n0[0] * sg * (GAUGE - BLADE_GAP), p.y + n0[1] * sg * (GAUGE - BLADE_GAP)];
        const hs = legAt(layout, p, 'straight', BLADE_LEN), hd = legAt(layout, p, 'diverging', BLADE_LEN);
        const nhs = normal(hs.h), nhd = normal(hd.h);
        const blades = [
            { stock: tipStock(dv), open: tipOpen(dv), heel: [hs.x + nhs[0] * dv * GAUGE, hs.y + nhs[1] * dv * GAUGE], opened: ph => ph },
            { stock: tipStock(-dv), open: tipOpen(-dv), heel: [hd.x - nhd[0] * dv * GAUGE, hd.y - nhd[1] * dv * GAUGE], opened: ph => 1 - ph },
        ];
        for (const bl of blades) {
            bl.halo = el('line', { stroke: YELLOW, 'stroke-width': 0.17, 'stroke-linecap': 'round', 'pointer-events': 'none' }, layers.points);
            bl.line = el('line', { stroke: '#e1e6ea', 'stroke-width': 0.07, 'stroke-linecap': 'round', 'pointer-events': 'none' }, layers.points);
            bl.shade = el('line', { stroke: '#2e2a27', 'stroke-width': 0.03, 'stroke-linecap': 'round', 'pointer-events': 'none', opacity: 0.6 }, layers.points);
        }

        // lever: a weighted ground lever on a timber base, ringed in yellow, with an arrow showing the set route
        const lv = leverPosition(layout, id), side = lv.side;
        const g = el('g', { class: 'ig-point', 'data-point': id, transform: `translate(${lv.x} ${lv.y})` }, layers.points);
        el('circle', { r: 0.95, fill: 'transparent' }, g); // generous hit area
        el('circle', { r: 0.46, fill: '#1d1a14', 'fill-opacity': 0.6, stroke: YELLOW, 'stroke-width': 0.06 }, g);
        el('rect', { x: -0.22, y: -0.12, width: 0.44, height: 0.24, rx: 0.02, fill: `url(#${tex.timber})`, stroke: '#2b1f14', 'stroke-width': 0.02 }, g);
        const arm = el('g', {}, g);
        el('line', { x1: 0, y1: 0, x2: 0.3, y2: 0, stroke: '#2a2a2a', 'stroke-width': 0.05, 'stroke-linecap': 'round' }, arm);
        el('circle', { cx: 0.3, cy: 0, r: 0.085, fill: '#b02a22', stroke: '#2a0b09', 'stroke-width': 0.02 }, arm); // the lever weight
        el('circle', { r: 0.045, fill: '#c9ced4' }, g); // pivot pin
        const arrow = el('path', { d: 'M0.47,-0.14 L0.7,0 L0.47,0.14 Z', fill: YELLOW, stroke: '#4a3a10', 'stroke-width': 0.025, 'stroke-linejoin': 'round' }, g);
        const labelY = side > 0 ? 1.0 : -0.76;
        const label = el('text', { y: labelY, 'text-anchor': 'middle', 'font-size': 0.34, fill: '#fff', stroke: '#1d1a14', 'stroke-width': 0.07, 'paint-order': 'stroke', 'font-weight': 700, 'font-family': 'system-ui, sans-serif' }, g);
        label.textContent = i < 9 ? String(i + 1) : '';
        ctx.labelEls.push(() => label.setAttribute('transform', ctx.isTurned() ? `rotate(-90 0 ${labelY - 0.12})` : '')); // keep the lever number upright

        const dirAngle = leg => { const q = legAt(layout, p, leg, Math.min(1, layout.tracks[p.legs[leg].track].length)); return Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI; };
        pointEls[id] = { arm, arrow, blades, phase: null, target: 0, angles: { straight: dirAngle('straight'), diverging: dirAngle('diverging') } };
    });

    const mix = (a, c, f) => [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f];
    function applyPhase(pe) {
        const ph = pe.phase;
        for (const bl of pe.blades) {
            const open = bl.opened(ph), tip = mix(bl.stock, bl.open, open), closed = 1 - open;
            for (const k of ['halo', 'line', 'shade']) {
                bl[k].setAttribute('x1', tip[0].toFixed(3)); bl[k].setAttribute('y1', tip[1].toFixed(3));
                bl[k].setAttribute('x2', bl.heel[0].toFixed(3)); bl[k].setAttribute('y2', bl.heel[1].toFixed(3));
            }
            bl.halo.setAttribute('opacity', (0.5 * closed).toFixed(2)); // subtle highlight on the blade that is set
        }
        pe.arm.setAttribute('transform', `rotate(${180 * (1 - ph)})`);
        pe.arrow.setAttribute('transform', `rotate(${pe.angles.straight + (pe.angles.diverging - pe.angles.straight) * ph})`);
    }

    return {
        update(sim, dt) {
            const instant = ctx.quality === 'low' || ctx.reducedMotion;
            for (const [id, pe] of Object.entries(pointEls)) {
                pe.target = sim.points[id] === 'diverging' ? 1 : 0;
                if (pe.phase === null || instant) pe.phase = pe.target;
                else if (pe.phase !== pe.target) {
                    const step = dt / THROW_TIME;
                    pe.phase = pe.phase < pe.target ? Math.min(pe.target, pe.phase + step) : Math.max(pe.target, pe.phase - step);
                } else continue;
                applyPhase(pe);
            }
        },
        onEvent(e) {},
    };
}
