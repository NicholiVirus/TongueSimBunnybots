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
export const getRobotConfig = (id) => ROBOTS[id] || ROBOTS.team;

export const SETPOINT_ORDER = ['stow', 'oven', 'l1', 'l2', 'l3'];
