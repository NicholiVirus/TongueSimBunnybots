// Thin WebSocket wrapper with message handlers and auto-reconnect on demand.
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.id = null;
    this.rtt = 0;
    this.queue = [];
  }

  on(type, fn) {
    this.handlers.set(type, fn);
  }

  get connected() {
    return this.ws && this.ws.readyState === 1;
  }

  connect() {
    if (this.ws && this.ws.readyState <= 1) return this.ready;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = () => {
        for (const m of this.queue) this.ws.send(m);
        this.queue = [];
        this.pingTimer = setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 2000);
        resolve();
      };
      this.ws.onerror = () => reject(new Error('Could not reach the game server'));
    });
    this.ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'welcome') this.id = msg.id;
      if (msg.t === 'pong') this.rtt = performance.now() - msg.ts;
      this.handlers.get(msg.t)?.(msg);
    };
    this.ws.onclose = () => {
      clearInterval(this.pingTimer);
      this.handlers.get('close')?.();
    };
    return this.ready;
  }

  send(obj) {
    const s = JSON.stringify(obj);
    if (this.connected) this.ws.send(s);
    else if (this.ws && this.ws.readyState === 0) this.queue.push(s);
  }
}
