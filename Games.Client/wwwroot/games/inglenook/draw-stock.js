// Rolling stock art: wagons, the shunting loco and the tappable coupling hooks.
import { el } from './svg.js';
import { LOCO_LEN, WAGON_LEN } from './config.js';

export const BODY_W = 0.5;

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
export function drawWagon(parent, w, ctx) {
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
export function drawLoco(parent, ctx) {
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

/** A tappable coupling hook (the pointer handler in render.js reads its data attributes). */
export function drawCoupling(parent, h, ctx) {
    const g = el('g', { class: 'ig-hook', 'data-hook': '1', 'data-rake': h.rake, 'data-index': h.index }, parent);
    el('circle', { r: 0.4, fill: 'transparent' }, g);
    el('circle', { r: 0.1, fill: '#e8e0c8', stroke: '#222', 'stroke-width': 0.04 }, g);
    return g;
}
