// The world: a region's road network, yards (depots, farms, industry sites), lazily generated town buildings
// and the chunk cache. Everything derives from the region seed, so only player changes need saving.
import { buildRegion, waterAt } from './region.js';
import { buildRoadGraph, clearOfRoads, nearestEdge, refreshJunction, alwaysOpen, ROAD_CLASS } from './roadgraph.js';
import { generateTownBuildings, layoutFarm, layoutSite, findStreetYardSpot } from './generator.js';
import { createChunks } from './chunks.js';
import { gradeRoads } from './terrain.js';
import { createSpatialHash, sat, obb } from '../sim/collision.js';
import { seededRng, hashSeed } from '../engine/rng.js';

export function createWorld(regionOrJson, { chunkCap = 160 } = {}) {
    const region = regionOrJson.towns?.[0]?.radius !== undefined ? regionOrJson : buildRegion(regionOrJson);
    const { graph, farms, sites: outSites } = buildRoadGraph(region);

    const world = {
        region, graph,
        farms: [], sites: [], depots: [], garages: [],
        /** Static obstacles of loaded chunks (buildings, trees, rocks). */
        colliders: createSpatialHash(16),
        townBuildings: new Map(),
    };

    const eager = createSpatialHash(32);   // yard buildings (depots, farms, sites)
    const zones = createSpatialHash(32);   // yard areas that must stay open
    const placedBoxes = [];
    const landOk = b => !waterAt(region, b.x, b.y);

    function addYard(owner) {
        zones.insert({ box: owner.yard.zone, owner });
        placedBoxes.push(owner.yard.zone);
        const kept = [];
        for (const b of owner.buildings) {
            if (!clearOfRoads(graph, b.box, 1) || eager.query(b.box).some(o => sat(o.box, b.box)) || zones.query(b.box).some(z => sat(z.box, b.box))) continue;
            eager.insert(b);
            placedBoxes.push(b.box);
            kept.push(b);
        }
        owner.buildings = kept;
    }

    // depots and in-town sites take a street-side spot first (an access edge joins the yard to the street)
    for (const town of region.towns) {
        const rng = seededRng(hashSeed(region.seed, 'yards', town.id));
        const wanted = [];
        // every town has a depot plot: the home depot is owned at the start, the others can be bought (Phase 8)
        if (town.depot || town.size !== 'village') wanted.push({ id: `depot-${town.id}`, name: `${town.name} Depot`, type: 'depot', town: town.id, home: !!town.depot });
        for (const s of region.sites) if (s.town === town.id) wanted.push({ ...s });
        // a motor garage (fuel and repairs) in every town and in market villages
        if (town.size !== 'village' || town.industries?.includes('market')) wanted.push({ id: `garage-${town.id}`, name: `${town.name} Motor Garage`, type: 'garage', town: town.id, small: true });
        for (const site of wanted) {
            const [depth, width] = site.small ? [16, 22] : [28, 34];
            const spot = findStreetYardSpot(world, town, rng, placedBoxes, depth, width);
            if (!spot) {
                if (placeEdgeOfTown(site, town)) (site.type === 'depot' ? world.depots : site.type === 'garage' ? world.garages : world.sites).push(site);
                continue;
            }
            const street = graph.splitEdge(spot.edge, spot.along);
            const yardNode = graph.addNode(spot.entry.x, spot.entry.y, { kind: site.type === 'depot' ? 'depot' : 'site', town: town.id });
            const access = graph.addEdge(street, yardNode, [street.x, street.y, yardNode.x, yardNode.y], { cls: 'access', name: site.name, town: town.id });
            graph.index.add(access);
            refreshJunction(graph, street);
            Object.assign(site, { node: yardNode.id, x: spot.entry.x, y: spot.entry.y });
            layoutSite(site, spot.entry, spot.ux, spot.uy, depth, width);
            addYard(site);
            (site.type === 'depot' ? world.depots : site.type === 'garage' ? world.garages : world.sites).push(site);
        }
    }
    /** Fallback for a site with no room on its town's streets: a yard just outside town, off the nearest road. */
    function placeEdgeOfTown(site, town) {
        for (let k = 0; k < 144; k++) {
            const a = ((k % 24) / 24) * Math.PI * 2, ring = town.radius + 45 + Math.floor(k / 24) * 60;
            const px = town.x + Math.cos(a) * ring, py = town.y + Math.sin(a) * ring;
            if (waterAt(region, px, py)) continue;
            const near = nearestEdge(graph, px, py, 120, 1919, e => e.cls !== 'lane' && e.cls !== 'access' && e.cls !== 'ferry' && !e.oneway && !e.link && !e.dual && alwaysOpen(e) && !e.bridge && !e.tunnel);
            // the yard mouth keeps clear of the junctions at the ends of the road it opens onto
            if (!near || near.d < 12 || near.along < 10 || near.edge.len - near.along < 10) continue;
            const ux = (px - near.x) / near.d, uy = (py - near.y) / near.d;
            const half = ROAD_CLASS[near.edge.cls].width / 2 + 0.5; // the yard mouth opens at the kerb
            const entry = { x: near.x + ux * half, y: near.y + uy * half };
            const test = layoutSite({ ...site }, entry, ux, uy);
            const all = [test.yard.zone, ...test.buildings.map(b => b.box)];
            if (!clearOfRoads(graph, test.yard.zone, 0) || all.some(b => !clearOfRoads(graph, b, 1, near.edge.id) || !landOk(b) || placedBoxes.some(o => sat(o, b)))) continue;
            const street = graph.splitEdge(near.edge, near.along);
            const yardNode = graph.addNode(entry.x, entry.y, { kind: 'site', town: town.id });
            graph.index.add(graph.addEdge(street, yardNode, [street.x, street.y, entry.x, entry.y], { cls: 'access', name: site.name }));
            refreshJunction(graph, street);
            Object.assign(site, { node: yardNode.id, x: entry.x, y: entry.y });
            layoutSite(site, entry, ux, uy);
            addYard(site);
            return true;
        }
        return false;
    }
    for (const s of outSites) {
        const site = { ...s };
        layoutSite(site, { x: s.x, y: s.y }, s.ux, s.uy);
        addYard(site);
        world.sites.push(site);
    }
    farms.forEach((f, k) => {
        const node = graph.nodes[f.node];
        const farm = layoutFarm(region, { ...f, id: `farm-${k}` }, { x: node.x, y: node.y });
        addYard(farm);
        world.farms.push(farm);
    });

    /** Yard zones and yard buildings within r of a point (obstacles for later generation). */
    world.reservedNear = (x, y, r) => {
        const q = obb(x, y, 2 * r, 2 * r, 0);
        return [...zones.query(q).map(z => z.box), ...eager.query(q).map(b => b.box)];
    };

    world.buildingsOfTown = town => {
        let list = world.townBuildings.get(town.id);
        if (!list) world.townBuildings.set(town.id, (list = generateTownBuildings(world, town)));
        return list;
    };

    /** Buildings whose centre lies in a rectangle (generating town buildings on demand). */
    world.buildingsInRect = (minX, minY, maxX, maxY) => {
        const out = [];
        const inRect = b => b.x >= minX && b.x < maxX && b.y >= minY && b.y < maxY;
        const q = obb((minX + maxX) / 2, (minY + maxY) / 2, maxX - minX, maxY - minY, 0);
        for (const b of eager.query(q)) if (inRect(b)) out.push(b);
        for (const town of region.towns) {
            const r = town.radius * 1.15;
            if (town.x + r < minX || town.x - r > maxX || town.y + r < minY || town.y - r > maxY) continue;
            for (const b of world.buildingsOfTown(town)) if (inRect(b)) out.push(b);
        }
        return out;
    };

    world.yardAt = (x, y) => {
        for (const z of zones.query(obb(x, y, 1, 1, 0))) if (sat(z.box, obb(x, y, 0.5, 0.5, 0))) return z.owner;
        return null;
    };

    world.harbours = buildHarbours();
    for (const h of world.harbours) for (const b of h.walls) world.colliders.insert({ box: b.box, kind: 'rock', ref: b });

    /** Harbours at fishing and dock towns: a quay on the shore, two breakwaters and a few moored boats. */
    function buildHarbours() {
        const out = [];
        for (const town of region.towns) {
            if (!town.industries?.some(i => i === 'fish' || i === 'docks')) continue;
            let best = null;
            for (let k = 0; k < 32; k++) {
                const a = (k / 32) * Math.PI * 2;
                const ux = Math.cos(a), uy = Math.sin(a);
                for (let d = 0; d < town.radius * 1.6; d += 6) {
                    if (waterAt(region, town.x + ux * d, town.y + uy * d) >= 30) {
                        if (!best || d < best.d) best = { d, ux, uy };
                        break;
                    }
                }
            }
            if (!best) continue;
            const { ux, uy } = best;
            const vx = -uy, vy = ux;
            const sx = town.x + ux * best.d, sy = town.y + uy * best.d;
            const along = Math.atan2(vy, vx), out2 = Math.atan2(uy, ux);
            const rng = seededRng(hashSeed(region.seed, 'harbour', town.id));
            const walls = [-1, 1].map(side => ({ x: sx + vx * 18 * side + ux * 14, y: sy + vy * 18 * side + uy * 14, len: 30, dep: 3, h: 2.2, angle: out2, colour: '#8d877b' }));
            const boats = [];
            for (let k = 0; k < 4; k++) {
                const bx = sx + ux * (10 + rng() * 14) + vx * (-11 + k * 7), by = sy + uy * (10 + rng() * 14) + vy * (-11 + k * 7);
                if (waterAt(region, bx, by)) boats.push({ x: bx, y: by, len: 6 + rng() * 3, dep: 2.3, h: 1.2, angle: out2 + (rng() - 0.5) * 0.6, colour: ['#2f5d8a', '#a33', '#e8e2d0', '#2d6a3a'][k % 4], boat: true });
            }
            for (const w of [...walls, ...boats]) w.box = obb(w.x, w.y, w.len, w.dep, w.angle);
            out.push({ town: town.id, x: sx, y: sy, quay: obb(sx - ux * 3, sy - uy * 3, 44, 9, along), walls, boats });
        }
        return out;
    }

    world.practice = buildPractice();

    /**
     * The reversing practice yard, off the map to the east ("up country"): a big concrete apron with three bays
     * along the back and lines of cones to weave through. No roads, no traffic, no clock.
     */
    function buildPractice() {
        const x = region.bounds.maxX + 2500, y = region.bounds.minY + 1500;
        const W = 110, D = 70;
        const ux = 0, uy = -1; // the bays are along the north side; vehicles reverse north into them
        const yard = { zone: obb(x, y, W, D, 0), marker: null, entry: { x, y: y + D / 2 }, ux, uy, depth: D, width: W, angle: -Math.PI / 2 };
        const bays = [-25, 0, 25].map(off => ({ x: x + off, y: y - D / 2 + 1.5, heading: Math.PI / 2 }));
        yard.marker = bays[1];
        const cones = [];
        for (let k = 0; k < 8; k++) cones.push({ x: x - 40 + k * 10, y: y + 12 + (k % 2 ? 3 : -3) });
        for (let k = 0; k < 6; k++) cones.push({ x: x - 34 + k * 2, y: y - 6 }, { x: x + 24 + k * 2, y: y - 6 });
        for (const c of cones) { c.box = obb(c.x, c.y, 0.5, 0.5, 0); c.knocked = false; }
        const practice = { id: 'practice', type: 'practice', name: 'Reversing Practice Yard', x, y, yard, bays, cones, buildings: [] };
        zones.insert({ box: yard.zone, owner: practice });
        for (const c of cones) world.colliders.insert({ box: c.box, kind: 'cone', ref: c });
        return practice;
    }

    /** Everything with a yard and loading marker (depots, sites, farms). */
    world.yards = [...world.depots, ...world.sites, ...world.farms, ...world.garages];
    // the graph is final now: grade the roads (edge.z, node.z) and level the yards (world.terrain, for groundZ)
    gradeRoads(world);
    world.chunks = createChunks(world, { cap: chunkCap });
    return world;
}
