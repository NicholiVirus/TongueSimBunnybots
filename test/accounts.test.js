import test from 'node:test';
import assert from 'node:assert/strict';
import { Accounts } from '../server/accounts.js';
import { Room } from '../server/room.js';

const memStore = () => ({ doc: { users: {}, sessions: {}, scores: {} }, changed() {} });

test('register, log in, sessions and bad passwords', async () => {
  const acc = new Accounts(memStore(), { admins: '' });
  const { token, user } = await acc.register('Driver_1', 'secret1', '611');
  assert.equal(user.name, 'Driver_1');
  assert.equal(acc.userFor(token).name, 'Driver_1');
  await assert.rejects(acc.register('driver_1', 'another1'), /taken/, 'usernames are case-insensitive');
  await assert.rejects(acc.register('x', 'secret1'), /Username/);
  await assert.rejects(acc.register('Shorty', '123'), /Password/);
  await assert.rejects(acc.login('DRIVER_1', 'nope'), /Wrong/);
  const again = await acc.login('DRIVER_1', 'secret1');
  assert.notEqual(again.token, token);
  assert.ok(!JSON.stringify(acc.db).includes('secret1'), 'passwords are never stored in plain text');
  acc.logout(token);
  assert.equal(acc.userFor(token), null);
});

test('leaderboard keeps each driver’s best per mechanism; only admins remove scores', async () => {
  const acc = new Accounts(memStore(), { admins: 'Boss' });
  const a = (await acc.register('alice', 'secret1')).token;
  const b = (await acc.register('bob', 'secret1')).token;
  const boss = (await acc.register('boss', 'secret1')).token;
  const ua = acc.userFor(a);
  const ub = acc.userFor(b);
  const run = (u, score, mech) => acc.submit(u, { score, totals: { total: score }, robot: 'team', mods: { mech }, team: '611' });
  assert.equal(run(ua, 50, 'passthrough').best, true);
  assert.equal(run(ua, 40, 'passthrough').best, false, 'a worse run does not replace the best');
  run(ua, 70, 'separate');
  run(ub, 60, 'passthrough');
  assert.deepEqual(
    acc.board('passthrough').map((e) => [e.name, e.score]),
    [
      ['bob', 60],
      ['alice', 50],
    ],
  );
  assert.deepEqual(
    acc.board('overall').map((e) => [e.name, e.score]),
    [
      ['alice', 70],
      ['bob', 60],
    ],
    'overall = each driver’s best on any mechanism',
  );
  assert.throws(() => acc.remove(ub, 'alice', 'separate'), /admins/);
  acc.remove(acc.userFor(boss), 'alice', 'separate');
  assert.deepEqual(
    acc.board('overall').map((e) => [e.name, e.score]),
    [
      ['bob', 60],
      ['alice', 50],
    ],
  );
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
