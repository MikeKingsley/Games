// Yard layout templates for Inglenook. DOM-free. Coordinates are in wagon lengths (y grows downwards).
//
// classic / classic-long: headshunt H -> point P1 { straight: connector M -> point P2 { straight: siding B, diverging: siding C },
//                          diverging: siding A }.  A is the long siding and the goal.
// ladderN:                 headshunt H, then a diagonal ladder of points; each point's straight leg is a siding row.
// loop:                    a passing loop (Pa/Pb with loop track L) between the headshunt and a classic fan, so the loco can run round.
//
// Every track is built from straights and circular arcs (pathFrom) and every leg leaves its point tangent to the toe, so rails curve
// smoothly out of a point. Each track keeps exactly the length the capacity formulas give; the curve takes its share and a straight
// tail takes the rest.
import { buildLayout, pathFrom, sidingLength, headshuntLength, POINT_FOUL } from './track.js';

export const ROW = 1.8; // distance between parallel tracks
export const TURNOUT_RADIUS = 3.5; // radius of every turnout and ladder curve (never below 3.0)
export const LOOP_RADIUS = 3.0; // the loop has to fit its two reverse curves into a fixed length, so it uses the tightest radius allowed
export const CONNECTOR = 3.0; // track between two points
/** Angle of each arc of a reverse curve (two equal arcs) that moves `ROW` sideways: 2 R (1 - cos a) = ROW. */
export const reverseAngle = radius => Math.acos(1 - ROW / (2 * radius));
export const FAN_ANGLE = reverseAngle(TURNOUT_RADIUS); // about 42 degrees
export const LADDER_ANGLE = Math.atan2(ROW, CONNECTOR); // about 31 degrees: heading of a ladder connector
const X0 = 0.6;
const Y0 = 8;

/** A straight tail after a curve of length `curve`: the track is `total` long, so the tail takes the rest. */
function tail(id, total, curve) {
    const rest = total - curve;
    if (rest < -1e-9) throw new Error(`track ${id} (${total.toFixed(2)} long) is too short for its curve (${curve.toFixed(2)})`);
    return Math.max(rest, 0);
}

/** A reverse curve from heading 0 to a row `ROW` away (up when `up`) followed by a straight tail, `total` long. */
function sidingFrom(id, x, y, up, total, radius = TURNOUT_RADIUS) {
    const a = reverseAngle(radius) * (up ? -1 : 1);
    return { id, role: 'siding', ...pathFrom(x, y, 0).arc(radius, a).arc(radius, -a).straight(tail(id, total, 2 * radius * Math.abs(a))).build() };
}

/** Adds the fan of three sidings (A up, B straight, C down) starting with a point whose toe is `toeRef` at (x, y). Returns specs. */
function fan(x, y, toeRef, caps, prefix = '') {
    const [ca, cb, cc] = caps;
    const p2x = x + CONNECTOR;
    const tracks = [
        sidingFrom('A', x, y, true, sidingLength(ca)),
        { id: 'M', role: 'connector', ...pathFrom(x, y, 0).straight(CONNECTOR).build() },
        { id: 'B', role: 'siding', ...pathFrom(p2x, y, 0).straight(sidingLength(cb)).build() },
        sidingFrom('C', p2x, y, false, sidingLength(cc)),
    ];
    const points = [
        { id: `${prefix}P1`, toe: toeRef, straight: 'M.a', diverging: 'A.a' },
        { id: `${prefix}P2`, toe: 'M.b', straight: 'B.a', diverging: 'C.a' },
    ];
    return { tracks, points };
}

function classicSpec({ id, name, caps, head }) {
    const hLen = headshuntLength(head);
    const x1 = X0 + hLen;
    const f = fan(x1, Y0, 'H.b', caps);
    return {
        id, name, goal: 'A', head: 'H',
        tracks: [{ id: 'H', role: 'headshunt', ...pathFrom(X0, Y0, 0).straight(hLen).build() }, ...f.tracks],
        points: f.points,
    };
}

/**
 * Ladder: the connector between the first two points curves up to LADDER_ANGLE and runs straight; later connectors are straight at
 * that angle. A siding on a ladder point curves from the ladder angle back to its row; the last siding runs on along the ladder for
 * one more connector before it curves back to its row. Rows stay ROW apart.
 */
function ladderSpec({ id, name, caps, head }) {
    const n = caps.length;
    if (n < 3) throw new Error('a ladder needs at least three sidings');
    const hLen = headshuntLength(head);
    const x1 = X0 + hLen;
    const R = TURNOUT_RADIUS, al = LADDER_ANGLE;
    const bend = R * (1 - Math.cos(al)); // sideways shift of one ladder arc
    const diag = Math.hypot(CONNECTOR, ROW); // length of a ladder connector
    const run = ROW / Math.sin(al); // length of a straight ladder connector (equals diag)
    const tracks = [{ id: 'H', role: 'headshunt', ...pathFrom(X0, Y0, 0).straight(hLen).build() }];
    const points = [];
    let at = { x: x1, y: Y0, heading: 0 }; // the current point: where its toe arrives
    for (let i = 0; i < n - 1; i++) {
        const toe = i === 0 ? 'H.b' : `L${i}.b`;
        // the siding on this point's straight leg
        const cap = sidingLength(caps[i]);
        const start = pathFrom(at.x, at.y, at.heading);
        tracks.push({ id: `S${i + 1}`, role: 'siding', ...(i === 0 ? start.straight(cap) : start.arc(R, al).straight(tail(`S${i + 1}`, cap, R * al))).build() });
        if (i < n - 2) {
            // the connector to the next point
            const c = pathFrom(at.x, at.y, at.heading);
            if (i === 0) {
                const climb = (ROW - 2 * bend) / Math.sin(al); // straight part that finishes the sideways climb
                c.straight(tail('L1', diag, R * al + climb)).arc(R, -al).straight(climb);
            } else c.straight(run);
            const built = c.build();
            tracks.push({ id: `L${i + 1}`, role: 'connector', ...built });
            points.push({ id: `P${i + 1}`, toe, straight: `S${i + 1}.a`, diverging: `L${i + 1}.a` });
            at = built.end;
        } else {
            // the last ladder piece runs one more connector along the ladder, then curves into the final siding row
            const total = sidingLength(caps[n - 1]);
            const last = pathFrom(at.x, at.y, at.heading).straight(run).arc(R, al).straight(tail(`S${n}`, total, run + R * al));
            tracks.push({ id: `S${n}`, role: 'siding', ...last.build() });
            points.push({ id: `P${i + 1}`, toe, straight: `S${i + 1}.a`, diverging: `S${n}.a` });
        }
    }
    return { id, name, goal: 'S1', head: 'H', tracks, points };
}

function loopSpec({ id, name, caps, head, loopWagons }) {
    const hLen = headshuntLength(head);
    const xa = X0 + hLen;
    const sLen = 2 * POINT_FOUL + loopWagons * 1.12 - 0.12 + 0.05;
    const xb = xa + sLen;
    const R = LOOP_RADIUS, a = reverseAngle(R);
    const mid = sLen - 4 * R * Math.sin(a); // straight run between the two reverse curves
    if (mid < 0) throw new Error('the loop is too short for its reverse curves');
    const r = fan(xb + CONNECTOR, Y0, 'R.b', caps);
    return {
        id, name, goal: 'A', head: 'H',
        tracks: [
            { id: 'H', role: 'headshunt', ...pathFrom(X0, Y0, 0).straight(hLen).build() },
            { id: 'S', role: 'connector', ...pathFrom(xa, Y0, 0).straight(sLen).build() },
            // the loop track is as long as its curves make it: out and back along reverse curves with a straight between
            { id: 'L', role: 'loop', ...pathFrom(xa, Y0, 0).arc(R, -a).arc(R, a).straight(mid).arc(R, a).arc(R, -a).build() },
            { id: 'R', role: 'connector', ...pathFrom(xb, Y0, 0).straight(CONNECTOR).build() },
            ...r.tracks,
        ],
        points: [
            { id: 'Pa', toe: 'H.b', straight: 'S.a', diverging: 'L.a' },
            { id: 'Pb', toe: 'R.a', straight: 'S.b', diverging: 'L.b' },
            ...r.points,
        ],
    };
}

const SPECS = {
    classic: () => classicSpec({ id: 'classic', name: 'Classic inglenook', caps: [5, 3, 3], head: 3 }),
    'classic-long': () => classicSpec({ id: 'classic-long', name: 'Long inglenook', caps: [7, 4, 4], head: 4 }),
    ladder4: () => ladderSpec({ id: 'ladder4', name: 'Four-siding ladder', caps: [5, 3, 3, 3], head: 3 }),
    ladder5: () => ladderSpec({ id: 'ladder5', name: 'Five-siding ladder', caps: [6, 3, 3, 3, 3], head: 3 }),
    loop: () => loopSpec({ id: 'loop', name: 'Inglenook with run-round loop', caps: [5, 3, 3], head: 2, loopWagons: 3 }),
};

export const TEMPLATE_IDS = Object.keys(SPECS);

const cache = new Map();

/** Build (and cache) a layout template by id. Layouts are immutable; point states live in the simulation. */
export function getLayout(id) {
    if (!SPECS[id]) throw new Error(`unknown layout "${id}"`);
    if (!cache.has(id)) cache.set(id, buildLayout(SPECS[id]()));
    return cache.get(id);
}
