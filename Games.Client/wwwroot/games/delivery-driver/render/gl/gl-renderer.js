// WebGL2 renderer. Phase 1 skeleton: clears to the sea colour and draws a test ground quad through a fixed
// perspective camera, so the context, resize, shader and error-counting plumbing can be tested before any real
// scene is built. Same surface as the Canvas renderer: {stats, resize, draw, dispose}.
import { createContext, probeCapabilities, watchContext } from './context.js';
import { createProgram } from './program.js';
import { FLAT } from './shaders.js';
import * as mat4 from './mat4.js';
import { QUALITY } from '../../config.js';

const SEA = [0.17, 0.36, 0.5];
const GROUND = [0.3, 0.45, 0.2, 1];
const ERROR_CHECK_EVERY = 30; // gl.getError() stalls the pipeline, so only look now and then

/**
 * Returns null when no WebGL2 context or the shaders are unavailable (the caller then uses Canvas 2D).
 * callbacks: {onLost(), onFailed(reason)}; onFailed means the context could not be restored.
 */
export function createGlRenderer({ canvas, view, callbacks = {} }) {
    const q0 = QUALITY.medium;
    const gl = createContext(canvas, { antialias: !!q0.antialias });
    if (!gl) return null;

    const stats = { kind: 'webgl', buildings: 0, chunks: 0, drawables: 0, drawCalls: 0, glErrors: 0, lost: false };
    const caps = probeCapabilities(gl);
    const proj = mat4.create(), viewM = mat4.create(), mvp = mat4.create(), model = mat4.create();
    let flat = null, quad = null, frame = 0, disposed = false;

    function build() {
        flat = createProgram(gl, FLAT, 'flat');
        const s = 40; // an 80 m square on the ground plane, z = 0
        const data = new Float32Array([-s, -s, 0, s, -s, 0, s, s, 0, -s, s, 0]);
        quad = { vao: gl.createVertexArray(), vbo: gl.createBuffer(), ibo: gl.createBuffer() };
        gl.bindVertexArray(quad.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, quad.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        const loc = flat.attrib('a_pos');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quad.ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
        gl.bindVertexArray(null);
    }

    function release() {
        if (!gl.isContextLost()) {
            if (quad) { gl.deleteVertexArray(quad.vao); gl.deleteBuffer(quad.vbo); gl.deleteBuffer(quad.ibo); }
            flat?.dispose();
        }
        flat = null; quad = null;
    }

    try { build(); } catch (err) {
        console.warn('Delivery Driver: WebGL setup failed, using the compatibility renderer.', err);
        release();
        return null;
    }

    const unwatch = watchContext(canvas, {
        onLost: () => { stats.lost = true; callbacks.onLost?.(); },
        onRestored: () => {
            try { build(); stats.lost = false; } catch (err) { callbacks.onFailed?.(String(err)); }
        },
        onFailed: () => { if (stats.lost) callbacks.onFailed?.('context lost'); },
    });

    function countErrors() {
        let e;
        while ((e = gl.getError()) !== gl.NO_ERROR && e !== gl.CONTEXT_LOST_WEBGL) stats.glErrors++;
    }

    return {
        kind: 'webgl',
        stats,
        caps,
        /** The canvas backing store is sized by the caller; this only has to track the viewport (done every frame). */
        resize() {},
        draw(session) {
            if (disposed || stats.lost || gl.isContextLost()) return;
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.clearColor(SEA[0], SEA[1], SEA[2], 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            stats.drawCalls = 0;
            if (session.world) {
                const p = session.player;
                const aspect = canvas.width / Math.max(1, canvas.height);
                mat4.perspective(proj, 0.9, aspect, 1, 4000);
                // world is +x east, +y south, +z up; negating y puts north at the top of the screen
                mat4.lookAt(viewM, [p.x, -p.y + 90, 70], [p.x, -p.y, 0], [0, 0, 1]);
                mat4.multiply(mvp, proj, viewM);
                mat4.multiply(mvp, mvp, mat4.translation(model, p.x, -p.y, 0)); // the test quad follows the truck
                gl.enable(gl.DEPTH_TEST);
                flat.use();
                gl.uniformMatrix4fv(flat.uniform('u_mvp'), false, mvp);
                gl.uniform4fv(flat.uniform('u_color'), GROUND);
                gl.bindVertexArray(quad.vao);
                gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
                gl.bindVertexArray(null);
                stats.drawCalls++;
            }
            if (frame++ < 5 || frame % ERROR_CHECK_EVERY === 0) countErrors();
        },
        /** Pixel at canvas (x, y) as [r, g, b, a]; for tests. */
        readPixel(x, y) {
            const out = new Uint8Array(4);
            gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
            return [...out];
        },
        loseContext() { gl.getExtension('WEBGL_lose_context')?.loseContext(); },
        dispose() {
            disposed = true;
            unwatch();
            release();
            gl.getExtension('WEBGL_lose_context')?.loseContext();
        },
    };
}
