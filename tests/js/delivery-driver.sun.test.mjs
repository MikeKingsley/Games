import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/sun.js';
import { minutesAt } from '../../Games.Client/wwwroot/games/delivery-driver/game/calendar.js';

const at = (month, day, hour, minute = 0) => minutesAt(1960, month, day, hour, minute);
const len = v => Math.hypot(...v);
const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

test('noon sun is higher than midnight sun, and summer noon higher than winter noon', () => {
    const noon = S.sunPosition(at(5, 21, 12, 14)).elevation, midnight = S.sunPosition(at(5, 21, 0)).elevation, winter = S.sunPosition(at(11, 21, 12, 14)).elevation;
    assert.ok(noon > 0 && midnight < 0 && noon > winter && winter > 0);
    // 50.5 N: about 63 degrees at the June solstice, 16 at the December one
    assert.ok(Math.abs(noon / (Math.PI / 180) - 63) < 1.5 && Math.abs(winter / (Math.PI / 180) - 16) < 1.5);
});

test('the sun is in the south at noon, east in the morning and west in the evening', () => {
    const d = m => S.sunLight(m).sunDir;
    assert.ok(d(at(5, 21, 12, 14))[1] > 0.3, 'south is +y');
    assert.ok(d(at(5, 21, 8))[0] > 0.3, 'east in the morning');
    assert.ok(d(at(5, 21, 17))[0] < -0.3, 'west in the evening');
});

test('light directions are unit vectors', () => {
    for (let h = 0; h < 24; h += 1.5) for (const m of [0, 5, 11]) {
        const l = S.sunLight(at(m, 15, Math.floor(h), (h % 1) * 60));
        assert.ok(Math.abs(len(l.dir) - 1) < 1e-9 && Math.abs(len(l.sunDir) - 1) < 1e-9, `${m} ${h}`);
    }
});

test('the light fades to almost nothing below the horizon and the moon is much dimmer than the sun', () => {
    const noon = S.sunLight(at(5, 21, 12, 14)), night = S.sunLight(at(5, 21, 1));
    assert.ok(lum(noon.color) > 0.8);
    assert.ok(lum(night.color) < 0.2 && lum(night.color) > 0.03, `${lum(night.color)}`);
    assert.ok(night.night > 0.9 && noon.night === 0 && noon.day === 1);
    assert.ok(night.color[2] > night.color[0], 'the moon is blue');
    assert.ok(night.dir[2] > 0, 'the moon light still comes from above');
    // intensity is ~0 around the swap between sun and moon
    let lowest = Infinity;
    for (let h = 18; h < 24; h += 0.05) lowest = Math.min(lowest, lum(S.sunLight(at(11, 15, Math.floor(h), (h % 1) * 60)).color));
    assert.ok(lowest < 0.1);
});

test('the colour is warmer at dawn and dusk than at noon', () => {
    const redness = c => c[0] / (c[2] || 1e-9);
    const dawn = S.sunLight(at(11, 21, 8, 30)), noon = S.sunLight(at(11, 21, 12, 14)), summerNoon = S.sunLight(at(5, 21, 12, 14));
    assert.ok(redness(dawn.color) > redness(summerNoon.color) * 1.2, `${redness(dawn.color)} vs ${redness(summerNoon.color)}`);
    assert.ok(redness(dawn.color) > redness(noon.color));
    assert.ok(dawn.warmth > noon.warmth && dawn.warmth > 0.3);
});

test('continuous across time steps and periodic over 24 hours', () => {
    for (const m of [2, 5, 11]) {
        let prev = null;
        for (let t = 0; t <= 1440; t += 1) {
            const l = S.sunLight(at(m, 10, 0) + t);
            const v = [...l.color, ...l.horizon, ...l.ambientSky, l.night, l.day];
            if (prev) for (let i = 0; i < v.length; i++) assert.ok(Math.abs(v[i] - prev[i]) < 0.03, `month ${m} minute ${t} component ${i}: ${prev[i]} -> ${v[i]}`);
            prev = v;
        }
    }
    const a = S.sunLight(at(5, 10, 9, 30)), b = S.sunLight(at(5, 10, 9, 30) + 1440);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(a.color[i] - b.color[i]) < 0.01 && Math.abs(a.horizon[i] - b.horizon[i]) < 0.01);
});

test('weather dims the sun, greys the sky, shortens the fog and wets the roads', () => {
    const m = at(5, 21, 12, 14);
    const clear = S.sceneLighting(m), cloud = S.sceneLighting(m, { kind: 'overcast', intensity: 0.5 }), rain = S.sceneLighting(m, { kind: 'rain', intensity: 1 });
    const fog = S.sceneLighting(m, { kind: 'fog', intensity: 1 }, 500, 40);
    assert.ok(lum(cloud.sunColor) < lum(clear.sunColor) && lum(rain.sunColor) < lum(cloud.sunColor));
    assert.ok(rain.wet > 0.9 && clear.wet === 0 && cloud.wet === 0);
    assert.ok(rain.shadowStrength < clear.shadowStrength);
    assert.ok(fog.fogFar <= 40 && clear.fogFar > 500 && fog.fogNear < fog.fogFar);
    const spread = c => Math.max(...c) - Math.min(...c);
    assert.ok(spread(rain.horizon) < spread(clear.horizon), 'greyer');
    assert.equal(clear.sunVisible, 1); assert.equal(rain.sunVisible, 0);
    // night is darker than noon in every weather
    for (const w of [{ kind: 'clear' }, { kind: 'rain', intensity: 1 }, { kind: 'fog', intensity: 1 }]) {
        const n = S.sceneLighting(at(5, 21, 1), w), d = S.sceneLighting(m, w);
        assert.ok(lum(n.skyColor) < lum(d.skyColor) && lum(n.fogColor) < lum(d.fogColor), w.kind);
    }
});

test('the shadow direction never drops below the minimum elevation and keeps the compass direction', () => {
    const low = [0.9, 0.1, 0.05];
    const l = Math.hypot(...low), d = S.shadowDirection(low.map(v => v / l));
    assert.ok(Math.abs(len(d) - 1) < 1e-9);
    assert.ok(Math.asin(d[2]) >= 18 * Math.PI / 180 - 1e-9);
    assert.ok(d[0] > 0 && d[1] > 0 && d[0] / d[1] > 8, 'same heading');
    const high = [0, 0.3, 0.954];
    const hl = Math.hypot(...high);
    const same = S.shadowDirection(high.map(v => v / hl));
    assert.ok(Math.abs(same[2] - high[2] / hl) < 1e-9);
});

import * as W from '../../Games.Client/wwwroot/games/delivery-driver/render/gl/weather.js';

test('rain settings: none unless raining, more and faster with intensity, thinned by quality', () => {
    assert.equal(W.rainSettings({ kind: 'clear', intensity: 0 }).count, 0);
    assert.equal(W.rainSettings({ kind: 'fog', intensity: 1 }).count, 0);
    assert.equal(W.rainSettings(null).count, 0);
    const light = W.rainSettings({ kind: 'rain', intensity: 0.2 }, 'high'), heavy = W.rainSettings({ kind: 'rain', intensity: 1 }, 'high');
    assert.ok(heavy.count > light.count && heavy.speed > light.speed && heavy.length > light.length && heavy.wind > light.wind);
    const low = W.rainSettings({ kind: 'rain', intensity: 1 }, 'low'), med = W.rainSettings({ kind: 'rain', intensity: 1 }, 'medium');
    assert.ok(low.count < med.count && med.count < heavy.count);
    assert.ok(W.wetRoads({ kind: 'rain' }) && !W.wetRoads({ kind: 'overcast' }));
});
