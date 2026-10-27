# Harvest Havoc Sim

A browser-based, multiplayer 3D robot driving sim of **Blair Bunnybots 2026: Harvest Havoc** (FRC 449). Drive a swerve robot, haul CARROTS from your FARM, stock your PANTRY, bake CARROT CAKES in the OVEN, and park at the DINNER TABLE — solo against bots or online with friends.

## Quick start

```bash
npm install
npm start          # http://localhost:3000
```

- **Practice** runs fully in the browser against bots (no server round-trips).
- **Quick Play / Create Room / Join** use the Node server: share the 4-letter room code or the invite link (`/?room=CODE`).
- Requires Node 18+.

## Controls

| Action | Keyboard | Gamepad (Xbox) |
| --- | --- | --- |
| Drive | W A S D | Left stick |
| Rotate | Q / E or ← / → | Right stick |
| Intake (hold) | Space | RT |
| Elevator: L1 / L2 / L3 | 1 / 2 / 3 | A / B / Y |
| Elevator: OVEN / stow | 4 / R | X / LB |
| Score (hold) | F | RB |
| Eject a piece | G | LT |
| Camera (driver station, chase, overhead, broadcast) | C | View |
| Field / robot-oriented | V | L-stick click |
| Mini-map / chat / pause | M / T / Esc | Menu |

Driving is field-oriented **from your camera's point of view** (driver station = like the real alliance wall).

## The game (as implemented)

Rules come from the Blair Bunnybots 2026 Game Manual v1.2; field geometry comes from the official field CAD (tape lines, PANTRY shelf heights, OVEN/RAMP, DEPOT chutes, DINNER TABLE) and the manual's AprilTag table.

- **Match:** 3 s countdown → 15 s AUTO → 2:15 TELEOP (last 20 s = ENDGAME) → PARK judged 3 s after the buzzer.
- **PANTRY** (your KITCHEN, scoring-table wall): 3 shelves × 5 slots. Carrot 3/4/5, cake 8/10/12. Only your own pantry (G16).
- **OVEN** (under your RAMP): carrot 2, cake 1. Every 3 oven carrots are traded at the opposing DEPOT for one of your 9 CARROT CAKES (the carrots go to the opponent's depot), and the cake rolls down your RAMP into the NEUTRAL ZONE. Oven-scored cakes come back down the ramp too.
- **DEPOT** (your FARM, opposite end — two chutes): park under a chute and the human player drops a carrot into your robot. 24 carrots per alliance: 5 prestaged, 2 preloaded per robot, the rest at the depot.
- **TAXI** 2, **PARK** in your TABLE ZONE 2, **HARVEST HAUL** +1 per carrot / +3 per cake held while parked (max 3).
- **RPs:** Win 3 / Tie 1, Stocked Up (3+ on every shelf), Baked Up (a cake on every shelf), Dinner (10+ endgame points).
- **3 pieces per robot** (G14). Auto-called fouls: **G11** contact inside an opponent's KITCHEN/FARM, **G12** TABLE ZONE protection in ENDGAME, **G13** crossing the CENTER LINE in AUTO (minor = 4 to the opponent).

Simplifications: pieces are scored when your robot is lined up at the right elevator height (no full 3D piece physics on shelves), human players are automatic, and judgment-call rules (pinning, damage, launching) aren't enforced.

## Your robot's CAD

All robots are procedural placeholders for now. To drop in your team's CAD, see [`public/assets/robots/README.md`](public/assets/robots/README.md) — export a `.glb`, put it in `public/assets/robots/team/`, and set `model` on the `team` preset in `shared/robots.js`. Tune the preset's size, speed and elevator height to match the real robot.

## Hosting online

The server is a single Node process (Express + `ws`) and keeps everything in memory.

- **LAN:** run `npm start` on one machine; others open `http://<that-machine's-IP>:3000`.
- **Internet:** deploy to any Node host that supports WebSockets (Render, Railway, Fly.io…). Start command `npm start`; it listens on `$PORT`.

## Project layout

```
shared/   game logic used by BOTH server and browser
  field.js    field geometry, zones, scoring constants (from the manual + CAD)
  sim.js      authoritative 60 Hz match sim: drive, collisions, pieces, scoring, fouls, RPs
  bot.js      A*-pathing bot drivers (fill empty slots, practice opponents)
  robots.js   robot presets (size, speed, elevator) + CAD hook
server/   Express static host + WebSocket rooms (lobby, bots, 30 Hz snapshots)
public/   three.js client: field/robot rendering, HUD, menus, input, prediction
test/     node --test suite (full 6-bot match, scoring, recirculation)
```

Online play is server-authoritative: clients send inputs at 60 Hz, predict their own drivetrain, and interpolate everything else.

```bash
npm test
```
