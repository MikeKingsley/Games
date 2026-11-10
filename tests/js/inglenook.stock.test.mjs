import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wagonSpec, WAGON_TYPES } from '../../Games.Client/wwwroot/games/inglenook/draw-stock.js';
import { COLORS } from '../../Games.Client/wwwroot/games/inglenook/levels.js';

const wagon = n => ({ id: `w${n}`, number: n, color: COLORS[(n - 1) % COLORS.length], stuck: false });

test('wagonSpec is deterministic', () => {
    for (let n = 1; n <= 12; n++) assert.deepEqual(wagonSpec(wagon(n)), wagonSpec(wagon(n)));
});

test('wagonSpec covers all four types across wagons 1-12', () => {
    const types = new Set(Array.from({ length: 12 }, (_, i) => wagonSpec(wagon(i + 1)).type));
    assert.deepEqual([...types].sort(), [...WAGON_TYPES].sort());
});

test('body livery is never an ID-panel colour and weathering is in range', () => {
    for (let n = 1; n <= 40; n++) for (const stuck of [false, true]) {
        const s = wagonSpec({ ...wagon(n), stuck });
        assert.ok(!COLORS.includes(s.livery), `wagon ${n} livery ${s.livery}`);
        assert.ok(s.weathering >= 0.25 && s.weathering <= 0.9);
    }
});
