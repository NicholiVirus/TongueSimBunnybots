// Keyboard + gamepad -> one compact input sample per 60 Hz tick (and controller menu navigation).

const SP_KEYS = { Digit1: 'l1', Digit2: 'l2', Digit3: 'l3', Digit4: 'oven', KeyR: 'stow', Numpad1: 'l1', Numpad2: 'l2', Numpad3: 'l3', Numpad4: 'oven' };
const PAD_SP = { 0: 'l1', 1: 'l2', 3: 'l3', 2: 'oven', 4: 'stow' };
const DEAD = 0.12;

const dz = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

export class Input {
  constructor() {
    this.keys = new Set();
    this.spHold = 0;
    this.sp = null;
    this.ejectHold = 0;
    this.actions = []; // one-shot UI actions: camera, orient, pause, minimap, chat
    this.padPrev = [];
    this.enabled = true;
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
  }

  onKey(e, down) {
    const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA');
    if (typing) return;
    if (!down) {
      this.keys.delete(e.code);
      return;
    }
    if (e.code === 'Escape') this.actions.push('pause');
    if (!this.enabled) return;
    if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (SP_KEYS[e.code]) this.setSp(SP_KEYS[e.code]);
    if (e.code === 'KeyG') this.ejectHold = 3;
    if (e.code === 'KeyK') this.tongueHold = 3;
    if (e.code === 'KeyF' || e.code === 'Enter') this.scoreHold = 6; // a quick tap still scores
    if (e.code === 'KeyC') this.actions.push('camera');
    if (e.code === 'KeyV') this.actions.push('orient');
    if (e.code === 'KeyM') this.actions.push('minimap');
    if (e.code === 'KeyT' && this.onChat) {
      e.preventDefault();
      this.onChat();
    }
  }

  setSp(sp) {
    this.sp = sp;
    this.spHold = 10; // repeat for a few ticks so it survives a dropped packet
  }

  // Read every connected controller once per frame. In a match the buttons drive the robot; while a menu is
  // open they navigate it instead (D-pad / left stick to move, A to press, B to go back). Start = pause.
  pollPads(ui, dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const state = { lx: 0, ly: 0, rx: 0, intake: false, score: false, align: false };
    let any = false;
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const b = (i) => !!gp.buttons[i]?.pressed || (gp.buttons[i]?.value || 0) > 0.4;
      const prev = this.padPrev[gp.index] || [];
      const edge = (i) => b(i) && !prev[i];
      const lx = dz(gp.axes[0] || 0);
      const ly = dz(gp.axes[1] || 0);
      const rx = dz(gp.axes[2] || 0);
      if (Math.hypot(lx, ly) > Math.hypot(state.lx, state.ly)) {
        state.lx = lx;
        state.ly = ly;
      }
      if (Math.abs(rx) > Math.abs(state.rx)) state.rx = rx;
      if (gp.buttons.some((_, i) => b(i)) || lx || ly || rx) any = true;
      if (edge(9)) this.actions.push('pause');
      if (ui) {
        // menu navigation, with auto-repeat while a direction is held
        const dir = b(12) || ly < -0.6 ? 'up' : b(13) || ly > 0.6 ? 'down' : b(14) || lx < -0.6 ? 'left' : b(15) || lx > 0.6 ? 'right' : null;
        if (dir !== this.navDir) {
          this.navDir = dir;
          this.navT = 0.4;
          if (dir) this.actions.push(`ui:${dir}`);
        } else if (dir && (this.navT -= dt) <= 0) {
          this.navT = 0.12;
          this.actions.push(`ui:${dir}`);
        }
        if (edge(0)) this.actions.push('ui:accept');
        if (edge(1)) this.actions.push('ui:back');
      } else if (this.enabled) {
        if (b(7)) state.intake = true;
        if (b(5)) state.score = true;
        if (edge(5)) this.scoreHold = 6;
        if (b(6)) state.align = true;
        if (edge(13)) this.ejectHold = 3;
        if (edge(11)) this.tongueHold = 3;
        for (const [i, sp] of Object.entries(PAD_SP)) if (edge(Number(i))) this.setSp(sp);
        if (edge(8)) this.actions.push('camera');
        if (edge(10)) this.actions.push('orient');
        if (edge(12)) this.actions.push('minimap');
      }
      this.padPrev[gp.index] = gp.buttons.map((_, i) => b(i));
    }
    if (any) this.usingPad = true;
    this.pad = ui ? null : state;
  }

  takeActions() {
    const a = this.actions;
    this.actions = [];
    return a;
  }

  // forward: unit field vector "away from the driver"; heading: robot heading (robot-oriented mode)
  sample({ forward, heading, fieldOriented, autoStow }) {
    const k = this.enabled ? this.keys : new Set();
    let fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    let strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    let rot = (k.has('KeyQ') || k.has('ArrowLeft') || k.has('KeyJ') ? 1 : 0) - (k.has('KeyE') || k.has('ArrowRight') || k.has('KeyL') ? 1 : 0);
    let intake = k.has('ShiftLeft') || k.has('ShiftRight');
    let align = k.has('Space');
    let score = k.has('KeyF') || k.has('Enter') || this.scoreHold > 0;
    if (this.scoreHold > 0) this.scoreHold--;
    const kbd = Math.hypot(fwd, strafe);
    if (kbd > 1) {
      fwd /= kbd;
      strafe /= kbd;
    }

    // controller (polled once per frame in pollPads)
    const p = this.pad;
    if (this.enabled && p) {
      if (Math.hypot(p.lx, p.ly) > 0) {
        fwd = -p.ly;
        strafe = p.lx;
      }
      if (p.rx) rot = -p.rx;
      intake ||= p.intake;
      score ||= p.score;
      align ||= p.align;
    }

    let fx;
    let fy;
    if (fieldOriented) {
      fx = forward[0];
      fy = forward[1];
    } else {
      fx = Math.cos(heading);
      fy = Math.sin(heading);
    }
    // right-hand vector = forward x up
    const rx2 = fy;
    const ry2 = -fx;
    const mx = fx * fwd + rx2 * strafe;
    const my = fy * fwd + ry2 * strafe;

    const out = { mx: round(mx), my: round(my), rot: round(rot), in: intake, sc: score, ej: this.ejectHold > 0, al: align, tg: this.tongueHold > 0, as: autoStow };
    if (this.tongueHold > 0) this.tongueHold--;
    if (this.spHold > 0) {
      out.sp = this.sp;
      this.spHold--;
    }
    if (this.ejectHold > 0) this.ejectHold--;
    return out;
  }
}

const round = (v) => Math.round(v * 1000) / 1000;
