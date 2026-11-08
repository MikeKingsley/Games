// Yard layout templates for Inglenook. DOM-free. Coordinates are in wagon lengths (y grows downwards).
//
// classic / classic-long: headshunt H -> point P1 { straight: connector M -> point P2 { straight: siding B, diverging: siding C },
//                          diverging: siding A }.  A is the long siding and the goal.
// ladderN:                 headshunt H, then a diagonal ladder of points; each point's straight leg is a siding row.
// loop:                    a passing loop (Pa/Pb with loop track L) between the headshunt and a classic fan, so the loco can run round.
import { buildLayout, sidingLength, headshuntLength, POINT_FOUL } from './track.js';

const ROW = 1.8; // distance between parallel tracks
const SLANT_DX = 2.2; // a diverging leg moves ROW sideways over this length
const SLANT = Math.hypot(SLANT_DX, ROW);
const CONNECTOR = 3.0; // track between two points
const X0 = 0.6;
const Y0 = 8;

/** Adds the fan of three sidings (A up, B straight, C down) starting with a point whose toe is `toeRef` at (x, y). Returns specs. */
function fan(x, y, toeRef, caps, prefix = '') {
    const [ca, cb, cc] = caps;
    const p2x = x + CONNECTOR;
    const tracks = [
        { id: 'A', role: 'siding', pts: [[x, y], [x + SLANT_DX, y - ROW], [x + sidingLength(ca) - SLANT + SLANT_DX, y - ROW]] },
        { id: 'M', role: 'connector', pts: [[x, y], [p2x, y]] },
        { id: 'B', role: 'siding', pts: [[p2x, y], [p2x + sidingLength(cb), y]] },
        { id: 'C', role: 'siding', pts: [[p2x, y], [p2x + SLANT_DX, y + ROW], [p2x + sidingLength(cc) - SLANT + SLANT_DX, y + ROW]] },
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
        tracks: [{ id: 'H', role: 'headshunt', pts: [[X0, Y0], [x1, Y0]] }, ...f.tracks],
        points: f.points,
    };
}

function ladderSpec({ id, name, caps, head }) {
    const n = caps.length;
    const x1 = X0 + headshuntLength(head);
    const px = i => x1 + CONNECTOR * i; // i is 0-based point index
    const py = i => Y0 - ROW * i;
    const tracks = [{ id: 'H', role: 'headshunt', pts: [[X0, Y0], [x1, Y0]] }];
    const points = [];
    for (let i = 0; i < n - 1; i++) {
        const toe = i === 0 ? 'H.b' : `L${i}.b`;
        tracks.push({ id: `S${i + 1}`, role: 'siding', pts: [[px(i), py(i)], [px(i) + sidingLength(caps[i]), py(i)]] });
        if (i < n - 2) {
            tracks.push({ id: `L${i + 1}`, role: 'connector', pts: [[px(i), py(i)], [px(i + 1), py(i + 1)]] });
            points.push({ id: `P${i + 1}`, toe, straight: `S${i + 1}.a`, diverging: `L${i + 1}.a` });
        } else {
            // the last ladder piece bends into the final siding row
            const diag = Math.hypot(CONNECTOR, ROW);
            const rest = Math.max(1, sidingLength(caps[n - 1]) - diag);
            tracks.push({ id: `S${n}`, role: 'siding', pts: [[px(i), py(i)], [px(i + 1), py(i + 1)], [px(i + 1) + rest, py(i + 1)]] });
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
    const r = fan(xb + CONNECTOR, Y0, 'R.b', caps);
    return {
        id, name, goal: 'A', head: 'H',
        tracks: [
            { id: 'H', role: 'headshunt', pts: [[X0, Y0], [xa, Y0]] },
            { id: 'S', role: 'connector', pts: [[xa, Y0], [xb, Y0]] },
            { id: 'L', role: 'loop', pts: [[xa, Y0], [xa + SLANT_DX, Y0 - ROW], [xb - SLANT_DX, Y0 - ROW], [xb, Y0]] },
            { id: 'R', role: 'connector', pts: [[xb, Y0], [xb + CONNECTOR, Y0]] },
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
