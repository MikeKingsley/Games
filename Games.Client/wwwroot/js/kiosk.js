// Toddler-proofing: no context menu, pinch zoom or accidental text/image drag; go fullscreen on the first tap.
const block = e => e.preventDefault();

document.addEventListener('contextmenu', block);
document.addEventListener('dragstart', block);
document.addEventListener('gesturestart', block);
document.addEventListener('gesturechange', block);
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

document.addEventListener('pointerdown', () => {
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) root.requestFullscreen().catch(() => { /* not allowed here: ignore */ });
}, { once: true });
