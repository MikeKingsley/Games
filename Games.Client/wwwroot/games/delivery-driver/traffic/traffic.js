// Living traffic: era vehicles that follow lanes on the road graph (on the left), keep their distance, give way
// at junctions (minor to major roads; signals from the 1930s; roundabouts from the 1960s), and spawn/despawn around
// the player. They slow up hills by their power to weight (carts, bicycles, early cars, buses and tractors crawl)
// and hold back down steep ones, and ride the graded road profile (z, pitch) for drawing.
// Pure logic: positions come from the graph, randomness from a seeded RNG.
import { seededRng, pick, range } from '../engine/rng.js';
import { edgeSpeed, edgeClass, edgeOpen, laneOffset, lanePoint, junctionType, ROAD_CLASS, nearestEdge } from '../world/roadgraph.js';
import { roadHeightAt, roadGradeAt } from '../world/terrain.js';
import { hillSpeed } from '../sim/slope.js';
import { connectorLayout, connectorBetween, connectorPoint, connectorsConflict, onJunction } from '../world/connectors.js';

const STOP_LINE = 7.5;    // metres before the node centre where give-way traffic waits (where there is no junction layout)
const STOP_GAP = 1.0;     // metres of road between a waiting vehicle's front and the junction mouth (the layout's trim)
const BOX = 6;            // a vehicle within this of the node centre is "in the junction" (where there is no layout)
const LAYER_GAP = 2.5;    // metres of height difference (plus a grade allowance) above which two vehicles are on different levels
const LAYER_SLOPE = 0.14; // allowance per metre between them, so a hill does not split a queue into layers
const LOOK = 45;          // metres ahead an agent watches for vehicles in its lane
const SIGNAL_PHASE = 18;  // seconds per signal phase
const CLAIM_AT = 16;      // metres from the stop line where a vehicle asks for the junction
const SEE = 330;          // metres within which the player can see ahead (no spawning in the forward cone)

/**
 * Era traffic. len/width in metres, vmax m/s; years the type is on the road; weight in the mix; pw: power to
 * weight at the wheels (W/kg), which sets how fast it can climb (a horse and cart or a cyclist crawls up 6%, a
 * 1910s car or a bus slows, later cars barely notice).
 */
export const TRAFFIC_TYPES = {
    cart: { name: 'Horse and cart', len: 5.2, width: 1.7, height: 2, vmax: 3.6, pw: 1.3, from: 1900, to: 1952, mix: [6, 3, 1, 0, 0] },
    bicycle: { name: 'Bicycle', len: 1.8, width: 0.7, height: 1.7, vmax: 4.5, pw: 1.8, from: 1900, to: 2100, mix: [4, 3, 2, 1, 1] },
    tin: { name: 'Motor car', len: 3.8, width: 1.6, height: 1.9, vmax: 11, pw: 7, from: 1908, to: 1938, mix: [4, 2, 0, 0, 0] },
    saloon30: { name: 'Saloon', len: 4.1, width: 1.65, height: 1.6, vmax: 17, pw: 12, from: 1928, to: 1965, mix: [0, 5, 3, 0, 0] },
    bus: { name: 'Motor bus', len: 9, width: 2.4, height: 3, vmax: 13, pw: 5, from: 1922, to: 2100, mix: [1, 1, 1, 1, 1] },
    tractor: { name: 'Tractor', len: 3.4, width: 1.8, height: 2.3, vmax: 6, pw: 3, from: 1925, to: 2100, mix: [1, 1, 2, 1, 1] },
    car50: { name: 'Family car', len: 4.2, width: 1.65, height: 1.5, vmax: 24, pw: 18, from: 1948, to: 1980, mix: [0, 0, 6, 3, 0] },
    car70: { name: 'Hatchback', len: 3.9, width: 1.6, height: 1.4, vmax: 30, pw: 30, from: 1968, to: 2005, mix: [0, 0, 0, 6, 3] },
    car2k: { name: 'Modern car', len: 4.4, width: 1.8, height: 1.5, vmax: 33, pw: 55, from: 1995, to: 2100, mix: [0, 0, 0, 0, 7] },
    vanTraffic: { name: 'Van', len: 5.2, width: 2, height: 2.4, vmax: 28, pw: 20, from: 1955, to: 2100, mix: [0, 0, 1, 2, 2] },
};
/** Each type's climb model for sim/slope.js hillSpeed (per kg). */
const CLIMB = Object.fromEntries(Object.entries(TRAFFIC_TYPES).map(([id, t]) => [id, { power: t.pw, mass: 1, crr: 0.015 }]));

/**
 * An agent's height on the road (the graded profile at its distance along the edge) and the grade it is driving
 * (+ uphill in its direction): sets a.z (a.prevZ keeps the last) and a.pitch, returns the grade.
 */
function rideProfile(a, edge) {
    const d = a.forward ? a.along : edge.len - a.along;
    const grade = roadGradeAt(edge, d) * (a.forward ? 1 : -1);
    a.prevZ = a.z ?? 0;
    a.z = edge.z ? roadHeightAt(edge, d) : 0;
    a.pitch = Math.atan(grade);
    return grade;
}
/**
 * Is `o` on another level than `a` (a bridge over the road `a` is on, a tunnel under it)? Vehicles on different
 * levels never block, yield to or collide with each other. The same edge is always the same level; `dist` (m) lets
 * the height difference of a hill grow with the gap.
 */
export function otherLayer(a, o, dist = 0) {
    if (o.z === undefined || a.z === undefined) return false;
    if (o.edge !== undefined && o.edge === a.edge) return false;
    return Math.abs(o.z - a.z) > LAYER_GAP + LAYER_SLOPE * dist;
}
/** Height and grade of an agent inside a junction: the blend from its height at the mouth to the leaving road's. */
function rideConn(a) {
    const k = a.conn, len = k.c.len;
    a.prevZ = a.z ?? 0;
    a.z = len > 0 ? k.z0 + ((k.z1 - k.z0) * k.s) / len : k.z1;
    const grade = len > 0 ? (k.z1 - k.z0) / len : 0;
    a.pitch = Math.atan(grade);
    return grade;
}
const ERA = year => (year < 1930 ? 0 : year < 1950 ? 1 : year < 1970 ? 2 : year < 1995 ? 3 : 4);
/** Fewer vehicles on the roads in the early years. */
export const densityFor = year => [0.35, 0.55, 0.75, 0.9, 1][ERA(year)];
const PALETTE = [['#1d1d1d', '#2a2a2a', '#3b2f2f', '#2c3a2c'], ['#1d1d1d', '#3b3b5c', '#5a2d2d', '#2d4a3a', '#6a5a3a'], ['#c8c0a8', '#7a2b2b', '#2f4f6f', '#4f6f4f', '#d8d0b8', '#8a8a8a'], ['#c46a2a', '#d8c86a', '#2f6f8f', '#9a2b2b', '#e8e2d0', '#4a7a3a'], ['#c0c4c8', '#1d1d1f', '#f2f2f0', '#2a4f8f', '#8a1f1f', '#6a6e72']];

/** Roads AI vehicles use (not farm lanes, yard access or ferries). */
const drivable = (e, year) => edgeOpen(e, year) && e.cls !== 'lane' && e.cls !== 'access' && e.cls !== 'ferry' && !(edgeClass(e, year) === 'M' && year < 1977);

/** Seconds a vehicle may sit still before it is taken off the road (longer than any signal phase or give-way wait). */
const STUCK_LIMIT = 90;

export function createTraffic(graph, { seed = 1, cap = 16 } = {}) {
    const rng = seededRng(seed);
    const traffic = { agents: [], cap, nextId: 1, time: 0, rng, claims: new Map(), densityScale: 1 };
    const lp = { x: 0, y: 0, angle: 0 }, ahead = { x: 0, y: 0, angle: 0 }, oldP = { x: 0, y: 0, angle: 0 };

    function choose(year) {
        const era = ERA(year);
        const list = Object.entries(TRAFFIC_TYPES).filter(([, t]) => year >= t.from && year < t.to && t.mix[era] > 0);
        let total = list.reduce((s, [, t]) => s + t.mix[era], 0);
        let r = rng() * total;
        for (const [id, t] of list) { r -= t.mix[era]; if (r <= 0) return id; }
        return list[0][0];
    }

    /**
     * Places a new agent on a road 150-280 m from (x, y), never where the player could see it appear: not within
     * `SEE` metres, and not in the cone ahead of `heading` (the camera looks that way). Returns it, or null if no room.
     */
    traffic.spawnNear = (x, y, year, minD = 150, maxD = 280, heading = null) => {
        for (let attempt = 0; attempt < 8; attempt++) {
            const a = rng() * Math.PI * 2, d = range(rng, minD, maxD);
            const near = nearestEdge(graph, x + Math.cos(a) * d, y + Math.sin(a) * d, 60, year, e => drivable(e, year) && !e.link && e.len >= 20); // never on slip roads or short stubs
            if (!near) continue;
            const dx = near.x - x, dy = near.y - y, dist = Math.hypot(dx, dy);
            if (dist < minD * 0.9) continue; // the road bent back towards the player
            if (heading !== null && dist < SEE && dx * Math.cos(heading) + dy * Math.sin(heading) > dist * 0.35) continue; // ahead of the player
            const forward = near.edge.oneway ? true : rng() < 0.5; // one-way roads only run a -> b
            const along = Math.max(0, Math.min(near.edge.len, forward ? near.along : near.edge.len - near.along));
            const agent = traffic.spawnOn(near.edge, forward, along, year, undefined, true);
            if (agent) return agent;
        }
        return null;
    };

    /** Places an agent on an edge (travelling forward = from a to b), unless the spot is taken; `moving` starts it at cruising pace. */
    traffic.spawnOn = (edge, forward, along, year, type = choose(year), moving = false) => {
        if (edge.oneway) forward = true;
        const t = TRAFFIC_TYPES[type];
        const p = lanePoint(edge, along, forward, laneOffset(edge, year), {});
        for (const o of traffic.agents) if (Math.hypot(o.x - p.x, o.y - p.y) < 14) return null;
        const agent = {
            id: traffic.nextId++, type, spec: t, edge: edge.id, forward, along,
            speed: 0, factor: range(rng, 0.82, 1.05), colour: pick(rng, PALETTE[ERA(year)]), era: ERA(year),
            x: p.x, y: p.y, heading: p.angle, prevX: p.x, prevY: p.y, prevHeading: p.angle,
            next: null, conn: null, leaving: null, stunned: 0, waiting: 0, z: 0, prevZ: 0, pitch: 0, grade: 0,
        };
        agent.grade = rideProfile(agent, edge);
        agent.prevZ = agent.z;
        if (moving) agent.speed = Math.min(t.vmax, edgeSpeed(edge, year)) * agent.factor * 0.85; // far from the player: already up to speed, not a stationary obstacle
        agent.lat = laneOffset(edge, year);
        agent.ox = 0; agent.oy = 0;
        traffic.agents.push(agent);
        return agent;
    };

    const endNode = a => { const e = graph.edges[a.edge]; return a.forward ? e.b : e.a; };

    function pickNext(a, year) {
        const e = graph.edges[a.edge];
        const nodeId = endNode(a);
        const node = graph.nodes[nodeId];
        const inEnd = a.forward ? 'b' : 'a';
        const layout = connectorLayout(graph, nodeId, year);
        const inAngle = a.heading;
        const options = [];
        for (const id of node.edges) {
            if (id === a.edge) continue;
            const o = graph.edges[id];
            if (!drivable(o, year)) continue;
            if (o.oneway && o.a !== nodeId) continue; // not against a one-way road
            const fwd = o.a === nodeId;
            const p = lanePoint(o, 1, fwd, 0, {});
            const turn = Math.abs(Math.atan2(Math.sin(p.angle - inAngle), Math.cos(p.angle - inAngle)));
            // a short cul-de-sac (a stub ending at a dead end) is a place to avoid, not to turn round in
            const stub = o.len < 60 && graph.nodes[fwd ? o.b : o.a].edges.length === 1;
            // the lane path through the junction layout to that road; none means that turn is not allowed
            const conn = layout ? connectorBetween(layout, e, inEnd, o, fwd ? 'a' : 'b') : null;
            options.push({ edge: id, forward: fwd, w: 0.4 + Math.cos(turn) + 1 + (ROAD_CLASS[o.cls]?.rank ?? 1) * 0.2, turn, stub, conn });
        }
        // only turns the junction has a path for (unless none has: then the old straight jump)
        const legal = options.filter(o => !layout || o.conn);
        if (legal.length && legal.length < options.length) options.splice(0, options.length, ...legal);
        // a short cul-de-sac is never entered while there is anywhere else to go
        const through = options.filter(o => !o.stub);
        if (through.length && through.length < options.length) options.splice(0, options.length, ...through);
        if (!options.length) {
            // dead end: turn round (a one-way road cannot be driven back: the vehicle leaves the map there)
            if (e.oneway) return { edge: e.id, forward: a.forward, turn: Math.PI, gone: true, conn: null };
            return { edge: e.id, forward: !a.forward, turn: Math.PI, conn: layout ? connectorBetween(layout, e, inEnd, e, inEnd) : null };
        }
        let r = rng() * options.reduce((s, o) => s + o.w, 0);
        for (const o of options) { r -= o.w; if (r <= 0) return o; }
        return options[0];
    }

    /**
     * Must this agent wait at the end of its edge? The first vehicle allowed through a junction claims it until it
     * has left (its rear is clear of the mouth), so a vehicle never starts a path that crosses or merges with one
     * already claimed. Plain and signal junctions are single occupancy (every path counts as crossing); at a
     * roundabout only paths that really cross or merge (world/connectors.js connectorsConflict) wait for each other,
     * so traffic already circulating has priority over a vehicle waiting to enter and vehicles on separate parts of
     * the ring go together. `nc` is this agent's lane path (null where the node has no layout), `stopFront` how far
     * from the node its front waits.
     */
    function mustYield(a, ctx, others, nc, stopFront) {
        const nodeId = endNode(a);
        const node = graph.nodes[nodeId];
        if (node.edges.length < 3 && nc?.layout.kind !== 'end') return false; // (a dead end's U-turn is single occupancy too)
        const e = graph.edges[a.edge];
        const myDist = e.len - a.along;
        const claims = traffic.claims.get(nodeId);
        if (claims?.some(r => r.id === a.id)) return false;
        // past the stop line or already in the box: committed, keep going (stopping there would block everyone)
        if (myDist - a.spec.len / 2 < stopFront - 2) return false; // (a waiting vehicle creeps no further than half a metre past the line)
        if (!nc && Math.hypot(a.x - node.x, a.y - node.y) < BOX) return false;
        const type = junctionType(node, ctx.year);
        const byPath = nc && nc.layout.kind === 'roundabout';
        const clash = conn => !byPath || !conn || connectorsConflict(nc, conn);
        // is body o in the junction? A vehicle on its own path is; one still on a road keeps clear of the mouth; the
        // player (no path) is where it stands (on the surface, at its level)
        const inside = o => {
            if (o === a) return false;
            if (o.conn) return o.conn.c.nodeId === nodeId;
            if (nc && o.edge !== undefined) return false;
            if (o.z !== undefined && node.z !== undefined && Math.abs(o.z - node.z) > LAYER_GAP) return false; // on a bridge over it, in a tunnel under it
            if (!nc) return Math.hypot(o.x - node.x, o.y - node.y) < BOX;
            return Math.hypot(o.x - node.x, o.y - node.y) < nc.layout.reach && onJunction(nc.layout, o.x, o.y);
        };
        // a claim held by a vehicle that is itself stuck for a long time is broken, but never into an occupied box:
        // the stuck holders lose their claims and queue again behind this vehicle's
        if (claims?.some(r => clash(r.conn))) {
            if (!(a.waiting > 25 && !others.some(inside))) return true;
            traffic.claims.set(nodeId, claims.filter(r => !clash(r.conn)));
        }
        if (myDist > CLAIM_AT + (nc ? nc.inTrim : 0)) return false; // too far off to matter yet
        for (const o of others) {
            if (inside(o) && clash(o.conn)) return true; // someone (or the player) is in it
        }
        if (type === 'signals') {
            if (signalPhase(node, ctx.time) !== signalGroup(a.heading)) return true;
        } else {
            const myRank = ROAD_CLASS[edgeClass(e, ctx.year)]?.rank ?? 1;
            for (const o of others) {
                if (o === a || o.edge === undefined || o.edge === a.edge || o.conn || endNode(o) !== nodeId) continue;
                const oe = graph.edges[o.edge];
                const oDist = oe.len - o.along;
                if (oDist > 24 || o.speed < 0.2 && oDist > STOP_LINE + 3) continue;
                const oRank = ROAD_CLASS[edgeClass(oe, ctx.year)]?.rank ?? 1;
                if (type !== 'roundabout' && oRank > myRank) return true; // give way to the major road
            }
        }
        const held = traffic.claims.get(nodeId);
        if (held) held.push({ id: a.id, conn: nc }); else traffic.claims.set(nodeId, [{ id: a.id, conn: nc }]);
        a.claim = nodeId;
        return false;
    }

    /** Releases junction claims once their holder is clear of the junction (or gone). */
    function releaseClaims() {
        const byId = new Map(traffic.agents.map(a => [a.id, a]));
        for (const [nodeId, list] of traffic.claims) {
            const node = graph.nodes[nodeId];
            const keep = list.filter(r => {
                const a = byId.get(r.id);
                if (!a) return false;
                if (a.conn) return a.conn.c.nodeId === nodeId;     // on its path through
                if (endNode(a) === nodeId) return true;             // still on the way in
                if (a.leaving && a.leaving.node === nodeId && a.edge === a.leaving.edge && a.along < a.leaving.until) return true; // rear still in the mouth
                if (!r.conn) return Math.hypot(a.x - node.x, a.y - node.y) <= BOX + a.spec.len / 2 + 2; // no layout: by distance
                return false;
            });
            if (!keep.length) traffic.claims.delete(nodeId); else if (keep.length !== list.length) traffic.claims.set(nodeId, keep);
        }
    }

    /** Distance to the nearest vehicle ahead in this agent's path (bumper to bumper), or Infinity. */
    function gapAhead(a, bodies) {
        const c = Math.cos(a.heading), s = Math.sin(a.heading);
        let gap = Infinity;
        for (const o of bodies) {
            if (o === a) continue;
            // inside a junction only the others on their paths through it (and the player) count: vehicles waiting at
            // the mouths are held by this one, and the road it leaves onto is watched by exitGap
            if (a.conn && o.edge !== undefined && !o.conn) continue;
            // likewise just after it: the vehicles waiting on the other arms are held by this one's claim
            if (a.leaving && a.edge === a.leaving.edge && a.along < a.leaving.until && o.edge !== undefined && !o.conn && o.edge !== a.edge && endNode(o) === a.leaving.node) continue;
            const rx = o.x - a.x, ry = o.y - a.y;
            const fwd = rx * c + ry * s;
            if (fwd <= 0 || fwd > LOOK) continue;
            const lat = Math.abs(-rx * s + ry * c);
            // (a vehicle on the same road going the same way is in the way whatever its lane: lanes ease sideways between road classes)
            // (and so is one queued on the road it is about to turn onto: on a very short link the two lanes sit metres apart)
            const sameRoad = !o.conn && !a.conn && o.forward !== undefined && ((o.edge === a.edge && o.forward === a.forward) || (a.next && o.edge === a.next.edge && o.forward === a.next.forward && fwd < 25 && Math.cos(o.heading - a.heading) > 0.8));
            // (oncoming traffic is never ahead: two near-parallel streets that leave one node close together would otherwise lock head to head)
            if (!sameRoad && !a.conn && o.edge !== undefined && o.heading !== undefined && Math.cos(o.heading - a.heading) < -0.5 && endNode(o) !== endNode(a)) continue;
            if (!sameRoad && lat > (a.spec.width + (o.spec?.width ?? o.width ?? 2)) / 2 + 0.4) continue;
            if (otherLayer(a, o, fwd)) continue; // over or under it: not in this vehicle's way
            gap = Math.min(gap, fwd - (a.spec.len + (o.spec?.len ?? o.len ?? 4)) / 2);
        }
        return gap;
    }

    /** Starts an agent on the lane path through the junction at the end of its edge. */
    function enterConnector(a) {
        const c = a.next.conn, e = graph.edges[a.edge];
        lanePoint(e, a.along, a.forward, a.lat, oldP);
        connectorPoint(c, 0, lp);
        a.ox += oldP.x - lp.x; a.oy += oldP.y - lp.y;   // the jump from the edge's lane to the path is blended away
        const out = graph.edges[a.next.edge];
        const z1 = out.z ? roadHeightAt(out, a.next.forward ? c.outTrim : out.len - c.outTrim) : 0;
        a.conn = { c, s: 0, z0: a.z ?? 0, z1 };
    }

    /** Takes an agent off its path onto the road it leads to, at that road's trim, and picks the turn after. */
    function leaveConnector(a, year) {
        const { c } = a.conn, next = a.next;
        connectorPoint(c, c.len, oldP);
        a.conn = null;
        a.edge = next.edge; a.forward = next.forward; a.along = c.outTrim;
        a.leaving = { node: c.nodeId, edge: a.edge, until: c.outTrim + a.spec.len + 1 };
        a.next = null;
        a.next = pickNext(a, year);
        lanePoint(graph.edges[a.edge], a.along, a.forward, a.lat, lp);
        a.ox += oldP.x - lp.x; a.oy += oldP.y - lp.y;
    }

    /**
     * Moves an agent `dist` metres on: along its edge to the junction mouth (the edge's trim), through the junction
     * on its lane path, then along the next edge. With no layout it drives to the node and jumps to the next edge.
     */
    function advance(a, dist, year) {
        let rem = dist;
        for (let guard = 0; guard < 8; guard++) {
            if (a.conn) {
                const left = a.conn.c.len - a.conn.s;
                if (rem < left) { a.conn.s += rem; return; }
                rem -= left;
                leaveConnector(a, year);
                continue;
            }
            const e = graph.edges[a.edge];
            const nc = a.next.conn;
            const stopAt = nc ? Math.max(0, e.len - nc.inTrim) : e.len;
            if (a.along + rem < stopAt) { a.along += rem; return; }
            rem -= Math.max(0, stopAt - a.along);
            a.along = Math.max(a.along, stopAt);
            if (a.next.gone) { a.gone = true; a.along = 0; a.next = { edge: a.edge, forward: a.forward, turn: 0, conn: null }; return; }
            if (nc) { enterConnector(a); continue; }
            lanePoint(e, e.len, a.forward, a.lat, oldP);
            a.edge = a.next.edge;
            a.forward = a.next.forward;
            a.along = 0;
            a.next = null;
            a.next = pickNext(a, year);
            // keep the vehicle where it was: the jump onto the next edge's lane is blended away
            lanePoint(graph.edges[a.edge], a.along, a.forward, a.lat, lp);
            a.ox += oldP.x - lp.x; a.oy += oldP.y - lp.y;
        }
    }

    /** Distance (bumper to bumper) from an agent on its lane path to the nearest vehicle on the road it is leaving onto, or Infinity. */
    function exitGap(a, bodies) {
        const { c, s } = a.conn, next = a.next;
        let gap = Infinity;
        for (const o of bodies) {
            if (o === a || o.conn || o.edge !== next.edge || o.forward !== next.forward) continue;
            gap = Math.min(gap, c.len - s + Math.max(0, o.along - c.outTrim) - (a.spec.len + o.spec.len) / 2);
        }
        return gap;
    }

    /**
     * One fixed step. ctx = {year, player: {x, y, heading, speed, len, width} | null, despawnAt (m)}.
     * The player counts as a vehicle for following and for the junction box.
     */
    traffic.step = (dt, ctx) => {
        traffic.time += dt;
        ctx.time = traffic.time;
        const bodies = ctx.player ? [...traffic.agents, ctx.player] : traffic.agents;
        for (const a of traffic.agents) {
            a.prevX = a.x; a.prevY = a.y; a.prevHeading = a.heading;
            const e = graph.edges[a.edge];
            const cls = edgeClass(e, ctx.year);
            let target = Math.min(a.spec.vmax, edgeSpeed(e, ctx.year)) * a.factor;
            if (ctx.grip !== undefined) target *= 0.75 + 0.25 * ctx.grip; // drive slower in the wet
            target = hillSpeed(CLIMB[a.type], a.grade ?? 0, target); // crawl up hills, hold back down steep ones
            a.next ??= pickNext(a, ctx.year);
            const nc = a.conn ? null : a.next.conn;          // the lane path it is about to take (none: no layout)
            const toEnd = e.len - a.along;                   // to the node centre along the edge
            const stopFront = nc ? nc.inTrim + STOP_GAP : STOP_LINE;
            let gap = gapAhead(a, bodies), yielding = false;
            if (a.conn) {
                target = Math.min(target, a.conn.c.vturn);   // corners and the ring are taken slowly
                gap = Math.min(gap, exitGap(a, bodies));     // and a queue on the road it leads to is a vehicle ahead
                a.waiting = 0;
            } else {
                if (nc) {
                    // brake so as to arrive at the mouth at the corner's speed (3 m/s^2)
                    if (nc.vturn < Infinity) target = Math.min(target, Math.sqrt(nc.vturn * nc.vturn + 6 * Math.max(0, toEnd - nc.inTrim)));
                } else if (toEnd < 20 && a.next.turn > 0.7) target = Math.min(target, a.next.turn > 2.5 ? 2.5 : 6); // sharp turns and dead ends with no layout
                yielding = mustYield(a, ctx, bodies, nc, stopFront);
                if (yielding) { gap = Math.min(gap, toEnd - stopFront - a.spec.len / 2 + 2); a.waiting += dt; } else a.waiting = 0;
            }
            // the speed that still lets it stop 2 m short of the obstacle at 3 m/s^2
            const safe = Math.sqrt(Math.max(0, 2 * 3 * Math.max(0, gap - 2)));
            if (a.stunned > 0) { a.stunned -= dt; target = 0; }
            const want = Math.min(target, safe);
            const acc = Math.max(-8, Math.min(2.2, (want - a.speed) * 4));
            a.speed = Math.max(0, a.speed + acc * dt);
            if (gap < 0.3) a.speed = 0;
            // never roll past a stop line while giving way
            if (yielding) a.speed = Math.min(a.speed, Math.max(0, (toEnd - stopFront - a.spec.len / 2 + 0.5) / dt));
            advance(a, a.speed * dt, ctx.year);
            // a vehicle jammed for 90 s (a queue folded onto a very short link between two junctions) is taken off the road; another spawns
            if (a.speed < 0.05) { a.stuck = (a.stuck ?? 0) + dt; if (a.stuck > STUCK_LIMIT) a.gone = true; } else a.stuck = 0;
            const ed = graph.edges[a.edge];
            // ease sideways between lane offsets (a road changing class), follow the lane or the junction path, and let any jump decay
            const wantLat = laneOffset(ed, ctx.year);
            a.lat += Math.max(-dt * 1.2, Math.min(dt * 1.2, wantLat - a.lat));
            if (a.conn) {
                connectorPoint(a.conn.c, a.conn.s, lp);
                connectorPoint(a.conn.c, Math.min(a.conn.c.len, a.conn.s + 2.5 + a.speed * 0.35), ahead);
            } else {
                lanePoint(ed, a.along, a.forward, a.lat, lp);
                lanePoint(ed, Math.min(ed.len, a.along + 2.5 + a.speed * 0.35), a.forward, a.lat, ahead);
            }
            const decay = Math.exp(-dt / 0.35);
            a.ox *= decay; a.oy *= decay;
            a.x = lp.x + a.ox; a.y = lp.y + a.oy;
            // steer towards a point just ahead on the lane, at a limited yaw rate (so corners are swept, not snapped)
            const far = Math.hypot(ahead.x - lp.x, ahead.y - lp.y) > 0.6;
            const aim = far ? Math.atan2(ahead.y + a.oy - a.y, ahead.x + a.ox - a.x) : lp.angle;
            let dh = Math.atan2(Math.sin(aim - a.heading), Math.cos(aim - a.heading));
            if (Math.abs(dh) > 2.6) a.heading = aim; // a U-turn at a dead end
            else { const rate = Math.max(2.5, a.speed / 1.8) * dt; a.heading += Math.max(-rate, Math.min(rate, dh)); }
            a.grade = a.conn ? rideConn(a) : rideProfile(a, ed);
        }
        if (traffic.agents.some(a => a.gone)) traffic.agents = traffic.agents.filter(a => !a.gone);
        releaseClaims();
        // despawn far away, then top up toward the target count
        if (ctx.player) {
            const far = ctx.despawnAt ?? 340;
            traffic.agents = traffic.agents.filter(a => Math.hypot(a.x - ctx.player.x, a.y - ctx.player.y) < far);
            const target = Math.round(traffic.cap * densityFor(ctx.year) * traffic.densityScale);
            if (traffic.agents.length > target + 2) { // fewer wanted than there are: drop the farthest
                let far = 0, fd = -1;
                traffic.agents.forEach((a, i) => { const d = Math.hypot(a.x - ctx.player.x, a.y - ctx.player.y); if (d > fd) { fd = d; far = i; } });
                traffic.agents.splice(far, 1);
            }
            if (traffic.agents.length < target && rng() < dt * 3) traffic.spawnNear(ctx.player.x, ctx.player.y, ctx.year, 150, 280, ctx.player.heading ?? null);
        }
    };

    return traffic;
}

/** Wheels per traffic type: [rear axle, front axle] as {r, w, kind}, plus how the wheels sit. */
const TRAFFIC_WHEELS = {
    cart: { axles: [{ r: 0.62, w: 0.07, kind: 'spoke' }, { r: 0.62, w: 0.07, kind: 'spoke' }], skipAxles: [1] },
    bicycle: { axles: [{ r: 0.33, w: 0.05, kind: 'cycle' }, { r: 0.33, w: 0.05, kind: 'cycle' }], centreWheels: true },
    tin: { axles: [{ r: 0.36, w: 0.12, kind: 'spoke' }, { r: 0.36, w: 0.12, kind: 'spoke' }] },
    saloon30: { axles: [{ r: 0.34, w: 0.16, kind: 'disc' }, { r: 0.34, w: 0.16, kind: 'disc' }] },
    car50: { axles: [{ r: 0.31, w: 0.16, kind: 'disc' }, { r: 0.31, w: 0.16, kind: 'disc' }] },
    car70: { axles: [{ r: 0.29, w: 0.17, kind: 'disc' }, { r: 0.29, w: 0.17, kind: 'disc' }] },
    car2k: { axles: [{ r: 0.33, w: 0.2, kind: 'alloy' }, { r: 0.33, w: 0.2, kind: 'alloy' }] },
    vanTraffic: { axles: [{ r: 0.34, w: 0.2, kind: 'disc' }, { r: 0.34, w: 0.2, kind: 'disc' }] },
    bus: { axles: [{ r: 0.5, w: 0.3, kind: 'truck' }, { r: 0.5, w: 0.3, kind: 'truck' }] },
    tractor: { axles: [{ r: 0.72, w: 0.4, kind: 'tread' }, { r: 0.38, w: 0.2, kind: 'tread' }] },
};

/** Rear-axle pose and a drawing spec for an agent (for render/draw-vehicles.js and the GL vehicle models). */
export function agentDrawSpec(a) {
    const t = a.spec;
    if (a._draw) return a._draw;
    const rearOverhang = t.len * 0.2;
    const parts = drawParts(a.type, t, a.colour);
    const wheels = TRAFFIC_WHEELS[a.type] ?? {};
    const r = wheels.axles?.[0]?.r ?? (a.type === 'bicycle' ? 0.33 : 0.36), w = wheels.axles?.[0]?.w ?? 0.2;
    a._draw = {
        id: `traffic-${a.type}`, model: a.type, paint: a.colour, era: a.era ?? 2,
        length: t.len, width: t.width, height: t.height, rearOverhang, wheelbase: t.len * 0.6,
        draw: { wheel: { r, w }, axles: wheels.axles, skipAxles: wheels.skipAxles, centreWheels: wheels.centreWheels, parts },
    };
    return a._draw;
}

function drawParts(type, t, colour) {
    const L = t.len, W = t.width;
    switch (type) {
        case 'cart': return [
            { u0: 0, u1: 2.6, w: W, z0: 0.6, h: 0.7, color: '#7a5a3a', roof: '#8d6a46' },
            { u0: 3.1, u1: 5.0, w: 0.55, z0: 0.9, h: 0.75, color: '#5b3a24', roof: '#6b4630' },
            { u0: 4.6, u1: 5.2, w: 0.35, z0: 1.45, h: 0.45, color: '#5b3a24', roof: '#6b4630' },
            { u0: 1.6, u1: 2.2, w: 0.5, z0: 1.3, h: 0.8, color: '#3b3b48', roof: '#2a2a33' },
        ];
        case 'bicycle': return [
            { u0: 0.2, u1: 1.6, w: 0.08, z0: 0.6, h: 0.1, color: '#222', roof: '#333' },
            { u0: 0.6, u1: 1.0, w: 0.42, z0: 0.9, h: 0.75, color: colour, roof: '#c9b59a' },
        ];
        case 'bus': return [
            { u0: 0, u1: L, w: W, z0: 0.45, h: t.height - 0.45, color: '#9a2b2b', roof: '#c8c0a8', glass: 'front' },
        ];
        case 'tractor': return [
            { u0: 0, u1: 1.2, w: W, z0: 0.3, h: 1.6, color: '#2f6a3a', roof: '#2f6a3a' },
            { u0: 1.2, u1: L, w: 0.8, z0: 0.6, h: 0.8, color: '#2f6a3a', roof: '#3d7d48' },
        ];
        default: return [
            { u0: 0.1, u1: L - 0.1, w: W, z0: 0.35, h: 0.55, color: colour, roof: colour },
            { u0: L * 0.25, u1: L * 0.7, w: W * 0.9, z0: 0.9, h: t.height - 0.9, color: colour, roof: colour, glass: 'front' },
        ];
    }
}

/** Which signal group has green at a junction now (0 = east-west traffic, 1 = north-south). */
export const signalPhase = (node, time) => Math.floor((time + node.id * 7) / SIGNAL_PHASE) % 2;
/** The signal group of traffic travelling on a heading. */
export const signalGroup = heading => (Math.abs(Math.cos(heading)) > 0.707 ? 0 : 1);
