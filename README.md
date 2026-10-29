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
| Intake (hold) | Shift | RT |
| Auto-align to PANTRY / OVEN (hold) | Space | LT |
| Elevator: L1 / L2 / L3 | 1 / 2 / 3 | A / B / Y |
| Elevator: OVEN / stow | 4 / R | X / LB |
| Score (hold) | F | RB |
| Eject a piece | G | D-pad down |
| Camera (driver station, chase, overhead, broadcast) | C | View |
| Field / robot-oriented | V | L-stick click |
| Mini-map / chat / pause | M / T / Esc | Menu |

Driving is field-oriented **from your camera's point of view** (driver station = like the real alliance wall).

**Auto-align:** hold Space near your PANTRY and the robot locks its heading and distance to the shelves — you can only slide left/right, then press F. Shelves have no grid: the piece lands right where your robot is, as long as it doesn't overlap another (a small nudge against a neighbor is allowed). Near your OVEN it drives itself onto the closest mouth. When a robot carries both, cakes go to the pantry first and carrots to the oven first.

## The game (as implemented)

Rules come from the Blair Bunnybots 2026 Game Manual v1.2; field geometry comes from the official field CAD (tape lines, PANTRY shelf heights, OVEN/RAMP, DEPOT chutes, DINNER TABLE) and the manual's AprilTag table.

- **Bots** shelve only CARROT CAKES (worth the same in AUTO and TELEOP) and send carrots to the OVEN to bake more.
- **Match:** 3 s countdown → 15 s AUTO → 2:15 TELEOP (last 20 s = ENDGAME) → PARK judged 3 s after the buzzer.
- **PANTRY** (your KITCHEN, scoring-table wall): 3 shelves, no slots — pieces sit wherever they fit, 5 rollers fill a shelf. Carrot 3/4/5, cake 8/10/12. Only your own pantry (G16).
- **OVEN** (under your RAMP): carrot 2, cake 1. Every 3 oven carrots are traded at the opposing DEPOT for one of your 9 CARROT CAKES (the 3 carrots go back to **your own** DEPOT — a house rule; tick **Official competition rules** to send them to the opponent's depot as the manual says), and the human player stores it at your RAMP. Stored cakes only roll down once one of your robots has sat still for 1 s at the bottom of the ramp (in front of the oven's AprilTag face — Space auto-aligns you there); then they drop straight into it 0.5 s apart until it's full (3 cakes for an empty robot). To take fewer, hold Space to auto-align at the foot of the ramp and press **1**, **2** or **3**: exactly that many cakes roll down (the number keys don't move the elevator while you're aligned there) — useful for robots whose elevator lifts one piece at a time. A match setting (practice setup / lobby host) switches to **auto-roll**, where cakes roll onto the field as soon as they're baked. Oven-scored cakes are stored the same way. The count is shown on a sign above each ramp on the field and in the HUD (`Ramp N🍰`).
- **DEPOT** (your FARM, opposite end — two chutes): park under a chute and the human player drops a carrot into your robot. 24 carrots per alliance: 5 prestaged, 2 preloaded per robot, the rest at the depot.
- **TAXI** 2, **PARK** in your TABLE ZONE 2, **HARVEST HAUL** +1 per carrot / +3 per cake held while parked (max 3).
- **RPs:** Win 3 / Tie 1, Stocked Up (3+ on every shelf), Baked Up (a cake on every shelf), Dinner (10+ endgame points).
- **3 pieces per robot** (G14). Auto-called fouls: **G11** contact inside an opponent's KITCHEN/FARM, **G12** TABLE ZONE protection in ENDGAME, **G13** crossing the CENTER LINE in AUTO (minor = 4 to the opponent).

**Official competition rules** (practice setup / lobby host toggle) switches two house rules back to the manual: traded oven carrots go to the *opposing* depot, and human players can't act during AUTO (no depot feeding, trades or ramp cakes until TELEOP).

Simplifications: pieces are scored when your robot is lined up at the right elevator height (no full 3D piece physics on shelves), human players are automatic, and judgment-call rules (pinning, damage, launching) aren't enforced.

## Robot configuration

Under **Mechanisms** on the main menu (saved per browser, shown to everyone in the lobby):

| Option | Effect |
| --- | --- |
| Ground intake | Pick pieces off the carpet and the table cake. Off = no roller; get pieces from the DEPOT/RAMP only. |
| Depot intake | Human player can drop carrots into you at your DEPOT chutes. |
| Ramp intake | Catch stored CARROT CAKES at the bottom of your RAMP. |
| Highest shelf | OVEN only, LEVEL 1, 2 or 3 — the elevator is built only that tall. |
| Passthrough elevator | All held pieces ride the carriage; score back-to-back at a shelf, but driving gets twitchier when raised. |
| Hopper front + elevator back | Like hopper + separate elevator, but the elevator is on the opposite side from the intake: you score on the shelves **with your back to the pantry** (auto-align turns you around; the chase camera sits on the front side). |
| Hopper + separate elevator | Pieces wait in a low hopper; the elevator takes one per lift and reloads at the bottom (~0.45 s, then goes back to the same shelf automatically with auto-stow on). Steadier when raised. |

Pantry scoring only happens once the elevator has arrived at the shelf it was sent to.

In **Practice**, every bot spawns with a random build; the setup screen lists each partner/opponent so you can change its drivetrain and mechanisms or re-roll it (🎲).

Auto-align (Space) also works at your **DEPOT** chutes: it parks you right under the mouth.

## Team easter eggs

- **Team 526** — locked build (the Mechanisms menu greys out): max **LEVEL 1**, the **elevator is the ground intake** (holds one piece and scores it on L1 or in the OVEN), and a separate **hopper fed only by the DEPOT/RAMP** that can only dump into the OVEN.

## Your robot's CAD

All robots are procedural placeholders for now. To drop in your team's CAD, see [`public/assets/robots/README.md`](public/assets/robots/README.md) — export a `.glb`, put it in `public/assets/robots/team/`, and set `model` on the `team` preset in `shared/robots.js`. Tune the preset's size, speed and elevator height to match the real robot.

## Accounts, ranked runs and the leaderboard

- **Register / log in** from the bar at the top of the main menu (username + password; passwords are stored as salted scrypt hashes). Logged-in drivers always play under their account name. Guests can still play practice and online rooms.
- **🏆 Ranked Run** starts a solo match **on the server**: just your robot — no partners and no bots on the other alliance — with the default house rules. Only these runs count for the leaderboard, and because the server runs the match, scores can't be edited in the browser.
- **Leaderboard** (main menu): one board per scoring mechanism (Passthrough elevator, Hopper + separate elevator, Hopper front + elevator back, Intake-elevator + hopper) keeping each driver's best score with that mechanism, plus **Overall** with each driver's best on any mechanism.
- **Removing scores:** only leaderboard admins see the ✕ buttons. Set admin usernames with the `LEADERBOARD_ADMINS` environment variable (comma-separated) or in `ADMINS` in `server/accounts.js` (currently `611_Nick`). Register that username yourself first so nobody else can claim it.

### Where accounts are saved

- With `DATABASE_URL` set (any Postgres, e.g. Render Postgres, Neon or Supabase), everything is saved in one table (`hh_store`) and survives redeploys.
- Without it, data goes to `data/data.json` (or `$DATA_DIR`). That is fine locally, but **on Render's free plan the disk is wiped on every deploy/restart** — use `DATABASE_URL` there (or a persistent disk mounted at `DATA_DIR`).

## Hosting online

The server is a single Node process (Express + `ws`). Matches live in memory; accounts and the leaderboard are saved as described above.

- **LAN:** run `npm start` on one machine; others open `http://<that-machine's-IP>:3000`.
- **Internet:** deploy to any Node host that supports WebSockets (Render, Railway, Fly.io…). Start command `npm start`; it listens on `$PORT`.

## Project layout

```
shared/   game logic used by BOTH server and browser
  field.js    field geometry, zones, scoring constants (from the manual + CAD)
  sim.js      authoritative 60 Hz match sim: drive, collisions, pieces, scoring, fouls, RPs
  bot.js      A*-pathing bot drivers (fill empty slots, practice opponents)
  robots.js   robot presets (size, speed, elevator) + CAD hook
server/   Express static host + WebSocket rooms (lobby, bots, 30 Hz snapshots), accounts + leaderboard API
public/   three.js client: field/robot rendering, HUD, menus, input, prediction
test/     node --test suite (full 6-bot match, scoring, recirculation)
```

Online play is server-authoritative: clients send inputs at 60 Hz, predict their own drivetrain, and interpolate everything else.

```bash
npm test
```
