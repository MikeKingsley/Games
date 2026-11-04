// Vehicle and trailer catalogue: fictional, era-styled makes. Masses in kg, lengths in metres, forces in N,
// prices in flat game pounds (no inflation). Drawing: `draw.parts` are boxes along the body from the rear
// (u0..u1), `w` wide, from height z0 to z0 + h; colours 'livery1'/'livery2' take the company livery.
// Gearing is derived from the governed top speed (finalDrive), so every vehicle tops out at topSpeedMph.

const RAD_TO_RPM = 60 / (2 * Math.PI);

function vehicle(v) {
    // the final drive that puts the governed max RPM in top gear at the top speed
    const top = v.topSpeedMph * 0.44704;
    v.finalDrive = ((v.engine.maxRpm / RAD_TO_RPM) * v.wheelRadius) / (top * v.gears[v.gears.length - 1]);
    v.reverseRatio ??= v.gears[0] * 1.1;
    v.shiftTime ??= 0.35;
    v.crr ??= 0.012;
    return v;
}

const cab = (u0, u1, w, h, z0 = 0.6, extra = {}) => ({ u0, u1, w, z0, h, color: 'livery2', roof: '#2a2a2a', glass: 'front', ...extra });
const chassis = (len, w, z0 = 0.4) => ({ u0: 0.05, u1: len - 0.05, w, z0, h: 0.22, color: '#1e1e1e' });
const bonnet = (u0, u1, w, h, z0 = 0.6) => ({ u0, u1, w, z0, h, color: '#262626', roof: '#3a3a3a', lamps: true });
const body = (u0, u1, w, h, z0, extra = {}) => ({ u0, u1, w, z0, h, color: 'livery1', roof: 'livery1', sign: true, ...extra });

export const VEHICLES = [
    vehicle({
        id: 'tamar-t-ton', name: 'Tamar T-Ton', make: 'Tamar Motor Co.', year: 1919, class: 'van', tags: ['van'],
        price: 260, payload: 1000, mass: 1100, axles: 2,
        length: 4.1, width: 1.75, height: 2.3, wheelbase: 2.55, rearOverhang: 0.65, maxSteer: 0.62, steerRate: 1.3,
        engine: { torque: 120, peakRpm: 900, idleRpm: 400, maxRpm: 1800 }, gears: [2.75, 1], wheelRadius: 0.38, shiftTime: 0.45,
        brakeForce: 4600, cda: 2.6, crr: 0.022, topSpeedMph: 25, fuelTank: 40, fuelUse: 14,
        voice: { base: 38, harmonics: 3, roughness: 0.55, wave: 'sawtooth' },
        draw: { wheel: { r: 0.38, w: 0.22 }, parts: [chassis(4.1, 1.5, 0.35), body(0, 2.55, 1.75, 1.62, 0.53), cab(2.55, 3.3, 1.65, 1.32, 0.53), bonnet(3.3, 4.1, 0.95, 0.55, 0.53)] },
    }),
    vehicle({
        id: 'exe-two-tonner', name: 'Exe Two-Tonner', make: 'Exe Motor Works', year: 1924, class: 'rigid', tags: ['rigid', 'flatbed', 'livestock'],
        price: 680, payload: 2000, mass: 2600, axles: 2,
        length: 5.8, width: 2.0, height: 2.6, wheelbase: 3.6, rearOverhang: 1.25, maxSteer: 0.58, steerRate: 1.1,
        engine: { torque: 260, peakRpm: 1000, idleRpm: 400, maxRpm: 1600 }, gears: [5.5, 3.2, 1.8, 1], wheelRadius: 0.48,
        brakeForce: 9000, cda: 4.5, crr: 0.02, topSpeedMph: 22, fuelTank: 70, fuelUse: 24,
        voice: { base: 32, harmonics: 3, roughness: 0.65, wave: 'sawtooth' },
        draw: { wheel: { r: 0.48, w: 0.25 }, parts: [chassis(5.8, 1.7), body(0, 3.7, 2.0, 0.9, 0.62, { color: '#7a5a3a', roof: '#8d6a46' }), cab(3.7, 4.6, 1.9, 1.5, 0.62), bonnet(4.6, 5.8, 1.1, 0.7, 0.62)] },
    }),
    vehicle({
        id: 'dart-3', name: 'Dart 3-Ton Box', make: 'Dart Commercial Vehicles', year: 1931, class: 'rigid', tags: ['rigid', 'box'],
        price: 950, payload: 3000, mass: 3500, axles: 2,
        length: 6.6, width: 2.15, height: 3.1, wheelbase: 4.0, rearOverhang: 1.5, maxSteer: 0.6, steerRate: 1.2,
        engine: { torque: 340, peakRpm: 1300, idleRpm: 450, maxRpm: 2400 }, gears: [6.2, 3.4, 1.9, 1], wheelRadius: 0.46,
        brakeForce: 14000, cda: 5.5, topSpeedMph: 30, fuelTank: 90, fuelUse: 26,
        voice: { base: 36, harmonics: 3, roughness: 0.5, wave: 'sawtooth' },
        draw: { wheel: { r: 0.46, w: 0.26 }, parts: [chassis(6.6, 1.8), body(0, 4.4, 2.15, 2.2, 0.75), cab(4.4, 5.4, 2.0, 1.55), bonnet(5.4, 6.6, 1.2, 0.75)] },
    }),
    vehicle({
        id: 'moorland-tipper', name: 'Moorland Tipper', make: 'Moorland Engineering', year: 1934, class: 'rigid', tags: ['rigid', 'tipper'],
        price: 1150, payload: 4000, mass: 3800, axles: 2,
        length: 6.2, width: 2.2, height: 2.7, wheelbase: 3.8, rearOverhang: 1.2, maxSteer: 0.58, steerRate: 1.1,
        engine: { torque: 400, peakRpm: 1200, idleRpm: 450, maxRpm: 2200 }, gears: [6.5, 3.6, 2.0, 1], wheelRadius: 0.48,
        brakeForce: 15000, cda: 5.2, topSpeedMph: 28, fuelTank: 90, fuelUse: 28,
        voice: { base: 34, harmonics: 4, roughness: 0.6, wave: 'sawtooth' },
        draw: { wheel: { r: 0.48, w: 0.28 }, parts: [chassis(6.2, 1.8), body(0, 3.9, 2.2, 1.1, 0.8, { color: '#6f6a60', roof: '#5a564e', sign: false }), cab(3.9, 4.9, 2.05, 1.55), bonnet(4.9, 6.2, 1.2, 0.75)] },
    }),
    vehicle({
        id: 'tamar-horse', name: 'Tamar Mechanical Horse', make: 'Tamar Motor Co.', year: 1937, class: 'tractor', tags: ['tractor-unit'],
        price: 900, payload: 0, trailerMax: 6000, mass: 2100, axles: 2, threeWheeler: true,
        length: 3.6, width: 1.9, height: 2.4, wheelbase: 2.4, rearOverhang: 0.55, maxSteer: 0.85, steerRate: 1.6,
        fifthWheel: -0.05, // metres forward of the rear axle
        engine: { torque: 220, peakRpm: 1400, idleRpm: 450, maxRpm: 2600 }, gears: [6, 3.3, 1.8, 1], wheelRadius: 0.42,
        brakeForce: 12000, cda: 3.2, topSpeedMph: 24, fuelTank: 60, fuelUse: 20,
        voice: { base: 40, harmonics: 3, roughness: 0.5, wave: 'sawtooth' },
        draw: { wheel: { r: 0.42, w: 0.24 }, parts: [chassis(3.6, 1.6), { u0: 0, u1: 1.1, w: 1.7, z0: 0.6, h: 0.25, color: '#333', roof: '#555' }, cab(1.3, 3.6, 1.8, 1.7, 0.55, { color: 'livery1', roof: 'livery2' })] },
    }),
    vehicle({
        id: 'exe-milk-tanker', name: 'Exe Milk Tanker', make: 'Exe Motor Works', year: 1948, class: 'rigid', tags: ['rigid', 'tanker', 'milk'],
        price: 1600, payload: 5000, mass: 4500, axles: 2,
        length: 7.2, width: 2.3, height: 2.8, wheelbase: 4.3, rearOverhang: 1.5, maxSteer: 0.6, steerRate: 1.2,
        engine: { torque: 480, peakRpm: 1400, idleRpm: 500, maxRpm: 2400 }, gears: [6.8, 3.8, 2.1, 1.35, 1], wheelRadius: 0.5,
        brakeForce: 19000, cda: 5.6, topSpeedMph: 32, fuelTank: 110, fuelUse: 30, airBrakes: true,
        voice: { base: 30, harmonics: 4, roughness: 0.45, wave: 'sawtooth' },
        draw: { wheel: { r: 0.5, w: 0.28 }, parts: [chassis(7.2, 1.9), { u0: 0.1, u1: 5.0, w: 2.1, z0: 0.95, h: 1.6, color: '#d8dde0', roof: '#e8ecef', sign: true }, cab(5.1, 6.1, 2.2, 1.6, 0.7), bonnet(6.1, 7.2, 1.3, 0.8, 0.7)] },
    }),
    vehicle({
        id: 'moorland-8', name: 'Moorland Eight-Ton Six-Wheeler', make: 'Moorland Engineering', year: 1953, class: 'rigid', tags: ['rigid', 'flatbed', 'box'],
        price: 2100, payload: 8000, mass: 6000, axles: 3, extraAxles: [2.85],
        length: 8.4, width: 2.4, height: 3.3, wheelbase: 4.6, rearOverhang: 1.7, maxSteer: 0.58, steerRate: 1.1,
        engine: { torque: 620, peakRpm: 1300, idleRpm: 500, maxRpm: 2200 }, gears: [7.2, 4.1, 2.4, 1.5, 1], wheelRadius: 0.52,
        brakeForce: 30000, cda: 6.5, topSpeedMph: 34, fuelTank: 160, fuelUse: 34, airBrakes: true,
        voice: { base: 28, harmonics: 4, roughness: 0.5, wave: 'sawtooth' },
        draw: { wheel: { r: 0.52, w: 0.3 }, parts: [chassis(8.4, 2.0), body(0, 6.0, 2.4, 2.3, 0.95), cab(6.0, 7.2, 2.3, 1.65, 0.75), bonnet(7.2, 8.4, 1.4, 0.8, 0.75)] },
    }),
    vehicle({
        id: 'kestrel', name: 'Kestrel Artic Tractor', make: 'Kestrel Motors', year: 1956, class: 'tractor', tags: ['tractor-unit'],
        price: 2600, payload: 0, trailerMax: 15000, mass: 4800, axles: 2,
        length: 5.4, width: 2.4, height: 2.9, wheelbase: 3.2, rearOverhang: 0.9, maxSteer: 0.62, steerRate: 1.2, fifthWheel: 0.25,
        engine: { torque: 760, peakRpm: 1300, idleRpm: 500, maxRpm: 2200 }, gears: [7.5, 4.4, 2.6, 1.6, 1], wheelRadius: 0.52,
        brakeForce: 32000, cda: 6, topSpeedMph: 38, fuelTank: 200, fuelUse: 36, airBrakes: true,
        voice: { base: 27, harmonics: 4, roughness: 0.45, wave: 'sawtooth' },
        draw: { wheel: { r: 0.52, w: 0.3 }, parts: [chassis(5.4, 2.0), { u0: 0, u1: 2.6, w: 2.0, z0: 0.95, h: 0.2, color: '#333', roof: '#444' }, cab(2.7, 4.0, 2.35, 1.8, 0.8, { color: 'livery1', roof: 'livery2' }), bonnet(4.0, 5.4, 1.5, 0.95, 0.8)] },
    }),
    vehicle({
        id: 'dart-eight', name: 'Dart Eight-Wheel Tipper', make: 'Dart Commercial Vehicles', year: 1964, class: 'rigid', tags: ['rigid', 'tipper'],
        price: 4200, payload: 14000, mass: 9000, axles: 4, extraAxles: [2.9, 5.8],
        length: 9.2, width: 2.5, height: 3.2, wheelbase: 5.6, rearOverhang: 1.5, maxSteer: 0.55, steerRate: 1.0,
        engine: { torque: 900, peakRpm: 1400, idleRpm: 550, maxRpm: 2300 }, gears: [8, 5, 3.1, 1.9, 1.3, 1], wheelRadius: 0.52,
        brakeForce: 52000, cda: 6.8, topSpeedMph: 40, fuelTank: 250, fuelUse: 40, airBrakes: true,
        voice: { base: 26, harmonics: 5, roughness: 0.45, wave: 'sawtooth' },
        draw: { wheel: { r: 0.52, w: 0.32 }, parts: [chassis(9.2, 2.1), body(0, 6.7, 2.5, 1.4, 1.0, { color: '#d9d6cc', roof: '#eceae2' }), cab(6.8, 9.2, 2.45, 1.9, 0.85, { color: 'livery1', roof: 'livery2' })] },
    }),
    vehicle({
        id: 'tamar-t32', name: 'Tamar T32 Tilt-Cab', make: 'Tamar Motor Co.', year: 1972, class: 'tractor', tags: ['tractor-unit'],
        price: 6800, payload: 0, trailerMax: 25000, mass: 6500, axles: 2,
        length: 5.6, width: 2.5, height: 3.2, wheelbase: 3.4, rearOverhang: 0.9, maxSteer: 0.6, steerRate: 1.3, fifthWheel: 0.3,
        engine: { torque: 1150, peakRpm: 1400, idleRpm: 550, maxRpm: 2300 }, gears: [9, 6.2, 4.3, 3, 2.1, 1.45, 1], wheelRadius: 0.52,
        brakeForce: 42000, cda: 6.2, topSpeedMph: 50, fuelTank: 300, fuelUse: 38, airBrakes: true,
        voice: { base: 25, harmonics: 5, roughness: 0.35, wave: 'sawtooth' },
        draw: { wheel: { r: 0.52, w: 0.32 }, parts: [chassis(5.6, 2.1), { u0: 0, u1: 3.0, w: 2.1, z0: 1.0, h: 0.2, color: '#333', roof: '#444' }, cab(3.6, 5.6, 2.5, 2.2, 0.9, { color: 'livery1', roof: 'livery2', lamps: true })] },
    }),
    vehicle({
        id: 'kestrel-k38', name: 'Kestrel K38', make: 'Kestrel Motors', year: 1984, class: 'tractor', tags: ['tractor-unit'],
        price: 9500, payload: 0, trailerMax: 30000, mass: 7200, axles: 2,
        length: 5.9, width: 2.5, height: 3.4, wheelbase: 3.6, rearOverhang: 0.95, maxSteer: 0.6, steerRate: 1.4, fifthWheel: 0.35,
        engine: { torque: 1500, peakRpm: 1300, idleRpm: 550, maxRpm: 2100 }, gears: [10, 7, 5, 3.6, 2.6, 1.9, 1.4, 1], wheelRadius: 0.52,
        brakeForce: 50000, cda: 5.8, topSpeedMph: 56, fuelTank: 400, fuelUse: 36, airBrakes: true, beeper: true,
        voice: { base: 24, harmonics: 5, roughness: 0.3, wave: 'sawtooth' },
        draw: { wheel: { r: 0.52, w: 0.32 }, parts: [chassis(5.9, 2.1), { u0: 0, u1: 3.1, w: 2.1, z0: 1.0, h: 0.2, color: '#333', roof: '#444' }, cab(3.7, 5.9, 2.5, 2.45, 0.9, { color: 'livery1', roof: 'livery2', lamps: true })] },
    }),
    vehicle({
        id: 'exe-75', name: 'Exe 7.5-Tonne Box', make: 'Exe Motor Works', year: 1995, class: 'rigid', tags: ['rigid', 'box', 'van'],
        price: 5500, payload: 3500, mass: 4000, axles: 2,
        length: 7.8, width: 2.45, height: 3.5, wheelbase: 4.4, rearOverhang: 1.9, maxSteer: 0.65, steerRate: 1.6,
        engine: { torque: 650, peakRpm: 1600, idleRpm: 650, maxRpm: 2700 }, gears: [6.5, 3.8, 2.4, 1.5, 1], wheelRadius: 0.44,
        brakeForce: 30000, cda: 6.4, topSpeedMph: 60, fuelTank: 180, fuelUse: 22, airBrakes: true, beeper: true,
        voice: { base: 30, harmonics: 4, roughness: 0.25, wave: 'sawtooth' },
        draw: { wheel: { r: 0.44, w: 0.28 }, parts: [chassis(7.8, 2.0), body(0, 5.6, 2.45, 2.7, 0.8), cab(5.6, 7.8, 2.3, 2.1, 0.7, { lamps: true })] },
    }),
    vehicle({
        id: 'moorland-m44', name: 'Moorland M44 6x2', make: 'Moorland Engineering', year: 2003, class: 'tractor', tags: ['tractor-unit'],
        price: 14000, payload: 0, trailerMax: 35500, mass: 8500, axles: 3, extraAxles: [2.3],
        length: 6.3, width: 2.55, height: 3.8, wheelbase: 3.7, rearOverhang: 1.0, maxSteer: 0.6, steerRate: 1.5, fifthWheel: 0.1,
        engine: { torque: 2100, peakRpm: 1200, idleRpm: 550, maxRpm: 2000 }, gears: [12, 9, 7, 5.3, 4, 3, 2.3, 1.75, 1.35, 1.1, 1], wheelRadius: 0.52,
        brakeForce: 62000, cda: 5.4, topSpeedMph: 56, fuelTank: 500, fuelUse: 33, airBrakes: true, beeper: true,
        voice: { base: 23, harmonics: 5, roughness: 0.25, wave: 'sawtooth' },
        draw: { wheel: { r: 0.52, w: 0.34 }, parts: [chassis(6.3, 2.1), { u0: 0, u1: 3.4, w: 2.1, z0: 1.0, h: 0.2, color: '#333', roof: '#444' }, cab(3.9, 6.3, 2.55, 2.8, 0.9, { color: 'livery1', roof: 'livery2', lamps: true })] },
    }),
    vehicle({
        id: 'dart-luton', name: 'Dart Luton', make: 'Dart Commercial Vehicles', year: 2012, class: 'van', tags: ['van', 'box'],
        price: 4800, payload: 1200, mass: 2400, axles: 2,
        length: 6.6, width: 2.2, height: 3.3, wheelbase: 3.7, rearOverhang: 1.8, maxSteer: 0.66, steerRate: 1.8,
        engine: { torque: 460, peakRpm: 1800, idleRpm: 750, maxRpm: 3600 }, gears: [5, 2.8, 1.8, 1.3, 1, 0.8], wheelRadius: 0.36,
        brakeForce: 18000, cda: 5.2, topSpeedMph: 70, fuelTank: 80, fuelUse: 12, beeper: true,
        voice: { base: 42, harmonics: 3, roughness: 0.2, wave: 'sawtooth' },
        draw: { wheel: { r: 0.36, w: 0.24 }, parts: [chassis(6.6, 1.9), body(0, 4.6, 2.2, 2.6, 0.55), cab(4.6, 6.6, 2.0, 1.9, 0.5, { lamps: true })] },
    }),
    vehicle({
        id: 'tamar-e-van', name: 'Tamar e-Van', make: 'Tamar Motor Co.', year: 2022, class: 'van', tags: ['van', 'electric'],
        price: 6500, payload: 1000, mass: 2200, axles: 2, electric: true,
        length: 5.4, width: 2.0, height: 2.5, wheelbase: 3.3, rearOverhang: 1.0, maxSteer: 0.68, steerRate: 2,
        engine: { torque: 300, peakRpm: 1000, idleRpm: 300, maxRpm: 9000 }, gears: [1], wheelRadius: 0.36,
        brakeForce: 16000, cda: 4.2, topSpeedMph: 62, fuelTank: 75, fuelUse: 22, // battery kWh, kWh per 100 km
        voice: { base: 90, harmonics: 1, roughness: 0.02, wave: 'sine' },
        draw: { wheel: { r: 0.36, w: 0.22 }, parts: [chassis(5.4, 1.8), body(0, 3.6, 2.0, 1.9, 0.5), cab(3.6, 5.4, 1.95, 1.7, 0.5, { lamps: true })] },
    }),
];

/** Trailers for tractor units: kingpin at `kingpin` metres behind the trailer's front, axle `axle` behind the kingpin. */
const trailer = t => ({ rearOverhang: t.length - t.kingpin - t.axle, ...t });
export const TRAILERS = [
    trailer({ id: 'flat-light', name: 'Light flatbed trailer', year: 1937, price: 180, capacity: 6000, mass: 1200, length: 6.5, width: 2.1, height: 1.2, kingpin: 0.6, axle: 4.6, tags: ['flatbed'], body: 'flat' }),
    trailer({ id: 'box-light', name: 'Light box trailer', year: 1937, price: 240, capacity: 5000, mass: 1500, length: 6.5, width: 2.1, height: 2.6, kingpin: 0.6, axle: 4.6, tags: ['box'], body: 'box' }),
    trailer({ id: 'flat-12', name: 'Flatbed trailer', year: 1956, price: 700, capacity: 20000, mass: 4500, length: 11, width: 2.45, height: 1.4, kingpin: 1.2, axle: 7.4, tags: ['flatbed'], body: 'flat', axles: 2 }),
    trailer({ id: 'box-12', name: 'Box van trailer', year: 1956, price: 900, capacity: 18000, mass: 5500, length: 11, width: 2.5, height: 3.6, kingpin: 1.2, axle: 7.4, tags: ['box'], body: 'box', axles: 2 }),
    trailer({ id: 'tanker', name: 'Tanker trailer', year: 1956, price: 1300, capacity: 20000, mass: 5000, length: 10.5, width: 2.45, height: 3, kingpin: 1.2, axle: 7.1, tags: ['tanker', 'fuel', 'milk'], body: 'tank', axles: 2 }),
    trailer({ id: 'livestock', name: 'Livestock trailer', year: 1956, price: 1000, capacity: 12000, mass: 4800, length: 11, width: 2.5, height: 3.4, kingpin: 1.2, axle: 7.4, tags: ['livestock'], body: 'slats', axles: 2 }),
    trailer({ id: 'lowloader', name: 'Low-loader', year: 1956, price: 1500, capacity: 30000, mass: 7000, length: 12, width: 2.5, height: 1.0, kingpin: 1.4, axle: 8.6, tags: ['lowloader', 'flatbed'], body: 'low', axles: 3 }),
    trailer({ id: 'tipper-t', name: 'Tipper trailer', year: 1960, price: 1200, capacity: 24000, mass: 6000, length: 10, width: 2.5, height: 2.6, kingpin: 1.2, axle: 6.6, tags: ['tipper'], body: 'tipper', axles: 2 }),
    trailer({ id: 'reefer', name: 'Refrigerated trailer', year: 1960, price: 1800, capacity: 20000, mass: 7000, length: 12, width: 2.5, height: 3.8, kingpin: 1.3, axle: 8.2, tags: ['reefer', 'box'], body: 'reefer', axles: 3 }),
    trailer({ id: 'curtain', name: 'Curtainsider', year: 1970, price: 1500, capacity: 26000, mass: 6500, length: 13.6, width: 2.55, height: 4, kingpin: 1.6, axle: 9.4, tags: ['box', 'flatbed', 'curtain'], body: 'curtain', axles: 3 }),
];

export const vehicleById = id => VEHICLES.find(v => v.id === id);
export const trailerById = id => TRAILERS.find(t => t.id === id);
/** Vehicles on sale in a year (a model stays on sale for 30 years). */
export const vehiclesOnSale = year => VEHICLES.filter(v => v.year <= year && year < v.year + 30);
export const trailersOnSale = year => TRAILERS.filter(t => t.year <= year);
/** The catalogue years when something new arrives (for the "new on sale" news). */
export const newModelsIn = year => [...VEHICLES.filter(v => v.year === year), ...TRAILERS.filter(t => t.year === year)];
