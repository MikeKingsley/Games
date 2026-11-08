// Plays solver operations through the real simulation (used by tests and the debug hook, never by the player). DOM-free.
// Each op is driven exactly as a player would: set the points, drive until the loco stops, cut the rake, drive back to the buffer.
import { bufferEnd } from './logic.js';

const DT = 1 / 60;

/** Point settings needed to route from the headshunt to a siding. */
export function routeTo(layout, targetId) {
    const visit = (trackId, fromEnd, set) => {
        if (trackId === targetId) return set;
        const track = layout.tracks[trackId];
        const end = track.ends[fromEnd === 'a' ? 'b' : 'a'];
        if (end.type !== 'point' || end.leg !== 'toe') return null;
        for (const leg of ['straight', 'diverging']) {
            const ref = layout.points[end.point].legs[leg];
            const r = visit(ref.track, ref.end, { ...set, [end.point]: leg });
            if (r) return r;
        }
        return null;
    };
    return visit(layout.head, bufferEnd(layout, layout.head), {});
}

function runUntilStopped(sim, command, maxSeconds = 90) {
    sim.drainEvents();
    sim.setDirection(command);
    const events = [];
    for (let i = 0; i < maxSeconds / DT; i++) {
        sim.step(DT);
        events.push(...sim.drainEvents());
        if (sim.command === 'stop' && sim.speed === 0) return events;
    }
    throw new Error(`loco did not stop (${command})`);
}

function setRoute(sim, targetId) {
    const route = routeTo(sim.layout, targetId);
    if (!route) throw new Error(`no route to ${targetId}`);
    for (const [point, state] of Object.entries(route)) {
        if (sim.points[point] !== state && !sim.togglePoint(point)) throw new Error(`could not throw ${point}`);
    }
}

const locoRake = sim => sim.rakes().find(r => r.vehicles.includes('loco'));

/** Cut the loco's rake so that `keep` vehicles next to the loco stay with it. */
function cutAfter(sim, keep) {
    const rake = locoRake(sim);
    const at = rake.vehicles.indexOf('loco');
    const wagons = rake.vehicles.length - 1;
    if (keep >= wagons) return false; // nothing to cut off
    const index = at === 0 ? 1 + keep : rake.vehicles.length - 1 - keep;
    if (!sim.uncouple(rake.id, index)) throw new Error('uncouple refused');
    return true;
}

export function playOp(sim, op) {
    setRoute(sim, op.track);
    const headWagons = () => sim.onTrack(sim.layout.head).filter(id => id !== 'loco').length;
    if (op.type === 'pull') {
        runUntilStopped(sim, 'forward');
        const rake = locoRake(sim);
        if (rake.vehicles.length < 2) throw new Error('loco did not couple');
        cutAfter(sim, op.count);
    } else {
        const carried = headWagons();
        runUntilStopped(sim, 'forward');
        cutAfter(sim, carried - op.count);
    }
    runUntilStopped(sim, 'reverse');
}

export function playOps(sim, ops) {
    for (const op of ops) playOp(sim, op);
}
