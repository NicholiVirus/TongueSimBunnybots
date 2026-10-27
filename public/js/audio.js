// Tiny synthesized field sounds (no audio files needed).
export class Audio {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    const unlock = () => {
      if (!this.ctx) {
        try {
          this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch {
          this.ctx = null;
        }
      }
      this.ctx?.resume?.();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  tone(freq, dur, { type = 'square', vol = 0.08, slide = 0, delay = 0 } = {}) {
    if (!this.enabled || !this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  beep(f = 520, d = 0.1) {
    this.tone(f, d, { type: 'sine', vol: 0.12 });
  }
  start() {
    // "charge" style start
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, { type: 'square', vol: 0.06, delay: i * 0.12 }));
  }
  end() {
    this.tone(180, 1.1, { type: 'sawtooth', vol: 0.09 });
  }
  endgame() {
    this.tone(880, 0.12, { type: 'triangle', vol: 0.12 });
    this.tone(880, 0.12, { type: 'triangle', vol: 0.12, delay: 0.2 });
  }
  score() {
    this.tone(990, 0.08, { type: 'sine', vol: 0.09, slide: 300 });
  }
  intake() {
    this.tone(300, 0.05, { type: 'sine', vol: 0.06, slide: 120 });
  }
  foul() {
    this.tone(2400, 0.35, { type: 'triangle', vol: 0.05 });
  }
}
