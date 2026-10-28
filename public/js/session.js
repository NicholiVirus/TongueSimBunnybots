// Sessions feed the renderer/HUD with interpolated match state.
//   LocalSession — runs the shared Match in the browser (offline practice).
//   NetSession   — talks to the server; predicts your own drivetrain, interpolates the rest.

import { Match, TICK, driveStep, collideRobotStatic, assistInput } from '/shared/sim.js';
import { Bot } from '/shared/bot.js';
import { getRobotConfig, randomMods } from '/shared/robots.js';

const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

function robotFromArr(e) {
  return { id: e[0], x: e[1], y: e[2], th: e[3], elev: e[4], held: e[5], flags: e[6], vx: e[7], vy: e[8], w: e[9], ack: e[10], elevTarget: e[11], rampWait: e[12] || 0 };
}
function pieceFromArr(e) {
  return { id: e[0], type: e[1] === 'k' ? 'cake' : 'carrot', st: e[2], x: e[3], y: e[4], z: e[5], th: e[6], roll: e[7] };
}

class Interp {
  constructor() {
    this.buf = [];
  }
  push(s) {
    this.buf.push(s);
    while (this.buf.length > 40) this.buf.shift();
  }
  get latest() {
    return this.buf[this.buf.length - 1];
  }
  sample(tk) {
    const b = this.buf;
    if (!b.length) return null;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].tk > tk) i--;
    const s1 = b[i];
    const s0 = i > 0 ? b[i - 1] : s1;
    const t = s1.tk === s0.tk ? 1 : Math.max(0, Math.min(1, (tk - s0.tk) / (s1.tk - s0.tk)));
    const robots = new Map();
    const r0 = new Map(s0.r.map((e) => [e[0], e]));
    for (const e of s1.r) {
      const a = r0.get(e[0]) || e;
      const r = robotFromArr(t > 0.5 ? e : a);
      r.x = lerp(a[1], e[1], t);
      r.y = lerp(a[2], e[2], t);
      r.th = lerpAngle(a[3], e[3], t);
      r.elev = lerp(a[4], e[4], t);
      robots.set(e[0], r);
    }
    const p0 = new Map(s0.p.map((e) => [e[0], e]));
    const pieces = [];
    for (const e of s1.p) {
      const a = p0.get(e[0]);
      const p = pieceFromArr(e);
      if (a) {
        p.x = lerp(a[3], e[3], t);
        p.y = lerp(a[4], e[4], t);
        p.z = lerp(a[5], e[5], t);
        p.th = lerpAngle(a[6], e[6], t);
        p.roll = lerp(a[7], e[7], t);
      }
      pieces.push(p);
    }
    return { robots, pieces, snap: s1 };
  }
}

const toSimInput = (i) => ({ seq: i.seq, mx: i.mx, my: i.my, rot: i.rot, intake: !!i.in, score: !!i.sc, eject: !!i.ej, align: !!i.al, tongue: !!i.tg, sp: i.sp || null, autoStow: i.as !== false });

// ------------------------------------------------------------------ offline
export class LocalSession {
  constructor({ alliance = 'red', station = 2, robot = 'team', mods, name = 'You', team = '', allies = 2, opps = 3, skill = 0.85, autoRamp = false, officialRules = false, bots }) {
    this.opts = { alliance, station, robot, mods, name, team, allies, opps, skill, autoRamp, officialRules, bots };
    this.local = true;
    this.reset();
  }

  reset() {
    const { alliance, station, robot, mods, name, team, allies, opps, skill } = this.opts;
    const other = alliance === 'red' ? 'blue' : 'red';
    const slots = [{ id: `${alliance}${station}`, alliance, station, robot, mods, name, team }];
    const pool = ['team', 'speedy', 'tank'];
    const allyStations = [1, 2, 3].filter((s) => s !== station).slice(0, allies);
    // per-bot robot + mechanisms from the practice menu; anything unset gets a random build (kept across restarts)
    const bots = (this.opts.bots ??= { ally: [], opp: [] });
    const cfg = (list, i, robot) => (list[i] ??= { robot, mods: randomMods() });
    allyStations.forEach((s, i) => {
      const c = cfg(bots.ally, i, pool[(i + 1) % 3]);
      slots.push({ id: `${alliance}${s}`, alliance, station: s, robot: c.robot, mods: c.mods, name: `Bot ${s}`, team: String(100 + s), bot: true });
    });
    [2, 1, 3].slice(0, opps).forEach((s, i) => {
      const c = cfg(bots.opp, i, pool[i % 3]);
      slots.push({ id: `${other}${s}`, alliance: other, station: s, robot: c.robot, mods: c.mods, name: `Bot ${s}`, team: String(900 + s), bot: true });
    });
    this.you = slots[0].id;
    this.match = new Match({ slots, autoRamp: this.opts.autoRamp, officialRules: this.opts.officialRules });
    this.bots = slots.filter((s) => s.bot).map((s) => new Bot(s.id, { skill }));
    this.match.bots = this.bots;
    this.roster = this.match.roster();
    this.interp = new Interp();
    this.interp.push(this.match.snapshot());
    this.events = [];
  }

  tick(inp) {
    const m = this.match;
    if (m.phase === 'done') return;
    m.setInput(this.you, toSimInput(inp));
    for (const b of this.bots) b.update(m, TICK);
    m.step(TICK);
    this.interp.push(m.snapshot());
    this.events.push(...m.drainEvents());
  }

  view(_now, alpha) {
    const latest = this.interp.latest;
    const v = this.interp.sample(latest.tk - 1 + alpha);
    return { ...v, snap: latest };
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  get result() {
    return this.match.phase === 'done' ? { result: this.match.result, score: this.match.score, roster: this.roster } : null;
  }
}

// ------------------------------------------------------------------ online
const INTERP_DELAY = 5; // ticks (~83 ms)

export class NetSession {
  constructor(net, start) {
    this.net = net;
    this.local = false;
    this.roster = start.roster;
    this.you = start.you;
    this.me = this.roster.find((r) => r.id === this.you) || null;
    this.cfg = this.me ? getRobotConfig(this.me.robot, this.me.mods) : null;
    this.interp = new Interp();
    this.events = [];
    this.seq = 0;
    this.pending = [];
    this.pred = null;
    this.off = { x: 0, y: 0, th: 0 };
    this.clock = null;
  }

  onSnap(msg) {
    const s = msg.s;
    this.interp.push(s);
    if (msg.ev?.length) this.events.push(...msg.ev);
    const localTk = (performance.now() / 1000) * 60;
    const off = s.tk - localTk;
    this.clock = this.clock === null || off > this.clock ? off : this.clock + (off - this.clock) * 0.02;
    if (this.you) {
      const e = s.r.find((q) => q[0] === this.you);
      if (e) this.reconcile(e, s);
    }
  }

  reconcile(e, s) {
    const base = { cfg: this.cfg, x: e[1], y: e[2], th: e[3], elev: e[4], vx: e[7], vy: e[8], w: e[9] };
    const ack = e[10];
    this.pending = this.pending.filter((p) => p.seq > ack);
    const en = (s.ph === 'auto' || s.ph === 'teleop') && !(e[6] & 32); // not while stunned
    for (const p of this.pending) {
      driveStep(base, assistInput(base, toSimInput(p.inp), this.me.alliance), TICK, en);
      collideRobotStatic(base);
    }
    if (this.pred) {
      const ex = this.pred.x + this.off.x - base.x;
      const ey = this.pred.y + this.off.y - base.y;
      const et = Math.atan2(Math.sin(this.pred.th + this.off.th - base.th), Math.cos(this.pred.th + this.off.th - base.th));
      if (Math.hypot(ex, ey) > 1.0) this.off = { x: 0, y: 0, th: 0 };
      else this.off = { x: ex, y: ey, th: et };
    }
    this.pred = base;
  }

  tick(inp) {
    inp.seq = ++this.seq;
    this.net.send({ t: 'in', i: [inp] });
    const latest = this.interp.latest;
    if (this.pred && latest) {
      const en = (latest.ph === 'auto' || latest.ph === 'teleop') && !((latest.r.find((q) => q[0] === this.you)?.[6] ?? 0) & 32);
      this.pred.elev = latest.r.find((q) => q[0] === this.you)?.[4] ?? this.pred.elev;
      driveStep(this.pred, assistInput(this.pred, toSimInput(inp), this.me.alliance), TICK, en);
      collideRobotStatic(this.pred);
      this.pending.push({ seq: inp.seq, inp });
      if (this.pending.length > 120) this.pending.shift();
    }
    const k = Math.exp(-TICK * 9);
    this.off.x *= k;
    this.off.y *= k;
    this.off.th *= k;
  }

  view(now) {
    const latest = this.interp.latest;
    if (!latest) return null;
    const tk = now * 60 + (this.clock ?? 0) - INTERP_DELAY;
    const v = this.interp.sample(tk);
    if (this.you && this.pred) {
      const me = v.robots.get(this.you);
      const le = latest.r.find((q) => q[0] === this.you);
      if (me && le) {
        Object.assign(me, robotFromArr(le));
        me.x = this.pred.x + this.off.x;
        me.y = this.pred.y + this.off.y;
        me.th = this.pred.th + this.off.th;
        me.vx = this.pred.vx;
        me.vy = this.pred.vy;
        me.w = this.pred.w;
      }
    }
    return { ...v, snap: latest };
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
