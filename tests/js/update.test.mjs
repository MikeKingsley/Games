import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createUpdater, CHECK_EVERY_MS, RELOAD_FALLBACK_MS } from '../../Games.Client/wwwroot/js/update.js';

function emitter() {
    const handlers = {};
    return {
        addEventListener: (type, fn) => { (handlers[type] ??= []).push(fn); },
        emit: (type) => (handlers[type] ?? []).forEach(fn => fn()),
    };
}

function setup({ controller = {}, waiting = null } = {}) {
    const container = Object.assign(emitter(), { controller, register: async () => registration });
    const registration = Object.assign(emitter(), { waiting, installing: null, updates: 0, unregistered: 0, unregister() { this.unregistered++; return Promise.resolve(true); }, update() { this.updates++; return Promise.resolve(); } });
    const document = Object.assign(emitter(), { visibilityState: 'visible' });
    const location = { reloads: 0, reload() { this.reloads++; } };
    const intervals = [];
    const timeouts = [];
    const caches = { deleted: [], keys: async () => ['offline-cache-1'], delete: async function (k) { this.deleted.push(k); } };
    const updater = createUpdater({ container, document, location, setInterval: (fn, ms) => intervals.push({ fn, ms }), setTimeout: (fn, ms) => timeouts.push({ fn, ms }), caches });
    return { container, registration, document, location, intervals, timeouts, caches, updater };
}

const worker = () => Object.assign(emitter(), { state: 'installing', sent: [], postMessage(m) { this.sent.push(m); } });

test('a worker already waiting at load is announced', () => {
    const w = worker();
    const { updater, registration } = setup({ waiting: w });
    let calls = 0;
    updater.onUpdateAvailable(() => calls++);
    updater.watch(registration);
    assert.equal(calls, 1);
});

test('updatefound then installed is announced when a controller exists', () => {
    const { updater, registration } = setup();
    let calls = 0;
    updater.onUpdateAvailable(() => calls++);
    updater.watch(registration);
    const w = worker();
    registration.installing = w;
    registration.emit('updatefound');
    w.state = 'installed';
    w.emit('statechange');
    assert.equal(calls, 1);
});

test('first install (no controller) is not announced', () => {
    const { updater, registration } = setup({ controller: null });
    let calls = 0;
    updater.onUpdateAvailable(() => calls++);
    updater.watch(registration);
    const w = worker();
    registration.installing = w;
    registration.emit('updatefound');
    w.state = 'installed';
    w.emit('statechange');
    assert.equal(calls, 0);
});

test('late subscribers are told about an update that is already waiting', () => {
    const { updater, registration } = setup({ waiting: worker() });
    updater.watch(registration);
    let calls = 0;
    updater.onUpdateAvailable(() => calls++);
    assert.equal(calls, 1);
});

test('applyUpdate posts SKIP_WAITING and reloads once on controllerchange', () => {
    const w = worker();
    const { updater, registration, container, location } = setup({ waiting: w });
    updater.watch(registration);
    assert.equal(updater.applyUpdate(), true);
    assert.deepEqual(w.sent, [{ type: 'SKIP_WAITING' }]);
    assert.equal(location.reloads, 0);
    container.emit('controllerchange');
    container.emit('controllerchange');
    assert.equal(location.reloads, 1);
});

test('applyUpdate with nothing waiting does nothing', () => {
    assert.equal(setup().updater.applyUpdate(), false);
});

test('startChecks updates now, when the tab becomes visible, and on a timer', () => {
    const { updater, registration, document, intervals } = setup();
    updater.startChecks(registration);
    assert.equal(registration.updates, 1);
    document.visibilityState = 'hidden';
    document.emit('visibilitychange');
    assert.equal(registration.updates, 1);
    document.visibilityState = 'visible';
    document.emit('visibilitychange');
    assert.equal(registration.updates, 2);
    assert.equal(intervals[0].ms, CHECK_EVERY_MS);
    intervals[0].fn();
    assert.equal(registration.updates, 3);
});

test('if controllerchange never arrives, the worker and caches are cleared before reloading, once', async () => {
    const { updater, registration, container, location, timeouts, caches } = setup({ waiting: worker() });
    updater.watch(registration);
    updater.applyUpdate();
    assert.equal(timeouts[0].ms, RELOAD_FALLBACK_MS);
    timeouts[0].fn();
    await new Promise(r => setImmediate(r));
    assert.equal(registration.unregistered, 1);
    assert.deepEqual(caches.deleted, ['offline-cache-1']);
    assert.equal(location.reloads, 1);
    container.emit('controllerchange');
    assert.equal(location.reloads, 1);
});

test('the fallback does nothing when the switch was reported', async () => {
    const { updater, registration, container, location, timeouts } = setup({ waiting: worker() });
    updater.watch(registration);
    updater.applyUpdate();
    container.emit('controllerchange');
    timeouts[0].fn();
    await new Promise(r => setImmediate(r));
    assert.equal(registration.unregistered, 0);
    assert.equal(location.reloads, 1);
});

test('applyUpdate targets the current waiting worker of the registration, not a stale one', () => {
    const stale = worker();
    const fresh = worker();
    const { updater, registration } = setup({ waiting: stale });
    updater.watch(registration);
    registration.waiting = fresh;
    updater.applyUpdate();
    assert.deepEqual(fresh.sent, [{ type: 'SKIP_WAITING' }]);
    assert.deepEqual(stale.sent, []);
});
