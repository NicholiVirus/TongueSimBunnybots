// Authoritative HARVEST HAVOC match simulation. Runs unchanged on the Node server
// (online play) and in the browser (offline practice). Fixed 60 Hz step.

import * as F from './field.js';
import { getRobotConfig, isOneAtATime, reloadsFromHopper, shelfSide, effectiveMods } from './robots.js';

export const TICK = 1 / 60;

const { PIECE } = F;
const PR = PIECE.radius;
const SUB = [-(PIECE.length / 2 - PR), 0, PIECE.length / 2 - PR]; // sub-circle offsets along the roller axis
const PIECE_I = PIECE.length ** 2 / 12 + PR ** 2 / 4; // inertia / mass
const GRAV = 9.81;
const HOLD_SPACING = 0.16;
export const TONGUE_TEAM = '611';
export const STUN_TEAM = '612';
export const STUN_TIME = 5;
export const LOAD_TIME = 0.45; // s for a separate elevator to take a piece from the hopper
export const RAMP_WAIT = 1; // s a robot must sit at the foot of the ramp before cakes roll
export const RAMP_GAP = 0.5; // s between cakes rolling down

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;

// ------------------------------------------------------------------ geometry helpers
export function robotBox(r) {
  return { cx: r.x, cy: r.y, hx: r.cfg.length / 2, hy: r.cfg.width / 2, th: r.th };
}
export function boxCorners(b) {
  const c = Math.cos(b.th);
  const s = Math.sin(b.th);
  const pts = [];
  for (const [sx, sy] of [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ]) {
    const lx = sx * b.hx;
    const ly = sy * b.hy;
    pts.push([b.cx + lx * c - ly * s, b.cy + lx * s + ly * c]);
  }
  return pts;
}

// Separating-axis test between two oriented boxes. Returns the push for `a` out of `b`.
export function obbOverlap(a, b) {
  const axes = [
    [Math.cos(a.th), Math.sin(a.th)],
    [-Math.sin(a.th), Math.cos(a.th)],
    [Math.cos(b.th), Math.sin(b.th)],
    [-Math.sin(b.th), Math.cos(b.th)],
  ];
  const ax = axes[0];
  const ay = axes[1];
  const bx = axes[2];
  const by = axes[3];
  const dx = a.cx - b.cx;
  const dy = a.cy - b.cy;
  let best = Infinity;
  let nx = 0;
  let ny = 0;
  for (const [ux, uy] of axes) {
    const ra = a.hx * Math.abs(ax[0] * ux + ax[1] * uy) + a.hy * Math.abs(ay[0] * ux + ay[1] * uy);
    const rb = b.hx * Math.abs(bx[0] * ux + bx[1] * uy) + b.hy * Math.abs(by[0] * ux + by[1] * uy);
    const d = dx * ux + dy * uy;
    const o = ra + rb - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) {
      best = o;
      const sg = d >= 0 ? 1 : -1;
      nx = ux * sg;
      ny = uy * sg;
    }
  }
  return { nx, ny, depth: best };
}

// Circle vs oriented box. Returns contact normal (out of the box) + depth + contact point.
function circleBox(px, py, rad, b) {
  const c = Math.cos(b.th);
  const s = Math.sin(b.th);
  const rx = px - b.cx;
  const ry = py - b.cy;
  const lx = rx * c + ry * s;
  const ly = -rx * s + ry * c;
  const qx = clamp(lx, -b.hx, b.hx);
  const qy = clamp(ly, -b.hy, b.hy);
  let dx = lx - qx;
  let dy = ly - qy;
  let d = Math.hypot(dx, dy);
  let depth;
  if (d > 1e-9) {
    if (d >= rad) return null;
    dx /= d;
    dy /= d;
    depth = rad - d;
  } else {
    // center inside the box: push out along the shallowest face
    const ox = b.hx - Math.abs(lx);
    const oy = b.hy - Math.abs(ly);
    if (ox < oy) {
      dx = Math.sign(lx) || 1;
      dy = 0;
      depth = ox + rad;
    } else {
      dx = 0;
      dy = Math.sign(ly) || 1;
      depth = oy + rad;
    }
  }
  return {
    nx: dx * c - dy * s,
    ny: dx * s + dy * c,
    depth,
    cx: b.cx + qx * c - qy * s,
    cy: b.cy + qx * s + qy * c,
  };
}

const STATIC = F.staticObstacles();

// ------------------------------------------------------------------ drivetrain (shared with client prediction)
export function driveStep(r, inp, dt, enabled = true) {
  const c = r.cfg;
  let mx = enabled ? inp.mx || 0 : 0;
  let my = enabled ? inp.my || 0 : 0;
  const m = Math.hypot(mx, my);
  if (m > 1) {
    mx /= m;
    my /= m;
  }
  // tall elevator = slower, gentler driving
  const e = c.elevator;
  // a separate elevator lifts one piece; a passthrough lifts the whole load (more top-heavy)
  const tall = clamp((r.elev - e.min) / Math.max(0.3, e.max - e.min), 0, 1) * (isOneAtATime(c.mods) ? 0.5 : 1);
  const vmax = c.maxSpeed * (1 - 0.45 * tall);
  const acc = c.accel * (1 - 0.35 * tall) * (enabled ? 1 : 1.6);
  const tvx = mx * vmax;
  const tvy = my * vmax;
  let dvx = tvx - r.vx;
  let dvy = tvy - r.vy;
  const dv = Math.hypot(dvx, dvy);
  const maxDv = acc * dt;
  if (dv > maxDv) {
    dvx *= maxDv / dv;
    dvy *= maxDv / dv;
  }
  r.vx += dvx;
  r.vy += dvy;
  const tw = (enabled ? clamp(inp.rot || 0, -1, 1) : 0) * c.maxOmega * (1 - 0.3 * tall);
  r.w += clamp(tw - r.w, -c.angAccel * dt, c.angAccel * dt);
  r.x += r.vx * dt;
  r.y += r.vy * dt;
  r.th = wrap(r.th + r.w * dt);
}

// ------------------------------------------------------------------ auto-align (shared with client prediction)
// Holding ALIGN steers the robot onto the nearest own scoring spot:
//  PANTRY — heading + distance are locked, the driver can only slide left/right (snaps to slot centers).
//  OVEN   — drives fully onto the nearest mouth (kitchen side, farm side or the tag face).
export function alignTarget(r, alliance) {
  const s = F.sideSign(alliance);
  const half = r.cfg.length / 2;
  const pb = F.pantryBox(alliance);
  const ob = F.ovenBox(alliance);
  const mouthX = (s * (F.OVEN.mouthX0 + F.OVEN.mouthX1)) / 2;
  const cands = [
    { kind: 'pantry', x: clamp(r.x, pb.x0 + 0.2, pb.x1 - 0.2), y: F.PANTRY.yFront - half - 0.01, th: shelfSide(r.cfg.mods) > 0 ? Math.PI / 2 : -Math.PI / 2 },
    { kind: 'oven', x: mouthX, y: ob.y1 + half + 0.02, th: -Math.PI / 2 },
    { kind: 'oven', x: mouthX, y: ob.y0 - half - 0.02, th: Math.PI / 2 },
    { kind: 'oven', x: s > 0 ? ob.x0 - half - 0.02 : ob.x1 + half + 0.02, y: F.OVEN.yc, th: s > 0 ? 0 : Math.PI },
    // DEPOT chutes in our FARM: park right under the 23" mouth, hopper toward the wall
    ...F.depotChutes(alliance).map((c) => ({ kind: 'depot', x: c.x + c.dx * (half + 0.05), y: c.y + c.dy * (half + 0.05), th: Math.atan2(-c.dy, -c.dx) })),
  ];
  let best = null;
  let bd = 2.6;
  for (const c of cands) {
    const d = Math.hypot(c.x - r.x, c.y - r.y);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

export function assistInput(r, inp, alliance) {
  if (!inp.align) return inp;
  const t = alignTarget(r, alliance);
  if (!t) return inp;
  const c = r.cfg;
  const toCmd = (err, gain) => clamp((err * gain) / c.maxSpeed, -1, 1);
  const out = { ...inp, rot: clamp((wrap(t.th - r.th) * 4) / c.maxOmega, -1, 1) };
  if (t.kind === 'pantry') {
    // no grid on the shelf: the driver slides freely and places wherever there's room
    out.mx = clamp(inp.mx || 0, -1, 1) * 0.6;
    out.my = toCmd(t.y - r.y, 3.5);
  } else {
    out.mx = toCmd(t.x - r.x, 3.5);
    out.my = toCmd(t.y - r.y, 3.5);
  }
  return out;
}

// PANTRY shelves have no slots: a piece fits anywhere it doesn't overlap another (5 fit across).
// Returns the closest valid center to `wantX` within `tol`, or null.
export function shelfFit(xs, wantX, alliance, tol = Infinity) {
  const pb = F.pantryBox(alliance);
  const L = PIECE.length;
  const lo = pb.x0 + L / 2;
  const hi = pb.x1 - L / 2;
  const cands = [clamp(wantX, lo, hi)];
  for (const o of xs) cands.push(o + L + 1e-4, o - L - 1e-4);
  let best = null;
  let bd = tol;
  for (const c of cands) {
    if (c < lo - 1e-6 || c > hi + 1e-6) continue;
    if (xs.some((o) => Math.abs(o - c) < L - 1e-3)) continue;
    const d = Math.abs(c - wantX);
    if (d <= bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

export function collideRobotStatic(r) {
  let hit = false;
  for (let iter = 0; iter < 2; iter++) {
    const rb = robotBox(r);
    for (const o of STATIC) {
      const m = obbOverlap(rb, o);
      if (!m) continue;
      hit = true;
      r.x += m.nx * m.depth;
      r.y += m.ny * m.depth;
      rb.cx = r.x;
      rb.cy = r.y;
      const vn = r.vx * m.nx + r.vy * m.ny;
      if (vn < 0) {
        r.vx -= vn * m.nx;
        r.vy -= vn * m.ny;
      }
    }
  }
  return hit;
}

// ------------------------------------------------------------------ the match
let nextPieceId = 1;

export class Match {
  /**
   * @param {object} opts
   * @param {Array<{id:string, alliance:'red'|'blue', station:number, robot:string, name?:string, team?:string, bot?:boolean}>} opts.slots
   */
  constructor({ slots, preload = F.PRELOAD_PER_ROBOT, autoRamp = false } = {}) {
    this.autoRamp = autoRamp; // true: cakes roll down as soon as they're ready, caught or not
    this.time = 0; // seconds since the match was created
    this.phase = 'countdown';
    this.phaseTime = 0;
    this.matchTime = 0; // seconds since AUTO started
    this.robots = [];
    this.pieces = [];
    this.events = [];
    this.fouls = [];
    this.foulCooldown = new Map();
    this.result = null;
    this.tick = 0;

    for (const s of slots) {
      const cfg = getRobotConfig(s.robot, effectiveMods(s.team, s.mods));
      const p = F.startPose(s.alliance, s.station);
      this.robots.push({
        id: s.id,
        alliance: s.alliance,
        station: s.station,
        name: s.name || `Robot ${s.station}`,
        team: String(s.team || ''),
        bot: !!s.bot,
        robot: cfg.id,
        cfg,
        x: p.x,
        y: p.y,
        th: p.th,
        vx: 0,
        vy: 0,
        w: 0,
        elev: cfg.elevator.min,
        elevTarget: 'stow',
        held: [],
        intake: false,
        input: { mx: 0, my: 0, rot: 0 },
        lastScore: -9,
        prevEject: false,
        taxi: false,
        parked: false,
        ack: 0,
      });
    }

    // inventories (off-field pieces), per alliance
    const preloads = { red: 0, blue: 0 };
    this.inv = {};
    for (const a of F.ALLIANCES) {
      this.inv[a] = {
        depotCarrots: 0, // waiting behind this alliance's DEPOT (in its FARM)
        cakeBank: F.CAKES_AT_OPPOSING_DEPOT, // this alliance's cakes, stored at the opposing depot
        ovenCarrots: 0, // oven-scored carrots waiting to be traded
        rampCakes: 0, // cakes held by the RAMP human player
        tradeTimer: 0,
        rampTimer: 0,
        chuteTimers: [0, 0],
      };
    }
    for (const r of this.robots) {
      for (let i = 0; i < preload; i++) {
        const pc = this.addPiece('carrot', r.x, r.y, 0, 'held');
        pc.holder = r.id;
        r.held.push(pc.id);
        preloads[r.alliance]++;
      }
    }
    for (const a of F.ALLIANCES) {
      this.inv[a].depotCarrots = F.CARROTS_PER_ALLIANCE - F.PRESTAGED_CARROTS - preloads[a];
    }

    // prestaged carrots (5 per side) and one cake on each table corner
    for (const a of F.ALLIANCES) {
      const s = F.sideSign(a);
      for (const spot of F.PRESTAGED_CARROT_SPOTS) this.addPiece('carrot', spot.x * s, spot.y, Math.PI / 2, 'floor');
      const cake = this.addPiece('cake', F.TABLE_CAKE_SPOT.x * s, F.TABLE_CAKE_SPOT.y, 0, 'table');
      cake.z = F.TABLE.topZ;
    }

    this.pantry = {};
    for (const a of F.ALLIANCES) this.pantry[a] = [[], [], []]; // piece ids per shelf
    this.score = { red: emptyBreakdown(), blue: emptyBreakdown() };
  }

  addPiece(type, x, y, th, st) {
    const p = { id: nextPieceId++, type, st, x, y, z: 0, th, roll: 0, vx: 0, vy: 0, vz: 0, w: 0, holder: null, anim: null };
    this.pieces.push(p);
    return p;
  }

  robotById(id) {
    return this.robots.find((r) => r.id === id);
  }

  setInput(id, inp) {
    const r = this.robotById(id);
    if (!r) return;
    r.input = inp;
    if (inp.seq) r.ack = inp.seq;
  }

  get enabled() {
    return this.phase === 'auto' || this.phase === 'teleop';
  }
  get timeLeft() {
    if (this.phase === 'countdown') return F.MATCH_LENGTH;
    if (this.phase === 'auto' || this.phase === 'teleop') return Math.max(0, F.MATCH_LENGTH - this.matchTime);
    return 0;
  }
  get isEndgame() {
    return this.phase === 'teleop' && this.timeLeft <= F.TIMING.endgame;
  }

  emit(e) {
    this.events.push({ t: r2(this.matchTime), ...e });
  }

  // ---------------------------------------------------------------- main step
  step(dt = TICK) {
    this.tick++;
    this.time += dt;
    this.phaseTime += dt;
    this.updatePhase(dt);
    const en = this.enabled;

    for (const r of this.robots) this.updateRobot(r, dt, en);
    this.collideRobots();
    this.updatePieces(dt);
    this.updateHumanPlayers(dt);
    if (en) this.checkRules();
    this.recomputeScore();
    if (this.tick % 600 === 0) this.compact();
  }

  updatePhase(dt) {
    if (this.phase === 'countdown' && this.phaseTime >= F.TIMING.countdown) this.setPhase('auto');
    if (this.phase === 'auto' || this.phase === 'teleop') {
      const before = this.timeLeft;
      this.matchTime += dt;
      if (this.phase === 'auto' && this.matchTime >= F.TIMING.auto) this.setPhase('teleop');
      if (before > F.TIMING.endgame && this.timeLeft <= F.TIMING.endgame && this.phase === 'teleop') this.emit({ type: 'endgame' });
      if (this.matchTime >= F.MATCH_LENGTH) this.setPhase('post');
    }
    if (this.phase === 'post' && this.phaseTime >= F.TIMING.post) {
      this.scoreEndgame();
      this.setPhase('done');
    }
  }

  setPhase(ph) {
    this.phase = ph;
    this.phaseTime = 0;
    this.emit({ type: 'phase', phase: ph });
  }

  // ---------------------------------------------------------------- robots
  updateRobot(r, dt, en) {
    const inp = r.input || {};
    const e = r.cfg.elevator;
    if (r.stunUntil > this.time) en = false; // hit by team 612: frozen

    // TEAM 611 easter egg: K deploys a tongue on the end effector
    if (en && inp.tongue && !r.prevTongue) {
      if (r.team === TONGUE_TEAM) {
        r.tongue = !r.tongue;
        this.emit({ type: 'hint', robot: r.id, msg: r.tongue ? '👅 Tongue out — slide carrots with A/D' : 'Tongue in' });
      } else this.denied(r, `Only team ${TONGUE_TEAM} has a tongue 👅`);
    }
    r.prevTongue = !!inp.tongue;
    if (en && inp.sp && e.setpoints[inp.sp] !== undefined && inp.sp !== r.elevTarget) {
      if (e.setpoints[inp.sp] > e.max + 1e-6) this.denied(r, `This robot's elevator can't reach ${inp.sp.toUpperCase()}`);
      else r.elevTarget = inp.sp;
    }
    const target = clamp(e.setpoints[r.elevTarget] ?? e.min, e.min, e.max);
    r.elev += clamp(target - r.elev, -e.speed * dt, e.speed * dt);
    const mods = r.cfg.mods;
    r.intake = en && !!inp.intake && r.held.length < F.MAX_HELD && mods.ground;
    if (en && inp.intake && !mods.ground) this.denied(r, 'This robot has no ground intake — use the DEPOT or RAMP');

    // separate hopper + elevator: the carriage carries one piece and reloads at the bottom
    if (mods.mech === 'elevIntake') {
      // the elevator is the ground intake: it holds one piece (always the last in `held`)
      if (r.carriagePiece && !r.held.includes(r.carriagePiece)) r.carriagePiece = null;
      r.carriage = r.carriagePiece ? 1 : 0;
      if (r.intake && r.carriagePiece) {
        r.intake = false;
        if (inp.intake) this.denied(r, 'Elevator already holds a piece — score it on L1 or in the OVEN');
      }
    }
    if (reloadsFromHopper(mods)) {
      r.carriage = Math.min(r.carriage || 0, r.held.length);
      if (!r.carriage && r.held.length && r.elev <= e.min + 0.04) {
        r.loadT = (r.loadT || 0) + dt;
        if (r.loadT >= LOAD_TIME) {
          r.carriage = 1;
          r.loadT = 0;
          if (r.returnTo && r.input.autoStow !== false) r.elevTarget = r.returnTo; // back up to the last shelf
          r.returnTo = null;
        }
      } else r.loadT = 0;
    }

    if (en && inp.align && !alignTarget(r, r.alliance)) this.denied(r, 'Nothing to align to — get near your PANTRY, OVEN or DEPOT');
    driveStep(r, assistInput(r, inp, r.alliance), dt, en);
    collideRobotStatic(r);

    if (!en) return;
    if (inp.score && this.time - r.lastScore >= r.cfg.scoreCooldown && r.held.length) this.tryScore(r);
    if (inp.eject && !r.prevEject && r.held.length) this.eject(r);
    r.prevEject = !!inp.eject;
    if (r.tongue) this.tongueSlide(r, dt);
  }

  // Pieces in front of the tongue get dragged sideways with the robot: scored pieces slide along the
  // shelf at the tongue's height (pushing neighbours, never off the ends), floor pieces get swept.
  tongueSlide(r, dt) {
    const ss = shelfSide(r.cfg.mods);
    const fx = Math.cos(r.th) * ss;
    const fy = Math.sin(r.th) * ss;
    const lx = -fy;
    const ly = fx;
    const half = r.cfg.length / 2;
    const reachW = r.cfg.width / 2 + 0.15;
    const vLat = r.vx * lx + r.vy * ly;
    // floor
    for (const p of this.pieces) {
      if (p.st !== 'floor' || p.z > 0.3 || r.elev > 0.5) continue;
      const ox = p.x - r.x;
      const oy = p.y - r.y;
      const fwd = ox * fx + oy * fy;
      const lat = ox * lx + oy * ly;
      if (fwd < half - 0.05 || fwd > half + 0.4 || Math.abs(lat) > reachW) continue;
      const pl = p.vx * lx + p.vy * ly;
      p.vx += (vLat - pl) * lx;
      p.vy += (vLat - pl) * ly;
    }
    // shelf (own PANTRY, facing it, tongue level with a shelf)
    const tipY = r.y + fy * half;
    if (fy < 0.8 || tipY < F.PANTRY.yFront - 0.3 || Math.abs(vLat) < 0.02) return;
    const level = F.PANTRY.shelfZ.findIndex((z) => Math.abs(r.elev - z) < 0.15);
    if (level < 0) return;
    const pb = F.pantryBox(r.alliance);
    const L = PIECE.length;
    const lo = pb.x0 + L / 2;
    const hi = pb.x1 - L / 2;
    const ps = this.pantry[r.alliance][level]
      .map((id) => this.pieces.find((q) => q.id === id))
      .filter((p) => p.st === 'pantry')
      .sort((a, b) => a.x - b.x);
    if (!ps.length) return;
    const dx = r.vx * dt; // shelf runs along field X
    const xs = ps.map((p) => p.x);
    ps.forEach((p, i) => {
      if (Math.abs(p.x - r.x) < reachW) xs[i] += dx;
    });
    if (dx > 0) {
      for (let i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + L);
      for (let i = xs.length - 1; i >= 0; i--) xs[i] = Math.min(xs[i], i === xs.length - 1 ? hi : xs[i + 1] - L);
    } else {
      for (let i = xs.length - 2; i >= 0; i--) xs[i] = Math.min(xs[i], xs[i + 1] - L);
      for (let i = 0; i < xs.length; i++) xs[i] = Math.max(xs[i], i === 0 ? lo : xs[i - 1] + L);
    }
    ps.forEach((p, i) => (p.x = xs[i]));
  }

  collideRobots() {
    const rs = this.robots;
    this.contacts = [];
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < rs.length; i++) {
        for (let j = i + 1; j < rs.length; j++) {
          const a = rs[i];
          const b = rs[j];
          const reach = (a.cfg.length + a.cfg.width + b.cfg.length + b.cfg.width) / 2.6;
          if (Math.abs(a.x - b.x) > reach || Math.abs(a.y - b.y) > reach) continue;
          if (iter === 0 && obbOverlap(inflate(robotBox(a), 0.03), robotBox(b))) {
            this.contacts.push([a, b]);
            this.stunCheck(a, b);
            this.stunCheck(b, a);
          }
          const m = obbOverlap(robotBox(a), robotBox(b));
          if (!m) continue;
          const ia = 1 / a.cfg.mass;
          const ib = 1 / b.cfg.mass;
          const k = m.depth / (ia + ib);
          a.x += m.nx * k * ia;
          a.y += m.ny * k * ia;
          b.x -= m.nx * k * ib;
          b.y -= m.ny * k * ib;
          const vn = (a.vx - b.vx) * m.nx + (a.vy - b.vy) * m.ny;
          if (vn < 0) {
            const jimp = (-(1 + 0.1) * vn) / (ia + ib);
            a.vx += jimp * ia * m.nx;
            a.vy += jimp * ia * m.ny;
            b.vx -= jimp * ib * m.nx;
            b.vy -= jimp * ib * m.ny;
            // a little spin from off-center hits
            a.w *= 0.9;
            b.w *= 0.9;
          }
        }
      }
      for (const r of rs) collideRobotStatic(r);
    }
  }

  // TEAM 612 easter egg: ramming another robot freezes it for STUN_TIME s (then a short immunity)
  stunCheck(hitter, victim) {
    if (hitter.team !== STUN_TEAM || victim.team === STUN_TEAM || !this.enabled) return;
    if (hitter.stunUntil > this.time || (victim.stunImmuneUntil || 0) > this.time) return;
    victim.stunUntil = this.time + STUN_TIME;
    victim.stunImmuneUntil = this.time + STUN_TIME + 2;
    victim.intake = false;
    this.emit({ type: 'stun', robot: victim.id, by: hitter.id });
  }

  frontPoint(r, extra = 0) {
    const d = r.cfg.length / 2 + extra;
    return [r.x + Math.cos(r.th) * d, r.y + Math.sin(r.th) * d];
  }

  heldWorldPos(r, i) {
    const back = -0.12;
    return {
      x: r.x + Math.cos(r.th) * back,
      y: r.y + Math.sin(r.th) * back,
      z: r.elev + i * HOLD_SPACING,
      th: r.th + Math.PI / 2,
    };
  }

  tryScore(r) {
    const a = r.alliance;
    const e = r.cfg.elevator;
    const [fx, fy] = this.frontPoint(r);
    const fwdX = Math.cos(r.th);
    const fwdY = Math.sin(r.th);

    // ---- PANTRY (own alliance only — G16)
    const pb = F.pantryBox(a);
    // the elevator side faces the shelves (the back, for a hopper-front / elevator-back robot)
    const ss = shelfSide(r.cfg.mods);
    const ex = r.x + fwdX * (r.cfg.length / 2) * ss;
    const ey = r.y + fwdY * (r.cfg.length / 2) * ss;
    const facingPantry = fwdY * ss > Math.cos((32 * Math.PI) / 180);
    if (facingPantry && ey > F.PANTRY.yFront - 0.22 && ex > pb.x0 + 0.05 && ex < pb.x1 - 0.05) {
      let level = -1;
      // only score once the elevator has arrived at the shelf it was sent to (not while passing others)
      ['l1', 'l2', 'l3'].forEach((k, i) => {
        if (r.elevTarget === k && Math.abs(r.elev - e.setpoints[k]) <= e.tolerance) level = i;
      });
      if (level < 0) return this.denied(r, 'Raise the elevator to L1/L2/L3');
      if (isOneAtATime(r.cfg.mods) && !r.carriage) return this.denied(r, 'Carriage empty — stow (R) to reload from the hopper');
      const shelf = this.pantry[a][level];
      const xs = this.shelfXs(a, level);
      if (shelfFit(xs, ex, a) === null) return this.denied(r, `LEVEL ${level + 1} is full`);
      const px = shelfFit(xs, ex, a, 0.12);
      if (px === null) return this.denied(r, 'No room there — slide left/right to a gap');
      const p = r.cfg.mods.mech === 'elevIntake' ? this.popHeldId(r, r.carriagePiece) : this.popHeld(r, 'cake');
      shelf.push(p.id);
      const to = { x: px, y: (F.PANTRY.yFront + F.PANTRY.yBack) / 2 + 0.005, z: F.PANTRY.shelfZ[level], th: 0 };
      this.startPlace(p, r, to, 'pantry', 0.22);
      if (reloadsFromHopper(r.cfg.mods)) {
        r.carriage = 0;
        if (r.held.length && r.input.autoStow !== false) {
          r.returnTo = r.elevTarget; // drop to reload, then come back to this shelf
          r.elevTarget = 'stow';
        }
      }
      p.owner = a;
      p.level = level;
      const pts = F.POINTS.pantry[p.type][level];
      this.emit({ type: 'score', alliance: a, pts, label: `L${level + 1} ${p.type === 'cake' ? 'CAKE' : 'CARROT'}`, x: to.x, y: to.y, z: to.z, robot: r.id });
      r.lastScore = this.time;
      this.afterScore(r);
      return true;
    }

    // ---- OVEN (own alliance only)
    if (r.elev <= e.setpoints.oven + e.tolerance) {
      const ob = F.ovenBox(a);
      const s = F.sideSign(a);
      const mx0 = Math.min(F.OVEN.mouthX0 * s, F.OVEN.mouthX1 * s);
      const mx1 = Math.max(F.OVEN.mouthX0 * s, F.OVEN.mouthX1 * s);
      const frontX = s > 0 ? ob.x0 : ob.x1;
      const faces = [
        // kitchen-side mouth, farm-side mouth, front (tag) face
        { ok: fx > mx0 - 0.1 && fx < mx1 + 0.1 && Math.abs(fy - ob.y1) < 0.25, n: [0, -1] },
        { ok: fx > mx0 - 0.1 && fx < mx1 + 0.1 && Math.abs(fy - ob.y0) < 0.25, n: [0, 1] },
        { ok: Math.abs(fx - frontX) < 0.25 && fy > ob.y0 - 0.05 && fy < ob.y1 + 0.05, n: [s, 0] },
      ];
      for (const f of faces) {
        if (!f.ok) continue;
        if (fwdX * f.n[0] + fwdY * f.n[1] < Math.cos((40 * Math.PI) / 180)) continue;
        // a 526 hopper dumps its own pieces first; the elevator's piece goes last
        const hopper = r.cfg.mods.mech === 'elevIntake' ? r.held.filter((id) => id !== r.carriagePiece) : null;
        const p = hopper?.length ? this.popHeldId(r, hopper.find((id) => this.pieces.find((q) => q.id === id)?.type === 'carrot') ?? hopper[hopper.length - 1]) : this.popHeld(r, 'carrot');
        const to = { x: (mx0 + mx1) / 2, y: F.OVEN.yc, z: 0.2, th: 0 };
        this.startPlace(p, r, to, 'oven', 0.3);
        p.owner = a;
        const pts = F.POINTS.oven[p.type];
        this.emit({ type: 'score', alliance: a, pts, label: `OVEN ${p.type === 'cake' ? 'CAKE' : 'CARROT'}`, x: to.x, y: to.y, z: 0.6, robot: r.id });
        if (p.type === 'carrot') this.score[a].ovenCarrot++;
        else this.score[a].ovenCake++;
        r.lastScore = this.time;
        this.afterScore(r);
        return true;
      }
    }
    return false;
  }

  denied(r, msg) {
    if (this.time - (r.lastDenied || -9) > 1.2) {
      r.lastDenied = this.time;
      this.emit({ type: 'hint', robot: r.id, msg });
    }
    return false;
  }

  afterScore(r) {
    if (r.held.length === 0 && r.input.autoStow !== false) r.elevTarget = 'stow';
  }

  // final x of every piece on a shelf (including ones still sliding into place)
  shelfXs(a, level) {
    return this.pantry[a][level].map((id) => {
      const p = this.pieces.find((q) => q.id === id);
      return p.anim ? p.anim.to.x : p.x;
    });
  }

  popHeldId(r, id) {
    const i = r.held.indexOf(id);
    const [pid] = r.held.splice(i < 0 ? r.held.length - 1 : i, 1);
    if (pid === r.carriagePiece) r.carriagePiece = null;
    const p = this.pieces.find((q) => q.id === pid);
    Object.assign(p, this.heldWorldPos(r, r.held.length));
    p.holder = null;
    return p;
  }

  // a 526 hopper fills underneath the elevator's piece, which stays last in `held`
  addHeld(r, id) {
    if (r.cfg.mods.mech === 'elevIntake' && r.carriagePiece) r.held.splice(r.held.length - 1, 0, id);
    else r.held.push(id);
  }

  // The mechanism hands over the preferred piece type first (cakes to the pantry, carrots to the oven).
  popHeld(r, prefer) {
    let idx = r.held.length - 1;
    if (prefer) {
      for (let i = r.held.length - 1; i >= 0; i--) {
        if (this.pieces.find((q) => q.id === r.held[i])?.type === prefer) {
          idx = i;
          break;
        }
      }
    }
    const id = r.held.splice(idx, 1)[0];
    const p = this.pieces.find((q) => q.id === id);
    const hp = this.heldWorldPos(r, r.held.length);
    Object.assign(p, hp);
    p.holder = null;
    return p;
  }

  startPlace(p, r, to, dest, dur) {
    p.st = 'place';
    p.anim = { fx: p.x, fy: p.y, fz: p.z, fth: p.th, to, dest, t: 0, dur };
  }

  eject(r) {
    const p = this.popHeld(r);
    const [fx, fy] = this.frontPoint(r, PR + 0.06);
    p.x = fx;
    p.y = fy;
    p.z = Math.max(0, r.elev - 0.05);
    p.th = r.th + Math.PI / 2;
    p.vx = r.vx + Math.cos(r.th) * 0.9;
    p.vy = r.vy + Math.sin(r.th) * 0.9;
    p.vz = 0;
    p.w = 0;
    p.st = 'floor';
    // make sure it's not inside a wall/element
    this.resolvePieceStatic(p);
    if (r.held.length === 0 && r.input.autoStow !== false) r.elevTarget = 'stow';
  }

  // ---------------------------------------------------------------- pieces
  updatePieces(dt) {
    const floor = [];
    for (const p of this.pieces) {
      if (p.st === 'floor') floor.push(p);
      else if (p.st === 'place' || p.st === 'chute' || p.st === 'ramp') this.updateAnim(p, dt);
    }

    for (const p of floor) {
      // gravity for dropped pieces
      if (p.z > 0 || p.vz > 0) {
        p.vz -= GRAV * dt;
        p.z += p.vz * dt;
        if (p.z <= 0) {
          p.z = 0;
          p.vz = 0;
        }
      }
      // anisotropic carpet friction: rollers roll sideways, skid along their axis
      const ax = Math.cos(p.th);
      const ay = Math.sin(p.th);
      let va = p.vx * ax + p.vy * ay;
      let vp = -p.vx * ay + p.vy * ax;
      if (p.z < 0.02) {
        va = towardZero(va, 6.0 * dt);
        vp = towardZero(vp, 1.1 * dt) * (1 - 0.6 * dt);
        p.w = towardZero(p.w, 5 * dt) * (1 - 1.5 * dt);
      }
      p.vx = va * ax - vp * ay;
      p.vy = va * ay + vp * ax;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.th += p.w * dt;
      p.roll += (vp / PR) * dt;
    }

    // pieces vs robots (+ intake)
    for (const r of this.robots) {
      const rb = robotBox(r);
      const reach = r.cfg.length / 2 + r.cfg.intakeReach + PIECE.length;
      for (const p of floor) {
        if (p.st !== 'floor') continue;
        if (Math.abs(p.x - r.x) > reach || Math.abs(p.y - r.y) > reach) continue;
        if (r.intake && p.z < 0.35 && this.inIntake(r, p)) {
          this.collect(r, p);
          continue;
        }
        if (p.z > 0.3) continue;
        this.pushPieceByBox(p, rb, r);
      }
      if (r.intake) this.intakeFromTable(r);
    }

    // pieces vs pieces
    for (let i = 0; i < floor.length; i++) {
      const a = floor[i];
      if (a.st !== 'floor') continue;
      for (let j = i + 1; j < floor.length; j++) {
        const b = floor[j];
        if (b.st !== 'floor') continue;
        if (Math.abs(a.x - b.x) > PIECE.length || Math.abs(a.y - b.y) > PIECE.length) continue;
        if (Math.abs(a.z - b.z) > PR * 2) continue;
        this.collidePieces(a, b);
      }
    }

    for (const p of floor) if (p.st === 'floor') this.resolvePieceStatic(p);
  }

  updateAnim(p, dt) {
    const an = p.anim;
    an.t += dt;
    const u = clamp(an.t / an.dur, 0, 1);
    const k = u * u * (3 - 2 * u);
    if (p.st === 'ramp') {
      // slide down the big ramp on top of the oven
      p.x = an.fx + (an.to.x - an.fx) * u;
      p.y = an.fy;
      p.z = an.fz + (an.to.z - an.fz) * u;
      p.roll += ((an.to.x - an.fx) / an.dur / PR) * dt * Math.sign(an.to.x - an.fx);
    } else {
      p.x = an.fx + (an.to.x - an.fx) * k;
      p.y = an.fy + (an.to.y - an.fy) * k;
      p.z = an.fz + (an.to.z - an.fz) * k + (p.st === 'chute' ? 0 : Math.sin(Math.PI * u) * 0.08);
      p.th = an.fth + wrap(an.to.th - an.fth) * k;
    }
    if (u < 1) return;

    if (p.st === 'place' && an.dest === 'pantry') {
      p.st = 'pantry';
      p.anim = null;
    } else if (p.st === 'place' && an.dest === 'oven') {
      // rolls down the little ramp to the RAMP human player
      p.st = 'gone';
      p.anim = null;
      const inv = this.inv[p.owner];
      if (p.type === 'carrot') inv.ovenCarrots++;
      else inv.rampCakes++; // cakes stay with the RAMP human player
    } else if (p.st === 'chute') {
      const r = an.robot && this.robotById(an.robot);
      if (r && r.held.length < F.MAX_HELD && this.inCatchZone(r, an.chute)) {
        p.st = 'held';
        p.holder = r.id;
        p.anim = null;
        this.addHeld(r, p.id);
        this.emit({ type: 'feed', robot: r.id });
      } else {
        const c = an.chute;
        p.st = 'floor';
        p.anim = null;
        p.x = c.x + c.dx * 0.25;
        p.y = c.y + c.dy * 0.25;
        p.z = F.DEPOT.mouthZ;
        p.vx = c.dx * 1.4;
        p.vy = c.dy * 1.4;
        p.th = Math.atan2(c.dy, c.dx) + Math.PI / 2;
      }
    } else if (p.st === 'ramp') {
      const r = an.robot && this.robotById(an.robot);
      if (r && r.held.length < F.MAX_HELD && this.inRampCatch(r)) {
        p.st = 'held';
        p.holder = r.id;
        p.anim = null;
        this.addHeld(r, p.id);
        this.emit({ type: 'feed', robot: r.id, piece: 'cake' });
        return;
      }
      p.st = 'floor';
      const dir = Math.sign(an.to.x - an.fx);
      p.vx = dir * 1.7;
      p.vy = 0;
      p.vz = 0;
      p.anim = null;
    }
  }

  inIntake(r, p) {
    const c = Math.cos(r.th);
    const s = Math.sin(r.th);
    const half = r.cfg.length / 2;
    // the roller must be roughly parallel to the intake (within ~65°)
    if (Math.abs(Math.sin(p.th - r.th)) < 0.42) return false;
    for (const o of SUB) {
      const px = p.x + Math.cos(p.th) * o - r.x;
      const py = p.y + Math.sin(p.th) * o - r.y;
      const lx = px * c + py * s;
      const ly = -px * s + py * c;
      if (lx > half - 0.1 && lx < half + r.cfg.intakeReach && Math.abs(ly) < r.cfg.intakeWidth / 2) return true;
    }
    return false;
  }

  intakeFromTable(r) {
    for (const p of this.pieces) {
      if (p.st !== 'table') continue;
      if (Math.hypot(p.x - r.x, p.y - r.y) > r.cfg.length / 2 + 0.6) continue;
      // reach over the 4" table barrier — piece just has to be in front of the intake
      const c = Math.cos(r.th);
      const s = Math.sin(r.th);
      const lx = (p.x - r.x) * c + (p.y - r.y) * s;
      const ly = -(p.x - r.x) * s + (p.y - r.y) * c;
      if (lx > r.cfg.length / 2 - 0.05 && lx < r.cfg.length / 2 + r.cfg.intakeReach + 0.25 && Math.abs(ly) < r.cfg.intakeWidth / 2 + 0.1) {
        this.collect(r, p);
        return;
      }
    }
  }

  collect(r, p) {
    if (r.held.length >= F.MAX_HELD) return;
    p.st = 'held';
    p.holder = r.id;
    p.vx = p.vy = p.vz = p.w = 0;
    r.held.push(p.id);
    if (r.cfg.mods.mech === 'elevIntake') r.carriagePiece = p.id; // ground pickups go onto the elevator
    if (r.held.length >= F.MAX_HELD) r.intake = false;
    this.emit({ type: 'intake', robot: r.id, piece: p.type });
  }

  pushPieceByBox(p, b, r) {
    const ax = Math.cos(p.th);
    const ay = Math.sin(p.th);
    for (const o of SUB) {
      const sx = p.x + ax * o;
      const sy = p.y + ay * o;
      const h = circleBox(sx, sy, PR, b);
      if (!h) continue;
      p.x += h.nx * h.depth;
      p.y += h.ny * h.depth;
      if (!r) {
        this.bounce(p, h, 0, 0, 0.15);
        continue;
      }
      // velocity of the robot surface at the contact point
      const rx = h.cx - r.x;
      const ry = h.cy - r.y;
      const svx = r.vx - r.w * ry;
      const svy = r.vy + r.w * rx;
      this.bounce(p, h, svx, svy, 0.25);
    }
  }

  bounce(p, h, svx, svy, e) {
    const rcx = h.cx - p.x;
    const rcy = h.cy - p.y;
    const vcx = p.vx - p.w * rcy - svx;
    const vcy = p.vy + p.w * rcx - svy;
    const vn = vcx * h.nx + vcy * h.ny;
    if (vn >= 0) return;
    const rn = rcx * h.ny - rcy * h.nx;
    const j = (-(1 + e) * vn) / (1 + (rn * rn) / PIECE_I);
    p.vx += j * h.nx;
    p.vy += j * h.ny;
    p.w += (rn * j) / PIECE_I;
    // a bit of tangential drag so robots can "carry" pieces along
    const tx = -h.ny;
    const ty = h.nx;
    const vt = vcx * tx + vcy * ty;
    const jt = clamp(-vt * 0.3, -0.4 * j, 0.4 * j);
    p.vx += jt * tx;
    p.vy += jt * ty;
  }

  collidePieces(a, b) {
    const aax = Math.cos(a.th);
    const aay = Math.sin(a.th);
    const bax = Math.cos(b.th);
    const bay = Math.sin(b.th);
    for (const oa of SUB) {
      for (const ob of SUB) {
        const ax = a.x + aax * oa;
        const ay = a.y + aay * oa;
        const bx = b.x + bax * ob;
        const by = b.y + bay * ob;
        let dx = ax - bx;
        let dy = ay - by;
        const d = Math.hypot(dx, dy);
        if (d >= 2 * PR || d < 1e-6) continue;
        dx /= d;
        dy /= d;
        const pen = (2 * PR - d) / 2;
        a.x += dx * pen;
        a.y += dy * pen;
        b.x -= dx * pen;
        b.y -= dy * pen;
        const vn = (a.vx - b.vx) * dx + (a.vy - b.vy) * dy;
        if (vn < 0) {
          const j = (-(1 + 0.2) * vn) / 2;
          a.vx += j * dx;
          a.vy += j * dy;
          b.vx -= j * dx;
          b.vy -= j * dy;
          a.w += ((oa * j * 0.5) / PIECE_I) * (aax * dy - aay * dx);
          b.w -= ((ob * j * 0.5) / PIECE_I) * (bax * dy - bay * dx);
        }
      }
    }
  }

  resolvePieceStatic(p) {
    const ax = Math.cos(p.th);
    const ay = Math.sin(p.th);
    for (const o of STATIC) {
      if (o.kind === 'table' && p.z > F.TABLE.topZ) continue;
      for (const off of SUB) {
        const h = circleBox(p.x + ax * off, p.y + ay * off, PR, o);
        if (!h) continue;
        p.x += h.nx * h.depth;
        p.y += h.ny * h.depth;
        this.bounce(p, h, 0, 0, 0.2);
      }
    }
  }

  // ---------------------------------------------------------------- human players
  // robot parked at the foot of its own RAMP (in the NEUTRAL ZONE, in front of the oven's tag face)
  inRampCatch(r) {
    const s = F.sideSign(r.alliance);
    const tx = s * (F.OVEN.x0 - r.cfg.length / 2 - 0.05);
    return Math.abs(r.x - tx) < 0.4 && Math.abs(r.y - F.OVEN.yc) < 0.35;
  }

  waitingForRoll(r, c) {
    const tx = c.x + c.dx * (r.cfg.length / 2 + 1.25);
    const ty = c.y + c.dy * (r.cfg.length / 2 + 1.25);
    if (Math.hypot(r.x - tx, r.y - ty) > 0.7) return false;
    // don't pile up carrots: wait until the last one has been picked up
    return !this.pieces.some((p) => p.type === 'carrot' && (p.st === 'floor' || p.st === 'chute') && Math.hypot(p.x - c.x, p.y - c.y) < 2.2);
  }

  inCatchZone(r, chute) {
    // robot's bumper must be right under the 23" depot ramp mouth
    const off = r.cfg.length / 2 + 0.05;
    const tx = chute.x + chute.dx * off;
    const ty = chute.y + chute.dy * off;
    const lateral = Math.abs((r.x - chute.x) * chute.dy - (r.y - chute.y) * chute.dx);
    return Math.hypot(r.x - tx, r.y - ty) < 0.45 && lateral < 0.3;
  }

  updateHumanPlayers(dt) {
    const live = this.enabled;
    for (const a of F.ALLIANCES) {
      const inv = this.inv[a];
      // DEPOT: roll a carrot down whichever chute an alliance robot is waiting under
      F.depotChutes(a).forEach((c, ci) => {
        inv.chuteTimers[ci] = Math.max(0, inv.chuteTimers[ci] - dt);
        if (!live || inv.chuteTimers[ci] > 0 || inv.depotCarrots <= 0) return;
        // depot-intake robots catch straight from the mouth; ground-intake-only robots waiting out front
        // get the carrot rolled onto the carpet toward them (one at a time)
        const r = this.robots.find(
          (q) =>
            q.alliance === a &&
            q.held.length + this.incoming(q) < F.MAX_HELD &&
            ((q.cfg.mods.depot && this.inCatchZone(q, c)) || (!q.cfg.mods.depot && q.cfg.mods.ground && this.waitingForRoll(q, c))),
        );
        if (!r) return;
        inv.depotCarrots--;
        inv.chuteTimers[ci] = 0.9;
        const back = F.DEPOT.depth * 0.8;
        const p = this.addPiece('carrot', c.x - c.dx * back, c.y - c.dy * back, Math.atan2(c.dy, c.dx) + Math.PI / 2, 'chute');
        p.z = F.DEPOT.mouthZ + 0.3;
        const hp = this.heldWorldPos(r, r.held.length);
        p.anim = {
          fx: p.x,
          fy: p.y,
          fz: p.z,
          fth: p.th,
          to: r.cfg.mods.depot ? { x: hp.x, y: hp.y, z: Math.max(hp.z, 0.4), th: hp.th } : { x: c.x, y: c.y, z: F.DEPOT.mouthZ, th: p.th },
          t: 0,
          dur: 0.45,
          robot: r.cfg.mods.depot ? r.id : null,
          chute: c,
        };
      });

      // RECIRCULATION: 3 oven carrots -> 1 carrot cake (carrots go to the opposing depot)
      if (inv.ovenCarrots >= 3) {
        inv.tradeTimer += dt;
        if (inv.tradeTimer >= 1.5) {
          inv.tradeTimer = 0;
          inv.ovenCarrots -= 3;
          inv.depotCarrots += 3; // house rule: the carrots go back to this alliance's own DEPOT (manual: opposing depot)
          if (inv.cakeBank > 0) {
            inv.cakeBank--;
            inv.rampCakes++;
            this.emit({ type: 'trade', alliance: a, cake: true });
          } else this.emit({ type: 'trade', alliance: a, cake: false });
        }
      } else inv.tradeTimer = 0;

      // RAMP: the human player stores cakes. Once an alliance robot has sat still at the
      // bottom of the ramp for RAMP_WAIT s, cakes roll down into it every RAMP_GAP s until
      // it's full. With autoRamp on, cakes roll down as soon as they're ready.
      inv.rampTimer = Math.max(0, inv.rampTimer - dt);
      for (const q of this.robots) {
        if (q.alliance !== a) continue;
        const still = Math.hypot(q.vx, q.vy) < 0.3 && Math.abs(q.w) < 0.6;
        q.rampWait = live && still && q.cfg.mods.ramp && this.inRampCatch(q) ? (q.rampWait || 0) + dt : 0;
      }
      const catcher = this.robots.find((q) => q.alliance === a && q.rampWait >= RAMP_WAIT && q.held.length + this.incoming(q) < F.MAX_HELD);
      if (live && inv.rampCakes > 0 && inv.rampTimer <= 0 && (catcher || this.autoRamp)) {
        inv.rampCakes--;
        inv.rampTimer = RAMP_GAP;
        const s = F.sideSign(a);
        const p = this.addPiece('cake', s * (F.FIELD.halfL - 0.15), F.OVEN.yc, Math.PI / 2, 'ramp');
        p.z = F.OVEN.rampHigh;
        p.anim = { fx: p.x, fy: p.y, fz: p.z, fth: p.th, to: { x: s * F.OVEN.frontX, z: F.OVEN.rampLow }, t: 0, dur: 1.0, robot: catcher?.id };
        this.emit({ type: 'cake', alliance: a });
      }
    }
  }

  incoming(r) {
    let n = 0;
    for (const p of this.pieces) if ((p.st === 'chute' || p.st === 'ramp') && p.anim && p.anim.robot === r.id) n++;
    return n;
  }

  // ---------------------------------------------------------------- rules
  checkRules() {
    const auto = this.phase === 'auto';
    const polys = new Map(this.robots.map((r) => [r.id, boxCorners(robotBox(r))]));

    if (auto) {
      for (const r of this.robots) {
        if (!r.taxi && !F.polysOverlap(polys.get(r.id), F.kitchenPoly(r.alliance))) {
          r.taxi = true;
          this.emit({ type: 'score', alliance: r.alliance, pts: F.POINTS.taxi, label: 'TAXI', x: r.x, y: r.y, z: 1, robot: r.id });
        }
      }
    }

    for (const [a, b] of this.contacts || []) {
      if (a.alliance === b.alliance) continue;
      for (const [p, q] of [
        [a, b],
        [b, a],
      ]) {
        const pp = polys.get(p.id);
        const qp = polys.get(q.id);
        // G11 — protected KITCHEN and FARM of the opponent
        const opp = q.alliance;
        for (const [zone, label] of [
          [F.kitchenPoly(opp), 'KITCHEN'],
          [F.farmPoly(opp), 'FARM'],
        ]) {
          if (F.polysOverlap(pp, zone) && F.polysOverlap(qp, zone)) this.foul(p, q, 'G11', `contact in opponent ${label}`, 'minor');
        }
        // G12 — TABLE PROTECTION during ENDGAME
        if (this.isEndgame && F.polysOverlap(qp, F.tableZonePoly(opp)) && !F.polysOverlap(pp, F.tableZonePoly(p.alliance))) {
          this.foul(p, q, 'G12', 'contact with robot in its TABLE ZONE', 'minor');
        }
        // G13 — stay on your side during AUTO
        if (auto) {
          const s = F.sideSign(p.alliance);
          if (pp.every(([x]) => x * s < 0)) this.foul(p, q, 'G13', 'crossed CENTER LINE in AUTO', 'minor');
        }
      }
    }
  }

  foul(offender, victim, rule, desc, kind) {
    const key = `${rule}:${offender.id}:${victim.id}`;
    const last = this.foulCooldown.get(key);
    if (last !== undefined && this.time - last < 2.0) return;
    this.foulCooldown.set(key, this.time);
    const benefit = F.opponent(offender.alliance);
    if (kind === 'major') this.score[benefit].major++;
    else this.score[benefit].minor++;
    this.fouls.push({ t: this.matchTime, rule, offender: offender.id, alliance: offender.alliance, kind });
    this.emit({ type: 'foul', alliance: offender.alliance, robot: offender.id, rule, desc, kind, pts: kind === 'major' ? F.POINTS.majorFoul : F.POINTS.minorFoul });
  }

  // ---------------------------------------------------------------- scoring
  scoreEndgame() {
    for (const r of this.robots) {
      const poly = boxCorners(robotBox(r));
      r.parked = F.polysOverlap(poly, F.tableZonePoly(r.alliance));
      if (!r.parked) continue;
      const sb = this.score[r.alliance];
      sb.park++;
      const held = r.held.slice(0, 3).map((id) => this.pieces.find((p) => p.id === id));
      for (const p of held) {
        if (p.type === 'cake') sb.haulCake++;
        else sb.haulCarrot++;
      }
      this.emit({ type: 'park', alliance: r.alliance, robot: r.id, held: held.length });
    }
    this.recomputeScore();
    this.result = this.computeResult();
    this.emit({ type: 'result', result: this.result });
  }

  recomputeScore() {
    for (const a of F.ALLIANCES) {
      const sb = this.score[a];
      sb.taxi = this.robots.filter((r) => r.alliance === a && r.taxi).length;
      sb.pantry = [0, 1, 2].map((lvl) => {
        const c = { carrot: 0, cake: 0 };
        for (const id of this.pantry[a][lvl]) {
          if (!id) continue;
          const p = this.pieces.find((q) => q.id === id);
          c[p.type]++;
        }
        return c;
      });
      sb.totals = totals(sb);
    }
  }

  computeResult() {
    const red = this.score.red.totals;
    const blue = this.score.blue.totals;
    const out = { red: { score: red.total }, blue: { score: blue.total } };
    for (const a of F.ALLIANCES) {
      const t = this.score[a].totals;
      const other = this.score[F.opponent(a)].totals;
      const win = t.total > other.total;
      const tie = t.total === other.total;
      const sb = this.score[a];
      const stocked = sb.pantry.every((l) => l.carrot + l.cake >= F.STOCKED_RP_PER_SHELF);
      const baked = sb.pantry.every((l) => l.cake >= 1);
      const dinner = t.endgame >= F.DINNER_RP_ENDGAME_POINTS;
      out[a] = {
        score: t.total,
        outcome: win ? 'win' : tie ? 'tie' : 'loss',
        rp: (win ? F.RP.win : tie ? F.RP.tie : 0) + (stocked ? 1 : 0) + (baked ? 1 : 0) + (dinner ? 1 : 0),
        stocked,
        baked,
        dinner,
      };
    }
    out.winner = red.total > blue.total ? 'red' : blue.total > red.total ? 'blue' : 'tie';
    return out;
  }

  // ---------------------------------------------------------------- network snapshot
  snapshot() {
    const held = (r) => r.held.map((id) => (this.pieces.find((p) => p.id === id).type === 'cake' ? 'k' : 'c')).join('');
    return {
      tk: this.tick,
      ph: this.phase,
      pt: r2(this.phaseTime),
      tl: r2(this.timeLeft),
      eg: this.isEndgame,
      r: this.robots.map((r) => [
        r.id,
        r3(r.x),
        r3(r.y),
        r3(r.th),
        r3(r.elev),
        held(r),
        (r.intake ? 1 : 0) | (r.taxi ? 2 : 0) | (r.parked ? 4 : 0) | (r.carriage ? 8 : 0) | (r.tongue ? 16 : 0) | (r.stunUntil > this.time ? 32 : 0),
        r3(r.vx),
        r3(r.vy),
        r3(r.w),
        r.ack,
        r.elevTarget,
        r2(r.rampWait || 0),
      ]),
      p: this.pieces.filter((p) => p.st !== 'held' && p.st !== 'gone').map((p) => [p.id, p.type === 'cake' ? 'k' : 'c', p.st[0], r3(p.x), r3(p.y), r3(p.z), r3(p.th), r2(p.roll)]),
      s: { red: this.score.red, blue: this.score.blue },
      inv: {
        red: invView(this.inv.red),
        blue: invView(this.inv.blue),
      },
    };
  }

  // Purges finished pieces so long sessions don't grow without bound.
  compact() {
    this.pieces = this.pieces.filter((p) => p.st !== 'gone');
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  roster() {
    return this.robots.map((r) => ({ id: r.id, alliance: r.alliance, station: r.station, name: r.name, team: r.team, robot: r.robot, mods: r.cfg.mods, bot: r.bot }));
  }
}

function inflate(b, d) {
  return { ...b, hx: b.hx + d, hy: b.hy + d };
}

function invView(i) {
  return [i.depotCarrots, i.cakeBank, i.ovenCarrots, i.rampCakes];
}

function towardZero(v, d) {
  if (v > d) return v - d;
  if (v < -d) return v + d;
  return 0;
}

export function emptyBreakdown() {
  return {
    taxi: 0,
    ovenCarrot: 0,
    ovenCake: 0,
    pantry: [0, 1, 2].map(() => ({ carrot: 0, cake: 0 })),
    park: 0,
    haulCarrot: 0,
    haulCake: 0,
    minor: 0, // fouls committed BY THE OPPONENT (credited to this alliance)
    major: 0,
    totals: { auto: 0, pantry: 0, oven: 0, endgame: 0, fouls: 0, total: 0 },
  };
}

export function totals(sb) {
  const pantry = sb.pantry.reduce((acc, l, i) => acc + l.carrot * F.POINTS.pantry.carrot[i] + l.cake * F.POINTS.pantry.cake[i], 0);
  const oven = sb.ovenCarrot * F.POINTS.oven.carrot + sb.ovenCake * F.POINTS.oven.cake;
  const taxi = sb.taxi * F.POINTS.taxi;
  const endgame = sb.park * F.POINTS.park + sb.haulCarrot * F.POINTS.haulCarrot + sb.haulCake * F.POINTS.haulCake;
  const fouls = sb.minor * F.POINTS.minorFoul + sb.major * F.POINTS.majorFoul;
  return { taxi, pantry, oven, endgame, fouls, total: taxi + pantry + oven + endgame + fouls };
}
