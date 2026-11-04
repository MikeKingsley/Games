// Pure building meshes for the WebGL renderer (no DOM, no GL): the 3D counterpart of render/draw-buildings.js. Every
// building style of the world generator (gabled houses, shops, pubs, terraces, farmhouses, barns, churches with towers,
// flat warehouses, and the industrial shapes: tanks, spoil heaps, pits, pens, log stacks, fuel pumps) becomes triangles
// in world coordinates, sitting on the building's own base height `b.z` (set by world/terrain.js attachTerrain).
// Windows, doors and shopfront fascias are thin inset quads (era colours), chimneys small boxes; they are only added
// when `detail` is on (near chunks), so far chunks stay cheap.
import { createBuilder, compose } from './meshes.js';
import { fasciaColour, eraOf } from '../era.js';

/** '#rrggbb' or '#rgb' to a 0..1 triple. */
export function hex(h) {
    const s = h.replace('#', '');
    const f = s.length === 3 ? s.split('').map(c => c + c).join('') : s.slice(0, 6);
    return [parseInt(f.slice(0, 2), 16) / 255, parseInt(f.slice(2, 4), 16) / 255, parseInt(f.slice(4, 6), 16) / 255];
}

/**
 * Marks a colour as emissive-capable for the lit shaders (see shaders.js): the red channel is stored negated. `lamp` also
 * negates green (a lamp bulb, lit at night); otherwise it is a window (some are lit at night).
 */
export const emissive = (c, lamp = false) => [-Math.max(c[0], 0.004), lamp ? -Math.max(c[1], 0.004) : c[1], c[2]];

/** A colour (hex string or triple) darkened (k < 1) or lightened towards white (k > 1), same rule as shapes.js `shade`. */
export function shade(c, k) {
    const t = typeof c === 'string' ? hex(c) : c;
    return t.map(v => Math.max(0, Math.min(1, k >= 1 ? v + (1 - v) * (k - 1) : v * k)));
}

/** How far walls reach below the building's base height so the lower side of a slope never shows a gap. */
export const SKIRT = 1.2;
/** Offset of windows, doors and fascias from the wall, so they do not z-fight with it. */
const INSET = 0.05;

const hashId = (id, seed) => [...String(id)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, seed);

/** The corners of a rectangle centred on (x, y), `len` along `angle` and `dep` across, as [{x, y}, ...]. */
export function rectPoly(x, y, len, dep, angle) {
    const c = Math.cos(angle), s = Math.sin(angle), hl = len / 2, hd = dep / 2;
    return [[hl, hd], [hl, -hd], [-hl, -hd], [-hl, hd]].map(([u, v]) => ({ x: x + u * c - v * s, y: y + u * s + v * c }));
}

/** A flat quad (4 corners, one normal) added to a builder. */
function addQuad(b, p0, p1, p2, p3, n, col) {
    const base = b.vertexCount;
    for (const p of [p0, p1, p2, p3]) b.vertex(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2]);
    b.quad(base, base + 1, base + 2, base + 3);
}

/** A vertical quad on a wall: centred at along-wall position (cx, cy), `halfW` each way along (tx, ty), from z0 to z1. */
function addWallQuad(b, cx, cy, tx, ty, halfW, z0, z1, n, col) {
    addQuad(b, [cx - tx * halfW, cy - ty * halfW, z0], [cx + tx * halfW, cy + ty * halfW, z0],
        [cx + tx * halfW, cy + ty * halfW, z1], [cx - tx * halfW, cy - ty * halfW, z1], [n[0], n[1], 0], col);
}

/** A gable roof: eaves at `h` (overhanging a little), ridge at `h + rise` along the length. Gable triangles close the ends. */
function addGable(b, x, y, len, dep, angle, h, rise, wallCol, roofCol) {
    const c = Math.cos(angle), s = Math.sin(angle), hl = len / 2, hd = dep / 2;
    const pt = (u, v, z) => [x + u * c - v * s, y + u * s + v * c, z];
    const ov = 0.3, drop = 0.2;
    for (const side of [1, -1]) {
        // the slope normal in (v, z): perpendicular to the slope from eave to ridge, pointing up and out
        const dv = hd + ov, dz = rise + drop, il = 1 / Math.hypot(dv, dz);
        const nv = dz * il * side, nz = dv * il;
        const n = [-s * nv, c * nv, nz];
        addQuad(b, pt(-hl - ov, side * (hd + ov), h - drop), pt(hl + ov, side * (hd + ov), h - drop), pt(hl + ov, 0, h + rise), pt(-hl - ov, 0, h + rise), n, roofCol);
    }
    for (const u of [-1, 1]) {
        const n = [c * u, s * u, 0];
        const base = b.vertexCount;
        for (const p of [pt(u * hl, hd, h), pt(u * hl, -hd, h), pt(u * hl, 0, h + rise)]) b.vertex(p[0], p[1], p[2], n[0], n[1], n[2], wallCol[0], wallCol[1], wallCol[2]);
        b.tri(base, base + 1, base + 2);
    }
}

/** Windows on both long walls (and a door, and a shop fascia) following the Canvas renderer's layout. */
function addDetail(b, bd, year, h) {
    const c = Math.cos(bd.angle), s = Math.sin(bd.angle);
    const storeys = Math.max(1, Math.floor(h / 3));
    const dark = emissive(hex(eraOf(year) >= 3 ? '#5a6c78' : '#3c4a55'));
    const n = Math.max(1, Math.floor(bd.len / 3.2));
    const homes = bd.type === 'terrace' ? bd.homes ?? Math.round(bd.len / 5.5) : 1;
    const doorSide = bd.side ?? 1;
    const houseLike = bd.type === 'house' || bd.type === 'terrace' || bd.type === 'farmhouse';
    for (const v of [1, -1]) {
        const nx = -s * v, ny = c * v; // outward normal of this long wall
        const ox = bd.x + nx * (bd.dep / 2 + INSET), oy = bd.y + ny * (bd.dep / 2 + INSET);
        for (let k = 0; k < n; k++) {
            const u = -bd.len / 2 + (k + 0.5) * (bd.len / n);
            for (let f = 0; f < storeys; f++) {
                const z0 = 0.9 + f * 3, z1 = z0 + 1.3;
                if (z1 > h - 0.4) continue;
                addWallQuad(b, ox + c * u, oy + s * u, c, s, 0.55, (bd.z ?? 0) + z0, (bd.z ?? 0) + z1, [nx, ny], dark);
            }
        }
        if (v === doorSide && houseLike) {
            const doorCols = ['#6b2d2a', '#2d4a3a', '#2b3d5a', '#4a3a2a', '#1f1f24'];
            const col = hex(doorCols[hashId(bd.id, 5) % doorCols.length]);
            for (let k = 0; k < homes; k++) {
                const u = homes > 1 ? -bd.len / 2 + (k + 0.5) * (bd.len / homes) : 0;
                addWallQuad(b, ox + c * u + nx * 0.01, oy + s * u + ny * 0.01, c, s, 0.5, bd.z ?? 0, (bd.z ?? 0) + 2.1, [nx, ny], col);
            }
        }
        if (v === doorSide && (bd.type === 'shop' || bd.type === 'pub')) {
            const hl = bd.len / 2 - 0.3;
            const col = hex(fasciaColour(bd, year));
            addWallQuad(b, ox + nx * 0.01, oy + ny * 0.01, c, s, hl, (bd.z ?? 0) + 2.6, (bd.z ?? 0) + 3.3, [nx, ny], col);
        }
    }
}

/** A chimney stack at the roof ridge, near one gable end. */
function addChimneys(b, bd, h, rise) {
    const c = Math.cos(bd.angle), s = Math.sin(bd.angle);
    const homes = bd.type === 'terrace' ? bd.homes ?? Math.round(bd.len / 5.5) : 1;
    const brick = hex('#7a4a3a');
    const stacks = homes > 1 ? homes + 1 : 1;
    for (let k = 0; k < stacks; k++) {
        const u0 = homes > 1 ? -bd.len / 2 + k * (bd.len / homes) : bd.len / 2 - 1.3;
        const u = Math.max(-bd.len / 2 + 0.5, Math.min(bd.len / 2 - 0.5, u0));
        compose.prism(b, rectPoly(bd.x + u * c, bd.y + u * s, 0.8, 0.8, bd.angle), 1.6 + rise * 0.1, brick, { z0: (bd.z ?? 0) + h + rise * 0.75, roofColor: shade(brick, 0.8) });
    }
}

const CHIMNEY_TYPES = new Set(['house', 'terrace', 'farmhouse', 'shop', 'pub']);

/**
 * Adds one building's triangles to a builder. `year` picks era colours; `detail` adds windows, doors, fascias and
 * chimneys. Unknown shapes fall back to the plain gabled/flat building.
 */
export function addBuilding(b, bd, year = 1919, detail = true) {
    const z = bd.z ?? 0;
    const z0 = z - SKIRT;
    const wall = hex(bd.wall ?? '#ddd8c8');
    switch (bd.shape) {
        case 'tank': {
            const r = Math.min(bd.len, bd.dep) / 2;
            const poly = Array.from({ length: 8 }, (_, k) => ({ x: bd.x + Math.cos(k / 8 * Math.PI * 2) * r, y: bd.y + Math.sin(k / 8 * Math.PI * 2) * r }));
            compose.prism(b, poly, bd.h + SKIRT, wall, { z0, roofColor: shade(wall, 1.12) });
            return;
        }
        case 'heap': {
            const r = Math.min(bd.len, bd.dep) / 2;
            compose.cylinder(b, bd.x, bd.y, z0, r * 1.05, bd.h + SKIRT, 6, wall, { radiusTop: 0, caps: false });
            return;
        }
        case 'pit':
            compose.prism(b, rectPoly(bd.x, bd.y, bd.len, bd.dep, bd.angle), 0.06, shade(wall, 0.75), { z0: z + 0.02 });
            return;
        case 'pens': {
            compose.prism(b, rectPoly(bd.x, bd.y, bd.len, bd.dep, bd.angle), 0.06, hex('#9c8a6a'), { z0: z + 0.02 });
            const c = Math.cos(bd.angle), s = Math.sin(bd.angle);
            for (let k = 0; k <= 4; k++) {
                const u = -bd.len / 2 + (k / 4) * bd.len;
                compose.prism(b, rectPoly(bd.x + u * c, bd.y + u * s, 0.3, bd.dep, bd.angle), bd.h, wall, { z0: z, roofColor: shade(wall, 1.1) });
            }
            return;
        }
        case 'logs':
            compose.prism(b, rectPoly(bd.x, bd.y, bd.len, bd.dep, bd.angle), bd.h + SKIRT, wall, { z0, roofColor: shade(wall, 1.15) });
            return;
        case 'pumps':
            addPumps(b, bd, year);
            return;
        default: break;
    }
    const roofCol = hex(bd.roofCol ?? '#555555');
    const poly = rectPoly(bd.x, bd.y, bd.len, bd.dep, bd.angle);
    let rise = 0;
    if (bd.roof === 'flat') {
        compose.prism(b, poly, bd.h + SKIRT, wall, { z0, roofColor: shade(roofCol, 1.05) });
    } else {
        rise = bd.dep * 0.32;
        compose.prism(b, poly, bd.h + SKIRT, wall, { z0, cap: false });
        addGable(b, bd.x, bd.y, bd.len, bd.dep, bd.angle, z + bd.h, rise, wall, roofCol);
    }
    if (bd.tower) {
        const c = Math.cos(bd.angle), s = Math.sin(bd.angle);
        const tx = bd.x - c * (bd.len / 2 - 2.6), ty = bd.y - s * (bd.len / 2 - 2.6);
        compose.prism(b, rectPoly(tx, ty, 5.2, 5.2, bd.angle), bd.h + 9 + SKIRT, wall, { z0, roofColor: shade(wall, 0.9) });
    }
    if (detail) {
        addDetail(b, { ...bd, z }, year, bd.h);
        if (bd.roof !== 'flat' && CHIMNEY_TYPES.has(bd.type)) addChimneys(b, { ...bd, z }, bd.h, rise);
    }
}

/** Fuel pumps on their island: tall globe pumps before 1950, squat electric ones after, a canopy from 1960. */
function addPumps(b, bd, year) {
    const c = Math.cos(bd.angle), s = Math.sin(bd.angle), z = bd.z ?? 0;
    compose.prism(b, rectPoly(bd.x, bd.y, bd.len, bd.dep, bd.angle), 0.2, hex('#9a958a'), { z0: z, roofColor: hex('#b3ada0') });
    const old = year < 1950;
    const body = hex(old ? '#b33333' : year < 1980 ? '#e8e2d0' : '#2f6fb3');
    for (const u of [-1.8, 0, 1.8]) {
        const x = bd.x + c * u, y = bd.y + s * u;
        compose.prism(b, rectPoly(x, y, 0.55, 0.55, bd.angle), old ? 2.4 : 1.5, body, { z0: z + 0.2, roofColor: hex(old ? '#dd4444' : '#f3efe6') });
        if (old) compose.cylinder(b, x, y, z + 2.6, 0.32, 0.4, 6, hex('#f4ead0'), { radiusTop: 0.18 });
    }
    if (year >= 1960) {
        for (const u of [-1, 1]) for (const v of [-1, 1]) {
            compose.cylinder(b, bd.x + c * u * (bd.len / 2 + 1.6) - s * v * 2.6, bd.y + s * u * (bd.len / 2 + 1.6) + c * v * 2.6, z, 0.12, 4.2, 5, hex('#cfcbc0'));
        }
        compose.prism(b, rectPoly(bd.x, bd.y, bd.len + 4, 6, bd.angle), 0.5, hex('#e8e2d0'), { z0: z + 4.2, roofColor: hex(year < 1990 ? '#cc3333' : '#f2f2f0') });
    }
}

/** One building as a standalone mesh. */
export function buildBuilding(bd, year = 1919, detail = true) {
    const b = createBuilder();
    addBuilding(b, bd, year, detail);
    return b.finish();
}

/** Every building of a list merged into one mesh (vertex and triangle counts are the sums of the parts). */
export function buildBuildings(list, year = 1919, detail = true) {
    const b = createBuilder();
    for (const bd of list) addBuilding(b, bd, year, detail);
    return b.finish();
}

/** The parts of the year the building meshes depend on: rebuild a chunk's props only when this changes. */
export const buildingEra = year => `${eraOf(year)}:${year < 1950 ? 0 : 1}:${year >= 1960 ? 1 : 0}:${year < 1980 ? 0 : 1}:${year < 1990 ? 0 : 1}`;
