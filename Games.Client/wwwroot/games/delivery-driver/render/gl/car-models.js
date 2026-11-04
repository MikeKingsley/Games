// Era models for the AI traffic: a 1920s tin Lizzie, a 1930s saloon, 1950s pontoon, 1970s hatchback and modern car,
// vans in three generations, a bus, tractors, a horse and cart and a cyclist. Everything is built in "u" coordinates
// (0 = rear of the vehicle, +u forward); `buildTrafficModel` shifts it so the origin is the rear axle, like the sim.
import { createBuilder, transformMesh } from './meshes.js';
import { COL, hex, shade, blk, blkBoth, both, tube, ring, loft } from './model-kit.js';

const WHITE = [1, 1, 1];
const roundLamp = (m, x, y, z, r, len = 0.08) => tube(m, 'x', x - len, x + 0.01, y, z, r, r * 0.92, 10, WHITE);
const rectLamp = (m, x, y, z, w, h, d = 0.04) => blk(m, x - d, x + 0.01, y - w / 2, y + w / 2, z - h / 2, z + h / 2, WHITE);

/** Dark wheel-arch discs behind each wheel (the wheel itself is drawn separately, a little proud of the body). */
function arches(ctx, r, halfW, axles) {
    for (const x of axles) both(s => tube(ctx.b, 'y', s * (halfW + 0.004), s * (halfW + 0.016), x, r, r + 0.09, r + 0.09, 14, COL.dark));
}

/** Builds a hull from rows of [x/L, zb/H, zs/H, zr/H, wb (of half width), wr]. */
function hull(ctx, rows, codes, caps) {
    const { L, W, H } = ctx;
    const st = rows.map(([xf, zb, zs, zr, wb, wr]) => ({ x: xf * L, r: ring({ wb: wb * W / 2, wr: wr * W / 2, zb: zb * H, zs: zs * H, zr: zr * H }) }));
    loft(ctx.b, st, codes, ctx.cols, { caps });
}

// ---- cars -----------------------------------------------------------------------------------------------------

const CARS = {
    // Ford-T-like tudor: narrow bonnet, brass radiator, upright cabin, spoked wheels, running boards
    tin: {
        rows: [[0.03, .17, .43, .50, .40, .34], [0.30, .17, .46, .53, .42, .36], [0.305, .17, .53, .53, .84, .80], [0.37, .17, .54, .54, .88, .86],
            [0.40, .17, .56, .93, .88, .70], [0.58, .17, .57, .94, .88, .72], [0.61, .17, .57, .94, .88, .72], [0.80, .17, .57, .94, .88, .72],
            [0.83, .17, .57, .80, .88, .74], [0.97, .17, .52, .60, .85, .78], [1.0, .19, .50, .50, .80, .74]],
        codes: 'PPPWGPGWPP', roof: 0.55, wheel: 'spoke', exposed: true,
    },
    // 1930s saloon: rounded upright cabin, separate wings, headlamps on the wings, sloping tail
    saloon30: {
        rows: [[0.02, .24, .50, .56, .50, .42], [0.30, .24, .54, .62, .52, .45], [0.31, .24, .62, .62, .90, .80], [0.36, .24, .64, .64, .92, .86],
            [0.44, .24, .64, .98, .92, .72], [0.58, .24, .65, 1.0, .92, .76], [0.60, .24, .65, 1.0, .92, .76], [0.78, .24, .65, 1.0, .92, .76],
            [0.88, .24, .64, .78, .92, .74], [0.98, .24, .55, .62, .90, .80], [1.0, .26, .52, .52, .84, .76]],
        codes: 'PPPWGPGWPP', roof: 0.7, wheel: 'disc', exposed: true,
    },
    // 1950s pontoon saloon: integral wings, bulbous nose, chrome bumpers
    car50: {
        rows: [[0.02, .20, .48, .50, .90, .80], [0.28, .20, .58, .60, .96, .86], [0.36, .20, .60, .62, .97, .90], [0.43, .20, .62, .96, .97, .72],
            [0.60, .20, .63, 1.0, .97, .76], [0.62, .20, .63, 1.0, .97, .76], [0.76, .20, .63, 1.0, .97, .76], [0.85, .20, .62, .84, .97, .70],
            [0.97, .20, .60, .62, .94, .74], [1.0, .22, .56, .56, .86, .72]],
        codes: 'PPPWGPGWP', roof: 1, wheel: 'disc', chromeBumpers: true,
    },
    // 1970s hatchback: boxy, plastic bumpers, steep tailgate
    car70: {
        rows: [[0.02, .22, .50, .52, .90, .84], [0.26, .22, .60, .62, .96, .90], [0.29, .22, .64, .64, .96, .92], [0.45, .22, .66, 1.0, .96, .76],
            [0.62, .22, .66, 1.0, .96, .78], [0.64, .22, .66, 1.0, .96, .78], [0.86, .22, .66, 1.0, .96, .78], [0.99, .22, .68, .74, .94, .86], [1.0, .24, .64, .64, .9, .86]],
        codes: 'PPPWGPGWP', roof: 1, wheel: 'disc', plastic: true,
    },
    // modern car: rounded, raked glass, big lamps, alloys
    car2k: {
        rows: [[0.02, .22, .50, .54, .90, .82], [0.24, .22, .62, .66, .98, .90], [0.34, .22, .68, .70, .98, .94], [0.52, .22, .70, .98, .98, .76],
            [0.64, .22, .72, 1.0, .98, .80], [0.66, .22, .72, 1.0, .98, .80], [0.83, .22, .72, 1.0, .98, .80], [0.96, .22, .74, .78, .96, .86], [1.0, .24, .70, .70, .92, .84]],
        codes: 'PPPWGPGWP', roof: 1, wheel: 'alloy', plastic: true, modern: true,
    },
};

function car(ctx, key) {
    const { b, head, tail, L, W, H, ro, spec } = ctx, S = CARS[key];
    const wr = spec.draw.wheel.r, front = ro + spec.wheelbase, rear = ro, half = W / 2;
    ctx.cols.roof = shade(ctx.cols.paint, S.roof);
    hull(ctx, S.rows, S.codes, [ctx.cols.paint, S.exposed ? COL.dark : ctx.cols.paint]);
    const bodyHalf = S.rows[4][4] * half;
    if (!S.exposed) arches(ctx, wr, S.rows[3][4] * half, [rear, front]);

    // bumpers, grille, lamps, plates
    const bumperCol = S.plastic ? (S.modern ? ctx.cols.paint : hex('#2b2b2b')) : COL.chrome;
    const bw = bodyHalf * (S.exposed ? 0.8 : 0.98);
    blk(b, -0.1, 0.06, -bw, bw, 0.28 * H * (S.modern ? 1.1 : 0.9), 0.28 * H * (S.modern ? 1.1 : 0.9) + 0.13, bumperCol);
    blk(b, L - 0.05, L + 0.1, -bw, bw, 0.3 * H, 0.3 * H + 0.13, bumperCol);
    if (S.modern) blk(b, -0.02, 0.1, -bw * 0.5, bw * 0.5, 0.17 * H, 0.17 * H + 0.1, COL.dark); // lower air intake
    // number plates
    blk(b, -0.14, -0.1, -0.26, 0.26, 0.3 * H + 0.14, 0.3 * H + 0.26, COL.plate);
    blk(b, L + 0.1, L + 0.13, -0.26, 0.26, 0.32 * H + 0.12, 0.32 * H + 0.24, hex('#e8c840'));

    if (key === 'tin') {
        // brass radiator shell and brass lamps, wings and running boards, mudguards over spoked wheels
        blk(b, -0.02, 0.18, -0.2, 0.2, 0.2 * H, 0.52 * H, COL.brass);
        both(s => {
            roundLamp(head, 0.1, s * (half * 0.5), 0.62 * H, 0.1, 0.12);
            tube(b, 'x', 0.18, 0.32, s * (half * 0.5), 0.62 * H, 0.025, 0.025, 6, COL.black);
        });
        wings(ctx, 'tin', rear, front, half, wr);
        blkBoth(b, rear + 0.1, front - 0.1, bodyHalf, half, 0.27, 0.31, COL.dark);
        blk(b, 0.1, 0.3 * L, -0.07, 0.07, 0.6 * H, 0.63 * H, COL.dark); // bonnet strap
    } else if (key === 'saloon30') {
        blk(b, -0.02, 0.1, -0.22, 0.22, 0.2 * H, 0.52 * H, COL.chrome); // upright grille
        blk(b, -0.025, 0.05, -0.18, 0.18, 0.22 * H, 0.5 * H, COL.dark);
        both(s => roundLamp(head, 0.35, s * (half * 0.84), 0.5 * H + 0.4, 0.11, 0.14));
        wings(ctx, 'saloon', rear, front, half, wr);
        blkBoth(b, rear + 0.15, front - 0.15, bodyHalf, half - 0.02, 0.25, 0.29, COL.dark);
        tube(b, 'y', -0.08, 0.08, L + 0.18, 0.55, 0.3, 0.3, 14, COL.black); // spare wheel on the tail
    } else if (key === 'car50') {
        blk(b, -0.03, 0.04, -bw * 0.55, bw * 0.55, 0.3 * H, 0.48 * H, COL.chrome); // grille
        blk(b, -0.035, 0.03, -bw * 0.5, bw * 0.5, 0.34 * H, 0.44 * H, COL.dark);
        both(s => { roundLamp(head, 0.07, s * bw * 0.78, 0.46 * H, 0.1, 0.1); });
        both(s => rectLamp(tail, L + 0.01, s * bw * 0.8, 0.5 * H, 0.14, 0.09));
    } else if (key === 'car70') {
        blk(b, -0.03, 0.04, -bw * 0.5, bw * 0.5, 0.34 * H, 0.46 * H, COL.dark);
        both(s => { rectLamp(head, 0.03, s * bw * 0.7, 0.45 * H, 0.26, 0.12); rectLamp(tail, L + 0.01, s * bw * 0.78, 0.5 * H, 0.2, 0.12); });
    } else {
        blk(b, -0.03, 0.05, -bw * 0.5, bw * 0.5, 0.33 * H, 0.45 * H, COL.dark);
        both(s => { rectLamp(head, 0.06, s * bw * 0.72, 0.5 * H, 0.34, 0.1, 0.07); rectLamp(tail, L + 0.01, s * bw * 0.76, 0.58 * H, 0.3, 0.1); });
    }
    if (key === 'tin' || key === 'saloon30') both(s => rectLamp(tail, L + 0.01, s * half * 0.6, 0.45 * H, 0.1, 0.08));
    if (S.modern || key === 'car70') both(s => blk(b, 0.4 * L, 0.46 * L, s * (bodyHalf + 0.0), s * (bodyHalf + 0.16), 0.67 * H, 0.67 * H + 0.1, ctx.cols.paint)); // door mirrors
}

/** Separate wings (mudguards) over front and rear wheels: a top plate and a skirt, outside the body line. */
function wings(ctx, style, rear, front, half, wr) {
    const { b, cols } = ctx, col = style === 'tin' ? COL.dark : cols.paint;
    const top = wr * 2 + 0.07;
    both(s => {
        for (const [ax, len] of [[front, 0.62], [rear, 0.58]]) {
            blk(b, ax - len, ax + len, s * (half - 0.34), s * (half + 0.01), top, top + 0.04, col);
            blk(b, ax - len, ax - len + 0.04, s * (half - 0.34), s * (half + 0.01), wr, top, col);
            blk(b, ax + len - 0.04, ax + len, s * (half - 0.34), s * (half + 0.01), wr * 1.1, top, col);
            blk(b, ax - len, ax + len, s * (half - 0.01), s * (half + 0.01), top - 0.2, top, col);
        }
        if (style === 'saloon') blk(b, front - 0.1, front + 0.4, s * (half - 0.2), s * (half - 0.05), top + 0.04, top + 0.12, COL.chrome);
    });
}

// ---- vans -----------------------------------------------------------------------------------------------------

const VAN_ERAS = [
    // 0-1: not used (vans start 1955); 2: split-screen snub-nosed, 3: first Transit-like, 4: modern
    null, null,
    { rows: [[0.02, .18, .42, .50, .90, .84], [0.15, .18, .48, .56, .94, .88], [0.16, .18, .56, .56, .96, .92], [0.28, .18, .58, .96, .96, .86],
        [0.40, .18, .58, .98, .96, .88], [0.405, .18, .58, 1.0, .96, .92], [0.985, .18, .58, 1.0, .96, .92], [1.0, .2, .56, .98, .94, .9]],
    codes: 'PPPWGPPP', wheel: 'disc' },
    { rows: [[0.02, .2, .46, .52, .9, .84], [0.18, .2, .56, .62, .96, .9], [0.2, .2, .62, .62, .96, .92], [0.31, .2, .64, .97, .96, .86],
        [0.42, .2, .64, 1.0, .96, .9], [0.425, .2, .64, 1.0, .96, .92], [0.985, .2, .64, 1.0, .96, .92], [1.0, .22, .6, .98, .94, .9]],
    codes: 'PPPWGPPP', wheel: 'disc' },
    { rows: [[0.02, .22, .5, .56, .9, .84], [0.15, .22, .6, .66, .98, .9], [0.3, .22, .66, .98, .98, .86], [0.44, .22, .68, 1.0, .98, .9],
        [0.445, .22, .68, 1.0, .98, .93], [0.985, .22, .68, 1.0, .98, .93], [1.0, .24, .64, .98, .96, .9]],
    codes: 'PWGPPP', wheel: 'alloy' },
];

function van(ctx) {
    const { b, head, tail, L, W, H, ro, spec } = ctx, S = VAN_ERAS[Math.max(2, spec.era ?? 3)], wr = spec.draw.wheel.r, half = W / 2;
    hull(ctx, S.rows, S.codes, [ctx.cols.paint, ctx.cols.paint]);
    arches(ctx, wr, 0.95 * half, [ro, ro + spec.wheelbase]);
    const bw = half * 0.94;
    blk(b, -0.1, 0.06, -bw, bw, 0.3 * H, 0.3 * H + 0.14, S.wheel === 'alloy' ? hex('#2b2b2b') : COL.chrome);
    blk(b, L - 0.03, L + 0.1, -bw, bw, 0.3 * H, 0.3 * H + 0.14, hex('#2b2b2b'));
    blk(b, -0.14, -0.1, -0.26, 0.26, 0.3 * H + 0.14, 0.3 * H + 0.26, COL.plate);
    blk(b, L + 0.1, L + 0.13, -0.26, 0.26, 0.3 * H + 0.16, 0.3 * H + 0.28, hex('#e8c840'));
    blk(b, -0.03, 0.05, -bw * 0.5, bw * 0.5, 0.33 * H, 0.43 * H, COL.dark);
    both(s => { rectLamp(head, 0.04, s * bw * 0.72, 0.42 * H, 0.24, 0.12); rectLamp(tail, L + 0.01, s * bw * 0.85, 0.5 * H, 0.1, 0.4); });
    blk(b, L + 0.0, L + 0.012, -0.01, 0.01, 0.2 * H, 0.9 * H, hex('#2a2a2a')); // rear door split
    both(s => blk(b, 0.28 * L, 0.3 * L, s * (bw + 0.0), s * (bw + 0.16), 0.58 * H, 0.58 * H + 0.2, hex('#202020'))); // mirrors
}

// ---- bus ------------------------------------------------------------------------------------------------------

function bus(ctx) {
    const { b, head, tail, L, W, H, ro, spec } = ctx, era = spec.era ?? 2, half = W / 2, wr = spec.draw.wheel.r;
    const cream = shade(ctx.cols.paint, 1.0), roof = era <= 2 ? hex('#d6d0bc') : shade(ctx.cols.paint, 0.95);
    ctx.cols.roof = roof;
    const zb = 0.3, zs = 1.05, rd = era <= 2 ? 0.5 : 0.28;
    const row = (x, wFront = 1, h = H) => ({ x, r: ring({ wb: half * 0.96 * wFront, wr: half * 0.9 * wFront, zb: zb, zs: zs, zr: h, rd }) });
    const st = [], codes = [];
    // nose: era 0-1 a short bonnet and half cab, later a rounded or flat front
    const noseLen = era <= 1 ? 1.4 : era === 2 ? 0.5 : 0.25;
    st.push(row(0, 0.98), row(0.04, 1)); codes.push('P');
    // bays of windows and pillars along the length, 0.25 m pillars
    const bodyEnd = L - noseLen, bays = Math.round((bodyEnd - 1.2) / 1.15);
    let x = 0.04 + 1.0;
    st.push(row(x)); codes.push('G'); // rear window area as first bay start
    const bay = (bodyEnd - x - 0.3) / bays;
    for (let i = 0; i < bays; i++) {
        st.push(row(x + 0.25)); codes.push('P');
        st.push(row(x + bay)); codes.push('G');
        x += bay;
    }
    st.push(row(bodyEnd - 0.05)); codes.push('P');
    // front
    if (era <= 1) {
        // bonnet: narrower and lower, with a radiator
        st.push({ x: bodyEnd, r: ring({ wb: half * 0.95, wr: half * 0.7, zb, zs: zs + 0.05, zr: zs + 0.05 }) }); codes.push('P');
        st.push({ x: L - 0.05, r: ring({ wb: half * 0.5, wr: half * 0.44, zb: zb + 0.1, zs: 1.15, zr: 1.4, rd: 0.1 }) }); codes.push('P');
        st.push({ x: L, r: ring({ wb: half * 0.46, wr: half * 0.42, zb: zb + 0.1, zs: 1.15, zr: 1.4, rd: 0.1 }) }); codes.push('P');
    } else {
        st.push({ x: bodyEnd + noseLen * 0.55, r: ring({ wb: half * 0.97, wr: half * 0.88, zb, zs: zs, zr: H - 0.15, rd }) }); codes.push('W');
        st.push({ x: L, r: ring({ wb: half * 0.95, wr: half * 0.82, zb: zb + 0.05, zs: zs, zr: H - 0.5, rd: 0.2 }) }); codes.push('P');
    }
    loft(b, st, codes, ctx.cols, { caps: [ctx.cols.paint, era <= 1 ? COL.dark : ctx.cols.paint] });
    // livery band and roof stripe
    blkBoth(b, 0.1, bodyEnd, half * 0.965, half * 0.965 + 0.01, zs - 0.12, zs - 0.02, cream);
    arches(ctx, wr, half * 0.96, [ro, ro + spec.wheelbase]);
    // destination blind + lamps + plates
    blk(b, L - 0.01, L + 0.03, -half * 0.6, half * 0.6, H - 0.55, H - 0.35, era <= 2 ? hex('#f0e6b0') : hex('#e0a020'));
    blk(b, -0.02, 0.03, -0.3, 0.3, 0.5, 0.62, COL.plate);
    blk(b, -0.02, 0.01, -half * 0.7, half * 0.7, 0.35, 0.5, hex('#2b2b2b'));
    blk(b, 0.0, 0.012, -0.3, 0.3, 0.72, 0.85, hex('#e8c840'));
    both(s => { roundLamp(head, L - 0.04, s * half * 0.62, era <= 1 ? 1.0 : 0.78, 0.12, 0.08); rectLamp(tail, 0.0, s * half * 0.78, 0.9, 0.16, 0.28); });
    both(s => blk(b, L - 1.2, L - 1.0, s * (half * 0.97), s * (half * 0.97 + 0.22), H - 1.1, H - 0.4, hex('#202020'))); // mirror arms
    if (era <= 1) {
        blk(b, L - 0.04, L + 0.04, -half * 0.3, half * 0.3, 0.45, 1.3, COL.chrome); // radiator
        blk(b, L - 0.03, L + 0.05, -half * 0.26, half * 0.26, 0.5, 1.25, COL.dark);
    }
}

// ---- tractor --------------------------------------------------------------------------------------------------

function tractor(ctx) {
    const { b, head, tail, L, W, H, ro, spec } = ctx, era = spec.era ?? 2, half = W / 2, wr = spec.draw.axles[0].r;
    const paint = era <= 1 ? hex('#6b6f73') : era === 2 ? hex('#8a8e92') : ctx.cols.paint;
    const rear = ro, front = ro + spec.wheelbase, fr = spec.draw.axles[1].r;
    ctx.cols.paint = paint;
    // engine: a long narrow bonnet on a chassis, radiator grille at the front
    loft(b, [
        { x: front - 0.5, r: ring({ wb: 0.34, wr: 0.28, zb: 0.5, zs: 0.95, zr: 1.18, rd: 0.12 }) },
        { x: L - 0.05, r: ring({ wb: 0.34, wr: 0.3, zb: 0.5, zs: 0.9, zr: 1.1, rd: 0.12 }) },
        { x: L, r: ring({ wb: 0.32, wr: 0.28, zb: 0.55, zs: 0.9, zr: 1.05, rd: 0.1 }) },
    ], ['P', 'P'], { ...ctx.cols, paint }, { caps: [paint, COL.dark] });
    blk(b, front - 0.5, ro + 0.5, -0.2, 0.2, 0.55, 0.98, hex('#4a4d50')); // transmission/clutch housing
    blk(b, ro - 0.4, ro + 0.6, -0.26, 0.26, 0.5, 0.75, hex('#3a3d40'));
    blk(b, L - 0.04, L + 0.03, -0.25, 0.25, 0.62, 1.0, COL.dark); // grille
    // rear mudguards over the big wheels
    both(s => blk(b, ro - wr * 0.9, ro + wr * 0.9, s * (half - 0.58), s * (half + 0.0), wr * 2 + 0.04, wr * 2 + 0.1, paint));
    // seat, steering wheel, exhaust
    blk(b, ro - 0.4, ro + 0.1, -0.2, 0.2, wr * 2 + 0.1, wr * 2 + 0.28, hex('#2a2a2a'));
    blk(b, ro - 0.42, ro - 0.36, -0.2, 0.2, wr * 2 + 0.1, wr * 2 + 0.55, hex('#2a2a2a'));
    tube(b, 'x', ro + 0.5, ro + 0.9, 0, wr * 2 + 0.38, 0.17, 0.17, 10, COL.black); // steering wheel as a disc
    blk(b, ro + 0.55, ro + 0.6, -0.02, 0.02, 1.0, wr * 2 + 0.36, COL.black);
    if (era >= 3) {
        // glazed cab on four posts
        loft(b, [
            { x: ro - 0.75, r: ring({ wb: half * 0.78, wr: half * 0.74, zb: wr * 2, zs: wr * 2 + 0.1, zr: H - 0.06, rd: 0.08 }) },
            { x: ro + 0.85, r: ring({ wb: half * 0.78, wr: half * 0.74, zb: wr * 2, zs: wr * 2 + 0.1, zr: H - 0.06, rd: 0.08 }) },
        ], ['W'], { ...ctx.cols, paint, roof: shade(paint, 0.9) }, { caps: [COL.glass, COL.glass] });
    } else {
        blk(b, front + 0.1, front + 0.18, -0.03, 0.03, 1.15, 1.95, COL.black); // vertical exhaust pipe
        blk(b, front + 0.07, front + 0.21, -0.06, 0.06, 1.95, 2.02, COL.black);
    }
    both(s => roundLamp(head, L, s * 0.26, 0.9, 0.08, 0.06));
    // front axle beam
    blk(b, front - 0.05, front + 0.05, -(half - 0.25), half - 0.25, fr * 2 - 0.05, fr * 2 + 0.05, hex('#3a3d40'));
    blk(b, front - 0.05, front + 0.05, -0.12, 0.12, fr * 2 - 0.05, 0.6, hex('#3a3d40'));
    rectLamp(tail, 0.0, 0, 0.9, 0.2, 0.08);
}

// ---- horse and cart -------------------------------------------------------------------------------------------

function cart(ctx) {
    const { b, L, W, ro } = ctx, half = W / 2, bay = hex('#6a4528'), wood = COL.wood, dark = hex('#4a3322');
    // the cart: a plank floor, low sides, a tailboard and a driver's bench
    blk(b, 0.0, 3.0, -half * 0.9, half * 0.9, 0.75, 0.82, wood);
    both(s => blk(b, 0.0, 3.0, s * half * 0.9 - 0.03, s * half * 0.9 + 0.03, 0.82, 1.35, wood));
    blk(b, 0.0, 0.05, -half * 0.9, half * 0.9, 0.82, 1.35, wood);
    blk(b, 2.9, 3.0, -half * 0.9, half * 0.9, 0.82, 1.2, wood);
    blk(b, 2.2, 2.6, -half * 0.6, half * 0.6, 1.2, 1.28, dark); // bench
    blk(b, 2.2, 2.26, -half * 0.6, half * 0.6, 1.28, 1.6, dark);
    blk(b, 0.3, 2.1, -half * 0.72, half * 0.72, 0.82, 1.4, hex('#b8a27a')); // a load: sacks
    // axle and wheels are instanced; shafts reach to the horse
    blk(b, ro - 0.04, ro + 0.04, -half * 0.88, half * 0.88, 0.58, 0.66, dark);
    both(s => blk(b, 1.2, 4.0, s * 0.5 - 0.03, s * 0.5 + 0.03, 0.8, 0.87, dark));
    // the horse
    const x0 = 3.6;
    blk(b, x0 + 0.1, x0 + 1.15, -0.28, 0.28, 0.95, 1.55, bay);     // barrel
    blk(b, x0 + 1.05, x0 + 1.4, -0.22, 0.22, 1.0, 1.65, bay);      // chest
    blk(b, x0 + 1.3, x0 + 1.75, -0.12, 0.12, 1.45, 2.05, bay);     // neck
    blk(b, x0 + 1.65, x0 + 2.0, -0.1, 0.1, 1.75, 2.0, bay);        // head
    blk(b, x0 + 1.9, x0 + 2.05, -0.09, 0.09, 1.68, 1.82, hex('#3a2a1c')); // muzzle
    blk(b, x0 + 1.55, x0 + 1.68, -0.02, 0.02, 1.95, 2.15, hex('#2b1d12')); // mane
    blk(b, x0 + 1.72, x0 + 1.78, -0.1, -0.06, 1.99, 2.12, bay); blk(b, x0 + 1.72, x0 + 1.78, 0.06, 0.1, 1.99, 2.12, bay);
    blk(b, x0 - 0.02, x0 + 0.06, -0.04, 0.04, 0.95, 1.4, hex('#2b1d12')); // tail
    both(s => { // legs
        blk(b, x0 + 0.1, x0 + 0.3, s * 0.2 - 0.06, s * 0.2 + 0.06, 0, 0.95, bay);
        blk(b, x0 + 1.0, x0 + 1.2, s * 0.2 - 0.06, s * 0.2 + 0.06, 0, 1.0, bay);
        blk(b, x0 + 0.1, x0 + 0.3, s * 0.2 - 0.06, s * 0.2 + 0.06, 0, 0.12, dark);
        blk(b, x0 + 1.0, x0 + 1.2, s * 0.2 - 0.06, s * 0.2 + 0.06, 0, 0.12, dark);
    });
    blk(b, x0 + 1.0, x0 + 1.2, -0.3, 0.3, 1.55, 1.65, dark); // collar
    both(sd => rectLamp(ctx.tail, 0.0, sd * half * 0.8, 1.0, 0.1, 0.1)); // tail lanterns
    void L;
}

// ---- bicycle --------------------------------------------------------------------------------------------------

function bicycle(ctx) {
    const { b, ro, spec } = ctx, rear = ro, front = ro + spec.wheelbase, r = spec.draw.wheel.r, frame = hex('#2a2a2a');
    const bar = (x0, z0, x1, z1) => { // a thin tube between two points in the x-z plane
        const n = 8;
        for (let i = 0; i < n; i++) {
            const a = i / n, c = (i + 1) / n;
            blk(b, Math.min(x0 + (x1 - x0) * a, x0 + (x1 - x0) * c), Math.max(x0 + (x1 - x0) * a, x0 + (x1 - x0) * c) + 0.01, -0.015, 0.015, Math.min(z0 + (z1 - z0) * a, z0 + (z1 - z0) * c), Math.max(z0 + (z1 - z0) * a, z0 + (z1 - z0) * c) + 0.02, frame);
        }
    };
    const bb = ro + 0.5, seat = [ro + 0.3, 1.0], head = [front - 0.12, 1.02];
    bar(rear, r, bb, 0.3); bar(bb, 0.3, seat[0], seat[1]); bar(seat[0], seat[1], rear, r);
    bar(bb, 0.3, head[0], head[1] - 0.05); bar(seat[0], seat[1], head[0], head[1]); bar(head[0], head[1], front, r);
    blk(b, head[0] - 0.02, head[0] + 0.02, -0.28, 0.28, head[1] + 0.03, head[1] + 0.06, frame); // handlebars
    blk(b, seat[0] - 0.12, seat[0] + 0.1, -0.06, 0.06, seat[1] + 0.02, seat[1] + 0.07, hex('#222222'));
    // rider: legs on the pedals, torso leaning forward, arms to the bars, head with a flat cap
    const coat = ctx.cols.paint, skin = hex('#d7a98a');
    both(s => {
        blk(b, bb - 0.1, seat[0] + 0.05, s * 0.1 - 0.05, s * 0.1 + 0.05, 0.4, 0.98, hex('#35393f'));
        blk(b, bb - 0.12, bb + 0.1, s * 0.1 - 0.05, s * 0.1 + 0.05, 0.28, 0.45, hex('#222222'));
        blk(b, seat[0] + 0.1, head[0] - 0.02, s * 0.2 - 0.03, s * 0.2 + 0.03, 1.05, 1.08, coat);
        blk(b, head[0] - 0.05, head[0] + 0.01, s * 0.2 - 0.03, s * 0.2 + 0.03, 1.02, 1.08, coat);
    });
    blk(b, seat[0] - 0.05, seat[0] + 0.28, -0.2, 0.2, 1.02, 1.55, coat);
    blk(b, seat[0] + 0.2, seat[0] + 0.45, -0.1, 0.1, 1.45, 1.68, skin);
    blk(b, seat[0] + 0.18, seat[0] + 0.47, -0.12, 0.12, 1.66, 1.74, hex('#3a3a3a'));
    blk(b, seat[0] - 0.3, seat[0] - 0.1, -0.015, 0.015, 0.6, 0.65, frame); // rack
    rectLamp(ctx.tail, seat[0] - 0.3, 0, 0.75, 0.08, 0.08); // rear reflector
}

// ---- dispatcher -----------------------------------------------------------------------------------------------

const MODELS = { tin: c => car(c, 'tin'), saloon30: c => car(c, 'saloon30'), car50: c => car(c, 'car50'), car70: c => car(c, 'car70'), car2k: c => car(c, 'car2k'), vanTraffic: van, bus, tractor, cart, bicycle };
export const TRAFFIC_MODELS = Object.keys(MODELS);

/** {body, head, tail} meshes (origin under the rear axle) for a traffic vehicle spec from agentDrawSpec, or null. */
export function buildTrafficModel(spec) {
    const make = MODELS[spec.model];
    if (!make) return null;
    const paint = hex(spec.paint ?? '#8a2b2b');
    const ctx = {
        spec, L: spec.length, W: spec.width, H: spec.height, ro: spec.rearOverhang,
        b: createBuilder(), head: createBuilder(), tail: createBuilder(),
        cols: { paint, roof: paint, glass: COL.glass, dark: COL.dark, trim: COL.chrome },
    };
    make(ctx);
    const shift = new Float64Array(16);
    shift[0] = shift[5] = shift[10] = shift[15] = 1; shift[12] = -ctx.ro;
    const fin = bld => transformMesh(bld.finish(), shift);
    return { body: fin(ctx.b), head: fin(ctx.head), tail: fin(ctx.tail) };
}
