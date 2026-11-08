// DOM for Inglenook: HUD, goal strip, drive controls, toast and result panel. No game rules here.
const SVG_NS = 'http://www.w3.org/2000/svg';

function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

function button(label, cls, onClick, signal, title) {
    const b = h('button', `ig-btn ${cls ?? ''}`, label);
    b.type = 'button';
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    b.addEventListener('click', onClick, { signal });
    return b;
}

const MARKS = {
    circle: '<circle r="0.7"/>',
    square: '<rect x="-0.7" y="-0.7" width="1.4" height="1.4"/>',
    triangle: '<polygon points="0,-0.8 0.8,0.7 -0.8,0.7"/>',
    diamond: '<polygon points="0,-0.9 0.9,0 0,0.9 -0.9,0"/>',
    bar: '<rect x="-0.9" y="-0.3" width="1.8" height="0.6"/>',
    cross: '<path d="M-0.8,0H0.8M0,-0.8V0.8" stroke="#fff" stroke-width="0.5"/>',
};

/** A wagon chip for the goal strip: colour, number and shape marker. */
function chip(w) {
    const c = h('span', 'ig-chip');
    c.style.background = w.color;
    c.append(h('b', '', String(w.number)));
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '-1 -1 2 2');
    svg.setAttribute('class', 'ig-chip-shape');
    svg.innerHTML = `<g fill="#fff">${MARKS[w.shape] ?? ''}</g>`;
    c.append(svg);
    return c;
}

export function createUi(container, cb, signal) {
    const root = h('div', 'ig-root');

    const hud = h('div', 'ig-hud');
    const title = h('span', 'ig-title', 'Inglenook');
    const levelEl = h('span', 'ig-level');
    const movesEl = h('span', 'ig-moves');
    const starsEl = h('span', 'ig-best');
    hud.append(title, levelEl, movesEl, starsEl, button('Back', 'ig-small', () => cb.onExit(), signal));

    const goalBar = h('div', 'ig-goalbar');
    const goalLabel = h('span', 'ig-goallabel', 'Make up this train on the long siding, nearest the points first:');
    const goalStrip = h('span', 'ig-goalstrip');
    const goalOk = h('span', 'ig-goalok', '');
    goalBar.append(goalLabel, goalStrip, goalOk);

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ig-board');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Goods yard track plan');

    const toast = h('div', 'ig-toast');
    toast.hidden = true;

    const controls = h('div', 'ig-controls');
    const rev = button('◀ Reverse', 'ig-drive', () => cb.onDrive('reverse'), signal, 'Reverse (S or Left arrow)');
    const stop = button('■ Stop', 'ig-drive ig-stop', () => cb.onDrive('stop'), signal, 'Stop (Space)');
    const fwd = button('Forward ▶', 'ig-drive', () => cb.onDrive('forward'), signal, 'Forward (W or Right arrow)');
    const tools = h('div', 'ig-tools');
    const undo = button('Undo', 'ig-small', () => cb.onUndo(), signal, 'Undo (U)');
    const reset = button('Reset', 'ig-small', () => cb.onReset(), signal, 'Restart the level (R)');
    const skip = button('Skip', 'ig-small', () => cb.onSkip(), signal, 'Skip to the next level');
    const mute = button('🔊', 'ig-small', () => cb.onMute(), signal, 'Sound on or off (M)');
    tools.append(undo, reset, skip, mute);
    controls.append(rev, stop, fwd, tools);

    const win = h('div', 'ig-win');
    win.hidden = true;
    const winTitle = h('h2', '', 'Train made up!');
    const winStars = h('div', 'ig-winstars');
    const winText = h('p', '');
    const winButtons = h('div', 'ig-winbuttons');
    winButtons.append(button('Replay', 'ig-small', () => cb.onReset(), signal), button('Next level', 'ig-next', () => cb.onNext(), signal));
    win.append(winTitle, winStars, winText, winButtons);

    root.append(hud, goalBar, svg, controls, toast, win);
    container.appendChild(root);

    const driveButtons = { forward: fwd, reverse: rev, stop };
    let toastTimer = 0;
    signal.addEventListener('abort', () => clearTimeout(toastTimer));

    return {
        root, svg,
        setLevel(level, bestStars) {
            levelEl.textContent = `Level ${level.n}`;
            starsEl.textContent = bestStars ? `Best ${'★'.repeat(bestStars)}${'☆'.repeat(3 - bestStars)}` : '';
            goalStrip.replaceChildren(...level.goal.slice().reverse().map(id => chip(level.wagons.find(w => w.id === id))));
            win.hidden = true;
            goalOk.textContent = '';
        },
        setMoves(moves, par) { movesEl.textContent = `Moves ${moves} · Par ${par}`; },
        setCommand(cmd) { for (const [k, b] of Object.entries(driveButtons)) b.classList.toggle('on', k === cmd); },
        setMuted(m) { mute.textContent = m ? '🔇' : '🔊'; },
        setGoalMet(met) { goalOk.textContent = met ? '✓' : ''; },
        toast(msg) {
            toast.textContent = msg;
            toast.hidden = false;
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
        },
        showWin({ stars, moves, par, level }) {
            winStars.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
            winText.textContent = `Level ${level} done in ${moves} move${moves === 1 ? '' : 's'} (par ${par}).`;
            win.hidden = false;
        },
        hideWin() { win.hidden = true; },
        isWinShown: () => !win.hidden,
        destroy() { root.remove(); },
    };
}
