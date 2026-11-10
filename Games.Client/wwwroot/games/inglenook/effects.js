// Motion and effects for Inglenook: vehicle shadows, chimney steam, buffer squeeze, coupling slack and rocking.
// Everything here is a render offset or an extra SVG element. It never reads or changes simulation state beyond looking at poses and speed.
import { el } from './svg.js';
import { shadowOffset } from './scenery-plan.js';
import { hash } from './noise.js';
import { BODY_W } from './draw-stock.js';

export const PUFF_DISTANCE = 0.22; // one chimney puff per this many wagon lengths travelled (Phase 7's chuffs use the same rule)
export const MAX_PUFFS = 40; // pool size: elements are created lazily up to this and then reused
const PUFF_LIFE = 1.5; // seconds a puff takes to grow and fade
const WIND = { x: 0.14, y: -0.34 }; // fixed wind in yard coordinates, wagon lengths per second
const CHIMNEY = 0.64, VALVE = -0.1, FRONT = 0.85; // loco-local x positions (see draw-stock.js)
const SQUEEZE = 0.04, SQUEEZE_TIME = 0.25; // buffer squeeze: wagon lengths, seconds
const SLACK = 0.018, SLACK_STEP = 0.05, SLACK_TIME = 0.35; // coupling slack per gap, delay per wagon, duration
const ROCK_DEG = 0.5; // largest sway in degrees (the plan allows under 0.6)
const SHADOW_OFFSET = shadowOffset(0.3);

/**
 * createEffects(layers, ctx) -> { update(sim, poses, dt), onEvent(e), offsetOf(id), reset(), setQuality(q), destroy() }.
 * `offsetOf(id)` gives { x, y, rot } (yard units and degrees) that render.js adds to a vehicle's drawn pose.
 * ctx.reducedMotion turns off particles, rocking and squeeze whatever the quality.
 */
export function createEffects(layers, ctx) {
    layers.shadows.setAttribute('pointer-events', 'none');
    layers.steam.setAttribute('pointer-events', 'none');
    const calm = !!ctx.reducedMotion;
    let low = ctx.quality === 'low';

    const shadowEls = {};
    const puffs = [];
    const kicks = []; // { id, ax, ay, delay, dur, t }: a one-off push and return of a vehicle, in yard coordinates
    const offsets = {};
    const rockState = { amp: 0, phase: 0 };
    let pending = [];
    let prev = null; // last loco position
    let dir = null; // last direction of loco travel, unit vector
    let wasMoving = false;
    let startPending = false;
    let dist = 0;
    let wisp = 0;

    const offsetOf = id => offsets[id] ?? (offsets[id] = { x: 0, y: 0, rot: 0 });

    function spawn(x, y, vx, vy, r0, r1, opacity, life = PUFF_LIFE) {
        let p = puffs.find(q => !q.active);
        if (!p) {
            if (puffs.length >= MAX_PUFFS) return;
            p = { active: false, el: el('circle', { class: 'ig-steam', fill: '#e4e8e8', 'pointer-events': 'none', display: 'none' }, layers.steam) };
            puffs.push(p);
        }
        Object.assign(p, { active: true, x, y, vx, vy, r0, r1, opacity, life, age: 0 });
        p.el.removeAttribute('display');
        paint(p);
    }
    function paint(p) {
        const t = p.age / p.life;
        p.el.setAttribute('cx', p.x.toFixed(3));
        p.el.setAttribute('cy', p.y.toFixed(3));
        p.el.setAttribute('r', (p.r0 + (p.r1 - p.r0) * t).toFixed(3));
        p.el.setAttribute('fill-opacity', (p.opacity * (1 - t) * (1 - t * 0.3)).toFixed(3));
    }
    function clearPuffs() { for (const p of puffs) { p.active = false; p.el.setAttribute('display', 'none'); } }
    function removePuffs() { for (const p of puffs) p.el.remove(); puffs.length = 0; }
    function removeShadows() { for (const id of Object.keys(shadowEls)) { shadowEls[id].remove(); delete shadowEls[id]; } }

    /** World position of a point `lx` along the loco (loco-local x, before the flip) with sideways offset `ly`. */
    const onLoco = (loco, lx, ly = 0) => {
        const s = loco.flip ? -1 : 1, c = Math.cos(loco.angle), n = Math.sin(loco.angle);
        const x = lx * s;
        return { x: loco.x + c * x - n * ly, y: loco.y + n * x + c * ly };
    };

    function addKick(id, ax, ay, delay, dur) { kicks.push({ id, ax, ay, delay, dur, t: 0 }); }

    function handlePending(poses, loco) {
        for (const type of pending) {
            if (!loco || !dir) continue;
            const rake = poses.filter(p => p.rake === loco.rake).sort((a, b) => (b.x * dir.x + b.y * dir.y) - (a.x * dir.x + a.y * dir.y));
            rake.forEach((p, rank) => { // the vehicles at the contact close up most
                const a = SQUEEZE / (1 + rank) * (type === 'coupled' ? 0.8 : 1);
                addKick(p.id, dir.x * a, dir.y * a, 0, SQUEEZE_TIME);
            });
        }
        pending = [];
    }

    function startSlack(poses, loco) {
        const rake = poses.filter(p => p.rake === loco.rake);
        for (const p of rake) {
            const k = Math.abs(p.index - loco.index);
            if (k === 0) continue;
            const a = SLACK * Math.min(k, 4); // each wagon lags a little more than the one in front, so the gaps open one after another
            addKick(p.id, -dir.x * a, -dir.y * a, (k - 1) * SLACK_STEP, SLACK_TIME);
        }
    }

    /** Vehicle shadows: one offset dark rounded shape per vehicle, following position and angle (no filter). */
    function drawShadows(poses) {
        if (low) return;
        {
            for (const p of poses) {
                let s = shadowEls[p.id];
                if (!s) s = shadowEls[p.id] = el('rect', { class: 'ig-vshadow', x: -p.len / 2, y: -BODY_W / 2, width: p.len, height: BODY_W, rx: 0.1, fill: '#000', opacity: 0.3, 'pointer-events': 'none' }, layers.shadows);
                const o = offsetOf(p.id);
                s.setAttribute('transform', `translate(${(p.x + o.x + SHADOW_OFFSET.x).toFixed(3)} ${(p.y + o.y + SHADOW_OFFSET.y).toFixed(3)}) rotate(${(p.angle * 180 / Math.PI + o.rot).toFixed(2)})`);
            }
        }
    }

    function update(sim, poses, dt) {
        const loco = poses.find(p => p.kind === 'loco');
        const speed = Math.abs(sim.speed);
        const moving = speed > 0.05;
        let moved = 0;
        if (loco) {
            if (prev) {
                const dx = loco.x - prev.x, dy = loco.y - prev.y;
                const d = Math.hypot(dx, dy);
                if (d < 1) { moved = d; if (d > 1e-5) dir = { x: dx / d, y: dy / d }; } // a bigger jump is a teleport (undo), not travel
            }
            prev = { x: loco.x, y: loco.y };
        }

        if (calm || dt <= 0) { if (dt > 0) wasMoving = moving; drawShadows(poses); return; }

        // squeeze and slack kicks, rocking
        if (startPending && dir && moved > 0) { startPending = false; if (loco) startSlack(poses, loco); }
        handlePending(poses, loco);
        if (moving && !wasMoving && loco) {
            startPending = true;
            if (!low) { // drain-cock steam at the front when starting from rest
                const side = loco.angle + Math.PI / 2;
                for (const ly of [-0.2, 0.2]) {
                    const q = onLoco(loco, FRONT, ly), sg = Math.sign(ly);
                    spawn(q.x, q.y, Math.cos(side) * sg * 0.55, Math.sin(side) * sg * 0.55, 0.035, 0.17, 0.5, 0.7);
                }
            }
        }
        wasMoving = moving;

        rockState.amp += ((moving ? 1 : 0) - rockState.amp) * Math.min(1, dt * (moving ? 4 : 3));
        rockState.phase += speed * dt * 8;
        for (const p of poses) {
            const o = offsetOf(p.id);
            o.x = 0; o.y = 0;
            const h = hash(p.id);
            o.rot = ROCK_DEG * rockState.amp * Math.sin(rockState.phase * (0.85 + (h % 100) / 330) + (h >>> 8) % 628 / 100);
        }
        for (let i = kicks.length - 1; i >= 0; i--) {
            const k = kicks[i];
            k.t += dt;
            const u = (k.t - k.delay) / k.dur;
            if (u >= 1) { kicks.splice(i, 1); continue; }
            if (u <= 0) continue;
            const f = Math.sin(Math.PI * u), o = offsetOf(k.id);
            o.x += k.ax * f; o.y += k.ay * f;
        }

        drawShadows(poses);

        // steam: a puff per PUFF_DISTANCE travelled, a wisp from the safety valve while standing
        if (!low && loco) {
            dist += moved;
            for (let n = 0; dist >= PUFF_DISTANCE && n < 3; n++) {
                dist -= PUFF_DISTANCE;
                const q = onLoco(loco, CHIMNEY);
                spawn(q.x, q.y, WIND.x + (Math.random() - 0.5) * 0.08, WIND.y + (Math.random() - 0.5) * 0.08, 0.07, 0.4, 0.75);
            }
            if (dist > PUFF_DISTANCE) dist = 0;
            if (speed < 0.01) {
                wisp += dt;
                if (wisp > 0.5) { wisp = 0; const q = onLoco(loco, VALVE); spawn(q.x, q.y, WIND.x * 0.7, WIND.y * 0.7 - 0.05, 0.03, 0.12, 0.3); }
            }
            for (const p of puffs) {
                if (!p.active) continue;
                p.age += dt;
                if (p.age >= p.life) { p.active = false; p.el.setAttribute('display', 'none'); continue; }
                p.x += p.vx * dt; p.y += p.vy * dt;
                paint(p);
            }
        }
    }

    return {
        update,
        offsetOf,
        onEvent(e) {
            if (!calm && (e.type === 'coupled' || e.type === 'buffer' || e.type === 'bumped')) pending.push(e.type);
        },
        /** Clear everything running so nothing animates across a teleport (undo, level start). */
        reset() {
            kicks.length = 0;
            pending = [];
            prev = null; dir = null; wasMoving = false; startPending = false; dist = 0; wisp = 0;
            rockState.amp = 0;
            for (const id of Object.keys(offsets)) { const o = offsets[id]; o.x = 0; o.y = 0; o.rot = 0; }
            clearPuffs();
        },
        /** Steps down only: at 'low' the shadows and all steam elements are removed from the page. */
        setQuality(q) {
            if (q !== 'low' || low) return;
            low = true;
            removePuffs();
            removeShadows();
        },
        destroy() {
            removePuffs();
            removeShadows();
            kicks.length = 0;
        },
    };
}
