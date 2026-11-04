// GLSL ES 3.00 shader sources (WebGL2). Kept as plain strings so there is no build step.
//
// Every lit program shares the lighting block below: hemispheric ambient + one sun/moon light with a PCF shadow map,
// up to 8 night lights (headlight cones and street lamps), wet-road sheen, emissive windows and lamp bulbs, and fog.
// Vertex colours are normally 0..1 albedo. A NEGATIVE red channel marks an emissive-capable surface (the colour is the
// absolute value): green >= 0 is a window (some are lit at night), green < 0 a lamp bulb (lit at night).

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

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
`;

/** Uniforms and varyings every lit fragment shader declares. */
const DECL = `
in vec3 v_normal;
in vec3 v_color;
in vec3 v_world;
in vec4 v_light;
uniform vec3 u_sunDir;
uniform vec3 u_sunColor;
uniform vec3 u_skyColor;
uniform vec3 u_groundColor;
uniform vec3 u_eye;
uniform vec3 u_fogColor;
uniform vec2 u_fog;
uniform float u_alpha;
uniform float u_night;
uniform float u_wet;
uniform float u_shadowOn;
uniform float u_shadowSize;
uniform vec3 u_windowTint;
uniform vec3 u_lampTint;
uniform int u_spotCount;
uniform vec4 u_spotPos[8];
uniform vec4 u_spotDir[8];
uniform vec3 u_spotCol[8];
uniform sampler2DShadow u_shadow;
out vec4 outColor;
`;

const FUNCS = `
float shadowFactor(float ndl) {
    if (u_shadowOn < 0.001) return 1.0;
    vec3 p = v_light.xyz / v_light.w * 0.5 + 0.5;
    float edge = smoothstep(0.8, 1.0, max(abs(p.x * 2.0 - 1.0), abs(p.y * 2.0 - 1.0)));
    if (p.z > 1.0 || p.z < 0.0 || edge >= 1.0) return 1.0;
    float bias = max(0.0014 * (1.0 - ndl), 0.0004);
    float t = 1.0 / u_shadowSize;
    float s = 0.0;
    for (int i = -1; i <= 1; i++) {
        for (int j = -1; j <= 1; j++) s += texture(u_shadow, vec3(p.xy + vec2(float(i), float(j)) * t, p.z - bias));
    }
    return mix(s / 9.0, 1.0, edge);
}

vec3 lit(vec3 albedo, vec3 n, vec3 world) {
    float ndl = max(dot(n, u_sunDir), 0.0);
    float hemi = n.z * 0.5 + 0.5;
    float sh = shadowFactor(ndl);
    vec3 light = mix(u_groundColor, u_skyColor, hemi) + u_sunColor * ndl * mix(1.0, sh, u_shadowOn);
    for (int i = 0; i < 8; i++) {
        if (i >= u_spotCount) break;
        vec3 L = u_spotPos[i].xyz - world;
        float d = length(L);
        float range = u_spotDir[i].w;
        if (d > range) continue;
        vec3 l = L / d;
        float cone = smoothstep(u_spotPos[i].w, u_spotPos[i].w + 0.12, dot(-l, u_spotDir[i].xyz));
        float att = 1.0 - d / range;
        light += u_spotCol[i] * cone * att * att * (0.35 + 0.65 * max(dot(n, l), 0.0));
    }
    vec3 c = albedo * light;
    if (u_wet > 0.0) {
        // wet grey surfaces facing up (roads) shine: a sun glint plus a faint sky reflection, broken into puddles
        vec3 v = normalize(u_eye - world);
        float grey = 1.0 - clamp((max(albedo.r, max(albedo.g, albedo.b)) - min(albedo.r, min(albedo.g, albedo.b))) * 5.0, 0.0, 1.0);
        float up = smoothstep(0.85, 1.0, n.z);
        float puddle = 0.55 + 0.45 * sin(world.x * 0.23 + 1.3) * sin(world.y * 0.19);
        float spec = pow(max(dot(reflect(-u_sunDir, n), v), 0.0), 24.0);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        c += (u_sunColor * spec * 1.4 + u_skyColor * fres * 0.5) * u_wet * grey * up * puddle * mix(1.0, sh, 0.5);
    }
    return c;
}

vec3 fogged(vec3 c, vec3 world) {
    float d = length(world - u_eye);
    float x = clamp((d - u_fog.x) / max(u_fog.y - u_fog.x, 1.0), 0.0, 1.0);
    float f = (1.0 - exp(-3.0 * x * x)) / (1.0 - exp(-3.0));
    return mix(c, u_fogColor, f);
}

float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

/** Declarations the lit vertex shaders share. */
const VOUT = `
out vec3 v_normal;
out vec3 v_color;
out vec3 v_world;
out vec4 v_light;
uniform mat4 u_vp;
uniform mat4 u_lightVp;
`;

/**
 * Lit, fogged vertex-colour geometry in WORLD coordinates (+x east, +y south, +z up). `u_vp` already includes the y flip
 * that puts north at the top of the screen, so normals stay in world space for the lighting.
 */
export const SCENE = {
    vertex: `#version 300 es
in vec3 a_pos;
in vec3 a_normal;
in vec3 a_color;
${VOUT}
void main() {
    v_normal = a_normal;
    v_color = a_color;
    v_world = a_pos;
    v_light = u_lightVp * vec4(a_pos, 1.0);
    gl_Position = u_vp * vec4(a_pos, 1.0);
}`,
    fragment: `${HEAD}${DECL}${FUNCS}
void main() {
    vec3 n = normalize(v_normal);
    vec3 albedo = abs(v_color);
    vec3 emit = vec3(0.0);
    if (v_color.r < 0.0 && v_color.b < 0.0) { outColor = vec4(albedo, u_alpha); return; } // self-lit marker (route line, drop ring)
    if (v_color.r < 0.0) {
        if (v_color.g < 0.0) {
            emit = u_lampTint * u_night * 1.6;
        } else {
            // about two windows in three are lit at night
            float h = hash12(floor(v_world.xy * 0.9) + floor(v_world.z * 0.5));
            emit = h < 0.66 ? u_windowTint * u_night * 0.9 : vec3(0.0);
        }
    }
    vec3 c = lit(albedo, n, v_world) + emit;
    outColor = vec4(fogged(c, v_world), u_alpha);
}`,
};

/** Water: the same lighting with a slow moving ripple tint, translucent, no shadows. */
export const WATER = {
    vertex: SCENE.vertex,
    fragment: `${HEAD}${DECL}
uniform float u_time;
${FUNCS}
void main() {
    float ripple = sin(v_world.x * 0.35 + u_time * 0.8) * sin(v_world.y * 0.31 - u_time * 0.65);
    vec3 base = v_color * (0.94 + 0.06 * ripple);
    vec3 light = mix(u_groundColor, u_skyColor, 0.9) + u_sunColor * 0.25;
    vec3 c = base * light;
    vec3 v = normalize(u_eye - v_world);
    c += u_skyColor * pow(1.0 - max(v.z, 0.0), 4.0) * 0.35; // glancing reflection of the sky
    outColor = vec4(fogged(c, v_world), u_alpha);
}`,
};

/**
 * SCENE with per-instance placement: `a_off` = (x, y, z, rotation about z), `a_scale`, `a_tint`. The template's vertices
 * are scaled, rotated and offset; normals are rotated (and un-scaled so non-uniform scales stay roughly right).
 */
export const INSTANCED = {
    vertex: `#version 300 es
in vec3 a_pos;
in vec3 a_normal;
in vec3 a_color;
in vec4 a_off;
in vec3 a_scale;
in vec3 a_tint;
${VOUT}
void main() {
    float c = cos(a_off.w), s = sin(a_off.w);
    vec3 lp = a_pos * a_scale;
    vec3 wp = vec3(c * lp.x - s * lp.y, s * lp.x + c * lp.y, lp.z) + a_off.xyz;
    vec3 ln = normalize(a_normal / a_scale);
    v_normal = vec3(c * ln.x - s * ln.y, s * ln.x + c * ln.y, ln.z);
    v_color = a_color * a_tint;
    v_world = wp;
    v_light = u_lightVp * vec4(wp, 1.0);
    gl_Position = u_vp * vec4(wp, 1.0);
}`,
    fragment: SCENE.fragment,
};

/**
 * Whole objects placed by a model matrix (`u_model`): vehicle bodies and lamps. `u_tint` multiplies the vertex colour
 * (damage, lamp colour) and `u_glow` (0..1) blends from lit towards the unlit tinted colour, so lamps can glow.
 */
export const MODEL = {
    vertex: `#version 300 es
in vec3 a_pos;
in vec3 a_normal;
in vec3 a_color;
uniform mat4 u_model;
${VOUT}
void main() {
    vec4 w = u_model * vec4(a_pos, 1.0);
    v_normal = mat3(u_model) * a_normal;
    v_color = a_color;
    v_world = w.xyz;
    v_light = u_lightVp * w;
    gl_Position = u_vp * w;
}`,
    fragment: `${HEAD}${DECL}
uniform vec3 u_tint;
uniform float u_glow;
${FUNCS}
void main() {
    vec3 n = normalize(v_normal);
    vec3 base = abs(v_color) * u_tint;
    vec3 c = mix(lit(base, n, v_world), base, u_glow);
    outColor = vec4(fogged(c, v_world), u_alpha);
}`,
};

/** Instances placed by a full per-instance matrix (a_m0..a_m3 are its columns): the wheels of every vehicle in one draw. */
export const INSTANCED_M = {
    vertex: `#version 300 es
in vec3 a_pos;
in vec3 a_normal;
in vec3 a_color;
in vec4 a_m0;
in vec4 a_m1;
in vec4 a_m2;
in vec4 a_m3;
${VOUT}
void main() {
    mat4 m = mat4(a_m0, a_m1, a_m2, a_m3);
    vec4 w = m * vec4(a_pos, 1.0);
    v_normal = normalize(mat3(m) * a_normal);
    v_color = a_color;
    v_world = w.xyz;
    v_light = u_lightVp * w;
    gl_Position = u_vp * w;
}`,
    fragment: SCENE.fragment,
};

/**
 * The sky: a full-screen triangle (no attributes; draw 3 vertices) whose pixels are shaded by the view ray (rebuilt from
 * `u_invVp`): horizon colour up to the zenith colour, plus the sun (or moon) disc and a glow around it.
 */
export const SKY = {
    vertex: `#version 300 es
out vec2 v_ndc;
void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    v_ndc = p * 2.0 - 1.0;
    gl_Position = vec4(v_ndc, 1.0, 1.0);
}`,
    fragment: `#version 300 es
precision highp float;
in vec2 v_ndc;
uniform mat4 u_invVp;
uniform vec3 u_horizon;
uniform vec3 u_zenith;
uniform vec3 u_sunDir;
uniform vec3 u_sunColor;
uniform float u_sunVisible;
uniform float u_warmth;
out vec4 outColor;
void main() {
    vec4 a = u_invVp * vec4(v_ndc, -1.0, 1.0);
    vec4 b = u_invVp * vec4(v_ndc, 1.0, 1.0);
    vec3 ray = normalize(b.xyz / b.w - a.xyz / a.w);
    float e = max(ray.z, 0.0);
    vec3 c = mix(u_horizon, u_zenith, pow(e, 0.55));
    float d = max(dot(ray, u_sunDir), 0.0);
    vec3 glow = u_sunColor * (pow(d, 700.0) * 3.0 + pow(d, 14.0) * (0.12 + 0.3 * u_warmth));
    c += glow * u_sunVisible;
    outColor = vec4(c, 1.0);
}`,
};

/**
 * Rain: `u_count` streaks drawn as GL_LINES from gl_VertexID alone (no buffers). Each falls through a box `u_rain.w`
 * metres around `u_center`, wrapped so the drops stay put in the world as the camera moves; `u_rain` = (speed m/s,
 * streak length m, wind m, box half-size).
 */
export const RAIN = {
    vertex: `#version 300 es
precision highp float;
uniform mat4 u_vp;
uniform vec3 u_center;
uniform float u_time;
uniform vec4 u_rain;
out float v_a;
float h(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
    float i = float(gl_VertexID / 2);
    bool tail = (gl_VertexID & 1) == 1;
    float area = u_rain.w;
    vec2 cell = fract(vec2(h(i), h(i + 17.3)) - u_center.xy / (2.0 * area));
    vec2 xy = u_center.xy + (cell - 0.5) * 2.0 * area;
    float height = 32.0;
    float fall = fract(h(i + 5.1) - u_time * u_rain.x * (0.85 + 0.3 * h(i + 9.7)) / height);
    float z = u_center.z - 8.0 + fall * height;
    vec3 p = vec3(xy, z);
    p.x += u_rain.z * (1.0 - fall) * 0.5;
    if (tail) p += vec3(-u_rain.z * 0.08, 0.0, u_rain.y);
    float dist = length(p - u_center);
    v_a = (tail ? 0.3 : 1.0) * (1.0 - smoothstep(area * 0.6, area, dist));
    gl_Position = u_vp * vec4(p, 1.0);
}`,
    fragment: `#version 300 es
precision highp float;
in float v_a;
uniform vec3 u_color;
out vec4 outColor;
void main() { outColor = vec4(u_color, 0.5 * v_a); }`,
};
