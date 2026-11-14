// TEAM 526: speedy swerve, slapdown intake -> beltdexer (3), scores back out through the intake (L1 / oven).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, TICK } from '../shared/sim.js';
import { Bot } from '../shared/bot.js';
import * as F from '../shared/field.js';

const solo = (preload = 0, extra = {}) => {
  const m = new Match({ slots: [{ id: 'a', alliance: 'red', station: 1, robot: 'r526', ...extra }], preload });
  while (m.phase === 'countdown') m.step();
  return [m, m.robots[0]];
};
const run = (m, s) => {
  for (let i = 0; i < 60 * s; i++) m.step();
};

test('team 526: real build, and the team number locks any robot to it', () => {
  const [, r] = solo(0, { mods: { maxLevel: 3, mech: 'passthrough' } });
  assert.deepEqual(r.cfg.mods, { ground: true, depot: true, ramp: true, maxLevel: 1, mech: 'gtake' });
  assert.equal(r.arm, r.cfg.slap.stow, 'intake starts upright');
  const m2 = new Match({ slots: [{ id: 'a', alliance: 'red', station: 1, robot: 'kitbot', team: '526', mods: { maxLevel: 3 } }] });
  assert.equal(m2.robots[0].cfg.mods.mech, 'gtake');
  assert.equal(m2.robots[0].cfg.mods.maxLevel, 1);
});

test('slapdown intake fills the beltdexer with 3 pieces', () => {
  const [m, r] = solo();
  m.setInput('a', { intake: true });
  run(m, 0.5);
  assert.ok(r.arm < r.cfg.slap.ground + 3, 'intake down to the carpet');
  for (let k = 0; k < 3; k++) {
    m.addPiece('carrot', r.x + Math.cos(r.th) * (r.cfg.length / 2 + 0.08), r.y + Math.sin(r.th) * (r.cfg.length / 2 + 0.08), r.th + Math.PI / 2, 'floor');
    run(m, 0.8);
  }
  assert.equal(r.held.length, 3);
  assert.equal(r.arm, r.cfg.slap.stow, 'intake goes back up once the beltdexer is full');
  m.setInput('a', { sp: 'l2' });
  run(m, 0.5);
  assert.notEqual(r.elevTarget, 'l2', 'LEVEL 1 only');
});

test('scores LEVEL 1 and the oven back out through the intake', () => {
  const [m, r] = solo(2);
  r.x = F.pantrySlotX(2, 1);
  r.y = F.PANTRY.yFront - r.cfg.length / 2;
  r.th = Math.PI / 2; // intake toward the shelves
  m.setInput('a', { sp: 'l1' });
  run(m, 1);
  assert.ok(Math.abs(r.arm - r.cfg.slap.l1) < 2, 'intake tipped to the shelf');
  m.setInput('a', { score: true });
  run(m, 0.3);
  m.setInput('a', {});
  assert.equal(m.score.red.pantry[0].carrot, 1, 'L1 carrot');
  r.x = (F.OVEN.mouthX0 + F.OVEN.mouthX1) / 2;
  r.y = F.OVEN.y1 + r.cfg.length / 2 + 0.01;
  r.th = -Math.PI / 2;
  m.setInput('a', { sp: 'oven' });
  run(m, 1);
  m.setInput('a', { score: true });
  run(m, 0.5);
  assert.equal(m.score.red.ovenCarrot, 1, 'oven carrot');
});

test('bots can drive the 526 robot', () => {
  const slots = [];
  for (const alliance of ['red', 'blue']) for (const station of [1, 2, 3]) slots.push({ id: `${alliance}${station}`, alliance, station, robot: 'r526', bot: true });
  const m = new Match({ slots });
  m.bots = slots.map((s) => new Bot(s.id));
  let g = 0;
  while (m.phase !== 'done' && g++ < 60 * 200) {
    for (const b of m.bots) b.update(m, TICK);
    m.step(TICK);
  }
  for (const a of ['red', 'blue']) {
    console.log(a, m.score[a].totals);
    assert.ok(m.score[a].totals.total >= 20, `${a} scored ${m.score[a].totals.total}`);
  }
});

test('arm holds one carrot; when empty it drops to the hand-off pose, reloads from the beltdexer, then goes back up', () => {
  const [m, r] = solo(2);
  const S = r.cfg.slap;
  r.x = F.pantrySlotX(1, 1);
  r.y = F.PANTRY.yFront - r.cfg.length / 2;
  r.th = Math.PI / 2;
  m.setInput('a', { sp: 'l1' });
  run(m, 1.5);
  assert.equal(r.carriage, 1, 'carrot in the arm');
  assert.ok(Math.abs(r.arm - S.l1) < 2, 'L1 pose: 15 deg off vertical');
  m.setInput('a', { sp: 'l1', score: true });
  m.step();
  m.setInput('a', { sp: 'l1' });
  run(m, 0.25);
  assert.equal(r.carriage, 0, 'arm empty after the shot');
  assert.ok(r.arm > S.l1 + 10, 'heading back to the hand-off pose');
  r.x += 0.5; // next gap on the shelf
  run(m, 1.5);
  assert.equal(r.carriage, 1, 'reloaded from the beltdexer');
  assert.ok(Math.abs(r.arm - S.l1) < 2, 'and back up at L1');
  m.setInput('a', { sp: 'l1', score: true });
  run(m, 0.3);
  assert.equal(m.score.red.pantry[0].carrot, 2);
});

test('depot carrots go into the beltdexer from the back, opposite the intake', () => {
  const [m, r] = solo(0);
  m.inv.red.depotCarrots = 5;
  const c = F.depotChutes('red')[0];
  r.x = c.x + c.dx * (r.cfg.length / 2 + 0.05);
  r.y = c.y + c.dy * (r.cfg.length / 2 + 0.05);
  r.th = Math.atan2(-c.dy, -c.dx);
  m.setInput('a', { align: true }); // auto-align turns the back to the chute
  run(m, 1.5);
  assert.ok(Math.abs(Math.cos(r.th - Math.atan2(c.dy, c.dx)) - 1) < 0.01, 'back toward the chute');
  m.setInput('a', {});
  run(m, 5);
  assert.equal(r.held.length, 3);
});

test('oven: intake stays up unless it has a carrot; ramp cakes caught over the back', () => {
  const [m, r] = solo(0);
  m.setInput('a', { sp: 'oven' });
  run(m, 1);
  assert.equal(r.arm, r.cfg.slap.stow, 'nothing aboard: stays up');
  // ramp: back toward the oven's tag face
  m.inv.red.rampCakes = 3;
  r.x = F.OVEN.x0 - r.cfg.length / 2 - 0.3;
  r.y = F.OVEN.yc;
  r.th = 0;
  m.setInput('a', { align: true });
  run(m, 1.5);
  assert.ok(Math.abs(Math.cos(r.th - Math.PI) - 1) < 0.01, 'auto-align backs up to the ramp');
  m.setInput('a', { sp: 'oven' });
  run(m, 6);
  assert.equal(r.held.length, 3, 'three cakes');
  assert.equal(r.carriage, 1, 'one handed up to the arm');
  assert.ok(Math.abs(r.arm - r.cfg.slap.oven) < 2, 'with a piece in the arm it swings down to the oven pose');
});
