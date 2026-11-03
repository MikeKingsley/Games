// Deterministic world generation from the region seed: town street lattices, yards (depots, farms, industry
// sites), town buildings along the streets, and per-chunk ground detail (fields, hedges, trees, tors).
// Same seed + same inputs always give the same output, whatever order things are generated in.
import { seededRng, hashSeed, range, intRange, pick, chance, valueNoise } from '../engine/rng.js';
import { waterAt, moorAt, crossesWater, nearestTown } from './region.js';
import { pointAt } from './geom.js';
import { ROAD_CLASS, clearOfRoads } from './roadgraph.js';
import { obb, sat, createSpatialHash } from '../sim/collision.js';
import { CHUNK_SIZE } from '../config.js';

const SPACING = { city: 62, town: 56, small: 50, village: 42 };

// ---- Town streets ------------------------------------------------------------------------------------------

/**
 * A jittered, rotated street lattice clipped to the town's (noisy) circle, to land, and to nodes that are closer
 * to this town than to any other and not across wide water from its centre. Every node kept is connected:
 * a random spanning tree plus a share of the remaining lattice links.
 */
export function generateTownStreets(region, town) {
    const rng = seededRng(hashSeed(region.seed, 'streets', town.id));
    const s = SPACING[town.size] ?? 50;
    const organic = town.streets === 'organic' || (town.size !== 'city' && town.streets !== 'grid');
    const jitter = s * (organic ? 0.22 : 0.08);
    const angle = rng() * Math.PI / 2;
    const c = Math.cos(angle), sn = Math.sin(angle);
    const n = Math.ceil(town.radius / s) + 1;
    const grid = new Map();
    const nodes = [];
    const wobble = range(rng, 0, Math.PI * 2);
    for (let i = -n; i <= n; i++) {
        for (let j = -n; j <= n; j++) {
            const u = i * s + range(rng, -jitter, jitter), v = j * s + range(rng, -jitter, jitter);
            const x = town.x + u * c - v * sn, y = town.y + u * sn + v * c;
            const a = Math.atan2(y - town.y, x - town.x);
            const limit = town.radius * (0.86 + 0.16 * Math.sin(a * 3 + wobble));
            if (Math.hypot(x - town.x, y - town.y) > limit) continue;
            if (waterAt(region, x, y)) continue;
            if (nearestTown(region, x, y).town !== town) continue;
            if (crossesWater(region, town.x, town.y, x, y, 30)) continue;
            grid.set(`${i},${j}`, nodes.length);
            nodes.push({ x, y, i, j });
        }
    }
    // candidate links between lattice neighbours that don't cross wide water
    const links = [];
    for (const nd of nodes) {
        for (const [di, dj] of [[1, 0], [0, 1]]) {
            const k = grid.get(`${nd.i + di},${nd.j + dj}`);
            if (k === undefined) continue;
            const o = nodes[k];
            if (crossesWater(region, nd.x, nd.y, o.x, o.y, 30)) continue;
            links.push([grid.get(`${nd.i},${nd.j}`), k, crossesWater(region, nd.x, nd.y, o.x, o.y, 1)]);
        }
    }
    if (!nodes.length) return { nodes: [], edges: [], centre: -1 };
    // the component around the centre: random spanning tree first, then extra links
    let centre = 0;
    nodes.forEach((nd, k) => { if (Math.hypot(nd.x - town.x, nd.y - town.y) < Math.hypot(nodes[centre].x - town.x, nodes[centre].y - town.y)) centre = k; });
    const adj = nodes.map(() => []);
    links.forEach((l, k) => { adj[l[0]].push(k); adj[l[1]].push(k); });
    const seen = new Set([centre]);
    const used = new Set();
    const frontier = [...adj[centre]];
    while (frontier.length) {
        const k = frontier.splice(Math.floor(rng() * frontier.length), 1)[0];
        const [a, b] = links[k];
        const next = seen.has(a) ? b : a;
        if (seen.has(next)) continue;
        seen.add(next);
        used.add(k);
        frontier.push(...adj[next]);
    }
    const keep = organic ? 0.62 : 0.85;
    links.forEach((l, k) => { if (!used.has(k) && seen.has(l[0]) && seen.has(l[1]) && chance(rng, keep)) used.add(k); });
    const remap = new Map();
    const outNodes = [];
    for (const k of seen) { remap.set(k, outNodes.length); outNodes.push({ x: nodes[k].x, y: nodes[k].y }); }
    const edges = [...used].sort((a, b) => a - b).map(k => [remap.get(links[k][0]), remap.get(links[k][1]), links[k][2]]);
    return { nodes: outNodes, edges, centre: remap.get(centre) };
}

// ---- Yards: depots, farms, industry sites ----------------------------------------------------------------------

/**
 * A yard entered at (ex, ey) going along (ux, uy): an open rectangle with a loading marker at the back (the
 * vehicle's rear goes to the marker, nose pointing out) and a shed behind it.
 */
export function yardLayout(ex, ey, ux, uy, depth, width) {
    const angle = Math.atan2(uy, ux);
    const cx = ex + ux * depth / 2, cy = ey + uy * depth / 2;
    return {
        zone: obb(cx, cy, depth, width, angle),
        marker: { x: ex + ux * (depth - 1.2), y: ey + uy * (depth - 1.2), heading: Math.atan2(-uy, -ux) },
        entry: { x: ex, y: ey },
        angle, ux, uy, depth, width,
    };
}

const FARM_NAMES = ['Tregarth', 'Polwhele', 'Trenance', 'Coombe', 'Barton', 'Lydcott', 'Heathfield', 'Woodford', 'Ashcombe', 'Penhale', 'Trewin', 'Brook', 'Hillside', 'Oakhayes', 'Westcott', 'Nethercott', 'Holloway', 'Bowden', 'Langstone', 'Carnmoor', 'Kerris', 'Venton', 'Polgoon', 'Bosvenning', 'Gwavas', 'Yeo', 'Furzeham', 'Shilstone', 'Middlecott', 'Rowden', 'Hayne', 'Southcombe', 'Crocken', 'Penrose', 'Tresillian', 'Halwyn', 'Goonhilly', 'Ridgeway', 'Stowford', 'Willand'];
const FARM_PREFIX = ['Higher ', 'Lower ', 'West ', 'East ', 'North ', 'South ', 'Great ', 'Little ', '', '', '', ''];
const FARM_TYPES = ['dairy', 'dairy', 'arable', 'livestock', 'sheep', 'mixed'];

/** Fills in a farm's yard, buildings, name and type (from its own seed). */
export function layoutFarm(region, farm, entry) {
    const rng = seededRng(farm.seed);
    farm.name = `${pick(rng, FARM_PREFIX)}${pick(rng, FARM_NAMES)} Farm`;
    farm.type = farm.moor ? 'sheep' : pick(rng, FARM_TYPES);
    farm.yard = yardLayout(entry.x, entry.y, farm.ux, farm.uy, 30, 34);
    const { ux, uy } = farm;
    const vx = -uy, vy = ux;
    const y = farm.yard;
    const wall = west(region, farm.x) ? pick(rng, CORNISH_WALLS) : pick(rng, DEVON_WALLS);
    farm.buildings = [
        building(`${farm.id}-barn`, entry.x + ux * (y.depth + 6), entry.y + uy * (y.depth + 6), 26, 11, y.angle + Math.PI / 2, 7.5, 'barn', { wall: pick(rng, ['#7a5b45', '#8d8f88', '#6d6255']), roofCol: pick(rng, ['#6a6e72', '#8a4a3a']) }),
        building(`${farm.id}-house`, entry.x + ux * (y.depth * 0.45) + vx * (y.width / 2 + 6), entry.y + uy * (y.depth * 0.45) + vy * (y.width / 2 + 6), 11, 8, y.angle, 6.5, 'farmhouse', { wall, roofCol: pick(rng, SLATE) }),
        building(`${farm.id}-shed`, entry.x + ux * (y.depth * 0.5) - vx * (y.width / 2 + 7), entry.y + uy * (y.depth * 0.5) - vy * (y.width / 2 + 7), 18, 10, y.angle, 6, 'barn', { wall: '#857a6a', roofCol: '#5d6166' }),
    ];
    for (const b of farm.buildings) b.owner = farm.id;
    return farm;
}

const SITE_SHAPES = {
    chinaclay: [['heap', 30, 30, 16, '#f2f0ea'], ['box', 22, 12, 8, '#cfcac0']],
    quarry: [['pit', 32, 26, 0, '#8f8b84'], ['box', 18, 10, 7, '#7d7a74']],
    dairy: [['box', 26, 14, 9, '#e9e6dc'], ['tank', 6, 6, 9, '#d8dde0'], ['tank', 6, 6, 9, '#d8dde0']],
    timber: [['box', 26, 12, 8, '#8a6d4f'], ['logs', 14, 6, 2.2, '#9b7a55'], ['logs', 14, 6, 2.2, '#9b7a55']],
    fuel: [['tank', 12, 12, 9, '#e3e3df'], ['tank', 12, 12, 9, '#e3e3df'], ['box', 12, 8, 5, '#c9c6bd']],
    fish: [['box', 24, 10, 6, '#b8c4c9'], ['box', 12, 8, 5, '#d2d6d4']],
    docks: [['box', 30, 14, 10, '#8e8072'], ['box', 20, 12, 8, '#9a8b7c']],
    livestock: [['pens', 26, 16, 1.4, '#8a7259'], ['box', 16, 10, 7, '#a08f78']],
    depot: [['box', 34, 12, 8, '#9d8f7c']],
    garage: [['box', 12, 7, 4.5, '#e8e0cf'], ['pumps', 6, 1.4, 2.2, '#b33']],
};

/** Buildings for an industry site or depot yard: the main shed behind the yard, extras to the sides. */
export function layoutSite(site, entry, ux, uy, depth = 28, width = 34) {
    site.yard = yardLayout(entry.x, entry.y, ux, uy, depth, width);
    const y = site.yard;
    const vx = -uy, vy = ux;
    const shapes = SITE_SHAPES[site.type] ?? SITE_SHAPES.docks;
    site.buildings = shapes.map(([shape, len, dep, h, wall], k) => {
        // the main shed spans the back of the yard; the rest line its sides, front to back
        const side = k % 2 ? 1 : -1, row = Math.floor((k - 1) / 2);
        const along = k === 0 ? depth + dep / 2 + 1 : depth * 0.3 + row * (len + 3) + len / 2;
        const off = k === 0 ? 0 : side * (width / 2 + dep / 2 + 2);
        const b = building(`${site.id}-${k}`, entry.x + ux * along + vx * off, entry.y + uy * along + vy * off,
            k === 0 ? Math.max(len, width) : len, dep, y.angle + (k === 0 ? Math.PI / 2 : 0), h, site.type, { shape, wall, roofCol: shade(wall) });
        b.owner = site.id;
        return b;
    });
    return site;
}

function shade(hex) {
    const n = parseInt(hex.slice(1), 16);
    const f = v => Math.max(0, Math.round(v * 0.8)).toString(16).padStart(2, '0');
    return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

/**
 * Finds a spot on one of a town's streets for a yard (depot or in-town site): the street side with room for the
 * yard and its shed, clear of roads and of yards already placed. Returns {edge, along, side, entry, ux, uy} or null.
 */
export function findStreetYardSpot(world, town, rng, placed, depth = 28, width = 34) {
    const { graph, region } = world;
    const edges = graph.edges.filter(e => e.town === town.id && e.cls === 'street' && e.len > width + 6);
    // try streets near the middle of the town first, then further out
    const scored = edges.map(e => {
        const m = pointAt(e.pts, e.len / 2);
        const q = Math.hypot(m.x - town.x, m.y - town.y) / town.radius;
        return { e, score: Math.abs(q - 0.45) + rng() * 0.25 };
    }).sort((a, b) => a.score - b.score);
    for (const { e } of scored) {
        for (const side of [1, -1]) {
            const p = pointAt(e.pts, e.len / 2);
            const ux = -Math.sin(p.angle) * side, uy = Math.cos(p.angle) * side;
            const half = (ROAD_CLASS[e.cls].width) / 2;
            const entry = { x: p.x + ux * (half + 0.5), y: p.y + uy * (half + 0.5) };
            const total = depth + 14;
            // the reservation starts behind the pavement (the yard's mouth itself opens onto the street)
            const box = obb(entry.x + ux * (total / 2 + 1.6), entry.y + uy * (total / 2 + 1.6), total, width + 6, Math.atan2(uy, ux));
            if (!landBox(region, box) || !clearOfRoads(graph, box, 1.5)) continue;
            if (placed.some(o => sat(o, box))) continue;
            if (nearestTown(region, box.x, box.y).town !== town) continue;
            return { edge: e, along: e.len / 2, side, entry, ux, uy, box };
        }
    }
    return null;
}

// ---- Buildings -----------------------------------------------------------------------------------------------

const DEVON_WALLS = ['#efe6d2', '#e8dcc0', '#f3efe6', '#ddd0b5', '#c98f6b', '#b5705a', '#e9e1cf'];
const CORNISH_WALLS = ['#a9a59a', '#bdb7a8', '#cfc9b8', '#f1efe9', '#e4dfd2', '#9e9a90'];
const SLATE = ['#4a5058', '#575e66', '#3e444b', '#5b5550'];
const TILE = ['#9a4f3c', '#8a4535', '#a65d45'];
const THATCH = '#b8955a';
/** West of the Tamar (Cornwall) uses granite and slate. */
const west = (region, x) => x < region.project(50.5, -4.25).x;

export function building(id, x, y, len, dep, angle, h, type, extra = {}) {
    return { id, x, y, len, dep, angle, h, type, roof: 'pitched', ...extra, box: obb(x, y, len, dep, angle) };
}

function landBox(region, box) {
    const c = Math.cos(box.angle), s = Math.sin(box.angle);
    for (const [u, v] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if (waterAt(region, box.x + u * box.hx * c - v * box.hy * s, box.y + u * box.hx * s + v * box.hy * c)) return false;
    }
    return true;
}

/**
 * Every building of a town, placed along both sides of its streets: shops and tall terraces in the middle,
 * terraces further out and detached houses at the edge; a church near the centre; warehouses in cities.
 * Avoids roads, water, yards (`world.reserved`) and other buildings. Deterministic per town.
 */
export function generateTownBuildings(world, town) {
    const { region, graph } = world;
    const rng = seededRng(hashSeed(region.seed, 'buildings', town.id));
    const hash = createSpatialHash(24);
    const out = [];
    const reserved = world.reservedNear(town.x, town.y, town.radius * 1.3);
    const cornish = west(region, town.x);
    const walls = cornish ? CORNISH_WALLS : DEVON_WALLS;
    const fits = b => {
        if (!landBox(region, b.box)) return false;
        if (nearestTown(region, b.x, b.y).town !== town) return false;
        if (!clearOfRoads(graph, b.box, 1.5)) return false;
        for (const r of reserved) if (sat(r, b.box)) return false;
        for (const o of hash.query(b.box)) if (sat(o.box, b.box)) return false;
        return true;
    };
    const add = b => { hash.insert(b); out.push(b); };
    const edges = graph.edges.filter(e => e.town === town.id && e.cls !== 'access').sort((a, b) => a.id - b.id);

    // a church near the centre
    let churchDone = false;
    for (const e of edges) {
        if (churchDone) break;
        const m = pointAt(e.pts, e.len / 2);
        if (Math.hypot(m.x - town.x, m.y - town.y) > town.radius * 0.5) continue;
        for (const side of [1, -1]) {
            const b = plot(e, e.len / 2, side, 22, 11, 9, 'church', { tower: true, wall: cornish ? '#9e9a90' : '#b9ad96', roofCol: SLATE[0] });
            if (fits(b)) { add(b); churchDone = true; break; }
        }
    }

    for (const e of edges) {
        const half = (ROAD_CLASS[e.cls]?.width ?? 7) / 2;
        for (const side of [1, -1]) {
            let d = range(rng, 3, 8);
            while (d < e.len - 4) {
                const m = pointAt(e.pts, d);
                const q = Math.hypot(m.x - town.x, m.y - town.y) / town.radius;
                const spec = choosePlot(rng, town, q, walls, cornish);
                if (d + spec.len > e.len - 3) break;
                const b = plot(e, d + spec.len / 2, side, spec.len, spec.dep, spec.h, spec.type, spec.extra, half);
                if (fits(b)) { add(b); d += spec.len + spec.gap; } else d += 3;
            }
        }
    }
    out.forEach((b, k) => { b.id = `${town.id}-${k}`; b.town = town.id; });
    return out;

    function plot(e, along, side, len, dep, h, type, extra, half = (ROAD_CLASS[e.cls]?.width ?? 7) / 2) {
        const p = pointAt(e.pts, along);
        const nx = -Math.sin(p.angle) * side, ny = Math.cos(p.angle) * side;
        const set = half + 2 + dep / 2;
        const b = building('', p.x + nx * set, p.y + ny * set, len, dep, p.angle, h, type, extra);
        b.door = { x: p.x + nx * (half + 0.6), y: p.y + ny * (half + 0.6) };
        b.edge = e.id; b.along = along; b.side = side;
        return b;
    }
}

function choosePlot(rng, town, q, walls, cornish) {
    const village = town.size === 'village';
    const roofCol = village && chance(rng, 0.3) ? THATCH : chance(rng, cornish ? 0.85 : 0.6) ? pick(rng, SLATE) : pick(rng, TILE);
    const wall = pick(rng, walls);
    if (town.size === 'city' && q > 0.45 && q < 0.95 && chance(rng, 0.08)) {
        return { type: 'warehouse', len: range(rng, 20, 30), dep: range(rng, 14, 18), h: range(rng, 7, 9), gap: range(rng, 3, 6), extra: { roof: 'flat', wall: pick(rng, ['#8e7d6c', '#9b8b7a', '#7f7368']), roofCol: '#5c5f62' } };
    }
    if (q < (village ? 0.4 : 0.32)) {
        if (chance(rng, 0.1)) return { type: 'pub', len: range(rng, 10, 13), dep: range(rng, 9, 11), h: range(rng, 7, 9), gap: range(rng, 0.5, 2), extra: { wall, roofCol } };
        return { type: 'shop', len: range(rng, 7, 11), dep: range(rng, 9, 12), h: range(rng, 7, village ? 8 : 11), gap: range(rng, 0, 1.5), extra: { wall, roofCol, roof: chance(rng, 0.3) ? 'flat' : 'pitched' } };
    }
    if (q < 0.78 && !village) {
        const n = intRange(rng, 3, 6);
        return { type: 'terrace', len: n * 5.5, dep: 8, h: range(rng, 6, 8), gap: range(rng, 2, 5), extra: { wall, roofCol, homes: n } };
    }
    return { type: 'house', len: range(rng, 8, 11), dep: range(rng, 7, 9), h: range(rng, 5.5, 7), gap: range(rng, 5, 12), extra: { wall, roofCol } };
}

// ---- Chunks --------------------------------------------------------------------------------------------------

const FIELD_COLOURS = ['#7fa354', '#6f9a4a', '#8bb05e', '#94a85a', '#a9a35f', '#c9b56b', '#9c8d55', '#7d9b52', '#86a85a'];

/**
 * Ground detail for one chunk: field patchwork with hedgerows outside towns, trees (woods follow a noise
 * field), granite tors on the moors, plus the buildings centred in it and the road edges crossing it.
 */
export function generateChunk(world, i, j) {
    const { region, graph } = world;
    const S = CHUNK_SIZE;
    const x0 = i * S, y0 = j * S, cx = x0 + S / 2, cy = y0 + S / 2;
    const rng = seededRng(hashSeed(region.seed, 'chunk', i, j));
    const near = nearestTown(region, cx, cy);
    const inTown = near.town && Math.hypot(near.town.x - cx, near.town.y - cy) < near.town.radius + S * 0.6;
    const moor = moorAt(region, cx, cy);
    const buildings = world.buildingsInRect(x0, y0, x0 + S, y0 + S);
    const blockers = world.buildingsInRect(x0 - 40, y0 - 40, x0 + S + 40, y0 + S + 40).map(b => b.box);
    for (const z of world.reservedNear(cx, cy, S)) blockers.push(z);

    // fields: a jittered grid; points on the chunk border stay put so neighbouring chunks meet
    const fields = [];
    const hedges = [];
    if (!inTown && !moor) {
        const nx = intRange(rng, 2, 3), ny = intRange(rng, 2, 3);
        const P = [];
        for (let a = 0; a <= nx; a++) {
            P[a] = [];
            for (let b = 0; b <= ny; b++) {
                const edgeA = a === 0 || a === nx, edgeB = b === 0 || b === ny;
                P[a][b] = [x0 + (a / nx) * S + (edgeA ? 0 : range(rng, -12, 12)), y0 + (b / ny) * S + (edgeB ? 0 : range(rng, -12, 12))];
            }
        }
        for (let a = 0; a < nx; a++) {
            for (let b = 0; b < ny; b++) {
                const quad = [...P[a][b], ...P[a + 1][b], ...P[a + 1][b + 1], ...P[a][b + 1]];
                let ok = true;
                for (let k = 0; k < 8; k += 2) if (waterAt(region, quad[k], quad[k + 1]) || moorAt(region, quad[k], quad[k + 1])) ok = false;
                if (!ok) continue;
                const shadeN = valueNoise(region.seed + 7, (quad[0] + quad[4]) / 900, (quad[1] + quad[5]) / 900);
                fields.push({ pts: quad, colour: FIELD_COLOURS[Math.floor((shadeN * 0.6 + rng() * 0.4) * FIELD_COLOURS.length) % FIELD_COLOURS.length] });
                hedges.push(quad);
            }
        }
    }

    // trees: woods where the noise is high, scattered hedge trees elsewhere, a few garden trees in towns
    const trees = [];
    const wood = valueNoise(region.seed + 3, cx / 420, cy / 420);
    const count = inTown ? 6 : moor ? 3 : wood > 0.64 ? 70 : wood > 0.52 ? 22 : 9;
    for (let k = 0; k < count; k++) {
        const x = x0 + rng() * S, y = y0 + rng() * S;
        const r = range(rng, 2.2, 4.2);
        const t = { x, y, r, h: r * range(rng, 1.8, 2.6), kind: chance(rng, 0.2) ? 'conifer' : 'broadleaf', tone: rng() };
        if (waterAt(region, x, y)) continue;
        const box = obb(x, y, 2 * r, 2 * r, 0);
        if (!clearOfRoads(graph, box, 0.5)) continue;
        if (blockers.some(bx => sat(bx, box))) continue;
        trees.push(t);
    }

    // heather and gorse on the moor
    const patches = [];
    if (moor) {
        for (let k = 0; k < 10; k++) {
            const x = x0 + rng() * S, y = y0 + rng() * S;
            if (moorAt(region, x, y) && !waterAt(region, x, y)) patches.push({ x, y, rx: range(rng, 6, 18), ry: range(rng, 4, 10), a: rng() * Math.PI, gorse: chance(rng, 0.3) });
        }
    }

    // granite tors on the moor
    const rocks = [];
    if (moor && chance(rng, 0.35)) {
        const tx = x0 + range(rng, 30, S - 30), ty = y0 + range(rng, 30, S - 30);
        for (let k = 0; k < intRange(rng, 3, 6); k++) {
            const r = { x: tx + range(rng, -10, 10), y: ty + range(rng, -10, 10), len: range(rng, 4, 9), dep: range(rng, 3, 7), h: range(rng, 2, 6), angle: rng() * Math.PI };
            r.box = obb(r.x, r.y, r.len, r.dep, r.angle);
            if (!waterAt(region, r.x, r.y) && clearOfRoads(graph, r.box, 2)) rocks.push(r);
        }
    }

    // street lamps along town streets (every ~32 m, alternating sides) and signposts at country junctions
    const lamps = [];
    const signs = [];
    const inChunk = (x, y) => x >= x0 && x < x0 + S && y >= y0 && y < y0 + S;
    for (const id of graph.index.edgesIn(x0, y0, x0 + S, y0 + S)) {
        const e = graph.edges[id];
        if (e.cls !== 'street') continue;
        for (let d = 10, k = 0; d < e.len - 6; d += 32, k++) {
            const p = pointAt(e.pts, d);
            const side = (k + e.id) % 2 ? 1 : -1;
            const off = (ROAD_CLASS.street.width / 2 + 1.1) * side;
            const x = p.x - Math.sin(p.angle) * off, y = p.y + Math.cos(p.angle) * off;
            if (inChunk(x, y) && !waterAt(region, x, y)) lamps.push({ x, y, angle: p.angle + (side > 0 ? -Math.PI / 2 : Math.PI / 2) });
        }
    }
    for (const n of graph.nodes) {
        if (n.edges.length < 3 || n.town || !inChunk(n.x, n.y)) continue;
        const ranks = n.edges.map(id => ROAD_CLASS[graph.edges[id].cls]?.rank ?? 1);
        if (Math.max(...ranks) < 3) continue;
        // on the corner between the first two roads, clear of both
        const a0 = pointAt(graph.edges[n.edges[0]].pts, graph.edges[n.edges[0]].a === n.id ? 6 : graph.edges[n.edges[0]].len - 6);
        const a1 = pointAt(graph.edges[n.edges[1]].pts, graph.edges[n.edges[1]].a === n.id ? 6 : graph.edges[n.edges[1]].len - 6);
        const mx = (a0.x + a1.x) / 2 - n.x, my = (a0.y + a1.y) / 2 - n.y;
        const ml = Math.hypot(mx, my) || 1;
        signs.push({ x: n.x + (mx / ml) * 9, y: n.y + (my / ml) * 9, angle: Math.atan2(my, mx), node: n.id });
    }

    const colliders = [
        ...buildings.map(b => ({ box: b.box, kind: 'building', ref: b })),
        ...trees.map(t => ({ box: obb(t.x, t.y, 0.9, 0.9, 0), kind: 'tree', ref: t })),
        ...rocks.map(r => ({ box: r.box, kind: 'rock', ref: r })),
    ];
    return {
        i, j, x0, y0, moor: !!moor, town: inTown ? near.town.id : null,
        buildings, fields, hedges, trees, rocks, patches, lamps, signs, colliders,
        edges: [...graph.index.edgesIn(x0, y0, x0 + S, y0 + S)].sort((a, b) => a - b),
    };
}
