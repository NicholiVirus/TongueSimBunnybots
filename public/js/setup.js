// Pre-match SETUP panel: pick your starting spot on a map of your KITCHEN, your heading, and the
// robot's configuration (starting load / mechanisms). Everything is shown in "alliance view":
// your driver-station wall on the right, the pantry at the top, whichever alliance you are.

import * as F from '/shared/field.js';
import { validStartPose } from '/shared/sim.js';
import { MECHS, LOADS, sanitizeMods, sanitizeLoad, getRobotConfig } from '/shared/robots.js';

const $ = (id) => document.getElementById(id);
const X0 = 4.9;
const X1 = 8.4;
const Y0 = -1.65;
const Y1 = 4.2;
const W = 245;
const H = 410;
const SC = Math.min(W / (X1 - X0), H / (Y1 - Y0));
const HEADINGS = { pantry: Math.PI / 2, field: Math.PI, oven: -Math.PI / 2, wall: 0 };

export class SetupPanel {
  // hooks: { getInfo() -> {alliance, cfg, view, me, locked}, place(pose), start(), apply({load, mods}) }
  constructor(hooks) {
    this.h = hooks;
    this.canvas = $('setup-map');
    this.ctx = this.canvas.getContext('2d');
    this.canvas.width = Math.round((X1 - X0) * SC);
    this.canvas.height = Math.round((Y1 - Y0) * SC);
    this.th = Math.PI; // alliance-view heading of the next placement
    this.dragging = false;
    this.bind();
  }

  // ---- alliance view <-> field coordinates
  sign(a) {
    return F.sideSign(a);
  }
  toField(a, p) {
    const s = this.sign(a);
    return { x: p.x * s, y: p.y, th: s > 0 ? p.th : Math.PI - p.th };
  }
  toView(a, p) {
    return this.toField(a, p); // the mirror is its own inverse
  }

  bind() {
    const at = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * this.canvas.width;
      const py = ((e.clientY - r.top) / r.height) * this.canvas.height;
      return { x: X0 + px / SC, y: Y1 - py / SC };
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.tryPlace(at(e).x, at(e).y);
    });
    this.canvas.addEventListener('pointermove', (e) => this.dragging && this.tryPlace(at(e).x, at(e).y));
    this.canvas.addEventListener('pointerup', () => (this.dragging = false));
    for (const b of document.querySelectorAll('#setup-panel [data-head]')) b.addEventListener('click', () => this.setHeading(HEADINGS[b.dataset.head], b));
    for (const b of document.querySelectorAll('#setup-panel [data-turn]')) b.addEventListener('click', () => this.setHeading(this.currentTh() + (Number(b.dataset.turn) * Math.PI) / 180, b));
    $('setup-deg').addEventListener('input', (e) => this.setHeading((Number(e.target.value) * Math.PI) / 180));
    $('setup-start').addEventListener('click', (e) => {
      e.target.blur();
      this.h.start();
    });
    $('setup-apply').addEventListener('click', (e) => {
      e.target.blur();
      this.h.apply(this.readConfig());
    });
    for (const id of ['setup-mech', 'setup-level']) $(id).addEventListener('change', () => this.configChanged());
    for (const id of ['setup-ground', 'setup-depot', 'setup-ramp']) $(id).addEventListener('change', () => this.configChanged());
    $('setup-load').addEventListener('change', () => this.configChanged());
    $('setup-spots').addEventListener('click', (e) => {
      const b = e.target.closest('[data-spot]');
      if (!b) return;
      b.blur();
      const [x, y, th] = b.dataset.spot.split(',').map(Number);
      this.th = th;
      this.tryPlace(x, y);
    });
  }

  currentTh() {
    const i = this.h.getInfo();
    return i.me ? this.toView(i.alliance, { x: i.me.x, y: i.me.y, th: i.me.th }).th : this.th;
  }

  setHeading(th, btn) {
    btn?.blur();
    this.th = Math.atan2(Math.sin(th), Math.cos(th));
    const i = this.h.getInfo();
    if (!i.me) return;
    const v = this.toView(i.alliance, { x: i.me.x, y: i.me.y, th: i.me.th });
    this.tryPlace(v.x, v.y);
  }

  // Place at (x, y) in alliance view; if that exact spot is illegal, the nearest legal one within 0.6 m.
  tryPlace(vx, vy) {
    const i = this.h.getInfo();
    if (!i.me) return;
    const others = [...i.view.robots.values()].filter((r) => r.id !== i.me.id).map((r) => ({ x: r.x, y: r.y, th: r.th, cfg: getRobotConfig(i.roster.get(r.id)?.robot, i.roster.get(r.id)?.mods) }));
    const ok = (x, y) => validStartPose(i.cfg, i.alliance, this.toField(i.alliance, { x, y, th: this.th }), others);
    let best = null;
    if (ok(vx, vy)) best = [vx, vy];
    else {
      for (let rad = 0.05; rad <= 0.6 && !best; rad += 0.05) {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const x = vx + Math.cos(a) * rad;
          const y = vy + Math.sin(a) * rad;
          if (ok(x, y)) {
            best = [x, y];
            break;
          }
        }
      }
    }
    $('setup-msg').textContent = best ? '' : 'Not allowed there — the whole robot must be inside your KITCHEN and clear of other robots.';
    if (best) this.h.place({ ...this.toField(i.alliance, { x: best[0], y: best[1], th: this.th }) });
  }

  // ---- configuration
  readConfig() {
    return {
      load: sanitizeLoad($('setup-load').value),
      mods: sanitizeMods({ ground: $('setup-ground').checked, depot: $('setup-depot').checked, ramp: $('setup-ramp').checked, maxLevel: Number($('setup-level').value), mech: $('setup-mech').value }),
    };
  }
  configChanged() {
    $('setup-apply').classList.remove('hidden');
  }

  // called when the panel is first shown for a match
  open(info) {
    const el = $('setup-panel');
    el.classList.remove('hidden');
    $('setup-apply').classList.add('hidden');
    const c = info.cfg;
    const claw = c.mods.mech === 'claw';
    $('setup-load-row').classList.toggle('hidden', !claw);
    $('setup-load').innerHTML = Object.entries(LOADS)
      .map(([k, t]) => `<option value="${k}">${t}</option>`)
      .join('');
    $('setup-load').value = sanitizeLoad(info.load);
    $('setup-mech').innerHTML = Object.entries(MECHS)
      .map(([k, t]) => `<option value="${k}">${t}</option>`)
      .join('');
    const md = c.mods;
    $('setup-ground').checked = md.ground;
    $('setup-depot').checked = md.depot;
    $('setup-ramp').checked = md.ramp;
    $('setup-level').value = String(md.maxLevel);
    if (MECHS[md.mech]) $('setup-mech').value = md.mech;
    for (const id of ['setup-ground', 'setup-depot', 'setup-ramp', 'setup-level', 'setup-mech']) $(id).disabled = info.locked;
    $('setup-cfg-note').textContent = info.locked ? `${c.name} always plays its real build (${c.mods.mech === 'claw' ? 'claw + trader' : 'locked'}).` : '';
    const spots = [
      ['Station 1', F.startPose(info.alliance, 1)],
      ['Station 2', F.startPose(info.alliance, 2)],
      ['Station 3', F.startPose(info.alliance, 3)],
    ];
    $('setup-spots').innerHTML = spots
      .map(([t, p]) => {
        const v = this.toView(info.alliance, p);
        return `<button class="btn tiny ghost" data-spot="${v.x.toFixed(3)},${v.y.toFixed(3)},${v.th.toFixed(4)}">${t}</button>`;
      })
      .join('');
  }
  close() {
    $('setup-panel').classList.add('hidden');
  }

  // per frame: redraw the map from the live view
  draw() {
    const i = this.h.getInfo();
    if (!i.me) return;
    const c = this.ctx;
    const s = this.sign(i.alliance);
    const px = (x) => (x - X0) * SC;
    const py = (y) => (Y1 - y) * SC;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.fillStyle = '#10151f';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // KITCHEN
    c.beginPath();
    F.kitchenPoly(i.alliance).forEach(([x, y], k) => (k ? c.lineTo(px(x * s), py(y)) : c.moveTo(px(x * s), py(y))));
    c.closePath();
    c.fillStyle = s > 0 ? 'rgba(229,56,59,0.16)' : 'rgba(47,115,238,0.16)';
    c.fill();
    c.strokeStyle = s > 0 ? '#e5383b' : '#2f73ee';
    c.lineWidth = 2;
    c.stroke();
    const box = (b, fill, label) => {
      const x0 = Math.min(b.x0 * s, b.x1 * s);
      const x1 = Math.max(b.x0 * s, b.x1 * s);
      c.fillStyle = fill;
      c.fillRect(px(x0), py(b.y1), (x1 - x0) * SC, (b.y1 - b.y0) * SC);
      c.fillStyle = '#c9d3e6';
      c.font = '600 11px Inter, sans-serif';
      c.textAlign = 'center';
      c.fillText(label, px((x0 + x1) / 2), py((b.y0 + b.y1) / 2) + 4);
    };
    box(F.pantryBox(i.alliance), '#5b4a2f', 'PANTRY');
    box(F.ovenBox(i.alliance), '#7a4f1f', 'OVEN / RAMP');
    c.fillStyle = '#8f9bb0';
    c.save();
    c.translate(this.canvas.width - 6, this.canvas.height / 2);
    c.rotate(-Math.PI / 2);
    c.textAlign = 'center';
    c.fillText('DRIVER STATIONS →', 0, 0);
    c.restore();
    // robots
    for (const r of i.view.robots.values()) {
      const rc = getRobotConfig(i.roster.get(r.id)?.robot, i.roster.get(r.id)?.mods);
      const v = this.toView(i.alliance, { x: r.x, y: r.y, th: r.th });
      const mine = r.id === i.me.id;
      c.save();
      c.translate(px(v.x), py(v.y));
      c.rotate(-v.th);
      c.fillStyle = mine ? 'rgba(255,138,31,0.85)' : 'rgba(150,160,180,0.55)';
      c.fillRect((-rc.length / 2) * SC, (-rc.width / 2) * SC, rc.length * SC, rc.width * SC);
      c.strokeStyle = mine ? '#fff' : '#667';
      c.lineWidth = 1.5;
      c.strokeRect((-rc.length / 2) * SC, (-rc.width / 2) * SC, rc.length * SC, rc.width * SC);
      if (mine) {
        // front = arrow
        c.beginPath();
        c.moveTo(rc.length * 0.5 * SC + 10, 0);
        c.lineTo(rc.length * 0.5 * SC - 4, -7);
        c.lineTo(rc.length * 0.5 * SC - 4, 7);
        c.closePath();
        c.fillStyle = '#fff';
        c.fill();
        c.fillStyle = '#1a0d00';
        c.font = '700 10px Inter, sans-serif';
        c.textAlign = 'center';
        c.fillText('FRONT', rc.length * 0.25 * SC, 4);
      }
      c.restore();
    }
    const th = this.currentTh();
    const deg = Math.round((((th * 180) / Math.PI) % 360) + 360) % 360;
    $('setup-deg-out').textContent = `${deg}°`;
    if (document.activeElement !== $('setup-deg')) $('setup-deg').value = String(deg);
  }
}
