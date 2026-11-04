// Downloads raw OpenStreetMap data for the Delivery Driver region from Overpass into .cache/osm/ (gitignored).
//
//   node scripts/bake-roads/fetch-osm.mjs [--check] [--tile 0.25] [--only main|towns] [--endpoint URL]
//
// Two kinds of request, both cached one file per request and never re-requested once cached:
//   main-<i>-<j>.json  region-wide grid tiles: motorway..unclassified (+links), signal/mini-roundabout nodes, ferries,
//                      coastline, rivers and tidal water
//   town-<id>.json     residential/living_street/service ways, signal and mini-roundabout nodes around one town
// Etiquette: descriptive User-Agent, sequential requests with a pause, exponential back-off on 429/5xx, mirrors.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE, USER_AGENT, loadSeed, sleep, townBoxes } from './common.mjs';

const DIR = resolve(CACHE, 'osm');
const ENDPOINTS = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const MAIN = 'motorway|trunk|primary|secondary|tertiary|unclassified|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
const MINOR = 'residential|living_street|service';
const PAUSE_MS = 2500;

const bbox = b => `${b.south.toFixed(5)},${b.west.toFixed(5)},${b.north.toFixed(5)},${b.east.toFixed(5)}`;

function mainQuery(b) {
    const bb = bbox(b);
    return `[out:json][timeout:240];(
  way["highway"~"^(${MAIN})$"](${bb});
  node["highway"~"^(traffic_signals|mini_roundabout)$"](${bb});
  way["route"="ferry"](${bb});
  way["natural"="coastline"](${bb});
  way["waterway"="river"](${bb});
  way["natural"="water"]["tidal"="yes"](${bb});
);out geom tags;`;
}
function townQuery(b) {
    const bb = bbox(b);
    return `[out:json][timeout:120];(
  way["highway"~"^(${MINOR})$"](${bb});
  node["highway"~"^(traffic_signals|mini_roundabout)$"](${bb});
);out geom tags;`;
}

export function plan(seed, tileDeg) {
    const { north, south, west, east } = seed.bounds;
    const jobs = [];
    const ni = Math.ceil((east - west) / tileDeg - 1e-9), nj = Math.ceil((north - south) / tileDeg - 1e-9);
    for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) {
        jobs.push({ name: `main-${i}-${j}`, kind: 'main', box: { west: west + i * tileDeg, east: Math.min(east, west + (i + 1) * tileDeg), south: south + j * tileDeg, north: Math.min(north, south + (j + 1) * tileDeg) } });
    }
    for (const b of townBoxes(seed)) jobs.push({ name: `town-${b.id}`, kind: 'towns', box: b });
    return jobs;
}

const file = job => resolve(DIR, `${job.name}.json`);

async function request(query, endpointOverride) {
    const endpoints = endpointOverride ? [endpointOverride] : ENDPOINTS;
    let wait = 10000;
    for (let attempt = 0; attempt < 12; attempt++) {
        const url = endpoints[attempt % endpoints.length];
        try {
            const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query), signal: AbortSignal.timeout(300000) });
            const text = await res.text();
            if (res.ok && text.startsWith('{')) {
                const json = JSON.parse(text);
                if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark)) throw new Error('overpass remark: ' + json.remark);
                return text;
            }
            console.warn(`  ${url} -> HTTP ${res.status}; retry in ${wait / 1000}s`);
        } catch (e) {
            console.warn(`  ${url} -> ${e.message}; retry in ${wait / 1000}s`);
        }
        await sleep(wait);
        wait = Math.min(wait * 2, 120000);
    }
    throw new Error('giving up after repeated failures');
}

const countWays = path => {
    const raw = readFileSync(path, 'utf8');
    const j = JSON.parse(raw);
    return { ways: j.elements.filter(e => e.type === 'way').length, nodes: j.elements.filter(e => e.type === 'node').length, bytes: raw.length };
};

async function main() {
    const args = process.argv.slice(2);
    const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
    const seed = loadSeed();
    let jobs = plan(seed, +opt('--tile', 0.25));
    const only = opt('--only', null);
    if (only) jobs = jobs.filter(j => j.kind === only);
    mkdirSync(DIR, { recursive: true });

    if (args.includes('--check')) {
        let missing = 0, total = 0, empty = 0;
        for (const j of jobs) {
            if (!existsSync(file(j))) { console.log(`MISSING ${j.name}`); missing++; continue; }
            const c = countWays(file(j));
            total += c.bytes;
            // sea-only tiles legitimately have no roads; town tiles must have ways
            if (!c.ways) { console.log(`EMPTY   ${j.name} (0 ways)`); if (j.kind === 'towns') empty++; } else console.log(`ok      ${j.name} ${c.ways} ways ${c.nodes} nodes ${(c.bytes / 1e6).toFixed(2)} MB`);
        }
        console.log(`\n${jobs.length} tiles: ${jobs.length - missing} cached, ${missing} missing, ${empty} town tiles with no ways; ${(total / 1e6).toFixed(1)} MB raw`);
        process.exitCode = missing || empty ? 1 : 0;
        return;
    }

    let done = 0;
    for (const j of jobs) {
        done++;
        if (existsSync(file(j))) continue;
        console.log(`[${done}/${jobs.length}] fetching ${j.name}`);
        const text = await request(j.kind === 'main' ? mainQuery(j.box) : townQuery(j.box), opt('--endpoint', null));
        writeFileSync(file(j) + '.part', text);
        renameSync(file(j) + '.part', file(j));
        await sleep(PAUSE_MS);
    }
    console.log('fetch complete; run with --check to verify');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
