import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorld } from '../../Games.Client/wwwroot/games/delivery-driver/world/world.js';
import { createSession } from '../../Games.Client/wwwroot/games/delivery-driver/game/session.js';
import { migrate, createSaveStore, SAVE_VERSION, MAX_BYTES, makeSave } from '../../Games.Client/wwwroot/games/delivery-driver/game/save.js';
import { createTutorial, tutorialEvent, attachTutorial, STEPS, skipTutorial } from '../../Games.Client/wwwroot/games/delivery-driver/game/tutorial.js';
import { newFleetVehicle } from '../../Games.Client/wwwroot/games/delivery-driver/game/career.js';
import { buyTrailer } from '../../Games.Client/wwwroot/games/delivery-driver/game/dealer.js';
import { hirePool, hireDriver, assignVehicle } from '../../Games.Client/wwwroot/games/delivery-driver/game/fleet.js';
import { finishStop } from '../../Games.Client/wwwroot/games/delivery-driver/game/contracts.js';

const SEED = new URL('../../Games.Client/wwwroot/games/delivery-driver/world/seed/sw-england.json', import.meta.url);
const world = createWorld(JSON.parse(fs.readFileSync(SEED, 'utf8')));
const stubInput = () => ({ update: () => ({ throttle: 0, brake: 0, steer: 0 }), setOverride() {}, onAction() {} });

function memoryStorage() {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), map: m };
}

function session() {
    const s = createSession({ world });
    s.input = stubInput();
    s.newGame({ company: 'Tamar Valley Haulage' });
    return s;
}

const strip = save => { const c = structuredClone(save); delete c.savedAt; return c; };

test('a save loads back to the same state', () => {
    const s = session();
    s.career.ledger.money = 12345;
    s.debugHook().advanceClock(30);
    const depot = s.world.depots.find(d => d.home);
    s.acceptOffer(s.offersAt(depot)[0].id);
    finishStop(s.career.job); // loaded, out on the drops
    s.teleport(depot.x + 40, depot.y + 10, 1.2);
    const save = JSON.parse(JSON.stringify(makeSave(s)));

    const t = createSession({ world });
    t.input = stubInput();
    t.loadSave(migrate(save));
    assert.deepEqual(strip(makeSave(t)), strip(save));
    assert.equal(t.career.company, 'Tamar Valley Haulage');
    assert.equal(t.career.job.stop, 1);
    assert.ok(Math.abs(t.player.x - (depot.x + 40)) < 1e-9);
});

test('a version 1 save migrates to the current version', () => {
    const s = session();
    const v2 = makeSave(s);
    const v1 = structuredClone(v2);
    v1.version = 1;
    v1.career.money = v1.career.ledger.money;
    delete v1.career.ledger;
    delete v1.career.boards;
    delete v1.clientTrailers;
    v1.career.offersKey = 'depot-exeter:0';
    v1.career.refresh = 0;
    const m = migrate(v1);
    assert.equal(m.version, SAVE_VERSION);
    assert.equal(m.career.ledger.money, v2.career.ledger.money);
    assert.deepEqual(m.career.boards, {});
    assert.deepEqual(m.clientTrailers, []);
    assert.equal(m.career.offersKey, undefined);
    const t = createSession({ world });
    t.input = stubInput();
    t.loadSave(m); // loads without complaint
    assert.equal(t.career.company, 'Tamar Valley Haulage');
});

test('a slot stays under 500 KB after a busy career: 50 contracts, 10 vehicles, 20 dropped trailers', () => {
    const s = session();
    const c = s.career;
    c.ledger.money = 1e6;
    const depot = s.world.depots.find(d => d.home);
    for (let k = 0; k < 9; k++) c.fleet.push(newFleetVehicle(c, k % 2 ? 'kestrel-k38' : 'exe-75', 1990, depot.id, c.calendar.minutes));
    c.calendar.minutes += 60 * 24 * 366 * 71; // 1990
    for (let k = 0; k < 20; k++) {
        const { rec } = buyTrailer(c, 'curtain', depot.id);
        rec.pose = { x: depot.x + k, y: depot.y + k * 2, heading: k / 3 };
        rec.cargoMass = 1000 * k;
    }
    for (let k = 0; k < 5; k++) {
        const d = hireDriver(c, hirePool(c, s.world.region.seed)[0] ?? { id: `x${k}`, name: `Driver ${k}`, skill: 3, wage: 6 }, depot.id);
        assignVehicle(c, d.id, c.fleet[k + 1].id);
    }
    let done = 0;
    for (let day = 0; done < 50 && day < 60; day++) {
        s.debugHook().advanceClock(24);
        for (const offer of [...s.offersAt(depot)]) {
            if (done >= 50 || !s.acceptOffer(offer.id)) continue;
            while (s.career.job) s.debugHook().completeDrop();
            done++;
        }
    }
    assert.equal(done, 50);
    const store = createSaveStore(memoryStorage());
    const bytes = store.write(1, makeSave(s));
    assert.ok(bytes < MAX_BYTES, `${Math.round(bytes / 1024)} KB`);
    assert.equal(store.read(1).career.fleet.length, 10);
    assert.equal(store.read(1).career.trailers.length, 20);
});

test('the slot store keeps an index in the shell progress and survives export/import', () => {
    const storage = memoryStorage();
    let progress = {};
    const store = createSaveStore(storage, { load: () => progress, save: v => { progress = v; } });
    const s = session();
    store.write(2, makeSave(s));
    assert.deepEqual(progress.slots.map(x => x.slot), [2]);
    assert.equal(progress.last, 2);
    assert.equal(store.list()[1].company, 'Tamar Valley Haulage');
    const text = store.exportJson(2);
    store.importJson(3, text);
    assert.equal(store.read(3).career.company, 'Tamar Valley Haulage');
    store.remove(2);
    assert.ok(store.list()[1].empty);
    assert.throws(() => store.importJson(1, '{"version": 2, "career": {}}'));
});

test('the tutorial only advances on its own events', () => {
    const t = createTutorial();
    assert.equal(t.step, 0);
    for (const wrong of ['accepted', 'paid', 'officeOpened', 'loaded']) assert.equal(tutorialEvent(t, wrong), false);
    assert.equal(t.step, 0);
    for (const [k, step] of STEPS.entries()) {
        assert.equal(t.step, k);
        assert.equal(tutorialEvent(t, 'nonsense'), false);
        assert.equal(tutorialEvent(t, step.on), true);
    }
    assert.equal(t.done, true);
    assert.equal(tutorialEvent(t, 'moved'), false);
    const u = createTutorial();
    skipTutorial(u);
    assert.ok(u.done && u.skipped);
});

test('the tutorial follows a real first job', () => {
    const s = session();
    const t = createTutorial();
    attachTutorial(t, s);
    const depot = s.world.depots.find(d => d.home);
    // driving 20 m
    s.emit('step', { x: 0, y: 0 });
    s.emit('step', { x: 20, y: 0 });
    assert.equal(STEPS[t.step].id, 'office');
    s.emit('accepted', {}); // too early: the office comes first
    assert.equal(STEPS[t.step].id, 'office');
    s.emit('officeOpened', depot);
    const offer = s.offersAt(depot).find(o => o.type === 'multidrop');
    s.acceptOffer(offer.id);
    assert.equal(STEPS[t.step].id, 'bay');
    s.emit('startWork', s.career.job.contract.stops[0]);
    assert.equal(STEPS[t.step].id, 'loading');
    while (s.career.job) {
        const stop = s.career.job.contract.stops[s.career.job.stop];
        s.emit('startWork', stop);
        s.debugHook().completeDrop();
    }
    assert.equal(t.done, true);
});
