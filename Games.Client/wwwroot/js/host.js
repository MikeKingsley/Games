// Bridge between the Blazor shell and a game module. See README "Adding a game" for the module contract.

const progressKey = id => `games.progress.${id}`;

function loadProgress(id) {
    try { return JSON.parse(localStorage.getItem(progressKey(id))) ?? {}; } catch { return {}; }
}

function saveProgress(id, value) {
    try { localStorage.setItem(progressKey(id), JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

export async function mountGame(gameId, modulePath, container, settings, dotNetRef, debug = false) {
    const module = await import(new URL(modulePath, document.baseURI).href);
    const options = {
        soundEnabled: settings.sound,
        speechEnabled: settings.speech,
        debug, // true in the Development environment (F5 in VS Code): games may show developer tools
        onExit: () => dotNetRef.invokeMethodAsync('Exit'),
        onReward: stars => dotNetRef.invokeMethodAsync('Rewarded', stars),
        loadProgress: () => loadProgress(gameId),
        saveProgress: value => saveProgress(gameId, value),
    };
    return module.mount(container, options);
}

export function updateGame(handle, settings) {
    handle?.setOptions?.({ soundEnabled: settings.sound, speechEnabled: settings.speech });
}

export function hardcoreGame(handle) {
    handle?.setOptions?.({ hardcore: true });
}

export function pauseGame(handle, paused) {
    handle?.setOptions?.({ paused });
}

export function unmountGame(handle) {
    handle?.unmount?.();
}
