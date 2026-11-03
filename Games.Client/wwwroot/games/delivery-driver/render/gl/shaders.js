// GLSL ES 3.00 shader sources (WebGL2). Kept as plain strings so there is no build step.

/** Flat single-colour geometry: the Phase 1 test quad. */
export const FLAT = {
    vertex: `#version 300 es
in vec3 a_pos;
uniform mat4 u_mvp;
void main() { gl_Position = u_mvp * vec4(a_pos, 1.0); }`,
    fragment: `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 outColor;
void main() { outColor = u_color; }`,
};
