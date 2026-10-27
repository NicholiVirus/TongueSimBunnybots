import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, TICK } from '../shared/sim.js';
import { Bot } from '../shared/bot.js';
import * as F from '../shared/field.js';

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
  assert.ok(m.score.red.totals.pantry > 0 || m.score.blue.totals.pantry > 0, 'bots scored in a pantry');
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

test('oven carrots recirculate into a cake on the ramp', () => {
  const m = new Match({ slots: [{ id: 'a', alliance: 'red', station: 1, robot: 'team' }], preload: 0 });
  const r = m.robots[0];
  while (m.phase === 'countdown') m.step();
  const startDepotBlue = m.inv.blue.depotCarrots;
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
  assert.equal(m.inv.blue.depotCarrots, startDepotBlue + 3, 'carrots handed to the opposing depot');
  assert.equal(m.inv.red.cakeBank, 8);
  const cakes = m.pieces.filter((p) => p.type === 'cake' && p.st !== 'table');
  assert.equal(cakes.length, 1, 'a cake was rolled down the ramp');
});
