import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, TICK } from '../shared/sim.js';
import { Bot } from '../shared/bot.js';
import * as F from '../shared/field.js';

test('bots grab their table cake during AUTO', () => {
  const m = fullBotMatch();
  const tableCakes = m.pieces.filter((p) => p.st === 'table');
  while (m.phase !== 'teleop') {
    for (const b of m.bots) b.update(m, TICK);
    m.step(TICK);
  }
  for (const c of tableCakes) assert.notEqual(c.st, 'table', `cake at x=${c.x.toFixed(2)} still on the table after AUTO`);
});

test('cakes stay stored on the ramp until a robot waits at the bottom', () => {
  const m = new Match({ slots: [{ id: 'a', alliance: 'red', station: 1, robot: 'team' }], preload: 0 });
  const r = m.robots[0];
  while (m.phase === 'countdown') m.step();
  m.inv.red.rampCakes = 2;
  for (let i = 0; i < 60 * 4; i++) m.step();
  assert.equal(m.inv.red.rampCakes, 2, 'nobody waiting: cakes stay with the human player');
  assert.equal(m.pieces.filter((p) => p.type === 'cake' && p.st !== 'table').length, 0);
  r.x = F.OVEN.x0 - r.cfg.length / 2 - 0.05;
  r.y = F.OVEN.yc;
  r.th = 0;
  for (let i = 0; i < 60 * 0.9; i++) m.step();
  assert.equal(m.inv.red.rampCakes, 2, 'nothing rolls until the robot has waited 1 s');
  for (let i = 0; i < 60 * 3.5; i++) m.step();
  assert.equal(m.inv.red.rampCakes, 0);
  assert.equal(r.held.length, 2, 'both cakes rolled straight into the waiting robot, 0.5 s apart');
});

test('auto-roll setting sends cakes down without a catcher', () => {
  const m = new Match({ slots: [{ id: 'a', alliance: 'red', station: 1, robot: 'team' }], preload: 0, autoRamp: true });
  while (m.phase === 'countdown') m.step();
  m.inv.red.rampCakes = 2;
  for (let i = 0; i < 60 * 4; i++) m.step();
  assert.equal(m.inv.red.rampCakes, 0);
  assert.equal(m.pieces.filter((p) => p.type === 'cake' && p.st === 'floor').length, 2);
});

test('in AUTO one bot per alliance rushes the table cake, partners feed the oven', () => {
  const m = fullBotMatch();
  const rushers = { red: new Set(), blue: new Set() };
  while (m.phase !== 'teleop') {
    for (const b of m.bots) {
      b.update(m, TICK);
      if (b.task?.kind === 'table') rushers[m.robotById(b.id).alliance].add(b.id);
    }
    m.step(TICK);
  }
  assert.equal(rushers.red.size, 1);
  assert.equal(rushers.blue.size, 1);
  assert.ok(m.score.red.ovenCarrot >= 3 && m.score.blue.ovenCarrot >= 3, 'partners put carrots in the oven during AUTO');
});

test('robot mechanism options are enforced', () => {
  const slots = [
    { id: 'a', alliance: 'red', station: 1, robot: 'team', mods: { ground: false, maxLevel: 1 } },
    { id: 'b', alliance: 'red', station: 2, robot: 'team', mods: { mech: 'separate' } },
  ];
  const m = new Match({ slots });
  const [a, b] = m.robots;
  while (m.phase === 'countdown') m.step();
  // no ground intake: a carrot right in front is not collected
  const c = m.addPiece('carrot', a.x + Math.cos(a.th) * (a.cfg.length / 2 + 0.1), a.y + Math.sin(a.th) * (a.cfg.length / 2 + 0.1), a.th + Math.PI / 2, 'floor');
  m.setInput('a', { intake: true });
  for (let i = 0; i < 10; i++) m.step();
  assert.equal(c.st, 'floor');
  // max LEVEL 1: L2 is refused
  m.setInput('a', { sp: 'l2' });
  m.step();
  assert.notEqual(a.elevTarget, 'l2');
  // separate elevator: one piece per lift, reloads at the bottom, returns to the shelf by itself
  b.x = F.pantrySlotX(2, 1);
  b.y = F.PANTRY.yFront - b.cfg.length / 2;
  b.th = Math.PI / 2;
  for (let i = 0; i < 40; i++) m.step(); // load the carriage
  m.setInput('b', { sp: 'l3' });
  for (let i = 0; i < 60; i++) m.step();
  m.setInput('b', { score: true });
  m.step();
  assert.equal(b.held.length, 1);
  for (let i = 0; i < 20; i++) m.step();
  assert.equal(b.held.length, 1, 'carriage empty: no second score until it reloads');
  b.x += F.PIECE.length + 0.05; // slide over to an open gap
  for (let i = 0; i < 60 * 3; i++) m.step();
  assert.equal(b.held.length, 0, 'reloaded at the bottom, went back to L3 and scored again');
  assert.equal(m.score.red.pantry[2].carrot, 2);
});

test('elevator-back robots score with their back to the pantry; depot auto-align', async () => {
  const { alignTarget } = await import('../shared/sim.js');
  const m = new Match({ slots: [{ id: 'a', alliance: 'red', station: 1, robot: 'team', mods: { mech: 'opposite' } }] });
  const r = m.robots[0];
  while (m.phase === 'countdown') m.step();
  r.x = F.pantrySlotX(2, 1);
  r.y = F.PANTRY.yFront - r.cfg.length / 2;
  r.th = Math.PI / 2; // facing the shelves = elevator facing away
  for (let i = 0; i < 40; i++) m.step();
  m.setInput('a', { sp: 'l2' });
  for (let i = 0; i < 60; i++) m.step();
  m.setInput('a', { score: true });
  m.step();
  assert.equal(r.held.length, 2, 'front-facing: no score');
  r.th = -Math.PI / 2; // back to the shelves
  m.step();
  assert.equal(r.held.length, 1, 'back-facing: scores');
  // standing in our FARM near a depot chute, align targets the depot
  const c = F.depotChutes('red')[0];
  r.x = c.x + c.dx * 1.2;
  r.y = c.y;
  assert.equal(alignTarget(r, 'red').kind, 'depot');
});

test('team 611 tongue slides scored pieces along the shelf; others cannot deploy it', () => {
  const m = new Match({
    slots: [
      { id: 'a', alliance: 'red', station: 1, robot: 'team', team: '611' },
      { id: 'b', alliance: 'blue', station: 1, robot: 'team', team: '449' },
    ],
  });
  const [a, b] = m.robots;
  while (m.phase === 'countdown') m.step();
  m.setInput('b', { tongue: true });
  m.step();
  assert.ok(!b.tongue, 'only 611 has a tongue');
  // a carrot sitting on red LEVEL 1
  const p = m.addPiece('carrot', 6.2, 4.02, 0, 'pantry');
  p.z = F.PANTRY.shelfZ[0];
  m.pantry.red[0].push(p.id);
  a.x = 6.2;
  a.y = F.PANTRY.yFront - a.cfg.length / 2 - 0.02;
  a.th = Math.PI / 2;
  m.setInput('a', { tongue: true, sp: 'l1' });
  m.step();
  m.setInput('a', { sp: 'l1' });
  for (let i = 0; i < 40; i++) m.step();
  assert.ok(a.tongue);
  m.setInput('a', { mx: 0.6, my: 0 }); // drive right (+x)
  for (let i = 0; i < 30; i++) m.step();
  assert.ok(p.x > 6.4, `carrot slid right to ${p.x.toFixed(2)}`);
  assert.ok(p.x <= F.PANTRY.x1 - F.PIECE.length / 2 + 1e-6, 'stays on the shelf');
});

test('team 612 freezes robots it hits for 5 s', () => {
  const m = new Match({
    slots: [
      { id: 'a', alliance: 'red', station: 1, robot: 'team', team: '612' },
      { id: 'b', alliance: 'blue', station: 1, robot: 'team', team: '449' },
    ],
  });
  const [a, b] = m.robots;
  while (m.phase === 'countdown') m.step();
  a.x = 1;
  a.y = 0 + 2;
  b.x = 1 - a.cfg.length;
  b.y = 2;
  m.setInput('a', { mx: -1 });
  for (let i = 0; i < 20; i++) m.step();
  assert.ok(b.stunUntil > m.time, 'victim stunned');
  const x0 = b.x;
  m.setInput('a', { mx: 1 }); // back off
  m.setInput('b', { mx: 1, intake: true });
  for (let i = 0; i < 60 * 3; i++) m.step();
  assert.ok(Math.abs(b.x - x0) < 0.3 && !b.intake, 'frozen: no driving, no mechanisms');
  for (let i = 0; i < 60 * 2.5; i++) m.step();
  assert.ok(b.x - x0 > 0.3, 'moves again after 5 s');
});

test('team 526 is locked to an L1 ground-intake elevator plus a depot/ramp-only hopper', () => {
  const m = new Match({ slots: [{ id: 'a', alliance: 'red', station: 1, robot: 'team', team: '526', mods: { maxLevel: 3, mech: 'passthrough' } }], preload: 0 });
  const r = m.robots[0];
  assert.equal(r.cfg.mods.maxLevel, 1);
  assert.equal(r.cfg.mods.mech, 'elevIntake');
  while (m.phase === 'countdown') m.step();
  // ground pickup goes onto the elevator; a second one is refused while it's full
  const put = () => m.addPiece('carrot', r.x + Math.cos(r.th) * (r.cfg.length / 2 + 0.1), r.y + Math.sin(r.th) * (r.cfg.length / 2 + 0.1), r.th + Math.PI / 2, 'floor');
  const c1 = put();
  m.setInput('a', { intake: true });
  for (let i = 0; i < 5; i++) m.step();
  assert.equal(c1.st, 'held');
  assert.equal(r.carriagePiece, c1.id);
  const c2 = put();
  for (let i = 0; i < 10; i++) m.step();
  assert.equal(c2.st, 'floor', 'elevator holds one piece');
  m.setInput('a', { sp: 'l2' });
  m.step();
  assert.notEqual(r.elevTarget, 'l2', 'L1 max');
});

function fullBotMatch() {
  const slots = [];
  for (const alliance of ['red', 'blue']) for (const station of [1, 2, 3]) slots.push({ id: `${alliance}${station}`, alliance, station, robot: ['team', 'speedy', 'tank'][station - 1], bot: true });
  const m = new Match({ slots });
  m.bots = slots.map((s) => new Bot(s.id));
  return m;
}

test('a full 6-bot match runs to completion with sane scores', () => {
  const m = fullBotMatch();
  const t0 = Date.now();
  let guard = 0;
  while (m.phase !== 'done' && guard++ < 60 * 200) {
    for (const b of m.bots) b.update(m, TICK);
    m.step(TICK);
    m.drainEvents();
  }
  const ms = Date.now() - t0;
  assert.equal(m.phase, 'done');
  for (const r of m.robots) {
    assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y), 'robot pose finite');
    assert.ok(Math.abs(r.x) <= F.FIELD.halfL && Math.abs(r.y) <= F.FIELD.halfW, `robot ${r.id} on field`);
  }
  for (const p of m.pieces) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'piece finite');
  const res = m.result;
  assert.ok(res && res.red && res.blue);
  console.log('red', JSON.stringify(m.score.red.totals), 'blue', JSON.stringify(m.score.blue.totals));
  console.log('rp', JSON.stringify(res), 'sim ms', ms);
  assert.ok(m.score.red.totals.oven > 0 && m.score.blue.totals.oven > 0, 'bots scored carrots in the oven');
  for (const a of ['red', 'blue'])
    assert.ok(
      m.score[a].pantry.every((l) => l.carrot === 0),
      'bots only shelve carrot cakes',
    );
  assert.ok(m.score.red.taxi + m.score.blue.taxi >= 4, 'most bots taxied');
});

test('pantry scoring needs the right elevator height and facing', () => {
  const m = new Match({ slots: [{ id: 'a', alliance: 'red', station: 1, robot: 'team' }] });
  const r = m.robots[0];
  while (m.phase === 'countdown') m.step();
  r.x = F.pantrySlotX(2, 1);
  r.y = F.PANTRY.yFront - r.cfg.length / 2;
  r.th = Math.PI / 2;
  m.setInput('a', { score: true });
  m.step();
  assert.equal(r.held.length, 2, 'cannot score with elevator stowed');
  m.setInput('a', { sp: 'l3' });
  for (let i = 0; i < 60; i++) m.step();
  m.setInput('a', { score: true });
  m.step();
  assert.equal(r.held.length, 1);
  m.setInput('a', { score: false });
  for (let i = 0; i < 30; i++) m.step();
  assert.equal(m.score.red.pantry[2].carrot, 1);
  assert.equal(m.score.red.totals.pantry, 5);
});

test('shelf has no grid: pieces land where the robot is, and overlaps are refused', async () => {
  const { shelfFit } = await import('../shared/sim.js');
  assert.equal(shelfFit([], 6.0, 'red', 0.12), 6.0);
  assert.equal(shelfFit([6.0], 6.1, 'red', 0.12), null, 'overlapping spot refused');
  assert.ok(Math.abs(shelfFit([6.0], 6.4, 'red', 0.12) - (6.0 + F.PIECE.length)) < 1e-3, 'nudged against the neighbor');
  const full = [0, 1, 2, 3, 4].map((i) => F.PANTRY.x0 + F.PIECE.length * (i + 0.5) + 0.001 * i);
  assert.equal(shelfFit(full, 6.5, 'red'), null, 'five rollers fill a shelf');
});

test('oven carrots recirculate into a cake on the ramp', () => {
  const m = new Match({ slots: [{ id: 'a', alliance: 'red', station: 1, robot: 'team' }], preload: 0 });
  const r = m.robots[0];
  while (m.phase === 'countdown') m.step();
  const startDepotRed = m.inv.red.depotCarrots;
  for (let i = 0; i < 3; i++) {
    const p = m.addPiece('carrot', 0, 0, 0, 'held');
    p.holder = r.id;
    r.held.push(p.id);
  }
  r.x = (F.OVEN.mouthX0 + F.OVEN.mouthX1) / 2;
  r.y = F.OVEN.y1 + r.cfg.length / 2 + 0.01;
  r.th = -Math.PI / 2;
  m.setInput('a', { score: true });
  for (let i = 0; i < 60 * 3; i++) m.step();
  assert.equal(r.held.length, 0);
  assert.equal(m.score.red.totals.oven, 6);
  assert.equal(m.inv.red.depotCarrots, startDepotRed + 3, 'oven carrots return to our own depot');
  assert.equal(m.inv.red.cakeBank, 8);
  assert.equal(m.inv.red.rampCakes, 1, 'the baked cake is stored at the ramp');
  assert.equal(m.pieces.filter((p) => p.type === 'cake' && p.st !== 'table').length, 0, 'nothing rolls down without a robot waiting');
});
