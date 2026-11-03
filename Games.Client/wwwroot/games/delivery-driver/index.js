// Delivery Driver: a faux-3D haulage career game set in Devon and Cornwall. See README "Delivery Driver".
// This file wires the pure logic (sim/, world/, game/, traffic/) to the canvas renderer, DOM overlays and audio.
import { createLoop } from './engine/loop.js';
import { createInput } from './engine/input.js';
import { createCamera } from './engine/camera.js';
import { createTouchControls } from './ui/touch-controls.js';
import { createSession } from './game/session.js';
import { createRenderer } from './render/renderer.js';
import { createHud } from './ui/hud.js';
import { createMenus } from './ui/menus.js';
import { createSound } from './audio/sound.js';
import { QUALITY, AUTOSAVE_SECONDS } from './config.js';
import { createSaveStore } from './game/save.js';
import { registerStartScreens, loadSettings, saveSettings } from './ui/start.js';
import { createTutorial, attachTutorial, skipTutorial } from './game/tutorial.js';
import { formatMoney } from './game/economy.js';
import { escape } from './ui/hud.js';

export function mount(container, options = {}) {
    let soundEnabled = options.soundEnabled ?? true;
    let shellPaused = false;
    const abort = new AbortController();
    const { signal } = abort;
    const timers = new Set();

    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('./styles.css', import.meta.url).href;
    document.head.appendChild(stylesheet);

    const root = document.createElement('div');
    root.className = 'dd-root';
    const canvas = document.createElement('canvas');
    canvas.className = 'dd-canvas';
    root.appendChild(canvas);
    container.appendChild(root);
    const ctx = canvas.getContext('2d');

    // DPR-aware sizing: the backing store follows the element's CSS size times devicePixelRatio (capped by quality)
    const view = { width: 1, height: 1, dpr: 1 };
    function resize() {
        const rect = root.getBoundingClientRect();
        const maxDpr = QUALITY[session.settings.quality]?.maxDpr ?? 2;
        view.dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
        view.width = Math.max(1, rect.width);
        view.height = Math.max(1, rect.height);
        canvas.width = Math.round(view.width * view.dpr);
        canvas.height = Math.round(view.height * view.dpr);
        root.classList.toggle('portrait', view.height > view.width * 1.1);
    }
    const resizeObserver = new ResizeObserver(resize);

    const sound = createSound(soundEnabled);
    const session = createSession({ options, sound, timers });
    session.settings = loadSettings();
    const camera = createCamera();
    camera.mode = session.settings.camera === 'north' ? 'north' : 'chase';
    const input = createInput(window, signal);
    const touch = createTouchControls(root, input, signal);
    const renderer = createRenderer(ctx, view);
    let menus = null;
    const hud = createHud(root, { onMinimap: () => menus.open('map') });
    menus = createMenus(root, session, signal);

    session.attach({ input, camera, menus, hud, renderer, root });
    touch.setLayout(session.settings.touchLayout);
    wireUi();

    // ---- saves, the start menu, the tutorial and settings --------------------------------------------------------
    const store = createSaveStore(localStorage, { load: () => options.loadProgress?.() ?? {}, save: v => options.saveProgress?.(v) });
    let slot = null;
    let detachTutorial = null;
    function saveNow() {
        if (!slot || !session.world) return false;
        try { store.write(slot, session.makeSave()); return true; } catch { return false; }
    }
    function startGame(n, data, form = {}) {
        slot = n;
        detachTutorial?.();
        session.tutorial = null;
        if (data) session.loadSave(data);
        else {
            session.newGame(form);
            if (form.tutorial) { session.tutorial = createTutorial(true); detachTutorial = attachTutorial(session.tutorial, session); }
            saveNow();
        }
    }
    function applySettings(next) {
        session.settings = next;
        saveSettings(next);
        session.applyQuality(next.quality);
        resize();
        camera.mode = next.camera === 'north' ? 'north' : 'chase';
        touch.setLayout(next.touchLayout);
        session.player.gearbox.manual = !!next.manualGears;
    }
    function download(name, text) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    registerStartScreens(menus, {
        session, store, startGame, saveNow, applySettings, download, slot: () => slot,
        skipTutorial: () => { if (session.tutorial) skipTutorial(session.tutorial); },
    });
    session.ready.then(() => { if (session.world && !slot) menus.open('slots', {}); });
    session.on('debugStart', () => { menus.close(); slot = null; });
    session.on('complete', () => saveNow()); // autosave after every delivery
    const autosave = setInterval(() => { if (!session.paused) saveNow(); }, AUTOSAVE_SECONDS * 1000);
    session.on('weekly', e => {
        if (e.kind !== 'gameOver') return;
        saveNow(); // kept as a read-only "retired" record
        slot = null;
        menus.open('slots', { note: `${session.career.company} has gone bust. Start a new company (the old one is kept as a record).` });
    });

    const menuButton = document.createElement('button');
    menuButton.className = 'dd-menu-btn';
    menuButton.type = 'button';
    menuButton.title = 'Game menu (Esc)';
    menuButton.textContent = '☰';
    menuButton.addEventListener('click', () => { if (slot || session.career) menus.open('game'); }, { signal });
    root.appendChild(menuButton);
    resize();
    resizeObserver.observe(root);

    // the AudioContext may only start after a user gesture
    const unlock = () => sound.unlock();
    window.addEventListener('pointerdown', unlock, { signal });
    window.addEventListener('keydown', unlock, { signal });

    let stepMs = 0;
    let wasMoving = false;
    const loop = createLoop({
        step: dt => {
            const t0 = performance.now();
            session.step(dt);
            stepMs += performance.now() - t0;
        },
        render: alpha => {
            const t0 = performance.now();
            session.updateCamera(camera, view);
            renderer.draw(session, camera, alpha);
            hud.update(session, camera);
            touch.update(session);
            const pl = session.player;
            if (session.world) {
                sound.engine(pl.gearbox.rpm, session.controls?.throttle ?? 0, pl.spec.voice, !session.paused);
                sound.indicator(!!session.indicator && !session.paused);
                // reversing beeper (1980s+ vehicles), air brakes sighing as a big lorry stops, rain and moorland wind
                sound.beeper(!!pl.spec.beeper && pl.speed < -0.1 && !session.paused);
                if (pl.spec.airBrakes && wasMoving && Math.abs(pl.speed) < 0.05 && (session.controls?.brake ?? 0) > 0) sound.airBrake();
                wasMoving = Math.abs(pl.speed) > 1.5 || (wasMoving && Math.abs(pl.speed) >= 0.05);
                const w = session.weather;
                sound.ambience(session.paused ? 0 : w?.kind === 'rain' ? 0.4 + 0.6 * w.intensity : w?.kind === 'fog' ? 0.15 : 0.05);
            }
            session.renderStats = renderer.stats;
            if (session.world) session.recordFrame(performance.now() - t0 + stepMs); // CPU time per frame (sim + draw)
            stepMs = 0;
        },
    });
    loop.start();

    /** Player actions that open menus or change the HUD, and game events shown as toasts/sounds. */
    function wireUi() {
        input.onAction((name, down) => {
            if (!session.world) return;
            if (menus.isOpen) { if (name === 'map' || name === 'jobs') menus.close(); return; }
            if (name === 'escape') { menus.open('game'); return; }
            const p = session.player;
            if (name === 'interact') {
                const yard = session.world.yardAt(p.x, p.y);
                const owned = yard?.type === 'depot' && session.career.depots.includes(yard.id);
                if (session.inPractice) { menus.open('practice'); return; }
                if (session.interact?.()) return; // tow or ferry first
                if ((owned || yard?.type === 'garage') && Math.abs(p.speed) >= 0.5) hud.toast('Stop in the yard first');
                else if (owned) { p.rec.depot = yard.id; menus.open('depot', { depot: yard }); session.emit('officeOpened', yard); } // driving a vehicle to a depot moves it there
                else if (yard?.type === 'garage') menus.open('garage', { garage: yard });
            } else if (name === 'jobs') menus.open('job');
            else if (name === 'map') menus.open('map');
            else if (name === 'indicateLeft' || name === 'indicateRight') {
                const side = name === 'indicateLeft' ? 'left' : 'right';
                session.indicator = session.indicator === side ? null : side;
                session.indicatorHeading = p.heading;
            } else if (name === 'horn') sound.horn(down);
        });
        session.on('startWork', stop => sound.clunk());
        session.on('stopDone', job => { if (!job.done) { sound.clunk(); hud.toast(`${job.contract.stops[job.stop - 1].action === 'load' ? 'Loaded' : 'Delivered'}. Next: ${job.contract.stops[job.stop].name}`); } });
        session.on('complete', ({ contract, result }) => {
            sound.kaching();
            const parts = [`Paid <b>${formatMoney(result.total)}</b> for ${escape(contract.title)}`];
            if (result.bonus) parts.push(`early bonus +${formatMoney(result.bonus)}`);
            if (result.late) parts.push(`late −${formatMoney(result.late)}`);
            if (result.damage) parts.push(`damage −${formatMoney(result.damage)}`);
            hud.toast(parts.join('<br>'), 4500);
        });
        session.on('tier', tier => hud.toast(`⭐ Your company is now a <b>${escape(tier.name)}</b>!`, 5000));
        session.on('weekly', e => {
            if (e.kind === 'bailout') hud.toast(`🏦 In the red: the bank forced a bailout loan of ${formatMoney(e.amount)}`, 6000);
            else if (e.kind === 'forcedSale') hud.toast(`🏦 Still in the red: a vehicle was sold for ${formatMoney(e.amount)}`, 6000);
            else if (e.kind === 'gameOver') hud.toast('The company has gone bust. Start again from the save menu.', 10000);
        });
        session.on('aiPaid', e => hud.toast(`🚚 ${escape(e.driver)} finished ${escape(e.title)} (${formatMoney(e.amount)} after fuel)`, 3500));
        session.on('aiStarted', e => hud.toast(`🚚 ${escape(e.driver)} is off: ${escape(e.title)}`, 2500));
        session.on('accepted', job => hud.toast(`Job accepted: ${escape(job.contract.title)}`));
        session.on('newYear', year => hud.toast(`Happy New Year! It's ${year}.`, 3500));
        session.on('impact', impact => { if (impact > 2) sound.bump(impact); });
        session.on('toast', text => hud.toast(escape(text)));
        session.on('coupled', () => sound.coupling());
        session.on('uncoupled', () => sound.coupling());
        session.on('jackknife', () => { sound.bump(6); hud.toast('Jack-knifed! Drive forward to straighten up.', 3000); });
        session.on('weather', w => hud.toast(`The weather turns: ${w.kind}`, 2500));
        session.on('news', text => hud.toast(`📰 ${escape(text)}`, 5000));
        session.on('ferry', ({ slip, minutes }) => { sound.ferryHorn(); hud.toast(`⛴️ Crossed on the ${escape(slip.name)} (${Math.round(minutes)} min, ${formatMoney(slip.fee)})`, 3500); });
    }

    function setPaused() {
        const paused = shellPaused || session.menuOpen;
        session.setPaused(paused);
        sound.setSuspended(shellPaused);
    }
    session.onMenuChange = setPaused;

    if (options.debug) window.__dd = session.debugHook();

    return {
        setOptions(next) {
            if (next.soundEnabled !== undefined) { soundEnabled = next.soundEnabled; sound.setEnabled(soundEnabled); }
            if (next.paused !== undefined) {
                shellPaused = next.paused;
                if (shellPaused) loop.stop(); else loop.start();
                setPaused();
            }
            // { hardcore } is never sent: registry.json switches the shell's Hardcore Mode off for this game
        },
        unmount() {
            saveNow();
            clearInterval(autosave);
            session.dispose();
            loop.stop();
            abort.abort();
            resizeObserver.disconnect();
            timers.forEach(clearTimeout);
            timers.clear();
            sound.dispose();
            if (window.__dd) delete window.__dd;
            root.remove();
            stylesheet.remove();
        },
    };
}
