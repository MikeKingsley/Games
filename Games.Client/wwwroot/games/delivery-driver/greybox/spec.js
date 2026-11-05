// Greybox test level (plan 0010 phase 6): the core set of road pieces as plain data, so the dev page, the validator and the
// drive-through tests all run against the same layout. Pure: no DOM, no GL. World units are metres, +x east, +y south.
//
// A road is an ordered list of points `pts` (the spline passes through them), a class and optional extras:
//   deck: [from, to]   a bridge deck between those distances along the road, raised `lift` m above the ground
// A junction names a point where three or more roads meet and how it is controlled ('giveway' | 'roundabout' | 'signals').
// Roads that meet at the same point share a node; a road passing over another does not (that is the overbridge).

/** Metres between piece centres, and half the length of a piece's arms. */
export const PIECE_SPACING = 300;
export const ARM = 100;
/** Height of the overbridge deck above the road below (clearance 5.5 m plus the 0.6 m slab, see world/crossings.js). */
export const DECK_LIFT = 6.1;

const at = (col, row) => ({ x: col * PIECE_SPACING, y: row * PIECE_SPACING });
const arm = (c, deg, len = ARM) => [c.x + Math.cos((deg * Math.PI) / 180) * len, c.y + Math.sin((deg * Math.PI) / 180) * len];
/** A 90 degree bend of radius `r` about (cx, cy), heading east then south, as points every 15 degrees. */
const bend = (cx, cy, r) => Array.from({ length: 7 }, (_, k) => [cx + r * Math.sin((k * Math.PI) / 12), cy - r * Math.cos((k * Math.PI) / 12)]);

const C = {
    straight: at(0, 0), curve: at(1, 0), crossroads: at(2, 0),
    tee: at(0, 1), roundabout: at(1, 1), overbridge: at(2, 1),
};

export const GREYBOX_SPEC = {
    year: 2024,
    /** The six pieces: where each sits (centre) and what it is called. Labels and the free camera's start points use these. */
    pieces: [
        { id: 'straight', label: 'Straight road', ...C.straight },
        { id: 'curve', label: 'Tight curve', ...C.curve },
        { id: 'crossroads', label: '4-way crossroads', ...C.crossroads },
        { id: 'tee', label: 'T junction', ...C.tee },
        { id: 'roundabout', label: '4-arm roundabout', ...C.roundabout },
        { id: 'overbridge', label: 'Overbridge', ...C.overbridge },
    ],
    junctions: [
        { id: 'crossroads', ...C.crossroads, kind: 'giveway' },
        { id: 'tee', ...C.tee, kind: 'giveway' },
        { id: 'roundabout', ...C.roundabout, kind: 'roundabout' },
    ],
    roads: [
        { id: 'straight', piece: 'straight', cls: 'A', pts: [[C.straight.x - ARM, C.straight.y], [C.straight.x + ARM, C.straight.y]] },
        {
            id: 'curve', piece: 'curve', cls: 'B',
            pts: [[C.curve.x - ARM, C.curve.y - 25], [C.curve.x - 50, C.curve.y - 25], ...bend(C.curve.x, C.curve.y, 25), [C.curve.x + 25, C.curve.y + 50], [C.curve.x + 25, C.curve.y + ARM]],
        },
        ...[0, 90, 180, 270].map(d => ({ id: `crossroads-${d}`, piece: 'crossroads', cls: d % 180 ? 'B' : 'A', pts: [[C.crossroads.x, C.crossroads.y], arm(C.crossroads, d)] })),
        ...[0, 90, 180].map(d => ({ id: `tee-${d}`, piece: 'tee', cls: d % 180 ? 'B' : 'A', pts: [[C.tee.x, C.tee.y], arm(C.tee, d)] })),
        ...[0, 90, 180, 270].map(d => ({ id: `roundabout-${d}`, piece: 'roundabout', cls: 'A', pts: [[C.roundabout.x, C.roundabout.y], arm(C.roundabout, d)] })),
        // the overbridge: an A road along the ground, a B road lifted over it (ramps up to the deck, 10% grade)
        { id: 'overbridge-under', piece: 'overbridge', cls: 'A', pts: [[C.overbridge.x - ARM, C.overbridge.y], [C.overbridge.x + ARM, C.overbridge.y]] },
        { id: 'overbridge-over', piece: 'overbridge', cls: 'B', pts: [[C.overbridge.x, C.overbridge.y - 140], [C.overbridge.x, C.overbridge.y + 140]], deck: [110, 170], ramp: 60 },
    ],
};

/** Roads of the spec that belong to a piece. */
export const roadsOf = (spec, pieceId) => spec.roads.filter(r => r.piece === pieceId);
