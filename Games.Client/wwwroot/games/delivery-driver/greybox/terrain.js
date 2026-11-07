// Greybox ground heights (plan 0011 phase 9): flat, or rolling hills so the junctions can be seen on uneven ground.
// Pure: no DOM, no GL. World metres, +z up. The rolling field fades to zero over FADE m outside the piece grid, so the
// flat outer plane (greybox/mesh.js) meets it at the same height.

/** The piece grid: pieces run 0 to 900 m east, 0 to 1500 m south (spec.js). */
export const CORE = { minX: 0, minY: 0, maxX: 900, maxY: 1500 };
/** Distance (m) over which the rolling field fades to flat outside CORE. */
export const FADE = 250;
/** Region extent: CORE grown by FADE on every side. CELL is the elevation grid the grader samples (m). */
export const CELL = 15;
/** Ground mesh cell (m): the graded ground is flat only across a road's width, so the mesh must resolve it (at 15 m, grass poked up to 0.4 m through the road). */
export const GROUND_CELL = 5;
export const GRID = { minX: CORE.minX - FADE, minY: CORE.minY - FADE, maxX: CORE.maxX + FADE, maxY: CORE.maxY + FADE };

const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Fade weight (0-1): 1 across CORE, 0 at FADE m beyond it. */
export function fadeAt(x, y) {
    const dx = Math.max(CORE.minX - x, 0, x - CORE.maxX), dy = Math.max(CORE.minY - y, 0, y - CORE.maxY);
    return 1 - smooth(Math.hypot(dx, dy) / FADE);
}

/** Rolling hills: two overlapping sine fields, about 6 m and 2.5 m high, with 100-300 m wavelengths (gentle slopes up to ~8%). */
export function rollingHeight(x, y) {
    const h = 6 * Math.sin(x / 97) * Math.cos(y / 131) + 2.5 * Math.sin(x / 41 + y / 57);
    return h * fadeAt(x, y);
}

/** Ground height for a terrain kind: 'flat' (all zero) or 'rolling'. */
export function groundHeightFn(kind) {
    return kind === 'rolling' ? rollingHeight : () => 0;
}
