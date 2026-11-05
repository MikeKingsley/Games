// The greybox's whole scene as one layered mesh: a flat ground plane, then every edge and junction through the same road
// mesh builders the game uses (render/gl/road-mesh.js). Pure: no DOM, no GL.
import { createBuilder } from '../render/gl/meshes.js';
import { buildEdgeMesh, buildNodeMesh } from '../render/gl/road-mesh.js';

export const GROUND_Z = -0.05;
const GRASS = [0.36, 0.5, 0.28];

export function buildGreyboxMesh(world, year = world.year, { detail = true } = {}) {
    const b = createBuilder();
    const R = 3000;
    const q = [[-R, -R], [R, -R], [R, R], [-R, R]].map(([x, y]) => b.vertex(x, y, GROUND_Z, 0, 0, 1, GRASS[0], GRASS[1], GRASS[2]));
    b.quad(q[0], q[1], q[2], q[3]);
    for (const e of world.graph.edges) buildEdgeMesh(world, e, year, { detail, into: b });
    for (const n of world.graph.nodes) buildNodeMesh(world, n, year, { detail, into: b });
    return b.finish();
}
