// Yard scenery: goods shed, signal box, water tower, trees and a fence.
import { el } from './svg.js';

/** Draws the scenery into `layers.sceneryLow` (items and ctx are reserved for the composed yards of a later phase). */
export function drawScenery(layers, layout, items, ctx) {
    const root = layers.sceneryLow;
    const b = layout.bounds;
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
