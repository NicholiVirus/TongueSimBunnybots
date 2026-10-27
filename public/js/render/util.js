import * as THREE from 'three';

// Field coords (x, y, z-up) -> three.js (X, Y-up, Z)
export const V = (x, y, z = 0) => new THREE.Vector3(x, z, -y);

export const COLORS = {
  red: 0xd8333a,
  redDark: 0x7d1a1f,
  blue: 0x2b63d9,
  blueDark: 0x15347a,
  alu: 0xb7bec7,
  carpet: 0x4e545b,
  wood: 0xc9a06a,
  dark: 0x1d2128,
  carrot: 0xff7a1a,
};

export const allianceColor = (a) => (a === 'red' ? COLORS.red : COLORS.blue);

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = `${color}:${JSON.stringify(opts)}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...opts }));
  return matCache.get(key);
}
export const aluMat = () => mat(COLORS.alu, { metalness: 0.65, roughness: 0.35 });

// Axis-aligned box in FIELD coordinates: x0..x1, y0..y1, z0..z1
export function fbox(x0, x1, y0, y1, z0, z1, material, { cast = true, receive = true } = {}) {
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0), Math.abs(y1 - y0));
  const m = new THREE.Mesh(g, material);
  m.position.copy(V((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

export function textCanvas(text, { w = 512, h = 128, font = 'bold 84px "Barlow Condensed", Arial Narrow, sans-serif', color = '#fff', bg = null, align = 'center' } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
  }
  g.fillStyle = color;
  g.font = font;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(text, align === 'center' ? w / 2 : 12, h / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function labelSprite(text, color = '#ffffff', scale = 0.9) {
  const tex = textCanvas(text, { w: 512, h: 128, font: 'bold 70px "Barlow Condensed", Arial Narrow, sans-serif', color, bg: null });
  // constant on-screen size so nearby labels don't swamp the view
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  sp.scale.set(0.11 * scale, 0.0275 * scale, 1);
  sp.renderOrder = 10;
  return sp;
}

// Simple seeded RNG for deterministic textures
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}
