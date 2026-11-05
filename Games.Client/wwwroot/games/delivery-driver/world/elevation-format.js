// The baked elevation grid (world/seed/baked/elevation.bin): land heights above sea level in WORLD metres (real
// metres x WORLD_SCALE), on a regular grid of world-metre cells, as little-endian 16-bit integers.
//
// Header (24 bytes): magic 'ELV1' (4), width u16, height u16, minX f32, minY f32 (world metres of cell [0,0]'s
// centre), cell f32 (world metres), unit f32 (world metres per integer step). Then width x height Int16 values, row
// major from minY. Heights below sea level are clamped to 0 when baked (the sea floor is the terrain module's job).

export const ELEVATION_MAGIC = 0x31564c45; // 'ELV1'
const HEADER = 24;

/** {width, height, minX, minY, cell, unit, data: Int16Array} -> ArrayBuffer. */
export function encodeElevation({ width, height, minX, minY, cell, unit, data }) {
    const buf = new ArrayBuffer(HEADER + data.length * 2);
    const dv = new DataView(buf);
    dv.setUint32(0, ELEVATION_MAGIC, true);
    dv.setUint16(4, width, true); dv.setUint16(6, height, true);
    dv.setFloat32(8, minX, true); dv.setFloat32(12, minY, true);
    dv.setFloat32(16, cell, true); dv.setFloat32(20, unit, true);
    for (let i = 0; i < data.length; i++) dv.setInt16(HEADER + i * 2, data[i], true);
    return buf;
}

/** ArrayBuffer -> {width, height, minX, minY, cell, unit, data}. */
export function decodeElevation(buf) {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== ELEVATION_MAGIC) throw new Error('elevation.bin: bad magic');
    const width = dv.getUint16(4, true), height = dv.getUint16(6, true);
    const data = new Int16Array(width * height);
    for (let i = 0; i < data.length; i++) data[i] = dv.getInt16(HEADER + i * 2, true);
    return { width, height, minX: dv.getFloat32(8, true), minY: dv.getFloat32(12, true), cell: dv.getFloat32(16, true), unit: dv.getFloat32(20, true), data };
}

/** Bilinear height (world metres) at a world point; clamps to the grid edge. */
export function sampleElevation(dem, x, y) {
    const fx = Math.min(dem.width - 1.001, Math.max(0, (x - dem.minX) / dem.cell));
    const fy = Math.min(dem.height - 1.001, Math.max(0, (y - dem.minY) / dem.cell));
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const i = iy * dem.width + ix, d = dem.data, w = dem.width;
    return ((d[i] * (1 - tx) + d[i + 1] * tx) * (1 - ty) + (d[i + w] * (1 - tx) + d[i + w + 1] * tx) * ty) * dem.unit;
}
