import test from 'node:test';
import assert from 'node:assert/strict';
import { createChunkCache } from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/chunk-cache.js';
import { interleave, meshBytes, FLOATS_PER_VERTEX, STRIDE, ATTRIB_SLOTS } from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/gpu-mesh.js';
import { box } from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/meshes.js';

const chunk = (i, j) => ({ i, j });

function harness(max = 400) {
    const log = { built: [], disposed: [] };
    const cache = createChunkCache({
        build: (c, lod) => { log.built.push(`${c.i},${c.j}@${lod}`); return { id: `${c.i},${c.j}@${lod}` }; },
        dispose: e => log.disposed.push(e.data.id),
        max,
    });
    return { cache, log };
}

test('interleave packs position, normal and colour per vertex in the slots the shader expects', () => {
    const m = box(1, 2, 3, 2, 2, 2, [0.1, 0.2, 0.3]);
    const data = interleave(m);
    assert.equal(data.length, (m.positions.length / 3) * FLOATS_PER_VERTEX);
    assert.equal(STRIDE, 36);
    for (let i = 0; i < m.positions.length / 3; i++) {
        for (let k = 0; k < 3; k++) {
            assert.equal(data[i * 9 + k], m.positions[i * 3 + k]);
            assert.equal(data[i * 9 + 3 + k], m.normals[i * 3 + k]);
            assert.equal(data[i * 9 + 6 + k], m.colors[i * 3 + k]);
        }
    }
    assert.equal(meshBytes(m), (m.positions.length / 3) * 36 + m.indices.length * 4);
    assert.deepEqual(ATTRIB_SLOTS, { a_pos: 0, a_normal: 1, a_color: 2 });
});

test('the cache builds lazily, once per chunk and LOD, and reuses entries', () => {
    const { cache, log } = harness();
    const c = chunk(1, 1);
    cache.beginFrame();
    const a = cache.get(c, 0, 5);
    assert.equal(cache.get(c, 0, 5), a);
    assert.equal(log.built.length, 1);
});

test('the per-frame budget limits builds; a chunk keeps drawing its old LOD until the new one is built', () => {
    const { cache, log } = harness();
    const c = chunk(0, 0);
    cache.beginFrame();
    const near = cache.get(c, 1, 1);
    assert.ok(near);
    assert.equal(cache.get(chunk(5, 5), 0, 1), null, 'over budget: nothing to draw yet');
    assert.equal(cache.get(c, 0, 1), near, 'over budget: the old LOD stays on screen');
    assert.equal(log.built.length, 1);
    cache.beginFrame();
    const fine = cache.get(c, 0, 1);
    assert.notEqual(fine, near);
    assert.equal(fine.lod, 0);
    assert.deepEqual(log.disposed, ['0,0@1'], 'the replaced LOD is freed');
});

test('prune frees chunks the world evicted (including regenerated ones with a new identity) and keeps the rest', () => {
    const { cache, log } = harness();
    const c1 = chunk(0, 0), c2 = chunk(1, 0);
    cache.beginFrame();
    cache.get(c1, 0, 9);
    cache.get(c2, 0, 9);
    cache.prune(c => c === c1);
    assert.equal(cache.size, 1);
    assert.deepEqual(log.disposed, ['1,0@0']);
    // the chunk comes back as a new object: the old entry is replaced and freed, not reused
    const c1b = chunk(0, 0);
    cache.beginFrame();
    cache.get(c1b, 0, 9);
    assert.equal(log.built.length, 3);
    assert.equal(cache.size, 1);
    assert.ok(log.disposed.includes('0,0@0'));
});

test('the cache never holds more than max entries: the least recently used go first', () => {
    const { cache, log } = harness(3);
    for (let f = 0; f < 5; f++) {
        cache.frame = f;
        cache.beginFrame();
        cache.get(chunk(f, 0), 0, 9);
    }
    cache.frame = 5;
    cache.prune(() => true);
    assert.equal(cache.size, 3);
    assert.deepEqual(log.disposed.sort(), ['0,0@0', '1,0@0']);
    cache.clear();
    assert.equal(cache.size, 0);
    assert.equal(log.disposed.length, 5);
});
