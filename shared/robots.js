// Robot presets: a swerve drivetrain plus a scoring mechanism (see MECHS below).
//
// `team` is CHARLES, team 611's real Harvest Havoc robot: its CAD is the 3D model and its build
// (roller claw on a 2-stage elevator + rear trader) is fixed. The other presets are procedural
// placeholders whose mechanisms can be configured in the menu.
// To use another team's CAD, export a .glb and set `model` on a preset (see
// public/assets/robots/README.md). Physics only uses the numbers below.

import { IN } from './field.js';

const base = {
  drive: 'swerve',
  length: 32 * IN, // bumper-to-bumper, front/back
  width: 32 * IN, // bumper-to-bumper, side/side
  height: 0.55, // frame height (visual)
  mass: 60, // kg incl. battery + bumpers
  maxSpeed: 4.2, // m/s
  accel: 9.0, // m/s^2
  maxOmega: 6.0, // rad/s
  angAccel: 24, // rad/s^2
  intakeWidth: 24 * IN,
  intakeReach: 9 * IN, // how far past the front bumper the intake grabs
  elevator: {
    speed: 2.2, // m/s
    min: 0.12,
    max: 1.62,
    // carriage height (m) needed for each target — matches PANTRY shelf tops / OVEN mouth
    setpoints: { stow: 0.12, oven: 0.3, l1: 0.86, l2: 1.22, l3: 1.57 },
    tolerance: 0.05,
  },
  scoreCooldown: 0.35, // s between placements
  model: null, // null = procedural placeholder
};

export const ROBOTS = {
  team: {
    ...base,
    id: 'team',
    name: 'Charles (611)',
    blurb:
      'Team 611\u2019s robot. Roller claw on a 2-stage elevator holds ONE piece (ground or ramp) and places it on the shelves; the rear trader takes 3 depot carrots and fires them into the oven.',
    // numbers from the CAD and the robot code (Saxon-Robotics/Bunnybots-2026)
    length: 0.914, // bumper-to-bumper, claw (front) to trader (back)
    width: 0.946,
    mass: 62, // 54 kg robot + bumpers
    maxSpeed: 5.12,
    accel: 10,
    intakeWidth: 0.5, // the claw is narrow: line it up with the middle of the piece
    intakeReach: 0.3, // the arm folds out past the front bumper
    scoreCooldown: 0.3,
    // the build is the real robot's: it can't be changed in the menu
    build: { ground: true, depot: true, ramp: true, maxLevel: 3, mech: 'claw' },
    // arm angles in degrees (0 = straight out the front, 90 = up), speed in deg/s.
    // pivot = [forward, up] of the arm pivot on the carriage (m, robot frame, elevator down);
    // grip = where the held piece sits in the arm's own frame [along the arm, above it]: the centre of the claw arc between its roller shafts (CAD: arc centre 0.601, 0.178, radius 0.081 m)
    arm: { stow: 99, ground: -5, ramp: 90, oven: 70, pantry: 60, tongue: 45, speed: 320, tolerance: 8, pivot: [0.2985, 0.197], grip: [0.304, -0.019] },
    // carriage travel (m) at each sim setpoint (about the real 21" / 33" / 48", trimmed so the claw lines up with each shelf)
    elevator: { ...base.elevator, travel: { stow: 0, oven: 0, l1: 0.49, l2: 0.795, l3: 1.176 } },
    trader: { x: -0.2, z: 0.33 }, // where trader carrots ride (robot frame)
    traderRate: 0.16, // s between carrots fired out of the trader
    model: { url: '/assets/robots/team/charles.glb', rig: 'charles' },
  },
  divebomb: {
    ...base,
    id: 'divebomb',
    name: 'Divebomb',
    blurb:
      'L1/L2 robot with a slapdown ground intake on the opposite side from its elevator. The intake drops to grab ONE carrot, lifts it to the indexer (holds 2), and the elevator comes back down to take the next one (1 in the end effector) before scoring out the back.',
    length: 0.927, // bumper to bumper, intake (front) to elevator (back)
    width: 0.952,
    mass: 62,
    maxSpeed: 5.12,
    accel: 10,
    intakeWidth: 0.76, // slapdown roller width
    intakeReach: 0.2, // the intake sticks out past the front bumper
    scoreCooldown: 0.3,
    // the real build: ground intake only, L1/L2, indexer + end effector (one piece per lift)
    build: { ground: true, depot: false, ramp: false, maxLevel: 2, mech: 'opposite' },
    // carriage travel (m) at each setpoint, from the CAD (end effector sits at its lowest pose in the CAD)
    elevator: { ...base.elevator, travel: { stow: 0, oven: 0, l1: 0.454, l2: 0.814 } },
    // slapdown intake angle (deg, 0 = down on the carpet, up = raised) and timing
    slap: { stow: 62, ground: 0, feed: 30, speed: 260, tolerance: 8, feedTime: 0.55 },
    model: { url: '/assets/robots/divebomb/divebomb.glb', rig: 'divebomb' },
  },
  kitbot: {
    ...base,
    id: 'kitbot',
    name: 'Custom robot (placeholder)',
    blurb: 'Generic 32" elevator robot — pick its mechanisms below.',
  },
  speedy: {
    ...base,
    id: 'speedy',
    name: 'Speedy Swerve',
    blurb: 'Fast and light, short elevator (L1/L2 only).',
    length: 28 * IN,
    width: 28 * IN,
    mass: 50,
    maxSpeed: 4.9,
    accel: 11,
    elevator: { ...base.elevator, max: 1.25, speed: 2.6 },
  },
  tank: {
    ...base,
    id: 'tank',
    name: 'Heavy Hauler',
    blurb: 'Big, heavy pusher with a fast elevator.',
    length: 36 * IN,
    width: 34 * IN,
    mass: 68,
    maxSpeed: 3.6,
    accel: 7.5,
    maxOmega: 4.5,
    intakeWidth: 28 * IN,
    elevator: { ...base.elevator, speed: 3.0 },
  },
};

export const ROBOT_IDS = Object.keys(ROBOTS);

// ------------------------------------------------------------------ robot configuration options
// Every drivetrain preset can be built with different mechanisms:
//   ground   — floor intake (also reaches the cake on the dinner table)
//   depot    — can catch carrots from the DEPOT chute
//   ramp     — can catch carrot cakes rolling down the RAMP
//   maxLevel — highest PANTRY shelf it can reach (0 = OVEN only)
//   mech     — 'passthrough': pieces feed straight into the elevator carriage (all ride up together)
//              'separate'   : pieces wait in a low hopper; the elevator carries ONE piece per trip and
//                             reloads at the bottom (~0.45 s), but the robot stays stable when raised
//              'opposite'   : hopper + ground intake on the FRONT, elevator on the BACK — like 'separate',
//                             but the robot scores on the shelves with its back to the pantry
//              'claw'       : CHARLES — a roller claw on an arm + elevator holds ONE piece (from the
//                             floor or the ramp) and scores it out the FRONT (shelves or oven); a
//                             TRADER hopper on the BACK takes up to 3 carrots from the DEPOT and fires
//                             them into the OVEN out the back
export const DEFAULT_MODS = { ground: true, depot: true, ramp: true, maxLevel: 3, mech: 'passthrough' };
export const MECHS = { passthrough: 'Passthrough elevator', separate: 'Hopper + separate elevator', opposite: 'Hopper front + elevator back' };
// mechanisms that only come from a locked build (a robot preset or a team number), not from menus
const LOCKED_MECHS = { elevIntake: 'Ground-intake elevator + depot/ramp hopper', claw: 'Roller claw + rear trader (Charles)' };
export const MECH_NAMES = { ...MECHS, ...LOCKED_MECHS };
// one piece per lift
export const isOneAtATime = (mods) => mods?.mech === 'separate' || mods?.mech === 'opposite' || mods?.mech === 'elevIntake' || mods?.mech === 'claw';
// the elevator's end effector holds one piece itself (`carriagePiece`); the rest sit in a hopper
export const hasGripper = (mods) => mods?.mech === 'elevIntake' || mods?.mech === 'claw';
// the hopper is a trader on the BACK of the robot: depot carrots only, fired into the oven rear-first
export const hasRearTrader = (mods) => mods?.mech === 'claw';
// the build a robot actually plays with: a preset's fixed build wins, then a team lock, then the menu
// Charles' starting load (2 preloaded carrots): both in the rear trader, one in the trader + one in the
// claw, or two side by side in the claw (gripped only at their ends/sides)
export const LOADS = { trader2: '2 carrots in the trader (back)', split: '1 in the trader + 1 in the claw', claw2: '2 end to end in the claw (left + right)' };
export const sanitizeLoad = (l) => (LOADS[l] ? l : 'trader2');
export const buildFor = (robot, team, mods) => sanitizeMods(ROBOTS[robot]?.build || TEAM_LOCKS[String(team ?? '')] || mods);
// the elevator reloads from the hopper at the bottom
export const reloadsFromHopper = (mods) => mods?.mech === 'separate' || mods?.mech === 'opposite';

// TEAM 526 easter egg: locked build — L1 max, the elevator IS the ground intake (holds 1 piece and
// scores it), and a separate hopper fed only by the DEPOT/RAMP that can only dump into the OVEN.
export const TEAM_LOCKS = { 526: { ground: true, depot: true, ramp: true, maxLevel: 1, mech: 'elevIntake' } };
export const effectiveMods = (team, mods) => sanitizeMods(TEAM_LOCKS[String(team ?? '')] || mods);
// which way the robot faces the PANTRY: +1 front, -1 back
export const shelfSide = (mods) => (mods?.mech === 'opposite' ? -1 : 1);

// random but sensible mechanisms for practice bots (always some way to get pieces)
export function randomMods(rand = Math.random) {
  const ground = rand() < 0.8;
  return {
    ground,
    depot: !ground || rand() < 0.7,
    ramp: rand() < 0.75,
    maxLevel: [1, 2, 2, 3, 3, 3][Math.floor(rand() * 6)],
    mech: ['passthrough', 'separate', 'opposite'][Math.floor(rand() * 3)],
  };
}
export const LEVEL_NAMES = ['OVEN only', 'LEVEL 1', 'LEVEL 2', 'LEVEL 3'];

export function sanitizeMods(m) {
  const d = DEFAULT_MODS;
  if (!m || typeof m !== 'object') return { ...d };
  const lvl = Number.isInteger(m.maxLevel) ? Math.max(0, Math.min(3, m.maxLevel)) : d.maxLevel;
  return {
    ground: m.ground !== undefined ? !!m.ground : d.ground,
    depot: m.depot !== undefined ? !!m.depot : d.depot,
    ramp: m.ramp !== undefined ? !!m.ramp : d.ramp,
    maxLevel: lvl,
    mech: MECHS[m.mech] || LOCKED_MECHS[m.mech] ? m.mech : d.mech,
  };
}

export function modsLabel(m) {
  const md = sanitizeMods(m);
  const intakes = [md.ground && 'Ground', md.depot && 'Depot', md.ramp && 'Ramp'].filter(Boolean).join('/') || 'No intake';
  return `${intakes} · ${md.maxLevel ? 'L' + md.maxLevel : 'Oven'} · ${{ passthrough: 'Passthrough', separate: 'Hopper+Elev', opposite: 'Hopper|Elev opposite', elevIntake: 'Intake-elevator + hopper (526)', claw: 'Claw + trader' }[md.mech]}`;
}

const cfgCache = new Map();
export function getRobotConfig(id, mods) {
  const base = ROBOTS[id] || ROBOTS.team;
  const md = sanitizeMods(base.build || mods);
  const key = `${base.id}:${JSON.stringify(md)}`;
  if (cfgCache.has(key)) return cfgCache.get(key);
  const top = ['oven', 'l1', 'l2', 'l3'][md.maxLevel];
  const max = Math.min(base.elevator.max, base.elevator.setpoints[top] + 0.03);
  const cfg = { ...base, mods: md, elevator: { ...base.elevator, max } };
  cfgCache.set(key, cfg);
  return cfg;
}

export const SETPOINT_ORDER = ['stow', 'oven', 'l1', 'l2', 'l3'];

// Real carriage travel (m) for a sim elevator height, for robots that define `elevator.travel`.
export function elevTravel(cfg, elev) {
  const e = cfg.elevator;
  if (!e.travel) return elev - e.min;
  let k0 = SETPOINT_ORDER[0];
  for (const k of SETPOINT_ORDER) {
    if (elev <= e.setpoints[k]) {
      const span = e.setpoints[k] - e.setpoints[k0];
      const t = span > 1e-6 ? (elev - e.setpoints[k0]) / span : 1;
      return e.travel[k0] + (e.travel[k] - e.travel[k0]) * Math.max(0, Math.min(1, t));
    }
    k0 = k;
  }
  return e.travel[k0];
}

// Where a claw robot's held piece is, in the robot frame: { x: forward, z: up } (m).
export function clawPose(cfg, elev, armDeg) {
  const A = cfg.arm;
  const a = (armDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: A.pivot[0] + A.grip[0] * c - A.grip[1] * s, z: A.pivot[1] + elevTravel(cfg, elev) + A.grip[0] * s + A.grip[1] * c };
}
