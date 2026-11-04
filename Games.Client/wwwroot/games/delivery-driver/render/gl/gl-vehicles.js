// The GL side of vehicle drawing: uploads the pure vehicle meshes (vehicle-mesh.js) once per (model, livery) in a small
// LRU, then each frame places the player's vehicle, the coupled and loose trailers, the fleet parked in yards and the
// traffic with model matrices. Wheels of every vehicle go in one instanced draw (so they steer and spin); lamps are
// separate small meshes whose colour follows the brake and headlight state; engine smoke is a per-frame mesh.
import { createProgram } from './program.js';
import { MODEL, INSTANCED_M } from './shaders.js';
import { uploadMesh, deleteMesh, drawMesh, ATTRIB_SLOTS, MATRIX_SLOTS, createMatrixBatch, createStream } from './gpu-mesh.js';
import * as mat4 from './mat4.js';
import {
    buildVehicleMesh, buildTrailerMesh, vehicleWheels, trailerWheels, wheelTemplates, poseMatrix, trailerMatrix, hitchWorld,
    wheelMatrix, damageTint, addSmoke, createMeshCache, vehicleKey, TAIL, HEAD,
} from './vehicle-mesh.js';
import { createBuilder, compose } from './meshes.js';
import { rectPoly } from './building-mesh.js';
import { lerpPose } from '../renderer.js';
import { agentDrawSpec } from '../../traffic/traffic.js';
import { slopeAt, groundZ } from '../../world/terrain.js';

const MAX_WHEELS = 300; // per wheel kind
const ONE = [1, 1, 1];

const lerp = (a, b, k) => a + (b - a) * k;

/**
 * Returns {draw(session, frame), stats, dispose()}. `setUniforms(program)` sets the scene's lighting/camera uniforms;
 * `frame` = {alpha, light, time, cx, cy, radius}.
 */
export function createVehicleDrawer(gl, setUniforms) {
    const model = createProgram(gl, MODEL, 'model', ATTRIB_SLOTS);
    const wheelProg = createProgram(gl, INSTANCED_M, 'wheels', { ...ATTRIB_SLOTS, ...MATRIX_SLOTS });
    const kinds = Object.entries(wheelTemplates()).map(([kind, mesh]) => {
        const handle = uploadMesh(gl, mesh);
        return { kind, handle, batch: createMatrixBatch(gl, handle), floats: new Float32Array(MAX_WHEELS * 16), n: 0 };
    });
    const byKind = Object.fromEntries(kinds.map(k => [k.kind, k]));
    const smoke = createStream(gl), blobStream = createStream(gl);
    const cache = createMeshCache(64, e => { for (const h of [e.body, e.head, e.tail]) if (h) deleteMesh(gl, h); });
    const spins = new WeakMap();
    const stats = { vehicles: 0, wheels: 0, drawCalls: 0 };
    const mv = new Float64Array(16), mt = new Float64Array(16), mw = new Float64Array(16), hitch = [0, 0, 0], identity = mat4.create();
    const pose = { x: 0, y: 0, heading: 0 }, tpose = { x: 0, y: 0, heading: 0 };
    let lastTime = 0, calls = 0, shadowPass = false;
    const blobB = { b: null };
    /** A dark soft rectangle on the ground under a vehicle (used when there is no shadow map). */
    const blob = (x, y, z, heading, spec, centreOffset) => {
        if (!blobB.b) return;
        const c = Math.cos(heading), s = Math.sin(heading);
        compose.prism(blobB.b, rectPoly(x + c * centreOffset, y + s * centreOffset, spec.length * 1.08, spec.width * 1.12, heading), 0.02, [0, 0, 0], { z0: z + 0.08, roofColor: [0, 0, 0] });
    };

    const upload = (key, build) => cache.get(key, () => {
        const m = build();
        return { body: uploadMesh(gl, m.body), head: m.head ? uploadMesh(gl, m.head) : null, tail: uploadMesh(gl, m.tail) };
    });

    function drawMeshAt(handle, matrix, tint, glow) {
        if (!handle) return;
        gl.uniformMatrix4fv(model.uniform('u_model'), false, matrix);
        gl.uniform3f(model.uniform('u_tint'), tint[0], tint[1], tint[2]);
        gl.uniform1f(model.uniform('u_glow'), glow);
        drawMesh(gl, handle);
        calls++;
    }

    /** Draws one placed object (body, lamps) and queues its wheels. */
    function place(entry, matrix, { damage = 0, brake = false, lampsOn = false }) {
        drawMeshAt(entry.body, matrix, damageTint(damage), 0);
        if (shadowPass) { stats.vehicles++; return; }
        drawMeshAt(entry.head, matrix, lampsOn ? HEAD.on : HEAD.off, lampsOn ? 1 : 0.15);
        drawMeshAt(entry.tail, matrix, brake ? TAIL.brake : TAIL.off, brake ? 1 : 0.3);
        stats.vehicles++;
    }

    function queueWheels(list, matrix, obj, speed, steer, dt) {
        let angle = spins.get(obj) ?? 0;
        const r0 = list[0]?.r ?? 0.5;
        angle = (angle + (speed * dt) / r0) % (Math.PI * 2);
        spins.set(obj, angle);
        for (const w of list) {
            const k = byKind[w.kind] ?? byKind.truck;
            if (k.n >= MAX_WHEELS) continue;
            wheelMatrix(mw, matrix, w, steer, angle * (r0 / w.r));
            k.floats.set(mw, k.n * 16);
            k.n++;
        }
    }

    function draw(session, { alpha, light, time, cx, cy, radius, night: nightLevel, shadow = false, blobs = false }) {
        const world = session.world;
        if (!world) return;
        shadowPass = shadow;
        const dt = shadow ? 0 : lastTime ? Math.min(0.1, Math.max(0, time - lastTime)) : 0;
        if (!shadow) lastTime = time;
        for (const k of kinds) k.n = 0;
        calls = 0; stats.vehicles = 0;
        const r2 = (radius + 20) * (radius + 20);
        const near = (x, y) => (x - cx) * (x - cx) + (y - cy) * (y - cy) < r2;
        const night = nightLevel !== undefined ? nightLevel > 0.5 : light < 0.6;
        const braking = (session.controls?.brake ?? 0) > 0;
        const livery = session.livery;
        const player = session.player;
        const smokeB = createBuilder();
        blobB.b = blobs && !shadow ? createBuilder() : null;

        model.use();
        setUniforms(model, light, 0);

        // ---- the player's vehicle ----
        let playerMatrix = null;
        if (player) {
            lerpPose(player, alpha, pose);
            const z = lerp(player.prevZ ?? player.z ?? 0, player.z ?? 0, alpha);
            poseMatrix(mv, pose.x, pose.y, z, pose.heading, player.pitch ?? 0, player.roll ?? 0);
            playerMatrix = Float64Array.from(mv);
            const damage = player.rec?.damage ?? 0;
            place(upload(vehicleKey(player.spec, livery, player.trailer ? 'c' : ''), () => buildVehicleMesh(player.spec, livery, { coupled: !!player.trailer })),
                mv, { damage, brake: braking, lampsOn: night });
            queueWheels(vehicleWheels(player.spec), mv, player, player.speed ?? 0, player.steer ?? 0, dt);
            if (!shadow) addSmoke(smokeB, time, { ...pose, z }, player.spec, damage);
            blob(pose.x, pose.y, z, pose.heading, player.spec, player.spec.length / 2 - player.spec.rearOverhang);
        }

        // ---- trailers (coupled ones hang on the player's fifth wheel) ----
        for (const t of session.trailerObjs?.values() ?? []) {
            if (!near(t.x, t.y)) continue;
            const spec = t.spec, lv = t.client ? t.livery : livery;
            const moving = t.coupled || t.speed;
            const p = moving ? lerpPose(t, alpha, tpose) : t;
            const tz = lerp(t.prevZ ?? t.z ?? 0, t.z ?? 0, moving ? alpha : 1);
            const tp = { x: p.x, y: p.y, z: tz, heading: p.heading, pitch: t.pitch ?? 0, roll: t.roll ?? 0 };
            let hook = null;
            if (t.coupled && playerMatrix) hook = hitchWorld(hitch, playerMatrix, player.spec);
            trailerMatrix(mt, spec, tp, hook);
            const legs = !t.coupled, cargo = t.cargoMass > 0;
            place(upload(`T:${spec.id}:${lv?.livery1}:${lv?.livery2}:${legs}:${cargo}`, () => buildTrailerMesh(spec, lv, { legs, cargo })),
                mt, { brake: t.coupled && braking, lampsOn: false });
            queueWheels(trailerWheels(spec), mt, t, t.coupled ? player.speed ?? 0 : t.speed ?? 0, 0, dt);
            blob(mt[12], mt[13], tz, tp.heading, spec, spec.length / 2 - spec.rearOverhang);
        }

        // ---- the fleet parked in yards ----
        for (const pv of session.parked?.() ?? []) {
            const pp = pv.pose;
            if (!near(pp.x, pp.y)) continue;
            const s = slopeAt(world, pp.x, pp.y, pp.heading, pv.spec.wheelbase, pv.spec.width);
            poseMatrix(mv, pp.x, pp.y, groundZ(world, pp.x, pp.y), pp.heading, s.pitch, s.roll);
            place(upload(vehicleKey(pv.spec, livery, ''), () => buildVehicleMesh(pv.spec, livery)), mv, { damage: pv.rec?.damage ?? 0, lampsOn: false });
            queueWheels(vehicleWheels(pv.spec), mv, pv.rec, 0, 0, dt);
            blob(pp.x, pp.y, mv[14], pp.heading, pv.spec, pv.spec.length / 2 - pv.spec.rearOverhang);
        }

        // ---- traffic ----
        for (const a of session.vehicles ?? []) {
            if (!near(a.x, a.y)) continue;
            const spec = agentDrawSpec(a);
            lerpPose(a, alpha, pose);
            const off = spec.length / 2 - spec.rearOverhang;
            const x = pose.x - Math.cos(pose.heading) * off, y = pose.y - Math.sin(pose.heading) * off;
            poseMatrix(mv, x, y, lerp(a.prevZ ?? a.z ?? 0, a.z ?? 0, alpha), pose.heading, a.pitch ?? 0, 0);
            const braked = a.speed < 0.5 && a.waiting > 0;
            place(upload(`A:${a.type}:${a.colour}:${a.era ?? 2}`, () => buildVehicleMesh(spec, livery)), mv,
                { brake: braked, lampsOn: night && a.type !== 'bicycle' && a.type !== 'cart' });
            queueWheels(vehicleWheels(spec), mv, a, a.speed ?? 0, 0, dt);
            blob(x, y, mv[14], pose.heading, spec, spec.length / 2 - spec.rearOverhang);
        }

        // ---- smoke, then all the wheels in one draw ----
        if (!shadow) {
            smoke.update(smokeB.vertexCount ? smokeB.finish() : null);
            if (smoke.handle) drawMeshAt(smoke.handle, identity, ONE, 0);
        }
        wheelProg.use();
        setUniforms(wheelProg, light, 0);
        let nWheels = 0;
        for (const k of kinds) { k.batch.update(k.floats, k.n); k.batch.draw(); if (k.n) calls++; nWheels += k.n; }
        if (blobB.b && blobB.b.vertexCount) {
            // soft dark ground patches, blended, once the opaque things are down
            model.use();
            setUniforms(model, light, 0);
            gl.uniform1f(model.uniform('u_alpha'), 0.28);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.depthMask(false);
            blobStream.update(blobB.b.finish());
            drawMeshAt(blobStream.handle, identity, ONE, 1);
            gl.depthMask(true);
            gl.disable(gl.BLEND);
        }
        stats.wheels = nWheels;
        stats.drawCalls = calls;
        gl.bindVertexArray(null);
    }

    return {
        stats,
        draw,
        dispose() {
            cache.clear();
            for (const k of kinds) { deleteMesh(gl, k.handle); k.batch.dispose(); }
            smoke.dispose();
            blobStream.dispose();
            model.dispose();
            wheelProg.dispose();
        },
    };
}
