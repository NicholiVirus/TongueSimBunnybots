import * as F from '/shared/field.js';
import { boxCorners } from '/shared/sim.js';
import { getRobotConfig, SETPOINT_ORDER } from '/shared/robots.js';

const $ = (id) => document.getElementById(id);
const SP_LABEL = { stow: 'STOW', oven: 'OVEN', l1: 'L1', l2: 'L2', l3: 'L3' };

export class Hud {
  constructor() {
    this.el = $('hud');
    this.bannerT = 0;
    this.hintT = 0;
    this.lastPhase = null;
    this.lastCount = null;
    this.minimap = $('minimap');
    this.mctx = this.minimap.getContext('2d');
    this.showMinimap = true;
    this.cache = {};
  }

  show(on) {
    this.el.classList.toggle('hidden', !on);
  }

  setText(id, v) {
    if (this.cache[id] === v) return;
    this.cache[id] = v;
    $(id).textContent = v;
  }
  setHTML(id, v) {
    if (this.cache[id] === v) return;
    this.cache[id] = v;
    $(id).innerHTML = v;
  }

  banner(text, color = '#fff', secs = 1.4) {
    const b = $('banner');
    b.textContent = text;
    b.style.color = color;
    b.classList.add('show');
    this.bannerT = secs;
  }

  hint(text) {
    const h = $('hint');
    h.textContent = text;
    h.classList.add('show');
    this.hintT = 2.2;
  }

  toast(text, cls) {
    const box = $('toasts');
    const t = document.createElement('div');
    t.className = `toast ${cls || ''}`;
    t.textContent = text;
    box.prepend(t);
    while (box.children.length > 5) box.lastChild.remove();
    setTimeout(() => t.remove(), 2500);
  }

  update(view, ctx, dt) {
    const s = view.snap;
    this.bannerT -= dt;
    if (this.bannerT <= 0) $('banner').classList.remove('show');
    this.hintT -= dt;
    if (this.hintT <= 0) $('hint').classList.remove('show');

    const badge = s.or ? 'OFFICIAL RULES · no HP in AUTO · oven carrots → other depot' : 'HOUSE RULES · HP active in AUTO · oven carrots → own depot';
    if (this.cache.badge !== badge) {
      this.cache.badge = badge;
      $('rules-badge').textContent = badge;
      $('rules-badge').classList.toggle('official', !!s.or);
    }

    // scoreboard
    this.setText('score-red', String(s.s.red.totals.total));
    this.setText('score-blue', String(s.s.blue.totals.total));
    const phaseName = { countdown: 'GET READY', auto: 'AUTO', teleop: s.eg ? 'ENDGAME' : 'TELEOP', post: 'MATCH OVER', done: 'FINAL' }[s.ph] || s.ph;
    this.setText('phase', phaseName);
    $('phase').classList.toggle('endgame', !!s.eg);
    const tl = s.ph === 'countdown' ? 150 : Math.ceil(s.tl);
    this.setText('clock', `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`);

    if (s.ph === 'countdown') {
      const n = Math.max(1, Math.ceil(F.TIMING.countdown - s.pt));
      if (n !== this.lastCount) {
        this.lastCount = n;
        this.banner(String(n), '#ffd84a', 0.9);
        ctx.audio?.beep(440, 0.12);
      }
    }
    if (s.ph !== this.lastPhase) {
      if (s.ph === 'auto') {
        this.banner('AUTO', '#ff8a1f');
        ctx.audio?.start();
      }
      if (s.ph === 'teleop' && this.lastPhase === 'auto') {
        this.banner('TELEOP', '#5ad16a');
        ctx.audio?.beep(660, 0.25);
      }
      if (s.ph === 'post') {
        this.banner('MATCH OVER', '#fff', 2.5);
        ctx.audio?.end();
      }
      this.lastPhase = s.ph;
    }

    for (const a of F.ALLIANCES) this.updateAlliance(a, s, view);
    this.updateRobot(view, ctx);
    if (this.showMinimap) this.drawMinimap(view, ctx);
  }

  updateAlliance(a, s, view) {
    const sb = s.s[a];
    const shelf = sb.pantry.map((l) => l.carrot + l.cake);
    const stocked = shelf.every((n) => n >= F.STOCKED_RP_PER_SHELF);
    const baked = sb.pantry.every((l) => l.cake >= 1);
    // live ENDGAME estimate: robots currently in the TABLE ZONE + what they carry
    let eg = sb.totals.endgame;
    if (s.ph === 'teleop' || s.ph === 'post') {
      eg = 0;
      for (const r of view.robots.values()) {
        const info = view.rosterById?.get(r.id);
        if (!info || info.alliance !== a) continue;
        const cfg = getRobotConfig(info.robot, info.mods);
        const poly = boxCorners({ cx: r.x, cy: r.y, hx: cfg.length / 2, hy: cfg.width / 2, th: r.th });
        if (!F.polysOverlap(poly, F.tableZonePoly(a))) continue;
        eg += F.POINTS.park;
        for (const c of r.held.slice(0, 3)) eg += c === 'k' ? F.POINTS.haulCake : F.POINTS.haulCarrot;
      }
    }
    const dinner = eg >= F.DINNER_RP_ENDGAME_POINTS;
    const pills = [
      `<span class="rp-pill ${stocked ? 'on' : ''}">STOCKED ${shelf.map((n) => Math.min(n, 3)).join('·')}</span>`,
      `<span class="rp-pill ${baked ? 'on' : ''}">BAKED ${sb.pantry.map((l) => (l.cake ? '✓' : '–')).join('')}</span>`,
      `<span class="rp-pill ${dinner ? 'on' : ''}">DINNER ${Math.min(eg, 10)}/10</span>`,
    ].join('');
    this.setHTML(`rp-${a}`, pills);
    const inv = s.inv[a];
    this.setHTML(
      `inv-${a}`,
      `<span>Depot <b>${inv[0]}</b>🥕</span><span>Cakes left <b>${inv[1]}</b></span><span>Ramp <b>${inv[3]}</b>🍰</span><span>Oven <b>${inv[2]}</b>/3</span><span>Pantry <b>${shelf.join('/')}</b></span>`,
    );
  }

  updateRobot(view, ctx) {
    const box = $('robot-status');
    const me = ctx.you ? view.robots.get(ctx.you) : null;
    box.classList.toggle('hidden', !me);
    if (!me) return;
    const info = view.rosterById.get(ctx.you);
    const cfg = getRobotConfig(info.robot, info.mods);
    this.setText('rs-title', `${info.team ? '#' + info.team + ' · ' : ''}${cfg.name}`);
    const held = me.held || '';
    let h = '';
    for (let i = 0; i < F.MAX_HELD; i++) h += `<div class="pc ${held[i] || ''}"></div>`;
    this.setHTML('rs-held', h);
    const e = cfg.elevator;
    let el = '';
    for (const k of SETPOINT_ORDER) {
      if (e.setpoints[k] > e.max) continue;
      const at = Math.abs(me.elev - e.setpoints[k]) <= e.tolerance;
      el += `<span class="${at ? 'at' : me.elevTarget === k ? 'target' : ''}">${SP_LABEL[k]}</span>`;
    }
    this.setHTML('rs-elev', el);
    const tags = [
      `<span class="${ctx.fieldOriented ? 'on' : ''}">${ctx.fieldOriented ? 'FIELD-ORIENTED' : 'ROBOT-ORIENTED'}</span>`,
      `<span>CAM: ${ctx.camName}</span>`,
      `<span class="${me.flags & 2 ? 'on' : ''}">TAXI ${me.flags & 2 ? '✓' : '·'}</span>`,
      `<span class="${me.flags & 1 ? 'on' : ''}">INTAKE</span>`,
      (cfg.mods?.mech === 'separate' || cfg.mods?.mech === 'opposite') && held.length
        ? `<span class="${me.flags & 8 ? 'on' : ''}">CARRIAGE ${me.flags & 8 ? 'LOADED' : 'reloading — stow'}</span>`
        : '',
      me.flags & 64
        ? `<span class="on">RAMP ${me.rampReq ? `${me.rampReq} cake${me.rampReq > 1 ? 's' : ''} coming` : 'press 1/2/3 for cakes'}</span>`
        : me.rampWait > 0
          ? `<span class="on">RAMP ${me.rampWait >= 1 ? 'CATCHING' : `hold still ${(1 - me.rampWait).toFixed(1)}s`}</span>`
          : '',
    ].join('');
    this.setHTML('rs-tags', tags);
  }

  drawMinimap(view, ctx) {
    const c = this.mctx;
    const W = this.minimap.width;
    const H = this.minimap.height;
    const flip = ctx.alliance === 'red'; // your alliance wall at the bottom/left
    const sx = (W - 10) / (2 * F.FIELD.halfL);
    const sy = (H - 10) / (2 * F.FIELD.halfW);
    const P = (x, y) => (flip ? [W / 2 - x * sx, H / 2 + y * sy] : [W / 2 + x * sx, H / 2 - y * sy]);
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#3d434a';
    const [ax, ay] = P(-F.FIELD.halfL, F.FIELD.halfW);
    const [bx, by] = P(F.FIELD.halfL, -F.FIELD.halfW);
    c.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    const poly = (pts, fill) => {
      c.beginPath();
      pts.forEach(([x, y], i) => {
        const [px, py] = P(x, y);
        if (i) c.lineTo(px, py);
        else c.moveTo(px, py);
      });
      c.closePath();
      c.fillStyle = fill;
      c.fill();
    };
    for (const a of F.ALLIANCES) {
      const col = a === 'red' ? 'rgba(229,56,59,' : 'rgba(47,115,238,';
      poly(F.kitchenPoly(a), col + '0.28)');
      poly(F.farmPoly(a), col + '0.28)');
      poly(F.tableZonePoly(a), col + '0.5)');
      const pb = F.pantryBox(a);
      const ob = F.ovenBox(a);
      for (const b of [pb, ob])
        poly(
          [
            [b.x0, b.y0],
            [b.x1, b.y0],
            [b.x1, b.y1],
            [b.x0, b.y1],
          ],
          col + '1)',
        );
    }
    const D = F.TABLE.baseHalfDiag;
    poly(
      [
        [D, 0],
        [0, D],
        [-D, 0],
        [0, -D],
      ],
      '#d9d9d9',
    );
    for (const p of view.pieces) {
      const [px, py] = P(p.x, p.y);
      c.fillStyle = p.type === 'cake' ? '#ff5fa8' : '#ff8a1f';
      c.fillRect(px - 2, py - 2, 4, 4);
    }
    for (const r of view.robots.values()) {
      const info = view.rosterById.get(r.id);
      if (!info) continue;
      const cfg = getRobotConfig(info.robot, info.mods);
      const pts = boxCorners({ cx: r.x, cy: r.y, hx: cfg.length / 2, hy: cfg.width / 2, th: r.th });
      poly(pts, info.alliance === 'red' ? '#ff5457' : '#4f8dff');
      const [hx, hy] = P(r.x + Math.cos(r.th) * cfg.length * 0.5, r.y + Math.sin(r.th) * cfg.length * 0.5);
      const [cx, cy] = P(r.x, r.y);
      c.strokeStyle = r.id === ctx.you ? '#fff' : 'rgba(255,255,255,0.6)';
      c.lineWidth = r.id === ctx.you ? 2.5 : 1.5;
      c.beginPath();
      c.moveTo(cx, cy);
      c.lineTo(hx, hy);
      c.stroke();
    }
  }
}

// ------------------------------------------------------------------ results table
export function renderResults(res, roster) {
  const { result, score } = res;
  const banner = $('res-banner');
  banner.className = `res-banner ${result.winner === 'tie' ? '' : result.winner}`;
  banner.textContent = result.winner === 'tie' ? 'TIE MATCH' : `${result.winner.toUpperCase()} ALLIANCE WINS`;
  $('res-red').textContent = result.red.score;
  $('res-blue').textContent = result.blue.score;
  const rows = [];
  const row = (label, fr, fb) => rows.push(`<tr><td>${fr}</td><td>${label}</td><td>${fb}</td></tr>`);
  const r = score.red;
  const b = score.blue;
  const pts = (sb, i) => `${sb.pantry[i].carrot}🥕 ${sb.pantry[i].cake}🍰`;
  row('Taxi (auto)', `${r.taxi} · ${r.totals.taxi}`, `${b.taxi} · ${b.totals.taxi}`);
  for (let i = 2; i >= 0; i--) row(`Pantry L${i + 1}`, pts(r, i), pts(b, i));
  row('Pantry points', r.totals.pantry, b.totals.pantry);
  row('Oven', `${r.ovenCarrot}🥕 ${r.ovenCake}🍰 · ${r.totals.oven}`, `${b.ovenCarrot}🥕 ${b.ovenCake}🍰 · ${b.totals.oven}`);
  row('Park / Haul', `${r.park} · ${r.haulCarrot}🥕 ${r.haulCake}🍰 · ${r.totals.endgame}`, `${b.park} · ${b.haulCarrot}🥕 ${b.haulCake}🍰 · ${b.totals.endgame}`);
  row('Foul points', `${r.minor} min · ${r.major} maj · ${r.totals.fouls}`, `${b.minor} min · ${b.major} maj · ${b.totals.fouls}`);
  rows.push(`<tr class="total"><td>${r.totals.total}</td><td>TOTAL</td><td>${b.totals.total}</td></tr>`);
  $('res-table').innerHTML = rows.join('');
  const rp = (a) => {
    const x = result[a];
    const pill = (on, t) => `<span class="rp-pill ${on ? 'on' : ''}">${t}</span>`;
    return `<span class="rp-total" style="color:${a === 'red' ? '#ff8a8c' : '#8db5ff'}">${x.rp} RP</span>${pill(x.outcome !== 'loss', x.outcome.toUpperCase())}${pill(x.stocked, 'STOCKED UP')}${pill(x.baked, 'BAKED UP')}${pill(x.dinner, 'DINNER')}`;
  };
  $('res-rp').innerHTML = `<div>${rp('red')}</div><div>${rp('blue')}</div>`;
  void roster;
}
