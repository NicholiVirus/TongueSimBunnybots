import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { openStore } from './store.js';
import { Accounts, BOARDS } from './accounts.js';
import { ROBOTS, sanitizeMods, modsLabel } from '../shared/robots.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;

const store = await openStore();
const accounts = new Accounts(store);
console.log(`Accounts + leaderboard stored in ${store.kind}${accounts.admins.size ? '' : ' (no leaderboard admins set)'}`);

const app = express();
app.set('trust proxy', 1); // real client IPs behind Render's proxy (for the login rate limit)
app.use(express.static(path.join(ROOT, 'public')));
app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.use('/vendor/three/addons', express.static(path.join(ROOT, 'node_modules/three/examples/jsm')));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three/build')));

const rooms = new Map();

app.get('/api/rooms', (_req, res) => {
  res.json([...rooms.values()].filter((r) => r.isPublic).map((r) => ({ code: r.code, players: r.humanCount, phase: r.phase })));
});

// ------------------------------------------------------------------ accounts + leaderboard API
const api = express.Router();
api.use(express.json({ limit: '4kb' }));
const tokenOf = (req) => (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || null;

// a few login/register attempts per IP per 10 minutes
const attempts = new Map();
function limited(req, res, next) {
  const now = Date.now();
  const a = attempts.get(req.ip);
  if (!a || a.reset < now) attempts.set(req.ip, { n: 1, reset: now + 600e3 });
  else if (++a.n > 20) return res.status(429).json({ error: 'Too many tries — wait a few minutes' });
  if (attempts.size > 5000) attempts.clear();
  next();
}
const fail = (res, err, code = 400) => res.status(code).json({ error: err.message || String(err) });

api.post('/register', limited, async (req, res) => {
  try {
    res.json(await accounts.register(req.body?.username, req.body?.password, req.body?.team));
  } catch (err) {
    fail(res, err);
  }
});
api.post('/login', limited, async (req, res) => {
  try {
    res.json(await accounts.login(req.body?.username, req.body?.password));
  } catch (err) {
    fail(res, err, 401);
  }
});
api.post('/logout', (req, res) => {
  accounts.logout(tokenOf(req));
  res.json({ ok: true });
});
api.get('/me', (req, res) => {
  const u = accounts.userFor(tokenOf(req));
  if (!u) return res.status(401).json({ error: 'Not logged in' });
  res.json({ user: accounts.publicUser(u) });
});
api.get('/leaderboard', (req, res) => {
  const board = BOARDS[req.query.board] ? req.query.board : 'overall';
  const rows = accounts
    .board(board)
    .slice(0, 100)
    .map((e, i) => ({
      rank: i + 1,
      user: e.user,
      name: e.name,
      team: e.team,
      score: e.score,
      arch: e.arch,
      robot: ROBOTS[e.robot]?.name || e.robot,
      build: modsLabel(e.mods),
      totals: e.totals,
      date: e.date,
    }));
  res.json({ boards: BOARDS, board, rows });
});
api.delete('/leaderboard', (req, res) => {
  try {
    accounts.remove(accounts.userFor(tokenOf(req)), req.body?.user, req.body?.arch);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 403);
  }
});
app.use('/api', api);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)];
    if (!rooms.has(c)) return c;
  }
}
function createRoom(isPublic, ranked = false) {
  const code = newCode();
  const room = new Room(code, { isPublic, ranked, onEmpty: (r) => rooms.delete(r.code), onResult: ranked ? rankedResult : null });
  rooms.set(code, room);
  return room;
}

// A RANKED run is a server-run solo match (one robot, no bots on either alliance, house rules), so
// the score can be trusted. It counts toward the driver's leaderboards when it ends.
function rankedResult(room, m) {
  const [p] = room.players.values();
  const r = m.robots[0];
  if (!p?.user || m.robots.length !== 1 || room.slotOf(p.id) !== r.id) return;
  const score = m.score[r.alliance].totals.total;
  const res = accounts.submit(p.user, { score, totals: m.score[r.alliance].totals, robot: r.robot, mods: r.cfg.mods, team: r.team });
  p.send({ t: 'ranked', score, ...res, archName: BOARDS[res.arch] });
}

let nextId = 1;
wss.on('connection', (ws) => {
  const player = {
    id: `p${nextId++}`,
    name: 'Driver',
    team: '',
    robot: 'team',
    room: null,
    queue: [],
    lastInput: {},
    send: (obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj)),
    sendRaw: (s) => ws.readyState === 1 && ws.bufferedAmount < 1 << 20 && ws.send(s),
  };
  player.send({ t: 'welcome', id: player.id });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case 'hello':
        if ('token' in msg) player.user = accounts.userFor(msg.token);
        player.name =
          player.user?.name ||
          String(msg.name || 'Driver')
            .replace(/[<>]/g, '')
            .slice(0, 20) ||
          'Driver';
        player.team = String(msg.team || '')
          .replace(/\D/g, '')
          .slice(0, 5);
        if (ROBOTS[msg.robot]) player.robot = msg.robot;
        if (msg.mods) player.mods = sanitizeMods(msg.mods);
        break;
      case 'ping':
        player.send({ t: 'pong', ts: msg.ts });
        break;
      case 'create': {
        player.room?.remove(player);
        createRoom(msg.isPublic !== false).add(player);
        break;
      }
      case 'join': {
        const room = rooms.get(
          String(msg.code || '')
            .toUpperCase()
            .trim(),
        );
        if (!room) return player.send({ t: 'error', msg: 'Room not found' });
        if (room.ranked) return player.send({ t: 'error', msg: 'That room is a ranked solo run' });
        if (room.players.size >= 12) return player.send({ t: 'error', msg: 'Room is full' });
        player.room?.remove(player);
        room.add(player);
        break;
      }
      case 'quick': {
        player.room?.remove(player);
        const open = [...rooms.values()].find((r) => r.isPublic && r.phase === 'lobby' && r.freeSlot());
        (open || createRoom(true)).add(player);
        break;
      }
      case 'ranked': {
        if (!player.user) return player.send({ t: 'error', msg: 'Log in (or register) to play ranked runs' });
        player.room?.remove(player);
        const room = createRoom(false, true);
        room.add(player);
        room.start();
        break;
      }
      case 'leave':
        player.room?.remove(player);
        player.send({ t: 'left' });
        break;
      default:
        player.room?.handle(player, msg);
    }
  });

  ws.on('close', () => player.room?.remove(player));
});

server.listen(PORT, () => {
  console.log(`Harvest Havoc sim running at http://localhost:${PORT}`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    await store.close(); // write any pending account/score changes before exiting
    process.exit(0);
  });
}
