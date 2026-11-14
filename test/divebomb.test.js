// DIVEBOMB: L1/L2 robot, slapdown ground intake (front), indexer, end-effector elevator (back).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, TICK } from '../shared/sim.js';
import { Bot } from '../shared/bot.js';
import * as F from '../shared/field.js';

const solo = (preload = 0) => {
  const m = new Match({ slots: [{ id: 'a', alliance: 'red', station: 1, robot: 'divebomb', mods: { maxLevel: 3, mech: 'passthrough' } }], preload });
  while (m.phase === 'countdown') m.step();
  return [m, m.robots[0]];
};
const run = (m, s) => {
  for (let i = 0; i < 60 * s; i++) m.step();
};

test('Divebomb always plays its real build: ground intake only, L1/L2, one piece per lift', () => {
  const [m, r] = solo();
  assert.deepEqual(r.cfg.mods, { ground: true, depot: true, ramp: true, maxLevel: 2, mech: 'opposite' });
  m.setInput('a', { sp: 'l3' });
  run(m, 2);
  assert.notEqual(r.elevTarget, 'l3', 'no LEVEL 3');
  assert.equal(r.arm, r.cfg.slap.stow, 'intake starts raised');
});

test('slapdown intake drops to the carpet, grabs ONE piece, lifts it to the indexer, then goes again', () => {
  const [m, r] = solo();
  const put = (d) => m.addPiece('carrot', r.x + Math.cos(r.th) * (r.cfg.length / 2 + d), r.y + Math.sin(r.th) * (r.cfg.length / 2 + d), r.th + Math.PI / 2, 'floor');
  const c1 = put(0.0);
  m.setInput('a', { intake: true });
  run(m, 0.05);
  assert.equal(c1.st, 'floor', 'nothing is grabbed until the intake is down');
  assert.ok(r.arm > r.cfg.slap.ground + 5, 'still dropping');
  run(m, 0.4);
  assert.equal(r.held.length, 1, 'one piece');
  assert.equal(r.arm > r.cfg.slap.ground + 5, true, 'lifting it to the indexer');
  const c2 = put(0.05); // the next piece arrives while the first is being lifted
  run(m, 0.1);
  assert.equal(r.held.length, 1, 'no second piece during the lift');
  assert.equal(c2.st, 'floor');
  run(m, 1.5);
  assert.equal(r.held.length, 2, 'the next one after it comes back down');
  m.setInput('a', {});
  run(m, 1.2);
  assert.equal(r.arm, r.cfg.slap.stow, 'intake raises when not in use');
});

test('the elevator returns to the bottom to take each carrot from the indexer', () => {
  const [m, r] = solo(2); // preload 2
  run(m, 1);
  assert.equal(r.carriage, 1, 'end effector loaded from the indexer');
  assert.equal(r.held.length, 2);
  r.x = F.pantrySlotX(2, 1);
  r.y = F.PANTRY.yFront - r.cfg.length / 2;
  r.th = -Math.PI / 2; // scores with its back to the pantry
  m.setInput('a', { sp: 'l2' });
  run(m, 2);
  m.setInput('a', { score: true });
  run(m, 0.5);
  m.setInput('a', {});
  assert.equal(m.score.red.pantry[1].carrot, 1, 'scored out the back on LEVEL 2');
  assert.equal(r.carriage, 0, 'end effector is empty: the elevator must go back down');
  run(m, 2);
  assert.equal(r.carriage, 1, 'it reloaded the next carrot');
});

test('bots can drive Divebomb', () => {
  const slots = [];
  for (const alliance of ['red', 'blue']) for (const station of [1, 2, 3]) slots.push({ id: `${alliance}${station}`, alliance, station, robot: 'divebomb', bot: true });
  const m = new Match({ slots });
  m.bots = slots.map((s) => new Bot(s.id));
  let g = 0;
  while (m.phase !== 'done' && g++ < 60 * 200) {
    for (const b of m.bots) b.update(m, TICK);
    m.step(TICK);
  }
  for (const a of ['red', 'blue']) {
    console.log(a, m.score[a].totals, 'oven', m.score[a].ovenCarrot);
    assert.ok(m.score[a].totals.total >= 20, `${a} scored ${m.score[a].totals.total}`);
  }
});

test('oven: carrots come out of the end effector (back), one per lift', () => {
  const [m, r] = solo(2);
  run(m, 1);
  r.x = (F.OVEN.mouthX0 + F.OVEN.mouthX1) / 2;
  r.y = F.OVEN.y1 + r.cfg.length / 2 + 0.01;
  r.th = -Math.PI / 2; // front at the mouth: wrong end
  m.setInput('a', { score: true });
  run(m, 1);
  assert.equal(r.held.length, 2, 'nothing goes in from the intake side');
  r.th = Math.PI / 2; // back (end effector) at the mouth
  run(m, 3);
  assert.equal(r.held.length, 0, 'both carrots fed in, reloading the end effector in between');
  assert.equal(m.score.red.ovenCarrot, 2);
});

test('depot: with the intake stowed, carrots drop into the beltdexer', () => {
  const [m, r] = solo(0);
  const c = F.depotChutes('red')[0];
  r.x = c.x + c.dx * (r.cfg.length / 2 + 0.05);
  r.y = c.y + c.dy * (r.cfg.length / 2 + 0.05);
  r.th = Math.atan2(-c.dy, -c.dx); // front (indexer side) toward the chute
  m.setInput('a', { intake: true }); // intake down: no depot feed
  run(m, 0.5);
  m.inv.red.depotCarrots = 5;
  run(m, 2);
  // not caught from the chute while deployed (one may roll out onto the carpet and get picked up)
  assert.ok(r.held.length <= 1, `held ${r.held.length}`);
  m.setInput('a', {});
  run(m, 5);
  assert.equal(r.held.length, 3, 'indexer fills (2) + end effector (1)');
});

test('catches and holds 3 carrot cakes from the ramp', () => {
  const [m, r] = solo(0);
  m.inv.red.rampCakes = 3;
  r.x = F.OVEN.x0 - r.cfg.length / 2 - 0.05;
  r.y = F.OVEN.yc;
  r.th = 0;
  run(m, 6);
  assert.equal(r.held.length, 3);
  assert.equal(m.inv.red.rampCakes, 0);
  assert.ok(r.held.every((id) => m.pieces.find((p) => p.id === id).type === 'cake'));
});
