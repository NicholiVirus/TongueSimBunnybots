import { Match, TICK } from '../shared/sim.js';
import { Bot } from '../shared/bot.js';
import { ROBOTS, sanitizeMods, effectiveMods } from '../shared/robots.js';

export const SLOT_IDS = ['red1', 'red2', 'red3', 'blue1', 'blue2', 'blue3'];
const SNAP_EVERY = 2; // 60 Hz sim -> 30 Hz snapshots
const KEYFRAME_EVERY = 60; // full snapshot every 2 s (deltas in between)
const MAX_QUEUE = 8; // spare inputs per player before the server catches up (~133 ms)
const MAX_OWED = 30; // late inputs the server may stand in for (matches the client's 30-tick catch-up)

const clean = (s, n) =>
  String(s ?? '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, n);

export class Room {
  constructor(code, { isPublic = true, ranked = false, onEmpty, onResult } = {}) {
    this.code = code;
    this.isPublic = isPublic;
    this.ranked = ranked; // solo leaderboard run: nobody else joins, nothing can be changed
    this.onEmpty = onEmpty;
    this.onResult = onResult;
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
    if (this.ranked && msg.t !== 'in' && msg.t !== 'pause') return;
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
      case 'pause':
        // only a ranked solo run can be frozen (nobody else is playing in it)
        if (this.ranked && this.phase === 'match') this.setPaused(!!msg.on);
        break;
      case 'in':
        if (this.phase === 'match' && Array.isArray(msg.i)) {
          for (const inp of msg.i.slice(0, 8)) player.queue.push(sanitizeInput(inp));
          while (player.queue.length > MAX_OWED + MAX_QUEUE) {
            player.queue.shift();
            if (player.owed > 0) player.owed--;
          }
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
        p.owed = 0;
        p.filling = true;
      } else {
        slots.push({ id: s, alliance, station, robot: sl.robot, mods: sl.mods, name: sl.name || 'Bot', team: sl.team || 'BOT', bot: true });
        this.bots.push(new Bot(s));
      }
    }
    if (!slots.length) return this.sendError(this.players.get(this.host), 'Take a slot or add bots first');
    this.match = new Match({ slots, autoRamp: this.settings.autoRamp, officialRules: this.settings.officialRules, setup: !!this.setup });
    this.match.bots = this.bots;
    this.phase = 'match';
    for (const p of this.players.values()) this.sendStart(p);
    this.broadcastRoom();
    this.run();
  }

  sendStart(p) {
    // include a full snapshot so a late joiner can render before the next keyframe
    p.send({ t: 'start', roster: this.match.roster(), you: this.slotOf(p.id), code: this.code, snap: { ...this.match.snapshot(), kf: 1 } });
  }

  // Delta-encode a snapshot: pieces that haven't changed, and an unchanged score/inventory, are left
  // out (the client keeps the last copy). Every KEYFRAME_EVERY snapshots everything is sent.
  encodeSnapshot(snap) {
    const d = (this.delta ??= { pieces: new Map(), s: '', inv: '', n: 0 });
    const key = d.n++ % KEYFRAME_EVERY === 0;
    const out = { ...snap };
    const sJson = JSON.stringify(snap.s);
    const invJson = JSON.stringify(snap.inv);
    if (!key && sJson === d.s) delete out.s;
    if (!key && invJson === d.inv) delete out.inv;
    d.s = sJson;
    d.inv = invJson;
    const seen = new Map();
    const changed = [];
    for (const e of snap.p) {
      const sig = e.join(',');
      seen.set(e[0], sig);
      if (key || d.pieces.get(e[0]) !== sig) changed.push(e);
    }
    const removed = key ? [] : [...d.pieces.keys()].filter((id) => !seen.has(id));
    d.pieces = seen;
    out.p = changed;
    if (removed.length) out.pr = removed;
    if (key) out.kf = 1;
    return out;
  }

  setPaused(on) {
    if (on === !!this.paused) return;
    this.paused = on;
    if (!on) {
      for (const p of this.players.values()) {
        p.queue = []; // inputs sent while paused are stale
        p.owed = 0;
        p.filling = true;
      }
    }
  }

  run() {
    this.stop();
    this.paused = false;
    let last = performance.now();
    let acc = 0;
    let sinceSnap = 0;
    this.delta = null;
    this.loop = setInterval(() => {
      const now = performance.now();
      if (this.paused) acc = 0;
      else acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (acc >= TICK && this.match) {
        acc -= TICK;
        this.tick();
        sinceSnap++;
      }
      // at most ONE snapshot per timer callback: if the server fell behind and ran several ticks
      // at once, clients get one up-to-date snapshot instead of a burst of stale ones
      if (this.match && (sinceSnap >= SNAP_EVERY || this.match.phase === 'done')) {
        sinceSnap = 0;
        this.sendSnapshot();
      }
      if (this.match?.phase === 'done') this.finish();
    }, 1000 / 120);
  }

  // Input jitter buffer. Inputs are used one per tick on the client's own timeline. When the next one
  // is late the last input is repeated, and the late one is skipped once it shows up (the client has
  // already predicted it), so a late packet costs nothing while the driver holds the same keys. Each
  // new dry spell adds one tick of headroom; ten calm seconds that always had spare inputs remove one.
  nextInput(p) {
    p.owed ??= 0;
    p.calm ??= 0;
    p.minQ ??= Infinity;
    if (p.filling) {
      if (p.queue.length < 2) return p.lastInput || {};
      p.filling = false;
    }
    if (p.queue.length) {
      while (p.owed > 0 && p.queue.length > 1) {
        p.queue.shift();
        p.owed--;
      }
      p.lastInput = p.queue.shift();
      p.idle = 0;
      p.dry = false;
      p.minQ = Math.min(p.minQ, p.queue.length);
      if (p.queue.length > MAX_QUEUE) p.owed++; // way behind (e.g. after a client hitch): catch up a tick
      if (++p.calm >= 600) {
        if (p.minQ >= 2) p.owed++; // never ran low: drop a tick of input latency
        p.calm = 0;
        p.minQ = Infinity;
      }
    } else if (p.lastInput?.seq) {
      if (!p.dry) {
        p.dry = true; // this first repeated tick becomes extra headroom
        p.calm = 0;
        p.minQ = Infinity;
      } else p.owed = Math.min(p.owed + 1, MAX_OWED);
      if (++p.idle > 20) p.lastInput = { seq: p.lastInput.seq }; // tab hidden / disconnected: stop the robot
    }
    return p.lastInput || {};
  }

  sendSnapshot() {
    const m = this.match;
    const msg = JSON.stringify({ t: 'snap', s: this.encodeSnapshot(m.snapshot()), ev: m.drainEvents() });
    for (const p of this.players.values()) p.sendRaw(msg);
  }

  finish() {
    const m = this.match;
    this.stop();
    this.phase = 'results';
    this.lastResult = { result: m.result, score: m.score, roster: m.roster(), fouls: m.fouls };
    this.broadcast({ t: 'results', ...this.lastResult });
    this.broadcastRoom();
    this.onResult?.(this, m);
  }

  tick() {
    const m = this.match;
    if (!m || m.phase === 'done') return;
    for (const s of SLOT_IDS) {
      const sl = this.slots[s];
      if (sl?.type !== 'human') continue;
      const p = this.players.get(sl.pid);
      if (!p) continue;
      m.setInput(s, this.nextInput(p));
    }
    for (const b of this.bots) b.update(m, TICK);
    m.step(TICK);
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
      ranked: this.ranked,
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
