import test from 'node:test';
import assert from 'node:assert/strict';
import { Leaderboard } from '../server/leaderboard.js';
import { Room } from '../server/room.js';

const memStore = () => ({ doc: { scores: [] }, changed() {} });

test('one entry per driver + robot (best run); only the admin key removes runs', () => {
  const lb = new Leaderboard(memStore(), { adminKey: 'shh' });
  const run = (name, score, mech, robot = 'team') => lb.submit({ name, score, totals: { total: score }, robot, mods: { mech }, team: '611' });
  run('alice', 50, 'passthrough');
  assert.equal(run('Alice', 40, 'passthrough').improved, false, 'a worse run with the same robot is not listed');
  assert.equal(run('alice', 55, 'passthrough').improved, true, 'a better one replaces it');
  run('alice', 45, 'passthrough', 'speedy'); // different drivetrain: its own entry
  const best = run('alice', 70, 'separate');
  run('bob', 60, 'passthrough');
  assert.equal(best.overallRank, 1, 'new global record');
  assert.deepEqual(
    lb.board('overall').map((e) => [e.name, e.score, e.robot]),
    [
      ['alice', 70, 'team'],
      ['bob', 60, 'team'],
      ['alice', 55, 'team'],
      ['alice', 45, 'speedy'],
    ],
  );
  assert.equal(lb.board('passthrough').length, 3);
  const top = lb.board('overall')[0];
  assert.throws(() => lb.remove('guess', top.id), /admin key/);
  lb.remove('shh', top.id);
  assert.equal(lb.board('overall')[0].name, 'bob');
  assert.equal(new Leaderboard(memStore(), { adminKey: '' }).isAdmin(''), false, 'no key set: nobody is admin');
});

test('saved duplicates collapse to the best run per driver + robot', () => {
  const e = (score) => ({ name: 'a', score, robot: 'team', mods: { mech: 'passthrough' }, arch: 'passthrough', date: score });
  const lb = new Leaderboard({ doc: { scores: [e(5), e(9), e(7)] }, changed() {} }, {});
  assert.deepEqual(
    lb.board('overall').map((x) => x.score),
    [9],
  );
});

test('old per-driver saves are migrated', () => {
  const store = { doc: { users: { a: {} }, sessions: {}, scores: { 'a|passthrough': { name: 'a', score: 9, arch: 'passthrough', date: 1 } } }, changed() {} };
  const lb = new Leaderboard(store, {});
  assert.equal(lb.board('overall')[0].score, 9);
  assert.equal(store.doc.users, undefined);
});

test('ranked rooms are solo, locked, and report the final score', () => {
  let reported = null;
  const room = new Room('TEST', { isPublic: false, ranked: true, onResult: (r, m) => (reported = m) });
  const sent = [];
  const player = { id: 'p1', name: 'alice', team: '611', robot: 'team', mods: { mech: 'separate' }, send: (o) => sent.push(o), sendRaw: (j) => sent.push(JSON.parse(j)) };
  room.add(player);
  room.handle(player, { t: 'fillBots' });
  room.handle(player, { t: 'settings', officialRules: true });
  room.start();
  room.stop(); // drive the match by hand instead of the real-time loop
  assert.equal(room.match.robots.length, 1, 'no bots in a ranked run');
  assert.equal(room.match.officialRules, false);
  while (room.match.phase !== 'done') room.tick();
  room.finish();
  assert.equal(reported?.robots[0].cfg.mods.mech, 'separate');
  assert.ok(sent.some((m) => m.t === 'results'));
});
