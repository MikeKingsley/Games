// Renderer factory: one interface over the WebGL2 renderer and the Canvas 2D fallback.
//   createRenderer({canvas, view, kind, callbacks}) -> {kind, stats, resize(view), draw(session, camera, alpha), dispose()}
// `kind` is 'webgl' or 'canvas2d'. A canvas cannot switch context types, so when WebGL cannot start the factory
// returns null and the caller retries with a fresh canvas and kind 'canvas2d'.
import { createRenderer as createCanvasRenderer } from './renderer.js';
import { createGlRenderer } from './gl/gl-renderer.js';
import { webgl2Available } from './gl/context.js';
import { AUTO_PREFERS_WEBGL } from '../config.js';

/** Maps the 'renderer' setting (auto | webgl | canvas2d) to the kind to try. */
export function resolveKind(setting, webgl2 = webgl2Available(), autoPrefersWebgl = AUTO_PREFERS_WEBGL) {
    if (setting === 'canvas2d') return 'canvas2d';
    if (setting === 'webgl') return webgl2 ? 'webgl' : 'canvas2d';
    return autoPrefersWebgl && webgl2 ? 'webgl' : 'canvas2d';
}

function createCanvas2d(canvas, view) {
    const inner = createCanvasRenderer(canvas.getContext('2d'), view);
    inner.stats.kind = 'canvas2d';
    return {
        kind: 'canvas2d',
        stats: inner.stats,
        resize() {},
        draw: (session, camera, alpha) => inner.draw(session, camera, alpha),
        dispose() {},
    };
}

/** Returns a renderer of the requested kind, or null when WebGL was requested but could not start. */
export function createRenderer({ canvas, view, kind, callbacks }) {
    if (kind === 'webgl') return createGlRenderer({ canvas, view, callbacks });
    return createCanvas2d(canvas, view);
}
