// Pure shadow-map maths for the WebGL renderer (no DOM, no GL): fits one orthographic light-space box around the
// camera's focus point, snapped to whole shadow texels so the shadows do not shimmer as the camera moves.
// World coordinates as everywhere (+x east, +y south, +z up); `lightDir` points TOWARDS the light.
import * as mat4 from './mat4.js';

/** Quality presets for the shadow map (QUALITY[..].shadows is the on/off switch): texels per side. */
export const SHADOW_SIZE = { low: 0, medium: 1024, high: 2048 };

/**
 * How big an area (radius around the focus, metres) the shadow map covers for a camera `distance`: the truck and what is
 * around it, growing with the zoom, never smaller than 45 m nor bigger than 130 m (beyond that the texels get too coarse).
 */
export const shadowRadius = distance => Math.max(45, Math.min(130, distance * 2.2));

/**
 * Fits the light's view-projection: looks along -lightDir at `focus` ([x, y, z]) with an orthographic box of half-size
 * `radius` and `depth` metres either way along the light, shifted to whole texels of a `mapSize` map. Writes `out.vp`,
 * `out.view`, `out.proj` and returns `out` with `texel` (metres per texel).
 */
export function fitShadow(out, lightDir, focus, radius, mapSize, depth = 200) {
    out.vp ??= mat4.create(); out.view ??= mat4.create(); out.proj ??= mat4.create();
    const up = Math.abs(lightDir[2]) > 0.98 ? [0, 1, 0] : [0, 0, 1];
    // The light's own frame is anchored at the world origin, NOT at the focus, so a world point keeps the same light-space
    // position however the camera moves; only the box slides, and it slides in whole texels.
    const eye = [lightDir[0] * 1000, lightDir[1] * 1000, lightDir[2] * 1000];
    mat4.lookAt(out.view, eye, [0, 0, 0], up);
    const texel = (2 * radius) / mapSize;
    const f = mat4.transformPoint([0, 0, 0], out.view, focus);
    const cx = Math.round(f[0] / texel) * texel, cy = Math.round(f[1] / texel) * texel;
    const dist = -f[2]; // distance in front of the light's eye
    mat4.ortho(out.proj, cx - radius, cx + radius, cy - radius, cy + radius, Math.max(0.1, dist - depth), dist + depth);
    mat4.multiply(out.vp, out.proj, out.view);
    out.texel = texel;
    return out;
}

/** A world point in light clip space ([-1, 1] on all axes inside the shadow box). */
export const toLightClip = (vp, x, y, z, out = [0, 0, 0]) => mat4.transformPoint(out, vp, [x, y, z]);
