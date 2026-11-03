// Night, dusk, headlights, rain and fog, drawn in screen space over the scene.
import { toScreen } from './projection.js';
import { eraOf } from './era.js';

/** Darkens the ground layer at night (objects are shaded by the light level themselves). */
export function drawNightGround(ctx, view, light) {
    if (light >= 0.99) return;
    ctx.fillStyle = `rgba(8, 12, 36, ${(1 - light) * 0.85})`;
    ctx.fillRect(0, 0, view.width, view.height);
}

/** Warm sky tint around sunrise and sunset. */
export function drawDusk(ctx, view, dusk) {
    if (dusk <= 0.02) return;
    ctx.fillStyle = `rgba(255, 140, 60, ${dusk * 0.12})`;
    ctx.fillRect(0, 0, view.width, view.height);
}

const A = { x: 0, y: 0 }, B = { x: 0, y: 0 }, C = { x: 0, y: 0 };

/**
 * A headlight beam on the road: a soft additive cone ahead of the vehicle. Early oil and acetylene lamps are dim,
 * short and yellow; modern ones long and white.
 */
export function drawHeadlights(ctx, p, x, y, heading, year, strength = 1) {
    const era = eraOf(year);
    const reach = [10, 18, 26, 34, 42][era];
    const spread = 0.42;
    const tint = ['255,214,150', '255,228,170', '255,240,200', '250,248,230', '235,242,255'][era];
    const alpha = [0.18, 0.24, 0.3, 0.34, 0.38][era] * strength;
    toScreen(p, x, y, 0, A);
    toScreen(p, x + Math.cos(heading - spread) * reach, y + Math.sin(heading - spread) * reach, 0, B);
    toScreen(p, x + Math.cos(heading + spread) * reach, y + Math.sin(heading + spread) * reach, 0, C);
    const g = ctx.createRadialGradient(A.x, A.y, 0, A.x, A.y, Math.hypot(B.x - A.x, B.y - A.y));
    g.addColorStop(0, `rgba(${tint},${alpha})`);
    g.addColorStop(1, `rgba(${tint},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(C.x, C.y); ctx.closePath(); ctx.fill();
}

/** Rain streaks falling across the screen; `t` (seconds) animates them. */
export function drawRain(ctx, view, intensity, t) {
    const n = Math.round(60 + 220 * intensity);
    ctx.strokeStyle = 'rgba(200, 215, 235, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        // a cheap hash per drop so they don't need storing
        const h1 = Math.sin(i * 12.9898) * 43758.5453, h2 = Math.sin(i * 78.233) * 12345.678;
        const fx = h1 - Math.floor(h1), fy = h2 - Math.floor(h2);
        const x = ((fx * view.width + t * 60) % view.width + view.width) % view.width;
        const y = ((fy * view.height + t * (700 + 300 * fx)) % view.height + view.height) % view.height;
        ctx.moveTo(x, y);
        ctx.lineTo(x - 4, y + 16);
    }
    ctx.stroke();
    ctx.fillStyle = `rgba(60, 70, 90, ${0.12 * intensity})`;
    ctx.fillRect(0, 0, view.width, view.height);
}

/** Fog: clear around the vehicle, thickening to a grey-white wall at the visibility distance (pixels). */
export function drawFog(ctx, view, cx, cy, visiblePx, light) {
    const shade = Math.round(150 + 70 * light);
    const g = ctx.createRadialGradient(cx, cy, visiblePx * 0.25, cx, cy, visiblePx);
    g.addColorStop(0, `rgba(${shade},${shade},${shade + 8},0.15)`);
    g.addColorStop(1, `rgba(${shade},${shade},${shade + 8},0.92)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.width, view.height);
}
