// The greybox's whole scene as one layered mesh: a flat ground plane, then every edge and junction through the same road
// mesh builders the game uses (render/gl/road-mesh.js). Pure: no DOM, no GL.
import { createBuilder } from '../render/gl/meshes.js';
import { groundZ } from '../world/terrain.js';
import { buildEdgeMesh, buildNodeMesh } from '../render/gl/road-mesh.js';
import { GRID, GROUND_CELL } from './terrain.js';

export const GROUND_Z = -0.05;
const GRASS = [0.36, 0.5, 0.28];

/** The rolling ground: a height-field grid over GRID (flat, at the ground height, beyond it). Normals from central differences. */
function addHeightGrid(b, world) {
    const nx = Math.round((GRID.maxX - GRID.minX) / GROUND_CELL), ny = Math.round((GRID.maxY - GRID.minY) / GROUND_CELL), row = nx + 1;
    // the game's own ground (groundZ, not the raw hills): it is flat to the road's graded height across the carriageway and blends
    // into the land across the shoulder, so the grid (fine enough to resolve that) never clips through the road
    const z = new Float32Array(row * (ny + 1));
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) z[j * row + i] = groundZ(world, GRID.minX + i * GROUND_CELL, GRID.minY + j * GROUND_CELL, false);
    const ids = new Array(z.length);
    for (let j = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++) {
            const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, nx), j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, ny);
            const dzdx = (z[j * row + i1] - z[j * row + i0]) / (GROUND_CELL * (i1 - i0));
            const dzdy = (z[j1 * row + i] - z[j0 * row + i]) / (GROUND_CELL * (j1 - j0));
            const len = Math.hypot(dzdx, dzdy, 1);
            ids[j * row + i] = b.vertex(GRID.minX + i * GROUND_CELL, GRID.minY + j * GROUND_CELL, GROUND_Z + z[j * row + i], -dzdx / len, -dzdy / len, 1 / len, GRASS[0], GRASS[1], GRASS[2]);
        }
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) b.quad(ids[j * row + i], ids[j * row + i + 1], ids[(j + 1) * row + i + 1], ids[(j + 1) * row + i]);
}

export function buildGreyboxMesh(world, year = world.year, { detail = true } = {}) {
    const b = createBuilder();
    // the flat plane everywhere (it is the ground beyond the rolling grid, which sits on it at the same height where the hills fade out)
    const R = 3000;
    const q = [[-R, -R], [R, -R], [R, R], [-R, R]].map(([x, y]) => b.vertex(x, y, GROUND_Z, 0, 0, 1, GRASS[0], GRASS[1], GRASS[2]));
    b.quad(q[0], q[1], q[2], q[3]);
    if (world.groundKind === 'rolling') addHeightGrid(b, world);
    for (const e of world.graph.edges) buildEdgeMesh(world, e, year, { detail, into: b });
    for (const n of world.graph.nodes) buildNodeMesh(world, n, year, { detail, into: b });
    return b.finish();
}
