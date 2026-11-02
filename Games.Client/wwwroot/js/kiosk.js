// Toddler-proofing: no context menu, pinch zoom or accidental text/image drag.
// Fullscreen is a grown-ups setting (games.settings.fullscreen, off by default): when on, the first tap of each page load goes fullscreen.
const block = e => e.preventDefault();

document.addEventListener('contextmenu', block);
document.addEventListener('dragstart', block);
document.addEventListener('gesturestart', block);
document.addEventListener('gesturechange', block);
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

const wantsFullscreen = () => {
    try { return JSON.parse(localStorage.getItem('games.settings'))?.fullscreen === true; } catch { return false; }
};

function enterFullscreen() {
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) root.requestFullscreen().catch(() => { /* not allowed here: ignore */ });
}

document.addEventListener('pointerdown', () => { if (wantsFullscreen()) enterFullscreen(); }, { once: true });

// Called by the shell when the setting is switched, from inside the tap that switched it (fullscreen needs a user gesture).
window.kiosk = {
    setFullscreen(on) {
        if (on) enterFullscreen();
        else if (document.fullscreenElement) document.exitFullscreen().catch(() => { /* already out */ });
    },
};
