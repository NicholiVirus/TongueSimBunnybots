// Blair Bunnybots 2026: HARVEST HAVOC — field geometry and game constants.
//
// Coordinates follow the manual's 2027 "center origin" convention, in METERS:
//   origin = center of the carpet, +X toward the RED driver stations,
//   +Y toward the scoring table, +Z up.
// Every element is mirror-symmetric across X = 0 (blue = red with x negated).
// Dimensions were taken from the official field CAD (floor tape, pantry, oven/ramp,
// depot, dinner table) and the AprilTag table in the game manual v1.2.

export const IN = 0.0254;

export const FIELD = {
  halfL: 8.27, // 651" long
  halfW: 4.105, // 323" wide
};

export const ALLIANCES = ['red', 'blue'];
export const sideSign = (alliance) => (alliance === 'red' ? 1 : -1);
export const opponent = (alliance) => (alliance === 'red' ? 'blue' : 'red');

// ---------------------------------------------------------------- match timing
export const TIMING = {
  countdown: 3,
  auto: 15,
  teleop: 135,
  endgame: 20, // last 20 s of teleop
  post: 3, // PARK is judged 3 s after the match ends
};
export const MATCH_LENGTH = TIMING.auto + TIMING.teleop; // 150 s

// ---------------------------------------------------------------- game pieces
export const PIECE = {
  length: 18 * IN, // 0.457 m foam roller
  radius: 3 * IN, // 6" diameter
};
export const CARROTS_PER_ALLIANCE = 24;
export const PRESTAGED_CARROTS = 5;
export const PRELOAD_PER_ROBOT = 2;
export const CAKES_PER_ALLIANCE = 10; // 1 on the table + 9 at the opposing depot
export const CAKES_AT_OPPOSING_DEPOT = 9;
export const MAX_HELD = 3; // G14

// ---------------------------------------------------------------- scoring
export const POINTS = {
  taxi: 2,
  park: 2,
  haulCarrot: 1,
  haulCake: 3,
  oven: { carrot: 2, cake: 1 },
  pantry: {
    carrot: [3, 4, 5], // LEVEL 1, 2, 3
    cake: [8, 10, 12],
  },
  minorFoul: 4,
  majorFoul: 8,
};
export const RP = { win: 3, tie: 1, stocked: 1, baked: 1, dinner: 1 };
export const DINNER_RP_ENDGAME_POINTS = 10;
export const STOCKED_RP_PER_SHELF = 3;

// ---------------------------------------------------------------- field elements (RED side, x > 0)
// PANTRY — against the scoring-table wall inside the alliance KITCHEN.
export const PANTRY = {
  x0: 5.54,
  x1: 7.93,
  yFront: 3.93, // shelf lip faces -Y into the field
  yBack: FIELD.halfW,
  shelfZ: [0.83, 1.19, 1.54], // top surface of LEVEL 1/2/3
  top: 1.68,
  slots: 5,
};
export const pantrySlotX = (i, s) => s * (PANTRY.x0 + ((PANTRY.x1 - PANTRY.x0) / PANTRY.slots) * (i + 0.5));

// OVEN + RAMP — one structure on the alliance wall between the KITCHEN and the
// opposing FARM. The big ramp on top runs from the wall (z 1.21) down to the
// front edge (z 0.58); the OVEN mouth opens on both long sides of the rear bay by the alliance wall.
export const OVEN = {
  x0: 5.93,
  x1: FIELD.halfL,
  y0: -2.05,
  y1: -1.42,
  yc: -1.735,
  rampHigh: 1.21,
  rampLow: 0.58,
  frontX: 6.0,
  // the OVEN mouth is in the rear bay next to the alliance wall / driver stations, right above the
  // little ramp that rolls pieces back to the RAMP human player (CAD: x 7.24–8.27, open 0.27–0.77 m)
  mouthX0: 7.24,
  mouthX1: 8.2,
  mouthZ0: 0.27,
  mouthZ1: 0.77,
};

// KITCHEN — robots start here (bounded by the perimeter, the ramp and the tape line).
export const KITCHEN_POLY = [
  [6.33, -1.43],
  [FIELD.halfL, -1.43],
  [FIELD.halfL, FIELD.halfW],
  [5.07, FIELD.halfW],
  [5.07, 3.0],
  [6.33, 3.0],
];

// FARM on the +X end belongs to BLUE (each alliance's FARM is at the opposite end).
export const FARM_POLY_POS_X = [
  [FIELD.halfL, -2.04],
  [6.33, -2.04],
  [6.33, -2.92],
  [3.58, -2.92],
  [3.58, -FIELD.halfW],
  [FIELD.halfL, -FIELD.halfW],
];

// DEPOT chutes on the +X end (owned by BLUE). Ramp mouth is 23" above the carpet.
export const DEPOT_CHUTES_POS_X = [
  { x: FIELD.halfL, y: -3.07, dx: -1, dy: 0, tag: 2 },
  { x: 4.25, y: -FIELD.halfW, dx: 0, dy: 1, tag: 1 },
];
export const DEPOT = { mouthZ: 0.58, width: 0.69, depth: 0.79 };

// DINNER TABLE — a 12" tall square turned 45° (corners point at the alliances).
export const TABLE = {
  baseHalfDiag: 0.84,
  topHalfDiag: 0.75,
  topZ: 0.3,
};
// TABLE ZONE for RED (x > 0): pentagon hugging the two red-facing table edges.
export const TABLE_ZONE_POLY = [
  [0, 0.84],
  [0.28, 0.84],
  [1.13, 0],
  [0.28, -0.84],
  [0, -0.84],
];

// AprilTags (36h11). Red-end tags; blue tags mirror X and flip yaw.
export const APRILTAGS = [
  { id: 1, x: 4.267, y: -4.007, z: 0.33, yaw: 90 },
  { id: 2, x: 8.125, y: -3.067, z: 0.33, yaw: 180 },
  { id: 3, x: 5.991, y: -1.739, z: 0.254, yaw: 180 },
  { id: 4, x: 7.68, y: 3.956, z: 0.336, yaw: 270 },
  { id: 5, x: 5.787, y: 3.956, z: 0.336, yaw: 270 },
];
export const allAprilTags = () => {
  const out = [];
  for (const t of APRILTAGS) {
    out.push({ ...t, alliance: 'red' });
    out.push({ id: 11 - t.id, x: -t.x, y: t.y, z: t.z, yaw: (540 - t.yaw) % 360, alliance: 'blue' });
  }
  return out;
};

// Driver stations fill the kitchen width of each alliance wall.
export const DRIVER_STATION_Y = [3.19, 1.34, -0.51];

// Default starting poses (inside the KITCHEN, bumpers behind the line).
export const startPose = (alliance, station) => {
  const s = sideSign(alliance);
  const ys = [2.45, 0.95, -0.55];
  return { x: s * 7.55, y: ys[station - 1] ?? 0, th: alliance === 'red' ? Math.PI : 0 };
};

// Prestaged pieces (from the CAD scene): 5 carrots per side + 1 cake on each table corner.
export const PRESTAGED_CARROT_SPOTS = [-2.0, -1.07, 0, 1.07, 2.0].map((y) => ({ x: 2.0, y }));
export const TABLE_CAKE_SPOT = { x: 0.5, y: 0 };

// ---------------------------------------------------------------- helpers
export const mirrorPoly = (poly, s) => poly.map(([x, y]) => [x * s, y]);

export const kitchenPoly = (alliance) => mirrorPoly(KITCHEN_POLY, sideSign(alliance));
// An alliance's FARM is at the opposite end from its kitchen.
export const farmPoly = (alliance) => mirrorPoly(FARM_POLY_POS_X, alliance === 'blue' ? 1 : -1);
export const depotChutes = (alliance) => {
  const s = alliance === 'blue' ? 1 : -1;
  return DEPOT_CHUTES_POS_X.map((c) => ({ ...c, x: c.x * s, dx: c.dx * s }));
};
export const tableZonePoly = (alliance) => mirrorPoly(TABLE_ZONE_POLY, sideSign(alliance));

export const pantryBox = (alliance) => {
  const s = sideSign(alliance);
  const a = PANTRY.x0 * s;
  const b = PANTRY.x1 * s;
  return { x0: Math.min(a, b), x1: Math.max(a, b), y0: PANTRY.yFront, y1: PANTRY.yBack };
};
export const ovenBox = (alliance) => {
  const s = sideSign(alliance);
  const a = OVEN.x0 * s;
  const b = OVEN.x1 * s;
  return { x0: Math.min(a, b), x1: Math.max(a, b), y0: OVEN.y0, y1: OVEN.y1 };
};

// Static collision obstacles as oriented boxes {cx, cy, hx, hy, th}.
export function staticObstacles() {
  const obs = [];
  const box = (b, kind, alliance) => ({
    cx: (b.x0 + b.x1) / 2,
    cy: (b.y0 + b.y1) / 2,
    hx: (b.x1 - b.x0) / 2,
    hy: (b.y1 - b.y0) / 2,
    th: 0,
    kind,
    alliance,
  });
  for (const a of ALLIANCES) {
    obs.push(box(pantryBox(a), 'pantry', a));
    obs.push(box(ovenBox(a), 'oven', a));
  }
  const side = TABLE.baseHalfDiag * Math.SQRT1_2;
  obs.push({ cx: 0, cy: 0, hx: side, hy: side, th: Math.PI / 4, kind: 'table' });
  // perimeter walls (thick boxes just outside the carpet)
  const T = 0.5;
  const { halfL: L, halfW: W } = FIELD;
  obs.push({ cx: L + T, cy: 0, hx: T, hy: W + 2 * T, th: 0, kind: 'wall' });
  obs.push({ cx: -L - T, cy: 0, hx: T, hy: W + 2 * T, th: 0, kind: 'wall' });
  obs.push({ cx: 0, cy: W + T, hx: L + 2 * T, hy: T, th: 0, kind: 'wall' });
  obs.push({ cx: 0, cy: -W - T, hx: L + 2 * T, hy: T, th: 0, kind: 'wall' });
  return obs;
}

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segsIntersect(a, b, c, d) {
  const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

// True if two simple polygons overlap at all ("partially within").
export function polysOverlap(p, q) {
  if (p.some(([x, y]) => pointInPoly(x, y, q))) return true;
  if (q.some(([x, y]) => pointInPoly(x, y, p))) return true;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    for (let j = 0; j < q.length; j++) if (segsIntersect(a, b, q[j], q[(j + 1) % q.length])) return true;
  }
  return false;
}

// True if polygon p lies entirely inside polygon q ("fully within").
export const polyInside = (p, q) => p.every(([x, y]) => pointInPoly(x, y, q)) && !polysOverlapEdges(p, q);
function polysOverlapEdges(p, q) {
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    for (let j = 0; j < q.length; j++) if (segsIntersect(a, b, q[j], q[(j + 1) % q.length])) return true;
  }
  return false;
}
