# Dropping in your robot CAD

Every robot currently renders as a procedural **placeholder** (swerve base, bumpers, 2-stage elevator, roller intake). Physics never uses the mesh — only the numbers in `shared/robots.js` — so swapping in CAD is purely visual.

## 1. Export a `.glb`

| CAD tool | Path to `.glb` |
| --- | --- |
| Onshape | Right-click the assembly tab → **Export** → format **GLTF**, check "Export as single file" (`.glb`). |
| SolidWorks / Inventor | Export **STEP** → open in Blender (STEP import add-on) or FreeCAD → export **glTF Binary (.glb)**. |
| Fusion 360 | Export **OBJ/FBX** → Blender → export **glTF Binary (.glb)**. |

Tips:

- Keep it under ~15 MB. In Blender, a **Decimate** modifier (ratio 0.2–0.4) on heavy parts (wheels, fasteners) helps a lot; delete screws/bolts entirely.
- Units should be **meters** (use `scale: 0.001` below if the export is in mm).
- Robot **front** should point along **+X**, **up** is **+Y** (glTF default). Use `yaw` below if it doesn't.
- Give the moving elevator stage/carriage a clear node name (e.g. `Carriage`) so the sim can raise it.

## 2. Put it here

```
public/assets/robots/team/robot.glb
```

## 3. Point the preset at it

In `shared/robots.js`, on the `team` preset:

```js
model: {
  url: '/assets/robots/team/robot.glb',
  scale: 1,            // 0.001 if exported in millimeters
  yaw: 0,              // degrees, rotate so the intake faces +X
  z: 0,                // lift/lower the model (meters)
  elevatorNode: 'Carriage', // optional: node raised with the elevator
  hideBumpers: false,  // true if the CAD already has bumpers
},
```

Then match the physics to the real robot in the same preset: `length`/`width` (bumper-to-bumper, meters), `maxSpeed`, `elevator.max`, `intakeWidth`.

If the file fails to load, the placeholder stays and the browser console shows why.
