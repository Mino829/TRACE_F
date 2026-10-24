# キャンパスの外の床（舗装の縞・ピロティの石・植え込み・木）
# キャンパス全体.blend を開いて exec(open(path, encoding="utf-8").read()) で実行する（make_campus_all.py の最後でも実行する）。
# 何度実行しても、コレクション「41_外の床」の "ground_gen" 付きのものを作り直すだけ。
#
# 参考（2026-10-21）：
#   image/02_外観/キャンパス施設.jpg（配置図：北の道路沿いの四角い植え込み、西の道路・運河・南の端の木の列、豊洲駅側の角の大きな木）
#   image/02_外観/研究棟_外観2.jpg と image/07_外観_WikimediaCommons/外観05〜10（広場の床：濃いグレーと明るいグレーの石の太い縞。
#     研究棟の方を見ると横に走る＝碁盤の目の u が一定の帯）
#   image/細かい修正点…/6858（本部棟前も同じ縞）、6861・6862（本部棟のピロティは明るいベージュの磨いた石）
# 配置図は縮尺が正確ではないので、場所はモデルの建物と敷地（site.blend の「敷地_キャンパス」の外形）に合わせた。
# 木・植え込みは、上に何かある所（建物・ピロティ）、TRACE の道の線の近く、屋台などの近くには置かない（自動で確かめる）。
# 座標は「碁盤の目」（u, v）。教室棟の中心が原点、+u = 研究棟側、+v = 道路側（北西）。
import bpy, bmesh, math
from mathutils import Matrix, Vector

TH = 0.8168140899333461
CEN = (-160.1, 36.1)
COL_NAME = "41_外の床"
GEN = "ground_gen"
Z0 = 0.06                     # 舗装の上面（site.blend の敷地の板は 0.05）
Z1 = 0.08                     # 上に重ねる所（ピロティの石など）

# 敷地の外形（site.blend の「敷地_キャンパス」の頂点を碁盤の目にしたもの）
SITE = [(80.2, -119.8), (-46.0, -102.8), (-49.3, -124.2), (-147.8, -110.3), (-151.1, -106.3),
        (-135.1, 14.2), (-127.1, 21.2), (76.6, 17.9)]
# 縞（u 方向にくり返す帯）：(色, 幅 m)
BANDS = [("dark", 2.4), ("light", 1.2), ("dark", 2.4), ("pale", 0.6)]
# 上に重ねる床：(色, u0, u1, v0, v1)
OVERLAYS = [
    ("piloti", -100.4, -66.8, -96.5, -50.0),      # 本部棟のピロティ（磨いた石）
    ("piloti", -42.05, 13.0, -13.75, -7.6),       # 教室棟の南東のピロティ
]
# 植え込み（低い縁＋緑）：(u0, u1, v0, v1)。配置図の北の道路沿いの四角い植え込みと、西の道路沿いの帯
PLANTERS = ([(u, u + 9.0, 13.5, 18.0) for u in range(-122, -60, 12)]
            + [(u, u + 10.0, 13.5, 17.5) for u in range(-38, 30, 14)]
            + [(-127.5, -124.5, -92.0, -36.0), (-127.5, -124.5, -28.0, 5.0)])
TREE_STEP = 8.0


def bsdf(m):
    for n in m.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            return n


def mat(name, rgb, rough=0.7):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = bsdf(m)
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    m.diffuse_color = (*rgb, 1)
    return m


MAT = dict(
    dark=mat("外の床_濃い石", (0.27, 0.27, 0.28), 0.8),
    light=mat("外の床_明るい石", (0.58, 0.57, 0.54), 0.8),
    pale=mat("外の床_白っぽい石", (0.70, 0.69, 0.66), 0.8),
    piloti=mat("外の床_ピロティの磨いた石", (0.72, 0.68, 0.61), 0.35),
    joint=mat("外の床_目地", (0.50, 0.48, 0.44), 0.6),
    curb=mat("外の床_植え込みの縁", (0.55, 0.55, 0.53), 0.7),
    green=mat("外の床_植え込み", (0.14, 0.26, 0.09), 0.9),
    trunk=mat("外の床_幹", (0.25, 0.18, 0.12), 0.9),
    leaf=mat("外の床_木の葉", (0.17, 0.31, 0.11), 0.9),
)
M_GRID = Matrix.Translation((CEN[0], CEN[1], 0)) @ Matrix.Rotation(TH, 4, 'Z')


class MB:
    def __init__(self):
        self.v, self.f, self.mi, self.keys = [], [], [], []

    def _m(self, key):
        if key not in self.keys:
            self.keys.append(key)
        return self.keys.index(key)

    def face(self, pts, key):
        b = len(self.v)
        self.v += [tuple(M_GRID @ Vector(p)) for p in pts]
        self.f.append(tuple(range(b, b + len(pts))))
        self.mi.append(self._m(key))

    def box(self, x0, x1, y0, y1, z0, z1, key, top=None):
        for pts, k in (([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], top or key),
                       ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], key),
                       ([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], key),
                       ([(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)], key),
                       ([(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)], key)):
            self.face(pts, k)

    def cyl(self, cx, cy, r, z0, z1, key, seg=8):
        pts = [(cx + r * math.cos(2 * math.pi * i / seg), cy + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
        for i in range(seg):
            a, b = pts[i], pts[(i + 1) % seg]
            self.face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], key)
        self.face([(x, y, z1) for x, y in pts], key)

    def cone(self, cx, cy, r, z0, z1, key, seg=8):
        pts = [(cx + r * math.cos(2 * math.pi * i / seg), cy + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
        for i in range(seg):
            a, b = pts[i], pts[(i + 1) % seg]
            self.face([(a[0], a[1], z0), (b[0], b[1], z0), (cx, cy, z1)], key)

    def build(self, name, col):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        for k in self.keys:
            me.materials.append(MAT[k])
        for p, i in zip(me.polygons, self.mi):
            p.material_index = i
        me.validate()
        o = bpy.data.objects.new(name, me)
        o[GEN] = True
        col.objects.link(o)
        return o


def clip(poly, axis, value, keep_greater):
    """Sutherland–Hodgman：poly を「axis 座標 ≥ value」（keep_greater）か「≤ value」で切る"""
    out = []
    n = len(poly)
    inside = (lambda p: p[axis] >= value) if keep_greater else (lambda p: p[axis] <= value)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        ia, ib = inside(a), inside(b)
        if ia:
            out.append(a)
        if ia != ib:
            t = (value - a[axis]) / (b[axis] - a[axis])
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def grid_of(p):
    dx, dy = p.x - CEN[0], p.y - CEN[1]
    return (math.cos(TH) * dx + math.sin(TH) * dy, -math.sin(TH) * dx + math.cos(TH) * dy)


# ---------- 準備 ----------
scene = bpy.context.scene
col = bpy.data.collections.get(COL_NAME)
if col is None:
    col = bpy.data.collections.new(COL_NAME)
    scene.collection.children.link(col)
for o in list(bpy.data.objects):
    if o.get(GEN):
        me = o.data
        bpy.data.objects.remove(o)
        if me is not None and me.users == 0:
            bpy.data.meshes.remove(me)

# ---------- 舗装の縞 ----------
pv = MB()
u_min, u_max = min(p[0] for p in SITE), max(p[0] for p in SITE)
u = u_min
k = 0
while u < u_max:
    key, w = BANDS[k % len(BANDS)]
    piece = clip(clip(SITE, 0, u, True), 0, u + w, False)
    if len(piece) >= 3:
        pv.face([(x, y, Z0) for x, y in piece], key)
    u += w
    k += 1
pv.build("外の床_舗装の縞", col)

# ---------- ピロティの磨いた石（0.9m 角の目地つき） ----------
pl = MB()
for key, u0, u1, v0, v1 in OVERLAYS:
    pl.face([(u0, v0, Z1), (u1, v0, Z1), (u1, v1, Z1), (u0, v1, Z1)], key)
    x = u0 + 0.9
    while x < u1:
        pl.face([(x - 0.02, v0, Z1 + 0.003), (x + 0.02, v0, Z1 + 0.003), (x + 0.02, v1, Z1 + 0.003), (x - 0.02, v1, Z1 + 0.003)], "joint")
        x += 1.8
pl.build("外の床_ピロティの石", col)

# ---------- 置いてよい所か（上に建物がない・道の線から離れている・屋台などから離れている） ----------
dg = bpy.context.evaluated_depsgraph_get()
SEGS = []
net = bpy.data.objects.get("TRACE_道の網")
if net is not None and net.type == 'MESH':
    for e in net.data.edges:
        a, b = (net.matrix_world @ net.data.vertices[i].co for i in e.vertices)
        if a.z < 2.0 and b.z < 2.0:
            SEGS.append((grid_of(a), grid_of(b)))
PROPS = [o for c in ("40_入口と屋台と交流プラザ",) if bpy.data.collections.get(c) for o in bpy.data.collections[c].all_objects]
PROP_BOXES = []
for o in PROPS:
    g = [grid_of(o.matrix_world @ Vector(c)) for c in o.bound_box]
    PROP_BOXES.append((min(p[0] for p in g), max(p[0] for p in g), min(p[1] for p in g), max(p[1] for p in g)))


def dist_seg(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def inside_site(u, v):
    c = False
    n = len(SITE)
    for i in range(n):
        (x1, y1), (x2, y2) = SITE[i], SITE[(i + 1) % n]
        if (y1 > v) != (y2 > v) and u < x1 + (v - y1) * (x2 - x1) / (y2 - y1):
            c = not c
    return c


def free(u, v, r):
    """半径 r の中が空いているか"""
    for du, dv in ((0, 0), (r, 0), (-r, 0), (0, r), (0, -r)):
        uu, vv = u + du, v + dv
        if not inside_site(uu, vv):
            return False
        o = M_GRID @ Vector((uu, vv, 0.3))
        ok, loc, *_ = scene.ray_cast(dg, o, Vector((0, 0, 1)), distance=25.0)
        if ok:
            return False
    if any(dist_seg((u, v), a, b) < r + 1.0 for a, b in SEGS):
        return False
    if any(x0 - r - 1 < u < x1 + r + 1 and y0 - r - 1 < v < y1 + r + 1 for x0, x1, y0, y1 in PROP_BOXES):
        return False
    return True


# ---------- 植え込み ----------
gp = MB()
placed = 0
for u0, u1, v0, v1 in PLANTERS:
    # 長い帯は空いている所だけに分けて置く
    step = 2.0
    runs, cur = [], None
    long_u = (u1 - u0) >= (v1 - v0)
    a0, a1 = (u0, u1) if long_u else (v0, v1)
    t = a0
    while t < a1 - 1e-6:
        tb = min(a1, t + step)
        cu, cv = ((t + tb) / 2, (v0 + v1) / 2) if long_u else ((u0 + u1) / 2, (t + tb) / 2)
        r = (v1 - v0) / 2 if long_u else (u1 - u0) / 2
        if free(cu, cv, r):
            cur = [t, tb] if cur is None else [cur[0], tb]
        else:
            if cur:
                runs.append(cur)
            cur = None
        t = tb
    if cur:
        runs.append(cur)
    for ra, rb in runs:
        if rb - ra < 2.0:
            continue
        x0, x1, y0, y1 = (ra, rb, v0, v1) if long_u else (u0, u1, ra, rb)
        gp.box(x0, x1, y0, y1, 0, 0.45, "curb", top="curb")
        gp.box(x0 + 0.15, x1 - 0.15, y0 + 0.15, y1 - 0.15, 0.45, 0.75, "green")
        placed += 1
gp.build("外の床_植え込み", col)

# ---------- 木 ----------
tr = MB()
TREES = []
# 運河沿い（敷地の東の辺の 6m 内側）、南の端（南の辺の 2.5m 内側）、豊洲駅側の角の大きな木
(ex0, ey0), (ex1, ey1) = SITE[0], SITE[7]
for i in range(int(math.hypot(ex1 - ex0, ey1 - ey0) / TREE_STEP)):
    t = (i + 0.5) / int(math.hypot(ex1 - ex0, ey1 - ey0) / TREE_STEP)
    TREES.append((ex0 + (ex1 - ex0) * t - 6.0, ey0 + (ey1 - ey0) * t, 7.0, 2.0))
(sx0, sy0), (sx1, sy1) = SITE[1], SITE[0]
for i in range(int(math.hypot(sx1 - sx0, sy1 - sy0) / TREE_STEP)):
    t = (i + 0.5) / int(math.hypot(sx1 - sx0, sy1 - sy0) / TREE_STEP)
    TREES.append((sx0 + (sx1 - sx0) * t, sy0 + (sy1 - sy0) * t + 2.5, 7.0, 2.0))
TREES += [(-138.0, -112.0, 10.0, 4.0), (-143.0, -105.0, 9.0, 3.5), (-136.0, -98.0, 8.0, 3.0)]
trees = 0
for u, v, h, r in TREES:
    if not free(u, v, 0.6):
        continue
    tr.cyl(u, v, 0.18, Z0, h * 0.55, "trunk", seg=6)
    tr.cyl(u, v, r, h * 0.45, h * 0.8, "leaf", seg=8)
    tr.cone(u, v, r * 0.85, h * 0.8, h, "leaf", seg=8)
    trees += 1
tr.build("外の床_木", col)
print("ground DONE planters", placed, "trees", trees, "verts", sum(len(o.data.vertices) for o in col.objects))
