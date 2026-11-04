// Shader compile/link with readable errors, plus a cache of uniform and attribute locations.

function compile(gl, type, source, label) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`${label} shader failed to compile: ${log}`);
    }
    return shader;
}

/** Builds a program from {vertex, fragment} (optionally pinning attribute names to slots); throws an Error with the GLSL log when compiling or linking fails. */
export function createProgram(gl, { vertex, fragment }, name = 'program', locations = null) {
    const vs = compile(gl, gl.VERTEX_SHADER, vertex, `${name} vertex`);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragment, `${name} fragment`);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    // fixed attribute slots let one VAO serve several programs that share a vertex layout
    if (locations) for (const [attr, slot] of Object.entries(locations)) gl.bindAttribLocation(program, slot, attr);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`${name} failed to link: ${log}`);
    }
    const uniforms = new Map();
    const attribs = new Map();
    return {
        program,
        use: () => gl.useProgram(program),
        uniform(n) {
            let loc = uniforms.get(n);
            if (loc === undefined) { loc = gl.getUniformLocation(program, n); uniforms.set(n, loc); }
            return loc;
        },
        attrib(n) {
            let loc = attribs.get(n);
            if (loc === undefined) { loc = gl.getAttribLocation(program, n); attribs.set(n, loc); }
            return loc;
        },
        dispose: () => gl.deleteProgram(program),
    };
}
