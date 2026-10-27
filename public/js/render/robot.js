// Robot visuals: a procedural placeholder (swerve base, bumpers, elevator, roller intake)
// or a team CAD model (.glb) when a preset sets `model` in shared/robots.js.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as F from '/shared/field.js';
import { mat, aluMat, textCanvas, labelSprite, allianceColor, COLORS } from './util.js';
import { makePieceMesh } from './pieces.js';

const BUMPER_T = 0.085;
const BUMPER_Z0 = 0.025;
const BUMPER_H = 0.13;
const loader = new GLTFLoader();
const modelCache = new Map();

function loadModel(url) {
  if (!modelCache.has(url)) modelCache.set(url, loader.loadAsync(url));
  return modelCache.get(url);
}

export class RobotView {
  constructor(info, cfg) {
    this.info = info;
    this.cfg = cfg;
    this.group = new THREE.Group();
    this.body = new THREE.Group(); // replaced by CAD when available
    this.group.add(this.body);
    this.wheels = [];
    this.modules = [];
    this.heldMeshes = [];
    this.wheelSpin = 0;
    this.rollerSpin = 0;
    this.buildBumpers();
    this.buildPlaceholder();
    this.buildHeld();
    this.label = labelSprite(`${info.team || ''} ${info.name || ''}`.trim(), info.alliance === 'red' ? '#ffb3b5' : '#b9d0ff', 1.1);
    this.label.position.y = 2.0;
    this.group.add(this.label);
    if (cfg.model?.url) this.loadCad(cfg.model);
  }

  buildBumpers() {
    const { length: Lr, width: Wr } = this.cfg;
    const color = allianceColor(this.info.alliance);
    const fabric = mat(color, { roughness: 0.9 });
    const g = new THREE.Group();
    const y = BUMPER_Z0 + BUMPER_H / 2;
    const add = (sx, sz, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, BUMPER_H, sz), fabric);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
    };
    add(BUMPER_T, Wr, Lr / 2 - BUMPER_T / 2, 0);
    add(BUMPER_T, Wr, -Lr / 2 + BUMPER_T / 2, 0);
    add(Lr - 2 * BUMPER_T, BUMPER_T, 0, Wr / 2 - BUMPER_T / 2);
    add(Lr - 2 * BUMPER_T, BUMPER_T, 0, -Wr / 2 + BUMPER_T / 2);
    // team numbers on all four sides
    const num = String(this.info.team || '0000');
    const tex = textCanvas(num, { w: 512, h: 128, font: 'bold 112px "Barlow Condensed", Arial Narrow, sans-serif', color: '#ffffff' });
    const nm = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const plane = (w, x, z, ry) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, BUMPER_H * 0.9), nm);
      p.position.set(x, y, z);
      p.rotation.y = ry;
      g.add(p);
    };
    const e = 0.002;
    plane(Math.min(Wr * 0.8, 0.5), Lr / 2 + e, 0, Math.PI / 2);
    plane(Math.min(Wr * 0.8, 0.5), -Lr / 2 - e, 0, -Math.PI / 2);
    plane(Math.min(Lr * 0.6, 0.5), 0, Wr / 2 + e, 0);
    plane(Math.min(Lr * 0.6, 0.5), 0, -Wr / 2 - e, Math.PI);
    this.bumpers = g;
    this.group.add(g);
  }

  buildPlaceholder() {
    const c = this.cfg;
    const b = this.body;
    const fl = c.length - 2 * BUMPER_T; // frame
    const fw = c.width - 2 * BUMPER_T;
    const alu = aluMat();
    const dark = mat(0x22262d, { roughness: 0.7 });
    const tube = (sx, sy, sz, x, y, z, m = alu) => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
      t.position.set(x, y, z);
      t.castShadow = true;
      b.add(t);
      return t;
    };
    // frame rails + belly pan
    tube(fl, 0.05, 0.025, 0, 0.09, fw / 2 - 0.0125);
    tube(fl, 0.05, 0.025, 0, 0.09, -fw / 2 + 0.0125);
    tube(0.025, 0.05, fw, fl / 2 - 0.0125, 0.09, 0);
    tube(0.025, 0.05, fw, -fl / 2 + 0.0125, 0.09, 0);
    tube(fl - 0.05, 0.006, fw - 0.05, 0, 0.068, 0, mat(0x9aa3ad, { metalness: 0.4, roughness: 0.6 }));

    // swerve modules
    const wheelGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.035, 18);
    wheelGeo.rotateX(Math.PI / 2);
    const tread = mat(0x111111, { roughness: 0.95 });
    const housing = mat(0x2d3440, { metalness: 0.3 });
    for (const [sx, sz] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const mod = new THREE.Group();
      mod.position.set(sx * (fl / 2 - 0.075), 0.05, sz * (fw / 2 - 0.075));
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.07, 16), housing);
      h.position.y = 0.075;
      h.castShadow = true;
      mod.add(h);
      const w = new THREE.Mesh(wheelGeo, tread);
      w.castShadow = true;
      mod.add(w);
      b.add(mod);
      this.modules.push({ g: mod, x: mod.position.x, z: mod.position.z });
      this.wheels.push(w);
    }
    // electronics
    tube(0.17, 0.08, 0.19, -fl / 2 + 0.16, 0.11, fw / 2 - 0.2, mat(0x101010));
    tube(0.14, 0.03, 0.11, -fl / 2 + 0.2, 0.085, -fw / 2 + 0.2, mat(0x3b3f46));
    tube(0.08, 0.02, 0.06, -fl / 2 + 0.33, 0.08, 0, mat(0xd4a017));

    // elevator (2 stages + carriage)
    const e = c.elevator;
    const h1 = Math.max(0.6, e.max * 0.62);
    const ex = -0.12;
    const rz = fw / 2 - 0.1;
    for (const z of [rz, -rz]) tube(0.04, h1, 0.04, ex, 0.11 + h1 / 2, z);
    tube(0.04, 0.04, 2 * rz + 0.04, ex, 0.11 + h1, 0);
    // diagonal braces from the front
    for (const z of [rz, -rz]) {
      const br = tube(0.025, h1 * 0.9, 0.025, ex + 0.16, 0.11 + h1 * 0.42, z);
      br.rotation.z = 0.32;
    }
    this.stage2 = new THREE.Group();
    for (const z of [rz - 0.045, -(rz - 0.045)]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.035, h1, 0.035), alu);
      t.position.set(ex + 0.01, h1 / 2, z);
      t.castShadow = true;
      this.stage2.add(t);
    }
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 2 * (rz - 0.045)), alu);
    cross.position.set(ex + 0.01, h1, 0);
    this.stage2.add(cross);
    this.stage2.position.y = 0.13;
    b.add(this.stage2);
    this.h1 = h1;

    this.carriage = new THREE.Group();
    const cm = mat(0x343b47, { metalness: 0.3 });
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.015, Math.min(fw - 0.2, F.PIECE.length + 0.08)), cm);
    tray.position.set(ex, -0.008, 0);
    this.carriage.add(tray);
    for (const z of [1, -1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.012), cm);
      plate.position.set(ex, 0.1, z * (F.PIECE.length / 2 + 0.03));
      plate.castShadow = true;
      this.carriage.add(plate);
    }
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.3), new THREE.MeshBasicMaterial({ color: allianceColor(this.info.alliance) }));
    led.position.set(ex + 0.11, 0.18, 0);
    this.carriage.add(led);
    b.add(this.carriage);

    // ground intake: side plates + compliant-wheel roller
    const ix = fl / 2 + 0.02;
    const iw = c.intakeWidth;
    for (const z of [iw / 2 + 0.01, -iw / 2 - 0.01]) {
      const p = tube(0.2, 0.12, 0.012, ix - 0.04, 0.12, z, mat(0x2f3540));
      p.rotation.z = -0.25;
    }
    this.roller = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, iw, 8), alu);
    bar.rotation.x = Math.PI / 2;
    this.roller.add(bar);
    const wm = mat(0x41b04f, { roughness: 0.9 });
    const n = Math.max(3, Math.round(iw / 0.11));
    for (let i = 0; i < n; i++) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 10), wm);
      w.rotation.x = Math.PI / 2;
      w.position.z = -iw / 2 + 0.03 + ((iw - 0.06) * i) / (n - 1);
      this.roller.add(w);
    }
    this.rollerOut = [c.length / 2 + 0.05, 0.075];
    this.rollerIn = [fl / 2 - 0.04, 0.22];
    this.deploy = 0;
    this.roller.position.set(this.rollerIn[0], this.rollerIn[1], 0);
    b.add(this.roller);

    // "CAD goes here" badge on the elevator cross-bar
    const badge = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.085),
      new THREE.MeshBasicMaterial({ map: textCanvas('PLACEHOLDER', { w: 512, h: 128, font: 'bold 84px "Barlow Condensed", sans-serif', color: '#1a0d00', bg: '#ffb35c' }) }),
    );
    badge.position.set(ex + 0.025, 0.11 + h1 - 0.06, 0);
    badge.rotation.y = Math.PI / 2;
    b.add(badge);
  }

  buildHeld() {
    for (let i = 0; i < F.MAX_HELD; i++) {
      const pair = { c: makePieceMesh('carrot'), k: makePieceMesh('cake') };
      for (const m of [pair.c, pair.k]) {
        m.visible = false;
        m.rotation.y = Math.PI / 2; // roller axis across the robot
        this.group.add(m);
      }
      this.heldMeshes.push(pair);
    }
  }

  async loadCad(model) {
    try {
      const gltf = await loadModel(model.url);
      const cad = gltf.scene.clone(true);
      cad.scale.setScalar(model.scale ?? 1);
      cad.rotation.y = ((model.yaw ?? 0) * Math.PI) / 180;
      cad.position.y = model.z ?? 0;
      cad.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.cadElevator = model.elevatorNode ? cad.getObjectByName(model.elevatorNode) : null;
      this.cadElevatorBase = this.cadElevator?.position.y ?? 0;
      this.group.remove(this.body);
      this.body = cad;
      this.group.add(cad);
      if (model.hideBumpers) this.bumpers.visible = false;
      this.stage2 = null;
      this.carriage = null;
      this.roller = null;
      this.modules = [];
      this.wheels = [];
    } catch (err) {
      console.warn('Robot CAD failed to load, keeping placeholder:', model.url, err);
    }
  }

  // state: {x,y,th,elev,held,flags,vx,vy,w}
  update(st, dt) {
    const g = this.group;
    g.position.set(st.x, 0, -st.y);
    g.rotation.y = st.th;
    const e = this.cfg.elevator;
    const lift = st.elev - e.min;
    if (this.carriage) this.carriage.position.y = st.elev;
    if (this.stage2) this.stage2.position.y = 0.13 + Math.max(0, Math.min(this.h1 - 0.05, lift * 0.55));
    if (this.cadElevator) this.cadElevator.position.y = this.cadElevatorBase + lift / (this.cfg.model?.scale ?? 1);

    // swerve module steering + wheel spin
    const c = Math.cos(st.th);
    const s = Math.sin(st.th);
    const lvx = (st.vx || 0) * c + (st.vy || 0) * s;
    const lvy = -(st.vx || 0) * s + (st.vy || 0) * c;
    const w = st.w || 0;
    for (let i = 0; i < this.modules.length; i++) {
      const m = this.modules[i];
      // module position in robot frame (x fwd, y left) = (m.x, -m.z)
      const mvx = lvx - w * -m.z;
      const mvy = lvy + w * m.x;
      const sp = Math.hypot(mvx, mvy);
      if (sp > 0.05) m.g.rotation.y = Math.atan2(mvy, mvx);
      this.wheels[i].rotation.z -= (sp / 0.05) * dt;
    }
    if (this.roller) {
      const on = !!(st.flags & 1);
      this.deploy += ((on ? 1 : 0) - this.deploy) * Math.min(1, dt * 12);
      const d = this.deploy;
      this.roller.position.x = this.rollerIn[0] + (this.rollerOut[0] - this.rollerIn[0]) * d;
      this.roller.position.y = this.rollerIn[1] + (this.rollerOut[1] - this.rollerIn[1]) * d;
      if (on) this.roller.rotation.z += dt * 22;
    }

    // held pieces ride on the carriage
    const held = st.held || '';
    for (let i = 0; i < this.heldMeshes.length; i++) {
      const pair = this.heldMeshes[i];
      const t = held[i];
      pair.c.visible = t === 'c';
      pair.k.visible = t === 'k';
      const m = t === 'k' ? pair.k : pair.c;
      m.position.set(-0.12, st.elev + i * 0.16 + F.PIECE.radius + 0.01, 0);
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
}

export const robotColor = (a) => (a === 'red' ? COLORS.red : COLORS.blue);
