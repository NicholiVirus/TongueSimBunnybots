import * as THREE from 'three';
import * as F from '/shared/field.js';
import { mat } from './util.js';

const R = F.PIECE.radius;
const LEN = F.PIECE.length;

let geo = null;
function geos() {
  if (geo) return geo;
  const body = new THREE.CylinderGeometry(R, R, LEN - 0.01, 22, 1, true);
  body.rotateZ(Math.PI / 2);
  const cap = new THREE.CircleGeometry(R, 22);
  const ring = new THREE.CylinderGeometry(R + 0.003, R + 0.003, 0.09, 22, 1, true);
  ring.rotateZ(Math.PI / 2);
  const stripe = new THREE.CylinderGeometry(R + 0.005, R + 0.005, 0.03, 22, 1, true);
  stripe.rotateZ(Math.PI / 2);
  // foam texture stripes so rolling is visible
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#ff7f22';
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = 'rgba(160,60,0,0.35)';
  for (let i = 0; i < 4; i++) g.fillRect(i * 32 + 4, 0, 6, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  geo = {
    body,
    cap,
    ring,
    stripe,
    foam: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
    capMat: mat(0xd7600e, { roughness: 0.95, side: THREE.DoubleSide }),
    tape: mat(0xffffff, { roughness: 0.4 }),
    tapePink: mat(0xff4fa3, { roughness: 0.4, emissive: 0x4a0a2a, emissiveIntensity: 0.4 }),
  };
  return geo;
}

// Roller with its axis along local +X, centered at the origin.
export function makePieceMesh(type) {
  const G = geos();
  const g = new THREE.Group();
  const spin = new THREE.Group(); // rotates about the roller axis
  g.add(spin);
  const body = new THREE.Mesh(G.body, G.foam);
  body.castShadow = true;
  body.receiveShadow = true;
  spin.add(body);
  for (const sx of [1, -1]) {
    const cp = new THREE.Mesh(G.cap, G.capMat);
    cp.position.x = (sx * (LEN - 0.01)) / 2;
    cp.rotation.y = (sx * Math.PI) / 2;
    spin.add(cp);
  }
  if (type === 'cake') {
    spin.add(new THREE.Mesh(G.ring, G.tape));
    spin.add(new THREE.Mesh(G.stripe, G.tapePink));
  }
  g.userData.spin = spin;
  g.rotation.order = 'YXZ';
  return g;
}

export class PieceLayer {
  constructor(scene) {
    this.scene = scene;
    this.meshes = new Map();
  }

  // pieces: array of {id, type, st, x, y, z, th, roll}
  update(pieces) {
    const seen = new Set();
    for (const p of pieces) {
      seen.add(p.id);
      let m = this.meshes.get(p.id);
      if (!m || m.userData.type !== p.type) {
        if (m) this.scene.remove(m);
        m = makePieceMesh(p.type);
        m.userData.type = p.type;
        this.scene.add(m);
        this.meshes.set(p.id, m);
      }
      m.position.set(p.x, p.z + R, -p.y);
      m.rotation.y = p.th;
      m.userData.spin.rotation.x = -(p.roll || 0);
    }
    for (const [id, m] of this.meshes) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.meshes.delete(id);
      }
    }
  }

  clear() {
    for (const m of this.meshes.values()) this.scene.remove(m);
    this.meshes.clear();
  }
}
