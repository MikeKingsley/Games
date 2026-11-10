// SVG renderer for Inglenook: a top-down 1960s goods yard. One <svg> whose viewBox is the layout bounds, so everything is in wagon lengths.
// This module owns the layers, the turn/fit logic, input and the per-frame orchestration; drawing lives in draw-track, draw-stock and draw-scenery.
import { el } from './svg.js';
import { drawTrack } from './draw-track.js';
import { drawWagon, drawLoco, drawCoupling } from './draw-stock.js';
import { drawScenery } from './draw-scenery.js';
import { createTextures } from './textures.js';

export { BODY_W } from './draw-stock.js';

const LAYER_ORDER = ['ground', 'sceneryLow', 'ballast', 'sleepers', 'rails', 'shadows', 'points', 'vehicles', 'hooks', 'sceneryHigh', 'steam'];

/**
 * Creates the renderer for a layout inside `svg`. Returns { update(sim, dt), onEvent(e), reset(), setQuality(q), destroy() }.
 * Input callbacks: onPoint(id), onCoupling(rakeId, index). opts = { level, reducedMotion }.
 */
export function createRenderer(svg, layout, handlers = {}, opts = {}) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const b = layout.bounds;
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    // Everything lives in one group so the whole yard can be turned a quarter turn on a tall (portrait) screen.
    const world = el('g', { class: 'ig-world' }, svg);
    const defs = el('defs', {}, world);
    const layers = {};
    for (const name of LAYER_ORDER) layers[name] = el('g', { class: `ig-layer-${name}` }, world);
    let turned = false;
    const labelEls = []; // upright text that must counter-rotate when the yard is turned
    const applyTurn = () => {
        // rotate(90) sends (x, y) to (-y, x), so the yard's viewBox becomes x: [-(y+h), -y], y: [x, x+w]
        svg.setAttribute('viewBox', turned ? `${-(b.y + b.h)} ${b.x} ${b.h} ${b.w}` : `${b.x} ${b.y} ${b.w} ${b.h}`);
        world.setAttribute('transform', turned ? 'rotate(90)' : '');
        for (const fn of labelEls) fn();
    };
    /** Turn the yard when that makes it fill the board area better (a wide yard on a tall screen). */
    const fit = () => {
        const cw = svg.clientWidth, ch = svg.clientHeight;
        if (!cw || !ch) return;
        const plain = Math.min(cw / b.w, ch / b.h);
        const quarter = Math.min(cw / b.h, ch / b.w);
        const next = turned ? quarter > plain / 1.1 : quarter > plain * 1.1; // a little hysteresis so it never flickers
        if (next !== turned) { turned = next; applyTurn(); }
    };
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    resizeObserver?.observe(svg);
    applyTurn();

    const ctx = { defs, textures: createTextures(defs), quality: 'high', seed: opts.level ?? 0, reducedMotion: !!opts.reducedMotion, labelEls, isTurned: () => turned };
    drawScenery(layers, layout, [], ctx);
    const trackArt = drawTrack(layers, layout, ctx);

    const vehicleEls = {};
    let hookKey = '';
    const hookEls = [];

    // The same <svg> is reused for every level, so this listener must be removed in destroy() or taps would fire once per level played.
    const onPointerDown = ev => {
        const point = ev.target.closest?.('[data-point]');
        if (point) { ev.preventDefault(); handlers.onPoint?.(point.getAttribute('data-point')); return; }
        const hook = ev.target.closest?.('[data-hook]');
        if (hook) { ev.preventDefault(); handlers.onCoupling?.(hook.getAttribute('data-rake'), Number(hook.getAttribute('data-index'))); }
    };
    svg.addEventListener('pointerdown', onPointerDown);

    return {
        update(sim, dt) {
            trackArt.update(sim, dt);
            const poses = sim.poses();
            for (const v of poses) {
                let ve = vehicleEls[v.id];
                if (!ve) {
                    const root = el('g', { class: `ig-vehicle ${v.kind}` }, layers.vehicles);
                    const art = v.kind === 'loco' ? drawLoco(root, ctx) : drawWagon(root, v, ctx);
                    ve = vehicleEls[v.id] = { root, art, label: art.querySelector('.ig-label') };
                }
                const deg = v.angle * 180 / Math.PI;
                ve.root.setAttribute('transform', `translate(${v.x} ${v.y}) rotate(${deg})`);
                if (v.kind === 'loco') ve.art.setAttribute('transform', v.flip ? 'scale(-1 1)' : '');
                // always upright on screen, whichever way the wagon faces (reversing must not flip the number) and however the yard is turned
                if (ve.label) ve.label.setAttribute('transform', `rotate(${-deg - (turned ? 90 : 0)})`);
            }
            const hooks = sim.couplings();
            const key = hooks.map(h => `${h.rake}:${h.index}`).join(',');
            if (key !== hookKey) {
                hookKey = key;
                while (layers.hooks.firstChild) layers.hooks.removeChild(layers.hooks.firstChild); // above the wagons so the hooks can be tapped
                hookEls.length = 0;
                for (const h of hooks) hookEls.push(drawCoupling(layers.hooks, h, ctx));
            }
            const byId = {};
            for (const v of poses) byId[v.id] = v;
            hooks.forEach((h, i) => { // lay the chain along the line between the two coupled vehicles
                const a = byId[h.between[0]], c = byId[h.between[1]];
                const deg = a && c ? Math.atan2(c.y - a.y, c.x - a.x) * 180 / Math.PI : 0;
                hookEls[i].setAttribute('transform', `translate(${h.x} ${h.y}) rotate(${deg})`);
            });
        },
        onEvent(e) { trackArt.onEvent(e); },
        reset() {},
        setQuality(q) { ctx.quality = q; },
        destroy() {
            svg.removeEventListener('pointerdown', onPointerDown);
            resizeObserver?.disconnect();
            while (svg.firstChild) svg.removeChild(svg.firstChild);
        },
    };
}
