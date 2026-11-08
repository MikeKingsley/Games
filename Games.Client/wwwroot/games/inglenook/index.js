// Inglenook: a 1960s UK goods-yard shunting puzzle. Rules live in DOM-free modules; this file mounts the UI.
import { VIEW_W, VIEW_H } from './config.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function mount(container, options = {}) {
    let paused = false;
    const abort = new AbortController();
    const { signal } = abort;

    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('./styles.css', import.meta.url).href;
    document.head.appendChild(stylesheet);

    const root = document.createElement('div');
    root.className = 'ig-root';

    const hud = document.createElement('div');
    hud.className = 'ig-hud';
    const title = document.createElement('span');
    title.className = 'ig-title';
    title.textContent = 'Inglenook';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'ig-btn';
    back.textContent = 'Back';
    back.addEventListener('click', () => options.onExit?.(), { signal });
    hud.append(title, back);

    const board = document.createElementNS(SVG_NS, 'svg');
    board.setAttribute('class', 'ig-board');
    board.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);
    board.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const baize = document.createElementNS(SVG_NS, 'rect');
    baize.setAttribute('width', VIEW_W);
    baize.setAttribute('height', VIEW_H);
    baize.setAttribute('fill', '#3a6b3f');
    board.appendChild(baize);

    root.append(hud, board);
    container.appendChild(root);

    return {
        unmount() {
            abort.abort();
            root.remove();
            stylesheet.remove();
        },
        setOptions(next = {}) {
            if (typeof next.paused === 'boolean') paused = next.paused;
        },
        get paused() { return paused; },
    };
}
