// Rolling stock art: wagons, the 64xx pannier tank and the tappable three-link couplings.
import { el } from './svg.js';
import { LOCO_LEN, WAGON_LEN } from './config.js';
import { hash, rng } from './noise.js';

export const BODY_W = 0.62; // a little wider than the true 0.5 so the type shows round the 0.4-high ID panel

export const WAGON_TYPES = ['mineral', 'van', 'open', 'tank'];
const GREY = '#8c8f8c', BAUXITE = '#7b4a2f', BLACK = '#2b2b2c', RUSTY = '#7b6a5a';

/**
 * DOM-free wagon description: type from the wagon number, livery and weathering from a hash of its id.
 * Body colours are period liveries and never one of the six ID-panel colours.
 */
export function wagonSpec(w) {
    const h = hash(String(w.id ?? w.number));
    const type = WAGON_TYPES[((((w.number ?? 1) - 1) % 4) + 4) % 4];
    const livery = w.stuck ? RUSTY : type === 'mineral' ? GREY : type === 'van' ? BAUXITE : type === 'tank' ? BLACK : (h & 1 ? GREY : BAUXITE);
    const weathering = w.stuck ? 0.9 : 0.25 + ((h >>> 3) % 1000) / 1000 * 0.65; // 0.25 (fairly clean) .. 0.9 (filthy)
    return { type, livery, weathering, sheeted: ((h >>> 1) & 1) === 1, seed: h };
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

/** Buffers on both headstocks plus a drawhook and a hanging link: the chain covers them when coupled. */
function buffers(parent, L, H) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1])
        el('rect', { x: sx < 0 ? -L / 2 - 0.06 : L / 2, y: sy * (H / 2 - 0.1) - 0.04, width: 0.06, height: 0.08, rx: 0.015, fill: '#262626', stroke: '#111', 'stroke-width': 0.012 }, parent);
    for (const sx of [-1, 1]) {
        el('path', { d: `M${sx * L / 2},0 H${sx * (L / 2 + 0.05)}`, stroke: '#141414', 'stroke-width': 0.03, fill: 'none' }, parent);
        el('ellipse', { cx: sx * (L / 2 + 0.05), cy: 0.03, rx: 0.03, ry: 0.02, fill: 'none', stroke: '#141414', 'stroke-width': 0.014 }, parent);
    }
}

/** Wagon art, centred on the origin, long axis along x. Four types in period liveries, weathered, with a bold ID panel in the upright label group. */
export function drawWagon(parent, w, ctx) {
    const spec = wagonSpec(w);
    const tex = ctx?.textures;
    const g = el('g', { class: 'ig-wagon' }, parent);
    const body = el('g', {}, g);
    const L = WAGON_LEN, H = BODY_W;
    const rand = rng(spec.seed);
    buffers(body, L, H);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) // axle ends peeping out under the sides
        el('rect', { x: sx * 0.3 - 0.045, y: sy < 0 ? -H / 2 - 0.025 : H / 2 + 0.005, width: 0.09, height: 0.02, fill: '#0e0e0e' }, body);
    el('rect', { x: -L / 2, y: -H / 2, width: L, height: H, rx: 0.03, fill: spec.livery, stroke: '#141414', 'stroke-width': 0.035 }, body);

    switch (spec.type) {
        case 'mineral': { // 16-ton steel mineral: thin grey rim, black coal heaped inside, corner stanchions
            el('rect', { x: -L / 2 + 0.04, y: -H / 2 + 0.04, width: L - 0.08, height: H - 0.08, rx: 0.015, fill: '#0c0c0d', stroke: '#4a4c4a', 'stroke-width': 0.012 }, body);
            if (tex) el('rect', { x: -L / 2 + 0.04, y: -H / 2 + 0.04, width: L - 0.08, height: H - 0.08, fill: `url(#${tex.coal})`, opacity: 0.55 }, body);
            el('ellipse', { cx: 0, cy: 0, rx: L / 2 - 0.12, ry: H / 2 - 0.1, fill: 'rgba(255,255,255,0.05)' }, body);
            for (const sx of [-1, 1]) for (const sy of [-1, 1]) el('rect', { x: sx * (L / 2 - 0.045) - 0.035, y: sy * (H / 2 - 0.045) - 0.035, width: 0.07, height: 0.07, fill: '#a9aca9', stroke: '#222', 'stroke-width': 0.012 }, body);
            for (const sy of [-1, 1]) el('rect', { x: -0.035, y: sy * (H / 2 - 0.045) - 0.035, width: 0.07, height: 0.07, fill: '#a9aca9', stroke: '#222', 'stroke-width': 0.012 }, body);
            break;
        }
        case 'van': { // 12-ton ventilated van: pale weathered roof with dark ribs, ridge line, vents
            el('rect', { x: -L / 2 + 0.04, y: -H / 2 + 0.02, width: L - 0.08, height: H - 0.04, rx: 0.03, fill: '#c6c5bb', stroke: '#3a3a36', 'stroke-width': 0.012 }, body);
            for (let i = 1; i < 14; i++) el('line', { x1: -L / 2 + 0.04 + i * (L - 0.08) / 14, y1: -H / 2 + 0.03, x2: -L / 2 + 0.04 + i * (L - 0.08) / 14, y2: H / 2 - 0.03, stroke: 'rgba(30,30,28,0.55)', 'stroke-width': 0.018 }, body);
            el('line', { x1: -L / 2 + 0.05, y1: 0, x2: L / 2 - 0.05, y2: 0, stroke: 'rgba(255,255,255,0.7)', 'stroke-width': 0.03 }, body);
            for (const x of [-0.4, 0.4]) el('circle', { cx: x, cy: 0, r: 0.05, fill: '#4a4a46', stroke: '#e8e7de', 'stroke-width': 0.016 }, body);
            break;
        }
        case 'open': { // 5-plank open: tan planked floor, or a dark sheet with rope lines, inside plank sides
            if (spec.sheeted) {
                el('rect', { x: -L / 2 + 0.055, y: -H / 2 + 0.055, width: L - 0.11, height: H - 0.11, rx: 0.05, fill: '#8d8a6c', stroke: '#3a3826', 'stroke-width': 0.014 }, body);
                for (const y of [-0.15, 0, 0.15]) el('line', { x1: -L / 2 + 0.07, y1: y, x2: L / 2 - 0.07, y2: y, stroke: '#3b3626', 'stroke-width': 0.016 }, body);
                for (let i = 1; i < 5; i++) el('line', { x1: -L / 2 + i * L / 5, y1: -H / 2 + 0.07, x2: -L / 2 + i * L / 5, y2: H / 2 - 0.07, stroke: '#3b3626', 'stroke-width': 0.016 }, body);
            } else {
                el('rect', { x: -L / 2 + 0.055, y: -H / 2 + 0.055, width: L - 0.11, height: H - 0.11, fill: '#b99660', stroke: '#2a1f14', 'stroke-width': 0.014 }, body);
                if (tex) el('rect', { x: -L / 2 + 0.055, y: -H / 2 + 0.055, width: L - 0.11, height: H - 0.11, fill: `url(#${tex.timber})`, opacity: 0.4 }, body);
                for (let i = 1; i < 6; i++) el('line', { x1: -L / 2 + 0.06, y1: -H / 2 + 0.055 + i * (H - 0.11) / 6, x2: L / 2 - 0.06, y2: -H / 2 + 0.055 + i * (H - 0.11) / 6, stroke: 'rgba(40,25,10,0.7)', 'stroke-width': 0.014 }, body);
            }
            break;
        }
        default: { // 14-ton tank: black barrel narrower than the underframe, rounded ends, dome and walkway
            el('rect', { x: -L / 2, y: -H / 2, width: L, height: H, rx: 0.03, fill: '#b4b6b2', stroke: '#141414', 'stroke-width': 0.035 }, body); // pale underframe shows at the corners
            el('rect', { x: -L / 2 + 0.03, y: -H / 2 + 0.07, width: L - 0.06, height: H - 0.14, rx: 0.22, fill: '#4a4e52', stroke: '#000', 'stroke-width': 0.02 }, body);
            el('rect', { x: -L / 2 + 0.12, y: -H / 2 + 0.1, width: L - 0.24, height: 0.045, rx: 0.02, fill: 'rgba(255,255,255,0.2)' }, body);
            for (const x of [-0.4, -0.27, 0.27, 0.4]) el('line', { x1: x, y1: -H / 2 + 0.07, x2: x, y2: H / 2 - 0.07, stroke: '#5a5c5e', 'stroke-width': 0.022 }, body);
            el('line', { x1: -0.3, y1: -H / 2 + 0.115, x2: 0.3, y2: -H / 2 + 0.115, stroke: '#a8a8a2', 'stroke-width': 0.025 }, body); // walkway
            el('circle', { cx: 0.35, cy: 0.1, r: 0.07, fill: '#2a2b2d', stroke: '#9a9a94', 'stroke-width': 0.018 }, body); // filler dome
            el('circle', { cx: 0.35, cy: 0.1, r: 0.03, fill: '#777' }, body);
            el('line', { x1: -L / 2 + 0.02, y1: H / 2 - 0.05, x2: -L / 2 + 0.02, y2: H / 2 + 0.05, stroke: '#111', 'stroke-width': 0.015 }, body); // ladder
        }
    }

    if (w.stuck) { // crippled: scotches at the wheels and a red "not to be moved" target
        el('polygon', { points: `-0.3,${H / 2} -0.12,${H / 2} -0.3,${H / 2 + 0.14}`, fill: '#2a1b10', stroke: '#111', 'stroke-width': 0.012 }, body);
        el('polygon', { points: `0.3,${-H / 2} 0.12,${-H / 2} 0.3,${-H / 2 - 0.14}`, fill: '#2a1b10', stroke: '#111', 'stroke-width': 0.012 }, body);
        el('circle', { cx: 0, cy: 0, r: 0.2, fill: '#f2efe6', stroke: '#b02020', 'stroke-width': 0.045 }, body);
        el('circle', { cx: 0, cy: 0, r: 0.09, fill: '#b02020' }, body);
        el('path', { d: 'M-0.24,-0.24 L0.24,0.24 M-0.24,0.24 L0.24,-0.24', stroke: '#b02020', 'stroke-width': 0.05, 'stroke-linecap': 'round' }, body);
    }

    // weathering: grime streaks, rust patches and brake dust, varying per wagon; skipped on a slow device
    if (ctx?.quality !== 'low') {
        if (tex) el('rect', { x: -L / 2, y: -H / 2, width: L, height: H, rx: 0.03, fill: `url(#${tex.grime})`, opacity: (spec.weathering * 0.6).toFixed(2), transform: spec.seed & 2 ? 'scale(-1 1)' : '' }, body);
        const patches = w.stuck ? 5 : Math.round(spec.weathering * 4);
        for (let i = 0; i < patches; i++)
            el('ellipse', { cx: ((rand() - 0.5) * 0.85).toFixed(3), cy: ((rand() - 0.5) * 0.4).toFixed(3), rx: (0.03 + rand() * 0.06).toFixed(3), ry: (0.02 + rand() * 0.03).toFixed(3), fill: '#8a4a22', opacity: (0.25 + rand() * 0.35).toFixed(2) }, body);
        for (const sx of [-1, 1]) el('rect', { x: sx * 0.3 - 0.07, y: -H / 2 + 0.01, width: 0.14, height: H - 0.02, fill: 'rgba(40,25,15,0.18)', rx: 0.04 }, body); // brake dust over the axles
    }

    const label = el('g', { class: 'ig-label' }, g); // kept upright
    if (!w.stuck) {
        el('rect', { x: -0.31, y: -0.2, width: 0.62, height: 0.4, rx: 0.05, fill: w.color, stroke: '#101010', 'stroke-width': 0.04 }, label);
        el('rect', { x: -0.285, y: -0.175, width: 0.57, height: 0.35, rx: 0.035, fill: 'none', stroke: 'rgba(255,248,230,0.55)', 'stroke-width': 0.014 }, label);
        const t = el('text', { x: 0.1, y: 0.105, 'text-anchor': 'middle', 'font-size': 0.3, 'font-weight': 800, fill: '#fff', stroke: 'rgba(0,0,0,0.45)', 'stroke-width': 0.012, 'font-family': 'system-ui, sans-serif' }, label);
        t.textContent = w.number;
        shapeMarker(label, w.shape, -0.17, 0, 0.075, '#fff');
    }
    return g;
}

/**
 * GWR 6400 class 0-6-0 pannier tank in BR lined green, LOCO_LEN (1.7) long, chimney towards +x.
 * Loco-local coordinates (before the facing flip): chimney (0.64, 0), safety valve (-0.1, 0), dome (0.14, 0), front beam x = 0.85, bunker at the rear (x -0.85 .. -0.6).
 */
export function drawLoco(parent, ctx) {
    const tex = ctx?.textures;
    const g = el('g', { class: 'ig-loco' }, parent);
    const body = el('g', {}, g);
    const L = LOCO_LEN, H = BODY_W, hx = L / 2;
    const GREEN = '#1f5a34', GREEN_HI = '#2e7a48', LINE = '#d8841f';
    buffers(body, L, H);
    el('rect', { x: -hx, y: -H / 2, width: L, height: H, rx: 0.03, fill: '#1b1b1b', stroke: '#0a0a0a', 'stroke-width': 0.03 }, body); // black running plate
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) // steps
        el('rect', { x: sx * 0.45 - 0.06, y: sy < 0 ? -H / 2 - 0.03 : H / 2, width: 0.12, height: 0.03, fill: '#3a3a3a' }, body);
    // coal bunker at the rear
    el('rect', { x: -hx + 0.03, y: -0.28, width: 0.24, height: 0.56, rx: 0.02, fill: '#26282a' }, body);
    el('rect', { x: -hx + 0.06, y: -0.24, width: 0.18, height: 0.48, rx: 0.03, fill: tex ? `url(#${tex.coal})` : '#111' }, body);
    // cab roof with rain strips
    el('rect', { x: -hx + 0.28, y: -0.29, width: 0.32, height: 0.58, rx: 0.025, fill: '#303336', stroke: '#111', 'stroke-width': 0.02 }, body);
    for (const y of [-0.23, 0.23]) el('line', { x1: -hx + 0.3, y1: y, x2: -hx + 0.58, y2: y, stroke: '#6c7074', 'stroke-width': 0.014 }, body);
    el('rect', { x: -hx + 0.34, y: -0.09, width: 0.2, height: 0.18, rx: 0.02, fill: '#3d4145' }, body); // roof ventilator
    // boiler between two long pannier tanks
    const x0 = -hx + 0.62, x1 = 0.5;
    el('rect', { x: x0, y: -0.14, width: x1 - x0, height: 0.28, fill: GREEN, stroke: '#0f2c19', 'stroke-width': 0.02 }, body);
    el('rect', { x: x0, y: -0.04, width: x1 - x0, height: 0.05, fill: GREEN_HI, opacity: 0.7 }, body);
    for (const sy of [-1, 1]) {
        const y = sy < 0 ? -0.29 : 0.14;
        el('rect', { x: x0, y, width: x1 - x0, height: 0.15, rx: 0.025, fill: GREEN, stroke: '#0f2c19', 'stroke-width': 0.02 }, body);
        el('rect', { x: x0 + 0.015, y: y + 0.015, width: x1 - x0 - 0.03, height: 0.12, rx: 0.015, fill: 'none', stroke: LINE, 'stroke-width': 0.012 }, body); // orange-black-orange lining
        el('rect', { x: x0 + 0.03, y: y + 0.03, width: x1 - x0 - 0.06, height: 0.09, rx: 0.01, fill: 'none', stroke: '#111', 'stroke-width': 0.01 }, body);
        for (const x of [-0.12, 0.2]) el('circle', { cx: x, cy: y + 0.075, r: 0.034, fill: '#16402a', stroke: '#9fb59f', 'stroke-width': 0.01 }, body); // filler lids
    }
    // dome and brass safety-valve bonnet
    el('circle', { cx: 0.14, cy: 0, r: 0.085, fill: GREEN, stroke: '#0f2c19', 'stroke-width': 0.016 }, body);
    el('circle', { cx: 0.12, cy: -0.02, r: 0.035, fill: GREEN_HI, opacity: 0.8 }, body);
    el('circle', { cx: -0.1, cy: 0, r: 0.055, fill: '#c8a032', stroke: '#6b5414', 'stroke-width': 0.012 }, body);
    el('circle', { cx: -0.115, cy: -0.015, r: 0.02, fill: '#f2dc8a' }, body);
    // smokebox and chimney
    el('rect', { x: x1, y: -0.18, width: 0.3, height: 0.36, rx: 0.13, fill: '#1c1d1f', stroke: '#050505', 'stroke-width': 0.02 }, body);
    el('circle', { cx: 0.64, cy: 0, r: 0.075, fill: '#0b0b0b' }, body);
    el('circle', { cx: 0.64, cy: 0, r: 0.065, fill: 'none', stroke: '#b8702e', 'stroke-width': 0.03 }, body); // copper cap
    el('circle', { cx: 0.64, cy: -0.02, r: 0.02, fill: '#e1a266', opacity: 0.7 }, body);
    // red buffer beams and headlamp
    for (const sx of [-1, 1]) el('rect', { x: sx < 0 ? -hx : hx - 0.05, y: -H / 2, width: 0.05, height: H, fill: '#a3241f', stroke: '#3a0c0a', 'stroke-width': 0.01 }, body);
    el('circle', { cx: hx - 0.1, cy: 0, r: 0.03, fill: '#fff1b0' }, body);
    if (ctx?.quality !== 'low' && tex) el('rect', { x: -hx, y: -H / 2, width: L, height: H, rx: 0.03, fill: `url(#${tex.grime})`, opacity: 0.3 }, body);
    return g;
}

/** A tappable three-link coupling (the pointer handler in render.js reads its data attributes). Drawn along +x; render.js rotates it onto the track. */
export function drawCoupling(parent, h, ctx) {
    const g = el('g', { class: 'ig-hook', 'data-hook': '1', 'data-rake': h.rake, 'data-index': h.index }, parent);
    el('circle', { r: 0.4, fill: 'transparent' }, g);
    for (const x of [-0.11, 0, 0.11]) el('ellipse', { cx: x, cy: 0, rx: 0.065, ry: 0.034, fill: 'none', stroke: '#16130f', 'stroke-width': 0.03 }, g); // three links
    for (const x of [-0.11, 0, 0.11]) el('ellipse', { cx: x, cy: 0, rx: 0.065, ry: 0.034, fill: 'none', stroke: '#b9b4a6', 'stroke-width': 0.012 }, g);
    el('circle', { r: 0.17, fill: 'none', stroke: '#ffd21f', 'stroke-width': 0.04 }, g); // high-visibility ring
    return g;
}
