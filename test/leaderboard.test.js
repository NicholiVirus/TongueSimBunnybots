import test from 'node:test';
import assert from 'node:assert/strict';
import { Leaderboard } from '../server/leaderboard.js';
import { Room } from '../server/room.js';

const memStore = () => ({ doc: { scores: [] }, changed() {} });

test('every ranked run is listed under its driver name; only the admin key removes runs', () => {
  const lb = new Leaderboard(memStore(), { adminKey: 'shh' });
  const run = (name, score, mech) => lb.submit({ name, score, totals: { total: score }, robot: 'team', mods: { mech }, team: '611' });
  run('alice', 50, 'passthrough');
  run('alice', 40, 'passthrough');
  const best = run('alice', 70, 'separate');
  run('bob', 60, 'passthrough');
  assert.deepEqual(best, { arch: 'separate', rank: 1, overallRank: 1 }, 'new global record');
  assert.deepEqual(
    lb.board('overall').map((e) => [e.name, e.score]),
    [
      ['alice', 70],
      ['bob', 60],
      ['alice', 50],
      ['alice', 40],
    ],
    'no personal-best filtering: all runs count',
  );
  assert.equal(lb.board('passthrough').length, 3);
  const top = lb.board('overall')[0];
  assert.throws(() => lb.remove('guess', top.id), /admin key/);
  lb.remove('shh', top.id);
  assert.equal(lb.board('overall')[0].name, 'bob');
  assert.equal(new Leaderboard(memStore(), { adminKey: '' }).isAdmin(''), false, 'no key set: nobody is admin');
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
