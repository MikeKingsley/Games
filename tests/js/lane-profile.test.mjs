import test from 'node:test';
import assert from 'node:assert/strict';
import { laneProfile, pavementSides } from '../../Games.Client/wwwroot/games/delivery-driver/world/lane-profile.js';

const Y = 1990;

test('single-track lane: one shared lane, passing places, no centre line', () => {
  const p = laneProfile({ cls: 'lane' }, Y);
  assert.equal(p.singleTrack, true);
  assert.equal(p.passingPlaces, true);
  assert.equal(p.lanesFwd, 1);
  assert.equal(p.lanesBack, 0);
  assert.equal(p.centreLine, false);
  assert.equal(p.edgeLines, true);
});

test('one lane one-way: no back lane, no centre line', () => {
  const p = laneProfile({ cls: 'street', oneway: true }, Y);
  assert.equal(p.lanesFwd, 1);
  assert.equal(p.lanesBack, 0);
  assert.equal(p.singleTrack, false);
  assert.equal(p.centreLine, false);
});

test('two lanes two-way: one each way with a centre line', () => {
  const p = laneProfile({ cls: 'B' }, Y);
  assert.equal(p.lanesFwd, 1);
  assert.equal(p.lanesBack, 1);
  assert.equal(p.centreLine, true);
  assert.equal(p.singleTrack, false);
});

test('multi-lane one-way: dual and motorway', () => {
  const d = laneProfile({ cls: 'dual', oneway: true }, Y);
  assert.ok(d.lanesFwd >= 2);
  assert.equal(d.lanesBack, 0);
  assert.equal(d.centreLine, false);
  const m = laneProfile({ cls: 'M', oneway: true }, Y);
  assert.ok(m.lanesFwd >= 2);
  assert.equal(m.lanesBack, 0);
  assert.ok(m.width >= 2 * 3.4);
});

test('asymmetric lanes: dual-flagged A-road has 2 forward, 1 back', () => {
  const p = laneProfile({ cls: 'A', dual: true }, Y);
  assert.equal(p.lanesFwd, 2);
  assert.equal(p.lanesBack, 1);
  assert.notEqual(p.lanesFwd, p.lanesBack);
  assert.equal(p.centreLine, false);
  assert.ok(p.width >= 3 * 3.4);
});

test('upgrades change the class by year', () => {
  const e = { cls: 'A', upgrades: [{ year: 1970, class: 'dual' }] };
  assert.equal(laneProfile(e, 1960).lanesFwd, 1);
  assert.equal(laneProfile(e, 1980).lanesFwd, 2);
  assert.equal(laneProfile(e, 1980).lanesBack, 2);
});

test('pavement defaults from class and town', () => {
  assert.deepEqual(laneProfile({ cls: 'street', town: true }, Y).pavements, { left: true, right: true });
  assert.deepEqual(laneProfile({ cls: 'A' }, Y).pavements, { left: true, right: true });
  assert.deepEqual(laneProfile({ cls: 'B' }, Y).pavements, { left: true, right: true });
  assert.deepEqual(laneProfile({ cls: 'lane' }, Y).pavements, { left: false, right: false });
  assert.deepEqual(laneProfile({ cls: 'access' }, Y).pavements, { left: false, right: false });
});

test('overrides win over derived values', () => {
  const p = laneProfile({ cls: 'lane' }, Y, {
    singleTrack: false, passingPlaces: false, lanesFwd: 1, lanesBack: 1, centreLine: true, pavements: 'left', width: 9,
  });
  assert.equal(p.singleTrack, false);
  assert.equal(p.passingPlaces, false);
  assert.equal(p.lanesBack, 1);
  assert.equal(p.centreLine, true);
  assert.deepEqual(p.pavements, { left: true, right: false });
  assert.equal(p.width, 9);
  assert.deepEqual(pavementSides('right'), { left: false, right: true });
  assert.deepEqual(pavementSides('none'), { left: false, right: false });
});
