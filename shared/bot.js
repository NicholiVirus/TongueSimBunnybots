// Simple autonomous driver used to fill empty alliance slots.
// Collect -> carrots to the OVEN, carrot cakes to the PANTRY -> park at the DINNER TABLE for ENDGAME.

import * as F from './field.js';
import { shelfFit } from './sim.js';
import { isOneAtATime, shelfSide } from './robots.js';

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
  const tz = F.tableZonePoly(opp);
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NY; j++) {
      const x = cx(i);
      const y = cy(j);
      if (inflatedBlocked(x, y, rad)) g[i * NY + j] = 0;
      else g[i * NY + j] = nearZone(x, y, [k, f, tz], rad * 1.3 + 0.05) ? 0 : 1; // never plan through an opponent zone
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
    // avoid other robots — and give opponents a wide berth in ENDGAME (G11/G12 fouls)
    for (const o of m.robots) {
      if (o === r) continue;
      const ox = r.x - o.x;
      const oy = r.y - o.y;
      const od = Math.hypot(ox, oy);
      const careful = o.alliance !== r.alliance && (m.isEndgame || protectedZone(o) || nearZone(r.x, r.y, [F.kitchenPoly(o.alliance), F.farmPoly(o.alliance)], r.cfg.length / 2));
      const lim = (r.cfg.length + o.cfg.length) / 2 + (careful ? 1.0 : 0.45);
      if (od < lim && od > 1e-3 && (remaining > 0.6 || careful)) {
        const k = ((lim - od) / lim) * (careful ? 3 : 1.4);
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
    this.keepOutOfOpponentZones(r, inp);

    // task actions
    if (t.sp && remaining < 1.6) inp.sp = isOneAtATime(r.cfg.mods) && t.kind === 'pantry' && !r.carriage ? 'stow' : t.sp; // separate elevator reloads low
    if (t.kind === 'collect' || t.kind === 'table') {
      inp.intake = remaining < 1.5;
      inp.sp = 'stow';
      if (t.pieceId) {
        const p = m.pieces.find((q) => q.id === t.pieceId);
        if (!p || (p.st !== 'floor' && p.st !== 'table')) t.done = true;
      }
    }
    if (t.kind === 'ramp') {
      inp.sp = 'stow';
      // sit perfectly still at the foot of the ramp so the human player rolls cakes down
      if (remaining < 0.12) {
        inp.mx = 0;
        inp.my = 0;
        inp.rot = Math.abs(he) > 0.08 ? inp.rot : 0;
      }
      if (r.held.length >= F.MAX_HELD || (m.inv[r.alliance].rampCakes <= 0 && !m.incoming(r))) t.done = true;
      // carrots aboard (all 3 slots should be free for cakes): leave and unload them in the oven first
      if (r.held.some((id) => m.pieces.find((p) => p.id === id)?.type === 'carrot')) {
        t.done = true;
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

  // Final safety net on every command: never drive toward an opponent KITCHEN, FARM or TABLE ZONE.
  // Picks the allowed heading closest to the requested one (or the way out if we got shoved in).
  keepOutOfOpponentZones(r, inp) {
    const sp = Math.hypot(inp.mx, inp.my);
    if (sp < 1e-3) return;
    const opp = F.opponent(r.alliance);
    const zones = [F.kitchenPoly(opp), F.farmPoly(opp), F.tableZonePoly(opp)];
    const body = Math.hypot(r.cfg.length, r.cfg.width) / 2 + 0.06; // corners reach out when turned
    const look = 0.3 + Math.hypot(r.vx, r.vy) * 0.35;
    const blocked = (dx, dy) => nearZone(r.x + dx * look, r.y + dy * look, zones, body);
    const ux = inp.mx / sp;
    const uy = inp.my / sp;
    if (!blocked(ux, uy)) return;
    let best = null;
    let bd = -Infinity;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      if (blocked(cx, cy)) continue;
      const dot = cx * ux + cy * uy;
      if (dot > bd) {
        bd = dot;
        best = [cx, cy];
      }
    }
    if (!best) return;
    const k = bd > 0 ? sp * bd : sp * 0.5; // slow down when sliding along a zone edge
    inp.mx = best[0] * k;
    inp.my = best[1] * k;
  }

  chooseTask(m, r) {
    const a = r.alliance;
    const s = F.sideSign(a);
    const auto = m.phase === 'auto';
    const half = r.cfg.length / 2;

    // ENDGAME: go park in the TABLE ZONE
    const parkSpot = this.parkSpot(r);
    const parkDist = Math.hypot(parkSpot.goal[0] - r.x, parkSpot.goal[1] - r.y);
    if (m.phase === 'teleop' && m.timeLeft < parkDist / (r.cfg.maxSpeed * 0.5) + 7) return parkSpot;

    const heldTypes = r.held.map((id) => m.pieces.find((p) => p.id === id)?.type);
    // keep catching while stored cakes are still coming down
    if (this.task?.kind === 'ramp' && !this.task.done && r.held.length < F.MAX_HELD && !heldTypes.includes('carrot') && (m.inv[a].rampCakes > 0 || m.incoming(r))) return this.task;
    // PRIORITY 1: cakes aboard go on the shelves
    if (heldTypes.includes('cake')) {
      const t = this.scoreTask(m, r);
      if (t?.kind === 'pantry') return t.kind === this.task?.kind && !this.task.done ? this.task : t;
    }
    // PRIORITY 2: cakes stored at our ramp — dump carrots in the oven (right beside it), then wait to catch
    const ramp = this.rampTask(m, r);
    if (ramp) {
      if (heldTypes.includes('carrot')) return this.task?.kind === 'oven' && !this.task.done ? this.task : this.scoreTask(m, r);
      return ramp;
    }

    // keep a task that is still valid (avoid dithering)
    if (this.task && !this.task.done && this.task.kind !== 'park' && m.time - this.task.since < 6) {
      if (this.task.kind === 'collect' && r.held.length < F.MAX_HELD) return this.task;
      if ((this.task.kind === 'pantry' || this.task.kind === 'oven') && r.held.length) return this.task;
      if (this.task.kind === 'depot' && r.held.length < F.MAX_HELD) return this.task;
      if (this.task.kind === 'ramp' && r.held.length < F.MAX_HELD) return this.task;
    }

    // PRIORITY 3: a reachable loose CARROT CAKE is worth a detour before scoring carrots
    const cakeAvailable = r.held.length < F.MAX_HELD && m.pieces.some((p) => p.type === 'cake' && this.cakeWorthChasing(m, r, p));
    const wantScore = r.held.length >= F.MAX_HELD || (r.held.length > 0 && !cakeAvailable && !this.nearbyPiece(m, r, 3.0));
    if (wantScore) {
      const t = this.scoreTask(m, r);
      if (t) return t;
    }

    if (r.held.length < F.MAX_HELD && r.cfg.mods.ground) {
      // closest loose piece we may legally chase
      let best = null;
      let bd = Infinity;
      const oppK = F.kitchenPoly(F.opponent(a));
      const oppF = F.farmPoly(F.opponent(a));
      for (const p of m.pieces) {
        if (p.st !== 'floor' && p.st !== 'table') continue;
        if (p.st === 'table' && p.x * s < 0) continue;
        if (auto && p.x * s < 0.3) continue;
        if (p.z > 0.05 && p.st === 'floor') continue;
        if (nearZone(p.x, p.y, [oppK, oppF], r.cfg.length * 1.6)) continue;
        if (Math.abs(p.x) > F.FIELD.halfL - 0.4 || Math.abs(p.y) > F.FIELD.halfW - 0.4) continue;
        if (p.st !== 'table' && nearElement(p.x, p.y)) continue; // table cakes sit on an element but are reachable over the 4" rail
        if (this.claimedByAlly(m, r, p.id)) continue;
        if (cakeAvailable && p.type !== 'cake') continue;
        if (p.type === 'cake' && !this.cakeWorthChasing(m, r, p)) continue;
        const d = Math.hypot(p.x - r.x, p.y - r.y) * (p.type === 'cake' ? 0.35 : 1);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      // DEPOT run when nothing is close
      const depotT = r.cfg.mods.depot && m.inv[a].depotCarrots > 0 && !auto && m.timeLeft > F.TIMING.endgame + 10 ? this.depotTask(m, r) : null;
      const depotD = depotT ? Math.hypot(depotT.goal[0] - r.x, depotT.goal[1] - r.y) : Infinity;
      if (best && bd < depotD + 1.5) {
        // approach so the roller lines up with the piece axis — pick the side that keeps us out of opponent zones
        const nx = -Math.sin(best.th);
        const ny = Math.cos(best.th);
        const near = (best.x - r.x) * nx + (best.y - r.y) * ny <= 0 ? 1 : -1;
        let plan = null;
        for (const side of [near, -near]) {
          const hx = best.st === 'table' ? s : side * nx;
          const hy = best.st === 'table' ? 0 : side * ny;
          let gx = best.x - hx * (half + 0.12);
          let gy = best.y - hy * (half + 0.12);
          if (best.st === 'table') {
            gx = s * (F.TABLE.baseHalfDiag + half + 0.03);
            gy = 0;
          }
          const stage = [gx - hx * 0.55, gy - hy * 0.55];
          if (nearZone(gx, gy, [oppK, oppF], half + 0.1) || nearZone(stage[0], stage[1], [oppK, oppF], half + 0.1)) continue;
          plan = {
            kind: best.st === 'table' ? 'table' : 'collect',
            pieceId: best.id,
            goal: [gx, gy],
            stage,
            direct: true,
            heading: best.st === 'table' ? (s > 0 ? Math.PI : 0) : Math.atan2(hy, hx),
            since: m.time,
          };
          break;
        }
        if (plan) return plan;
      }
      if (depotT) return depotT;
    }
    if (r.held.length) return this.scoreTask(m, r);
    // nothing to do: wait near midfield on our side
    return { kind: 'idle', goal: [s * 3.2, 0.5 * (r.station - 2)], since: m.time };
  }

  // Only chase a cake if there's a free shelf slot and time to get it there before ENDGAME parking.
  cakeWorthChasing(m, r, p) {
    if (!r.cfg.mods.ground) return false;
    // AUTO: exactly one bot per alliance rushes the table cake; partners work carrots into the oven
    if (m.phase === 'auto' && autoRusher(m, r.alliance) !== r.id) return false;
    if (p.st !== 'floor' && p.st !== 'table') return false;
    const s = F.sideSign(r.alliance);
    if (p.st === 'table' && p.x * s < 0) return false;
    if (p.st === 'floor' && p.z > 0.05) return false;
    if (m.phase === 'auto' && p.x * s < 0.3) return false;
    if (nearZone(p.x, p.y, [F.kitchenPoly(F.opponent(r.alliance)), F.farmPoly(F.opponent(r.alliance))], r.cfg.length * 1.6)) return false;
    if (nearElement(p.x, p.y) && p.st !== 'table') return false;
    if (this.claimedByAlly(m, r, p.id)) return false;
    if (![0, 1, 2].some((l) => shelfFit(m.shelfXs(r.alliance, l), 0, r.alliance) !== null)) return false;
    const v = r.cfg.maxSpeed * 0.55;
    const pantryX = s * (F.PANTRY.x0 + F.PANTRY.x1) * 0.5;
    const trip = Math.hypot(p.x - r.x, p.y - r.y) / v + Math.hypot(pantryX - p.x, F.PANTRY.yFront - p.y) / v + 3;
    return m.timeLeft - trip > F.TIMING.endgame * 0.6;
  }

  nearbyPiece(m, r, dist) {
    return m.pieces.some((p) => p.st === 'floor' && p.z < 0.05 && Math.hypot(p.x - r.x, p.y - r.y) < dist && !nearElement(p.x, p.y));
  }

  claimedByAlly(m, r, pid) {
    return (m.bots || []).some((b) => b !== this && b.task && b.task.pieceId === pid && m.robotById(b.id)?.alliance === r.alliance);
  }

  rampTask(m, r) {
    const a = r.alliance;
    const inv = m.inv[a];
    if (m.autoRamp || !r.cfg.mods.ramp || inv.rampCakes <= 0 || m.phase === 'auto') return null;
    // let cakes stock up and grab a full load of 3; take them one by one only when no more are
    // coming (no trades left / pending) or time is getting short
    const moreComing = inv.cakeBank > 0 || inv.ovenCarrots > 0;
    if (inv.rampCakes < F.MAX_HELD && moreComing && m.timeLeft > 50) return null;
    if ((m.bots || []).some((b) => b !== this && b.task?.kind === 'ramp' && m.robotById(b.id)?.alliance === a)) return null;
    if (![0, 1, 2].some((l) => shelfFit(m.shelfXs(a, l), 0, a) !== null)) return null;
    const s = F.sideSign(a);
    const gx = s * (F.OVEN.x0 - r.cfg.length / 2 - 0.05);
    const v = r.cfg.maxSpeed * 0.55;
    if (m.timeLeft - Math.hypot(gx - r.x, F.OVEN.yc - r.y) / v - 8 < F.TIMING.endgame * 0.6) return null;
    return { kind: 'ramp', goal: [gx, F.OVEN.yc], stage: [gx - s * 0.6, F.OVEN.yc], direct: true, heading: s > 0 ? 0 : Math.PI, since: m.time };
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
    // the mechanism scores cakes first at the pantry, carrots first at the oven
    const heldTypes = r.held.map((id) => m.pieces.find((p) => p.id === id)?.type);
    const heldTop = { type: heldTypes.includes('cake') ? 'cake' : 'carrot' };
    const levels = [2, 1, 0].filter((l) => e.setpoints[['l1', 'l2', 'l3'][l]] <= e.max);
    const pantry = m.pantry[a];
    const hasCake = (l) => pantry[l].some((id) => m.pieces.find((p) => p.id === id)?.type === 'cake');
    // Shelves are for CARROT CAKES only (8-12 pts, same in AUTO and TELEOP); carrots go to the OVEN to bake more cakes.
    const pb = F.pantryBox(a);
    const prefer = pb.x0 + ((pb.x1 - pb.x0) * (r.station - 0.5)) / 3;
    const fit = (l) => shelfFit(m.shelfXs(a, l), prefer, a);
    let level = -1;
    if (heldTop.type === 'cake') level = levels.find((l) => !hasCake(l) && fit(l) !== null) ?? levels.find((l) => pantry[l].length < 3 && fit(l) !== null) ?? levels.find((l) => fit(l) !== null) ?? -1;
    const half = r.cfg.length / 2;
    if (level >= 0) {
      const gx = fit(level);
      const gy = F.PANTRY.yFront - half - 0.01;
      return {
        kind: 'pantry',
        goal: [gx, gy],
        stage: [gx, gy - 0.7],
        direct: true,
        heading: shelfSide(r.cfg.mods) > 0 ? Math.PI / 2 : -Math.PI / 2, // back to the shelves for elevator-back robots
        sp: ['l1', 'l2', 'l3'][level],
        heldAtStart: r.held.length,
        since: m.time,
      };
    }
    // pantry full and holding a cake: worth more as HARVEST HAUL (3) than in the oven (1)
    if (!heldTypes.includes('carrot')) return { ...this.parkSpot(r), kind: 'park', since: m.time };
    // carrots -> OVEN through the kitchen-side mouth
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

// The bot closest to its alliance's table cake when AUTO starts is the one that rushes it.
function autoRusher(m, a) {
  m.autoRushers ??= {};
  if (m.autoRushers[a] === undefined) {
    const s = F.sideSign(a);
    const cake = { x: s * F.TABLE_CAKE_SPOT.x, y: F.TABLE_CAKE_SPOT.y };
    const ids = new Set((m.bots || []).map((b) => b.id));
    const mine = m.robots.filter((q) => q.alliance === a && ids.has(q.id));
    mine.sort((p, q) => Math.hypot(p.x - cake.x, p.y - cake.y) - Math.hypot(q.x - cake.x, q.y - cake.y));
    m.autoRushers[a] = mine[0]?.id ?? null;
  }
  return m.autoRushers[a];
}

// opponent robot sitting in one of its protected zones (KITCHEN, FARM, TABLE ZONE)
function protectedZone(o) {
  return [F.kitchenPoly(o.alliance), F.farmPoly(o.alliance), F.tableZonePoly(o.alliance)].some((z) => F.pointInPoly(o.x, o.y, z));
}

function nearZone(x, y, zones, margin) {
  for (const z of zones) {
    for (const [dx, dy] of [
      [0, 0],
      [margin, 0],
      [-margin, 0],
      [0, margin],
      [0, -margin],
      [margin * 0.7, margin * 0.7],
      [margin * 0.7, -margin * 0.7],
      [-margin * 0.7, margin * 0.7],
      [-margin * 0.7, -margin * 0.7],
    ]) {
      if (F.pointInPoly(x + dx, y + dy, z)) return true;
    }
  }
  return false;
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
