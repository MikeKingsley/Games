// Era models for the catalogue vehicles and trailers: from a 1919 brass-radiator van through bonneted lorries, a Scarab-style
// mechanical horse and half-cab artics, to a modern tilt-cab tractor, a Luton and an electric van. Built in "u" coordinates
// (0 = rear of the vehicle, +u forward, as the catalogue's draw.parts) then shifted so the origin is the rear axle.
import { createBuilder, compose, transformMesh } from './meshes.js';
import { COL, hex, shade, blk, blkBoth, both, tube, ring, circle, loft, stations } from './model-kit.js';

const WHITE = [1, 1, 1];
const roundLamp = (m, x, y, z, r, len = 0.08) => tube(m, 'x', x - len, x + 0.01, y, z, r, r * 0.92, 10, WHITE);
const rectLamp = (m, x, y, z, w, h, d = 0.04) => blk(m, x - d, x + 0.01, y - w / 2, y + w / 2, z - h / 2, z + h / 2, WHITE);
const PLATE_Z = 1.1;
/** A mirror's outer edge: never more than 10 cm outside the vehicle's width. */
const reach = (c, y) => Math.min(y, c.W / 2 + 0.1);

// ---- shared pieces --------------------------------------------------------------------------------------------

/** Axle beams, chassis rails and cross members. */
function chassis(c, { u0 = 0.05, u1 = c.L - 0.05, z0 = 0.5, z1 = 0.72, half = 0.45 } = {}) {
    const { b, spec } = c, axles = [spec.rearOverhang, spec.rearOverhang + spec.wheelbase, ...(spec.extraAxles ?? [])];
    blkBoth(b, u0, u1, half - 0.08, half, z0, z1, hex('#1c1d1f'));
    for (let u = u0 + 0.3; u < u1; u += 1.4) blk(b, u, u + 0.08, -half, half, z0 + 0.04, z0 + 0.14, hex('#1c1d1f'));
    const r = spec.draw?.wheel?.r ?? 0.45;
    for (const u of axles) {
        if (spec.threeWheeler && u === axles[1]) continue;
        blk(b, u - 0.07, u + 0.07, -(c.W / 2 - 0.25), c.W / 2 - 0.25, r - 0.07, r + 0.07, hex('#262729'));
        blk(b, u - 0.22, u + 0.22, -0.18, 0.18, r - 0.14, r + 0.14, hex('#2c2d30')); // diff / axle housing
    }
}

/** Mudguard over a pair of wheels at u (wheel radius r, width w). */
function guard(c, u, r, w, col = hex('#232426'), len = 1.1) {
    const half = c.W / 2, top = r * 2 + 0.12;
    both(s => {
        blk(c.b, u - len / 2, u + len / 2, s * (half - w - 0.05), s * (half + 0.02), top, top + 0.04, col);
        blk(c.b, u - len / 2, u + len / 2, s * (half + 0.0), s * (half + 0.02), top - 0.28, top, col);
    });
}

function mudflaps(c, u, w = 0.5) {
    both(s => blk(c.b, u - 0.015, u + 0.015, s * (c.W / 2 - 0.45), s * (c.W / 2 - 0.45 + w), 0.12, 0.62, hex('#16171a')));
}

function tail(c, u, z, off, w = 0.14, h = 0.2) { both(s => rectLamp(c.tail, u, s * off, z, w, h)); }

/** Number plates: white at the front, yellow at the back. */
function plates(c, zFront, zRear) {
    blk(c.b, c.L + 0.0, c.L + 0.03, -0.26, 0.26, zFront, zFront + 0.12, COL.plate);
    blk(c.b, -0.03, 0.0, -0.26, 0.26, zRear, zRear + 0.12, hex('#e8c840'));
}

function fuelTank(c, u, z, r = 0.3, len = 1.0, side = 1) {
    tube(c.b, 'x', u, u + len, side * (c.W / 2 - 0.45), z, r, r, 12, COL.steel);
    blk(c.b, u + 0.1, u + 0.18, side * (c.W / 2 - 0.45 - 0.3), side * (c.W / 2 - 0.45 + 0.3), z - 0.34, z - 0.3, COL.dark);
}

// ---- bonneted cabs (1919-1956) --------------------------------------------------------------------------------

/**
 * A bonneted cab: cab box with side windows and a near-vertical windscreen, a long bonnet with louvres, a radiator,
 * lamps, wings, running boards. o = {u0, u1, z0, h, w} for the cab, {bu0, bu1, bh, bw} the bonnet, `frontAxle`, `fr`.
 */
function bonnetCab(c, o) {
    const { b, head, cols } = c, hw = o.w / 2, paint = cols.paint, bonnetCol = o.bonnetCol ?? paint, wing = o.wing ?? hex('#1f2022');
    const belt = o.z0 + o.h * 0.42, roof = o.z0 + o.h;
    c.cols.roof = shade(paint, o.roofShade ?? 0.8);
    loft(b, stations([
        [o.u0, o.z0, belt, roof, hw, hw * 0.88], [o.u0 + 0.05, o.z0, belt, roof, hw, hw * 0.88],
        [o.u1 - 0.14, o.z0, belt, roof, hw, hw * 0.88], [o.u1, o.z0, belt, belt, hw * 0.98, hw * 0.98],
    ]), ['P', 'G', 'W'], c.cols, { caps: [paint, paint] });
    // bonnet
    const bhw = o.bw / 2, zt = o.z0 + o.bh;
    loft(b, stations([
        [o.bu0, o.z0, zt - 0.2, zt, bhw, bhw * 0.72, 0.1], [o.bu1 - 0.12, o.z0 + 0.04, zt - 0.2, zt, bhw * 0.97, bhw * 0.7, 0.1], [o.bu1, o.z0 + 0.06, zt - 0.22, zt - 0.02, bhw * 0.9, bhw * 0.64, 0.08],
    ]), ['P', 'P'], { ...c.cols, paint: bonnetCol, roof: bonnetCol }, { caps: [bonnetCol, COL.dark] });
    // louvres
    both(s => { for (let i = 0; i < 5; i++) blk(b, o.bu0 + 0.2 + i * 0.1, o.bu0 + 0.23 + i * 0.1, s * (bhw + 0.004), s * (bhw + 0.012), o.z0 + o.bh * 0.35, o.z0 + o.bh * 0.78, COL.dark); });
    // radiator
    const rc = o.radiator === 'brass' ? COL.brass : COL.chrome;
    blk(b, o.bu1 - 0.03, o.bu1 + 0.07, -bhw * 0.86, bhw * 0.86, o.z0 + 0.05, zt * 0.97 - 0.02, rc);
    blk(b, o.bu1 + 0.04, o.bu1 + 0.075, -bhw * 0.72, bhw * 0.72, o.z0 + 0.12, zt - 0.14, COL.dark);
    for (let i = -3; i <= 3; i++) blk(b, o.bu1 + 0.07, o.bu1 + 0.085, i * bhw * 0.2 - 0.012, i * bhw * 0.2 + 0.012, o.z0 + 0.12, zt - 0.14, rc);
    // lamps
    both(s => { roundLamp(head, o.bu1 - 0.1, s * (bhw + 0.2), zt + 0.0, 0.11, 0.1); tube(b, 'y', s * (bhw + 0.02), s * (bhw + 0.2), o.bu1 - 0.14, zt - 0.1, 0.03, 0.03, 6, COL.black, false); });
    // wings and running boards
    if (o.frontAxle !== undefined) {
        const top = o.fr * 2 + 0.1;
        both(s => {
            blk(b, o.frontAxle - o.fr - 0.35, o.frontAxle + o.fr + 0.35, s * (bhw - 0.02), s * (c.W / 2 + 0.02), top, top + 0.045, wing);
            blk(b, o.frontAxle - o.fr - 0.35, o.frontAxle - o.fr - 0.31, s * (bhw - 0.02), s * (c.W / 2 + 0.02), top - 0.28, top, wing);
            blk(b, o.frontAxle - o.fr - 0.35, o.frontAxle + o.fr + 0.35, s * (c.W / 2 - 0.01), s * (c.W / 2 + 0.02), top - 0.2, top, wing);
            if (o.running) blk(b, o.u0 + 0.05, o.frontAxle - o.fr - 0.35, s * (hw - 0.02), s * (c.W / 2 + 0.02), o.z0 - 0.1, o.z0 - 0.05, wing);
        });
    }
    // exhaust, mirrors
    tube(b, 'x', o.u0 - 0.2, o.u1 + 0.4, hw + 0.04, o.z0 - 0.18, 0.045, 0.045, 8, hex('#4a4038'), true);
    both(s => blk(b, o.u1 - 0.35, o.u1 - 0.27, s * (hw + 0.02), s * reach(c, hw + 0.2), roof - 0.55, roof - 0.15, COL.black));
    blk(b, o.bu1 - 0.1, o.bu1 + 0.14, -(c.W / 2 - 0.2), c.W / 2 - 0.2, 0.36, 0.5, COL.chrome); // bumper
    blk(b, o.u0 + 0.5, o.u0 + 0.54, hw + 0.001, hw + 0.012, o.z0 + 0.08, belt - 0.05, COL.dark); // door seam
    blk(b, o.u0 + 0.5, o.u0 + 0.54, -hw - 0.012, -hw - 0.001, o.z0 + 0.08, belt - 0.05, COL.dark);
    blk(b, o.u0 + 0.15, o.u0 + 0.19, hw + 0.001, hw + 0.012, o.z0 + 0.08, belt - 0.05, COL.dark);
    blk(b, o.u0 + 0.15, o.u0 + 0.19, -hw - 0.012, -hw - 0.001, o.z0 + 0.08, belt - 0.05, COL.dark);
}

// ---- forward-control cabs (1960-2022) -------------------------------------------------------------------------

/**
 * A forward-control cab. o = {u0, u1, z0, h, w, style: 'round' (1960s) | 'box' (70s-80s) | 'modern'}; adds the grille,
 * lamps, bumper, mirrors, sun visor and (tractors) a roof deflector and exhaust stacks.
 */
function forwardCab(c, o) {
    const { b, head, cols } = c, hw = o.w / 2, paint = cols.paint, z0 = o.z0, roof = z0 + o.h;
    const style = o.style, sl = style === 'modern' ? 0.45 : style === 'box' ? 0.12 : 0.22;
    const belt = z0 + o.h * (style === 'modern' ? 0.42 : 0.4);
    const frontTop = style === 'modern' ? belt + 0.05 : belt;
    c.cols.roof = shade(paint, 1.1);
    const mid = (o.u0 + o.u1) / 2;
    const rows = [
        [o.u0, z0, belt, roof, hw, hw * 0.97], [o.u0 + 0.06, z0, belt, roof, hw, hw * 0.97], [mid - 0.04, z0, belt, roof, hw, hw * 0.97], [mid + 0.06, z0, belt, roof, hw, hw * 0.97],
        [o.u1 - sl - 0.02, z0, belt, roof, hw, hw * (style === 'modern' ? 0.93 : 0.96)], [o.u1 - 0.02, z0 - 0.03, belt, frontTop, hw * 0.97, hw * 0.9, 0.04], [o.u1, z0 - 0.04, belt - 0.03, frontTop - 0.03, hw * 0.96, hw * 0.88, 0.04],
    ];
    loft(b, stations(rows), ['P', 'G', 'P', 'G', 'W', 'P'], c.cols, { caps: [paint, paint] });
    // front: grille, lamps, bumper, step
    const gz0 = z0 + 0.12, gz1 = belt - 0.08;
    blk(b, o.u1 - 0.01, o.u1 + 0.03, -hw * 0.62, hw * 0.62, gz0, gz1, style === 'modern' ? hex('#2a2c2e') : COL.chrome);
    blk(b, o.u1 + 0.01, o.u1 + 0.04, -hw * 0.56, hw * 0.56, gz0 + 0.05, gz1 - 0.05, COL.dark);
    for (let i = 1; i < 5; i++) blk(b, o.u1 + 0.03, o.u1 + 0.045, -hw * 0.56, hw * 0.56, gz0 + 0.05 + i * (gz1 - gz0 - 0.1) / 5, gz0 + 0.07 + i * (gz1 - gz0 - 0.1) / 5, style === 'modern' ? hex('#555a60') : COL.chrome);
    blk(b, o.u1 - 0.0, o.u1 + 0.04, -0.17, 0.17, gz1 - 0.15, gz1 - 0.05, COL.chrome); // badge
    both(s => {
        rectLamp(head, o.u1 + 0.02, s * (hw * 0.8), z0 + 0.3, style === 'modern' ? 0.38 : 0.26, style === 'modern' ? 0.2 : 0.2, 0.07);
        rectLamp(head, o.u1 + 0.02, s * (hw * 0.8), z0 + 0.1, 0.12, 0.08, 0.05);
    });
    blk(b, o.u1 - 0.12, o.u1 + 0.1, -(hw - 0.02), hw - 0.02, z0 - 0.5, z0 - 0.12, style === 'modern' ? paint : hex('#2e3033')); // bumper / step panel
    blk(b, o.u1 - 0.08, o.u1 + 0.1, -0.3, 0.3, z0 - 0.4, z0 - 0.3, COL.plate);
    // side detail: door line, steps, mirrors, livery belt stripe
    both(s => {
        blk(b, mid - 0.04, mid + 0.0, s * (hw + 0.001), s * (hw + 0.011), z0 + 0.1, belt - 0.02, COL.dark);
        blk(b, o.u1 - 0.8, o.u1 - 0.76, s * (hw + 0.001), s * (hw + 0.011), z0 + 0.1, belt + 0.1, COL.dark);
        blk(b, o.u1 - 0.8, o.u1 - 0.1, s * (hw - 0.05), s * reach(c, hw + 0.08), z0 - 0.38, z0 - 0.33, hex('#3a3d40')); // step
        blk(b, o.u1 - 0.55, o.u1 - 0.3, s * hw, s * (hw + 0.02), belt + 0.02, belt + 0.1, cols.trim);
        blk(b, o.u1 - sl - 0.1, o.u1 - sl - 0.02, s * hw, s * reach(c, hw + 0.28), roof - 0.9, roof - 0.7, COL.black); // mirror arm
        blk(b, o.u1 - sl - 0.12, o.u1 - sl - 0.06, s * (reach(c, hw + 0.3) - 0.06), s * reach(c, hw + 0.3), roof - 1.2, roof - 0.35, COL.black);
    });
    if (style !== 'round') blk(b, o.u1 - sl - 0.05, o.u1 - sl + 0.18, -(hw - 0.08), hw - 0.08, roof - 0.01, roof + 0.07, hex('#26282b')); // sun visor
    if (o.deflector) {
        const top = Math.min(roof + 0.32, c.H * 1.06), x1 = Math.max(o.u0 + 0.1, o.u0 + (o.u1 - o.u0) * 0.2);
        loft(b, stations([[x1 + 0.9, roof - 0.02, roof, roof, hw * 0.9, hw * 0.88], [x1, roof - 0.02, roof, top, hw * 0.9, hw * 0.88, 0.06], [x1 - 0.04, roof - 0.02, roof, top, hw * 0.9, hw * 0.88, 0.06]].reverse()),
            ['P', 'P'], { ...c.cols, roof: paint }, { caps: [paint, paint] });
    }
    // roof marker lamps
    if (style !== 'round') for (const x of [-0.3, 0, 0.3]) blk(b, o.u1 - sl - 0.06, o.u1 - sl, x - 0.06, x + 0.06, roof + 0.07, roof + 0.12, hex('#d89b2b'));
    return { sl };
}

// ---- rear bodies ----------------------------------------------------------------------------------------------

function ribs(c, u0, u1, w, z0, z1, gap = 0.7, col = null) {
    for (let u = u0 + gap / 2; u < u1; u += gap) both(s => blk(c.b, u, u + 0.045, s * (w / 2), s * (w / 2 + 0.014), z0, z1, col ?? shade(c.cols.paint, 0.72)));
}

/** A box van body (rigid or trailer): rounded corners, livery stripe, panel ribs and rear doors. */
function boxBody(c, o) {
    const { b } = c, hw = o.w / 2, top = o.top, z0 = o.z0;
    const paint = o.paint ?? c.cols.paint, colsB = { ...c.cols, paint, roof: o.roof ?? shade(paint, 1.12) };
    loft(b, stations([[o.u0, z0, top - 0.3, top, hw, hw * 0.98, o.rd ?? 0.14], [o.u1, z0, top - 0.3, top, hw, hw * 0.98, o.rd ?? 0.14]]), ['P'], colsB, { caps: [paint, o.frontCap ?? paint] });
    if (o.stripe !== false) both(s => {
        blk(b, o.u0 + 0.15, o.u1 - 0.15, s * (hw + 0.002), s * (hw + 0.014), z0 + (top - z0) * 0.5, z0 + (top - z0) * 0.5 + 0.14, c.cols.trim);
        blk(b, o.u0 + (o.u1 - o.u0) * 0.3, o.u0 + (o.u1 - o.u0) * 0.7, s * (hw + 0.002), s * (hw + 0.014), z0 + (top - z0) * 0.62, z0 + (top - z0) * 0.62 + 0.45, shade(paint, 1.35)); // name panel
    });
    if (o.ribs) ribs(c, o.u0 + 0.1, o.u1 - 0.1, o.w, z0 + 0.15, top - 0.2, o.ribs);
    // rear doors: seam, hinges, locking bars
    blk(b, o.u0 - 0.012, o.u0 + 0.0, -0.012, 0.012, z0 + 0.1, top - 0.1, COL.dark);
    for (const y of [-0.5 * hw, 0.5 * hw]) blk(b, o.u0 - 0.025, o.u0 - 0.005, y - 0.025, y + 0.025, z0 + 0.1, top - 0.1, COL.steel);
    blk(b, o.u0 - 0.03, o.u0 - 0.0, -hw + 0.03, hw - 0.03, z0 - 0.02, z0 + 0.08, hex('#2a2c2e')); // rear bumper rail of the body
    // underrun bar
    if (o.underrun !== false) blk(c.b, o.u0 - 0.12, o.u0 - 0.04, -hw + 0.1, hw - 0.1, z0 - 0.45, z0 - 0.3, hex('#2c2e31'));
}

/** Wooden flat bed with low sideboards, stakes and a headboard (and a few crates on it). */
function dropside(c, o) {
    const { b } = c, hw = o.w / 2, z0 = o.z0, h = o.h;
    blk(b, o.u0, o.u1, -hw, hw, z0, z0 + 0.1, COL.wood);
    blkBoth(b, o.u0, o.u1, hw - 0.05, hw, z0 + 0.1, z0 + h, shade(COL.wood, 1.08));
    blk(b, o.u0, o.u0 + 0.05, -hw, hw, z0 + 0.1, z0 + h, shade(COL.wood, 1.08));
    blk(b, o.u1 - 0.12, o.u1, -hw, hw, z0 + 0.1, z0 + h + 0.7, shade(COL.wood, 0.85)); // headboard
    for (let u = o.u0 + 0.4; u < o.u1; u += 0.9) both(s => blk(b, u, u + 0.06, s * (hw - 0.02), s * (hw + 0.025), z0 + 0.1, z0 + h + 0.05, shade(COL.wood, 0.7)));
    blkBoth(b, o.u0, o.u1, hw - 0.11, hw - 0.06, z0 - 0.15, z0, hex('#2b2b2b')); // bearers
    // sacks / crates
    const crate = hex('#a68a5e');
    blk(b, o.u0 + 0.4, o.u0 + 1.4, -hw * 0.7, 0, z0 + 0.1, z0 + 0.7, crate);
    blk(b, o.u0 + 0.4, o.u0 + 1.4, 0.05, hw * 0.7, z0 + 0.1, z0 + 0.55, hex('#b49b73'));
    blk(b, o.u0 + 1.7, o.u0 + 2.5, -hw * 0.6, hw * 0.6, z0 + 0.1, z0 + 0.5, hex('#8e7550'));
}

/** A tipper body: sloped sides, a canopy over the cab, a tailgate, and a ram. */
function tipperBody(c, o) {
    const { b } = c, hw = o.w / 2, z0 = o.z0, top = z0 + o.h, col = o.col ?? hex('#6f6a60');
    loft(b, stations([[o.u0, z0 + 0.15, top - 0.2, top, hw * 0.88, hw, 0.05], [o.u0 + 0.12, z0, top - 0.2, top, hw * 0.96, hw, 0.05], [o.u1, z0, top - 0.2, top + 0.18, hw * 0.96, hw, 0.05]]), ['P', 'P'], { ...c.cols, paint: col, roof: shade(col, 0.8) }, { caps: [col, col] });
    blk(b, o.u1 - 0.1, o.u1 + (o.canopy ?? 0.4), -hw * 0.98, hw * 0.98, top - 0.05, top + 0.28, col); // canopy over the cab
    blkBoth(b, o.u0, o.u1, hw * 0.97, hw * 1.0, z0 + 0.15, z0 + 0.3, hex('#2d2d2f')); // ribs along the base
    for (let u = o.u0 + 0.5; u < o.u1 - 0.3; u += 0.9) both(s => blk(b, u, u + 0.07, s * (hw), s * (hw + 0.025), z0 + 0.1, top, shade(col, 0.7)));
    tube(b, 'z', z0 - 0.35, z0 + 0.1, o.u1 - 0.7, 0, 0.07, 0.07, 8, COL.steel); // hydraulic ram
    blk(b, o.u0 - 0.03, o.u0 + 0.0, -hw * 0.9, hw * 0.9, z0 + 0.2, top - 0.1, shade(col, 0.85));
    blk(b, o.u0 - 0.03, o.u0 + 0.1, -hw * 0.9, hw * 0.9, top - 0.1, top - 0.04, COL.dark);
}

/** A horizontal tank on a frame. */
function tankBody(c, o) {
    const { b } = c, rzv = o.h / 2, ryv = o.w / 2 * 0.97, cz = o.z0 + rzv, col = o.col ?? hex('#cfd4d8');
    const rg = k => circle(rzv * k, cz, 18, ryv * k);
    loft(b, [{ x: o.u0, r: rg(0.55) }, { x: o.u0 + 0.12, r: rg(0.85) }, { x: o.u0 + 0.3, r: rg(1) }, { x: o.u1 - 0.3, r: rg(1) }, { x: o.u1 - 0.12, r: rg(0.85) }, { x: o.u1, r: rg(0.55) }],
        [col, col, col, col, col], c.cols, { smooth: true, caps: [col, col] });
    // bands, walkway, hatches
    for (let u = o.u0 + 0.8; u < o.u1 - 0.4; u += 1.1) loft(b, [{ x: u, r: circle(rzv * 1.02, cz, 18, ryv * 1.02) }, { x: u + 0.06, r: circle(rzv * 1.02, cz, 18, ryv * 1.02) }], [shade(col, 0.65)], c.cols, { smooth: true });
    blk(b, o.u0 + 0.3, o.u1 - 0.3, -0.3, 0.3, cz + rzv - 0.02, cz + rzv + 0.05, hex('#4a4d50'));
    for (const u of [o.u0 + (o.u1 - o.u0) * 0.3, o.u0 + (o.u1 - o.u0) * 0.7]) tube(b, 'z', cz + rzv + 0.04, cz + rzv + 0.22, u, 0, 0.26, 0.24, 10, hex('#8a8f94'));
    blk(b, o.u0 - 0.18, o.u0 + 0.0, -0.45, 0.45, o.z0 + 0.05, o.z0 + 0.65, hex('#2f3236')); // valve cabinet
    both(s => blk(b, o.u0 + 0.3, o.u1 - 0.3, s * (ryv * 0.4), s * (ryv * 0.4 + 0.06), o.z0 - 0.14, o.z0 + 0.02, hex('#222326'))); // sub-frame
    blk(b, o.u0 + (o.u1 - o.u0) * 0.5 - 0.5, o.u0 + (o.u1 - o.u0) * 0.5 + 0.5, ryv + 0.001, ryv + 0.016, cz - 0.25, cz + 0.05, c.cols.trim); // livery band
    blk(b, o.u0 + (o.u1 - o.u0) * 0.5 - 0.5, o.u0 + (o.u1 - o.u0) * 0.5 + 0.5, -ryv - 0.016, -ryv - 0.001, cz - 0.25, cz + 0.05, c.cols.trim);
}

/** Livestock sides: horizontal aluminium slats over a dark interior, with a roof. */
function slatBody(c, o) {
    const { b } = c, hw = o.w / 2, z0 = o.z0, top = z0 + o.h, alu = hex('#b9bec2');
    blk(b, o.u0, o.u1, -hw + 0.04, hw - 0.04, z0, top, hex('#2e2a26'));
    for (let z = z0 + 0.1; z < top - 0.15; z += 0.24) both(s => blk(b, o.u0, o.u1, s * (hw - 0.05), s * hw, z, z + 0.13, alu));
    for (let u = o.u0; u < o.u1; u += 1.4) both(s => blk(b, u, u + 0.07, s * (hw - 0.06), s * (hw + 0.01), z0, top, shade(alu, 0.8)));
    blk(b, o.u0, o.u1, -hw, hw, top, top + 0.07, hex('#d4d7da'));
    blk(b, o.u0 - 0.03, o.u0, -hw, hw, z0 + 0.1, top, shade(alu, 0.7));
}

// ---- tractor-unit extras --------------------------------------------------------------------------------------

function fifthWheel(c) {
    const { b, spec } = c, u = spec.rearOverhang + spec.fifthWheel;
    blk(b, u - 0.6, u + 0.5, -0.5, 0.5, PLATE_Z - 0.25, PLATE_Z - 0.13, hex('#2a2c2e')); // sub-plate
    if (!c.coupled) {
        compose.cylinder(b, u, 0, PLATE_Z - 0.14, 0.72, 0.14, 12, hex('#3a3a3a'));
        blk(b, Math.max(0.02, u - 0.9), u - 0.3, -0.12, 0.12, PLATE_Z - 0.14, PLATE_Z - 0.02, hex('#2a2a2a')); // the throat
    }
}

function exhaustStacks(c, u, z0, z1, side = 1) {
    tube(c.b, 'z', z0, z1, u, side * (c.W / 2 - 0.12), 0.06, 0.055, 8, COL.chrome);
    tube(c.b, 'z', z1 - 0.06, z1, u, side * (c.W / 2 - 0.12), 0.07, 0.07, 8, hex('#3a3a3a'));
}

// ---- the catalogue --------------------------------------------------------------------------------------------

const tamarTTon = c => {
    const { b, spec, L, W } = c, ro = spec.rearOverhang, hw = W / 2;
    chassis(c, { z0: 0.38, z1: 0.52, half: 0.55 });
    // a tall panel van body with a rounded roof, wooden ribs, and a canvas-sided cab
    boxBody(c, { u0: 0, u1: 2.55, w: 1.7, z0: 0.53, top: 2.15, rd: 0.3, ribs: 0.6, underrun: false });
    bonnetCab(c, { u0: 2.55, u1: 3.3, z0: 0.53, h: 1.32, w: 1.55, bu0: 3.3, bu1: L - 0.06, bh: 0.5, bw: 0.7, radiator: 'brass', frontAxle: ro + spec.wheelbase, fr: 0.38, running: true, roofShade: 0.7 });
    guard(c, ro, 0.38, 0.22, hex('#232426'), 1.0);
    tail(c, 0, 0.7, hw - 0.3);
    blk(b, -0.02, 0.0, -0.2, 0.2, 0.45, 0.57, hex('#e8c840'));
};

const exeTwoTonner = c => {
    const { spec, L, W } = c, ro = spec.rearOverhang;
    chassis(c, { z0: 0.42, z1: 0.62, half: 0.62 });
    dropside(c, { u0: 0, u1: 3.65, w: W - 0.05, z0: 0.62, h: 0.55 });
    bonnetCab(c, { u0: 3.7, u1: 4.6, z0: 0.62, h: 1.5, w: 1.9, bu0: 4.6, bu1: L - 0.06, bh: 0.72, bw: 1.0, radiator: 'brass', frontAxle: ro + spec.wheelbase, fr: 0.48, running: true });
    guard(c, ro, 0.48, 0.25, hex('#232426'), 1.2);
    tail(c, 0, 0.62, W / 2 - 0.2);
    plates(c, 0.4, 0.4);
};

const dart3 = c => {
    const { spec, L, W } = c, ro = spec.rearOverhang;
    chassis(c, { z0: 0.46, z1: 0.68, half: 0.7 });
    boxBody(c, { u0: 0, u1: 4.35, w: W, z0: 0.75, top: 2.95, rd: 0.22, ribs: 0.8 });
    bonnetCab(c, { u0: 4.4, u1: 5.4, z0: 0.75, h: 1.55, w: 2.0, bu0: 5.4, bu1: L - 0.06, bh: 0.78, bw: 1.15, radiator: 'chrome', frontAxle: ro + spec.wheelbase, fr: 0.46, running: true });
    guard(c, ro, 0.46, 0.26, hex('#232426'), 1.2);
    tail(c, 0, 0.8, W / 2 - 0.25);
    fuelTank(c, 1.8, 0.62, 0.22, 0.9, -1);
    plates(c, 0.42, 0.42);
};

const moorlandTipper = c => {
    const { spec, L, W } = c, ro = spec.rearOverhang;
    chassis(c, { z0: 0.5, z1: 0.76, half: 0.7 });
    tipperBody(c, { u0: 0, u1: 3.85, w: W, z0: 0.8, h: 1.1, canopy: 0.45 });
    bonnetCab(c, { u0: 3.9, u1: 4.9, z0: 0.8, h: 1.55, w: 2.05, bu0: 4.9, bu1: L - 0.06, bh: 0.78, bw: 1.2, radiator: 'chrome', frontAxle: ro + spec.wheelbase, fr: 0.48, running: true });
    guard(c, ro, 0.48, 0.28, hex('#232426'), 1.25);
    tail(c, 0, 0.9, W / 2 - 0.2);
    plates(c, 0.45, 0.45);
};

const tamarHorse = c => {
    const { b, head, spec, L, W } = c, ro = spec.rearOverhang, hw = W / 2;
    chassis(c, { z0: 0.46, z1: 0.64, half: 0.62 });
    // the Scarab: a rounded upright cab on a short wheelbase, one headlamp-eyed front wheel, fifth wheel on the tail
    const paint = c.cols.paint;
    c.cols.roof = shade(paint, 0.9);
    loft(b, stations([
        [1.3, 0.55, 1.15, 2.25, hw * 0.98, hw * 0.88, 0.12], [1.36, 0.55, 1.15, 2.25, hw * 0.98, hw * 0.88, 0.12], [2.7, 0.55, 1.15, 2.25, hw * 0.98, hw * 0.88, 0.12],
        [3.1, 0.55, 1.15, 1.4, hw * 0.9, hw * 0.8, 0.1], [L - 0.05, 0.62, 1.1, 1.2, hw * 0.75, hw * 0.6, 0.08], [L, 0.64, 1.08, 1.12, hw * 0.7, hw * 0.55, 0.06],
    ]), ['P', 'G', 'W', 'P', 'P'], c.cols, { caps: [paint, COL.dark] });
    blk(b, L - 0.04, L + 0.04, -0.4, 0.4, 0.68, 1.12, COL.chrome); // grille
    blk(b, L - 0.02, L + 0.05, -0.34, 0.34, 0.74, 1.06, COL.dark);
    roundLamp(head, L - 0.02, 0, 1.18, 0.13, 0.12);
    both(s => { blk(b, 1.9, 2.0, s * hw * 0.97, s * reach(c, hw * 0.97 + 0.08), 1.15, 1.9, COL.black); }); // mirrors
    blk(b, 0, 1.28, -hw * 0.9, hw * 0.9, 0.62, 0.72, hex('#2a2c2e')); // tail deck
    blk(b, 0, 0.06, -0.5, 0.5, 0.65, 1.0, hex('#2a2c2e'));
    blkBoth(b, 0.0, 0.8, hw * 0.4, hw * 0.4 + 0.18, 0.5, 0.65, hex('#2a2c2e'));
    guard(c, ro, 0.42, 0.24, hex('#232426'), 1.0);
    tail(c, 0, 0.82, hw - 0.3);
    fifthWheel(c);
    plates(c, 0.45, 0.4);
};

const exeMilkTanker = c => {
    const { spec, L, W } = c, ro = spec.rearOverhang;
    chassis(c, { z0: 0.5, z1: 0.72, half: 0.75 });
    tankBody(c, { u0: 0.1, u1: 5.0, w: 2.1, z0: 0.95, h: 1.6 });
    bonnetCab(c, { u0: 5.1, u1: 6.1, z0: 0.7, h: 1.6, w: 2.2, bu0: 6.1, bu1: L - 0.06, bh: 0.8, bw: 1.3, radiator: 'chrome', frontAxle: ro + spec.wheelbase, fr: 0.5, running: true, bonnetCol: undefined });
    guard(c, ro, 0.5, 0.28, hex('#232426'), 1.3);
    tail(c, 0, 0.8, W / 2 - 0.3);
    plates(c, 0.42, 0.4);
};

const moorland8 = c => {
    const { spec, L, W } = c, ro = spec.rearOverhang;
    chassis(c, { z0: 0.55, z1: 0.8, half: 0.8 });
    boxBody(c, { u0: 0, u1: 5.95, w: W, z0: 0.95, top: 3.25, rd: 0.2, ribs: 0.9 });
    bonnetCab(c, { u0: 6.0, u1: 7.2, z0: 0.75, h: 1.65, w: 2.3, bu0: 7.2, bu1: L - 0.06, bh: 0.82, bw: 1.4, radiator: 'chrome', frontAxle: ro + spec.wheelbase, fr: 0.52, running: false });
    guard(c, ro, 0.52, 0.3, hex('#232426'), 1.3); guard(c, 2.85, 0.52, 0.3, hex('#232426'), 1.3);
    tail(c, 0, 0.9, W / 2 - 0.25);
    fuelTank(c, 3.4, 0.7, 0.28, 1.1, -1);
    plates(c, 0.45, 0.45);
};

const kestrel = c => {
    const { spec, L, W } = c, ro = spec.rearOverhang;
    chassis(c, { z0: 0.58, z1: 0.84, half: 0.8 });
    fifthWheel(c);
    bonnetCab(c, { u0: 2.7, u1: 4.0, z0: 0.8, h: 1.8, w: 2.35, bu0: 4.0, bu1: L - 0.06, bh: 0.95, bw: 1.5, radiator: 'chrome', frontAxle: ro + spec.wheelbase, fr: 0.52, running: false, roofShade: 0.85 });
    guard(c, ro, 0.52, 0.3, hex('#232426'), 1.4);
    fuelTank(c, 1.2, 0.74, 0.3, 1.3, -1); fuelTank(c, 1.2, 0.74, 0.3, 1.3, 1);
    exhaustStacks(c, 2.55, 0.9, 3.0, 1);
    tail(c, 0, 0.82, W / 2 - 0.3);
    mudflaps(c, 0);
    plates(c, 0.45, 0.45);
};

const dartEight = c => {
    const { spec, L, W } = c, ro = spec.rearOverhang;
    chassis(c, { z0: 0.6, z1: 0.88, half: 0.85 });
    tipperBody(c, { u0: 0, u1: 6.65, w: W, z0: 1.0, h: 1.4, col: hex('#8c8a82'), canopy: 0.5 });
    forwardCab(c, { u0: 7.0, u1: L - 0.02, z0: 0.85, h: 1.9, w: 2.45, style: 'round' });
    blk(c.b, 6.8, 7.0, -1.1, 1.1, 0.85, 2.35, shade(c.cols.paint, 0.85)); // cab back panel
    for (const u of [ro, 2.9]) guard(c, u, 0.52, 0.32, hex('#232426'), 1.3);
    guard(c, 5.8, 0.52, 0.32, hex('#232426'), 1.2);
    tail(c, 0, 1.0, W / 2 - 0.25);
    mudflaps(c, 0);
    fuelTank(c, 4.2, 0.78, 0.3, 1.2, -1);
    plates(c, 0.6, 0.6);
};

const tamarT32 = c => {
    const { spec, L, W } = c, ro = spec.rearOverhang;
    chassis(c, { z0: 0.66, z1: 0.92, half: 0.85 });
    fifthWheel(c);
    forwardCab(c, { u0: 3.6, u1: L, z0: 0.9, h: 2.2, w: 2.5, style: 'box', deflector: true });
    guard(c, ro, 0.52, 0.32, hex('#232426'), 1.4);
    fuelTank(c, 1.3, 0.75, 0.32, 1.4, -1); fuelTank(c, 1.3, 0.75, 0.32, 1.4, 1);
    exhaustStacks(c, 3.4, 0.95, 3.1, 1);
    tail(c, 0, 0.9, W / 2 - 0.3);
    mudflaps(c, 0);
    plates(c, 0.45, 0.5);
};

const kestrelK38 = c => {
    const { spec, L, W } = c, ro = spec.rearOverhang;
    chassis(c, { z0: 0.66, z1: 0.92, half: 0.85 });
    fifthWheel(c);
    forwardCab(c, { u0: 3.7, u1: L, z0: 0.9, h: 2.45, w: 2.5, style: 'box', deflector: true });
    guard(c, ro, 0.52, 0.32, hex('#232426'), 1.4);
    fuelTank(c, 1.3, 0.75, 0.34, 1.5, -1); fuelTank(c, 1.3, 0.75, 0.34, 1.5, 1);
    exhaustStacks(c, 3.5, 0.95, 3.25, 1); exhaustStacks(c, 3.5, 0.95, 3.25, -1);
    tail(c, 0, 0.9, W / 2 - 0.3);
    mudflaps(c, 0);
    plates(c, 0.45, 0.5);
};

const exe75 = c => {
    const { spec, L, W } = c, ro = spec.rearOverhang;
    chassis(c, { z0: 0.55, z1: 0.78, half: 0.85 });
    boxBody(c, { u0: 0, u1: 5.55, w: W, z0: 0.8, top: 3.5, rd: 0.12 });
    forwardCab(c, { u0: 5.6, u1: L, z0: 0.7, h: 2.1, w: 2.3, style: 'modern' });
    guard(c, ro, 0.44, 0.28, hex('#232426'), 1.2);
    tail(c, 0, 0.9, W / 2 - 0.25, 0.14, 0.4);
    mudflaps(c, 0, 0.45);
    fuelTank(c, 3.1, 0.62, 0.28, 1.0, -1);
    plates(c, 0.4, 0.5);
};

const moorlandM44 = c => {
    const { spec, L, W } = c, ro = spec.rearOverhang;
    chassis(c, { z0: 0.66, z1: 0.92, half: 0.85 });
    fifthWheel(c);
    forwardCab(c, { u0: 3.9, u1: L, z0: 0.9, h: 2.8, w: 2.55, style: 'modern', deflector: true });
    guard(c, ro, 0.52, 0.34, hex('#232426'), 1.4); guard(c, 2.3, 0.52, 0.34, hex('#232426'), 1.2);
    fuelTank(c, 1.6, 0.76, 0.36, 1.6, -1); fuelTank(c, 1.6, 0.76, 0.36, 1.6, 1);
    exhaustStacks(c, 3.7, 0.95, 3.5, 1);
    // side skirts
    both(s => blk(c.b, 1.7, 3.5, s * (W / 2 - 0.1), s * (W / 2 - 0.07), 0.45, 0.85, shade(c.cols.paint, 0.75)));
    tail(c, 0, 0.9, W / 2 - 0.3);
    mudflaps(c, 0);
    plates(c, 0.45, 0.5);
};

/** A van whose cab is a car-like hull, with an optional Luton box over the cab. */
function vanHull(c, { cabU0, rows, codes, boxTop, boxW, luton, alloy }) {
    const { b, head, spec, L, W } = c, hw = W / 2, ro = spec.rearOverhang;
    const cols = c.cols;
    cols.roof = shade(cols.paint, 1.05);
    const st = rows.map(([x, zb, zs, zr, wb, wr, rd]) => ({ x: cabU0 + x * (L - cabU0), r: ring({ wb: wb * hw, wr: wr * hw, zb, zs, zr, rd }) }));
    loft(b, st, codes, cols, { caps: [cols.paint, cols.paint] });
    // arches over the front wheel and bumper/lamps
    const fr = spec.draw.wheel.r, front = ro + spec.wheelbase;
    both(s => tube(b, 'y', s * (hw * 0.96 + 0.004), s * (hw * 0.96 + 0.016), front, fr, fr + 0.09, fr + 0.09, 14, COL.dark));
    both(s => tube(b, 'y', s * (hw * 0.96 + 0.004), s * (hw * 0.96 + 0.016), ro, fr, fr + 0.09, fr + 0.09, 14, COL.dark));
    blk(b, L - 0.1, L + 0.08, -hw * 0.94, hw * 0.94, 0.33, 0.48, hex('#2b2b2b'));
    blk(b, L - 0.03, L + 0.03, -hw * 0.5, hw * 0.5, 0.52, 0.66, COL.dark);
    both(s => { rectLamp(head, L + 0.02, s * hw * 0.74, 0.7, 0.34, 0.14, 0.07); });
    blk(b, L - 0.04, L + 0.06, -0.26, 0.26, 0.28, 0.4, COL.plate);
    both(s => blk(b, L - 0.9, L - 0.84, s * (hw * 0.96), s * reach(c, hw * 0.96 + 0.18), 1.3, 1.5, hex('#202020'))); // mirror
    void alloy;
    return { hw };
}

const dartLuton = c => {
    const { b, spec, L, W } = c, hw = W / 2;
    boxBody(c, { u0: 0, u1: 4.5, w: W, z0: 0.55, top: 3.0, rd: 0.12, ribs: 0, stripe: true, paint: c.cols.paint });
    // Luton peak over the cab
    blk(b, 4.45, 5.55, -hw * 0.995, hw * 0.995, 2.55, 3.28, shade(c.cols.paint, 1.0));
    blk(b, 4.45, 5.55, -hw * 0.995, hw * 0.995, 3.2, 3.3, shade(c.cols.paint, 1.1));
    chassis(c, { u0: 0.2, u1: L - 0.4, z0: 0.38, z1: 0.52, half: 0.78 });
    vanHull(c, {
        cabU0: 4.5, boxTop: 3.0, boxW: W, luton: true,
        rows: [[0, 0.5, 1.15, 2.5, 0.96, 0.9, 0.06], [0.08, 0.5, 1.15, 2.5, 0.96, 0.9, 0.06], [0.52, 0.5, 1.15, 2.4, 0.96, 0.88, 0.06], [0.74, 0.5, 1.1, 1.65, 0.96, 0.84, 0.06], [0.9, 0.46, 1.0, 1.1, 0.94, 0.78, 0.04], [1.0, 0.46, 0.92, 0.98, 0.9, 0.7, 0.04]],
        codes: 'PGWPP', alloy: false,
    });
    blk(b, -0.1, 0.05, -hw * 0.9, hw * 0.9, 0.38, 0.52, hex('#2b2b2b'));
    blk(b, -0.14, -0.06, -0.26, 0.26, 0.5, 0.62, hex('#e8c840'));
    tail(c, 0, 1.0, hw - 0.12, 0.12, 0.5);
};

const tamarEVan = c => {
    const { b, spec, L, W } = c, hw = W / 2;
    // panel van box with a blue accent stripe, a short sloping nose, and no exhaust or grille
    boxBody(c, { u0: 0, u1: 3.65, w: W, z0: 0.5, top: 2.45, rd: 0.16, stripe: false });
    both(s => {
        blk(b, 0.1, 3.5, s * (hw + 0.002), s * (hw + 0.014), 1.0, 1.08, hex('#3aa6d8'));
        blk(b, 0.1, 3.5, s * (hw + 0.002), s * (hw + 0.014), 1.12, 1.16, hex('#3aa6d8'));
    });
    chassis(c, { u0: 0.2, u1: L - 0.4, z0: 0.34, z1: 0.46, half: 0.7 });
    vanHull(c, {
        cabU0: 3.6, boxTop: 2.45, boxW: W, alloy: true,
        rows: [[0, 0.46, 1.1, 2.3, 0.96, 0.9, 0.06], [0.1, 0.46, 1.1, 2.3, 0.96, 0.9, 0.06], [0.5, 0.46, 1.08, 2.25, 0.96, 0.88, 0.06], [0.75, 0.46, 1.04, 1.45, 0.96, 0.84, 0.05], [0.9, 0.44, 0.98, 1.1, 0.94, 0.78, 0.04], [1.0, 0.44, 0.9, 0.98, 0.9, 0.7, 0.04]],
        codes: 'PGWPP',
    });
    blk(b, 3.5, 4.6, -0.25, 0.25, 1.0, 1.1, hex('#3aa6d8'));
    blk(b, -0.1, 0.05, -hw * 0.9, hw * 0.9, 0.34, 0.48, hex('#2b2b2b'));
    blk(b, -0.14, -0.06, -0.26, 0.26, 0.5, 0.62, hex('#e8c840'));
    tail(c, 0, 0.95, hw - 0.12, 0.12, 0.5);
};

const TRUCKS = {
    'tamar-t-ton': tamarTTon, 'exe-two-tonner': exeTwoTonner, 'dart-3': dart3, 'moorland-tipper': moorlandTipper, 'tamar-horse': tamarHorse,
    'exe-milk-tanker': exeMilkTanker, 'moorland-8': moorland8, kestrel, 'dart-eight': dartEight, 'tamar-t32': tamarT32, 'kestrel-k38': kestrelK38,
    'exe-75': exe75, 'moorland-m44': moorlandM44, 'dart-luton': dartLuton, 'tamar-e-van': tamarEVan,
};
export const TRUCK_MODELS = Object.keys(TRUCKS);

const shiftBy = ro => { const m = new Float64Array(16); m[0] = m[5] = m[10] = m[15] = 1; m[12] = -ro; return m; };

/** {body, head, tail} (origin under the rear axle) for a catalogue vehicle, or null when it has no model. */
export function buildTruckModel(spec, livery, { coupled = false } = {}) {
    const make = TRUCKS[spec.id];
    if (!make) return null;
    const paint = hex(livery.livery1), trim = hex(livery.livery2);
    const c = {
        spec, L: spec.length, W: spec.width, H: spec.height, ro: spec.rearOverhang, coupled,
        b: createBuilder(), head: createBuilder(), tail: createBuilder(),
        cols: { paint, roof: paint, glass: COL.glass, dark: COL.dark, trim },
    };
    make(c);
    const m = shiftBy(c.ro), fin = bld => transformMesh(bld.finish(), m);
    return { body: fin(c.b), head: fin(c.head), tail: fin(c.tail) };
}

// ---- trailers -------------------------------------------------------------------------------------------------

const TRAILER_BUILD = {
    flat(c, s) {
        const z = 1.1, hw = s.width / 2;
        blk(c.b, 0, s.length, -hw, hw, z, z + 0.14, COL.wood);
        both(k => blk(c.b, 0, s.length, k * (hw - 0.04), k * hw, z + 0.14, z + 0.25, hex('#7a7e82')));
        blk(c.b, s.length - 0.1, s.length, -hw, hw, z + 0.14, z + 0.55, hex('#6d7176')); // headboard
        for (let u = 0.5; u < s.length - 0.4; u += 1.2) both(k => blk(c.b, u, u + 0.06, k * (hw - 0.02), k * (hw + 0.03), z - 0.02, z + 0.4, hex('#5d6165'))); // rave stanchions
    },
    low(c, s) {
        const hw = s.width / 2, L = s.length;
        blk(c.b, 0, L - 3.6, -hw, hw, 0.55, 0.78, hex('#3a3c3f'));
        blk(c.b, 0, L - 3.6, -hw + 0.05, hw - 0.05, 0.78, 0.82, COL.wood);
        loft(c.b, stations([[L - 3.6, 0.55, 0.9, 1.1, hw * 0.7, hw * 0.6, 0.03], [L - 2.8, 0.7, 1.1, 1.3, hw * 0.7, hw * 0.6, 0.03], [L, 0.9, 1.15, 1.3, hw * 0.7, hw * 0.55, 0.03]]), ['T', 'T'], { ...c.cols, paint: hex('#3a3c3f'), roof: hex('#4a4c50') });
        blk(c.b, L - 3.6, L, -hw, hw, 1.1, 1.2, hex('#3a3c3f'));
        blk(c.b, 0.0, 0.8, -hw * 0.9, hw * 0.9, 0.45, 0.58, hex('#4a4c50')); // ramps
        blkBoth(c.b, 0, L - 3.6, hw - 0.05, hw, 0.78, 0.9, hex('#3a3c3f'));
    },
    box(c, s) { boxBody(c, { u0: 0, u1: s.length, w: s.width, z0: 1.15, top: s.height, rd: 0.1, paint: c.cols.paint, roof: hex('#e8e4dc') }); },
    curtain(c, s) {
        const hw = s.width / 2, z0 = 1.15, top = s.height, paint = shade(c.cols.paint, 1.0);
        loft(c.b, stations([[0, z0, top - 0.2, top, hw, hw, 0.04], [s.length, z0, top - 0.2, top, hw, hw, 0.04]]), ['P'], { ...c.cols, paint, roof: hex('#e6e2d8') }, { caps: [paint, paint] });
        for (let u = 0.2; u < s.length - 0.1; u += 0.28) both(k => blk(c.b, u, u + 0.12, k * hw, k * (hw + 0.018), z0 + 0.15, top - 0.12, shade(paint, 0.82))); // curtain folds
        both(k => { for (const z of [z0 + 0.5, (z0 + top) / 2 + 0.2, top - 0.4]) blk(c.b, 0.05, s.length - 0.05, k * (hw + 0.012), k * (hw + 0.028), z, z + 0.05, hex('#d8d8d0')); });
        both(k => blk(c.b, 0.15, s.length - 0.15, k * (hw + 0.016), k * (hw + 0.03), z0 + (top - z0) * 0.5, z0 + (top - z0) * 0.5 + 0.2, c.cols.trim));
        blk(c.b, -0.02, 0.0, -0.012, 0.012, z0 + 0.1, top - 0.1, COL.dark);
        blk(c.b, -0.12, -0.04, -hw + 0.1, hw - 0.1, z0 - 0.45, z0 - 0.3, hex('#2c2e31'));
    },
    reefer(c, s) {
        const hw = s.width / 2, z0 = 1.15, top = s.height, white = hex('#eceff1');
        boxBody(c, { u0: 0, u1: s.length - 0.4, w: s.width, z0, top, rd: 0.08, paint: white, roof: hex('#f6f7f8'), stripe: false });
        both(k => blk(c.b, 0.15, s.length - 0.55, k * (hw + 0.002), k * (hw + 0.014), z0 + 0.7, z0 + 0.86, c.cols.paint));
        // the fridge unit on the front bulkhead
        blk(c.b, s.length - 0.4, s.length, -hw * 0.8, hw * 0.8, 2.15, 3.45, hex('#6a6e72'));
        blk(c.b, s.length - 0.02, s.length + 0.0, -hw * 0.7, hw * 0.7, 2.3, 3.0, COL.dark);
        for (let i = 0; i < 5; i++) blk(c.b, s.length - 0.01, s.length + 0.02, -hw * 0.7, hw * 0.7, 2.35 + i * 0.13, 2.4 + i * 0.13, hex('#9aa0a5'));
        both(k => blk(c.b, 0.0, s.length - 0.4, k * hw, k * hw, z0, z0, white));
    },
    tank(c, s) { tankBody(c, { u0: 0.3, u1: s.length - 0.2, w: s.width * 0.92, z0: 1.2, h: s.height - 1.2 }); },
    slats(c, s) { slatBody(c, { u0: 0, u1: s.length, w: s.width, z0: 1.0, h: s.height - 1.0 }); },
    tipper(c, s) { tipperBody(c, { u0: 0, u1: s.length - 0.3, w: s.width, z0: 1.15, h: s.height - 1.15, col: hex('#8a8a82'), canopy: 0.0 }); },
};

/** {body, tail} for a semi-trailer in its local frame (origin: centre of the axle group), or null. */
export function buildTrailerModel(spec, livery, { legs = false, cargo = false } = {}) {
    const build = TRAILER_BUILD[spec.body] ?? TRAILER_BUILD.box;
    const paint = hex(livery.livery1), trim = hex(livery.livery2);
    const c = { spec, L: spec.length, W: spec.width, H: spec.height, ro: spec.rearOverhang, b: createBuilder(), head: createBuilder(), tail: createBuilder(), cols: { paint, roof: paint, glass: COL.glass, dark: COL.dark, trim } };
    build(c, spec);
    const { b } = c, hw = spec.width / 2, n = spec.axles ?? 1, gap = 1.3;
    const framez = spec.body === 'low' ? 0.5 : 0.92;
    // chassis rails, cross members, kingpin plate, axles, mudguards, flaps and lamps
    if (spec.body !== 'low') {
        blkBoth(b, 0.0, spec.length - 0.1, 0.5, 0.6, framez, framez + 0.18, hex('#1d1e20'));
        for (let u = 0.4; u < spec.length - 0.3; u += 1.5) blk(b, u, u + 0.08, -0.6, 0.6, framez + 0.02, framez + 0.12, hex('#1d1e20'));
    }
    const kx = spec.length - spec.kingpin;
    compose.cylinder(b, kx, 0, PLATE_Z - 0.22, 0.45, 0.1, 10, hex('#3a3a3a'));
    blk(b, kx - 1.4, kx + 0.5, -hw * 0.5, hw * 0.5, PLATE_Z - 0.2, PLATE_Z - 0.12, hex('#2a2c2e'));
    for (let k = 0; k < n; k++) {
        const u = spec.rearOverhang + (k - (n - 1) / 2) * gap;
        blk(b, u - 0.07, u + 0.07, -(hw - 0.2), hw - 0.2, 0.43, 0.57, hex('#262729'));
        both(s => blk(b, u - 0.4, u + 0.4, s * (hw - 0.6), s * (hw - 0.5), 0.58, 0.68, hex('#2a2b2d'))); // springs
    }
    const mid = spec.rearOverhang, span = (n - 1) * gap + 1.2;
    both(s => { blk(b, mid - span / 2, mid + span / 2, s * (hw - 0.62), s * (hw + 0.02), 1.12, 1.15, hex('#232426')); });
    if (spec.body !== 'low') {
        both(s => blk(b, -0.015, 0.015, s * (hw - 0.45), s * (hw - 0.05), 0.2, 0.8, hex('#16171a')));
    }
    both(s => { rectLamp(c.tail, 0.0, s * (hw - 0.15), spec.body === 'low' ? 0.7 : 1.05, 0.14, 0.2); });
    both(s => blk(b, mid + span / 2 - 0.1, mid + span / 2 + 0.1, s * (hw + 0.0), s * (hw + 0.012), 0.65, 0.8, hex('#d89b2b'))); // side markers
    blk(b, -0.02, 0.0, -0.26, 0.26, 0.82, 0.94, hex('#e8c840'));
    if (legs) both(s => { // landing legs
        tube(b, 'z', 0, PLATE_Z - 0.15, spec.length - spec.kingpin - 1.8, s * (hw - 0.35), 0.07, 0.07, 6, hex('#444444'));
        blk(b, spec.length - spec.kingpin - 1.95, spec.length - spec.kingpin - 1.65, s * (hw - 0.5), s * (hw - 0.2), 0, 0.05, hex('#444444'));
    });
    if (cargo && (spec.body === 'flat' || spec.body === 'low')) {
        const deck = spec.body === 'low' ? 0.82 : 1.25, cx = spec.length * 0.45, len = spec.length * 0.6;
        const box = hex('#8a6d4f');
        blk(b, cx - len / 2, cx + len / 2, -hw * 0.82, hw * 0.82, deck, deck + 0.8, box);
        blk(b, cx - len / 2 + 0.2, cx + len / 2 - 0.2, -hw * 0.7, hw * 0.7, deck + 0.8, deck + 1.3, shade(box, 1.15));
        for (const u of [cx - len * 0.25, cx + len * 0.25]) blk(b, u, u + 0.06, -hw * 0.83, hw * 0.83, deck + 0.78, deck + 1.32, hex('#d5a82a')); // straps
        blk(b, cx - len / 2 - 0.02, cx + len / 2 + 0.02, -hw * 0.82, hw * 0.82, deck + 0.4, deck + 0.45, hex('#3a3a3a'));
    }
    const m = shiftBy(spec.rearOverhang), fin = bld => transformMesh(bld.finish(), m);
    return { body: fin(b), tail: fin(c.tail) };
}
