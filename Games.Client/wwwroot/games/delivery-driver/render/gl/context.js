// WebGL2 context creation, capability probing and context-loss handling.

/** True when this browser can create a WebGL2 context (probed on a throwaway canvas). */
export function webgl2Available() {
    try {
        const probe = document.createElement('canvas');
        const gl = probe.getContext('webgl2');
        if (!gl) return false;
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return true;
    } catch { return false; }
}

/** Creates the game's WebGL2 context on `canvas`; returns null when unavailable. */
export function createContext(canvas, { antialias = false } = {}) {
    try {
        return canvas.getContext('webgl2', { antialias, alpha: false, powerPreference: 'high-performance', depth: true, stencil: false });
    } catch { return null; }
}

/** Limits and optional features the renderer may use. */
export function probeCapabilities(gl) {
    return {
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
        floatRenderTargets: !!gl.getExtension('EXT_color_buffer_float'),
        instancing: typeof gl.drawElementsInstanced === 'function', // core in WebGL2
        depthTextures: true, // core in WebGL2
    };
}

/**
 * Watches for context loss. The browser may restore the context on its own, so `onLost` fires straight away and
 * `onFailed` only after `graceMs` without a restore. `onRestored` is where GPU resources get rebuilt.
 * Returns a function that removes the listeners.
 */
export function watchContext(canvas, { onLost, onRestored, onFailed, graceMs = 1500 }) {
    let timer = 0;
    const lost = e => {
        e.preventDefault(); // allows the browser to restore the context
        onLost?.();
        clearTimeout(timer);
        timer = setTimeout(() => onFailed?.(), graceMs);
    };
    const restored = () => {
        clearTimeout(timer);
        onRestored?.();
    };
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    return () => {
        clearTimeout(timer);
        canvas.removeEventListener('webglcontextlost', lost);
        canvas.removeEventListener('webglcontextrestored', restored);
    };
}
