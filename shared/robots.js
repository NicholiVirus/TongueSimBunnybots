// Robot presets. Every robot uses the same mechanism model:
//   swerve drivetrain + front roller intake + elevator carriage that holds up to 3 pieces.
//
// To drop in your team's CAD later, export it as a .glb and set `model` on a preset
// (see public/assets/robots/README.md). Physics only uses the numbers below, so the
// CAD is purely visual — tune `length`/`width`/`elevator` to match the real robot.

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
    name: 'Our Robot (placeholder)',
    blurb: 'Placeholder for our CAD — balanced elevator robot.',
    // model: { url: '/assets/robots/team/robot.glb', scale: 1, yaw: 0, z: 0, elevatorNode: 'Carriage' },
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
export const DEFAULT_MODS = { ground: true, depot: true, ramp: true, maxLevel: 3, mech: 'passthrough' };
export const MECHS = { passthrough: 'Passthrough elevator', separate: 'Hopper + separate elevator', opposite: 'Hopper front + elevator back' };
// one piece per lift, reloaded from a hopper
export const isOneAtATime = (mods) => mods?.mech === 'separate' || mods?.mech === 'opposite';
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
    mech: MECHS[m.mech] ? m.mech : d.mech,
  };
}

export function modsLabel(m) {
  const md = sanitizeMods(m);
  const intakes = [md.ground && 'Ground', md.depot && 'Depot', md.ramp && 'Ramp'].filter(Boolean).join('/') || 'No intake';
  return `${intakes} · ${md.maxLevel ? 'L' + md.maxLevel : 'Oven'} · ${{ passthrough: 'Passthrough', separate: 'Hopper+Elev', opposite: 'Hopper|Elev opposite' }[md.mech]}`;
}

const cfgCache = new Map();
export function getRobotConfig(id, mods) {
  const base = ROBOTS[id] || ROBOTS.team;
  const md = sanitizeMods(mods);
  const key = `${base.id}:${JSON.stringify(md)}`;
  if (cfgCache.has(key)) return cfgCache.get(key);
  const top = ['oven', 'l1', 'l2', 'l3'][md.maxLevel];
  const max = Math.min(base.elevator.max, base.elevator.setpoints[top] + 0.03);
  const cfg = { ...base, mods: md, elevator: { ...base.elevator, max } };
  cfgCache.set(key, cfg);
  return cfg;
}

export const SETPOINT_ORDER = ['stow', 'oven', 'l1', 'l2', 'l3'];
