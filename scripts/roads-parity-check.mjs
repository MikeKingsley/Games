// Plan 0012 phase 2: read-only parity measurements of the real map's roads (no game code is changed). Builds the full game
// world like scripts/validate-roads.mjs, then for each town reports three things the mesh depends on:
//   sink-float     road surface height (edge.z + LAYER.surface) vs the ground under it (world/terrain.js groundZ, hint false), sampled
//                  every SAMPLE m along each open ground-level edge, outside its junction trims and deck/tunnel zones, at the
//                  centreline, the kerb edge and the pavement outer edge. float: road above ground by more than --tol; sink: ground
//                  above the road by more than --tol. Reports counts, max and worst spot.
//   drawn-ground   (plan 0012 phase 3) the same samples against the ground MESH as drawn (render/gl/terrain-mesh.js: the 10 m chunk grid, held
//                  under the road by roadFloorNear, bilinear in a cell), not the exact groundZ. sink: mesh ground above the road surface by more than
//                  --tol (ground hiding the road: a defect). gap: road above mesh ground by more than --tol + 0.21 (the 0.15 m the mesh is held under
//                  the deck plus the 0.06 m surface layer, so a plain road reads 0): an embankment or an unfilled slope, reported as a count only.
//   junction-z     per junction node (3+ open arms): node.z (the junction surface) vs each arm's road height where the arm's strip
//                  starts (roadHeightAt at the layout trim). Counts arms off by more than --tol, max and worst node.
//   marking-pavement  what render/gl/road-mesh.js draws vs what world/lane-profile.js laneProfile() says. Mesh rules are re-derived
//                  from the same inputs (see drawnFeatures below), not read from vertex data. Counts edges drawing something the
//                  profile says no (extra) or missing something it says yes (missing), per feature.
//
//   node scripts/roads-parity-check.mjs [--area exeter,plymouth,truro,penzance] [--year 2024] [--radius 1500] [--step 6]
//        [--tol 0.15] [--json] [--out <dir>]
//
// --area    comma list of town ids (default: the four default-set towns)    --year  road year (default 2024)
// --radius  half-size of each town's box in metres (default 1500)           --step  sample spacing along an edge, m (default 6)
// --tol     sink/float and junction mismatch tolerance in metres (default 0.15)
// --json    print the full report to stdout as JSON (the summary table otherwise)
// --out     directory for baseline.json (default _docs/qa/roads-parity); always written
// Exit code is 0 unless the script fails to run or a town has no edges (empty result).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(here, '../Games.Client/wwwroot/games/delivery-driver');
const game = p => import(pathToFileURL(`${GAME}/${p}`).href);

const { edgeOpen, edgeWidth, edgeClass } = await game('world/roadgraph.js');
const { groundZ, roadHeightAt } = await game('world/terrain.js');
const { layoutJunction, trimFor, edgeSpline } = await game('world/junction-layout.js');
const { laneProfile } = await game('world/lane-profile.js');
const { LAYER, edgeSamples } = await game('render/gl/road-mesh.js');
const { closestOnPoly } = await game('world/geom.js');
const { CHUNK_SIZE } = await game('config.js');
const { roadFloorNear } = await game('render/gl/terrain-mesh.js');
const { chunkHeights } = await game('world/terrain.js');

const toArrayBuffer = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

function parseArgs(argv) {
    const o = { area: 'exeter,plymouth,truro,penzance', year: 2024, radius: 1500, step: 6, tol: 0.15, json: false, out: '_docs/qa/roads-parity' };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--area') o.area = argv[++i];
        else if (a === '--year') o.year = +argv[++i];
        else if (a === '--radius') o.radius = +argv[++i];
        else if (a === '--step') o.step = +argv[++i];
        else if (a === '--tol') o.tol = +argv[++i];
        else if (a === '--json') o.json = true;
        else if (a === '--out') o.out = argv[++i];
        else throw new Error(`unknown argument ${a}`);
    }
    return o;
}

async function loadWorld() {
    const { createWorld } = await game('world/world.js');
    const { decodeBaked } = await game('world/baked-loader.js');
    const dir = `${GAME}/world/seed/baked`;
    const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
    const baked = decodeBaked(manifest, manifest.tiles.map(t => JSON.parse(readFileSync(`${dir}/${t.file}`, 'utf8'))), JSON.parse(readFileSync(`${dir}/${manifest.coast}`, 'utf8')), toArrayBuffer(readFileSync(`${dir}/${manifest.elevation.file}`)));
    const world = createWorld({ ...JSON.parse(readFileSync(`${GAME}/world/seed/sw-england.json`, 'utf8')), baked });
    world.constants = { CHUNK_SIZE };
    return world;
}

const inBox = (box, x, y) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
const edgeInBox = (box, e) => { for (let i = 0; i < e.pts.length; i += 2) if (inBox(box, e.pts[i], e.pts[i + 1])) return true; return false; };

/** True if (x, y) lies on the carriageway of an open road other than `except` (as road-mesh.js onOtherRoad). */
function onOtherRoad(graph, year, x, y, except) {
    for (const sg of graph.index.near(x, y, 12)) {
        const e = graph.edges[sg.edge];
        if (e === except || e.cls === 'ferry' || !edgeOpen(e, year)) continue;
        if (closestOnPoly(e.pts, x, y).d < edgeWidth(e, year) / 2 - 0.3) return true;
    }
    return false;
}

const inZone = (e, d) => !!e.zones?.some(z => d >= z.from - 2 && d <= z.to + 2);
const worstOf = (cur, v, info) => (Math.abs(v) > Math.abs(cur.v) ? { v, ...info } : cur);

/** Sink or float of every open ground-level edge in the box. */
function measureSinkFloat(world, year, box, step, tol) {
    const g = world.graph;
    const r = { edges: 0, samples: 0, tol, float: { count: 0, edges: new Set(), max: 0, worst: null }, sink: { count: 0, edges: new Set(), max: 0, worst: null }, byOffset: {} };
    for (const e of g.edges) {
        if (!edgeOpen(e, year) || !e.z || e.cls === 'ferry' || e.bridge || e.tunnel || !edgeInBox(box, e)) continue;
        const width = edgeWidth(e, year), tA = trimFor(g, e, 'a', year), tB = trimFor(g, e, 'b', year);
        if (e.len - tA - tB < 2) continue;
        const spl = edgeSpline(e);
        if (!spl) continue;
        r.edges++;
        // lateral offsets of the mesh: centreline, outer kerb strip edge, outer edge of the pavement/verge strip
        const offs = { centre: 0, kerb: width / 2 + 0.8, pavement: width / 2 + 0.8 + 1.3 + 0.6 };
        const smp = edgeSamples(e, step);
        for (const s of smp) {
            if (s.d < tA || s.d > e.len - tB || inZone(e, s.d)) continue;
            for (const [name, off] of Object.entries(offs)) {
                const x = s.x + s.ty * off, y = s.y - s.tx * off; // right of travel, as road-mesh offsetSamples
                const roadZ = s.z + LAYER.surface;
                const gz = groundZ(world, x, y, false);
                const diff = roadZ - gz; // > 0 float, < 0 sink
                r.samples++;
                const rec = (r.byOffset[name] ??= { samples: 0, float: 0, sink: 0 });
                rec.samples++;
                const key = { edge: e.id, cls: e.cls, x: +x.toFixed(1), y: +y.toFixed(1), at: name };
                if (diff > tol) { r.float.count++; rec.float++; r.float.edges.add(e.id); if (diff > r.float.max) { r.float.max = diff; r.float.worst = { m: +diff.toFixed(2), ...key }; } }
                else if (-diff > tol) { r.sink.count++; rec.sink++; r.sink.edges.add(e.id); if (-diff > r.sink.max) { r.sink.max = -diff; r.sink.worst = { m: +(-diff).toFixed(2), ...key }; } }
            }
        }
    }
    const fin = k => ({ count: k.count, edges: k.edges.size, max: +k.max.toFixed(3), worst: k.worst });
    return { edges: r.edges, samples: r.samples, tolerance: tol, float: fin(r.float), sink: fin(r.sink), byOffset: r.byOffset };
}

/** Sink and gap of the ground mesh as drawn (see the header) at the centreline, kerb edge and pavement edge of every ground-level edge. */
function measureDrawn(world, year, box, step, tol) {
    const g = world.graph;
    const grids = new Map(), capped = new Map();
    const gridOf = (x, y) => { const ci = Math.floor(x / CHUNK_SIZE), cj = Math.floor(y / CHUNK_SIZE), k = ci + ',' + cj; let gr = grids.get(k); if (!gr) grids.set(k, gr = chunkHeights(world, ci, cj)); return gr; };
    const nodeZ = (gr, gi, gj) => {
        const key = gr.x0 + ',' + gr.y0 + ',' + gi + ',' + gj;
        let v = capped.get(key);
        if (v === undefined) {
            const z = gr.z[gj * 17 + gi];
            const deck = z < 0 ? null : roadFloorNear(world, gr.x0 + gi * gr.step, gr.y0 + gj * gr.step, gr.step * 1.45);
            capped.set(key, v = deck === null ? z : Math.min(z, deck - 0.15));
        }
        return v;
    };
    const meshZ = (x, y) => {
        const gr = gridOf(x, y), fx = Math.max(0, Math.min(16, (x - gr.x0) / gr.step)), fy = Math.max(0, Math.min(16, (y - gr.y0) / gr.step));
        const i = Math.min(15, Math.floor(fx)), j = Math.min(15, Math.floor(fy)), u = fx - i, v = fy - j;
        const a = nodeZ(gr, i, j), b = nodeZ(gr, i + 1, j), c = nodeZ(gr, i, j + 1), d = nodeZ(gr, i + 1, j + 1);
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const r = { samples: 0, sink: { count: 0, edges: new Set(), max: 0, worst: null }, gap: { count: 0, edges: new Set(), max: 0, worst: null }, byOffset: {} };
    for (const e of g.edges) {
        if (!edgeOpen(e, year) || !e.z || e.cls === 'ferry' || e.bridge || e.tunnel || !edgeInBox(box, e)) continue;
        const width = edgeWidth(e, year), tA = trimFor(g, e, 'a', year), tB = trimFor(g, e, 'b', year);
        if (e.len - tA - tB < 2 || !edgeSpline(e)) continue;
        const offs = { centre: 0, kerb: width / 2 + 0.8, pavement: width / 2 + 0.8 + 1.3 + 0.6 };
        for (const s of edgeSamples(e, step)) {
            if (s.d < tA || s.d > e.len - tB || inZone(e, s.d)) continue;
            for (const [name, off] of Object.entries(offs)) {
                const x = s.x + s.ty * off, y = s.y - s.tx * off;
                const diff = s.z + LAYER.surface - meshZ(x, y); // < 0: mesh ground above the road
                r.samples++;
                const rec = (r.byOffset[name] ??= { samples: 0, sink: 0, gap: 0 });
                rec.samples++;
                const key = { edge: e.id, cls: e.cls, x: +x.toFixed(1), y: +y.toFixed(1), at: name };
                if (-diff > tol) { r.sink.count++; rec.sink++; r.sink.edges.add(e.id); if (-diff > r.sink.max) { r.sink.max = -diff; r.sink.worst = { m: +(-diff).toFixed(2), ...key }; } }
                else if (diff > tol + 0.21) { r.gap.count++; rec.gap++; r.gap.edges.add(e.id); if (diff > r.gap.max) { r.gap.max = diff; r.gap.worst = { m: +diff.toFixed(2), ...key }; } }
            }
        }
    }
    const fin = k => ({ count: k.count, edges: k.edges.size, max: +k.max.toFixed(3), worst: k.worst });
    return { samples: r.samples, tolerance: tol, sink: fin(r.sink), gap: fin(r.gap), byOffset: r.byOffset };
}

/** Junction node height vs the road height where each arm's strip starts. */
function measureJunctions(world, year, box, tol) {
    const g = world.graph;
    const r = { junctions: 0, arms: 0, badArms: 0, badNodes: new Set(), max: 0, worst: null, noZ: 0 };
    for (const n of g.nodes) {
        if (!inBox(box, n.x, n.y)) continue;
        const open = n.edges.filter(id => edgeOpen(g.edges[id], year));
        if (open.length < 3) continue;
        const L = layoutJunction(g, n, year);
        if (!L || L.kind === 'end') continue;
        if (n.z === undefined) { r.noZ++; continue; }
        r.junctions++;
        for (const a of L.arms) {
            const e = a.edge;
            if (!e.z) continue;
            const z = roadHeightAt(e, a.end === 'a' ? a.trim : e.len - a.trim);
            const diff = z - n.z;
            r.arms++;
            if (Math.abs(diff) > tol) {
                r.badArms++; r.badNodes.add(n.id);
                if (Math.abs(diff) > r.max) { r.max = Math.abs(diff); r.worst = { m: +diff.toFixed(2), node: n.id, edge: e.id, x: +n.x.toFixed(1), y: +n.y.toFixed(1), kind: L.kind }; }
            }
        }
    }
    return { junctions: r.junctions, arms: r.arms, noZ: r.noZ, tolerance: tol, mismatchedArms: r.badArms, mismatchedNodes: r.badNodes.size, max: +r.max.toFixed(3), worst: r.worst };
}

/** The samples between distances d0 and d1 with interpolated end points, as road-mesh.js trimSamples. */
function trimmed(samples, d0, d1) {
    if (d1 - d0 < 1) return [];
    const out = [];
    const at = (a, c, d) => {
        const f = (d - a.d) / (c.d - a.d || 1), tx = a.tx + (c.tx - a.tx) * f, ty = a.ty + (c.ty - a.ty) * f, l = Math.hypot(tx, ty) || 1;
        return { x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f, d, tx: tx / l, ty: ty / l };
    };
    for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i], c = samples[i + 1];
        if (c.d <= d0 || a.d >= d1) continue;
        if (!out.length) out.push(a.d >= d0 ? a : at(a, c, d0));
        out.push(c.d <= d1 ? c : at(a, c, d1));
    }
    return out;
}

/**
 * What render/gl/road-mesh.js buildEdgeMesh draws on an edge (full detail), re-derived from the same inputs (edge, year,
 * edge.profile, class, town flag) rather than read from vertices. Keep in step with buildEdgeMesh.
 */
function drawnFeatures(world, edge, year, tA, tB) {
    const cls = edgeClass(edge, year);
    const prof = laneProfile(edge, year, edge.profile);
    const spec = !!edge.profile;
    const sides = { ...prof.pavements };
    if (!spec && cls === 'dual' && !edge.town) sides.left = sides.right = true; // rural dual carriageways keep a verge strip
    const structure = !!edge.bridge || !!edge.tunnel;
    const pave = { left: !structure && sides.left, right: !structure && sides.right };
    const blocked = { left: false, right: false }; // dropped on purpose: the whole strip would lie on another carriageway
    // a pavement run is dropped where it would lie on another carriageway at both ends; count a side with no run left as missing
    if (pave.left || pave.right) {
        const width = edgeWidth(edge, year);
        const town = !!edge.town && !edge.link;
        const off = width / 2 + 0.8 + (town ? 0.6 : 0.7);
        const smp = trimmed(edgeSamples(edge), tA, edge.len - tB);
        for (const side of [1, -1]) {
            const key = side < 0 ? 'left' : 'right';
            if (!pave[key]) continue;
            // as road-mesh.js: offset the trimmed samples, then drop the ends that lie on another carriageway
            let run = smp.map(s => ({ x: s.x + s.ty * side * off, y: s.y - s.tx * side * off }));
            while (run.length > 1 && onOtherRoad(world.graph, year, run[0].x, run[0].y, edge)) run = run.slice(1);
            while (run.length > 1 && onOtherRoad(world.graph, year, run[run.length - 1].x, run[run.length - 1].y, edge)) run = run.slice(0, -1);
            if (run.length < 2) { pave[key] = false; blocked[key] = true; }
        }
    }
    const unmarked = (cls === 'lane' || cls === 'access') && !spec;
    const heavy = cls === 'dual' || cls === 'M';
    const lanes = prof.lanesFwd + prof.lanesBack;
    const centre = !unmarked && (heavy ? false : (prof.centreLine || (!spec && edge.dual && !edge.oneway && !prof.singleTrack)));
    const dividers = !unmarked && !heavy && (lanes > 2 || (prof.lanesBack === 0 && lanes >= 2));
    const edgeLines = !unmarked && prof.edgeLines;
    return { prof, cls, pave, blocked, centre, dividers, edgeLines, structure };
}

/** Edges whose drawn markings and pavements differ from the lane profile. */
function measureMarkings(world, year, box) {
    const g = world.graph;
    const out = { edges: 0, pavementBlocked: 0, structureEdgesWithPavementRule: 0, features: {}, examples: {} };
    const bump = (feature, kind, e) => {
        const f = (out.features[feature] ??= { extra: 0, missing: 0 });
        f[kind]++;
        const list = (out.examples[`${feature}:${kind}`] ??= []);
        if (list.length < 5) list.push({ edge: e.id, cls: e.cls, x: +e.pts[0].toFixed(1), y: +e.pts[1].toFixed(1) });
    };
    for (const e of g.edges) {
        if (!edgeOpen(e, year) || e.cls === 'ferry' || !edgeInBox(box, e)) continue;
        const tA = trimFor(g, e, 'a', year), tB = trimFor(g, e, 'b', year);
        if (e.len - tA - tB < 1) continue;
        out.edges++;
        const d = drawnFeatures(world, e, year, tA, tB);
        const p = d.prof;
        // pavements, per side
        for (const side of ['left', 'right']) {
            // rule: the profile's sides, except a bridge or tunnel deck carries none (parapets instead) and a rural dual
            // carriageway without a spec keeps its grassy verge strip on both sides
            const want = !d.structure && (p.pavements[side] || (!e.profile && d.cls === 'dual' && !e.town));
            if (d.structure && p.pavements[side]) out.structureEdgesWithPavementRule++;
            if (d.pave[side] && !want) bump('pavement', 'extra', e);
            else if (!d.pave[side] && want) {
                if (d.blocked[side]) out.pavementBlocked++; // intended: pavements never run over another carriageway
                else bump('pavement', 'missing', e);
            }
        }
        // centre line (two-lane two-way roads only, per the profile; the mesh also draws one on a two-way dual-flag A/B road)
        if (d.centre && !p.centreLine) bump('centreLine', 'extra', e);
        else if (!d.centre && p.centreLine && !(d.cls === 'lane' || d.cls === 'access') && d.cls !== 'dual' && d.cls !== 'M') bump('centreLine', 'missing', e);
        // single-track roads carry no centre line
        if (p.singleTrack && d.centre) bump('singleTrackCentreLine', 'extra', e);
        // lane dividers (multi-lane or multi-lane one-way): drawn only when the profile has 3+ lanes or 2+ lanes one-way
        const wantDividers = p.lanesFwd + p.lanesBack > 2 || (p.lanesBack === 0 && p.lanesFwd >= 2);
        if (d.dividers && !wantDividers) bump('laneDividers', 'extra', e);
        else if (!d.dividers && wantDividers && d.cls !== 'dual' && d.cls !== 'M' && d.cls !== 'lane' && d.cls !== 'access') bump('laneDividers', 'missing', e);
        // edge lines
        if (d.edgeLines && !p.edgeLines) bump('edgeLines', 'extra', e);
        else if (!d.edgeLines && p.edgeLines && !(d.cls === 'lane' || d.cls === 'access')) bump('edgeLines', 'missing', e);
    }
    const total = { extra: 0, missing: 0 };
    for (const f of Object.values(out.features)) { total.extra += f.extra; total.missing += f.missing; }
    return { ...out, total };
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const t0 = Date.now();
    const world = await loadWorld();
    const report = { year: opts.year, tolerance: opts.tol, step: opts.step, radius: opts.radius, assumptions: [
        'sink/float compares edge.z + LAYER.surface with groundZ(world, x, y, false) (the exact ground blend), not the interpolated chunk ground mesh grid',
        'sink/float samples ground-level edges outside junction trims and deck/tunnel zones, at centreline, kerb edge and pavement outer edge',
        'marking and pavement presence is re-derived from road-mesh.js rules (full detail) and laneProfile, not read from vertex data',
    ], towns: {} };
    let empty = false;
    for (const id of opts.area.split(',')) {
        const t = world.region.towns.find(q => q.id === id);
        if (!t) throw new Error(`unknown town "${id}"`);
        const box = { minX: t.x - opts.radius, maxX: t.x + opts.radius, minY: t.y - opts.radius, maxY: t.y + opts.radius };
        const sinkFloat = measureSinkFloat(world, opts.year, box, opts.step, opts.tol);
        const drawn = measureDrawn(world, opts.year, box, opts.step, opts.tol);
        const junctions = measureJunctions(world, opts.year, box, opts.tol);
        const markings = measureMarkings(world, opts.year, box);
        if (!sinkFloat.edges || !junctions.junctions || !markings.edges) empty = true;
        report.towns[id] = { box, sinkFloat, drawn, junctions, markings };
    }
    report.seconds = +((Date.now() - t0) / 1000).toFixed(1);
    mkdirSync(opts.out, { recursive: true });
    writeFileSync(resolve(opts.out, 'baseline.json'), JSON.stringify(report, null, 2));
    if (opts.json) console.log(JSON.stringify(report, null, 2));
    else {
        for (const [id, r] of Object.entries(report.towns)) {
            const s = r.sinkFloat, dr = r.drawn, j = r.junctions, m = r.markings;
            console.log(`\n== ${id} (year ${opts.year}) ==`);
            console.log(`sink/float: ${s.edges} edges, ${s.samples} samples; float ${s.float.count} (${s.float.edges} edges, max ${s.float.max} m); sink ${s.sink.count} (${s.sink.edges} edges, max ${s.sink.max} m)`);
            console.log(`drawn ground: ${dr.samples} samples; ground hides road ${dr.sink.count} (${dr.sink.edges} edges, max ${dr.sink.max} m); road above ground ${dr.gap.count} (${dr.gap.edges} edges, max ${dr.gap.max} m)`);
            console.log(`junction z: ${j.junctions} junctions, ${j.arms} arms; ${j.mismatchedArms} arms off by > ${opts.tol} m (${j.mismatchedNodes} nodes, max ${j.max} m)`);
            console.log(`marking/pavement: ${m.edges} edges; extra ${m.total.extra}, missing ${m.total.missing} ${JSON.stringify(m.features)}`);
        }
        console.log(`\nwrote ${resolve(opts.out, 'baseline.json')} in ${report.seconds}s`);
    }
    process.exitCode = empty ? 1 : 0;
}

await main();
