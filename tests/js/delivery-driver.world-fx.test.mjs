import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weatherFor, gripFor, isNight, sunTimes, daylight, visibilityFor } from '../../Games.Client/wwwroot/games/delivery-driver/game/environment.js';
import { minutesAt } from '../../Games.Client/wwwroot/games/delivery-driver/game/calendar.js';
import { createVehicle, stepVehicle } from '../../Games.Client/wwwroot/games/delivery-driver/sim/vehicle.js';
import { vehicleById } from '../../Games.Client/wwwroot/games/delivery-driver/game/catalogue.js';

test('weather is deterministic per seed and day', () => {
    for (let d = 0; d < 60; d++) {
        const m = minutesAt(1950, 0, 1) + d * 1440;
        assert.deepEqual(weatherFor(1919, m), weatherFor(1919, m + 600), 'same day, same weather');
        assert.deepEqual(weatherFor(1919, m, true), weatherFor(1919, m, true));
    }
    const days = n => Array.from({ length: n }, (_, d) => weatherFor(1919, minutesAt(1950, 0, 1) + d * 1440).kind).join();
    const other = n => Array.from({ length: n }, (_, d) => weatherFor(7, minutesAt(1950, 0, 1) + d * 1440).kind).join();
    assert.notEqual(days(60), other(60), 'another seed, other weather');
    const kinds = new Set(days(365).split(','));
    for (const k of ['clear', 'overcast', 'rain']) assert.ok(kinds.has(k), k);
});

test('fog is much more likely up on the moors', () => {
    let moor = 0, low = 0;
    for (let d = 0; d < 1000; d++) {
        const m = minutesAt(1960, 0, 1) + d * 1440;
        if (weatherFor(1919, m, true).kind === 'fog') moor++;
        if (weatherFor(1919, m, false).kind === 'fog') low++;
    }
    assert.ok(moor > low * 3, `moor ${moor} vs low ${low}`);
    assert.ok(visibilityFor({ kind: 'fog', intensity: 1 }) < visibilityFor({ kind: 'fog', intensity: 0 }));
});

function stopping(grip) {
    const v = createVehicle(vehicleById('dart-3'));
    while (v.speed < 13) stepVehicle(v, { throttle: 1, brake: 0, steer: 0 }, 1 / 60, { grip });
    const x0 = v.x;
    while (v.speed > 0) stepVehicle(v, { throttle: 0, brake: 1, steer: 0 }, 1 / 60, { grip });
    return v.x - x0;
}

test('rain lowers grip, so stopping takes longer than in the dry', () => {
    const rain = gripFor({ kind: 'rain', intensity: 1 });
    assert.ok(rain < 1);
    assert.equal(gripFor({ kind: 'clear', intensity: 0 }), 1);
    assert.ok(stopping(rain) > stopping(1) * 1.1, `${stopping(rain)} vs ${stopping(1)}`);
});

test('night is between sunset and sunrise, and the nights are longer in winter', () => {
    const jan = sunTimes(15), jun = sunTimes(172);
    assert.ok(jan.sunrise > 7.5 && jan.sunrise < 8.6 && jan.sunset > 15.8 && jan.sunset < 17, `Jan ${jan.sunrise} - ${jan.sunset}`);
    assert.ok(jun.sunrise > 3.5 && jun.sunrise < 4.6 && jun.sunset > 19.8 && jun.sunset < 21, `Jun ${jun.sunrise} - ${jun.sunset}`);
    // 18:00 is dark in January but light in June; midnight and noon are the same all year
    assert.equal(isNight(minutesAt(1930, 0, 15, 18)), true);
    assert.equal(isNight(minutesAt(1930, 5, 21, 18)), false);
    for (const month of [0, 3, 6, 9]) {
        assert.equal(isNight(minutesAt(1930, month, 10, 0)), true);
        assert.equal(isNight(minutesAt(1930, month, 10, 12)), false);
    }
    assert.ok(daylight(minutesAt(1930, 0, 15, 23)).light < daylight(minutesAt(1930, 0, 15, 12)).light);
});
