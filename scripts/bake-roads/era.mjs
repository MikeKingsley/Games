// Era rules for the road bake: dates every baked edge (opened / closed / upgrades) so one modern OSM network can be
// played in any year from 1919 to 2025. Pure functions over the bake graph (see bake.mjs), exported for tests.
//
// Precedence for an edge's dates, highest first:
//   1. the curated table (history.json): M5, Tamar Bridge, Exeter bypass, the dualling years of the A30/A38/A361/A380,
//      matched by OSM ref (or name) near the seed's hand-drawn line;
//   2. OSM start_date (a parseable year after 1919);
//   3. class rules: motorways (and slip roads on them) open in the motorway year; carriageways the bake found to be
//      dual start as plain `A` and are dualled in the curated year, else a default year;
//   4. town growth: `street` edges in a town exist from 1919 inside the historic core radius and are dated by
//      distance band outside it (with a deterministic per-edge jitter);
//   5. everything else exists from 1919.
// Finally an edge cannot open before it can be reached: opening years are propagated from the 1919 network
// (minimax over paths), so a street never exists as an island before the road that serves it.
import { TOWN_RADIUS } from '../../Games.Client/wwwroot/games/delivery-driver/world/projection.js';

export const SAMPLE_YEARS = [1919, 1930, 1950, 1970, 1990, 2024];
export const FIRST_YEAR = 1919;

/** A year from an OSM start_date value ("1938", "1978-04", "1930s", "C20" -> null), or null. */
export function parseStartYear(v) {
    if (!v) return null;
    const m = /(?:^|[^\d])(1[5-9]\d\d|20[0-2]\d)(?!\d)/.exec(String(v));
    if (!m || /before|pre|<|\bC\d/i.test(v)) return null;
    const y = +m[1];
    return y > 2025 ? null : y;
}

const refSet = ref => new Set((ref ?? '').split(';').map(r => r.trim()).filter(Boolean));

function polyDist(pts, px, py) {
    let best = Infinity;
    for (let i = 0; i + 3 < pts.length; i += 2) {
        const ax = pts[i], ay = pts[i + 1], dx = pts[i + 2] - ax, dy = pts[i + 3] - ay;
        const l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
        const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
        if (d < best) best = d;
    }
    return best;
}

function pointAlong(pts, f) {
    let total = 0;
    for (let i = 2; i < pts.length; i += 2) total += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    let want = total * f;
    for (let i = 2; i < pts.length; i += 2) {
        const l = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
        if (want <= l || i === pts.length - 2) { const t = l ? want / l : 0; return [pts[i - 2] + t * (pts[i] - pts[i - 2]), pts[i - 1] + t * (pts[i + 1] - pts[i - 1])]; }
        want -= l;
    }
    return [pts[0], pts[1]];
}

function hash(n) {
    let h = Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h ^= h >>> 12;
    return (h >>> 0) / 4294967296;
}

/** Curated events (what the news and the history module report), oldest first. */
export function buildEvents(history) {
    const out = [], seen = new Set();
    for (const r of history.entries) {
        const add = (year, kind, cls) => {
            const key = `${r.id}:${year}:${kind}`;
            if (seen.has(key) || !(year > FIRST_YEAR)) return;
            seen.add(key);
            out.push({ year, kind, name: r.name, road: r.id, cls });
        };
        if (r.opened > 0) add(r.opened, 'opened', r.cls);
        if (r.closed > 0) add(r.closed, 'closed', r.cls);
        for (const u of r.upgrades ?? []) add(u.year, 'upgraded', u.class);
    }
    return out.sort((a, b) => a.year - b.year || a.name.localeCompare(b.name));
}

/** Resolves an entry's seed points ("town id" or [lat, lon]) to a world polyline. */
function entryLine(entry, seed, proj) {
    const pts = [];
    for (const p of entry.points) {
        const ll = typeof p === 'string' ? seed.towns.find(t => t.id === p) : { lat: p[0], lon: p[1] };
        if (!ll) throw new Error(`history entry ${entry.id}: unknown town ${p}`);
        const w = proj.project(ll.lat, ll.lon);
        pts.push(w.x, w.y);
    }
    return pts;
}

/**
 * Writes `opened`, `closed` (Infinity = never), `upgrades`, `tag` onto every edge of the bake graph and
 * `signalsFrom` / `roundaboutFrom` onto signal and roundabout nodes. Dual carriageways are reset to class `A` with an
 * upgrade to `dual`. Returns statistics.
 */
export function applyEra(g, seed, proj, history, { log = () => {} } = {}) {
    const D = history.defaults, T = history.town;
    const stats = { curated: {}, startDate: 0, motorway: 0, links: 0, dual: { curated: 0, default: 0 }, ring: { 0: 0 }, propagated: 0, unmatched: [] };
    const entries = history.entries.filter(e => e.edges !== false).map(e => ({ ...e, line: entryLine(e, seed, proj), refs: new Set(e.refs ?? []) }));
    const townInfo = new Map(seed.towns.map(t => { const c = proj.project(t.lat, t.lon); return [t.id, { x: c.x, y: c.y, r: TOWN_RADIUS[t.size] ?? 100, size: t.size }]; }));
    const edges = [...g.edges.values()];
    const own = new Map(); // edge id -> own opening year

    // 1. curated table
    for (const e of edges) {
        e.opened = 0; e.closed = Infinity; e.upgrades = []; e.tag = null;
        const refs = refSet(e.ref);
        const bridge = (e.segs ?? []).some(s => s === 1);
        const samples = [pointAlong(e.pts, 0.25), pointAlong(e.pts, 0.5), pointAlong(e.pts, 0.75)];
        let best = null, bestScore = Infinity;
        for (const c of entries) {
            const refOk = [...refs].some(r => c.refs.has(r));
            const nameOk = !!c.names && !!e.name && c.names.some(n => e.name.includes(n));
            if (c.names ? !nameOk : !refOk) continue;
            if (c.bridge && !bridge) continue;
            let score;
            if (c.anywhere) score = 0;
            else {
                score = samples.reduce((a, p) => a + polyDist(c.line, p[0], p[1]), 0) / samples.length;
                if (score > (c.corridor ?? D.corridor)) continue;
                if (c.opened || c.closed) score *= 0.5; // dated entries beat plain upgrade entries on shared stretches
            }
            if (score < bestScore) { best = c; bestScore = score; }
        }
        if (best) {
            e.tag = best.id;
            e.opened = best.opened ?? 0;
            e.closed = best.closed ?? Infinity;
            if (e.cls === 'dual') for (const u of best.upgrades ?? []) e.upgrades.push({ year: u.year, class: u.class });
            e.curated = true;
            stats.curated[best.id] = (stats.curated[best.id] ?? 0) + 1;
        }
    }

    // 2. OSM start_date, 3. class rules, 4. town growth
    for (const e of edges) {
        if (!e.curated && e.startYear > FIRST_YEAR) { e.opened = e.startYear; e.dated = true; stats.startDate++; }
        if (!e.curated && !e.dated && e.cls === 'M') { e.opened = D.motorwayOpened; stats.motorway++; }
    }
    for (const e of edges) {
        if (e.curated || e.dated || !e.link || e.cls === 'M') continue;
        let year = Infinity;
        for (const nid of [e.a, e.b]) for (const id of g.nodes.get(nid).edges) {
            const f = g.edges.get(id);
            if (f.cls === 'M') year = Math.min(year, f.opened);
        }
        if (year < Infinity) { e.opened = year; e.dated = true; stats.links++; }
    }
    for (const e of edges) {
        if (e.cls === 'dual' && !e.upgrades.length) {
            const year = Math.max(e.opened, e.town ? D.dualUpgradeTown : D.dualUpgrade);
            e.upgrades.push({ year, class: 'dual' });
            stats.dual.default++;
        } else if (e.cls === 'dual') stats.dual.curated++;
        if (e.cls === 'dual') e.cls = 'A'; // base class; the upgrade makes it `dual`
        if (e.curated || e.dated || e.cls !== 'street' || !e.town || refSet(e.ref).size) continue;
        const t = townInfo.get(e.town);
        if (!t) continue;
        const [mx, my] = pointAlong(e.pts, 0.5);
        const f = Math.hypot(mx - t.x, my - t.y) / t.r;
        const core = T.coreFraction[t.size] ?? 0.5;
        if (f <= core) { stats.ring[0]++; continue; }
        const band = Math.min(T.bandYears.length - 1, Math.floor(((f - core) / (1 - core)) * T.bandYears.length));
        const jitter = Math.floor(hash(e.osm ?? Math.round(mx * 7 + my * 13)) * (2 * T.jitter + 1)) - T.jitter;
        e.opened = Math.max(FIRST_YEAR + 1, T.bandYears[band] + jitter);
        stats.ring[T.bandYears[band]] = (stats.ring[T.bandYears[band]] ?? 0) + 1;
    }

    // 5. nothing opens before it can be reached from the 1919 network
    for (const e of edges) own.set(e.id, e.opened);
    stats.propagated = propagateOpening(g, own);
    for (const e of edges) e.opened = own.get(e.id);
    for (const e of edges) for (const u of e.upgrades) u.year = Math.max(u.year, e.opened);

    // junction eras
    for (const n of g.nodes.values()) {
        if (n.junction === 'signals') n.signalsFrom = D.signalsFrom;
        if (n.junction === 'roundabout') n.roundaboutFrom = n.mini ? D.miniRoundaboutFrom : D.roundaboutFrom;
    }

    for (const c of entries) if (!stats.curated[c.id] && !c.anywhere) stats.unmatched.push(c.id);
    for (const e of edges) { delete e.curated; delete e.dated; }
    const byYear = {};
    for (const e of edges) { const k = e.opened ? `${Math.floor(e.opened / 10) * 10}s` : 'always'; byYear[k] = (byYear[k] ?? 0) + 1; }
    stats.openedByDecade = byYear;
    log('era', stats);
    return stats;
}

/**
 * Minimax propagation: nodes of the biggest component of the edges open in 1919 are reached in 1919; any other node
 * is reached when the first connecting path is open. An edge opens no earlier than the earlier-reached of its ends.
 * Mutates `own` (edge id -> year); returns how many edges were pushed later.
 */
function propagateOpening(g, own) {
    // root: the biggest component of 1919 edges
    const parent = new Map();
    const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (const e of g.edges.values()) {
        if (own.get(e.id) > FIRST_YEAR) continue;
        for (const id of [e.a, e.b]) if (!parent.has(id)) parent.set(id, id);
        parent.set(find(e.a), find(e.b));
    }
    const size = new Map();
    for (const id of parent.keys()) size.set(find(id), (size.get(find(id)) ?? 0) + 1);
    let root = null, rs = 0;
    for (const [r, s] of size) if (s > rs) { root = r; rs = s; }
    const reach = new Map();
    const heap = [];
    const push = (k, id) => { heap.push([k, id]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => {
        const top = heap[0], last = heap.pop();
        if (heap.length) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                if (m === i) break;
                [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
            }
        }
        return top;
    };
    for (const id of parent.keys()) if (find(id) === root) { reach.set(id, 0); push(0, id); }
    while (heap.length) {
        const [k, id] = pop();
        if (k > (reach.get(id) ?? Infinity)) continue;
        for (const eid of g.nodes.get(id).edges) {
            const e = g.edges.get(eid), o = e.a === id ? e.b : e.a;
            const cand = Math.max(k, own.get(eid));
            if (cand < (reach.get(o) ?? Infinity)) { reach.set(o, cand); push(cand, o); }
        }
    }
    let moved = 0;
    for (const e of g.edges.values()) {
        const r = Math.min(reach.get(e.a) ?? Infinity, reach.get(e.b) ?? Infinity);
        if (r < Infinity && r > own.get(e.id)) { own.set(e.id, r); moved++; }
    }
    return moved;
}

/**
 * For each year: every town centre (nearest node with an open edge) must lie in the main network (the biggest
 * component of open edges). Returns [{year, town, reason}] problems; empty means connected.
 */
export function checkEraConnectivity(g, seed, proj, years = SAMPLE_YEARS) {
    const problems = [];
    const centres = seed.towns.map(t => ({ id: t.id, ...proj.project(t.lat, t.lon), r: TOWN_RADIUS[t.size] ?? 100 }));
    const report = [];
    for (const year of years) {
        const parent = new Map();
        const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
        for (const e of g.edges.values()) {
            if (!(year >= e.opened && year < e.closed)) continue;
            for (const id of [e.a, e.b]) if (!parent.has(id)) parent.set(id, id);
            parent.set(find(e.a), find(e.b));
        }
        const size = new Map();
        for (const id of parent.keys()) size.set(find(id), (size.get(find(id)) ?? 0) + 1);
        let main = null, ms = 0;
        for (const [r, s] of size) if (s > ms) { main = r; ms = s; }
        const open = [...parent.keys()].map(id => g.nodes.get(id));
        let failed = 0;
        for (const c of centres) {
            let best = null, bd = Infinity;
            for (const n of open) { const d = Math.hypot(n.x - c.x, n.y - c.y); if (d < bd) { bd = d; best = n; } }
            if (!best) { problems.push({ year, town: c.id, reason: 'no open road' }); failed++; continue; }
            if (bd > c.r * 2) { problems.push({ year, town: c.id, reason: `nearest open road is ${bd.toFixed(0)} m away` }); failed++; continue; }
            if (find(best.id) !== main) { problems.push({ year, town: c.id, reason: `centre node ${best.id} is not in the main network` }); failed++; }
        }
        report.push({ year, nodes: ms, components: size.size, towns: centres.length - failed });
    }
    return { problems, report };
}
