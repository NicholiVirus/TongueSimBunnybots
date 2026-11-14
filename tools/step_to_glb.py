# STEP -> GLB for the sim: tessellate every part, bucket by moving group + colour.
# Usage:  pip install cadquery-ocp trimesh
#         python3 tools/step_to_glb.py robot.step raw.glb [deflection_mm=1.5] [angle_rad=0.7]
#         npx gltfpack -i raw.glb -o public/assets/robots/team/charles.glb -si 0.3 -cc -kn -km
# Parts are sorted into groups by their names in Charles's CAD tree (see classify()); the group is
# written into each material's name (e.g. "arm_3e61b2"), which is what the renderer's rig reads.
# Groups: base, bumper, stage (elevator 1st stage), carriage, arm, wheel1..4 (swerve wheel + turret)
# Output frame = the sim's robot frame in three.js: +X forward (arm side), +Y up, +Z right, metres.
import sys, json, re
import numpy as np
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorType
from OCP.TDF import TDF_Label
from OCP.collections import Sequence_TDF_Label
from OCP.TDataStd import TDataStd_Name
from OCP.IFSelect import IFSelect_RetDone
from OCP.TopLoc import TopLoc_Location
from OCP.Quantity import Quantity_Color
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
from OCP.TopoDS import TopoDS
from OCP.BRep import BRep_Tool
import trimesh

src, out = sys.argv[1], sys.argv[2]
DEFL = float(sys.argv[3]) if len(sys.argv) > 3 else 1.5   # mm
ANG = float(sys.argv[4]) if len(sys.argv) > 4 else 0.7     # rad
ROBOT = sys.argv[5] if len(sys.argv) > 5 else 'charles'   # 'charles' | 'divebomb'
MIN_DIAG = 14.0  # mm: skip tiny hardware

doc = TDocStd_Document(TCollection_ExtendedString("doc"))
r = STEPCAFControl_Reader(); r.SetNameMode(True); r.SetColorMode(True)
assert r.ReadFile(src) == IFSelect_RetDone
r.Transfer(doc)
st = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
ct = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())

def name(l):
    n = TDataStd_Name()
    return n.Get().ToExtString() if l.FindAttribute(TDataStd_Name.GetID_s(), n) else '?'

def color(l):
    c = Quantity_Color()
    for t in (XCAFDoc_ColorType.XCAFDoc_ColorSurf, XCAFDoc_ColorType.XCAFDoc_ColorGen, XCAFDoc_ColorType.XCAFDoc_ColorCurv):
        if ct.GetColor_s(l, t, c):
            return (c.Red(), c.Green(), c.Blue())
    return None

COARSE = re.compile(r'Flex Wheel|HTD|MAXTube|Hopper|Pulley|Belt|Kraken|MAXPlanetary|SDS MK5|Sprocket|Chain|Compliant|Flap Wheel|Encoder|Bearing Block|WCP-|PDH|MPM|Radio|Breaker|Battery|Camera|Tensioner|LaserCAN|LASER CAN|Crush Block|Dyneema|ThunderHex|Rounded Hex')
def tess(shape, nm=''):
    coarse = bool(COARSE.search(nm))
    BRepMesh_IncrementalMesh(shape, DEFL * (2.5 if coarse else 1), False, ANG * (1.7 if coarse else 1), True)
    V = []; F = []; off = 0
    ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        face = TopoDS.Face(ex.Current())
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri is not None:
            trsf = loc.Transformation()
            n = tri.NbNodes()
            for i in range(1, n + 1):
                p = tri.Node(i).Transformed(trsf)
                V.append((p.X(), p.Y(), p.Z()))
            rev = face.Orientation() == TopAbs_REVERSED
            for i in range(1, tri.NbTriangles() + 1):
                a, b, c = tri.Triangle(i).Get()
                F.append((off + a - 1, off + c - 1, off + b - 1) if rev else (off + a - 1, off + b - 1, off + c - 1))
            off += n
        ex.Next()
    return np.array(V, dtype=np.float64).reshape(-1, 3), np.array(F, dtype=np.int64).reshape(-1, 3)

ELEV_STAGE = ['(42" L', '2" x 1" x 0.0625" Aluminum Box Tube (25" L', '1" x 1" x 0.0625" Aluminum Box Tube (25" L', 'Triangle 4136', '90 Degree Gusset',
              'Elevator Rope Pulley Mounting Kit', 'Inline Clamping (WCP) <3>', 'Inline Clamping (WCP)-Mirrored <3>']
ELEV_CARR = ['(22" L', '(9" L', 'Inline Clamping (WCP) <1>', 'Inline Clamping (WCP) <2>', 'Inline Clamping (WCP)-Mirrored <1>', 'Inline Clamping (WCP)-Mirrored <2>', 'Dyneema Tensioning Cam']
SSTI_CARR = ['Part 10', '2" x 2" x 0.0625" Aluminum Box Tube (7" L', 'Kraken X60 Brushless Motor <1>', 'MAXPlanetary (REV) <1>', 'WCP Through Bore Encoder']

def classify_dive(path, nm, bb):
    """Divebomb: groups base, bumper, carriage (end effector + its elevator frame), intake (slapdown arm)."""
    full = path + [nm]
    top = full[1] if len(full) > 1 else nm
    mn, mx = bb
    if 'End Effector' in top: return 'carriage'
    if 'Claudes NEW Elevator' in top:
        child = full[2] if len(full) > 2 else nm
        if any(k in child for k in ('(17" L', 'Dyneema Tensioning', 'Inline Clamping')): return 'carriage'
        if '(25" L' in child and mx[2] < 600: return 'carriage'
        return 'base'
    if "G-take" in top:
        # the slapdown arm: everything past the pivot (y > 340 mm) plus its long side tubes
        if mn[1] > 340 or child_is_arm_tube(nm): return 'intake'
        return 'base'
    if 'Bumper AS <1>' in path and nm == 'Part 6': return 'bumper'
    if nm.startswith('Polycarb') or nm in ('Hopper Lip',): return 'glass' if nm.startswith('Polycarb') else 'base'
    return 'base'

def child_is_arm_tube(nm):
    return nm.startswith('Tube 2"x1"x19.5')

def is_carrot(bb):
    d = sorted((bb[1] - bb[0]).tolist())
    return 140 < d[0] < 165 and 140 < d[1] < 165 and 440 < d[2] < 470

def classify(path, nm, bb):
    """path = names of ancestors (top first), nm = leaf name, bb = (min, max) in CAD mm"""
    full = path + [nm]
    if 'Claudes NEW Elevator <1>' in path or nm == 'Claudes NEW Elevator <1>':
        i = full.index('Claudes NEW Elevator <1>')
        child = full[i + 1] if i + 1 < len(full) else nm
        if any(k in child for k in ELEV_STAGE): return 'stage'
        if any(k in child for k in ELEV_CARR): return 'carriage'
        return 'base'
    if 'NEW SSTI <1>' in path:
        i = full.index('NEW SSTI <1>')
        child = full[i + 1]
        if child == 'SSTI <1>':
            leaf = full[i + 2] if i + 2 < len(full) else nm
            return 'carriage' if any(k in leaf for k in SSTI_CARR) else 'arm'
        if child == 'Part 1' and bb[0][2] < 100 and bb[0][0] > 100: return 'base'  # camera on the frame
        if any(child.startswith(k) for k in SSTI_CARR): return 'carriage'
        return 'arm'
    m = [p for p in full if p.startswith('SDS MK5n <')]
    if m and (nm.startswith('SDS MK5 Molded Wheel') or nm.startswith('SDS MK5 Turret')):
        return 'wheel' + m[0][-2]
    # the elevator-top camera and its holder ride on the middle stage
    if len(path) == 1 and nm in ('id11', 'id21', 'Part 1') and bb[0][2] > 1000: return 'stage'
    if 'Bumper AS <1>' in path and nm == 'Part 6': return 'bumper'
    # clear polycarbonate panels of the trader
    if nm in ('poly side plate', 'poly backing', 'Part 14') or nm.startswith('Did some say'): return 'glass'
    return 'base'

buckets = {}   # (group, rgb) -> [V list, F list, nverts]
stats = []
skipped = 0
def add(group, rgb, V, F):
    b = buckets.setdefault((group, rgb), [[], [], 0])
    b[0].append(V); b[1].append(F + b[2]); b[2] += len(V)

def walk(l, loc, path, inherited):
    global skipped
    tgt = l
    if st.IsReference_s(l):
        ref = TDF_Label(); st.GetReferredShape_s(l, ref); tgt = ref
        loc = loc.Multiplied(st.GetLocation_s(l))
    nm = name(tgt)
    col = color(tgt) or color(l) or inherited
    kids = Sequence_TDF_Label(); st.GetComponents_s(tgt, kids, False)
    if kids.Length():
        for i in range(1, kids.Length() + 1): walk(kids.Value(i), loc, path + [nm], col)
        return
    shape = st.GetShape_s(tgt)
    V, F = tess(shape, nm)
    if not len(F): return
    t = loc.Transformation()
    M = np.array([[t.Value(i, j) for j in range(1, 5)] for i in range(1, 4)])
    V = V @ M[:, :3].T + M[:, 3]
    bb = (V.min(0), V.max(0))
    if np.linalg.norm(bb[1] - bb[0]) < MIN_DIAG:
        skipped += 1; return
    if ROBOT == 'divebomb' and is_carrot(bb):
        skipped += 1  # the CAD includes a carrot showing how it fits in the end effector: not part of the robot
        return
    g = classify_dive(path, nm, bb) if ROBOT == 'divebomb' else classify(path, nm, bb)
    rgb = tuple(round(c, 3) for c in (col or (0.45, 0.45, 0.47)))
    add(g, rgb, V, F)
    stats.append((len(F), g, nm, [round(float(x), 1) for x in np.concatenate(bb)]))

roots = Sequence_TDF_Label(); st.GetFreeShapes(roots)
for i in range(1, roots.Length() + 1): walk(roots.Value(i), TopLoc_Location(), [], None)

# Charles: CAD (mm; X left, -Y forward, Z up)  ->  three robot frame (m; X forward, Y up, Z right)
def conv(V):
    if ROBOT == 'divebomb':  # forward = the intake side (+Y), scoring out the back
        return np.stack([V[:, 1], V[:, 2], V[:, 0]], axis=1) / 1000.0
    return np.stack([-V[:, 1], V[:, 2], -V[:, 0]], axis=1) / 1000.0

scene = trimesh.Scene()
info = {'groups': {}, 'tris': 0}
for (g, rgb), (Vs, Fs, _) in sorted(buckets.items()):
    V = conv(np.concatenate(Vs)); F = np.concatenate(Fs)
    hexc = '%02x%02x%02x' % tuple(int(round(c ** (1 / 2.2) * 255)) for c in rgb)  # OCC colours are linear
    mat = trimesh.visual.material.PBRMaterial(name=f'{g}_{hexc}', baseColorFactor=[*(int(round(c * 255)) for c in rgb), 255], metallicFactor=0.3, roughnessFactor=0.55)  # glTF factors are linear, like OCC's
    mesh = trimesh.Trimesh(vertices=V, faces=F, process=False)
    mesh.visual = trimesh.visual.TextureVisuals(material=mat)
    scene.add_geometry(mesh, node_name=f'{g}|{hexc}', geom_name=f'{g}|{hexc}')
    gi = info['groups'].setdefault(g, {'tris': 0, 'min': V.min(0).tolist(), 'max': V.max(0).tolist()})
    gi['tris'] += len(F); gi['min'] = np.minimum(gi['min'], V.min(0)).tolist(); gi['max'] = np.maximum(gi['max'], V.max(0)).tolist()
    info['tris'] += len(F)
scene.export(out)
info['skipped_tiny'] = skipped
json.dump(info, open(out + '.json', 'w'), indent=1)
stats.sort(reverse=True)
with open(out + '.stats.txt', 'w') as f:
    for s in stats: f.write(f'{s[0]:7d} {s[1]:9s} {s[2]} {s[3]}\n')
print(json.dumps(info, indent=1))
