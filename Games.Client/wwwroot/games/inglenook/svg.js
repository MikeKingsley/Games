// Shared SVG helpers for the Inglenook renderer modules.
export const NS = 'http://www.w3.org/2000/svg';

/** Creates an SVG element with attributes and optionally appends it to `parent`. */
export function el(name, attrs = {}, parent) {
    const e = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
}

/** Formats [[x, y], ...] as an SVG points string. */
export const polyline = pts => pts.map(p => p.join(',')).join(' ');
