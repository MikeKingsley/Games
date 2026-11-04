// Camera: chase mode (behind the truck, rotating with it) or north-up, with zoom steps and a reversing zoom-out.
import { createProjection, setProjection, toWorld } from '../render/projection.js';
import { TILT, screenToGround as unprojectGround } from '../render/gl/camera3d.js';

export const ZOOMS = [3, 5, 7.5, 10, 14, 19, 26]; // px per metre at a 700 px reference screen
const DEFAULT_ZOOM = 4;
/** The chase camera sits `DIST_K / zoom` metres from the truck (zoom = the Canvas px per metre step). */
const DIST_K = 350;
const REVERSE_TILT = 12; // degrees: the reversing view also rises a little

/** Wraps an angle to (-PI, PI]. */
export function wrapAngle(a) {
    a = (a + Math.PI) % (2 * Math.PI);
    if (a < 0) a += 2 * Math.PI;
    return a - Math.PI;
}

/** Camera rotation that puts `heading` (0 = east, +y south) pointing straight up the screen. */
export function chaseRotation(heading) {
    return heading + Math.PI / 2;
}

export function createCamera() {
    const proj = createProjection();
    const cam = {
        mode: 'chase',
        zoomIndex: DEFAULT_ZOOM,
        x: 0, y: 0, rot: 0, zoom: ZOOMS[DEFAULT_ZOOM], fit: 1,
        proj,
        snapped: false,
        /** 3D camera tilt in degrees above the horizon (15..75). Canvas ignores it. */
        tilt: TILT.default,
        /** The smoothed chase-camera state for the WebGL renderer: {tx, ty, tz, az, distance, tilt, ahead}. */
        view3d: { tx: 0, ty: 0, tz: 0, az: 0, distance: 25, tilt: (TILT.default * Math.PI) / 180, ahead: 0 },
        /** Set each frame by the WebGL renderer: {inv, width, height, ground} for unprojecting taps. */
        gl: null,
        tiltUp() { cam.tilt = Math.min(TILT.max, cam.tilt + TILT.step); },
        tiltDown() { cam.tilt = Math.max(TILT.min, cam.tilt - TILT.step); },
        /** Steps the tilt up, wrapping round to the lowest (one touch button). */
        cycleTilt() { cam.tilt = cam.tilt + TILT.step > TILT.max ? TILT.min : cam.tilt + TILT.step; },
        /** The ground point under a screen pixel: the heightfield ray hit in 3D, the oblique inverse otherwise. */
        screenToGround(sx, sy, out = { x: 0, y: 0, z: 0 }) {
            if (cam.gl) return unprojectGround(cam.gl.inv, sx, sy, cam.gl.width, cam.gl.height, cam.gl.ground, out);
            toWorld(proj, sx, sy, out);
            out.z = 0;
            return out;
        },
        /** Swings the chase camera 180 degrees round the truck, to look back along the road (the button toggles it). */
        flip: false,
        toggleFlip() { cam.flip = !cam.flip; },
        toggleMode() { cam.mode = cam.mode === 'chase' ? 'north' : 'chase'; },
        zoomIn() { cam.zoomIndex = Math.min(ZOOMS.length - 1, cam.zoomIndex + 1); },
        zoomOut() { cam.zoomIndex = Math.max(0, cam.zoomIndex - 1); },
        /**
         * Follows a target {x, y, heading, speed, reversing, length}. `length` is the rig length in metres,
         * so the reversing view zooms out far enough to show the whole trailer.
         */
        update(target, view, dt) {
            const scale = Math.min(view.width, view.height) / 700;
            let zoom = ZOOMS[cam.zoomIndex] * Math.max(0.55, scale);
            zoom *= 1 - Math.min(0.25, Math.abs(target.speed ?? 0) / 100); // pull back a little at speed
            if (target.reversing) {
                const fit = (Math.min(view.width, view.height) * 0.42) / Math.max(8, (target.length ?? 6) * 1.6);
                zoom = Math.min(zoom * 0.8, fit);
            }
            const turn = cam.flip ? Math.PI : 0;
            const wantRot = cam.mode === 'chase' ? chaseRotation(target.heading) + turn : 0;
            const k = cam.snapped ? 1 - Math.exp(-dt * 4) : 1;
            const kz = cam.snapped ? 1 - Math.exp(-dt * 3) : 1;
            cam.rot = wrapAngle(cam.rot + wrapAngle(wantRot - cam.rot) * k);
            cam.zoom += (zoom - cam.zoom) * kz;
            // chase: look ahead of the truck (it sits low on the screen); reversing: look behind it
            const ahead = cam.mode === 'chase' ? (target.reversing ? -0.15 : 0.18) : 0;
            cam.x = target.x;
            cam.y = target.y;
            update3d(target, dt);
            cam.snapped = true;
            setProjection(proj, {
                cx: cam.x, cy: cam.y, rot: cam.rot, zoom: cam.zoom,
                ox: view.width / 2, oy: view.height * (0.5 + ahead), width: view.width, height: view.height,
            });
            return proj;
        },
    };

    /** Eases the chase-camera state towards the target: heading, distance (zoom), tilt, and the point it looks at. */
    function update3d(target, dt) {
        const v = cam.view3d, first = !cam.snapped;
        const reversing = !!target.reversing;
        let dist = DIST_K / ZOOMS[cam.zoomIndex];
        dist *= 1 + Math.min(0.25, Math.abs(target.speed ?? 0) / 100);
        let tiltDeg = cam.tilt;
        if (reversing) {
            // pull back and up so the whole rig, trailer included, is in view
            dist = Math.max(dist * 1.3, (target.length ?? 6) * 1.8 + 8);
            tiltDeg = Math.min(TILT.max, tiltDeg + REVERSE_TILT);
        }
        const az = cam.mode === 'chase' ? target.heading + (cam.flip ? Math.PI : 0) : -Math.PI / 2;
        const k = first ? 1 : 1 - Math.exp(-dt * 6), kt = first ? 1 : 1 - Math.exp(-dt * 10), kd = first ? 1 : 1 - Math.exp(-dt * 3);
        v.az = wrapAngle(v.az + wrapAngle(az - v.az) * (cam.mode === 'chase' ? (first ? 1 : 1 - Math.exp(-dt * 4)) : 1));
        v.distance += (dist - v.distance) * kd;
        v.tilt += ((tiltDeg * Math.PI) / 180 - v.tilt) * kd;
        v.tx += (target.x - v.tx) * (first ? 1 : kt);
        v.ty += (target.y - v.ty) * (first ? 1 : kt);
        v.tz += ((target.z ?? 0) - v.tz) * (first ? 1 : k);
        // chase: aim a little ahead so the truck sits low on screen; reversing: aim behind it
        v.ahead = cam.mode === 'chase' ? v.distance * (reversing ? -0.08 : 0.22) : 0;
    }
    return cam;
}
