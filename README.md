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

**Starting position & heading** are chosen in the main menu, next to the other robot settings (open **Starting position & heading**): click or drag on a top-down map of your KITCHEN to place the robot, then pick its heading (slider, ±15°, or face the pantry / oven / field / wall; Station 1–3 presets). The whole robot must fit inside your kitchen. The choice is saved, mirrored automatically for blue, and used by every match you start (practice, ranked, rooms) — if it doesn't fit (e.g. after switching to a bigger robot) the normal station spot is used instead. The starting load and mechanisms are set in the same menu.

**Pause:** Esc freezes practice and ranked runs until you resume; shared online matches keep running.

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

Under **Mechanisms** on the main menu (saved per browser, shown to everyone in the lobby) — for the **Custom robot**, **Speedy Swerve** and **Heavy Hauler** presets; Charles always plays its real build:

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

- **Team 526** — locked to the team's real build (see *Team 526 robot*): slapdown intake + beltdexer, scores LEVEL 1 and the oven back out through the intake.

## Charles — team 611's robot

The default robot (**Charles (611)**) is the team's real 2026 robot: the 3D model is built from its CAD (`public/assets/robots/team/charles.glb`), and it plays the way the real one does — numbers come from the CAD and the robot code. Its build is fixed, so the Mechanisms menu is locked while it's selected.

- **Roller claw** on an arm + 2-stage elevator: holds **one** piece. Hold **Shift** and the arm folds down past the front bumper to grab a piece off the carpet (elevator must be down); it then stows upright with the piece locked in. It also catches **one** cake at a time at the foot of the RAMP.
- **Shelves:** raise to L1/L2/L3 (21" / 33" / 48" of travel), face the PANTRY, press **F** — the arm tips forward and places the claw's piece. The claw can also feed the OVEN from the front.
- **Trader** (rear hopper): takes up to 3 carrots from the DEPOT (back the trader up to the chute) and fires them into the OVEN **out the back** in well under a second. Auto-align (Space) turns the right end toward the oven/depot for you.
- 3 pieces total aboard (G14): e.g. 2 carrots in the trader + 1 piece in the claw.
- **Starting load** (menu, shown when Charles is selected; saved per browser): your 2 preloaded carrots start either **both in the trader**, **one in the trader + one in the claw**, or **two end to end across the claw** (one left, one right, each gripped at its outer side, like the real robot). With two in the claw, one score drops **both at once** (end to end on a shelf, which needs a gap about 0.9 m wide; or both into the oven).
- Bots can drive Charles too. **Custom robot**, **Speedy Swerve** and **Heavy Hauler** are still procedural placeholders with configurable mechanisms.

## Divebomb

A second real robot, built from its STEP export (`public/assets/robots/divebomb/divebomb.glb`; the carrot that the CAD includes to show the end-effector fit is removed). It's an **L1/L2** robot (no LEVEL 3) with a **slapdown ground intake on the front** and its elevator at the **back**, so it scores on the shelves and oven with its back to them.

- **Intake:** stowed raised (95°) before the match. Hold **Shift**: it drops to the carpet, grabs **one** piece, lifts it to the **indexer** (holds 2), then can go down again.
- **Elevator:** the end effector holds **1**; after each score the elevator has to come back down to take the next carrot from the indexer (3 pieces total).
- **Oven:** carrots come out of the end effector, so it backs up to the oven mouth (auto-align turns it), one carrot per lift.
- **Depot:** with the intake stowed, line the front up under the chute and carrots drop into the beltdexer. - **Ramp:** catches and holds up to 3 carrot cakes (beltdexer 2 + end effector 1). The build is fixed in the menu. Bots can drive it.
- Estimated from the CAD (tell me if wrong): intake feed angle, hopper carrot positions, and which intakes it has.

## Team 526 robot

Built from team 526's STEP export (`public/assets/robots/526/robot526.glb`). A **speedy swerve** (4.9 m/s) with a **slapdown ground intake** on the front that feeds a **beltdexer** (holds 3). It has no elevator: the beltdexer runs pieces back out **through the intake**.

- **Intake:** stowed leaning back over the robot. Hold **Shift** and it swings over and slaps down in front to grab pieces.
- **The arm holds one carrot** in its rollers. With an empty arm it swings back to the **hand-off pose**, the beltdexer passes it the next carrot, and it goes back up.
- **LEVEL 1:** press **1** — the arm tips to 15° off vertical — face the pantry and press **F**.
- **Oven:** press **4** — the intake swings down to the mouth — and press **F**.
- **Depot:** backs up to the chute (opposite the intake; Space aligns it) and the depot drops carrots into the beltdexer.
- LEVEL 1 max; the build is fixed. Typing team number **526** locks any robot to this build.

To rebuild a model from a new STEP export: `pip install cadquery-ocp trimesh`, run `python3 tools/step_to_glb.py robot.step raw.glb 1.5 0.7 charles` (or `divebomb` / `526`), then `npx gltfpack -i raw.glb -o public/assets/robots/team/charles.glb -si 0.3 -cc -kn -km`. The script sorts parts into moving groups (elevator stage, carriage, arm, swerve wheels) by their names in the CAD tree. For a different team's CAD, see [`public/assets/robots/README.md`](public/assets/robots/README.md).

## Ranked runs and the leaderboard

- **🏆 Ranked Run** starts a solo match **on the server**: just your robot — no partners and no bots on the other alliance — with the default house rules. Only these runs count, and because the server runs the match, scores can't be edited in the browser. There are no accounts: each run is saved under the driver name typed in the menu.
- **Leaderboard**: the top 10 show on the main menu for everyone. Each driver name appears once per robot (drivetrain + build) with its best run — again only with a different robot. The full board ranks them **Overall** and per scoring mechanism (Passthrough elevator, Hopper + separate elevator, Hopper front + elevator back, Intake-elevator + hopper). The #1 overall run is the global record.
- **Removing runs:** in the leaderboard, click **Admin** and enter the admin key to get ✕ buttons (the key is remembered on that device). The key is set in `server/leaderboard.js`; an `ADMIN_KEY` environment variable on the host overrides it.

### Where the leaderboard is saved

- With `DATABASE_URL` set (any Postgres, e.g. Render Postgres, Neon or Supabase), everything is saved in one table (`hh_store`) and survives redeploys.
- Without it, data goes to `data/data.json` (or `$DATA_DIR`). That is fine locally, but **on Render's free plan the disk is wiped on every deploy/restart** — use `DATABASE_URL` there (or a persistent disk mounted at `DATA_DIR`).

## Hosting online

The server is a single Node process (Express + `ws`). Matches live in memory; the leaderboard is saved as described above.

- **LAN:** run `npm start` on one machine; others open `http://<that-machine's-IP>:3000`.
- **Internet:** deploy to any Node host that supports WebSockets (Render, Railway, Fly.io…). Start command `npm start`; it listens on `$PORT`.

## Project layout

```
shared/   game logic used by BOTH server and browser
  field.js    field geometry, zones, scoring constants (from the manual + CAD)
  sim.js      authoritative 60 Hz match sim: drive, collisions, pieces, scoring, fouls, RPs
  bot.js      A*-pathing bot drivers (fill empty slots, practice opponents)
  robots.js   robot presets (size, speed, elevator) + CAD hook
server/   Express static host + WebSocket rooms (lobby, bots, 30 Hz snapshots), leaderboard API
public/   three.js client: field/robot rendering, HUD, menus, input, prediction
test/     node --test suite (full 6-bot match, scoring, recirculation)
```

Online play is server-authoritative: clients send inputs at 60 Hz, predict their own drivetrain, and interpolate everything else.

```bash
npm test
```
