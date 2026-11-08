// Inglenook: a 1960s UK goods-yard shunting puzzle. Rules live in DOM-free modules; this file wires them to the screen.
import { getLayout } from './layouts.js';
import { createSim } from './sim.js';
import { generateLevel } from './levels.js';
import { buildSetup, checkWin, movesOf, starsFor } from './logic.js';
import { createRenderer } from './render.js';
import { createUi } from './ui.js';
import { UNDO_LIMIT } from './config.js';

const STEP = 1 / 60;
const MESSAGES = {
    pointLocked: 'You cannot change the points while a train is on them.',
    bumped: 'That wagon is fixed and cannot be moved.',
};

export function mount(container, options = {}) {
    let paused = false;
    let muted = options.soundEnabled === false;
    const progress = { level: 1, best: {}, muted: false, ...(options.loadProgress?.() ?? {}) };
    if (!progress.best || typeof progress.best !== 'object') progress.best = {};
    if (!(progress.level >= 1)) progress.level = 1;

    const abort = new AbortController();
    const { signal } = abort;

    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('./styles.css', import.meta.url).href;
    document.head.appendChild(stylesheet);

    let level = null;
    let layout = null;
    let sim = null;
    let renderer = null;
    let undoStack = [];
    let won = false;
    let raf = 0;
    let last = 0;
    let acc = 0;
    let listeners = [];

    const ui = createUi(container, {
        onExit: () => options.onExit?.(),
        onDrive: cmd => drive(cmd),
        onUndo: () => undo(),
        onReset: () => startLevel(level.n),
        onSkip: () => startLevel(level.n + 1),
        onNext: () => startLevel(level.n + 1),
        onMute: () => { muted = !muted; ui.setMuted(muted); save(); },
    }, signal);

    function save() { options.saveProgress?.({ level: progress.level, best: progress.best, muted }); }

    function snapshot() {
        undoStack.push(sim.snapshot());
        if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    }

    function startLevel(n) {
        level = generateLevel(Math.max(1, n));
        layout = getLayout(level.template);
        sim = createSim(layout, buildSetup(level));
        undoStack = [];
        won = false;
        acc = 0;
        renderer?.destroy();
        renderer = createRenderer(ui.svg, layout, {
            onPoint: id => { if (!won) { snapshot(); if (!sim.togglePoint(id)) undoStack.pop(); } },
            onCoupling: (rakeId, index) => { if (!won) { snapshot(); if (!sim.uncouple(rakeId, index)) undoStack.pop(); } },
        });
        progress.level = level.n;
        ui.setLevel(level, progress.best[level.n]?.stars ?? 0);
        ui.setMoves(0, level.par);
        ui.setCommand('stop');
        ui.setMuted(muted);
        save();
        renderer.update(sim);
    }

    function drive(cmd) {
        if (won) return;
        if (cmd !== 'stop' && sim.command === 'stop' && sim.speed === 0) snapshot();
        sim.setDirection(cmd);
        ui.setCommand(cmd);
    }

    function undo() {
        const snap = undoStack.pop();
        if (!snap || won) return;
        sim.restore(snap);
        ui.setCommand('stop');
    }

    function finish() {
        won = true;
        const moves = movesOf(sim);
        const stars = starsFor(moves, level.par);
        const prev = progress.best[level.n];
        if (!prev || stars > prev.stars || (stars === prev.stars && moves < prev.moves)) progress.best[level.n] = { stars, moves };
        progress.level = level.n + 1;
        save();
        options.onReward?.(stars);
        ui.showWin({ stars, moves, par: level.par, level: level.n });
    }

    function handleEvents() {
        for (const e of sim.drainEvents()) {
            for (const l of listeners) l(e);
            if (e.type === 'uncoupleBlocked') ui.toast(e.reason === 'moving' ? 'Stop the loco before uncoupling.' : 'Move the wagons clear of the points before uncoupling.');
            else if (MESSAGES[e.type]) ui.toast(MESSAGES[e.type]);
            if (e.type === 'coupled' || e.type === 'buffer' || e.type === 'bumped') ui.setCommand('stop');
        }
    }

    function frame(now) {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(0.05, (now - last) / 1000 || 0);
        last = now;
        if (!paused && !won) {
            acc += dt;
            while (acc >= STEP) { sim.step(STEP); acc -= STEP; }
            handleEvents();
            ui.setMoves(movesOf(sim), level.par);
            const met = checkWin(sim, level);
            ui.setGoalMet(met);
            if (met && sim.speed === 0) finish();
        }
        renderer.update(sim);
    }

    function onKey(e) {
        const k = e.key.toLowerCase();
        if (k === 'w' || k === 'arrowup' || k === 'arrowright') drive('forward');
        else if (k === 's' || k === 'arrowdown' || k === 'arrowleft') drive('reverse');
        else if (k === ' ') drive('stop');
        else if (k === 'u') undo();
        else if (k === 'r') startLevel(level.n);
        else if (k === 'm') { muted = !muted; ui.setMuted(muted); save(); }
        else if (/^[1-9]$/.test(k)) {
            const id = layout.pointIds[Number(k) - 1];
            if (id && !won) { snapshot(); if (!sim.togglePoint(id)) undoStack.pop(); }
        } else return;
        e.preventDefault();
    }
    window.addEventListener('keydown', onKey, { signal });

    startLevel(progress.level);
    raf = requestAnimationFrame(t => { last = t; frame(t); });

    if (options.debug) {
        window.__ig = {
            get sim() { return sim; },
            get level() { return level; },
            get won() { return won; },
            progress,
            start: n => startLevel(n),
            onEvent: fn => { listeners.push(fn); },
            // run the solver's moves through the real simulation (fast-forwarded), as a player would
            async solve() {
                const { playOps } = await import('./autoplay.js');
                playOps(sim, level.solution);
                renderer.update(sim);
                return level.solution;
            },
        };
    }

    return {
        unmount() {
            cancelAnimationFrame(raf);
            abort.abort();
            renderer?.destroy();
            ui.destroy();
            stylesheet.remove();
            listeners = [];
            if (options.debug && window.__ig) delete window.__ig;
        },
        setOptions(next = {}) {
            if (typeof next.paused === 'boolean') paused = next.paused;
            if (typeof next.soundEnabled === 'boolean') { muted = !next.soundEnabled; ui.setMuted(muted); }
        },
    };
}
