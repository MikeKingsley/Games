// The baked elevation grid (world/seed/baked/elevation.bin): land heights above sea level in WORLD metres (real
// metres x WORLD_SCALE), on a regular grid of world-metre cells (24 m at 1:4, ~96 real m).
//
// Header (24 bytes): magic 'ELV2' (4), width u16, height u16, minX f32, minY f32 (world metres of cell [0,0]'s
// centre), cell f32 (world metres), unit f32 (world metres per integer step). Then the body, row major from minY:
// each cell is predicted from its neighbours (left + up - up-left, the "LOCO" plane predictor), and the residual is
// zig-zag mapped and written as a base-128 varint (7 bits per byte, high bit = more). A zero residual is the common
// case (sea, flat land and smooth slopes), so runs of zeros are collapsed: byte 0x00 is followed by a varint
// (run length - 1). Heights below sea level are clamped to 0 when baked (the sea floor is the terrain module's job).
// At 1:4 this is ~3.5 M cells in about 1 MB, so the file is small even when the server does not compress it.

export const ELEVATION_MAGIC = 0x32564c45; // 'ELV2'
const HEADER = 24;

const predict = (d, i, w, x, y) => {
    const a = x ? d[i - 1] : (y ? d[i - w] : 0);
    const b = y ? d[i - w] : a;
    const c = x && y ? d[i - w - 1] : b;
    return a + b - c;
};

/** {width, height, minX, minY, cell, unit, data: Int16Array} -> ArrayBuffer. */
export function encodeElevation({ width, height, minX, minY, cell, unit, data }) {
    const body = [];
    const varint = v => { while (v >= 128) { body.push((v & 127) | 128); v = Math.floor(v / 128); } body.push(v); };
    let run = 0;
    const flush = () => { if (run) { body.push(0); varint(run - 1); run = 0; } };
    for (let y = 0, i = 0; y < height; y++) {
        for (let x = 0; x < width; x++, i++) {
            const r = data[i] - predict(data, i, width, x, y);
            if (r === 0) { run++; continue; }
            flush();
            varint(r < 0 ? -2 * r - 1 : 2 * r);
        }
    }
    flush();
    const buf = new ArrayBuffer(HEADER + body.length);
    const dv = new DataView(buf);
    dv.setUint32(0, ELEVATION_MAGIC, true);
    dv.setUint16(4, width, true); dv.setUint16(6, height, true);
    dv.setFloat32(8, minX, true); dv.setFloat32(12, minY, true);
    dv.setFloat32(16, cell, true); dv.setFloat32(20, unit, true);
    new Uint8Array(buf, HEADER).set(body);
    return buf;
}

/** ArrayBuffer -> {width, height, minX, minY, cell, unit, data}. */
export function decodeElevation(buf) {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== ELEVATION_MAGIC) throw new Error('elevation.bin: bad magic');
    const width = dv.getUint16(4, true), height = dv.getUint16(6, true);
    const data = new Int16Array(width * height);
    const bytes = new Uint8Array(buf, HEADER);
    let p = 0;
    const varint = () => { let v = 0, m = 1, b; do { b = bytes[p++]; v += (b & 127) * m; m *= 128; } while (b & 128); return v; };
    let zeros = 0;
    for (let y = 0, i = 0; y < height; y++) {
        for (let x = 0; x < width; x++, i++) {
            let r = 0;
            if (zeros > 0) zeros--;
            else {
                const z = varint();
                if (z === 0) zeros = varint(); // this cell and `zeros` more have a zero residual
                else r = z & 1 ? -(z + 1) / 2 : z / 2;
            }
            data[i] = predict(data, i, width, x, y) + r;
        }
    }
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
