// CHARLES (team 611's robot): roller claw on an arm + elevator, rear trader.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, TICK } from '../shared/sim.js';
import { Bot } from '../shared/bot.js';
import { getRobotConfig, clawPose } from '../shared/robots.js';
import * as F from '../shared/field.js';

const solo = (extra = {}) => {
  const m = new Match({ slots: [{ id: 'a', alliance: 'red', station: 1, robot: 'team', ...extra }], preload: 0 });
  while (m.phase === 'countdown') m.step();
  return [m, m.robots[0]];
};
const run = (m, secs) => {
  for (let i = 0; i < 60 * secs; i++) m.step();
};
const give = (m, r, type, claw = false) => {
  const p = m.addPiece(type, 0, 0, 0, 'held');
  p.holder = r.id;
  m.addHeld(r, p.id);
  if (claw) {
    r.held.splice(r.held.indexOf(p.id), 1);
    r.held.push(p.id);
    r.carriagePiece = p.id;
  }
  return p;
};

test('the Charles preset always plays the real build', () => {
  const [, r] = solo({ team: '526', mods: { mech: 'passthrough', maxLevel: 1, ground: false } });
  assert.deepEqual(r.cfg.mods, { ground: true, depot: true, ramp: true, maxLevel: 3, mech: 'claw' });
  assert.equal(getRobotConfig('kitbot', { mech: 'separate' }).mods.mech, 'separate', 'other presets stay configurable');
  // the claw lines up with each shelf at the real elevator heights (21" / 33" / 48")
  const cfg = r.cfg;
  [0, 1, 2].forEach((l) => {
    const z = clawPose(cfg, cfg.elevator.setpoints[['l1', 'l2', 'l3'][l]], cfg.arm.pantry).z;
    assert.ok(Math.abs(z - (F.PANTRY.shelfZ[l] + F.PIECE.radius)) < 0.06, `claw height at L${l + 1}: ${z.toFixed(2)}`);
  });
});

test('claw: arm folds down to grab ONE piece off the floor, then stows', () => {
  const [m, r] = solo();
  const put = () => m.addPiece('carrot', r.x + Math.cos(r.th) * (r.cfg.length / 2 + 0.15), r.y + Math.sin(r.th) * (r.cfg.length / 2 + 0.15), r.th + Math.PI / 2, 'floor');
  const c1 = put();
  assert.equal(r.arm, 99, 'arm starts stowed upright');
  m.setInput('a', { intake: true });
  run(m, 0.1);
  assert.equal(c1.st, 'floor', 'nothing is grabbed until the claw is down');
  run(m, 0.4);
  assert.equal(c1.st, 'held');
  assert.equal(r.carriagePiece, c1.id);
  const c2 = put();
  run(m, 0.5);
  assert.equal(c2.st, 'floor', 'the claw holds one piece');
  m.setInput('a', {});
  run(m, 0.6);
  assert.equal(r.arm, 99, 'arm stows with the piece locked in');
});

test('claw places its piece on a shelf; trader carrots stay aboard', () => {
  const [m, r] = solo();
  give(m, r, 'carrot');
  give(m, r, 'cake', true);
  r.x = F.pantrySlotX(2, 1);
  r.y = F.PANTRY.yFront - r.cfg.length / 2;
  r.th = Math.PI / 2;
  m.setInput('a', { sp: 'l3' });
  run(m, 1);
  m.setInput('a', { score: true });
  m.step();
  assert.equal(r.held.length, 2, 'waits for the arm to tip forward');
  run(m, 0.5);
  m.setInput('a', {});
  run(m, 0.5);
  assert.equal(m.score.red.pantry[2].cake, 1, 'cake on LEVEL 3');
  assert.equal(r.held.length, 1, 'the trader carrot is still aboard');
  m.setInput('a', { sp: 'l1', score: true });
  run(m, 1.5);
  assert.equal(r.held.length, 1, 'trader carrots cannot go on the shelves');
});

test('trader: 3 depot carrots in, fired into the oven out the BACK', () => {
  const [m, r] = solo();
  m.inv.red.depotCarrots = 5;
  const c = F.depotChutes('red')[0];
  r.x = c.x + c.dx * (r.cfg.length / 2 + 0.05);
  r.y = c.y + c.dy * (r.cfg.length / 2 + 0.05);
  r.th = Math.atan2(c.dy, c.dx); // trader toward the chute
  run(m, 5);
  assert.equal(r.held.length, 3, 'the trader fills with 3 carrots');
  assert.equal(r.carriagePiece ?? null, null, 'none of them are in the claw');
  // front toward the mouth: nothing happens
  r.x = (F.OVEN.mouthX0 + F.OVEN.mouthX1) / 2;
  r.y = F.OVEN.y1 + r.cfg.length / 2 + 0.01;
  r.th = -Math.PI / 2;
  m.setInput('a', { score: true });
  run(m, 1);
  assert.equal(r.held.length, 3, 'the trader does not fire out the front');
  // auto-align turns the trader to the mouth
  m.setInput('a', { align: true });
  run(m, 1.5);
  assert.ok(Math.abs(Math.sin(r.th) - 1) < 0.02, 'auto-align backs the trader up to the mouth');
  m.setInput('a', { align: true, score: true });
  run(m, 0.8);
  assert.equal(r.held.length, 0, 'all 3 fire in well under a second');
  run(m, 1);
  assert.equal(m.score.red.totals.oven, 6);
});

test('claw takes ramp cakes one at a time', () => {
  const [m, r] = solo();
  m.inv.red.rampCakes = 3;
  give(m, r, 'carrot'); // a carrot in the trader does not block the claw
  r.x = F.OVEN.x0 - r.cfg.length / 2 - 0.05;
  r.y = F.OVEN.yc;
  r.th = 0;
  run(m, 5);
  assert.equal(m.inv.red.rampCakes, 2, 'only one cake rolls down');
  assert.equal(m.pieces.find((p) => p.id === r.carriagePiece)?.type, 'cake', 'and it is in the claw');
  assert.equal(m.pieces.filter((p) => p.type === 'cake' && p.st === 'floor').length, 0, 'nothing spilled');
});

test('bots can drive Charles: a full match scores with claws and traders', () => {
  const slots = [];
  for (const alliance of ['red', 'blue']) for (const station of [1, 2, 3]) slots.push({ id: `${alliance}${station}`, alliance, station, robot: 'team', bot: true });
  const m = new Match({ slots });
  m.bots = slots.map((s) => new Bot(s.id));
  let guard = 0;
  while (m.phase !== 'done' && guard++ < 60 * 200) {
    for (const b of m.bots) b.update(m, TICK);
    m.step(TICK);
  }
  assert.equal(m.phase, 'done');
  for (const a of ['red', 'blue']) {
    const sb = m.score[a];
    const shelf = sb.pantry.reduce((n, l) => n + l.cake + l.carrot, 0);
    console.log(a, sb.totals, 'oven carrots', sb.ovenCarrot, 'shelf pieces', shelf);
    assert.ok(sb.ovenCarrot >= 6, `${a} traders fed the oven (${sb.ovenCarrot})`);
    assert.ok(sb.pantry.reduce((n, l) => n + l.cake, 0) >= 1, `${a} claws shelved a cake`);
    assert.ok(sb.totals.total >= 30, `${a} scored ${sb.totals.total}`);
  }
});

test('starting load: 2 in the trader, 1+1, or 2 side by side in the claw', () => {
  const start = (load) => {
    const m = new Match({ slots: [{ id: 'a', alliance: 'red', station: 1, robot: 'team', load }] });
    return [m, m.robots[0]];
  };
  let [, r] = start(undefined);
  assert.deepEqual([r.held.length, !!r.carriagePiece, !!r.clawPair], [2, false, false], 'default: both in the trader');
  [, r] = start('split');
  assert.deepEqual([r.held.length, !!r.carriagePiece, !!r.clawPair], [2, true, false], 'one in the claw, one in the trader');
  let m;
  [m, r] = start('claw2');
  assert.deepEqual([r.held.length, !!r.carriagePiece, !!r.clawPair], [2, true, true], 'two in the claw');
  assert.equal(m.inv.red.depotCarrots, F.CARROTS_PER_ALLIANCE - F.PRESTAGED_CARROTS - 2, 'preloads still come out of the depot');
  // score the claw's carrots one at a time from a shelf; the second takes over
  while (m.phase === 'countdown') m.step();
  assert.equal(m.snapshot().r[0][6] & (8 | 256), 8 | 256, 'snapshot flags show a double claw');
  r.x = F.pantrySlotX(2, 1);
  r.y = F.PANTRY.yFront - r.cfg.length / 2;
  r.th = Math.PI / 2;
  m.setInput('a', { sp: 'l2' });
  run(m, 1.5);
  m.setInput('a', { score: true });
  run(m, 1);
  assert.equal(r.held.length, 1);
  assert.ok(r.carriagePiece && !r.clawPair, 'the other carrot is now the claw piece');
  r.x += 0.6; // slide to the next gap
  run(m, 1);
  assert.equal(m.score.red.pantry[1].carrot, 2, 'both carrots end up on LEVEL 2');
  assert.equal(r.held.length, 0);
});
