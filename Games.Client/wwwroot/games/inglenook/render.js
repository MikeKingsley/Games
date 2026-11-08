// SVG renderer for Inglenook: a top-down 1960s goods yard. One <svg> whose viewBox is the layout bounds, so everything is in wagon lengths.
// Static scenery and track are drawn once; wagons, couplings and point levers are updated every frame.
import { pointAt } from './track.js';
import { LOCO_LEN, WAGON_LEN } from './config.js';

const NS = 'http://www.w3.org/2000/svg';
export const BODY_W = 0.5;

function el(name, attrs = {}, parent) {
    const e = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
}

const polyline = pts => pts.map(p => p.join(',')).join(' ');

/** Points along a track every `step`, with the heading there (for sleepers). */
function along(layout, track, step) {
    const out = [];
    for (let d = step / 2; d < track.length; d += step) out.push({ d, ...pointAt(layout, track.id, d) });
    return out;
}

function drawScenery(root, b) {
    const x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
    // goods shed (top left), signal box, water tower, fence along the bottom, a few trees
    const shed = el('g', {}, root);
    el('rect', { x: x0 + 0.3, y: y0 + 0.25, width: 3.4, height: 1.5, fill: '#8a6a4a', stroke: '#4a3a2a', 'stroke-width': 0.05 }, shed);
    el('polygon', { points: `${x0 + 0.2},${y0 + 0.3} ${x0 + 2},${y0 - 0.2} ${x0 + 3.8},${y0 + 0.3}`, fill: '#6b4b3a' }, shed);
    el('rect', { x: x0 + 1.4, y: y0 + 0.9, width: 0.9, height: 0.85, fill: '#3a2a1a' }, shed);
    const box = el('g', {}, root);
    el('rect', { x: x1 - 2.6, y: y0 + 0.35, width: 1.2, height: 1.0, fill: '#d8d2c0', stroke: '#5a5648', 'stroke-width': 0.05 }, box);
    el('rect', { x: x1 - 2.7, y: y0 + 0.25, width: 1.4, height: 0.25, fill: '#6b5b4a' }, box);
    el('rect', { x: x1 - 2.4, y: y0 + 0.6, width: 0.3, height: 0.3, fill: '#a8c8d8' }, box);
    el('rect', { x: x1 - 1.9, y: y0 + 0.6, width: 0.3, height: 0.3, fill: '#a8c8d8' }, box);
    const tower = el('g', {}, root);
    el('circle', { cx: x1 - 0.9, cy: y1 - 1.0, r: 0.55, fill: '#7a8794', stroke: '#3a4450', 'stroke-width': 0.05 }, tower);
    el('circle', { cx: x1 - 0.9, cy: y1 - 1.0, r: 0.3, fill: '#5a6774' }, tower);
    for (const [tx, ty, r] of [[x0 + 0.9, y1 - 0.9, 0.55], [x0 + 1.9, y1 - 0.6, 0.4], [x1 - 3.0, y1 - 0.7, 0.45]]) {
        el('circle', { cx: tx, cy: ty, r, fill: '#2c5a2e' }, root);
        el('circle', { cx: tx - 0.1, cy: ty - 0.1, r: r * 0.6, fill: '#3b7340' }, root);
    }
    for (let x = x0 + 0.2; x < x1 - 0.2; x += 0.45) el('line', { x1: x, y1: y1 - 0.15, x2: x, y2: y1 - 0.45, stroke: '#a89878', 'stroke-width': 0.05 }, root);
    el('line', { x1: x0 + 0.2, y1: y1 - 0.3, x2: x1 - 0.2, y2: y1 - 0.3, stroke: '#a89878', 'stroke-width': 0.05 }, root);
}

function drawBuffer(root, x, y, angle) {
    const g = el('g', { transform: `translate(${x} ${y}) rotate(${angle})` }, root);
    el('rect', { x: -0.12, y: -0.32, width: 0.12, height: 0.64, fill: '#5a4a3a' }, g);
    el('rect', { x: -0.3, y: -0.24, width: 0.18, height: 0.12, fill: '#7a1a1a' }, g);
    el('rect', { x: -0.3, y: 0.12, width: 0.18, height: 0.12, fill: '#7a1a1a' }, g);
    el('circle', { cx: -0.05, cy: 0, r: 0.07, fill: '#e8c040' }, g); // buffer stop lamp
}

function shapeMarker(parent, shape, x, y, s, fill) {
    const a = { fill };
    switch (shape) {
        case 'circle': return el('circle', { cx: x, cy: y, r: s, ...a }, parent);
        case 'square': return el('rect', { x: x - s, y: y - s, width: 2 * s, height: 2 * s, ...a }, parent);
        case 'triangle': return el('polygon', { points: `${x},${y - s} ${x + s},${y + s} ${x - s},${y + s}`, ...a }, parent);
        case 'diamond': return el('polygon', { points: `${x},${y - s * 1.2} ${x + s * 1.2},${y} ${x},${y + s * 1.2} ${x - s * 1.2},${y}`, ...a }, parent);
        case 'bar': return el('rect', { x: x - s * 1.3, y: y - s * 0.4, width: s * 2.6, height: s * 0.8, ...a }, parent);
        default: return el('path', { d: `M${x - s},${y} H${x + s} M${x},${y - s} V${y + s}`, stroke: fill, 'stroke-width': s * 0.5, fill: 'none' }, parent);
    }
}

/** Wagon art, centred on the origin, long axis along x. type chosen from the wagon number: 16-ton mineral, van, tank. */
export function drawWagon(parent, w) {
    const g = el('g', { class: 'ig-wagon' }, parent);
    const body = el('g', {}, g);
    const type = w.number % 3;
    const L = WAGON_LEN, H = BODY_W;
    el('rect', { x: -L / 2 - 0.1, y: -H / 2 + 0.06, width: 0.1, height: 0.1, fill: '#222' }, body); // buffers
    el('rect', { x: L / 2, y: -H / 2 + 0.06, width: 0.1, height: 0.1, fill: '#222' }, body);
    el('rect', { x: -L / 2 - 0.1, y: H / 2 - 0.16, width: 0.1, height: 0.1, fill: '#222' }, body);
    el('rect', { x: L / 2, y: H / 2 - 0.16, width: 0.1, height: 0.1, fill: '#222' }, body);
    const fill = w.stuck ? '#7d7d78' : w.color;
    el('rect', { x: -L / 2, y: -H / 2, width: L, height: H, rx: 0.04, fill, stroke: '#1d1d1d', 'stroke-width': 0.04 }, body);
    if (type === 0) { // open mineral wagon: dark hold
        el('rect', { x: -L / 2 + 0.07, y: -H / 2 + 0.07, width: L - 0.14, height: H - 0.14, fill: 'rgba(0,0,0,0.35)' }, body);
        for (let i = 1; i < 4; i++) el('line', { x1: -L / 2 + i * L / 4, y1: -H / 2, x2: -L / 2 + i * L / 4, y2: H / 2, stroke: 'rgba(0,0,0,0.45)', 'stroke-width': 0.03 }, body);
    } else if (type === 1) { // van: planking and a door
        for (let i = 1; i < 8; i++) el('line', { x1: -L / 2 + i * L / 8, y1: -H / 2, x2: -L / 2 + i * L / 8, y2: H / 2, stroke: 'rgba(0,0,0,0.25)', 'stroke-width': 0.02 }, body);
        el('rect', { x: -0.14, y: -H / 2, width: 0.28, height: H, fill: 'rgba(0,0,0,0.2)' }, body);
    } else { // tank
        el('ellipse', { cx: 0, cy: 0, rx: L / 2 - 0.05, ry: H / 2 - 0.05, fill: 'rgba(255,255,255,0.18)', stroke: 'rgba(0,0,0,0.5)', 'stroke-width': 0.03 }, body);
    }
    if (w.stuck) { // chocks and a red cross
        el('polygon', { points: `${-L / 2 + 0.05},${H / 2} ${-L / 2 + 0.2},${H / 2} ${-L / 2 + 0.05},${H / 2 + 0.12}`, fill: '#111' }, body);
        el('polygon', { points: `${L / 2 - 0.05},${-H / 2} ${L / 2 - 0.2},${-H / 2} ${L / 2 - 0.05},${-H / 2 - 0.12}`, fill: '#111' }, body);
        el('path', { d: `M-0.2,-0.15 L0.2,0.15 M-0.2,0.15 L0.2,-0.15`, stroke: '#b02020', 'stroke-width': 0.07 }, body);
    }
    const label = el('g', { class: 'ig-label' }, g); // kept upright
    if (!w.stuck) {
        el('rect', { x: -0.26, y: -0.17, width: 0.52, height: 0.34, rx: 0.05, fill: 'rgba(0,0,0,0.55)' }, label);
        const t = el('text', { x: 0.06, y: 0.1, 'text-anchor': 'middle', 'font-size': 0.3, 'font-weight': 700, fill: '#fff', 'font-family': 'system-ui, sans-serif' }, label);
        t.textContent = w.number;
        shapeMarker(label, w.shape, -0.15, 0, 0.06, '#fff');
    }
    return g;
}

/** 1960s diesel shunter in generic blue and grey, nose towards +x. */
export function drawLoco(parent) {
    const g = el('g', { class: 'ig-loco' }, parent);
    const body = el('g', {}, g);
    const L = LOCO_LEN, H = 0.56;
    el('rect', { x: -L / 2 - 0.1, y: -H / 2 + 0.06, width: 0.1, height: 0.1, fill: '#222' }, body);
    el('rect', { x: L / 2, y: -H / 2 + 0.06, width: 0.1, height: 0.1, fill: '#222' }, body);
    el('rect', { x: -L / 2 - 0.1, y: H / 2 - 0.16, width: 0.1, height: 0.1, fill: '#222' }, body);
    el('rect', { x: L / 2, y: H / 2 - 0.16, width: 0.1, height: 0.1, fill: '#222' }, body);
    el('rect', { x: -L / 2, y: -H / 2, width: L, height: H, rx: 0.06, fill: '#2f5f8f', stroke: '#14293f', 'stroke-width': 0.04 }, body);
    el('rect', { x: -L / 2 + 0.05, y: -H / 2 + 0.07, width: 0.5, height: H - 0.14, rx: 0.04, fill: '#d9c74a' }, body); // cab (rear), warning panel colour
    el('rect', { x: -L / 2 + 0.2, y: -H / 2 + 0.14, width: 0.2, height: H - 0.28, fill: '#a9d0e0' }, body); // cab windows
    el('rect', { x: 0.0, y: -0.15, width: 0.4, height: 0.3, rx: 0.04, fill: '#1f4a73' }, body); // bonnet
    el('circle', { cx: 0.2, cy: 0, r: 0.09, fill: '#111' }, body); // exhaust
    el('circle', { cx: L / 2 - 0.04, cy: 0, r: 0.05, fill: '#ffe9a0' }, body); // headlamp
    return g;
}

/**
 * Creates the renderer for a layout inside `svg`. Returns { update(sim), hitPoint, hitCoupling, destroy }.
 * Input callbacks: onPoint(id), onCoupling(rakeId, index).
 */
export function createRenderer(svg, layout, handlers = {}) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const b = layout.bounds;
    svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.w} ${b.h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: '#3d6b3a' }, svg);
    drawScenery(svg, b);
    const track = el('g', { class: 'ig-track' }, svg);
    for (const t of Object.values(layout.tracks)) {
        el('polyline', { points: polyline(t.pts), fill: 'none', stroke: '#8d7f6a', 'stroke-width': 1.0, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, track); // ballast
    }
    for (const t of Object.values(layout.tracks)) {
        for (const s of along(layout, t, 0.34)) {
            el('line', { x1: -0.3, y1: 0, x2: 0.3, y2: 0, stroke: '#4a3a2a', 'stroke-width': 0.1, transform: `translate(${s.x} ${s.y}) rotate(${s.angle * 180 / Math.PI + 90})` }, track);
        }
    }
    for (const t of Object.values(layout.tracks)) {
        for (const off of [-0.18, 0.18]) {
            const pts = t.pts.map((p, i) => {
                const q = t.pts[Math.min(i + 1, t.pts.length - 1)], r = t.pts[Math.max(i - 1, 0)];
                const a = Math.atan2(q[1] - r[1], q[0] - r[0]);
                return [p[0] - Math.sin(a) * off, p[1] + Math.cos(a) * off];
            });
            el('polyline', { points: polyline(pts), fill: 'none', stroke: '#c9ced4', 'stroke-width': 0.05, 'stroke-linejoin': 'round' }, track);
        }
    }
    for (const t of Object.values(layout.tracks)) {
        for (const end of ['a', 'b']) {
            if (t.ends[end].type !== 'buffer') continue;
            const p = end === 'a' ? t.pts[0] : t.pts[t.pts.length - 1];
            const q = end === 'a' ? t.pts[1] : t.pts[t.pts.length - 2];
            drawBuffer(svg, p[0], p[1], Math.atan2(p[1] - q[1], p[0] - q[0]) * 180 / Math.PI + 180);
        }
    }

    // points: a bright blade on the active leg and a tappable lever beside the point
    const pointLayer = el('g', { class: 'ig-points' }, svg);
    const pointEls = {};
    layout.pointIds.forEach((id, i) => {
        const p = layout.points[id];
        const div = layout.tracks[p.legs.diverging.track];
        const q = p.legs.diverging.end === 'a' ? div.pts[1] : div.pts[div.pts.length - 2];
        const side = q[1] < p.y ? 1 : -1; // lever on the opposite side to the diverging leg
        const g = el('g', { class: 'ig-point', 'data-point': id, transform: `translate(${p.x - 0.6} ${p.y + side * 0.95})` }, pointLayer);
        el('circle', { r: 0.95, fill: 'transparent' }, g); // generous hit area
        el('circle', { r: 0.38, fill: '#2a2a2a', stroke: '#e8e0c8', 'stroke-width': 0.05 }, g);
        const arrow = el('path', { d: 'M-0.2,0 H0.2 M0.06,-0.12 L0.2,0 L0.06,0.12', stroke: '#ffdf50', 'stroke-width': 0.07, fill: 'none', 'stroke-linecap': 'round' }, g);
        const label = el('text', { y: side > 0 ? 0.78 : -0.55, 'text-anchor': 'middle', 'font-size': 0.34, fill: '#fff', 'font-weight': 700, 'font-family': 'system-ui, sans-serif' }, g);
        label.textContent = i < 9 ? String(i + 1) : '';
        const blade = el('polyline', { fill: 'none', stroke: '#ffdf50', 'stroke-width': 0.1, 'stroke-linecap': 'round', opacity: 0.9 }, pointLayer);
        pointEls[id] = { g, arrow, blade, side };
    });

    const vehicleLayer = el('g', { class: 'ig-vehicles' }, svg);
    const hookLayer = el('g', { class: 'ig-hooks' }, svg); // above the wagons so the hooks can be tapped
    const vehicleEls = {};

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

    let hookKey = '';
    const hookEls = [];

    svg.addEventListener('pointerdown', ev => {
        const point = ev.target.closest?.('[data-point]');
        if (point) { ev.preventDefault(); handlers.onPoint?.(point.getAttribute('data-point')); return; }
        const hook = ev.target.closest?.('[data-hook]');
        if (hook) { ev.preventDefault(); handlers.onCoupling?.(hook.getAttribute('data-rake'), Number(hook.getAttribute('data-index'))); }
    });

    return {
        update(sim) {
            for (const [id, pe] of Object.entries(pointEls)) {
                const state = sim.points[id];
                const p = layout.points[id];
                pe.blade.setAttribute('points', legBlade(p, state));
                const dir = layout.tracks[p.legs[state].track];
                const q = pointAt(layout, p.legs[state].track, p.legs[state].end === 'a' ? Math.min(1, dir.length) : Math.max(0, dir.length - 1));
                const ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
                pe.arrow.setAttribute('transform', `rotate(${ang})`);
            }
            const poses = sim.poses();
            for (const v of poses) {
                let ve = vehicleEls[v.id];
                if (!ve) {
                    const root = el('g', { class: `ig-vehicle ${v.kind}` }, vehicleLayer);
                    const art = v.kind === 'loco' ? drawLoco(root) : drawWagon(root, v);
                    ve = vehicleEls[v.id] = { root, art, label: art.querySelector('.ig-label') };
                }
                const deg = v.angle * 180 / Math.PI;
                ve.root.setAttribute('transform', `translate(${v.x} ${v.y}) rotate(${deg})`);
                if (v.kind === 'loco') ve.art.setAttribute('transform', v.flip ? 'scale(-1 1)' : '');
                if (ve.label) {
                    const upright = ((deg % 360) + 540) % 360 - 180; // keep numbers readable
                    ve.label.setAttribute('transform', `rotate(${-deg + (Math.abs(upright) > 90 ? 180 : 0)})`);
                }
            }
            const hooks = sim.couplings();
            const key = hooks.map(h => `${h.rake}:${h.index}`).join(',');
            if (key !== hookKey) {
                hookKey = key;
                while (hookLayer.firstChild) hookLayer.removeChild(hookLayer.firstChild);
                hookEls.length = 0;
                for (const h of hooks) {
                    const g = el('g', { class: 'ig-hook', 'data-hook': '1', 'data-rake': h.rake, 'data-index': h.index }, hookLayer);
                    el('circle', { r: 0.4, fill: 'transparent' }, g);
                    el('circle', { r: 0.1, fill: '#e8e0c8', stroke: '#222', 'stroke-width': 0.04 }, g);
                    hookEls.push(g);
                }
            }
            hooks.forEach((h, i) => hookEls[i].setAttribute('transform', `translate(${h.x} ${h.y})`));
        },
        destroy() { while (svg.firstChild) svg.removeChild(svg.firstChild); },
    };
}
