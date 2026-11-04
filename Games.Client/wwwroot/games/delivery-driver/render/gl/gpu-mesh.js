// Uploading pure meshes (render/gl/meshes.js) to the GPU. The vertex layout is interleaved position, normal and colour
// (9 floats, 36 bytes) with 32-bit indices, matching the SCENE shader's attributes. `interleave` is pure for testing.

export const FLOATS_PER_VERTEX = 9;
export const STRIDE = FLOATS_PER_VERTEX * 4;

/** Interleaves a mesh's attributes into one Float32Array [px py pz nx ny nz r g b ...]. */
export function interleave(mesh) {
    const n = mesh.positions.length / 3;
    const out = new Float32Array(n * FLOATS_PER_VERTEX);
    for (let i = 0; i < n; i++) {
        const o = i * FLOATS_PER_VERTEX;
        out[o] = mesh.positions[i * 3]; out[o + 1] = mesh.positions[i * 3 + 1]; out[o + 2] = mesh.positions[i * 3 + 2];
        out[o + 3] = mesh.normals[i * 3]; out[o + 4] = mesh.normals[i * 3 + 1]; out[o + 5] = mesh.normals[i * 3 + 2];
        out[o + 6] = mesh.colors[i * 3]; out[o + 7] = mesh.colors[i * 3 + 1]; out[o + 8] = mesh.colors[i * 3 + 2];
    }
    return out;
}

/** GPU bytes a mesh takes (vertices + indices). */
export const meshBytes = mesh => (mesh.positions.length / 3) * STRIDE + mesh.indices.length * 4;

/** Uploads a mesh to attribute slots 0-2 (`ATTRIB_SLOTS`). Returns a handle, or null for an empty mesh. */
export function uploadMesh(gl, mesh) {
    if (!mesh || !mesh.indices.length) return null;
    const vao = gl.createVertexArray(), vbo = gl.createBuffer(), ibo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, interleave(mesh), gl.STATIC_DRAW);
    for (const [name, size, offset] of [['a_pos', 3, 0], ['a_normal', 3, 12], ['a_color', 3, 24]]) {
        const loc = ATTRIB_SLOTS[name];
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, offset);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, vbo, ibo, count: mesh.indices.length, bytes: meshBytes(mesh), bounds: null };
}

export function drawMesh(gl, handle) {
    gl.bindVertexArray(handle.vao);
    gl.drawElements(gl.TRIANGLES, handle.count, gl.UNSIGNED_INT, 0);
}

export function deleteMesh(gl, handle) {
    if (!handle) return;
    gl.deleteVertexArray(handle.vao);
    gl.deleteBuffer(handle.vbo);
    gl.deleteBuffer(handle.ibo);
}

/** Attribute slots every scene program is linked with (see createProgram's `locations`). */
export const ATTRIB_SLOTS = { a_pos: 0, a_normal: 1, a_color: 2 };

/** Extra attribute slots for the INSTANCED program: placement, scale and tint, one per instance. */
export const INSTANCE_SLOTS = { a_off: 3, a_scale: 4, a_tint: 5 };
const INSTANCE_STRIDE = 40;

/**
 * Binds a shared template mesh (an `uploadMesh` handle, kept alive by the caller) to an instance buffer: `data` is
 * INSTANCE_FLOATS floats per instance (see instances.js). Returns a handle for `drawInstances`, or null when empty.
 */
export function uploadInstances(gl, template, data) {
    if (!template || !data.length) return null;
    const vao = gl.createVertexArray(), vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, template.vbo);
    for (const [name, size, offset] of [['a_pos', 3, 0], ['a_normal', 3, 12], ['a_color', 3, 24]]) {
        const loc = ATTRIB_SLOTS[name];
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, offset);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, template.ibo);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    for (const [name, size, offset] of [['a_off', 4, 0], ['a_scale', 3, 16], ['a_tint', 3, 28]]) {
        const loc = INSTANCE_SLOTS[name];
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, INSTANCE_STRIDE, offset);
        gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    return { vao, vbo, count: template.count, instances: data.length / (INSTANCE_STRIDE / 4), bytes: data.byteLength };
}

export function drawInstances(gl, handle) {
    gl.bindVertexArray(handle.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, handle.count, gl.UNSIGNED_INT, 0, handle.instances);
}

/** Frees an instance set (the shared template mesh stays). */
export function deleteInstances(gl, handle) {
    if (!handle) return;
    gl.deleteVertexArray(handle.vao);
    gl.deleteBuffer(handle.vbo);
}

/**
 * A small mesh re-uploaded every frame (signals, cones). `update(mesh)` replaces the contents (null clears it);
 * draw it with drawMesh when `stream.handle` is set.
 */
export function createStream(gl) {
    const vao = gl.createVertexArray(), vbo = gl.createBuffer(), ibo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    for (const [name, size, offset] of [['a_pos', 3, 0], ['a_normal', 3, 12], ['a_color', 3, 24]]) {
        const loc = ATTRIB_SLOTS[name];
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, offset);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bindVertexArray(null);
    const stream = {
        handle: null,
        update(mesh) {
            if (!mesh || !mesh.indices.length) { stream.handle = null; return; }
            gl.bindVertexArray(vao);
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            gl.bufferData(gl.ARRAY_BUFFER, interleave(mesh), gl.DYNAMIC_DRAW);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.DYNAMIC_DRAW);
            gl.bindVertexArray(null);
            stream.handle = { vao, count: mesh.indices.length };
        },
        dispose() { gl.deleteVertexArray(vao); gl.deleteBuffer(vbo); gl.deleteBuffer(ibo); stream.handle = null; },
    };
    return stream;
}

/** Attribute slots of the INSTANCED_M program: the four columns of a per-instance matrix. */
export const MATRIX_SLOTS = { a_m0: 3, a_m1: 4, a_m2: 5, a_m3: 6 };

/**
 * A template mesh drawn many times with one matrix each, re-uploaded every frame (wheels). `update(floats, count)` takes
 * 16 floats per instance (column-major); `draw()` draws them all (nothing when count is 0).
 */
export function createMatrixBatch(gl, template) {
    const vao = gl.createVertexArray(), vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, template.vbo);
    for (const [name, size, offset] of [['a_pos', 3, 0], ['a_normal', 3, 12], ['a_color', 3, 24]]) {
        gl.enableVertexAttribArray(ATTRIB_SLOTS[name]);
        gl.vertexAttribPointer(ATTRIB_SLOTS[name], size, gl.FLOAT, false, STRIDE, offset);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, template.ibo);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    for (let k = 0; k < 4; k++) {
        const loc = MATRIX_SLOTS[`a_m${k}`];
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 64, k * 16);
        gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    const batch = {
        count: 0,
        update(floats, count) {
            batch.count = count;
            if (!count) return;
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            gl.bufferData(gl.ARRAY_BUFFER, floats.subarray(0, count * 16), gl.DYNAMIC_DRAW);
        },
        draw() {
            if (!batch.count) return;
            gl.bindVertexArray(vao);
            gl.drawElementsInstanced(gl.TRIANGLES, template.count, gl.UNSIGNED_INT, 0, batch.count);
        },
        dispose() { gl.deleteVertexArray(vao); gl.deleteBuffer(vbo); },
    };
    return batch;
}
