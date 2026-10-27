import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { ROBOTS } from '../shared/robots.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.static(path.join(ROOT, 'public')));
app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.use('/vendor/three/addons', express.static(path.join(ROOT, 'node_modules/three/examples/jsm')));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three/build')));

const rooms = new Map();

app.get('/api/rooms', (_req, res) => {
  res.json([...rooms.values()].filter((r) => r.isPublic).map((r) => ({ code: r.code, players: r.humanCount, phase: r.phase })));
});

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
function createRoom(isPublic) {
  const code = newCode();
  const room = new Room(code, { isPublic, onEmpty: (r) => rooms.delete(r.code) });
  rooms.set(code, room);
  return room;
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
        player.name =
          String(msg.name || 'Driver')
            .replace(/[<>]/g, '')
            .slice(0, 20) || 'Driver';
        player.team = String(msg.team || '')
          .replace(/\D/g, '')
          .slice(0, 5);
        if (ROBOTS[msg.robot]) player.robot = msg.robot;
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
