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
    // plan 0011 phase 4: the road types, two rows below the original six
    singleTrack: at(0, 2), oneWayLane: at(1, 2), twoWay: at(2, 2),
    multiOneWay: at(0, 3), asymmetric: at(1, 3), noPavement: at(2, 3),
    // plan 0011 phase 5: junction layouts, a row below the road types
    signalsCross: at(0, 4), teeGiveWay: at(1, 4), giveWayCross: at(2, 4), crossroadsPlain: at(3, 4),
};
/** A straight road through a piece's centre, `ARM` each way. `extra` sets cls, oneway, dual, town and the `profile` overrides. */
const through = (id, c, extra) => ({ id, piece: id, pts: [[c.x - ARM, c.y], [c.x + ARM, c.y]], ...extra });

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
        { id: 'single-track', label: 'Single track', ...C.singleTrack },
        { id: 'one-way-lane', label: 'One lane one way', ...C.oneWayLane },
        { id: 'two-way', label: 'Two way + pavements', ...C.twoWay },
        { id: 'multi-one-way', label: 'Three lanes one way', ...C.multiOneWay },
        { id: 'asymmetric', label: 'Asymmetric 2+1', ...C.asymmetric },
        { id: 'no-pavement', label: 'No pavement', ...C.noPavement },
        { id: 'signals-cross', label: 'Signals (crossroads)', ...C.signalsCross },
        { id: 'tee-give-way', label: 'T junction, give way', ...C.teeGiveWay },
        { id: 'give-way-cross', label: 'Crossroads, give way', ...C.giveWayCross },
        { id: 'crossroads-plain', label: 'Crossroads, uncontrolled', ...C.crossroadsPlain },
    ],
    junctions: [
        { id: 'crossroads', ...C.crossroads, kind: 'giveway' },
        { id: 'tee', ...C.tee, kind: 'giveway' },
        { id: 'roundabout', ...C.roundabout, kind: 'roundabout' },
        // `priority` marks a junction whose lower-ranked arms give way (dashed line + triangle); unset, the graph decides from the classes
        { id: 'signals-cross', ...C.signalsCross, kind: 'signals' },
        { id: 'tee-give-way', ...C.teeGiveWay, kind: 'giveway', priority: true },
        { id: 'give-way-cross', ...C.giveWayCross, kind: 'giveway', priority: true },
        { id: 'crossroads-plain', ...C.crossroadsPlain, kind: 'giveway', priority: false },
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
        // lane types and pavements: `profile` overrides the rule-based defaults of world/lane-profile.js (marking and pavement per road)
        through('single-track', C.singleTrack, { cls: 'lane', profile: { passingPlaces: [60, 140], edgeLines: true, pavements: 'none' } }),
        through('one-way-lane', C.oneWayLane, { cls: 'street', oneway: true, profile: { lanesFwd: 1, lanesBack: 0, centreLine: false, pavements: 'right' } }),
        through('two-way', C.twoWay, { cls: 'B', town: true, profile: { centreLine: true, edgeLines: true, pavements: 'both' } }),
        through('multi-one-way', C.multiOneWay, { cls: 'dual', oneway: true, profile: { lanesFwd: 3, lanesBack: 0, centreLine: false, pavements: 'none' } }),
        through('asymmetric', C.asymmetric, { cls: 'A', dual: true, profile: { lanesFwd: 2, lanesBack: 1, centreLine: false, pavements: 'none' } }),
        through('no-pavement', C.noPavement, { cls: 'B', profile: { centreLine: true, edgeLines: true, pavements: 'none' } }),
        // junction layouts: an A road through the middle and B side roads (the uncontrolled crossroads has the same classes but no priority)
        ...[0, 90, 180, 270].map(d => ({ id: `signals-cross-${d}`, piece: 'signals-cross', cls: d % 180 ? 'B' : 'A', pts: [[C.signalsCross.x, C.signalsCross.y], arm(C.signalsCross, d)] })),
        ...[0, 90, 180].map(d => ({ id: `tee-give-way-${d}`, piece: 'tee-give-way', cls: d % 180 ? 'B' : 'A', pts: [[C.teeGiveWay.x, C.teeGiveWay.y], arm(C.teeGiveWay, d)] })),
        ...[0, 90, 180, 270].map(d => ({ id: `give-way-cross-${d}`, piece: 'give-way-cross', cls: d % 180 ? 'B' : 'A', pts: [[C.giveWayCross.x, C.giveWayCross.y], arm(C.giveWayCross, d)] })),
        ...[0, 90, 180, 270].map(d => ({ id: `crossroads-plain-${d}`, piece: 'crossroads-plain', cls: d % 180 ? 'B' : 'A', pts: [[C.crossroadsPlain.x, C.crossroadsPlain.y], arm(C.crossroadsPlain, d)] })),
    ],
};

/** Roads of the spec that belong to a piece. */
export const roadsOf = (spec, pieceId) => spec.roads.filter(r => r.piece === pieceId);
