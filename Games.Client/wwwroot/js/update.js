// Tells the page when a new service worker is waiting, and lets a grown-up switch to it.
// Pure of globals (everything is injected) so tests/js/update.test.mjs can drive it with mocks.

export const CHECK_EVERY_MS = 30 * 60 * 1000;
export const RELOAD_FALLBACK_MS = 3000;

/**
 * @param {object} env
 * @param {ServiceWorkerContainer} env.container  navigator.serviceWorker
 * @param {{ addEventListener: Function, visibilityState: string }} env.document
 * @param {{ reload: Function }} env.location
 * @param {(fn: Function, ms: number) => unknown} [env.setInterval]
 * @param {(fn: Function, ms: number) => unknown} [env.setTimeout]
 * @param {{ keys: Function, delete: Function }} [env.caches]
 */
export function createUpdater({ container, document, location, setInterval = globalThis.setInterval, setTimeout = globalThis.setTimeout, caches = globalThis.caches }) {
    const listeners = new Set();
    let waiting = null;
    let current = null; // the registration being watched
    let reloading = false;

    function announce(worker) {
        waiting = worker;
        for (const cb of listeners) cb();
    }

    // No controller means this is the first install: nothing is being replaced, so there is nothing to announce.
    function watch(registration) {
        current = registration;
        if (registration.waiting && container.controller) announce(registration.waiting);
        registration.addEventListener('updatefound', () => {
            const installing = registration.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
                if (installing.state === 'installed' && container.controller) announce(installing);
            });
        });
    }

    function startChecks(registration) {
        const check = () => registration.update().catch(() => { /* offline: try again later */ });
        check();
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
        setInterval(check, CHECK_EVERY_MS);
    }

    /** Calls cb now if an update is already waiting, and again whenever one arrives. Returns an unsubscribe function. */
    function onUpdateAvailable(cb) {
        listeners.add(cb);
        if (waiting) cb();
        return () => listeners.delete(cb);
    }

    /** Drops the stuck worker and the offline caches so the reload fetches the new version from the network. */
    async function forceFresh() {
        try {
            await current?.unregister();
            for (const key of (await caches?.keys()) ?? []) await caches.delete(key);
        } catch { /* reload anyway */ }
    }

    /**
     * Asks the waiting worker to take over, then reloads exactly once when it has.
     * If the browser never reports the switch, the old worker is still in charge, so a plain reload would just bring
     * the same update prompt back: clear the worker and caches first.
     */
    function applyUpdate() {
        const target = current?.waiting ?? waiting;
        if (!target) return false;
        let switched = false;
        const reloadOnce = () => {
            if (reloading) return;
            reloading = true;
            location.reload();
        };
        container.addEventListener('controllerchange', () => { switched = true; reloadOnce(); });
        target.postMessage({ type: 'SKIP_WAITING' });
        setTimeout(() => { if (!switched) forceFresh().then(reloadOnce); }, RELOAD_FALLBACK_MS);
        return true;
    }

    async function register(url, options) {
        const registration = await container.register(url, options);
        watch(registration);
        startChecks(registration);
        return registration;
    }

    return { register, watch, startChecks, onUpdateAvailable, applyUpdate };
}

/** Browser wiring: exposes window.gamesUpdate for the Blazor UpdateService. */
export function install(win = globalThis.window) {
    if (!win?.navigator?.serviceWorker) return null;
    const updater = createUpdater({ container: win.navigator.serviceWorker, document: win.document, location: win.location });
    updater.register('service-worker.js', { updateViaCache: 'none' }).catch(() => { /* no service worker here: app still works */ });
    win.gamesUpdate = {
        /** dotNetRef must expose a [JSInvokable] OnUpdateAvailable. */
        subscribe: dotNetRef => { updater.onUpdateAvailable(() => dotNetRef.invokeMethodAsync('OnUpdateAvailable')); },
        apply: () => updater.applyUpdate(),
    };
    return updater;
}
