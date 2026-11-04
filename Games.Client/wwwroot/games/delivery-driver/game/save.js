// Save games: three slots in localStorage (games.dd.slot1-3), with a small index of them in the shell's progress
// store (games.progress.delivery-driver). The world is rebuilt from the region seed, so a save only holds what the
// player changed: the career (money, calendar, fleet, trailers, drivers, loans, depots, reputation, the job) and
// where things stand. Versioned: version 3 (terrain, hills and slope physics, plan 0007) dropped older saves with
// no migration (the game is still in early development); they read as an empty slot with a notice.

export const SAVE_VERSION = 3;
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
 * (the company's positions are on their records; client trailers of the current job are listed). Dropped trailers
 * keep x, y, heading and whether their parking brake is on; heights are not saved (they settle onto the ground
 * on load).
 */
export function makeSave(session) {
    const p = session.player;
    const clientTrailers = [...(session.trailerObjs?.values() ?? [])]
        .filter(t => t.client && t.id !== 'practice-trailer')
        .map(t => ({ id: t.id, model: t.spec.id, x: t.x, y: t.y, heading: t.heading, cargoMass: t.cargoMass, coupled: t.coupled, parkBrake: t.parkBrake !== false }));
    for (const t of session.trailerObjs?.values() ?? []) {
        if (t.rec) Object.assign(t.rec, t.coupled ? { pose: null } : { pose: { x: t.x, y: t.y, heading: t.heading }, parkBrake: t.parkBrake !== false }, { cargoMass: t.cargoMass });
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

/** A save from before the current version (it can't be loaded: older saves are dropped, not migrated). */
export const isOutdated = data => !!data && typeof data === 'object' && Number.isFinite(data.version) && data.version >= 1 && data.version < SAVE_VERSION;

/**
 * Checks a save can be loaded and returns a copy. Saves from before version 3 are dropped (the world and its
 * physics changed): they throw, as do newer or foreign files. Future versions migrate from 3 here.
 */
export function migrate(data) {
    if (isOutdated(data)) throw new Error('That save is from an earlier version of the game and can’t be loaded');
    if (!data || typeof data !== 'object' || data.version !== SAVE_VERSION) throw new Error('Not a Delivery Driver save');
    return structuredClone(data);
}

/** One line for the slot list. */
export function summary(data) {
    const c = data.career;
    return { company: c.company, year: data.year, money: c.ledger.money, savedAt: data.savedAt, retired: !!c.retired, vehicles: c.fleet.length };
}

/**
 * localStorage-backed slots; `progress` is the shell's {load(), save(obj)} for the index. A slot holding a save from
 * an earlier version reads as no save; list() marks it `outdated` (shown as an empty slot with a notice until a new
 * game or an import overwrites it, or it is deleted).
 */
export function createSaveStore(storage = globalThis.localStorage, progress = null) {
    const parse = slot => {
        try { const raw = storage.getItem(key(slot)); return raw ? JSON.parse(raw) : null; } catch { return null; }
    };
    const read = slot => {
        const data = parse(slot);
        try { return data ? migrate(data) : null; } catch { return null; }
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
        list: () => SLOTS.map(slot => {
            const d = read(slot);
            if (d) return { slot, ...summary(d) };
            return isOutdated(parse(slot)) ? { slot, empty: true, outdated: true } : { slot, empty: true };
        }),
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
