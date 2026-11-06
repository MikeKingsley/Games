// Greybox dev page (plan 0010 phase 6): the spec's road pieces drawn with the game's WebGL2 pieces (context, program,
// mesh upload, layered road draw) and a free camera. Dev only: nothing in the game links here.
// Query: ?year=1950  ?piece=roundabout (start over a piece, top-down; add &view=oblique for an angled view)
//        ?view=top (top-down overview)  ?view=low (a low, distant view).
import { GREYBOX_SPEC } from './spec.js';
import { buildGreyboxWorld } from './graph.js';
import { buildGreyboxMesh } from './mesh.js';
import { createContext } from '../render/gl/context.js';
import { createProgram } from '../render/gl/program.js';
import { uploadMesh, drawMeshLayers, ATTRIB_SLOTS } from '../render/gl/gpu-mesh.js';
import * as mat4 from '../render/gl/mat4.js';
import { projectPoint } from '../render/gl/camera3d.js';

const SHADER = {
    vertex: `#version 300 es
in vec3 a_pos; in vec3 a_normal; in vec3 a_color;
uniform mat4 u_vp;
out vec3 v_n; out vec3 v_c; out vec3 v_w;
void main() { v_n = a_normal; v_c = a_color; v_w = a_pos; gl_Position = u_vp * vec4(a_pos, 1.0); }`,
    fragment: `#version 300 es
precision highp float;
in vec3 v_n; in vec3 v_c; in vec3 v_w;
uniform vec3 u_eye;
out vec4 outColor;
void main() {
    vec3 n = normalize(v_n);
    float lit = 0.45 + 0.55 * max(dot(n, normalize(vec3(-0.4, -0.3, 0.85))), 0.0);
    vec3 c = abs(v_c) * lit;
    float fog = clamp((distance(v_w, u_eye) - 900.0) / 2500.0, 0.0, 1.0);
    outColor = vec4(mix(c, vec3(0.62, 0.72, 0.82), fog), 1.0);
}`,
};

const params = new URLSearchParams(location.search);
const year = Number(params.get('year')) || GREYBOX_SPEC.year;
const world = buildGreyboxWorld(GREYBOX_SPEC);
const mesh = buildGreyboxMesh(world, year);

const canvas = document.getElementById('gl');
const status = { ready: false, frames: 0, triangles: mesh.indices.length / 3, error: null };
window.__greybox = status;
const gl = createContext(canvas, { antialias: true });
if (!gl) {
    status.error = 'WebGL2 unavailable';
    document.getElementById('help').textContent = 'WebGL2 is not available in this browser.';
    throw new Error(status.error);
}
const prog = createProgram(gl, SHADER, 'greybox', ATTRIB_SLOTS);
const handle = uploadMesh(gl, mesh);

// ---- free camera: position in world metres (+y south); yaw pi/2 looks north, pitch up is positive ----------------------
const OVERVIEW = { x: 300, y: 760, z: 560, yaw: Math.PI / 2, pitch: -0.95 };
const cam = { ...OVERVIEW };
const flyTo = piece => Object.assign(cam, { x: piece.x, y: piece.y + 130, z: 90, yaw: Math.PI / 2, pitch: -0.55 });
// Top-down (plan view): looking straight down with north up. Pitch stops just short of -pi/2 so the look-at matrix stays valid.
const TOP_PITCH = -1.55, TOP_HEIGHT = 230;
const topDown = (x, y) => Object.assign(cam, { x, y, z: TOP_HEIGHT, yaw: Math.PI / 2, pitch: TOP_PITCH });
const start = GREYBOX_SPEC.pieces.find(p => p.id === params.get('piece'));
const oblique = params.get('view') === 'oblique';
if (start) (oblique ? flyTo(start) : topDown(start.x, start.y));
else if (params.get('view') === 'low') Object.assign(cam, { x: 300, y: 1000, z: 60, pitch: -0.2 });
else if (params.get('view') === 'top') topDown(OVERVIEW.x, OVERVIEW.y);

const bar = document.getElementById('bar'), labels = document.getElementById('labels');
const addButton = (text, fn) => { const b = document.createElement('button'); b.textContent = text; b.onclick = fn; bar.appendChild(b); };
addButton('All', () => Object.assign(cam, OVERVIEW));
addButton('Top', () => topDown(OVERVIEW.x, OVERVIEW.y));
const labelOf = new Map();
for (const p of GREYBOX_SPEC.pieces) {
    addButton(p.label, () => topDown(p.x, p.y));
    const span = document.createElement('span');
    span.textContent = p.label;
    labelOf.set(p.id, span);
    labels.appendChild(span);
}

const keys = new Set();
addEventListener('keydown', e => keys.add(e.code));
addEventListener('keyup', e => keys.delete(e.code));
const look = (dx, dy) => { cam.yaw -= dx * 0.005; cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch - dy * 0.005)); };
const forward = d => {
    cam.x += Math.cos(cam.yaw) * Math.cos(cam.pitch) * d;
    cam.y -= Math.sin(cam.yaw) * Math.cos(cam.pitch) * d;
    cam.z = Math.max(1, cam.z + Math.sin(cam.pitch) * d);
};
const pointers = new Map();
let pinch = 0;
canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, e); });
canvas.addEventListener('pointerup', e => { pointers.delete(e.pointerId); pinch = 0; });
canvas.addEventListener('pointermove', e => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, e);
    if (pointers.size === 1) look(e.clientX - prev.clientX, e.clientY - prev.clientY);
    else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (pinch) forward((d - pinch) * 0.6);
        pinch = d;
    }
});
canvas.addEventListener('wheel', e => { e.preventDefault(); forward(-e.deltaY * 0.15); }, { passive: false });

const vp = mat4.create(), proj = mat4.create(), view = mat4.create(), flipY = mat4.scaling(mat4.create(), 1, -1, 1);
const out = { x: 0, y: 0, z: 0 };
let last = performance.now();
function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 160 : 50) * dt;
    const k = (...codes) => codes.some(c => keys.has(c));
    if (k('KeyW', 'ArrowUp')) forward(speed);
    if (k('KeyS', 'ArrowDown')) forward(-speed);
    const side = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
    cam.x += Math.sin(cam.yaw) * side * speed;
    cam.y += Math.cos(cam.yaw) * side * speed;
    cam.z = Math.max(1, cam.z + ((k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0)) * speed);

    const dpr = Math.min(devicePixelRatio || 1, 2), w = Math.max(1, Math.round(innerWidth * dpr)), h = Math.max(1, Math.round(innerHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.62, 0.72, 0.82, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // the game's convention: look at the scene with y negated (so north is up), then mirror y back
    mat4.perspective(proj, 0.9, w / h, 0.5, 6000);
    const eye = [cam.x, -cam.y, cam.z];
    const dir = [Math.cos(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch)];
    mat4.lookAt(view, eye, [eye[0] + dir[0], eye[1] + dir[1], eye[2] + dir[2]], [0, 0, 1]);
    mat4.multiply(vp, proj, view);
    mat4.multiply(vp, vp, flipY);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.frontFace(gl.CW); // the y flip mirrors the scene, so the meshes' counter-clockwise faces wind clockwise on screen
    gl.enable(gl.POLYGON_OFFSET_FILL);
    prog.use();
    gl.uniformMatrix4fv(prog.uniform('u_vp'), false, vp);
    gl.uniform3f(prog.uniform('u_eye'), cam.x, cam.y, cam.z);
    // road layers get the game's per-layer polygon offset (gl-renderer.js roadLayerOffset)
    drawMeshLayers(gl, handle, layer => gl.polygonOffset(-1, -2 - 2 * layer));
    gl.disable(gl.POLYGON_OFFSET_FILL);

    for (const p of GREYBOX_SPEC.pieces) {
        const el = labelOf.get(p.id);
        projectPoint(vp, p.x, p.y, 8, innerWidth, innerHeight, out);
        const visible = out.z > -1 && out.z < 1 && out.x > 0 && out.x < innerWidth && out.y > 0 && out.y < innerHeight;
        el.style.display = visible ? '' : 'none';
        if (visible) { el.style.left = `${out.x}px`; el.style.top = `${out.y}px`; }
    }
    status.frames++;
    status.ready = true;
    requestAnimationFrame(frame);
}
addEventListener('error', e => { status.error = String(e.message); });
requestAnimationFrame(frame);
