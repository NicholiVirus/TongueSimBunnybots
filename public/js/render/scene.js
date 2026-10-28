import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as F from '/shared/field.js';
import { getRobotConfig } from '/shared/robots.js';
import { buildField } from './field.js';
import { RobotView } from './robot.js';
import { PieceLayer } from './pieces.js';

const PLAYER_CAMS = ['driver', 'chase', 'top', 'broadcast'];
const SPECTATOR_CAMS = ['broadcast', 'top', 'orbit'];
const CAM_NAMES = { driver: 'Driver station', chase: 'Chase', top: 'Overhead', broadcast: 'Broadcast', orbit: 'Free orbit' };

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const dampAngle = (a, b, k, dt) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * (1 - Math.exp(-k * dt));

export class SceneView {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x10141b);
    this.scene.fog = new THREE.Fog(0x10141b, 30, 60);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
    this.camera.position.set(0, 8, 14);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 30;
    this.controls.enabled = false;

    this.addLights();
    this.scene.add(buildField());
    this.rampSigns = Object.fromEntries(F.ALLIANCES.map((a) => [a, this.makeRampSign(a)]));
    this.pieces = new PieceLayer(this.scene);
    this.robots = new Map();
    this.mode = 'menu';
    this.camMode = 'chase';
    this.you = null;
    this.alliance = 'red';
    this.station = 2;
    this.lookAt = new THREE.Vector3();
    this.chaseYaw = 0;
    this.menuT = 0;
    this.setQuality('high');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  addLights() {
    const hemi = new THREE.HemisphereLight(0xe6eeff, 0x2a2e36, 1.1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.3);
    sun.position.set(3, 16, 5);
    sun.target.position.set(0, 0, 0);
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -10;
    sc.right = 10;
    sc.top = 7;
    sc.bottom = -7;
    sc.near = 2;
    sc.far = 40;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.sun = sun;
    this.scene.add(sun, sun.target);
    // arena light banks
    for (const x of [-6, 0, 6]) {
      const p = new THREE.PointLight(0xfff3e0, 18, 22, 1.6);
      p.position.set(x, 9, 0);
      this.scene.add(p);
    }
  }

  // Scoreboard-style sign above each RAMP showing how many CARROT CAKES are stored there.
  makeRampSign(a) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    const s = F.sideSign(a);
    sign.position.set(s * (F.FIELD.halfL - 0.05), F.OVEN.rampHigh + 0.45, -F.OVEN.yc);
    sign.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2; // face into the field
    this.scene.add(sign);
    const st = { c, tex, sign, a, n: -1 };
    this.drawRampSign(st, 0);
    return st;
  }

  drawRampSign(st, n) {
    const g = st.c.getContext('2d');
    g.fillStyle = st.a === 'red' ? '#7d1a1f' : '#15347a';
    g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 6;
    g.strokeRect(3, 3, 250, 122);
    g.fillStyle = '#ffd84a';
    g.font = 'bold 30px "Barlow Condensed", Arial Narrow, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('CAKES STORED', 128, 30);
    g.fillStyle = '#ffffff';
    g.font = 'bold 76px "Barlow Condensed", Arial Narrow, sans-serif';
    g.fillText(String(n), 128, 84);
    st.tex.needsUpdate = true;
    st.n = n;
  }

  setRampSign(a, n) {
    const st = this.rampSigns[a];
    if (st.n !== n) this.drawRampSign(st, n);
  }

  setQuality(q) {
    this.quality = q;
    const high = q !== 'low';
    this.renderer.shadowMap.enabled = high;
    this.sun.castShadow = high;
    this.renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio, 2) : 1);
    this.scene.traverse((o) => {
      if (o.material) o.material.needsUpdate = true;
    });
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- match lifecycle
  setMatch(roster, you, preferredCam) {
    this.clearMatch();
    this.you = you;
    const me = roster.find((r) => r.id === you);
    this.alliance = me?.alliance || 'red';
    this.station = me?.station || 2;
    this.camFlip = me?.mods?.mech === 'opposite' ? Math.PI : 0;
    for (const info of roster) {
      const rv = new RobotView(info, getRobotConfig(info.robot, info.mods));
      if (info.id === you) rv.label.visible = false;
      this.robots.set(info.id, rv);
      this.scene.add(rv.group);
    }
    this.mode = you ? 'player' : 'spectator';
    const cams = this.cams();
    this.camMode = cams.includes(preferredCam) ? preferredCam : cams[0];
    this.controls.enabled = this.camMode === 'orbit';
    this.snapCamera = true;
  }

  clearMatch() {
    for (const rv of this.robots.values()) {
      this.scene.remove(rv.group);
      rv.dispose();
    }
    this.robots.clear();
    this.pieces.clear();
    this.mode = 'menu';
    this.controls.enabled = false;
  }

  cams() {
    return this.mode === 'player' ? PLAYER_CAMS : SPECTATOR_CAMS;
  }

  cycleCamera() {
    const cams = this.cams();
    this.camMode = cams[(cams.indexOf(this.camMode) + 1) % cams.length];
    this.controls.enabled = this.camMode === 'orbit';
    if (this.camMode === 'orbit') this.controls.target.set(0, 0, 0);
    this.snapCamera = true;
    return CAM_NAMES[this.camMode];
  }

  camName() {
    return CAM_NAMES[this.camMode] || this.camMode;
  }

  // Unit "forward" for camera-relative driving, in field coords.
  controlForward() {
    const s = F.sideSign(this.alliance);
    if (this.camMode === 'driver' || this.camMode === 'top') return [-s, 0];
    if (this.camMode === 'broadcast') return [0, -1];
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    const n = Math.hypot(d.x, d.z) || 1;
    return [d.x / n, -d.z / n];
  }

  // ---------------------------------------------------------------- per-frame
  render(view, dt) {
    if (this.mode === 'menu' || !view) {
      this.menuT += dt;
      const a = this.menuT * 0.06 + 0.6;
      this.camera.position.set(Math.cos(a) * 13, 5.5, Math.sin(a) * 9);
      this.camera.lookAt(0, 0.3, 0);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    for (const [id, st] of view.robots) {
      const rv = this.robots.get(id);
      if (rv) rv.update(st, dt);
    }
    this.pieces.update(view.pieces);
    for (const a of F.ALLIANCES) this.setRampSign(a, view.snap.inv?.[a]?.[3] ?? 0);
    this.updateCamera(view, dt);
    this.renderer.render(this.scene, this.camera);
  }

  updateCamera(view, dt) {
    const me = this.you ? view.robots.get(this.you) : null;
    const s = F.sideSign(this.alliance);
    const cam = this.camera;
    const k = this.snapCamera ? 1e6 : 1;
    this.snapCamera = false;
    let pos;
    let look;
    switch (this.camMode) {
      case 'driver': {
        const y = F.DRIVER_STATION_Y[(this.station || 2) - 1];
        pos = new THREE.Vector3(s * (F.FIELD.halfL + 1.0), 1.85, -y);
        const tx = me ? me.x * 0.65 + -s * 2 * 0.35 : -s * 2;
        const ty = me ? me.y * 0.65 : 0;
        look = new THREE.Vector3(tx, 0.2, -ty);
        break;
      }
      case 'chase': {
        if (!me) break;
        // camera sits opposite the scoring side (in front of an elevator-back robot)
        const yaw = me.th + (this.camFlip || 0);
        this.chaseYaw = k > 1 ? yaw : dampAngle(this.chaseYaw, yaw, 10, dt);
        const back = 3.1;
        pos = new THREE.Vector3(me.x - Math.cos(this.chaseYaw) * back, 2.35 + me.elev * 0.3, -(me.y - Math.sin(this.chaseYaw) * back));
        // keep the camera inside the field walls; rise up instead of going behind the alliance wall
        const lx = F.FIELD.halfL - 0.2;
        const ly = F.FIELD.halfW - 0.2;
        const over = Math.max(Math.abs(pos.x) - lx, Math.abs(pos.z) - ly, 0);
        pos.x = Math.max(-lx, Math.min(lx, pos.x));
        pos.z = Math.max(-ly, Math.min(ly, pos.z));
        pos.y += over * 0.9;
        look = new THREE.Vector3(me.x + Math.cos(this.chaseYaw) * 2.2, 0.35, -(me.y + Math.sin(this.chaseYaw) * 2.2));
        break;
      }
      case 'top':
        pos = new THREE.Vector3(s * 5.5, 14, 0.001);
        look = new THREE.Vector3(-s * 0.6, 0, 0);
        break;
      case 'broadcast':
        pos = new THREE.Vector3(me ? me.x * 0.25 : 0, 6.2, -(F.FIELD.halfW + 7.2));
        look = new THREE.Vector3(me ? me.x * 0.35 : 0, 0, -0.4);
        break;
      case 'orbit':
        this.controls.update();
        return;
      default:
    }
    if (!pos) return;
    if (!Number.isFinite(cam.position.x + this.lookAt.x)) {
      cam.position.set(0, 8, 14);
      this.lookAt.set(0, 0, 0);
    }
    const kk = k > 1 ? 1e6 : 6;
    cam.position.set(damp(cam.position.x, pos.x, kk, dt), damp(cam.position.y, pos.y, kk, dt), damp(cam.position.z, pos.z, kk, dt));
    this.lookAt.set(damp(this.lookAt.x, look.x, kk, dt), damp(this.lookAt.y, look.y, kk, dt), damp(this.lookAt.z, look.z, kk, dt));
    cam.lookAt(this.lookAt);
  }
}
