// Starting-position picker in the main menu: shows your KITCHEN from above (driver-station wall on the
// right, pantry at the top); click/drag to place the robot, choose its heading. The pose is saved in this
// "alliance view" and mirrored for blue when the match starts.

import * as F from '/shared/field.js';
import { validStartPose } from '/shared/sim.js';

const $ = (id) => document.getElementById(id);
const X0 = 4.9;
const X1 = 8.4;
const Y0 = -1.65;
const Y1 = 4.2;
const SC = 60;
const HEADINGS = { pantry: Math.PI / 2, field: Math.PI, oven: -Math.PI / 2, wall: 0 };
const KITCHEN = F.kitchenPoly('red');

export class StartPicker {
  // hooks: { getPose() -> {x,y,th}, getCfg() -> robot config, setPose(pose) }
  constructor(hooks) {
    this.h = hooks;
    this.canvas = $('setup-map');
    this.ctx = this.canvas.getContext('2d');
    this.canvas.width = Math.round((X1 - X0) * SC);
    this.canvas.height = Math.round((Y1 - Y0) * SC);
    this.dragging = false;
    this.bind();
  }

  bind() {
    const at = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return { x: X0 + (((e.clientX - r.left) / r.width) * this.canvas.width) / SC, y: Y1 - (((e.clientY - r.top) / r.height) * this.canvas.height) / SC };
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.tryPlace(at(e).x, at(e).y);
    });
    this.canvas.addEventListener('pointermove', (e) => this.dragging && this.tryPlace(at(e).x, at(e).y));
    this.canvas.addEventListener('pointerup', () => (this.dragging = false));
    for (const b of document.querySelectorAll('#start-cfg [data-head]')) {
      b.addEventListener('click', () => {
        if (b.dataset.head === 'reset') this.set({ x: 7.55, y: 0.95, th: Math.PI });
        else this.turnTo(HEADINGS[b.dataset.head]);
      });
    }
    for (const b of document.querySelectorAll('#start-cfg [data-turn]')) b.addEventListener('click', () => this.turnTo(this.h.getPose().th + (Number(b.dataset.turn) * Math.PI) / 180));
    $('setup-deg').addEventListener('input', (e) => this.turnTo((Number(e.target.value) * Math.PI) / 180));
    const spots = [1, 2, 3].map((n) => ({ n, p: F.startPose('red', n) }));
    $('setup-spots').innerHTML = spots.map(({ n }) => `<button class="btn tiny ghost" data-spot="${n}">Station ${n}</button>`).join('');
    $('setup-spots').addEventListener('click', (e) => {
      const b = e.target.closest('[data-spot]');
      if (b) this.set(spots[Number(b.dataset.spot) - 1].p);
    });
  }

  turnTo(th) {
    const p = this.h.getPose();
    this.tryPlace(p.x, p.y, Math.atan2(Math.sin(th), Math.cos(th)));
  }

  set(pose) {
    $('setup-msg').textContent = '';
    this.h.setPose(pose);
    this.draw();
  }

  // Place at (x, y) with heading th; if that exact spot is illegal, the nearest legal one within 0.6 m.
  tryPlace(x, y, th = this.h.getPose().th) {
    const cfg = this.h.getCfg();
    const ok = (px, py) => validStartPose(cfg, 'red', { x: px, y: py, th }, []);
    let best = ok(x, y) ? [x, y] : null;
    for (let rad = 0.05; rad <= 0.6 && !best; rad += 0.05) {
      for (let k = 0; k < 16 && !best; k++) {
        const a = (k / 16) * Math.PI * 2;
        if (ok(x + Math.cos(a) * rad, y + Math.sin(a) * rad)) best = [x + Math.cos(a) * rad, y + Math.sin(a) * rad];
      }
    }
    $('setup-msg').textContent = best ? '' : 'Not allowed there — the whole robot must be inside your KITCHEN.';
    if (best) this.set({ x: best[0], y: best[1], th });
  }

  draw() {
    if (!this.h.getCfg) return;
    const c = this.ctx;
    const cfg = this.h.getCfg();
    const p = this.h.getPose();
    const px = (x) => (x - X0) * SC;
    const py = (y) => (Y1 - y) * SC;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.fillStyle = '#10151f';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.beginPath();
    KITCHEN.forEach(([x, y], k) => (k ? c.lineTo(px(x), py(y)) : c.moveTo(px(x), py(y))));
    c.closePath();
    c.fillStyle = 'rgba(229,56,59,0.16)';
    c.fill();
    c.strokeStyle = '#e5383b';
    c.lineWidth = 2;
    c.stroke();
    const box = (b, fill, label) => {
      c.fillStyle = fill;
      c.fillRect(px(b.x0), py(b.y1), (b.x1 - b.x0) * SC, (b.y1 - b.y0) * SC);
      c.fillStyle = '#c9d3e6';
      c.font = '600 11px Inter, sans-serif';
      c.textAlign = 'center';
      c.fillText(label, px((b.x0 + b.x1) / 2), py((b.y0 + b.y1) / 2) + 4);
    };
    box(F.pantryBox('red'), '#5b4a2f', 'PANTRY');
    box(F.ovenBox('red'), '#7a4f1f', 'OVEN / RAMP');
    c.fillStyle = '#8f9bb0';
    c.save();
    c.translate(this.canvas.width - 6, this.canvas.height / 2);
    c.rotate(-Math.PI / 2);
    c.textAlign = 'center';
    c.fillText('DRIVER STATIONS →', 0, 0);
    c.restore();
    const legal = validStartPose(cfg, 'red', p, []);
    c.save();
    c.translate(px(p.x), py(p.y));
    c.rotate(-p.th);
    c.fillStyle = legal ? 'rgba(255,138,31,0.85)' : 'rgba(229,56,59,0.6)';
    c.fillRect((-cfg.length / 2) * SC, (-cfg.width / 2) * SC, cfg.length * SC, cfg.width * SC);
    c.strokeStyle = '#fff';
    c.lineWidth = 1.5;
    c.strokeRect((-cfg.length / 2) * SC, (-cfg.width / 2) * SC, cfg.length * SC, cfg.width * SC);
    c.beginPath();
    c.moveTo(cfg.length * 0.5 * SC + 10, 0);
    c.lineTo(cfg.length * 0.5 * SC - 4, -7);
    c.lineTo(cfg.length * 0.5 * SC - 4, 7);
    c.closePath();
    c.fillStyle = '#fff';
    c.fill();
    c.fillStyle = '#1a0d00';
    c.font = '700 10px Inter, sans-serif';
    c.textAlign = 'center';
    c.fillText('FRONT', cfg.length * 0.22 * SC, 4);
    c.restore();
    const deg = Math.round((((p.th * 180) / Math.PI) % 360) + 360) % 360;
    $('setup-deg-out').textContent = `${deg}°`;
    $('setup-deg').value = String(deg);
  }
}
