// Yard scenery in plan view: goods shed, signal box, staithes, water tower and crane, office, lamps, trees, fence and clutter, each with a
// daylight shadow. Placement comes from scenery-plan.js. Low items go in `sceneryLow`; lamp heads and tree canopies go in `sceneryHigh`
// so a vehicle passes beneath anything that overhangs.
import { el } from './svg.js';
import { planScenery, shadowOffset, ITEM_HEIGHT } from './scenery-plan.js';

const SLATE = '#59616a', BRICK = '#8c4e3a', FELT = '#6f6a60';

/** A pitched roof seen from above: base colour, texture, a lit slope (towards the sun, upper left), a darker slope and a ridge. */
function roof(g, x, y, w, h, base, tex, ridgeAlong = 'x') {
    el('rect', { x, y, width: w, height: h, fill: base, stroke: '#23272b', 'stroke-width': 0.03 }, g);
    if (tex) el('rect', { x, y, width: w, height: h, fill: tex }, g);
    if (ridgeAlong === 'x') {
        el('rect', { x, y, width: w, height: h / 2, fill: '#fff', 'fill-opacity': 0.13 }, g);
        el('rect', { x, y: y + h / 2, width: w, height: h / 2, fill: '#000', 'fill-opacity': 0.13 }, g);
        el('line', { x1: x, y1: y + h / 2, x2: x + w, y2: y + h / 2, stroke: '#c4cad0', 'stroke-width': 0.035 }, g);
    } else {
        el('rect', { x, y, width: w / 2, height: h, fill: '#fff', 'fill-opacity': 0.13 }, g);
        el('rect', { x: x + w / 2, y, width: w / 2, height: h, fill: '#000', 'fill-opacity': 0.13 }, g);
        el('line', { x1: x + w / 2, y1: y, x2: x + w / 2, y2: y + h, stroke: '#c4cad0', 'stroke-width': 0.035 }, g);
    }
}

function chimney(g, x, y) {
    el('rect', { x: x - 0.1, y: y - 0.1, width: 0.2, height: 0.2, fill: BRICK, stroke: '#3a1d14', 'stroke-width': 0.02 }, g);
    el('rect', { x: x - 0.06, y: y - 0.06, width: 0.12, height: 0.12, fill: '#2a2320' }, g);
}

const crate = (g, x, y, w, h, fill) => el('rect', { x, y, width: w, height: h, fill, stroke: '#2b1f14', 'stroke-width': 0.015 }, g);

const DRAW = {
    shed(g, it, c) { // building (local y -0.875..0.125), canopy, platform on the +y side
        roof(g, -2.2, -0.875, 4.4, 1.0, SLATE, c.slate);
        for (const x of [-1.4, -0.3, 0.8, 1.7]) {
            el('rect', { x: x - 0.22, y: -0.62, width: 0.44, height: 0.2, fill: '#a9c9d8', stroke: '#2b3a44', 'stroke-width': 0.025 }, g); // skylight
            el('line', { x1: x, y1: -0.62, x2: x, y2: -0.42, stroke: '#2b3a44', 'stroke-width': 0.015 }, g);
        }
        chimney(g, -1.9, -0.5); chimney(g, 1.95, -0.5);
        el('rect', { x: -2.2, y: 0.125, width: 4.4, height: 0.14, fill: '#3b3f44', 'fill-opacity': 0.85 }, g); // canopy edge
        el('rect', { x: -2.2, y: 0.265, width: 4.4, height: 0.61, fill: `url(#${c.tex.setts})`, stroke: '#4c4a44', 'stroke-width': 0.02 }, g); // platform
        el('rect', { x: -2.2, y: 0.265, width: 4.4, height: 0.61, fill: '#d9d2bd', 'fill-opacity': 0.35 }, g);
        el('line', { x1: -2.2, y1: 0.84, x2: 2.2, y2: 0.84, stroke: '#ece8d8', 'stroke-width': 0.04 }, g); // white platform edge
        crate(g, -1.3, 0.4, 0.3, 0.22, '#9a7a4a'); crate(g, -0.95, 0.46, 0.22, 0.2, '#8a6a3e'); crate(g, 0.9, 0.4, 0.34, 0.24, '#9a7a4a');
        el('rect', { x: 1.45, y: 0.5, width: 0.28, height: 0.12, fill: '#6f6f6f', stroke: '#2a2a2a', 'stroke-width': 0.015 }, g); // sack barrow
    },
    apron(g, it, c) {
        el('rect', { x: -it.w / 2, y: -it.h / 2, width: it.w, height: it.h, fill: `url(#${c.tex.setts})`, stroke: '#4c4a44', 'stroke-width': 0.025 }, g);
        el('rect', { x: -it.w / 2, y: -it.h / 2, width: it.w, height: it.h, fill: '#cfc7b0', 'fill-opacity': 0.22 }, g);
        for (const y of [-0.5, 0.45]) el('line', { x1: -it.w / 2, y1: y, x2: it.w / 2, y2: y, stroke: '#3a3833', 'stroke-opacity': 0.4, 'stroke-width': 0.015, 'stroke-dasharray': '0.18 0.1' }, g);
        el('rect', { x: 0.7, y: 0.55, width: 0.2, height: 0.2, fill: '#2a2926', 'fill-opacity': 0.7 }, g); // drain
    },
    signalbox(g, it, c) {
        roof(g, -0.5, -0.45, 0.8, 0.9, '#6a5648', c.slate, 'y');
        chimney(g, 0.12, -0.22);
        el('rect', { x: 0.3, y: -0.2, width: 0.2, height: 0.4, fill: '#a58a62', stroke: '#2b1f14', 'stroke-width': 0.02 }, g); // steps
        for (let i = 0; i < 4; i++) el('line', { x1: 0.3, y1: -0.15 + i * 0.1, x2: 0.5, y2: -0.15 + i * 0.1, stroke: '#2b1f14', 'stroke-width': 0.015 }, g);
        el('rect', { x: -0.5, y: -0.45, width: 0.8, height: 0.05, fill: '#e6e1cf', 'fill-opacity': 0.8 }, g); // lookout windows under the eaves
    },
    staithe(g, it, c) { // track on the +y side
        el('rect', { x: -1.7, y: -0.5, width: 3.4, height: 0.75, fill: '#2d261d', stroke: '#17120c', 'stroke-width': 0.03 }, g);
        const sizes = [0.42, 0.34, 0.46, 0.3];
        for (let i = 0; i < 4; i++) {
            const cx = -1.27 + i * 0.85;
            el('ellipse', { cx, cy: -0.12, rx: 0.36, ry: sizes[i], fill: `url(#${c.tex.coal})`, stroke: '#0c0c0e', 'stroke-width': 0.015 }, g);
            el('ellipse', { cx: cx - 0.1, cy: -0.2, rx: 0.12, ry: 0.08, fill: '#fff', 'fill-opacity': 0.16 }, g);
            if (i) el('rect', { x: cx - 0.5, y: -0.5, width: 0.07, height: 0.75, fill: `url(#${c.tex.timber})`, stroke: '#17120c', 'stroke-width': 0.015 }, g); // bay divider
        }
        el('rect', { x: -1.7, y: 0.25, width: 3.4, height: 0.25, fill: `url(#${c.tex.timber})`, stroke: '#17120c', 'stroke-width': 0.025 }, g); // loading stage
        el('line', { x1: -1.7, y1: 0.45, x2: 1.7, y2: 0.45, stroke: '#e6dfc4', 'stroke-opacity': 0.55, 'stroke-width': 0.025 }, g);
    },
    watertower(g) {
        el('circle', { r: 0.6, fill: '#69757f', stroke: '#2a3038', 'stroke-width': 0.04 }, g);
        el('circle', { r: 0.5, fill: '#7d8b96', stroke: '#2f3740', 'stroke-width': 0.02 }, g);
        el('circle', { cx: -0.12, cy: -0.12, r: 0.28, fill: '#fff', 'fill-opacity': 0.17 }, g);
        el('circle', { cx: 0.1, cy: 0.1, r: 0.3, fill: '#000', 'fill-opacity': 0.12 }, g);
        el('rect', { x: -0.1, y: -0.1, width: 0.2, height: 0.2, fill: '#464f57', stroke: '#1d2227', 'stroke-width': 0.02 }, g); // hatch
        el('line', { x1: 0.42, y1: 0.42, x2: 0.6, y2: 0.6, stroke: '#2a3038', 'stroke-width': 0.05 }, g); // ladder
    },
    watercrane(g) { // arm swings towards +y (the track)
        el('circle', { cx: 0, cy: -0.2, r: 0.14, fill: '#2a2623', stroke: '#e07a20', 'stroke-width': 0.03 }, g); // brazier
        el('circle', { cx: 0, cy: -0.2, r: 0.07, fill: '#ff9a30', 'fill-opacity': 0.7 }, g);
        el('circle', { r: 0.09, fill: '#505a63', stroke: '#1d2227', 'stroke-width': 0.02 }, g);
        el('line', { x1: 0, y1: 0, x2: 0.1, y2: 0.34, stroke: '#2a3038', 'stroke-width': 0.06, 'stroke-linecap': 'round' }, g);
        el('circle', { cx: 0.1, cy: 0.36, r: 0.07, fill: '#3b3b34', stroke: '#16160f', 'stroke-width': 0.015 }, g); // canvas bag
    },
    office(g, it, c) {
        roof(g, -0.7, -0.45, 1.4, 0.9, FELT, `url(#${c.tex.grime})`);
        el('rect', { x: -0.7, y: -0.45, width: 1.4, height: 0.9, fill: `url(#${c.tex.grime})`, 'fill-opacity': 0.6 }, g);
        chimney(g, 0.4, -0.15);
        el('rect', { x: -0.2, y: 0.45, width: 0.35, height: 0.1, fill: '#cfc6b0', stroke: '#3a362c', 'stroke-width': 0.015 }, g); // door step
        el('circle', { cx: -0.55, cy: 0.3, r: 0.08, fill: '#4a5a62', stroke: '#1d2227', 'stroke-width': 0.015 }, g); // water butt
    },
    lamp(g) { el('circle', { r: 0.045, fill: '#26282b' }, g); },
    fence(g, it) {
        el('line', { x1: -it.w / 2, y1: 0, x2: it.w / 2, y2: 0, stroke: '#b9a987', 'stroke-width': 0.035 }, g);
        el('line', { x1: -it.w / 2, y1: 0, x2: it.w / 2, y2: 0, stroke: '#6b5a3e', 'stroke-width': 0.11, 'stroke-dasharray': '0.07 0.46' }, g);
    },
    gate(g) {
        for (const s of [-1, 1]) {
            el('rect', { x: s * 0.6 - 0.06, y: -0.08, width: 0.12, height: 0.16, fill: '#6b5a3e', stroke: '#2b1f14', 'stroke-width': 0.015 }, g);
            el('rect', { x: s < 0 ? -0.55 : 0.03, y: -0.03, width: 0.52, height: 0.06, fill: '#dcd8cb', stroke: '#444', 'stroke-width': 0.012 }, g);
        }
    },
    sleepers(g, it, c) {
        el('rect', { x: -it.w / 2, y: -it.h / 2, width: it.w, height: it.h, fill: `url(#${c.tex.timber})`, stroke: '#1f160d', 'stroke-width': 0.025 }, g);
        const long = it.w >= it.h, n = 5;
        for (let i = 1; i < n; i++) {
            const t = -(long ? it.h : it.w) / 2 + (i * (long ? it.h : it.w)) / n;
            el('line', { x1: long ? -it.w / 2 : t, y1: long ? t : -it.h / 2, x2: long ? it.w / 2 : t, y2: long ? t : it.h / 2, stroke: '#1f160d', 'stroke-width': 0.02 }, g);
        }
    },
    drums(g, it) {
        const cols = ['#7a3b2a', '#3d5c78', '#4a4d52', '#6a6a30'];
        const spots = [[-0.18, -0.08], [0.16, -0.06], [0.0, 0.14]];
        spots.forEach(([x, y], i) => {
            if (i === 2 && it.variant % 2) return;
            el('circle', { cx: x, cy: y, r: 0.14, fill: cols[(it.variant + i) % 4], stroke: '#15120e', 'stroke-width': 0.02 }, g);
            el('circle', { cx: x, cy: y, r: 0.09, fill: 'none', stroke: '#fff', 'stroke-opacity': 0.3, 'stroke-width': 0.015 }, g);
        });
    },
    barrow(g) {
        el('rect', { x: -0.2, y: -0.09, width: 0.34, height: 0.18, fill: '#8a3a2a', stroke: '#2a0e08', 'stroke-width': 0.02 }, g);
        for (const s of [-1, 1]) el('line', { x1: -0.2, y1: s * 0.07, x2: -0.34, y2: s * 0.1, stroke: '#4a3a24', 'stroke-width': 0.03, 'stroke-linecap': 'round' }, g);
        el('circle', { cx: 0.2, cy: 0, r: 0.06, fill: '#222' }, g);
    },
    coalheap(g, it, c) {
        el('ellipse', { rx: 0.48, ry: 0.36, fill: `url(#${c.tex.coal})`, stroke: '#0c0c0e', 'stroke-width': 0.02 }, g);
        el('ellipse', { cx: -0.12, cy: -0.1, rx: 0.17, ry: 0.1, fill: '#fff', 'fill-opacity': 0.16 }, g);
        el('circle', { cx: 0.4, cy: 0.28, r: 0.03, fill: '#1a1a1c' }, g);
    },
    lorry(g, it) { // cab at the +x end; a plain unmarked flatbed
        const cab = ['#3f6b8a', '#8a3f3a', '#5a7a4a'][it.variant % 3];
        for (const s of [-1, 1]) for (const x of [-0.55, 0.55]) el('rect', { x: x - 0.14, y: s * 0.37 - (s < 0 ? 0.02 : 0.06), width: 0.28, height: 0.08, rx: 0.02, fill: '#16171a' }, g); // wheels
        el('rect', { x: -0.85, y: -0.3, width: 1.2, height: 0.6, fill: '#6f5b3a', stroke: '#241a0e', 'stroke-width': 0.025 }, g); // flatbed
        el('rect', { x: -0.78, y: -0.24, width: 1.06, height: 0.48, fill: '#6f6e50', stroke: '#2c2c1c', 'stroke-width': 0.02 }, g); // sheeted load
        for (const x of [-0.45, -0.1, 0.22]) el('line', { x1: x, y1: -0.24, x2: x, y2: 0.24, stroke: '#2c2c1c', 'stroke-width': 0.015 }, g);
        el('rect', { x: 0.38, y: -0.32, width: 0.47, height: 0.64, rx: 0.05, fill: cab, stroke: '#14181c', 'stroke-width': 0.025 }, g); // cab
        el('rect', { x: 0.38, y: -0.32, width: 0.47, height: 0.3, fill: '#fff', 'fill-opacity': 0.14 }, g);
        el('rect', { x: 0.7, y: -0.26, width: 0.1, height: 0.52, fill: '#101820', 'fill-opacity': 0.8 }, g); // windscreen
    },
};

/** The shadow of an item: its offset silhouette, drawn in the (unfiltered or blurred) shadow group. */
const SHADOW = {
    shed: (g, it, o) => el('rect', { x: it.x - 2.2 + o.x, y: it.y + (it.rot ? -0.125 : -0.875) - 0.0 + o.y, width: 4.4, height: 1.0 }, g),
    signalbox: (g, it, o) => el('rect', { x: it.x - 0.5 + o.x, y: it.y - 0.45 + o.y, width: 0.8, height: 0.9 }, g),
    staithe: (g, it, o) => el('rect', { x: it.x - 1.7 + o.x, y: it.y + (it.rot ? -0.25 : -0.5) + o.y, width: 3.4, height: 0.75 }, g),
    office: (g, it, o) => el('rect', { x: it.x - 0.7 + o.x, y: it.y - 0.45 + o.y, width: 1.4, height: 0.9 }, g),
    watertower: (g, it, o) => el('line', { stroke: '#000', x1: it.x, y1: it.y, x2: it.x + o.x, y2: it.y + o.y, 'stroke-width': 1.15, 'stroke-linecap': 'round' }, g),
    watercrane: (g, it, o) => el('line', { stroke: '#000', x1: it.x, y1: it.y, x2: it.x + o.x, y2: it.y + o.y, 'stroke-width': 0.2, 'stroke-linecap': 'round' }, g),
    lamp: (g, it, o) => { el('line', { stroke: '#000', x1: it.x, y1: it.y, x2: it.x + o.x, y2: it.y + o.y, 'stroke-width': 0.06 }, g); el('circle', { cx: it.x + o.x, cy: it.y + o.y, r: 0.11 }, g); },
    tree: (g, it, o) => el('circle', { cx: it.x + o.x * 0.7, cy: it.y + o.y * 0.7, r: it.r * 1.05 }, g),
    fence: (g, it, o) => el('line', { stroke: '#000', x1: it.x - it.w / 2 + o.x, y1: it.y + o.y, x2: it.x + it.w / 2 + o.x, y2: it.y + o.y, 'stroke-width': 0.06 }, g),
    gate: (g, it, o) => el('line', { stroke: '#000', x1: it.x - 0.6 + o.x, y1: it.y + o.y, x2: it.x + 0.6 + o.x, y2: it.y + o.y, 'stroke-width': 0.06 }, g),
    sleepers: (g, it, o) => el('rect', { x: it.x - it.w / 2 + o.x, y: it.y - it.h / 2 + o.y, width: it.w, height: it.h }, g),
    drums: (g, it, o) => { for (const [dx, dy] of [[-0.18, -0.08], [0.16, -0.06], [0, 0.14]]) el('circle', { cx: it.x + dx + o.x, cy: it.y + dy + o.y, r: 0.14 }, g); },
    barrow: (g, it, o) => el('rect', { x: it.x - 0.2 + o.x, y: it.y - 0.09 + o.y, width: 0.34, height: 0.18 }, g),
    coalheap: (g, it, o) => el('ellipse', { cx: it.x + o.x, cy: it.y + o.y, rx: 0.48, ry: 0.36 }, g),
    lorry: (g, it, o) => el('rect', { x: it.x - it.w / 2 + o.x, y: it.y - it.h / 2 + o.y, width: it.w, height: it.h }, g),
};

function canopy(g, it) {
    const { x, y, r } = it, v = hashOf(it);
    el('circle', { cx: x, cy: y, r, fill: '#2b5a2e', stroke: '#173a1c', 'stroke-width': 0.02 }, g);
    el('circle', { cx: x - r * 0.1, cy: y - r * 0.1, r: r * 0.78, fill: '#3b7340' }, g);
    el('circle', { cx: x - r * 0.3, cy: y - r * 0.3, r: r * 0.38, fill: v % 2 ? '#5d9a52' : '#68a45a', 'fill-opacity': 0.8 }, g);
    el('circle', { cx: x + r * 0.28, cy: y + r * 0.22, r: r * 0.3, fill: '#1d4a26', 'fill-opacity': 0.55 }, g);
}
const hashOf = it => Math.abs(Math.round(it.x * 7 + it.y * 13));

function lampHead(g, it) {
    el('circle', { cx: it.x, cy: it.y, r: 0.2, fill: '#ffe6a0', 'fill-opacity': 0.14 }, g);
    el('circle', { cx: it.x, cy: it.y, r: 0.1, fill: '#2f3236', stroke: '#121416', 'stroke-width': 0.02 }, g);
    el('circle', { cx: it.x - 0.02, cy: it.y - 0.02, r: 0.05, fill: '#f4ecc4' }, g);
}

/**
 * Draws the composed yard. `items` come from planScenery (when empty the plan for ctx.seed is made here). Returns { setQuality(q) }:
 * with quality 'low' the blur filter comes off the static shadows, which stay as plain offset shapes.
 */
export function drawScenery(layers, layout, items, ctx) {
    const b = layout.bounds;
    const plan = items?.length ? items : planScenery(layout, ctx.seed ?? 0);
    const defs = ctx.defs;

    const filter = el('filter', { id: 'ig-shadow-blur', filterUnits: 'userSpaceOnUse', x: b.x - 1, y: b.y - 1, width: b.w + 2, height: b.h + 2 }, defs);
    el('feGaussianBlur', { stdDeviation: 0.06 }, filter);
    const slate = el('pattern', { id: 'ig-pat-slate', patternUnits: 'userSpaceOnUse', width: 0.16, height: 0.16 }, defs);
    el('path', { d: 'M0,0.15H0.16M0.08,0V0.08', fill: 'none', stroke: '#14181c', 'stroke-opacity': 0.4, 'stroke-width': 0.014 }, slate);
    const c = { tex: ctx.textures, slate: 'url(#ig-pat-slate)' };

    const low = layers.sceneryLow, high = layers.sceneryHigh;
    const shadows = el('g', { class: 'ig-scenery-shadows', fill: '#000', opacity: 0.3 }, low);
    const setQuality = q => { if (q === 'low') shadows.removeAttribute('filter'); else shadows.setAttribute('filter', 'url(#ig-shadow-blur)'); };
    setQuality(ctx.quality);
    const things = el('g', { class: 'ig-scenery' }, low);

    for (const it of plan) {
        const o = shadowOffset(ITEM_HEIGHT[it.type] ?? 0);
        const sh = SHADOW[it.type];
        if (sh) {
            sh(shadows, it, o);
        }
        const draw = DRAW[it.type];
        if (draw) {
            const g = el('g', { class: `ig-item ig-${it.type}`, transform: `translate(${it.x} ${it.y})${it.rot ? ' rotate(180)' : ''}` }, things);
            draw(g, it, c);
        }
        if (it.type === 'tree') canopy(high, it);
        else if (it.type === 'lamp') lampHead(high, it);
    }
    for (const g of [layers.sceneryLow, layers.sceneryHigh]) g.setAttribute('pointer-events', 'none'); // scenery never takes a tap meant for a lever or hook
    return { setQuality };
}
