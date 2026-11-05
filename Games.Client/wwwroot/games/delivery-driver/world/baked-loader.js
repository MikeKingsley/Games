// Loads the baked road data (world/seed/baked/, written by scripts/bake-roads/bake.mjs) into the structures the world
// builder needs. `decodeBaked` is pure (give it parsed JSON); `fetchBaked` is the browser loader; Node callers (tests,
// the validator) read the files with fs and call `decodeBaked` themselves.
//
// Loading is tile based: the manifest lists the main network and one street tile per town. For now every tile loads
// at start (the router needs the whole main network); `fetchBaked` takes a `tiles` filter so town street tiles can
// become lazy later without touching the callers of `decodeBaked`.
import { decodeTiles, decodeLines } from './baked-format.js';
import { decodeElevation } from './elevation-format.js';

/**
 * Parsed baked files -> {manifest, nodes, edges, coastRings, events, elevation}.
 * `elevationBuf` is the ArrayBuffer of elevation.bin (optional: without it the terrain stays procedural).
 * `tiles` is the parsed tile JSON in manifest order; `coast` the parsed coast.json.
 */
export function decodeBaked(manifest, tiles, coast, elevationBuf = null) {
    const { nodes, edges } = decodeTiles(tiles);
    const coastRings = decodeLines(coast.rings);
    return { manifest, nodes, edges, coastRings, events: manifest.events ?? [], elevation: elevationBuf ? decodeElevation(elevationBuf) : null };
}

/**
 * Splits the coast rings into the mainland (the ring enclosing the largest area, which closes along the region
 * bounds) and the islands (every other ring). Land is inside the mainland or inside an island.
 */
export function splitCoast(rings) {
    let best = -1, bestArea = -1;
    rings.forEach((r, k) => {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < r.length; i += 2) {
            if (r[i] < minX) minX = r[i]; if (r[i] > maxX) maxX = r[i];
            if (r[i + 1] < minY) minY = r[i + 1]; if (r[i + 1] > maxY) maxY = r[i + 1];
        }
        const area = (maxX - minX) * (maxY - minY);
        if (area > bestArea) { bestArea = area; best = k; }
    });
    return { mainland: rings[best] ?? [], islands: rings.filter((_, k) => k !== best) };
}

/** Browser: fetches the manifest, the tiles and the coast from `base` (a URL ending in `/`). */
export async function fetchBaked(base, { tiles: filter = null } = {}) {
    const get = async file => {
        const res = await fetch(new URL(file, base));
        if (!res.ok) throw new Error(`Baked road data: ${file} -> HTTP ${res.status}`);
        return res.json();
    };
    const manifest = await get('manifest.json');
    const wanted = manifest.tiles.filter(t => !filter || filter(t));
    const elevation = manifest.elevation
        ? fetch(new URL(manifest.elevation.file, base)).then(r => { if (!r.ok) throw new Error(`Baked road data: ${manifest.elevation.file} -> HTTP ${r.status}`); return r.arrayBuffer(); })
        : null;
    const [tiles, coast, dem] = await Promise.all([Promise.all(wanted.map(t => get(t.file))), get(manifest.coast), elevation]);
    return decodeBaked({ ...manifest, tiles: wanted }, tiles, coast, dem);
}
