// Simple autonomous driver used to fill empty alliance slots.
// Collect -> score (pantry, oven when full) -> park at the DINNER TABLE for ENDGAME.

import * as F from './field.js';

const CELL = 0.2;
const NX = Math.ceil((F.FIELD.halfL * 2) / CELL);
const NY = Math.ceil((F.FIELD.halfW * 2) / CELL);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const OBSTACLES = F.staticObstacles().filter((o) => o.kind !== 'wall');
const gridCache = new Map();

const cx = (i) => -F.FIELD.halfL + (i + 0.5) * CELL;
const cy = (j) => -F.FIELD.halfW + (j + 0.5) * CELL;
const ci = (x) => clamp(Math.floor((x + F.FIELD.halfL) / CELL), 0, NX - 1);
const cj = (y) => clamp(Math.floor((y + F.FIELD.halfW) / CELL), 0, NY - 1);

function inflatedBlocked(x, y, rad) {
  if (Math.abs(x) > F.FIELD.halfL - rad || Math.abs(y) > F.FIELD.halfW - rad) return true;
  for (const o of OBSTACLES) {
    const c = Math.cos(o.th);
    const s = Math.sin(o.th);
    const lx = (x - o.cx) * c + (y - o.cy) * s;
    const ly = -(x - o.cx) * s + (y - o.cy) * c;
    const dx = Math.max(Math.abs(lx) - o.hx, 0);
    const dy = Math.max(Math.abs(ly) - o.hy, 0);
    if (Math.hypot(dx, dy) < rad) return true;
  }
  return false;
}

// Per-alliance cost grid: 0 = blocked, otherwise traversal cost multiplier.
function getGrid(rad, alliance) {
  const key = `${rad.toFixed(2)}:${alliance}`;
  if (gridCache.has(key)) return gridCache.get(key);
  const g = new Float32Array(NX * NY);
  const opp = F.opponent(alliance);
  const k = F.kitchenPoly(opp);
  const f = F.farmPoly(opp);
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NY; j++) {
      const x = cx(i);
      const y = cy(j);
      if (inflatedBlocked(x, y, rad)) g[i * NY + j] = 0;
      else g[i * NY + j] = F.pointInPoly(x, y, k) || F.pointInPoly(x, y, f) ? 6 : 1;
    }
  }
  gridCache.set(key, g);
  return g;
}

function nearestFree(g, i, j) {
  if (g[i * NY + j] > 0) return [i, j];
  for (let r = 1; r < 8; r++) {
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        const a = i + di;
        const b = j + dj;
        if (a >= 0 && b >= 0 && a < NX && b < NY && g[a * NY + b] > 0) return [a, b];
      }
    }
  }
  return [i, j];
}

export function planPath(x0, y0, x1, y1, rad, alliance) {
  const g = getGrid(rad, alliance);
  const [si, sj] = nearestFree(g, ci(x0), cj(y0));
  const [gi, gj] = nearestFree(g, ci(x1), cj(y1));
  const N = NX * NY;
  const gs = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open = new Heap();
  const h = (i, j) => {
    const dx = Math.abs(i - gi);
    const dy = Math.abs(j - gj);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  const start = si * NY + sj;
  const goal = gi * NY + gj;
  gs[start] = 0;
  open.push(h(si, sj), start);
  let iter = 0;
  while (open.size && iter++ < 8000) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    const i = Math.floor(cur / NY);
    const j = cur % NY;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= NX || b >= NY) continue;
        const n = a * NY + b;
        const c = g[n];
        if (!c || closed[n]) continue;
        if (di && dj && (!g[i * NY + b] || !g[a * NY + j])) continue; // no corner cutting
        const ng = gs[cur] + (di && dj ? Math.SQRT2 : 1) * c;
        if (ng < gs[n]) {
          gs[n] = ng;
          came[n] = cur;
          open.push(ng + h(a, b), n);
        }
      }
    }
  }
  if (came[goal] < 0 && goal !== start) return [[x1, y1]];
  const pts = [];
  for (let c = goal; c !== -1 && c !== start; c = came[c]) pts.push([cx(Math.floor(c / NY)), cy(c % NY)]);
  pts.reverse();
  pts.push([x1, y1]);
  return simplify(pts, g);
}

class Heap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, val) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop() {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lk = k.pop();
    const lv = v.pop();
    if (k.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= k.length) break;
        if (c + 1 < k.length && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

// drop intermediate points that have line of sight
function simplify(pts, g) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !lineFree(pts[i], pts[j], g)) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}
function lineFree(a, b, g) {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.ceil(d / (CELL * 0.5));
  for (let k = 1; k < n; k++) {
    const x = a[0] + ((b[0] - a[0]) * k) / n;
    const y = a[1] + ((b[1] - a[1]) * k) / n;
    if (!g[ci(x) * NY + cj(y)]) return false;
  }
  return true;
}

// ------------------------------------------------------------------ the bot
export class Bot {
  constructor(robotId, { skill = 0.85 } = {}) {
    this.id = robotId;
    this.skill = skill;
    this.task = null;
    this.path = null;
    this.replanAt = 0;
    this.stuckT = 0;
    this.backupT = 0;
    this.thinkAt = 0;
  }

  update(m, dt) {
    const r = m.robotById(this.id);
    if (!r) return;
    const inp = { mx: 0, my: 0, rot: 0, intake: false, score: false, eject: false, sp: null, autoStow: true };
    if (!m.enabled) return m.setInput(this.id, inp);

    if (m.time >= this.thinkAt || !this.task || this.task.done) {
      this.task = this.chooseTask(m, r);
      this.thinkAt = m.time + 0.5;
    }
    const t = this.task;
    if (!t) return m.setInput(this.id, inp);

    const rad = Math.max(r.cfg.length, r.cfg.width) / 2 + 0.06;
    // stage point (planned) then final approach (direct)
    const goal = t.stage || t.goal;
    const distStage = Math.hypot(goal[0] - r.x, goal[1] - r.y);
    let target = goal;
    let finalLeg = false;
    if (!t.stage || distStage < 0.25 || t.reachedStage) {
      if (t.stage) t.reachedStage = true;
      target = t.goal;
      finalLeg = true;
    }
    if (!finalLeg || !t.direct) {
      if (m.time >= this.replanAt || !this.path || this.pathGoal !== target) {
        this.path = planPath(r.x, r.y, target[0], target[1], rad, r.alliance);
        this.pathGoal = target;
        this.replanAt = m.time + 0.6;
      }
    } else this.path = [target];

    // pure pursuit along the path
    while (this.path.length > 1 && Math.hypot(this.path[0][0] - r.x, this.path[0][1] - r.y) < 0.45) this.path.shift();
    const wp = this.path[0] || target;
    let dx = wp[0] - r.x;
    let dy = wp[1] - r.y;
    const d = Math.hypot(dx, dy);
    const remaining = Math.hypot(target[0] - r.x, target[1] - r.y) + (finalLeg ? 0 : Math.hypot(t.goal[0] - target[0], t.goal[1] - target[1]));
    const vmax = r.cfg.maxSpeed * this.skill;
    const speed = Math.min(vmax, Math.sqrt(2 * r.cfg.accel * 0.6 * Math.max(remaining - 0.02, 0)) + (finalLeg ? 0.05 : 0.6));
    if (d > 1e-3) {
      dx /= d;
      dy /= d;
    }
    // avoid other robots
    for (const o of m.robots) {
      if (o === r) continue;
      const ox = r.x - o.x;
      const oy = r.y - o.y;
      const od = Math.hypot(ox, oy);
      const lim = (r.cfg.length + o.cfg.length) / 2 + 0.45;
      if (od < lim && od > 1e-3 && remaining > 0.6) {
        const k = ((lim - od) / lim) * 1.4;
        dx += (ox / od) * k;
        dy += (oy / od) * k;
      }
    }
    const n = Math.hypot(dx, dy) || 1;
    inp.mx = (dx / n) * (speed / r.cfg.maxSpeed);
    inp.my = (dy / n) * (speed / r.cfg.maxSpeed);

    const th = t.heading !== undefined && remaining < 2.2 ? t.heading : d > 0.3 ? Math.atan2(dy, dx) : r.th;
    const he = wrap(th - r.th);
    inp.rot = clamp(he * 2.2 - r.w * 0.12, -1, 1) * this.skill;

    // unstick
    const moving = Math.hypot(r.vx, r.vy) > 0.25;
    if (!moving && remaining > 0.4 && Math.hypot(inp.mx, inp.my) > 0.3) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 1.2) {
      this.backupT = 0.6;
      this.stuckT = 0;
      this.backDir = Math.random() < 0.5 ? 1 : -1;
      this.replanAt = 0;
    }
    if (this.backupT > 0) {
      this.backupT -= dt;
      inp.mx = -Math.cos(r.th) * 0.6 - Math.sin(r.th) * 0.4 * this.backDir;
      inp.my = -Math.sin(r.th) * 0.6 + Math.cos(r.th) * 0.4 * this.backDir;
    }

    // task actions
    if (t.sp && remaining < 1.6) inp.sp = t.sp;
    if (t.kind === 'collect' || t.kind === 'table') {
      inp.intake = remaining < 1.5;
      inp.sp = 'stow';
      if (t.pieceId) {
        const p = m.pieces.find((q) => q.id === t.pieceId);
        if (!p || (p.st !== 'floor' && p.st !== 'table')) t.done = true;
      }
    }
    if (t.kind === 'depot') {
      inp.sp = 'stow';
      if (r.held.length >= F.MAX_HELD || m.inv[r.alliance].depotCarrots <= 0) t.done = true;
      if (remaining < 0.15) {
        inp.mx *= 0.3;
        inp.my *= 0.3;
      }
    }
    if ((t.kind === 'pantry' || t.kind === 'oven') && remaining < 0.14 && Math.abs(he) < 0.16) {
      const e = r.cfg.elevator;
      if (Math.abs(r.elev - e.setpoints[t.sp]) <= e.tolerance * 0.8) {
        inp.score = true;
        inp.mx *= 0.2;
        inp.my *= 0.2;
      }
    }
    if ((t.kind === 'pantry' || t.kind === 'oven') && r.held.length !== t.heldAtStart) t.done = true;
    if (t.kind === 'park') {
      inp.sp = 'stow';
      if (remaining < 0.1) {
        inp.mx = 0;
        inp.my = 0;
      }
    }
    m.setInput(this.id, inp);
  }

  chooseTask(m, r) {
    const a = r.alliance;
    const s = F.sideSign(a);
    const auto = m.phase === 'auto';
    const half = r.cfg.length / 2;

    // ENDGAME: go park in the TABLE ZONE
    const parkSpot = this.parkSpot(r);
    const parkDist = Math.hypot(parkSpot.goal[0] - r.x, parkSpot.goal[1] - r.y);
    if (m.phase === 'teleop' && m.timeLeft < parkDist / (r.cfg.maxSpeed * 0.55) + 4) return parkSpot;

    // keep a task that is still valid (avoid dithering)
    if (this.task && !this.task.done && this.task.kind !== 'park' && m.time - this.task.since < 6) {
      if (this.task.kind === 'collect' && r.held.length < F.MAX_HELD) return this.task;
      if ((this.task.kind === 'pantry' || this.task.kind === 'oven') && r.held.length) return this.task;
      if (this.task.kind === 'depot' && r.held.length < F.MAX_HELD) return this.task;
    }

    const wantScore = r.held.length >= F.MAX_HELD || (r.held.length > 0 && !this.nearbyPiece(m, r, 3.0));
    if (wantScore) {
      const t = this.scoreTask(m, r);
      if (t) return t;
    }

    if (r.held.length < F.MAX_HELD) {
      // closest loose piece we may legally chase
      let best = null;
      let bd = Infinity;
      const oppK = F.kitchenPoly(F.opponent(a));
      const oppF = F.farmPoly(F.opponent(a));
      for (const p of m.pieces) {
        if (p.st !== 'floor' && p.st !== 'table') continue;
        if (p.st === 'table' && p.x * s < 0) continue;
        if (auto && p.x * s < 0.6) continue;
        if (p.z > 0.05 && p.st === 'floor') continue;
        if (F.pointInPoly(p.x, p.y, oppK) || F.pointInPoly(p.x, p.y, oppF)) continue;
        if (Math.abs(p.x) > F.FIELD.halfL - 0.4 || Math.abs(p.y) > F.FIELD.halfW - 0.4) continue;
        if (nearElement(p.x, p.y)) continue;
        if (this.claimedByAlly(m, r, p.id)) continue;
        const d = Math.hypot(p.x - r.x, p.y - r.y) * (p.type === 'cake' ? 0.6 : 1);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      // DEPOT run when nothing is close
      const depotT = m.inv[a].depotCarrots > 0 && !auto ? this.depotTask(m, r) : null;
      const depotD = depotT ? Math.hypot(depotT.goal[0] - r.x, depotT.goal[1] - r.y) : Infinity;
      if (best && bd < depotD + 1.5) {
        // approach so the roller lines up with the piece axis (two possible sides)
        const nx = -Math.sin(best.th);
        const ny = Math.cos(best.th);
        const side = (r.x - best.x) * nx + (r.y - best.y) * ny >= 0 ? 1 : -1;
        const hx = best.st === 'table' ? s : -side * nx;
        const hy = best.st === 'table' ? 0 : -side * ny;
        const heading = Math.atan2(hy, hx);
        let gx = best.x - hx * (half + 0.12);
        let gy = best.y - hy * (half + 0.12);
        if (best.st === 'table') {
          gx = s * (F.TABLE.baseHalfDiag + half + 0.03);
          gy = 0;
        }
        return {
          kind: best.st === 'table' ? 'table' : 'collect',
          pieceId: best.id,
          goal: [gx, gy],
          stage: [gx - hx * 0.55, gy - hy * 0.55],
          direct: true,
          heading: best.st === 'table' ? (s > 0 ? Math.PI : 0) : heading,
          since: m.time,
        };
      }
      if (depotT) return depotT;
    }
    if (r.held.length) return this.scoreTask(m, r);
    // nothing to do: wait near midfield on our side
    return { kind: 'idle', goal: [s * 3.2, 0.5 * (r.station - 2)], since: m.time };
  }

  nearbyPiece(m, r, dist) {
    return m.pieces.some((p) => p.st === 'floor' && p.z < 0.05 && Math.hypot(p.x - r.x, p.y - r.y) < dist && !nearElement(p.x, p.y));
  }

  claimedByAlly(m, r, pid) {
    return (m.bots || []).some((b) => b !== this && b.task && b.task.pieceId === pid && m.robotById(b.id)?.alliance === r.alliance);
  }

  depotTask(m, r) {
    const chutes = F.depotChutes(r.alliance);
    const c = chutes[r.station === 2 ? 1 : 0];
    const off = r.cfg.length / 2 + 0.05;
    const gx = c.x + c.dx * off;
    const gy = c.y + c.dy * off;
    return {
      kind: 'depot',
      goal: [gx, gy],
      stage: [gx + c.dx * 0.6, gy + c.dy * 0.6],
      direct: true,
      heading: Math.atan2(c.dy, c.dx),
      since: m.time,
    };
  }

  scoreTask(m, r) {
    const a = r.alliance;
    const s = F.sideSign(a);
    const e = r.cfg.elevator;
    const heldTop = m.pieces.find((p) => p.id === r.held[r.held.length - 1]);
    const levels = [2, 1, 0].filter((l) => e.setpoints[['l1', 'l2', 'l3'][l]] <= e.max);
    const pantry = m.pantry[a];
    const count = (l) => pantry[l].filter(Boolean).length;
    const hasCake = (l) => pantry[l].some((id) => id && m.pieces.find((p) => p.id === id)?.type === 'cake');
    // keep one slot per shelf free for a CARROT CAKE while cakes can still show up (Baked Up RP)
    const inv = m.inv[a];
    const cakesComing = m.timeLeft > 25 && (inv.cakeBank + inv.rampCakes > 0 || m.pieces.some((p) => p.type === 'cake' && (p.st === 'floor' || p.st === 'table' || p.st === 'ramp')));
    const carrotCap = (l) => (!hasCake(l) && cakesComing ? 4 : 5);
    let level = -1;
    if (heldTop?.type === 'cake') level = levels.find((l) => !hasCake(l) && count(l) < 5) ?? levels.find((l) => count(l) < 5) ?? -1;
    else {
      level = levels.find((l) => count(l) < 3) ?? -1; // stock every shelf to 3 first
      if (level < 0) level = levels.find((l) => count(l) < carrotCap(l)) ?? -1;
    }
    const half = r.cfg.length / 2;
    if (level >= 0) {
      const free = pantry[level].map((id, i) => (id ? null : i)).filter((i) => i !== null);
      const slot = free[(r.station + level) % free.length];
      const gx = F.pantrySlotX(slot, s);
      const gy = F.PANTRY.yFront - half - 0.01;
      return {
        kind: 'pantry',
        goal: [gx, gy],
        stage: [gx, gy - 0.7],
        direct: true,
        heading: Math.PI / 2,
        sp: ['l1', 'l2', 'l3'][level],
        heldAtStart: r.held.length,
        since: m.time,
      };
    }
    // pantry full and holding a cake: worth more as HARVEST HAUL (3) than in the oven (1)
    if (heldTop?.type === 'cake') return { ...this.parkSpot(r), kind: 'park', since: m.time };
    // pantry full -> OVEN through the kitchen-side mouth
    const gx = s * ((F.OVEN.mouthX0 + F.OVEN.mouthX1) / 2 + 0.05);
    const gy = F.OVEN.y1 + half + 0.02;
    return { kind: 'oven', goal: [gx, gy], stage: [gx, gy + 0.6], direct: true, heading: -Math.PI / 2, sp: 'oven', heldAtStart: r.held.length, since: m.time };
  }

  parkSpot(r) {
    const s = F.sideSign(r.alliance);
    const half = Math.max(r.cfg.length, r.cfg.width) / 2;
    const D = F.TABLE.baseHalfDiag;
    // three spots along the two table edges facing our alliance
    const spots = [
      { e: [D / 2, D / 2], n: [Math.SQRT1_2, Math.SQRT1_2] },
      { e: [D, 0], n: [1, 0] },
      { e: [D / 2, -D / 2], n: [Math.SQRT1_2, -Math.SQRT1_2] },
    ];
    const sp = spots[(r.station - 1) % 3];
    const gx = s * (sp.e[0] + sp.n[0] * (half + 0.06));
    const gy = sp.e[1] + sp.n[1] * (half + 0.06);
    return { kind: 'park', goal: [gx, gy], heading: Math.atan2(-sp.n[1], -s * sp.n[0]), since: 0 };
  }
}

function nearElement(x, y) {
  for (const o of OBSTACLES) {
    const c = Math.cos(o.th);
    const s = Math.sin(o.th);
    const lx = (x - o.cx) * c + (y - o.cy) * s;
    const ly = -(x - o.cx) * s + (y - o.cy) * c;
    if (Math.abs(lx) < o.hx + 0.35 && Math.abs(ly) < o.hy + 0.35) return true;
  }
  return false;
}
