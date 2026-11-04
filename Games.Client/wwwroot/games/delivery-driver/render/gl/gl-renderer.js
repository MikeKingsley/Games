// WebGL2 renderer. Draws the terrain, water, coast, roads, bridges, junctions and yards of the chunks around the
// camera, plus a coarse far-field mesh for the distance. Buildings, vehicles, lighting and the real chase camera come
// in later phases; until then a fixed oblique camera follows the player (north-up). Same surface as the Canvas
// renderer: {stats, resize, draw, dispose}.
import { createContext, probeCapabilities, watchContext } from './context.js';
import { createProgram } from './program.js';
import { SCENE, WATER, INSTANCED, SKY, RAIN } from './shaders.js';
import * as mat4 from './mat4.js';
import { QUALITY, CHUNK_SIZE } from '../../config.js';
import { groundZ } from '../../world/terrain.js';
import { uploadMesh, drawMesh, deleteMesh, ATTRIB_SLOTS, INSTANCE_SLOTS, uploadInstances, drawInstances, deleteInstances, createStream } from './gpu-mesh.js';
import { buildChunkMesh, buildFarField, WATER_ALPHA } from './terrain-mesh.js';
import { buildChunkRoads, chunkRoadSignature } from './road-mesh.js';
import { buildChunkProps, propsEra, chunkSignalNodes, buildDynamicProps, lampStyle } from './prop-mesh.js';
import { sceneLighting, shadowDirection } from './sun.js';
import { fitShadow, shadowRadius, SHADOW_SIZE } from './shadow.js';
import { rainSettings } from './weather.js';
import { broadleafTemplate, coniferTemplate, rockTemplate, buildTreeInstances, buildRockInstances } from './instances.js';
import { signalPhase } from '../../traffic/traffic.js';
import { currentStop } from '../../game/contracts.js';
import { createVehicleDrawer } from './gl-vehicles.js';
import { createChunkCache } from './chunk-cache.js';
import { obliqueCamera, cameraFromView, frustumPlanes, visibleChunks, lodFor, viewDistance } from './camera3d.js';

/** Head lamp colours by era (the Canvas renderer's tints) and street lamp light by era: gas, sodium, white. */
const HEADLIGHT = [[1, 0.84, 0.59], [1, 0.89, 0.67], [1, 0.94, 0.78], [0.98, 0.97, 0.9], [0.92, 0.95, 1]];
const LAMP_TINT = [[1, 0.84, 0.55], [1, 0.84, 0.55], [1, 0.67, 0.27], [1, 0.67, 0.27], [0.92, 0.94, 1]];
const ERROR_CHECK_EVERY = 30; // gl.getError() stalls the pipeline, so only look now and then

const handlesOf = data => [data.ground, data.surf, data.water, data.roads, data.props];
const instancesOf = data => [data.treesB, data.treesC, data.rocks];

/** Rebuilds only the road mesh of a cached chunk (the ground, water and surf do not depend on the year). */
function refreshRoads(gl, world, entry, year, wet, track) {
    const sig = chunkRoadSignature(world, entry.chunk, year, wet);
    if (sig === entry.data.roadSig) return false;
    if (entry.data.roads) { track(-entry.data.roads.bytes); deleteMesh(gl, entry.data.roads); }
    entry.data.roads = uploadMesh(gl, buildChunkRoads(world, entry.chunk, year, { wet }));
    if (entry.data.roads) track(entry.data.roads.bytes);
    entry.data.roadSig = sig;
    return true;
}

/** Rebuilds only the static props mesh (buildings, lamps, signs, hedges) of a cached chunk when the era changed. */
function refreshProps(gl, world, entry, year, detail, track) {
    const sig = propsEra(year);
    entry.data.signals = chunkSignalNodes(world, entry.chunk, year);
    if (sig === entry.data.propsSig) return false;
    if (entry.data.props) { track(-entry.data.props.bytes); deleteMesh(gl, entry.data.props); }
    entry.data.props = uploadMesh(gl, buildChunkProps(world, entry.chunk, year, { detail }));
    if (entry.data.props) track(entry.data.props.bytes);
    entry.data.propsSig = sig;
    return true;
}

/** Context restores tolerated before giving up on WebGL. */
const MAX_RESTORES = 2;

/**
 * Returns null when no WebGL2 context or the shaders are unavailable (the caller then uses Canvas 2D).
 * callbacks: {onLost(), onFailed(reason)}; onFailed means the context could not be restored.
 */
export function createGlRenderer({ canvas, view, callbacks = {}, quality = 'medium' }) {
    const q0 = QUALITY.medium;
    const antialias = !!(QUALITY[quality] ?? q0).antialias;
    const gl = createContext(canvas, { antialias });
    if (!gl) return null;

    const stats = { kind: 'webgl', antialias, buildings: 0, chunks: 0, drawables: 0, drawCalls: 0, triangles: 0, gpuBytes: 0, chunkBuilds: 0, roadRebuilds: 0, culled: 0, glErrors: 0, lost: false };
    const caps = probeCapabilities(gl);
    const cam = {}, planes = frustumPlanes(mat4.create());
    const target = { x: 0, y: 0, z: 0 };
    let scene = null, water = null, inst = null, far = null, farRegion = null, cache = null, frame = 0, disposed = false, gpuBytes = 0;
    let sky = null, rainProg = null;
    let shadowTex = null, shadowFbo = null, shadowSize = 0, dummyTex = null, emptyVao = null;
    let tmpl = null, stream = null, vehicles = null, treeQuality = 1, qualityKey = '';
    let world = null, year = 1919, wet = false;

    /** Roof height of the building or wall at (x, y) (with a margin round it), or -Infinity: keeps the chase camera outside. */
    const solidProbe = { x: 0, y: 0, hx: 0.1, hy: 0.1, angle: 0 }, solidHits = [];
    const solidTop = (x, y) => {
        solidProbe.x = x; solidProbe.y = y;
        let top = -Infinity;
        for (const it of world.colliders.query(solidProbe, solidHits)) {
            const h = it.ref?.h;
            if (!h || (it.kind !== 'building' && it.kind !== 'rock')) continue;
            const b = it.box, c = Math.cos(b.angle), s = Math.sin(b.angle), dx = x - b.x, dy = y - b.y;
            if (Math.abs(dx * c + dy * s) > b.hx + 0.8 || Math.abs(-dx * s + dy * c) > b.hy + 0.8) continue;
            top = Math.max(top, (it.ref.z ?? 0) + h);
        }
        return top;
    };

    function build() {
        scene = createProgram(gl, SCENE, 'scene', ATTRIB_SLOTS);
        water = createProgram(gl, WATER, 'water', ATTRIB_SLOTS);
        inst = createProgram(gl, INSTANCED, 'instanced', { ...ATTRIB_SLOTS, ...INSTANCE_SLOTS });
        sky = createProgram(gl, SKY, 'sky');
        rainProg = createProgram(gl, RAIN, 'rain');
        emptyVao = gl.createVertexArray();
        dummyTex = null; shadowTex = null; shadowFbo = null; shadowSize = 0;
        tmpl = { broadleaf: uploadMesh(gl, broadleafTemplate()), conifer: uploadMesh(gl, coniferTemplate()), rock: uploadMesh(gl, rockTemplate()) };
        stream = createStream(gl);
        vehicles = createVehicleDrawer(gl, setUniforms);
        cache = createChunkCache({
            build(chunk, lod) {
                const m = buildChunkMesh(world, chunk, { lod });
                const roads = buildChunkRoads(world, chunk, year, { wet });
                const near = lod === 0;
                const props = buildChunkProps(world, chunk, year, { detail: near });
                const trees = buildTreeInstances(chunk, treeQuality, !near);
                const data = {
                    ground: uploadMesh(gl, m.ground), surf: uploadMesh(gl, m.surf), water: uploadMesh(gl, m.water), roads: uploadMesh(gl, roads),
                    roadSig: chunkRoadSignature(world, chunk, year, wet), props: uploadMesh(gl, props), propsSig: propsEra(year),
                    treesB: uploadInstances(gl, tmpl.broadleaf, trees.broadleaf), treesC: uploadInstances(gl, tmpl.conifer, trees.conifer),
                    rocks: uploadInstances(gl, tmpl.rock, buildRockInstances(chunk)), signals: chunkSignalNodes(world, chunk, year),
                    trees: trees.count, buildings: chunk.buildings.length, furniture: near ? chunk.lamps.length + chunk.signs.length : 0,
                };
                for (const h of [...handlesOf(data), ...instancesOf(data)]) if (h) gpuBytes += h.bytes;
                stats.chunkBuilds++;
                return data;
            },
            dispose(entry) {
                for (const h of handlesOf(entry.data)) if (h) { gpuBytes -= h.bytes; deleteMesh(gl, h); }
                for (const h of instancesOf(entry.data)) if (h) { gpuBytes -= h.bytes; deleteInstances(gl, h); }
            },
        });
    }

    function release() {
        if (!gl.isContextLost()) {
            cache?.clear();
            if (far) deleteMesh(gl, far);
            for (const h of Object.values(tmpl ?? {})) deleteMesh(gl, h);
            stream?.dispose();
            vehicles?.dispose();
            scene?.dispose();
            water?.dispose();
            inst?.dispose();
            sky?.dispose();
            rainProg?.dispose();
            if (emptyVao) gl.deleteVertexArray(emptyVao);
            if (shadowTex) { gl.deleteTexture(shadowTex); gl.deleteFramebuffer(shadowFbo); }
            if (dummyTex) gl.deleteTexture(dummyTex);
        }
        sky = null; rainProg = null; emptyVao = null; dummyTex = null; shadowTex = null; shadowFbo = null; shadowSize = 0;
        scene = null; water = null; inst = null; tmpl = null; stream = null; vehicles = null; far = null; farRegion = null; cache = null; gpuBytes = 0;
    }

    try { build(); } catch (err) {
        console.warn('Delivery Driver: WebGL setup failed, using the compatibility renderer.', err);
        release();
        return null;
    }

    let restores = 0;
    const unwatch = watchContext(canvas, {
        onLost: () => { stats.lost = true; callbacks.onLost?.(); },
        onRestored: () => {
            // a context that keeps dying is not worth rebuilding: give up and let the caller use Canvas 2D
            if (++restores > MAX_RESTORES) { callbacks.onFailed?.('context lost repeatedly'); return; }
            try { release(); build(); stats.lost = false; } catch (err) { callbacks.onFailed?.(String(err)); }
        },
        onFailed: () => { if (stats.lost) callbacks.onFailed?.('context lost'); },
    });

    function countErrors() {
        let e;
        while ((e = gl.getError()) !== gl.NO_ERROR && e !== gl.CONTEXT_LOST_WEBGL) stats.glErrors++;
    }

    // ---- lighting state for the frame ----
    let L = sceneLighting(0);
    let vpActive = null, shadowPassNow = false, shadowStrength = 0;
    const lightVp = mat4.create();
    const spotPos = new Float32Array(32), spotDir = new Float32Array(32), spotCol = new Float32Array(24);
    let spotCount = 0;
    const shadowFit = {};
    const SHADOW_UNIT = 4;

    function depthTexture(size) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
        return tex;
    }

    /** (Re)creates the shadow map for a size (0 = no shadows) and always leaves a depth texture on the shadow unit. */
    function ensureShadow(size) {
        if (!dummyTex) { gl.activeTexture(gl.TEXTURE0 + SHADOW_UNIT); dummyTex = depthTexture(1); gl.activeTexture(gl.TEXTURE0); }
        if (size === shadowSize) return;
        if (shadowTex) { gl.deleteTexture(shadowTex); gl.deleteFramebuffer(shadowFbo); shadowTex = null; shadowFbo = null; }
        shadowSize = size;
        if (!size) return;
        gl.activeTexture(gl.TEXTURE0 + SHADOW_UNIT);
        shadowTex = depthTexture(size);
        shadowFbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
        gl.drawBuffers([gl.NONE]);
        gl.readBuffer(gl.NONE);
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.activeTexture(gl.TEXTURE0);
        if (!ok) { gl.deleteTexture(shadowTex); gl.deleteFramebuffer(shadowFbo); shadowTex = null; shadowFbo = null; shadowSize = 0; }
    }
    const bindShadowUnit = tex => { gl.activeTexture(gl.TEXTURE0 + SHADOW_UNIT); gl.bindTexture(gl.TEXTURE_2D, tex ?? dummyTex); gl.activeTexture(gl.TEXTURE0); };

    function setUniforms(p, light, time) {
        gl.uniformMatrix4fv(p.uniform('u_vp'), false, vpActive ?? cam.vp);
        gl.uniformMatrix4fv(p.uniform('u_lightVp'), false, lightVp);
        gl.uniform3fv(p.uniform('u_sunDir'), L.sunDir);
        gl.uniform3fv(p.uniform('u_sunColor'), L.sunColor);
        gl.uniform3fv(p.uniform('u_skyColor'), L.skyColor);
        gl.uniform3fv(p.uniform('u_groundColor'), L.groundColor);
        gl.uniform3f(p.uniform('u_eye'), cam.eye[0], cam.eye[1], cam.eye[2]);
        gl.uniform3fv(p.uniform('u_fogColor'), L.fogColor);
        gl.uniform2f(p.uniform('u_fog'), L.fogNear, L.fogFar);
        gl.uniform1f(p.uniform('u_alpha'), 1);
        gl.uniform1f(p.uniform('u_night'), L.night);
        gl.uniform1f(p.uniform('u_wet'), L.wet);
        gl.uniform1f(p.uniform('u_shadowOn'), shadowPassNow ? 0 : shadowStrength);
        gl.uniform1f(p.uniform('u_shadowSize'), shadowSize || 1);
        gl.uniform1i(p.uniform('u_shadow'), SHADOW_UNIT);
        gl.uniform3fv(p.uniform('u_windowTint'), L.windowTint);
        gl.uniform3fv(p.uniform('u_lampTint'), L.lampTint);
        gl.uniform1i(p.uniform('u_spotCount'), shadowPassNow ? 0 : spotCount);
        if (spotCount && !shadowPassNow) {
            gl.uniform4fv(p.uniform('u_spotPos'), spotPos);
            gl.uniform4fv(p.uniform('u_spotDir'), spotDir);
            gl.uniform3fv(p.uniform('u_spotCol'), spotCol);
        }
        const t = p.uniform('u_time');
        if (t) gl.uniform1f(t, time);
    }

    /** Fills the night-light arrays: the player's headlights, the two nearest lit vehicles, then the nearest street lamps. */
    function gatherSpots(session, entries, yearNow) {
        spotCount = 0;
        const n = L.night;
        if (n < 0.05 || !session.player) return;
        const pl = session.player, era = lampStyle(yearNow).era;
        const add = (x, y, z, dx, dy, dz, cone, range, col, k) => {
            if (spotCount >= 8) return;
            const i = spotCount++;
            spotPos.set([x, y, z, cone], i * 4);
            spotDir.set([dx, dy, dz, range], i * 4);
            spotCol.set([col[0] * k, col[1] * k, col[2] * k], i * 3);
        };
        const head = (x, y, z, heading, len, k) => {
            const reach = [24, 36, 48, 60, 72][era], c = Math.cos(heading), s = Math.sin(heading);
            const dl = Math.hypot(1, 0.07);
            add(x + c * len, y + s * len, z + 1.0, c / dl, s / dl, -0.07 / dl, Math.cos(0.62), reach, HEADLIGHT[era], k);
        };
        head(pl.x, pl.y, pl.z ?? 0, pl.heading, pl.spec.length - pl.spec.rearOverhang, 3.4 * n);
        const lit = (session.vehicles ?? []).filter(v => v.type !== 'bicycle' && v.type !== 'cart').map(v => ({ v, d: Math.hypot(v.x - pl.x, v.y - pl.y) })).filter(o => o.d < 70).sort((a, b) => a.d - b.d).slice(0, 2);
        for (const { v } of lit) head(v.x, v.y, v.z ?? 0, v.heading, v.spec.len / 2, 1.8 * n);
        const style = lampStyle(yearNow), lamps = [];
        for (const e of entries) {
            if (e.lod !== 0) continue;
            for (const l of e.chunk.lamps ?? []) {
                const d = Math.hypot(l.x - pl.x, l.y - pl.y);
                if (d < 55) lamps.push({ l, d });
            }
        }
        lamps.sort((a, b) => a.d - b.d);
        for (const { l } of lamps) add(l.x, l.y, (l.z ?? 0) + style.height - 0.3, 0, 0, -1, -2, 22, L.lampTint, 0.55 * n);
    }

    const drawHandle = h => {
        if (!h) return;
        drawMesh(gl, h);
        stats.drawCalls++;
        stats.triangles += h.count / 3;
    };

    /** One shadow map pass from the sun: buildings, lamps, trees, rocks and vehicles near the focus cast shadows. */
    function renderShadows(session, entries, focus, dir, radius, frameInfo) {
        const fit = fitShadow(shadowFit, dir, focus, radius, shadowSize);
        gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
        gl.viewport(0, 0, shadowSize, shadowSize);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.colorMask(false, false, false, false);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(2, 4);
        bindShadowUnit(null);
        vpActive = fit.vp; shadowPassNow = true;
        const calls = stats.drawCalls, tris = stats.triangles;
        const near = entries.filter(e => Math.hypot((e.chunk.i + 0.5) * CHUNK_SIZE - focus[0], (e.chunk.j + 0.5) * CHUNK_SIZE - focus[1]) < radius + CHUNK_SIZE * 0.8);
        scene.use();
        setUniforms(scene, 1, 0);
        for (const e of near) drawHandle(e.data.props);
        inst.use();
        setUniforms(inst, 1, 0);
        for (const e of near) for (const h of instancesOf(e.data)) if (h) drawInstances(gl, h);
        vehicles.draw(session, { ...frameInfo, shadow: true });
        stats.shadowCalls = stats.drawCalls - calls + vehicles.stats.drawCalls;
        stats.drawCalls = calls; stats.triangles = tris;
        vpActive = null; shadowPassNow = false;
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.colorMask(true, true, true, true);
        gl.enable(gl.CULL_FACE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        bindShadowUnit(shadowTex);
        lightVp.set(fit.vp);
    }

    function drawSky(session) {
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        sky.use();
        gl.uniformMatrix4fv(sky.uniform('u_invVp'), false, cam.inv);
        gl.uniform3fv(sky.uniform('u_horizon'), L.horizon);
        gl.uniform3fv(sky.uniform('u_zenith'), L.zenith);
        gl.uniform3fv(sky.uniform('u_sunDir'), L.sunDir);
        const m = Math.max(0.2, ...L.sunColor);
        gl.uniform3f(sky.uniform('u_sunColor'), L.sunColor[0] / m, L.sunColor[1] / m, L.sunColor[2] / m);
        gl.uniform1f(sky.uniform('u_sunVisible'), L.sunVisible);
        gl.uniform1f(sky.uniform('u_warmth'), L.warmth);
        gl.bindVertexArray(emptyVao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.depthMask(true);
        gl.enable(gl.DEPTH_TEST);
    }

    function drawRain(rain, time, center) {
        if (!rain.count) return;
        rainProg.use();
        gl.uniformMatrix4fv(rainProg.uniform('u_vp'), false, cam.vp);
        gl.uniform3f(rainProg.uniform('u_center'), center[0], center[1], center[2]);
        gl.uniform1f(rainProg.uniform('u_time'), time);
        gl.uniform4f(rainProg.uniform('u_rain'), rain.speed, rain.length, rain.wind, rain.area);
        const c = rain.color, k = 0.35 + 0.65 * L.day;
        gl.uniform3f(rainProg.uniform('u_color'), c[0] * k, c[1] * k, c[2] * k);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.bindVertexArray(emptyVao);
        gl.drawArrays(gl.LINES, 0, rain.count * 2);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        stats.drawCalls++;
    }

    return {
        kind: 'webgl',
        stats,
        caps,
        /** The canvas backing store is sized by the caller; this only has to track the viewport (done every frame). */
        resize() {},
        draw(session, camera, alpha = 1) {
            if (disposed || stats.lost || gl.isContextLost()) return;
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            stats.drawCalls = 0;
            stats.triangles = 0;
            if (!session.world) {
                gl.clearColor(0.15, 0.2, 0.15, 1);
                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            } else {
                world = session.world;
                const newYear = session.year ?? 1919, newWet = session.weather?.kind === 'rain';
                if (newYear !== year || newWet !== wet) {
                    year = newYear; wet = newWet;
                    stats.roadRebuilds = 0;
                    for (const e of cache.entries.values()) {
                        if (refreshRoads(gl, world, e, year, wet, d => { gpuBytes += d; })) stats.roadRebuilds++;
                        refreshProps(gl, world, e, year, e.lod === 0, d => { gpuBytes += d; });
                    }
                }
                if (farRegion !== world.region) {
                    if (far) deleteMesh(gl, far);
                    far = uploadMesh(gl, buildFarField(world.region, { cells: (QUALITY[session.settings?.quality] ?? q0).farField ?? 96 }));
                    farRegion = world.region;
                }
                const p = camera.proj, player = session.player;
                target.x = p.cx; target.y = p.cy; target.z = player.z ?? 0;
                const aspect = canvas.width / Math.max(1, canvas.height);
                const qName = session.settings?.quality;
                const q = QUALITY[qName] ?? q0;
                const radius = viewDistance(q);
                if (camera.view3d) {
                    const ground = (x, y) => groundZ(world, x, y);
                    cameraFromView(cam, camera.view3d, aspect, { ground, solidTop, far: radius * 1.6 + 400 });
                    camera.gl = { vp: cam.vp, inv: cam.inv, width: canvas.clientWidth || canvas.width, height: canvas.clientHeight || canvas.height, ground };
                } else obliqueCamera(cam, target, aspect);
                frustumPlanes(cam.vp, planes);
                // the sun, sky, fog and weather for the clock (the practice yard is always a clear noon)
                const clock = session.career?.calendar?.minutes ?? 12 * 60;
                const minutes = session.inPractice ? Math.floor(clock / 1440) * 1440 + 12 * 60 : clock;
                const weather = session.weather ?? { kind: 'clear', intensity: 0 };
                L = sceneLighting(minutes, weather, radius, session.visibility ?? Infinity);
                const era = lampStyle(year).era;
                L.windowTint = era >= 3 ? [1, 0.88, 0.66] : [1, 0.74, 0.4];
                L.lampTint = LAMP_TINT[era];
                gl.clearColor(L.horizon[0], L.horizon[1], L.horizon[2], 1);
                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
                const key = `${qName}:${q.trees}`;
                if (key !== qualityKey) { if (qualityKey) cache.clear(); qualityKey = key; treeQuality = q.trees ?? 1; }
                cache.frame = frame;
                cache.beginFrame();
                const chunks = world.chunks.around(p.cx, p.cy, radius, session.chunkBudget ?? 3);
                const entries = [];
                for (const c of visibleChunks(planes, chunks)) {
                    const d = Math.hypot((c.i + 0.5) * CHUNK_SIZE - p.cx, (c.j + 0.5) * CHUNK_SIZE - p.cy);
                    if (d > radius + CHUNK_SIZE) continue;
                    const e = cache.get(c, lodFor(d), 2);
                    if (e) entries.push(e);
                }
                stats.culled = chunks.length - entries.length;
                stats.chunks = entries.length;
                gatherSpots(session, entries, year);
                const time = performance.now() / 1000;
                const frameInfo = { alpha, light: 1, time, night: L.night, cx: p.cx, cy: p.cy, radius };
                // shadows: one pass from the sun around the camera's focus, when the preset has them and the sun is out
                const size = q.shadows ? q.shadowMapSize ?? SHADOW_SIZE[qName] ?? SHADOW_SIZE.medium : 0;
                ensureShadow(size);
                shadowStrength = 0;
                const blobs = !shadowTex;
                if (shadowTex && L.shadowStrength > 0.06) {
                    shadowStrength = Math.min(1, L.shadowStrength * 1.1);
                    renderShadows(session, entries, [cam.look[0], cam.look[1], cam.look[2]], shadowDirection(L.sunDir), shadowRadius(camera.view3d?.distance ?? 30), frameInfo);
                } else bindShadowUnit(null);
                frameInfo.blobs = blobs && L.shadowStrength > 0.06;
                gl.viewport(0, 0, canvas.width, canvas.height);
                drawSky(session);
                gl.enable(gl.DEPTH_TEST);
                gl.enable(gl.CULL_FACE);
                gl.frontFace(gl.CW); // the y flip mirrors the scene, so the meshes' counter-clockwise faces wind clockwise on screen
                scene.use();
                setUniforms(scene, 1, 0);
                // the far field goes first and never writes depth: the chunk meshes always cover it, valleys included
                gl.depthMask(false);
                drawHandle(far);
                gl.depthMask(true);
                for (const e of entries) drawHandle(e.data.ground);
                gl.enable(gl.POLYGON_OFFSET_FILL);
                gl.polygonOffset(-1, -2);
                for (const e of entries) drawHandle(e.data.roads);
                for (const e of entries) drawHandle(e.data.surf);
                gl.disable(gl.POLYGON_OFFSET_FILL);
                // buildings, lamps, signs, hedges, harbours: one static mesh per chunk
                let drawables = 0, buildings = 0;
                for (const e of entries) {
                    drawHandle(e.data.props);
                    buildings += e.data.buildings;
                    drawables += e.data.buildings + e.data.furniture + e.data.trees + (e.data.rocks?.instances ?? 0);
                }
                // trees and rocks: instanced templates
                inst.use();
                setUniforms(inst, 1, 0);
                for (const e of entries) for (const h of instancesOf(e.data)) if (h) { drawInstances(gl, h); stats.drawCalls++; stats.triangles += h.instances * h.count / 3; }
                // signals and cones change every frame: a tiny mesh rebuilt each time
                scene.use();
                const signalNodes = [];
                for (const e of entries) if (e.data.signals.length) signalNodes.push(...e.data.signals);
                const pr = world.practice;
                const cones = Math.hypot(pr.x - p.cx, pr.y - p.cy) < radius + 120 ? pr.cones : null;
                const simTime = session.traffic?.time ?? 0;
                const bays = [];
                const ay = session.activeYard;
                if (ay?.yard?.marker && Math.hypot(ay.yard.marker.x - p.cx, ay.yard.marker.y - p.cy) < radius + 40) {
                    const m = ay.yard.marker, mc = Math.cos(m.heading), ms = Math.sin(m.heading);
                    bays.push({ x: m.x + mc * 3.5, y: m.y + ms * 3.5, len: 7, dep: 3.4, angle: m.heading });
                }
                if (cones) {
                    const bay = pr.bays[session.practiceBay ?? 1], bc = Math.cos(bay.heading), bs = Math.sin(bay.heading);
                    bays.push({ x: bay.x + bc * 8, y: bay.y + bs * 8, len: 16, dep: 3.6, angle: bay.heading });
                }
                const rings = [];
                const stop = session.career?.job && currentStop(session.career.job);
                if (stop?.kind === 'door' && Math.hypot(stop.x - p.cx, stop.y - p.cy) < radius + 40) rings.push({ x: stop.x, y: stop.y, ok: !!session.stopCheck?.ok });
                stream.update(buildDynamicProps(world, { signalNodes, phaseOf: n => signalPhase(n, simTime), cones, bays, rings, time }));
                drawHandle(stream.handle);
                drawables += signalNodes.length * 4 + (cones?.length ?? 0);
                vehicles.draw(session, frameInfo);
                stats.drawCalls += vehicles.stats.drawCalls;
                stats.vehicles = vehicles.stats.vehicles;
                stats.buildings = buildings;
                stats.drawables = drawables;
                // translucent water last, without writing depth
                water.use();
                setUniforms(water, 1, time);
                gl.uniform1f(water.uniform('u_alpha'), WATER_ALPHA);
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                gl.depthMask(false);
                for (const e of entries) drawHandle(e.data.water);
                gl.depthMask(true);
                gl.disable(gl.BLEND);
                drawRain(rainSettings(weather, qName), time, cam.look);
                gl.bindVertexArray(null);
                stats.shadows = !!shadowTex && shadowStrength > 0;
                stats.night = L.night;
                stats.spots = spotCount;
                stats.lighting = L;
                if (frame % 60 === 0) cache.prune(c => world.chunks.has(c.i, c.j) && world.chunks.cache.get((c.i + 32768) * 65536 + (c.j + 32768)) === c);
                stats.gpuBytes = gpuBytes;
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
