// Lane profiles: what a road looks like across its width. Maps an edge's class, oneway and dual flags (plus the town
// flag for pavements) to a lane layout, marking set and pavement setting. Pure logic: the mesh builders and the greybox
// spec read these profiles; vehicle AI does not use them. Traffic drives on the LEFT of the edge's centreline.
import { ROAD_CLASS, LANE_WIDTH, edgeClass } from './roadgraph.js';

/** Pavement settings a spec may use. */
export const PAVEMENT_MODES = ['both', 'left', 'right', 'none'];

const SIDES = {
    both: { left: true, right: true },
    left: { left: true, right: false },
    right: { left: false, right: true },
    none: { left: false, right: false },
};

/** Normalise a pavement setting (a mode string or a `{left, right}` object) to `{left, right}` booleans. */
export function pavementSides(p) {
    if (typeof p === 'string') return { ...(SIDES[p] ?? SIDES.none) };
    if (p && typeof p === 'object') return { left: !!p.left, right: !!p.right };
    return { ...SIDES.none };
}

/** Default pavement mode for a class: town, A and B roads and streets get both sides; lanes, access, M and ferry none. */
export function defaultPavement(cls, town = false) {
    if (cls === 'lane' || cls === 'access' || cls === 'M' || cls === 'ferry') return 'none';
    if (cls === 'dual') return town ? 'both' : 'none';
    return 'both'; // A, B, street
}

/**
 * The lane profile of an edge in a year.
 *
 * Lane types, from class, `oneway` and `dual` (no per-direction tags):
 *  - single track with passing places: a two-way `lane` (one shared lane, `singleTrack`, `passingPlaces`)
 *  - one lane one-way: a one-way road of 1 lane class (`lanesFwd` 1, `lanesBack` 0)
 *  - two lanes two-way: the usual road (1 each way, `centreLine`)
 *  - multi-lane one-way: a one-way dual or motorway (`lanesFwd` >= 2, `lanesBack` 0)
 *  - asymmetric: a two-way A or B road flagged `dual` gets a climbing or overtaking lane (2 forward, 1 back);
 *    two-way dual and motorway classes carry their class lane count each way
 *
 * Any field in `overrides` wins over the derived value. `pavements` in the result is `{left, right}`; an override may
 * give it as 'both' | 'left' | 'right' | 'none' or `{left, right}`. `width` (m) is the class width, widened if the
 * lanes would not fit.
 * @returns {{lanesFwd:number, lanesBack:number, singleTrack:boolean, passingPlaces:boolean, centreLine:boolean, edgeLines:boolean, pavements:{left:boolean,right:boolean}, width:number}}
 */
export function laneProfile(edge, year, overrides = {}) {
    const cls = edgeClass(edge, year);
    const info = ROAD_CLASS[cls] ?? ROAD_CLASS.street;
    const heavy = info.lanes >= 2; // dual carriageway or motorway
    let lanesFwd, lanesBack;
    if (edge.oneway) {
        lanesFwd = edge.dual && !heavy ? 2 : info.lanes;
        lanesBack = 0;
    } else if (heavy) {
        lanesFwd = lanesBack = info.lanes;
    } else if (edge.dual) {
        lanesFwd = 2; lanesBack = 1;
    } else {
        lanesFwd = lanesBack = 1;
    }
    const singleTrack = !edge.oneway && cls === 'lane';
    if (singleTrack) { lanesFwd = 1; lanesBack = 0; } // one shared lane, counted once in the forward direction
    const total = lanesFwd + lanesBack;
    const twoWay = !edge.oneway && !singleTrack;
    const derived = {
        lanesFwd,
        lanesBack,
        singleTrack,
        passingPlaces: singleTrack,
        centreLine: twoWay && lanesFwd === 1 && lanesBack === 1, // only plain two-lane two-way roads
        edgeLines: true,
        pavements: defaultPavement(cls, !!edge.town),
        width: Math.max(info.width, total * LANE_WIDTH),
    };
    const out = { ...derived, ...overrides };
    out.pavements = pavementSides(overrides.pavements ?? derived.pavements);
    return out;
}
