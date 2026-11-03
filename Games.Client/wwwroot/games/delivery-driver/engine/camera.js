// Camera: chase mode (behind the truck, rotating with it) or north-up, with zoom steps and a reversing zoom-out.
import { createProjection, setProjection } from '../render/projection.js';

export const ZOOMS = [3, 5, 7.5, 10, 14, 19, 26]; // px per metre at a 700 px reference screen
const DEFAULT_ZOOM = 4;

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
            const wantRot = cam.mode === 'chase' ? chaseRotation(target.heading) : 0;
            const k = cam.snapped ? 1 - Math.exp(-dt * 4) : 1;
            const kz = cam.snapped ? 1 - Math.exp(-dt * 3) : 1;
            cam.rot = wrapAngle(cam.rot + wrapAngle(wantRot - cam.rot) * k);
            cam.zoom += (zoom - cam.zoom) * kz;
            // chase: look ahead of the truck (it sits low on the screen); reversing: look behind it
            const ahead = cam.mode === 'chase' ? (target.reversing ? -0.15 : 0.18) : 0;
            cam.x = target.x;
            cam.y = target.y;
            cam.snapped = true;
            setProjection(proj, {
                cx: cam.x, cy: cam.y, rot: cam.rot, zoom: cam.zoom,
                ox: view.width / 2, oy: view.height * (0.5 + ahead), width: view.width, height: view.height,
            });
            return proj;
        },
    };
    return cam;
}
