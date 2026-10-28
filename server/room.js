import { Match, TICK } from '../shared/sim.js';
import { Bot } from '../shared/bot.js';
import { ROBOTS, sanitizeMods, effectiveMods } from '../shared/robots.js';

export const SLOT_IDS = ['red1', 'red2', 'red3', 'blue1', 'blue2', 'blue3'];
const SNAP_EVERY = 2; // 60 Hz sim -> 30 Hz snapshots
const MAX_QUEUE = 4;

const clean = (s, n) =>
  String(s ?? '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, n);

export class Room {
  constructor(code, { isPublic = true, onEmpty } = {}) {
    this.code = code;
    this.isPublic = isPublic;
    this.onEmpty = onEmpty;
    this.players = new Map(); // id -> player
    this.host = null;
    this.slots = Object.fromEntries(SLOT_IDS.map((s) => [s, null]));
    this.phase = 'lobby';
    this.match = null;
    this.bots = [];
    this.loop = null;
    this.lastResult = null;
    this.settings = { autoRamp: false, officialRules: false };
    this.createdAt = Date.now();
  }

  get humanCount() {
    return this.players.size;
  }

  freeSlot() {
    // fill alliances evenly
    const order = ['red1', 'blue1', 'red2', 'blue2', 'red3', 'blue3'];
    return order.find((s) => !this.slots[s] || this.slots[s].type === 'bot');
  }

  add(player) {
    this.players.set(player.id, player);
    player.room = this;
    if (!this.host) this.host = player.id;
    if (this.phase === 'lobby') {
      const s = this.freeSlot();
      if (s) this.slots[s] = { type: 'human', pid: player.id };
    }
    this.sendChat(null, `${player.name} joined`);
    this.broadcastRoom();
    if (this.phase !== 'lobby' && this.match) this.sendStart(player);
  }

  remove(player) {
    if (!this.players.has(player.id)) return;
    this.players.delete(player.id);
    player.room = null;
    for (const s of SLOT_IDS) {
      const sl = this.slots[s];
      if (sl && sl.type === 'human' && sl.pid === player.id) {
        // mid-match, a bot takes over the robot; in the lobby the slot opens up
        if (this.match && this.phase === 'match') {
          this.slots[s] = { type: 'bot', robot: player.robot, mods: player.mods, name: `${player.name} (bot)`, team: player.team };
          this.bots.push(new Bot(s));
          this.match.bots = this.bots;
        } else this.slots[s] = null;
      }
    }
    if (this.host === player.id) this.host = this.players.keys().next().value ?? null;
    this.sendChat(null, `${player.name} left`);
    if (this.players.size === 0) {
      this.stop();
      this.onEmpty?.(this);
      return;
    }
    this.broadcastRoom();
  }

  slotOf(pid) {
    return SLOT_IDS.find((s) => this.slots[s]?.type === 'human' && this.slots[s].pid === pid) || null;
  }

  handle(player, msg) {
    const isHost = player.id === this.host;
    switch (msg.t) {
      case 'slot': {
        if (this.phase !== 'lobby') return;
        const cur = this.slotOf(player.id);
        if (msg.slot === 'spec') {
          if (cur) this.slots[cur] = null;
        } else if (SLOT_IDS.includes(msg.slot)) {
          const target = this.slots[msg.slot];
          if (target && target.type === 'human') return;
          if (cur) this.slots[cur] = null;
          this.slots[msg.slot] = { type: 'human', pid: player.id };
        }
        this.broadcastRoom();
        break;
      }
      case 'robot':
        if (ROBOTS[msg.robot]) player.robot = msg.robot;
        if (msg.mods) player.mods = sanitizeMods(msg.mods);
        this.broadcastRoom();
        break;
      case 'bot': {
        if (!isHost || this.phase !== 'lobby' || !SLOT_IDS.includes(msg.slot)) return;
        const cur = this.slots[msg.slot];
        if (msg.add && !cur) this.slots[msg.slot] = { type: 'bot', robot: ROBOTS[msg.robot] ? msg.robot : 'team' };
        if (!msg.add && cur?.type === 'bot') this.slots[msg.slot] = null;
        this.broadcastRoom();
        break;
      }
      case 'settings':
        if (!isHost || this.phase !== 'lobby') return;
        if ('autoRamp' in msg) this.settings.autoRamp = !!msg.autoRamp;
        if ('officialRules' in msg) this.settings.officialRules = !!msg.officialRules;
        this.broadcastRoom();
        break;
      case 'fillBots':
        if (!isHost || this.phase !== 'lobby') return;
        for (const s of SLOT_IDS) if (!this.slots[s]) this.slots[s] = { type: 'bot', robot: ['team', 'speedy', 'tank'][SLOT_IDS.indexOf(s) % 3] };
        this.broadcastRoom();
        break;
      case 'kick': {
        if (!isHost || msg.pid === player.id) return;
        const p = this.players.get(msg.pid);
        if (p) {
          p.send({ t: 'kicked' });
          this.remove(p);
        }
        break;
      }
      case 'start':
        if (isHost && this.phase !== 'match') this.start();
        break;
      case 'lobby':
        if (isHost && this.phase !== 'lobby') this.toLobby();
        break;
      case 'chat': {
        const text = clean(msg.text, 160);
        if (text) this.sendChat(player, text);
        break;
      }
      case 'in':
        if (this.phase === 'match' && Array.isArray(msg.i)) {
          for (const inp of msg.i.slice(0, 8)) player.queue.push(sanitizeInput(inp));
          while (player.queue.length > MAX_QUEUE * 2) player.queue.shift();
        }
        break;
      default:
    }
  }

  start() {
    const slots = [];
    this.bots = [];
    for (const s of SLOT_IDS) {
      const sl = this.slots[s];
      if (!sl) continue;
      const alliance = s.startsWith('red') ? 'red' : 'blue';
      const station = Number(s.slice(-1));
      if (sl.type === 'human') {
        const p = this.players.get(sl.pid);
        if (!p) continue;
        slots.push({ id: s, alliance, station, robot: p.robot, mods: p.mods, name: p.name, team: p.team });
        p.queue = [];
        p.lastInput = {};
        p.idle = 0;
      } else {
        slots.push({ id: s, alliance, station, robot: sl.robot, mods: sl.mods, name: sl.name || 'Bot', team: sl.team || 'BOT', bot: true });
        this.bots.push(new Bot(s));
      }
    }
    if (!slots.length) return this.sendError(this.players.get(this.host), 'Take a slot or add bots first');
    this.match = new Match({ slots, autoRamp: this.settings.autoRamp, officialRules: this.settings.officialRules });
    this.match.bots = this.bots;
    this.phase = 'match';
    for (const p of this.players.values()) this.sendStart(p);
    this.broadcastRoom();
    this.run();
  }

  sendStart(p) {
    p.send({ t: 'start', roster: this.match.roster(), you: this.slotOf(p.id), code: this.code });
  }

  run() {
    this.stop();
    let last = performance.now();
    let acc = 0;
    let n = 0;
    this.loop = setInterval(() => {
      const now = performance.now();
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (acc >= TICK) {
        acc -= TICK;
        this.tick(++n);
      }
    }, 1000 / 120);
  }

  tick(n) {
    const m = this.match;
    if (!m) return;
    for (const s of SLOT_IDS) {
      const sl = this.slots[s];
      if (sl?.type !== 'human') continue;
      const p = this.players.get(sl.pid);
      if (!p) continue;
      while (p.queue.length > MAX_QUEUE) p.queue.shift();
      if (p.queue.length) {
        p.lastInput = p.queue.shift();
        p.idle = 0;
      } else if (++p.idle > 20) p.lastInput = { seq: p.lastInput?.seq }; // tab hidden / lagging: stop the robot
      m.setInput(s, p.lastInput || {});
    }
    for (const b of this.bots) b.update(m, TICK);
    m.step(TICK);
    if (n % SNAP_EVERY === 0 || m.phase === 'done') {
      const snap = m.snapshot();
      const ev = m.drainEvents();
      const msg = JSON.stringify({ t: 'snap', s: snap, ev });
      for (const p of this.players.values()) p.sendRaw(msg);
    }
    if (m.phase === 'done') {
      this.stop();
      this.phase = 'results';
      this.lastResult = { result: m.result, score: m.score, roster: m.roster(), fouls: m.fouls };
      this.broadcast({ t: 'results', ...this.lastResult });
      this.broadcastRoom();
    }
  }

  stop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  toLobby() {
    this.stop();
    this.match = null;
    this.phase = 'lobby';
    // drop bot slots that replaced players who left
    for (const s of SLOT_IDS) if (this.slots[s]?.type === 'bot' && this.slots[s].name) this.slots[s] = null;
    this.broadcast({ t: 'lobby' });
    this.broadcastRoom();
  }

  view() {
    const slots = {};
    for (const s of SLOT_IDS) {
      const sl = this.slots[s];
      if (!sl) slots[s] = null;
      else if (sl.type === 'bot') slots[s] = { type: 'bot', robot: sl.robot, name: sl.name || 'Bot' };
      else {
        const p = this.players.get(sl.pid);
        slots[s] = p ? { type: 'human', pid: p.id, name: p.name, team: p.team, robot: p.robot, mods: effectiveMods(p.team, p.mods) } : null;
      }
    }
    const seated = new Set(SLOT_IDS.map((s) => this.slots[s]?.pid).filter(Boolean));
    return {
      code: this.code,
      host: this.host,
      phase: this.phase,
      settings: this.settings,
      isPublic: this.isPublic,
      slots,
      spectators: [...this.players.values()].filter((p) => !seated.has(p.id)).map((p) => ({ pid: p.id, name: p.name })),
    };
  }

  broadcastRoom() {
    this.broadcast({ t: 'room', room: this.view() });
  }
  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const p of this.players.values()) p.sendRaw(s);
  }
  sendChat(from, text) {
    this.broadcast({ t: 'chat', from: from ? from.name : null, text });
  }
  sendError(p, msg) {
    p?.send({ t: 'error', msg });
  }
}

function sanitizeInput(i) {
  const num = (v, lim = 1) => (Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);
  return {
    seq: Number.isInteger(i?.seq) ? i.seq : 0,
    mx: num(i?.mx),
    my: num(i?.my),
    rot: num(i?.rot),
    intake: !!i?.in,
    score: !!i?.sc,
    eject: !!i?.ej,
    align: !!i?.al,
    tongue: !!i?.tg,
    sp: typeof i?.sp === 'string' ? i.sp.slice(0, 6) : null,
    autoStow: i?.as !== false,
  };
}
