// Save games: three slots in localStorage (games.dd.slot1-3), with a small index of them in the shell's progress
// store (games.progress.delivery-driver). The world is rebuilt from the region seed, so a save only holds what the
// player changed: the career (money, calendar, fleet, trailers, drivers, loans, depots, reputation, the job) and
// where things stand. Versioned, with migrations from older versions.

export const SAVE_VERSION = 2;
export const SLOTS = [1, 2, 3];
export const MAX_BYTES = 500 * 1024;
const key = slot => `games.dd.slot${slot}`;

/** Drops what can be rebuilt (offer lists, long driver routes) and keeps the rest as plain data. */
export function serializeCareer(career) {
    const c = structuredClone(career);
    c.offers = [];
    for (const b of Object.values(c.boards ?? {})) b.offers = []; // offers regenerate from the seed; `taken` stays
    for (const d of c.drivers ?? []) if (d.job?.path) d.job.path = thin(d.job.path, 120);
    return c;
}

/** Keeps at most `max` points of a flat polyline (for the map marker of a driver out on a job). */
function thin(pts, max) {
    const n = pts.length / 2;
    if (n <= max) return pts;
    const out = [];
    for (let i = 0; i < max; i++) { const k = Math.round((i * (n - 1)) / (max - 1)); out.push(pts[2 * k], pts[2 * k + 1]); }
    return out;
}

/**
 * A save from the running game. `world` state that matters: the player's pose, and trailers in the world
 * (the company's positions are on their records; client trailers of the current job are listed).
 */
export function makeSave(session) {
    const p = session.player;
    const clientTrailers = [...(session.trailerObjs?.values() ?? [])]
        .filter(t => t.client && t.id !== 'practice-trailer')
        .map(t => ({ id: t.id, model: t.spec.id, x: t.x, y: t.y, heading: t.heading, cargoMass: t.cargoMass, coupled: t.coupled }));
    for (const t of session.trailerObjs?.values() ?? []) {
        if (t.rec) Object.assign(t.rec, t.coupled ? { pose: null } : { pose: { x: t.x, y: t.y, heading: t.heading } }, { cargoMass: t.cargoMass });
    }
    if (p.rec) p.rec.pose = null;
    const back = session.practiceReturn ? session.world.depots.find(d => d.id === session.practiceReturn.depot)?.yard.marker : null;
    return {
        version: SAVE_VERSION,
        savedAt: Date.now(),
        year: session.year,
        career: serializeCareer(session.career),
        player: back ? { x: back.x, y: back.y, heading: back.heading, atDepot: session.practiceReturn.depot } : { x: p.x, y: p.y, heading: p.heading },
        cargoMass: p.cargoMass,
        clientTrailers,
    };
}

/** Upgrades an older save to the current version. */
export function migrate(data) {
    let d = structuredClone(data);
    if (!d.version || d.version < 1) throw new Error('Not a Delivery Driver save');
    if (d.version === 1) {
        // v1 kept one offer list and no boards, money on the career, and no client trailer list
        const c = d.career;
        if (c.money !== undefined && !c.ledger) { c.ledger = { money: c.money, entries: [] }; delete c.money; }
        c.boards ??= {};
        delete c.offersKey;
        delete c.refresh;
        c.offers = [];
        c.drivers ??= [];
        c.trailers ??= [];
        c.loans ??= [];
        c.reputation ??= { points: 0 };
        c.bankruptcy ??= { stage: 0 };
        d.clientTrailers ??= [];
        d.version = 2;
    }
    return d;
}

/** One line for the slot list. */
export function summary(data) {
    const c = data.career;
    return { company: c.company, year: data.year, money: c.ledger.money, savedAt: data.savedAt, retired: !!c.retired, vehicles: c.fleet.length };
}

/** localStorage-backed slots; `progress` is the shell's {load(), save(obj)} for the index. */
export function createSaveStore(storage = globalThis.localStorage, progress = null) {
    const read = slot => {
        try { const raw = storage.getItem(key(slot)); return raw ? migrate(JSON.parse(raw)) : null; } catch { return null; }
    };
    const store = {
        read,
        write(slot, data) {
            const json = JSON.stringify(data);
            if (json.length > MAX_BYTES) throw new Error(`Save too big (${Math.round(json.length / 1024)} KB)`);
            storage.setItem(key(slot), json);
            store.writeIndex(slot);
            return json.length;
        },
        remove(slot) { storage.removeItem(key(slot)); store.writeIndex(); },
        list: () => SLOTS.map(slot => { const d = read(slot); return { slot, ...(d ? summary(d) : { empty: true }) }; }),
        writeIndex(last) {
            if (!progress) return;
            const prev = progress.load?.() ?? {};
            progress.save?.({ ...prev, last: last ?? prev.last ?? null, slots: store.list().filter(s => !s.empty).map(({ slot, company, year, retired }) => ({ slot, company, year, retired })) });
        },
        lastSlot: () => progress?.load?.()?.last ?? null,
        /** A save as a downloadable JSON string. */
        exportJson: slot => JSON.stringify(read(slot), null, 1),
        /** Imports a save file's text into a slot (migrating it). */
        importJson(slot, text) {
            const data = migrate(JSON.parse(text));
            if (!data.career?.fleet || !data.career?.calendar) throw new Error('Not a Delivery Driver save');
            return store.write(slot, data);
        },
    };
    return store;
}
