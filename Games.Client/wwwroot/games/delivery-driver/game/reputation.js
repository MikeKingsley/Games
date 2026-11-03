// Reputation: points for the company and for each client, earned by on-time, undamaged deliveries and lost by
// late, damaged or abandoned jobs. Company tiers unlock bigger contracts, longer routes and depot purchases.

export const TIERS = [
    { name: 'Local Carrier', at: 0, range: 3000, haulage: false, special: false, depots: false },
    { name: 'District Haulier', at: 40, range: 6000, haulage: true, special: true, depots: false },
    { name: 'Regional Haulier', at: 120, range: 10000, haulage: true, special: true, depots: true },
    { name: 'County Haulage Co.', at: 300, range: 16000, haulage: true, special: true, depots: true },
    { name: 'National Haulage', at: 700, range: Infinity, haulage: true, special: true, depots: true },
];

/** Tier index for a points total. */
export function tierOf(points) {
    let t = 0;
    for (let i = 0; i < TIERS.length; i++) if (points >= TIERS[i].at) t = i;
    return t;
}

export const tierInfo = points => TIERS[tierOf(points)];
export const nextTier = points => TIERS[tierOf(points) + 1] ?? null;

/** Points for a finished job: on time +3 (late -3), undamaged +1 (damaged -2), plus 1 per 2 stops. */
export function jobPoints(result, cargoDamage, stops) {
    return (result.onTime ? 3 : -3) + (cargoDamage > 0 ? -2 : 1) + Math.floor(stops / 2);
}
export const ABANDON_POINTS = -5;

/** Applies points to the company and a client (company points never drop below zero). */
export function addReputation(career, clientId, points) {
    const rep = (career.reputation ??= { points: 0 });
    const before = tierOf(rep.points);
    rep.points = Math.max(0, rep.points + points);
    if (clientId) {
        const c = (career.clients[clientId] ??= { name: clientId, jobs: 0, onTime: 0, damaged: 0, abandoned: 0 });
        c.rep = (c.rep ?? 0) + points;
    }
    const after = tierOf(rep.points);
    return after > before ? TIERS[after] : null; // the new tier, if one was reached
}

/** A client's standing as a word for the UI. */
export function clientStanding(rep = 0) {
    if (rep >= 30) return 'Loyal';
    if (rep >= 10) return 'Happy';
    if (rep > -5) return 'Neutral';
    return 'Unhappy';
}
