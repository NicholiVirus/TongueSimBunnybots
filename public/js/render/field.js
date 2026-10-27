import * as THREE from 'three';
import * as F from '/shared/field.js';
import { V, COLORS, mat, aluMat, fbox, textCanvas, rng, allianceColor } from './util.js';

const { halfL: L, halfW: W } = F.FIELD;

export function buildField() {
  const root = new THREE.Group();
  root.name = 'field';
  root.add(buildArena());
  root.add(buildCarpet());
  root.add(buildPerimeter());
  for (const a of F.ALLIANCES) {
    root.add(buildPantry(a));
    root.add(buildOven(a));
    for (const c of F.depotChutes(a)) root.add(buildDepot(c, a));
    root.add(buildDriverStations(a));
  }
  root.add(buildTable());
  for (const t of F.allAprilTags()) root.add(buildTag(t));
  return root;
}

// ------------------------------------------------------------------ arena / scenery
function buildArena() {
  const g = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 46), mat(0x23262c, { roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.005;
  floor.receiveShadow = true;
  g.add(floor);

  // gym walls
  const wallMat = mat(0x2c313a, { roughness: 0.95 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(70, 12), wallMat);
  back.position.set(0, 6, 15);
  back.rotation.y = Math.PI;
  g.add(back);
  const front = back.clone();
  front.position.set(0, 6, -21);
  front.rotation.y = 0;
  g.add(front);

  // banner above the far side
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 1.5),
    new THREE.MeshBasicMaterial({
      map: textCanvas('BLAIR BUNNYBOTS 2026  ·  HARVEST HAVOC', { w: 2048, h: 256, font: 'bold 150px "Barlow Condensed", Arial Narrow, sans-serif', color: '#ffffff', bg: '#123a1b' }),
    }),
  );
  banner.position.set(0, 4.6, 14.9);
  banner.rotation.y = Math.PI;
  g.add(banner);

  // bleachers on the far side
  const seat = mat(0x3b4250, { roughness: 0.9 });
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(26, 0.45, 0.8), seat);
    b.position.set(0, 0.22 + i * 0.45, 7.2 + i * 0.8);
    b.receiveShadow = true;
    g.add(b);
  }
  const crowdRand = rng(7);
  const crowdColors = [0xe5383b, 0x2f73ee, 0xffb000, 0x5ad16a, 0xffffff, 0x9b59b6, 0xff7a1a];
  const crowdGeo = new THREE.CapsuleGeometry(0.17, 0.35, 3, 6);
  for (let i = 0; i < 6; i++) {
    for (let k = 0; k < 34; k++) {
      if (crowdRand() < 0.45) continue;
      const m = new THREE.Mesh(crowdGeo, mat(crowdColors[Math.floor(crowdRand() * crowdColors.length)], { roughness: 0.9 }));
      m.position.set(-12.5 + k * 0.75 + crowdRand() * 0.2, 0.45 + i * 0.45 + 0.4, 7.2 + i * 0.8);
      g.add(m);
    }
  }

  // scoring table (+Y side)
  const tbl = fbox(-2, 2, W + 1.4, W + 2.2, 0, 0.76, mat(0x1b1e24));
  g.add(tbl);
  for (let i = -1; i <= 1; i++) {
    const mon = fbox(i * 1.2 - 0.3, i * 1.2 + 0.3, W + 1.55, W + 1.6, 0.8, 1.15, mat(0x0a0c10, { emissive: 0x16304f, emissiveIntensity: 0.9 }));
    g.add(mon);
  }
  return g;
}

// ------------------------------------------------------------------ carpet with tape lines
function buildCarpet() {
  const ppm = 160;
  const cw = Math.round(2 * L * ppm);
  const ch = Math.round(2 * W * ppm);
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d');
  const toPx = (x, y) => [(x + L) * ppm, (W - y) * ppm];

  g.fillStyle = '#4f555c';
  g.fillRect(0, 0, cw, ch);
  // carpet grain
  const r = rng(3);
  for (let i = 0; i < 26000; i++) {
    const v = 70 + Math.floor(r() * 30);
    g.fillStyle = `rgba(${v},${v + 4},${v + 8},0.35)`;
    g.fillRect(r() * cw, r() * ch, 2, 2);
  }
  // seams
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 2;
  for (let x = -L; x < L; x += 3.66) {
    const [px] = toPx(x, 0);
    g.beginPath();
    g.moveTo(px, 0);
    g.lineTo(px, ch);
    g.stroke();
  }

  const css = (a, alpha) => (a === 'red' ? `rgba(229,56,59,${alpha})` : `rgba(47,115,238,${alpha})`);
  const fillPoly = (poly, style) => {
    g.fillStyle = style;
    g.beginPath();
    poly.forEach(([x, y], i) => {
      const [px, py] = toPx(x, y);
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    });
    g.closePath();
    g.fill();
  };
  const line = (pts, style, width = 2 * F.IN) => {
    g.strokeStyle = style;
    g.lineWidth = width * ppm;
    g.lineJoin = 'miter';
    g.beginPath();
    pts.forEach(([x, y], i) => {
      const [px, py] = toPx(x, y);
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    });
    g.stroke();
  };

  for (const a of F.ALLIANCES) {
    const s = F.sideSign(a);
    const k = F.kitchenPoly(a);
    fillPoly(k, css(a, 0.1));
    line([k[0], k[5], k[4], k[3]], css(a, 1));
    const f = F.farmPoly(a);
    fillPoly(f, css(a, 0.1));
    line([f[1], f[2], f[3], f[4]], css(a, 1));
    const tz = F.tableZonePoly(a);
    fillPoly(tz, css(a, 0.18));
    line(tz, css(a, 1));
    // alliance logo text in the kitchen
    g.save();
    const [lx, ly] = toPx(s * 7.0, 1.0);
    g.translate(lx, ly);
    g.rotate((-s * Math.PI) / 2);
    g.fillStyle = css(a, 0.22);
    g.font = `bold ${0.55 * ppm}px "Barlow Condensed", Arial Narrow, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('KITCHEN', 0, 0);
    g.restore();
    g.save();
    const [fx, fy] = toPx(-s * 6.0, -3.5);
    g.translate(fx, fy);
    g.fillStyle = css(a, 0.25);
    g.font = `bold ${0.42 * ppm}px "Barlow Condensed", Arial Narrow, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(`${a.toUpperCase()} FARM`, 0, 0);
    g.restore();
  }
  // center line
  line(
    [
      [0, 0.84],
      [0, W],
    ],
    '#f4f4f4',
  );
  line(
    [
      [0, -W],
      [0, -0.84],
    ],
    '#f4f4f4',
  );

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * L, 2 * W), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------ perimeter
function buildPerimeter() {
  const g = new THREE.Group();
  const poly = new THREE.MeshStandardMaterial({ color: 0xd6ecff, transparent: true, opacity: 0.13, roughness: 0.05, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
  const alu = aluMat();
  const kick = mat(0x8c939c, { metalness: 0.5, roughness: 0.5 });
  const T = 0.05;
  const wall = (x0, x1, y0, y1, h) => {
    g.add(fbox(x0, x1, y0, y1, 0, 0.1, kick));
    const pane = fbox(x0, x1, y0, y1, 0.1, h, poly, { cast: false, receive: false });
    pane.renderOrder = 2;
    g.add(pane);
    g.add(fbox(x0, x1, y0, y1, h, h + 0.05, alu));
  };
  // side walls (20" high)
  wall(-L, L, W, W + T, 0.5);
  wall(-L, L, -W - T, -W, 0.5);
  // posts every ~2 m
  for (let x = -L; x <= L + 0.01; x += (2 * L) / 8) {
    g.add(fbox(x - 0.03, x + 0.03, W, W + 0.08, 0, 0.56, alu));
    g.add(fbox(x - 0.03, x + 0.03, -W - 0.08, -W, 0, 0.56, alu));
  }
  // alliance walls: tall driver-station section, ramp section, low depot section
  for (const a of F.ALLIANCES) {
    const s = F.sideSign(a);
    const x0 = s > 0 ? L : -L - T;
    const x1 = s > 0 ? L + T : -L;
    const solid = mat(allianceColor(a), { roughness: 0.7 });
    g.add(fbox(x0, x1, -1.43, W, 0, 0.9, solid));
    const pane = fbox(x0, x1, -1.43, W, 0.9, 1.98, poly, { cast: false, receive: false });
    pane.renderOrder = 2;
    g.add(pane);
    g.add(fbox(x0, x1, -1.43, W, 1.98, 2.04, alu));
    for (const y of [-1.43, 0.42, 2.27, W]) g.add(fbox(x0, x1, y - 0.03, y + 0.03, 0, 2.04, alu));
    wall(x0, x1, -2.05, -1.43, 1.1);
    wall(x0, x1, -W, -2.05, 0.5);
  }
  return g;
}

// ------------------------------------------------------------------ driver stations / human players
function buildDriverStations(a) {
  const g = new THREE.Group();
  const s = F.sideSign(a);
  const shelf = mat(0x2a2f38);
  const x = s * (L + 0.45);
  for (let i = 0; i < 3; i++) {
    const y = F.DRIVER_STATION_Y[i];
    g.add(fbox(x - 0.25, x + 0.25, y - 0.8, y + 0.8, 0.86, 0.9, shelf));
    const lap = fbox(x - 0.18, x + 0.18, y - 0.18, y + 0.18, 0.9, 0.92, mat(0x111318));
    g.add(lap);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.22), new THREE.MeshBasicMaterial({ color: 0x2a5d9c }));
    scr.position.copy(V(x + s * 0.17, y, 1.03));
    scr.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(scr);
    const num = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshBasicMaterial({ map: textCanvas(String(i + 1), { w: 128, h: 128, font: 'bold 110px "Barlow Condensed", sans-serif', color: '#fff' }), transparent: true }),
    );
    num.position.copy(V(s * (L - 0.005), y, 0.55));
    num.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(num);
  }
  return g;
}

// ------------------------------------------------------------------ PANTRY
function buildPantry(a) {
  const g = new THREE.Group();
  const s = F.sideSign(a);
  const P = F.PANTRY;
  const X = (x) => x * s;
  const lo = (u, v) => [Math.min(X(u), X(v)), Math.max(X(u), X(v))];
  const ac = mat(allianceColor(a), { roughness: 0.55 });
  const wood = mat(COLORS.wood, { roughness: 0.75 });
  const back = mat(0xe8dcc8, { roughness: 0.8 });
  // uprights
  for (const [u, v] of [
    [P.x0 - 0.04, P.x0],
    [P.x1, P.x1 + 0.04],
  ]) {
    const [x0, x1] = lo(u, v);
    g.add(fbox(x0, x1, P.yFront, P.yBack, 0, P.top, ac));
  }
  const [x0, x1] = lo(P.x0, P.x1);
  g.add(fbox(x0, x1, P.yBack - 0.03, P.yBack, 0.58, P.top, back));
  // legs/base with tags
  for (const [u, v] of [
    [P.x0, P.x0 + 0.49],
    [P.x1 - 0.49, P.x1],
  ]) {
    const [b0, b1] = lo(u, v);
    g.add(fbox(b0, b1, P.yFront + 0.05, P.yBack - 0.03, 0, 0.58, ac));
  }
  g.add(fbox(x0, x1, P.yFront + 0.05, P.yBack, 0.58, 0.66, wood));
  // shelves + lips + level labels
  P.shelfZ.forEach((z, i) => {
    g.add(fbox(x0, x1, P.yFront, P.yBack, z - 0.07, z, wood));
    g.add(fbox(x0, x1, P.yFront, P.yFront + 0.02, z, z + 0.035, aluMat()));
    const lbl = new THREE.Mesh(
      new THREE.PlaneGeometry(0.24, 0.07),
      new THREE.MeshBasicMaterial({ map: textCanvas(`LEVEL ${i + 1}`, { w: 256, h: 76, font: 'bold 56px "Barlow Condensed", sans-serif', color: '#111', bg: '#ffd84a' }) }),
    );
    lbl.position.copy(V(X((P.x0 + P.x1) / 2), P.yFront - 0.003, z - 0.035));
    g.add(lbl);
  });
  return g;
}

// ------------------------------------------------------------------ OVEN + RAMP
function buildOven(a) {
  const g = new THREE.Group();
  const s = F.sideSign(a);
  const O = F.OVEN;
  const X = (x) => x * s;
  const bx = (u, v, y0, y1, z0, z1, m) => g.add(fbox(Math.min(X(u), X(v)), Math.max(X(u), X(v)), y0, y1, z0, z1, m));
  const ac = mat(allianceColor(a), { roughness: 0.55 });
  const frame = aluMat();
  const darkM = mat(0x16181d);
  bx(O.x0, O.x1, O.y0, O.y1, 0, 0.09, darkM);
  bx(6.0, 6.02, O.y0 + 0.04, O.y1 - 0.04, 0.09, 0.41, ac);
  for (const [u, v, h] of [
    [6.02, 6.11, 0.56],
    [7.05, 7.14, 0.88],
    [7.21, 7.3, 0.92],
    [8.2, 8.27, 1.16],
  ]) {
    bx(u, v, O.y0, O.y0 + 0.04, 0, h, frame);
    bx(u, v, O.y1 - 0.04, O.y1, 0, h, frame);
  }
  // side rails above the mouth openings
  bx(6.02, 7.14, O.y0, O.y0 + 0.03, 0.48, 0.62, ac);
  bx(6.02, 7.14, O.y1 - 0.03, O.y1, 0.48, 0.62, ac);
  // rear section walls (kitchen side solid, farm side rails)
  bx(7.24, O.x1, O.y1 - 0.02, O.y1, 0, 0.77, ac);
  bx(7.21, O.x1, O.y0, O.y0 + 0.03, 0.1, 0.27, ac);
  // glowing oven interior
  const glow = new THREE.MeshStandardMaterial({ color: 0x3a1204, emissive: 0xff5a00, emissiveIntensity: 0.55, roughness: 1 });
  bx(6.11, 7.05, O.y0 + 0.08, O.y1 - 0.08, 0.09, 0.47, glow);
  bx(7.3, O.x1, O.y0 + 0.08, O.y1 - 0.08, 0.09, 0.28, glow);
  // the big ramp (sloped plate)
  const len = Math.hypot(O.x1 - O.frontX, O.rampHigh - O.rampLow);
  const ang = Math.atan2(O.rampHigh - O.rampLow, O.x1 - O.frontX);
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(len, 0.025, O.y1 - O.y0), mat(0xdedede, { roughness: 0.5 }));
  const mx = X((O.frontX + O.x1) / 2);
  ramp.position.copy(V(mx, O.yc, (O.rampHigh + O.rampLow) / 2));
  ramp.rotation.z = s * ang;
  ramp.castShadow = true;
  ramp.receiveShadow = true;
  g.add(ramp);
  for (const y of [O.y0 + 0.015, O.y1 - 0.015]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.03), ac);
    rail.position.copy(V(mx, y, (O.rampHigh + O.rampLow) / 2 + 0.06));
    rail.rotation.z = s * ang;
    rail.castShadow = true;
    g.add(rail);
  }
  // supports under the ramp plate (keep the mouths open)
  const support = (x) => {
    const zt = O.rampLow + ((x - O.frontX) / (O.x1 - O.frontX)) * (O.rampHigh - O.rampLow);
    bx(x - 0.04, x + 0.04, O.y0, O.y0 + 0.04, 0.48, zt, frame);
    bx(x - 0.04, x + 0.04, O.y1 - 0.04, O.y1, 0.48, zt, frame);
  };
  support(6.07);
  support(7.1);
  // OVEN label
  const lbl = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.12),
    new THREE.MeshBasicMaterial({ map: textCanvas('OVEN', { w: 256, h: 64, font: 'bold 56px "Barlow Condensed", sans-serif', color: '#fff', bg: a === 'red' ? '#a3242a' : '#1f4aa8' }) }),
  );
  lbl.position.copy(V(X(6.6), O.y1 + 0.003, 0.55));
  lbl.rotation.y = Math.PI;
  g.add(lbl);
  return g;
}

// ------------------------------------------------------------------ DEPOT (owner = alliance whose FARM it sits in)
function buildDepot(c, owner) {
  const g = new THREE.Group();
  const ac = mat(allianceColor(owner), { roughness: 0.55 });
  const D = F.DEPOT;
  const hw = D.width / 2;
  // local frame: u = into the field (dx,dy), v = lateral
  const ux = c.dx;
  const uy = c.dy;
  const vx = -uy;
  const vy = ux;
  const place = (u0, u1, v0, v1, z0, z1, m) => {
    const cu = (u0 + u1) / 2;
    const cv = (v0 + v1) / 2;
    const box = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(u1 - u0), z1 - z0, Math.abs(v1 - v0)), m);
    box.position.copy(V(c.x + ux * cu + vx * cv, c.y + uy * cu + vy * cv, (z0 + z1) / 2));
    box.rotation.y = Math.atan2(uy, ux);
    box.castShadow = true;
    box.receiveShadow = true;
    g.add(box);
    return box;
  };
  // body outside the perimeter
  place(-D.depth, -D.depth + 0.09, -hw, hw, 0, 1.11, ac);
  place(-D.depth, 0, -hw, -hw + 0.09, 0, 1.07, ac);
  place(-D.depth, 0, hw - 0.09, hw, 0, 1.07, ac);
  // sloped chute down to the 23" mouth
  const len = Math.hypot(D.depth, 0.3);
  const chute = new THREE.Mesh(new THREE.BoxGeometry(len, 0.02, D.width - 0.18), mat(0xe8e8e8, { roughness: 0.5 }));
  chute.position.copy(V(c.x - ux * (D.depth / 2) + 0, c.y - uy * (D.depth / 2), D.mouthZ + 0.15));
  chute.rotation.order = 'YZX';
  chute.rotation.y = Math.atan2(uy, ux);
  chute.rotation.z = -Math.atan2(0.3, D.depth);
  chute.castShadow = true;
  g.add(chute);
  place(-0.02, 0.05, -hw, hw, D.mouthZ - 0.05, D.mouthZ, ac);
  // a little pile of carrots behind the depot
  const carrot = new THREE.Mesh(new THREE.CylinderGeometry(F.PIECE.radius, F.PIECE.radius, F.PIECE.length, 14), mat(COLORS.carrot));
  for (let i = 0; i < 4; i++) {
    const m = carrot.clone();
    m.rotation.order = 'YXZ';
    m.rotation.y = Math.atan2(uy, ux);
    m.rotation.x = Math.PI / 2;
    m.position.copy(V(c.x - ux * (D.depth + 0.25 + (i % 2) * 0.16), c.y - uy * (D.depth + 0.25 + (i % 2) * 0.16), F.PIECE.radius + Math.floor(i / 2) * 0.14));
    g.add(m);
  }
  return g;
}

// ------------------------------------------------------------------ DINNER TABLE
function buildTable() {
  const g = new THREE.Group();
  const T = F.TABLE;
  const baseSide = T.baseHalfDiag * Math.SQRT2;
  const topSide = T.topHalfDiag * Math.SQRT2;
  const base = new THREE.Mesh(new THREE.BoxGeometry(baseSide, 0.02, baseSide), mat(0x2b2f36));
  base.position.y = 0.01;
  base.rotation.y = Math.PI / 4;
  base.receiveShadow = true;
  g.add(base);
  // 4" barriers along the diamond
  const bar = aluMat();
  for (let k = 0; k < 4; k++) {
    const ma = (k * Math.PI) / 2 + Math.PI / 4;
    const rr = T.baseHalfDiag * Math.SQRT1_2 - 0.02;
    const m = new THREE.Mesh(new THREE.BoxGeometry(baseSide, 0.09, 0.04), bar);
    m.position.copy(V(Math.cos(ma) * rr, Math.sin(ma) * rr, 0.065));
    m.rotation.y = ma + Math.PI / 2;
    m.castShadow = true;
    g.add(m);
  }
  const wood = mat(COLORS.wood);
  for (const [x, y] of [
    [0.635, 0],
    [-0.635, 0],
    [0, 0.635],
    [0, -0.635],
    [0, 0],
  ]) {
    const leg = fbox(x - 0.06, x + 0.06, y - 0.06, y + 0.06, 0.02, T.topZ - 0.01, wood);
    g.add(leg);
  }
  // gingham tablecloth top
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const cg = c.getContext('2d');
  cg.fillStyle = '#fff';
  cg.fillRect(0, 0, 256, 256);
  cg.fillStyle = 'rgba(214,40,48,0.55)';
  for (let i = 0; i < 8; i++) {
    cg.fillRect(i * 32, 0, 16, 256);
    cg.fillRect(0, i * 32, 256, 16);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  const top = new THREE.Mesh(new THREE.BoxGeometry(topSide, 0.02, topSide), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  top.position.y = T.topZ - 0.01;
  top.rotation.y = Math.PI / 4;
  top.castShadow = true;
  top.receiveShadow = true;
  g.add(top);
  // 360° camera post
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 10), mat(0x15171b));
  post.position.y = T.topZ + 0.75;
  g.add(post);
  const cam = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), mat(0x0d0f12, { roughness: 0.2, metalness: 0.4 }));
  cam.position.y = T.topZ + 1.53;
  g.add(cam);
  return g;
}

// ------------------------------------------------------------------ AprilTags
const tagCache = new Map();
function tagTexture(id) {
  if (tagCache.has(id)) return tagCache.get(id);
  const c = document.createElement('canvas');
  c.width = c.height = 100;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 100, 100);
  const off = 10;
  const cell = 10;
  g.fillStyle = '#000';
  g.fillRect(off, off, 80, 80);
  const r = rng(id * 7919 + 13);
  g.fillStyle = '#fff';
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if (r() > 0.5) g.fillRect(off + cell * (i + 1), off + cell * (j + 1), cell, cell);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  tagCache.set(id, t);
  return t;
}
function buildTag(t) {
  const size = 8.125 * F.IN;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tagTexture(t.id) }));
  const yaw = (t.yaw * Math.PI) / 180;
  m.position.copy(V(t.x + Math.cos(yaw) * 0.012, t.y + Math.sin(yaw) * 0.012, t.z));
  // plane normal is three +Z; turn it to face along the tag yaw
  m.rotation.y = Math.atan2(Math.cos(yaw), -Math.sin(yaw));
  return m;
}
