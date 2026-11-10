import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLevel } from '../../Games.Client/wwwroot/games/inglenook/levels.js';

// Guard for the visual realism pass (plan 0014): the puzzles must stay identical.
const EXPECTED = {"1":{"template":"classic","placement":{"A":["w1"],"B":[],"C":["w4","w2","w3"]},"goal":["w4","w2","w3"],"par":2},"5":{"template":"classic","placement":{"A":["w5","w4","w1","w3"],"B":["w2"],"C":[]},"goal":["w5","w4","w3"],"par":3},"10":{"template":"classic","placement":{"A":["w4","w7"],"B":["w2","w6","w1"],"C":["w3","w5","w8"]},"goal":["w4","w7","w1","w8","w5"],"par":6},"20":{"template":"classic","placement":{"A":["w6","w5","w7","w3","w1"],"B":["w8","w4","w2"],"C":[]},"goal":["w6","w5","w7","w1","w2"],"par":5},"25":{"template":"ladder4","placement":{"S1":["w3","w6","w2","w8","w4"],"S2":["w9","w1","w7"],"S3":[],"S4":["w5"]},"goal":["w3","w9","w1","w4","w8"],"par":11},"26":{"template":"classic-long","placement":{"A":["w9","w5","w10","w7"],"B":["w4","w2","w1","w3"],"C":["w6","w8"]},"goal":["w9","w5","w7","w10","w8","w6"],"par":8},"61":{"template":"ladder5","placement":{"S1":["w6","w2"],"S2":["w1","w8","w10"],"S3":[],"S4":["w3","w5","w7"],"S5":["w11","w9","w4"]},"goal":["w6","w2","w5","w10","w7","w3"],"par":15},"100":{"template":"ladder4","placement":{"S1":["w3","w5","w8","w2","w10"],"S2":["w11","w9","w1"],"S3":["w12"],"S4":["w4","w6","w7"]},"goal":["w3","w5","w8","w7","w10"],"par":6}};

for (const [n, want] of Object.entries(EXPECTED)) {
    test(`level ${n} puzzle is unchanged (template, placement, goal, par)`, () => {
        const l = generateLevel(Number(n));
        assert.deepEqual({ template: l.template, placement: l.placement, goal: l.goal, par: l.par }, want);
    });
}
