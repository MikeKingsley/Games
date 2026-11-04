// Living traffic: era vehicles that follow lanes on the road graph (on the left), keep their distance, give way
// at junctions (minor to major roads; signals from the 1930s; roundabouts from the 1960s), and spawn/despawn around
// the player. They slow up hills by their power to weight (carts, bicycles, early cars, buses and tractors crawl)
// and hold back down steep ones, and ride the graded road profile (z, pitch) for drawing.
// Pure logic: positions come from the graph, randomness from a seeded RNG.
import { seededRng, pick, range } from '../engine/rng.js';
import { cruiseSpeed, edgeClass, edgeOpen, laneOffset, lanePoint, junctionType, ROAD_CLASS, nearestEdge } from '../world/roadgraph.js';
import { roadHeightAt, roadGradeAt } from '../world/terrain.js';
import { hillSpeed } from '../sim/slope.js';

const STOP_LINE = 7.5;    // metres before the node centre where give-way traffic waits
const BOX = 6;            // a vehicle within this of the node centre is "in the junction" (less than STOP_LINE)
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
const ERA = year => (year < 1930 ? 0 : year < 1950 ? 1 : year < 1970 ? 2 : year < 1995 ? 3 : 4);
/** Fewer vehicles on the roads in the early years. */
export const densityFor = year => [0.35, 0.55, 0.75, 0.9, 1][ERA(year)];
const PALETTE = [['#1d1d1d', '#2a2a2a', '#3b2f2f', '#2c3a2c'], ['#1d1d1d', '#3b3b5c', '#5a2d2d', '#2d4a3a', '#6a5a3a'], ['#c8c0a8', '#7a2b2b', '#2f4f6f', '#4f6f4f', '#d8d0b8', '#8a8a8a'], ['#c46a2a', '#d8c86a', '#2f6f8f', '#9a2b2b', '#e8e2d0', '#4a7a3a'], ['#c0c4c8', '#1d1d1f', '#f2f2f0', '#2a4f8f', '#8a1f1f', '#6a6e72']];

/** Roads AI vehicles use (not farm lanes, yard access or ferries). */
const drivable = (e, year) => edgeOpen(e, year) && e.cls !== 'lane' && e.cls !== 'access' && e.cls !== 'ferry' && !(edgeClass(e, year) === 'M' && year < 1977);

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
            const near = nearestEdge(graph, x + Math.cos(a) * d, y + Math.sin(a) * d, 60, year, e => drivable(e, year));
            if (!near) continue;
            const dx = near.x - x, dy = near.y - y, dist = Math.hypot(dx, dy);
            if (dist < minD * 0.9) continue; // the road bent back towards the player
            if (heading !== null && dist < SEE && dx * Math.cos(heading) + dy * Math.sin(heading) > dist * 0.35) continue; // ahead of the player
            const forward = rng() < 0.5;
            const along = Math.max(0, Math.min(near.edge.len, forward ? near.along : near.edge.len - near.along));
            const agent = traffic.spawnOn(near.edge, forward, along, year, undefined, true);
            if (agent) return agent;
        }
        return null;
    };

    /** Places an agent on an edge (travelling forward = from a to b), unless the spot is taken; `moving` starts it at cruising pace. */
    traffic.spawnOn = (edge, forward, along, year, type = choose(year), moving = false) => {
        const t = TRAFFIC_TYPES[type];
        const p = lanePoint(edge, along, forward, laneOffset(edge, year), {});
        for (const o of traffic.agents) if (Math.hypot(o.x - p.x, o.y - p.y) < 14) return null;
        const agent = {
            id: traffic.nextId++, type, spec: t, edge: edge.id, forward, along,
            speed: 0, factor: range(rng, 0.82, 1.05), colour: pick(rng, PALETTE[ERA(year)]), era: ERA(year),
            x: p.x, y: p.y, heading: p.angle, prevX: p.x, prevY: p.y, prevHeading: p.angle,
            next: null, stunned: 0, waiting: 0, z: 0, prevZ: 0, pitch: 0, grade: 0,
        };
        agent.grade = rideProfile(agent, edge);
        agent.prevZ = agent.z;
        if (moving) agent.speed = Math.min(t.vmax, cruiseSpeed(edgeClass(edge, year), year)) * agent.factor * 0.85; // far from the player: already up to speed, not a stationary obstacle
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
        const inAngle = a.heading;
        const options = [];
        for (const id of node.edges) {
            if (id === a.edge) continue;
            const o = graph.edges[id];
            if (!drivable(o, year)) continue;
            const fwd = o.a === nodeId;
            const p = lanePoint(o, 1, fwd, 0, {});
            const turn = Math.abs(Math.atan2(Math.sin(p.angle - inAngle), Math.cos(p.angle - inAngle)));
            options.push({ edge: id, forward: fwd, w: 0.4 + Math.cos(turn) + 1 + (ROAD_CLASS[o.cls]?.rank ?? 1) * 0.2, turn });
        }
        if (!options.length) return { edge: e.id, forward: !a.forward, turn: Math.PI }; // dead end: turn round
        let r = rng() * options.reduce((s, o) => s + o.w, 0);
        for (const o of options) { r -= o.w; if (r <= 0) return o; }
        return options[0];
    }

    /**
     * Must this agent wait at the end of its edge? The first vehicle allowed through a junction claims it until it
     * has left the junction box, so two vehicles can never be in it at once (whatever their speeds do).
     */
    function mustYield(a, ctx, others) {
        const nodeId = endNode(a);
        const node = graph.nodes[nodeId];
        if (node.edges.length < 3) return false;
        const e = graph.edges[a.edge];
        const myDist = e.len - a.along;
        const claim = traffic.claims.get(nodeId);
        if (claim === a.id) return false;
        // past the stop line or already in the box: committed, keep going (stopping there would block everyone)
        if (myDist < STOP_LINE - 1 || Math.hypot(a.x - node.x, a.y - node.y) < BOX) return false;
        if (claim !== undefined) return true;
        if (myDist > CLAIM_AT) return false; // too far off to matter yet
        for (const o of others) {
            if (o !== a && Math.hypot(o.x - node.x, o.y - node.y) < BOX) return true; // someone (or the player) is in it
        }
        const type = junctionType(node, ctx.year);
        if (type === 'signals') {
            if (signalPhase(node, ctx.time) !== signalGroup(a.heading)) return true;
        } else {
            const myRank = ROAD_CLASS[edgeClass(e, ctx.year)]?.rank ?? 1;
            for (const o of others) {
                if (o === a || o.edge === undefined || o.edge === a.edge || endNode(o) !== nodeId) continue;
                const oe = graph.edges[o.edge];
                const oDist = oe.len - o.along;
                if (oDist > 24 || o.speed < 0.2 && oDist > STOP_LINE + 3) continue;
                const oRank = ROAD_CLASS[edgeClass(oe, ctx.year)]?.rank ?? 1;
                if (type !== 'roundabout' && oRank > myRank) return true; // give way to the major road
            }
        }
        traffic.claims.set(nodeId, a.id);
        a.claim = nodeId;
        return false;
    }

    /** Releases junction claims once their holder is clear of the box (or gone). */
    function releaseClaims() {
        const byId = new Map(traffic.agents.map(a => [a.id, a]));
        for (const [nodeId, id] of traffic.claims) {
            const a = byId.get(id);
            const node = graph.nodes[nodeId];
            if (!a || (endNode(a) !== nodeId && Math.hypot(a.x - node.x, a.y - node.y) > BOX + a.spec.len / 2 + 2)) traffic.claims.delete(nodeId);
        }
    }

    /** Distance to the nearest vehicle ahead in this agent's path (bumper to bumper), or Infinity. */
    function gapAhead(a, bodies) {
        const c = Math.cos(a.heading), s = Math.sin(a.heading);
        let gap = Infinity;
        for (const o of bodies) {
            if (o === a) continue;
            const rx = o.x - a.x, ry = o.y - a.y;
            const fwd = rx * c + ry * s;
            if (fwd <= 0 || fwd > LOOK) continue;
            const lat = Math.abs(-rx * s + ry * c);
            if (lat > (a.spec.width + (o.spec?.width ?? o.width ?? 2)) / 2 + 0.4) continue;
            gap = Math.min(gap, fwd - (a.spec.len + (o.spec?.len ?? o.len ?? 4)) / 2);
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
            let target = Math.min(a.spec.vmax, cruiseSpeed(cls, ctx.year)) * a.factor;
            if (ctx.grip !== undefined) target *= 0.75 + 0.25 * ctx.grip; // drive slower in the wet
            target = hillSpeed(CLIMB[a.type], a.grade ?? 0, target); // crawl up hills, hold back down steep ones
            a.next ??= pickNext(a, ctx.year);
            const toEnd = e.len - a.along;
            // slow for sharp turns and dead ends
            if (toEnd < 20 && a.next.turn > 0.7) target = Math.min(target, a.next.turn > 2.5 ? 2.5 : 6);
            let gap = gapAhead(a, bodies);
            const yielding = mustYield(a, ctx, bodies);
            if (yielding) { gap = Math.min(gap, toEnd - STOP_LINE - a.spec.len / 2 + 2); a.waiting += dt; } else a.waiting = 0;
            // the speed that still lets it stop 2 m short of the obstacle at 3 m/s^2
            const safe = Math.sqrt(Math.max(0, 2 * 3 * Math.max(0, gap - 2)));
            if (a.stunned > 0) { a.stunned -= dt; target = 0; }
            const want = Math.min(target, safe);
            const acc = Math.max(-8, Math.min(2.2, (want - a.speed) * 4));
            a.speed = Math.max(0, a.speed + acc * dt);
            if (gap < 0.3) a.speed = 0;
            // never roll past a stop line while giving way
            if (yielding) a.speed = Math.min(a.speed, Math.max(0, (toEnd - STOP_LINE) / dt));
            a.along += a.speed * dt;
            while (a.along >= graph.edges[a.edge].len) {
                const oe = graph.edges[a.edge];
                lanePoint(oe, oe.len, a.forward, a.lat, oldP);
                a.along -= oe.len;
                a.edge = a.next.edge;
                a.forward = a.next.forward;
                a.next = null;
                a.next = pickNext(a, ctx.year);
                // keep the vehicle where it was: the jump onto the next edge's lane is blended away below
                lanePoint(graph.edges[a.edge], a.along, a.forward, a.lat, lp);
                a.ox += oldP.x - lp.x; a.oy += oldP.y - lp.y;
            }
            const ed = graph.edges[a.edge];
            // ease sideways between lane offsets (a road changing class), follow the lane, and let any junction jump decay
            const wantLat = laneOffset(ed, ctx.year);
            a.lat += Math.max(-dt * 1.2, Math.min(dt * 1.2, wantLat - a.lat));
            lanePoint(ed, a.along, a.forward, a.lat, lp);
            const decay = Math.exp(-dt / 0.35);
            a.ox *= decay; a.oy *= decay;
            a.x = lp.x + a.ox; a.y = lp.y + a.oy;
            // steer towards a point just ahead on the lane, at a limited yaw rate (so corners are swept, not snapped)
            lanePoint(ed, Math.min(ed.len, a.along + 2.5 + a.speed * 0.35), a.forward, a.lat, ahead);
            const far = Math.hypot(ahead.x - lp.x, ahead.y - lp.y) > 0.6;
            const aim = far ? Math.atan2(ahead.y + a.oy - a.y, ahead.x + a.ox - a.x) : lp.angle;
            let dh = Math.atan2(Math.sin(aim - a.heading), Math.cos(aim - a.heading));
            if (Math.abs(dh) > 2.6) a.heading = aim; // a U-turn at a dead end
            else { const rate = Math.max(2.5, a.speed / 1.8) * dt; a.heading += Math.max(-rate, Math.min(rate, dh)); }
            a.grade = rideProfile(a, ed);
        }
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
