# 芝浦祭の外まわり：入口の壁（校名入り）・屋台・交流プラザ（カフェは 2026-10-21 ユーザーの指示でやめた）
# キャンパス全体.blend を開いて exec(open(path, encoding="utf-8").read()) で実行する（make_campus_all.py の最後でも実行する）。
# 何度実行しても、コレクション「40_入口と屋台と交流プラザ」の "festival_gen" 付きのものを作り直すだけ。
# 写真：image/細かい修正点-20261021T043934Z-1-001/細かい修正点/jpg/（入口の壁 6857、本部棟前の広場 6858・6859、
#   交流プラザ 6864〜6869）
#
# 座標は「碁盤の目」（u, v）。教室棟の中心が原点、+u = 研究棟側、+v = 道路側（北西）。trace/build_network.py と同じ。
import bpy, bmesh, math, os
from mathutils import Matrix, Vector

TH = 0.8168140899333461
CEN = (-160.1, 36.1)
COL_NAME = "40_入口と屋台と交流プラザ"
GEN = "festival_gen"
JP_FONTS = [r"C:\Windows\Fonts\YuGothB.ttc", r"C:\Windows\Fonts\meiryob.ttc", r"C:\Windows\Fonts\msgothic.ttc"]

# ---- 配置の表 -------------------------------------------------------------
# 入口の壁：本部棟前の広場の、北西側の屋台の列の手前（道路側）。長い辺は u に沿い、校名は -v（道路側）を向く（2026-10-21 ユーザーの指示）
#   2026-10-21：入口から屋台の通路を抜けて本部棟の下へ行く TRACE の直線（u -130, v -100.9 → u -100, v -75.4）に乗らないよう、3m 東へずらした
ENT = dict(u=-118.0, v=-97.0, length=11.0)
# 屋台：位置はユーザーが Blender で置いた所（2026-10-21）。向きは「2 列の間の通路」へ向ける（rows）か、決まった向き（yaw）
STALL_ROWS = [  # 本部棟前の広場の 2 列。お互いの列の方（間の通路）を向く
    [(-119.55, -85.33), (-116.40, -81.64), (-109.95, -79.31)],
    [(-109.06, -100.65), (-103.94, -94.14), (-99.15, -90.09)],
]
STALL_FIXED = [  # 教室棟の南東の壁（ピロティの柱の外側）に沿って 5 軒。背中が壁、正面は広場側（-v）
    (-31.0, -14.0, -90), (-24.5, -14.0, -90), (-18.0, -14.0, -90), (-11.5, -14.0, -90), (-5.0, -14.0, -90),
]
# 交流プラザ（site.blend の「交流プラザ_ブロックアウト」の外形に合わせる。ブロックアウトは site.blend で隠した）
PLAZA = dict(u0=-42.3, u1=-1.1, v0=-89.4, v1=-72.0, plinth=0.8, inset=1.3, roof=4.4, entry=(-27.0, -20.0))


def bsdf(m):
    for n in m.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            return n


def mat(name, rgb, rough=0.6, metal=0.0, alpha=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type not in ('BSDF_PRINCIPLED', 'OUTPUT_MATERIAL'):
            nt.nodes.remove(n)
    b = bsdf(m)
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Alpha"].default_value = alpha
    m.diffuse_color = (*rgb, 1)
    if alpha < 1 and hasattr(m, "surface_render_method"):
        m.surface_render_method = 'DITHERED'
    return m


# 色だけのマテリアル（Unity 向け）
MAT = dict(
    # 入口の壁（写真 6857：レンガ＋白い笠石、校章と「芝浦工業大學」、SIT と英字の校名は焦げ茶の金属）
    brick=mat("入口_レンガ", (0.55, 0.40, 0.27), 0.8),
    cap=mat("入口_壁の笠石", (0.80, 0.79, 0.76), 0.5),
    letter=mat("入口_校名の文字", (0.12, 0.10, 0.08), 0.4, 0.6),
    hedge=mat("外構_植え込み", (0.13, 0.25, 0.08), 0.9),
    trunk=mat("外構_幹", (0.25, 0.18, 0.12), 0.9),
    leaf=mat("外構_木の葉", (0.18, 0.32, 0.12), 0.9),
    # 屋台
    pole=mat("屋台_鉄の柱", (0.12, 0.12, 0.13), 0.5, 0.6),
    cloth=mat("屋台_幕", (0.86, 0.84, 0.78), 0.9),
    wood=mat("屋台_カウンター", (0.55, 0.40, 0.26), 0.7),
    white=mat("屋台_白い布", (0.93, 0.93, 0.91), 0.9),
    red=mat("屋台_赤", (0.78, 0.12, 0.10), 0.9),
    blue=mat("屋台_青", (0.12, 0.30, 0.65), 0.9),
    yellow=mat("屋台_黄", (0.92, 0.70, 0.12), 0.9),
    lantern=mat("屋台_提灯", (0.85, 0.15, 0.10), 0.7),
    grill=mat("屋台_鉄板", (0.08, 0.08, 0.08), 0.4, 0.8),
    food=mat("屋台_品物", (0.80, 0.55, 0.20), 0.8),
    # 交流プラザ（写真 6864〜6869：コンクリートの台の上の、黒い屋根の低いガラスの箱）
    p_conc=mat("交流プラザ_コンクリート", (0.55, 0.55, 0.53), 0.8),
    p_step=mat("交流プラザ_石の階段", (0.48, 0.48, 0.47), 0.7),
    p_roof=mat("交流プラザ_黒い屋根", (0.06, 0.06, 0.07), 0.5, 0.3),
    p_frame=mat("交流プラザ_黒いサッシ", (0.05, 0.05, 0.06), 0.4, 0.5),
    p_glass=mat("交流プラザ_ガラス", (0.30, 0.36, 0.38), 0.05, alpha=0.45),
    p_inner=mat("交流プラザ_中の床と壁", (0.20, 0.19, 0.18), 0.8),
    p_rail=mat("交流プラザ_手すり", (0.70, 0.71, 0.72), 0.3, 1.0),
    p_text=mat("交流プラザ_看板の文字", (0.85, 0.85, 0.83), 0.4),
)

M_GRID = Matrix.Translation((CEN[0], CEN[1], 0)) @ Matrix.Rotation(TH, 4, 'Z')


class MB:
    """面を溜めて 1 つのメッシュにする。座標は「置き場所の局所座標」→ 碁盤の目 → ワールド"""

    def __init__(self, u, v, yaw_deg=0.0):
        self.M = M_GRID @ Matrix.Translation((u, v, 0)) @ Matrix.Rotation(math.radians(yaw_deg), 4, 'Z')
        self.v, self.f, self.mi, self.keys = [], [], [], []

    def _m(self, key):
        if key not in self.keys:
            self.keys.append(key)
        return self.keys.index(key)

    def face(self, pts, key):
        b = len(self.v)
        self.v += [tuple(self.M @ Vector(p)) for p in pts]
        self.f.append(tuple(range(b, b + len(pts))))
        self.mi.append(self._m(key))

    def box(self, x0, x1, y0, y1, z0, z1, key):
        x0, x1 = min(x0, x1), max(x0, x1)
        y0, y1 = min(y0, y1), max(y0, y1)
        if x1 - x0 < 1e-4 or y1 - y0 < 1e-4 or z1 - z0 < 1e-4:
            return
        for pts in ([(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)],
                    [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],
                    [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
                    [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)],
                    [(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)],
                    [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)]):
            self.face(pts, key)

    def cyl(self, cx, cy, r, z0, z1, key, seg=10, cap=True):
        pts = [(cx + r * math.cos(2 * math.pi * i / seg), cy + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
        for i in range(seg):
            a, b = pts[i], pts[(i + 1) % seg]
            self.face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], key)
        if cap:
            self.face([(x, y, z1) for x, y in pts], key)

    def cone(self, cx, cy, r, z0, z1, key, seg=12):
        pts = [(cx + r * math.cos(2 * math.pi * i / seg), cy + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
        for i in range(seg):
            a, b = pts[i], pts[(i + 1) % seg]
            self.face([(a[0], a[1], z0), (b[0], b[1], z0), (cx, cy, z1)], key)

    def mesh_from(self, me, key, mm):
        """別のメッシュ（文字など）を、局所座標の行列 mm を通して足す"""
        b = len(self.v)
        self.v += [tuple(self.M @ (mm @ p.co)) for p in me.vertices]
        for p in me.polygons:
            self.f.append(tuple(b + i for i in p.vertices))
            self.mi.append(self._m(key))

    def build(self, name, col):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        for k in self.keys:
            me.materials.append(MAT[k])
        for p, i in zip(me.polygons, self.mi):
            p.material_index = i
        me.validate()
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = False
        o = bpy.data.objects.new(name, me)
        o[GEN] = True
        col.objects.link(o)
        return o


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
            bpy.data.meshes.remove(me) if isinstance(me, bpy.types.Mesh) else bpy.data.curves.remove(me)


def text_mesh(s, size, font_paths=None, max_width=None):
    """文字を、X = 読む向き・Z = 上の平らなメッシュにして返す（中心が原点、前に 0.03 押し出し）。幅が max_width を超えるなら縮める"""
    cu = bpy.data.curves.new("tmp_text", 'FONT')
    cu.body = s
    cu.size = size
    cu.extrude = 0.015
    cu.resolution_u = 2                    # 曲線の分割を粗くして頂点を減らす（日本語は画数が多い）
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    for fp in (font_paths or []):
        if os.path.exists(fp):
            try:
                cu.font = bpy.data.fonts.load(fp)
                break
            except Exception:
                pass
    ob = bpy.data.objects.new("tmp_text", cu)
    scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    xs = [v.co.x for v in me.vertices] or [0]
    w = max(xs) - min(xs)
    sc = min(1.0, max_width / w) if (max_width and w > 0) else 1.0
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    return me, sc



def add_text(b, s, size, font, max_width, at, face):
    """文字を b に足す。at = 文字の中心（局所座標）、face = 文字の向く方向（"-y"・"+y"・"+x"・"-x"）"""
    me, k = text_mesh(s, size, font, max_width)
    rot = {"-y": Matrix.Identity(4), "+y": Matrix.Rotation(math.pi, 4, 'Z'),
           "+x": Matrix.Rotation(math.pi / 2, 4, 'Z'), "-x": Matrix.Rotation(-math.pi / 2, 4, 'Z')}[face]
    mm = Matrix.Translation(at) @ rot @ Matrix.Rotation(math.pi / 2, 4, 'X') @ Matrix.Diagonal((k, k, 1, 1))
    b.mesh_from(me, b._key_for_text, mm)
    bpy.data.meshes.remove(me)


def tree(b, x, y, h=6.0, r=1.6):
    """木（幹＋葉のかたまり 2 段）"""
    b.cyl(x, y, 0.15, 0, h * 0.55, "trunk", seg=8)
    b.cyl(x, y, r, h * 0.45, h * 0.8, "leaf", seg=10)
    b.cone(x, y, r * 0.85, h * 0.8, h, "leaf", seg=10)


# ---------- 入口の壁（写真 6857） ----------
# レンガの長い壁に白い笠石。正面（道路側 = -v）の左に校章と「芝浦工業大學」、右に「SIT」と英字の校名。手前に植え込み
H_WALL = 1.25
w = MB(ENT["u"], ENT["v"])                 # 局所 x = u（長い辺）、局所 -y = 道路側
L2 = ENT["length"] / 2
w.box(-L2, L2, -0.3, 0.3, 0, H_WALL, "brick")
w.box(-L2 - 0.05, L2 + 0.05, -0.36, 0.36, H_WALL, H_WALL + 0.14, "cap")
for k in range(1, 6):                       # レンガの目地（横の筋）
    z = k * H_WALL / 6
    w.box(-L2, L2, -0.31, -0.3, z - 0.008, z + 0.008, "cap")
w.box(-L2 - 0.2, L2 + 0.2, -1.5, -0.3, 0, 0.55, "hedge")      # 手前の植え込み
ZT = 0.92                                                       # 文字の高さの中心（植え込みの上）
w.box(-L2 + 0.74, -L2 + 1.26, -0.34, -0.3, ZT - 0.26, ZT + 0.26, "letter")      # 校章（四角い板で代用）
w._key_for_text = "letter"
add_text(w, "芝浦工業大學", 0.42, JP_FONTS, 3.6, (-L2 + 3.3, -0.33, ZT), "-y")
add_text(w, "SIT", 0.5, None, 1.2, (L2 - 3.4, -0.33, ZT), "-y")
add_text(w, "SHIBAURA", 0.12, None, 1.3, (L2 - 1.7, -0.33, ZT + 0.12), "-y")
add_text(w, "INSTITUTE OF", 0.12, None, 1.3, (L2 - 1.7, -0.33, ZT - 0.02), "-y")
add_text(w, "TECHNOLOGY", 0.12, None, 1.3, (L2 - 1.7, -0.33, ZT - 0.16), "-y")
w.build("入口の壁（芝浦工業大學）", col)

# ---------- 屋台 ----------
STRIPE = ("red", "blue", "yellow")


def stall(u, v, yaw, ci):
    """前（カウンター側）が局所 +x。間口 2.7（y）・奥行き 2.0（x）"""
    b = MB(u, v, yaw)
    W, D = 2.7, 2.0
    hx, hy = D / 2, W / 2
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box(sx * hx - 0.04, sx * hx + 0.04, sy * hy - 0.04, sy * hy + 0.04, 0, 2.4 if sx < 0 else 2.2, "pole")
    b.box(-hx, -hx + 0.03, -hy, hy, 0.0, 2.2, "cloth")                       # 後ろの幕
    for sy in (-1, 1):                                                       # 横の幕（腰まで）
        b.box(-hx, hx, sy * hy - 0.015, sy * hy + 0.015, 0.0, 1.0, "cloth")
    b.box(hx - 0.35, hx, -hy, hy, 0.0, 0.92, "wood")                         # カウンター
    b.box(hx - 0.45, hx + 0.08, -hy - 0.05, hy + 0.05, 0.92, 0.97, "wood")
    b.box(-0.2, 0.5, -0.7, 0.2, 0.9, 1.1, "grill")                           # 鉄板・調理台
    b.box(-0.2, 0.5, 0.35, 1.0, 0.9, 0.98, "white")
    for i in range(3):                                                       # カウンターの上の品物
        b.box(hx - 0.35, hx - 0.15, -1.0 + i * 0.7, -0.75 + i * 0.7, 0.97, 1.07, "food")
    # 屋根：後ろ 2.4m → 前 2.2m の傾き。縞（6 本）と、前のたれ幕
    c1, c2 = STRIPE[ci % 3], "white"
    n = 6
    for j in range(n):
        y0, y1 = -hy - 0.1 + j * (W + 0.2) / n, -hy - 0.1 + (j + 1) * (W + 0.2) / n
        k = c1 if j % 2 == 0 else c2
        xb, xf = -hx - 0.1, hx + 0.25
        b.face([(xb, y0, 2.45), (xf, y0, 2.2), (xf, y1, 2.2), (xb, y1, 2.45)], k)            # 屋根の上
        b.face([(xb, y1, 2.40), (xf, y1, 2.15), (xf, y0, 2.15), (xb, y0, 2.40)], k)            # 屋根の裏
        b.face([(xf, y0, 2.2), (xf, y0, 1.95), (xf, y1, 1.95), (xf, y1, 2.2)], k)              # たれ幕
    for sy in (-1, 1):                                                       # 提灯
        b.cyl(hx + 0.1, sy * (hy - 0.5), 0.14, 1.75, 1.95, "lantern", seg=8)
    return b



def facing_center(rows):
    """各列の屋台を、もう 1 つの列の方（間の通路）へ向ける。列の向きに直角で、相手の列の重心に近づく向き"""
    out = []
    for i, row in enumerate(rows):
        other = [p for j, r in enumerate(rows) if j != i for p in r]
        ox, oy = sum(p[0] for p in other) / len(other), sum(p[1] for p in other) / len(other)
        dx, dy = row[-1][0] - row[0][0], row[-1][1] - row[0][1]
        nx, ny = -dy, dx
        cx, cy = sum(p[0] for p in row) / len(row), sum(p[1] for p in row) / len(row)
        if nx * (ox - cx) + ny * (oy - cy) < 0:
            nx, ny = -nx, -ny
        yaw = math.degrees(math.atan2(ny, nx))
        out += [(u, v, yaw) for u, v in row]
    return out


for i, (u, v, yaw) in enumerate(facing_center(STALL_ROWS) + STALL_FIXED):
    stall(u, v, yaw, i).build(f"屋台_{i + 1}", col)


# ---------- 交流プラザ（有元史郎記念校友会館。写真 6864〜6869） ----------
# コンクリートの台（高さ 0.8m）の上に、黒い細い枠のガラスの箱。黒い平らな屋根が台の縁まで出る。
# 広場側（+v）の真ん中より研究棟寄りに、台へ上がる石の階段（6 段）と手すり、奥に玄関。屋根の縁に看板の文字
P = PLAZA
pz = P["plinth"]
gu0, gu1, gv0, gv1 = P["u0"] + P["inset"], P["u1"] - P["inset"], P["v0"] + P["inset"], P["v1"] - P["inset"]
zr = P["roof"]
p = MB(0, 0)
p._key_for_text = "p_text"
p.box(P["u0"], P["u1"], P["v0"], P["v1"], 0, pz, "p_conc")                                      # 台
p.box(gu0, gu1, gv0, gv1, pz, pz + 0.02, "p_inner")                                               # 中の床
p.box(P["u0"] - 0.3, P["u1"] + 0.3, P["v0"] - 0.3, P["v1"] + 0.3, zr, zr + 0.55, "p_roof")       # 屋根（縁は 0.55m の厚み）
p.box(gu0 + 4, gu1 - 4, gv0 + 3, gv1 - 3, zr + 0.55, zr + 0.75, "p_roof")                         # 屋上の一段上がり
# ガラスの壁と方立て（1.6m おき）。玄関の所（entry）は奥へ 2m 引っ込めた黒い壁と扉
e0, e1 = P["entry"]
for (xa, ya), (xb, yb) in (((gu0, gv0), (gu1, gv0)), ((gu1, gv0), (gu1, gv1)), ((gu0, gv1), (gu0, gv0)),
                           ((gu0, gv1), (e0, gv1)), ((e1, gv1), (gu1, gv1))):
    if abs(ya - yb) < 1e-6:
        p.box(min(xa, xb), max(xa, xb), ya - 0.02, ya + 0.02, pz, zr, "p_glass")
    else:
        p.box(xa - 0.02, xa + 0.02, min(ya, yb), max(ya, yb), pz, zr, "p_glass")
    L = math.hypot(xb - xa, yb - ya)
    n = max(1, round(L / 1.6))
    for k in range(n + 1):
        x, y = xa + (xb - xa) * k / n, ya + (yb - ya) * k / n
        p.box(x - 0.05, x + 0.05, y - 0.05, y + 0.05, pz, zr, "p_frame")
    p.box(min(xa, xb) - 0.05, max(xa, xb) + 0.05, min(ya, yb) - 0.05, max(ya, yb) + 0.05, pz, pz + 0.1, "p_frame")
ev = gv1 - 2.0                                                                                    # 引っ込んだ玄関の壁
p.box(e0, e1, ev - 0.1, ev, pz, zr, "p_frame")
p.box(e0 - 0.1, e0, ev, gv1, pz, zr, "p_frame")
p.box(e1, e1 + 0.1, ev, gv1, pz, zr, "p_frame")
for k in range(4):                                                                                # ガラスの扉 2 組
    x0 = e0 + 0.8 + k * 1.4
    p.box(x0, x0 + 1.2, ev + 0.01, ev + 0.03, pz, pz + 2.6, "p_glass")
    p.box(x0, x0 + 1.2, ev + 0.01, ev + 0.05, pz + 2.6, pz + 2.7, "p_rail")
# 中（暗い）：奥の壁と、台の上のテラス（玄関の前）
p.box(gu0 + 0.2, gu1 - 0.2, gv0 + 0.2, gv0 + 0.4, pz, zr, "p_inner")
# 石の階段（6 段、台の縁から広場へ）と手すり
ns = 6
sd = 0.4
for k in range(ns):
    z1 = pz - k * pz / ns
    p.box(e0 - 1.0, e1 + 1.0, P["v1"], P["v1"] + (k + 1) * sd, 0, z1, "p_step")
for x in (e0 - 0.6, e1 + 0.6):
    for k in range(3):
        y = P["v1"] + 0.3 + k * (ns * sd - 0.6) / 2
        p.box(x - 0.03, x + 0.03, y - 0.03, y + 0.03, pz - (y - P["v1"]) / (ns * sd) * pz, pz - (y - P["v1"]) / (ns * sd) * pz + 0.9, "p_rail")
    p.face([(x, P["v1"] + 0.3, pz - 0.3 / (ns * sd) * pz + 0.9), (x, P["v1"] + ns * sd - 0.3, 0.3 / (ns * sd) * pz + 0.9),
            (x, P["v1"] + ns * sd - 0.3, 0.3 / (ns * sd) * pz + 0.95), (x, P["v1"] + 0.3, pz - 0.3 / (ns * sd) * pz + 0.95)], "p_rail")
# 看板の文字（屋根の縁、広場側 = +v を向く。+v を向くと、読む向きは -u。見て左（+u 側）に校友会館、右に交流プラザ。6866）
yt = P["v1"] + 0.31
add_text(p, "有元史郎記念校友会館  SHIRO ARIMOTO MEMORIAL ALUMNI HALL", 0.22, JP_FONTS, 13.0, (e1 + 1.0, yt, zr + 0.28), "+y")
add_text(p, "交流プラザ  COMMUNITY LOUNGE", 0.26, JP_FONTS, 7.0, (e0 - 4.5, yt, zr + 0.28), "+y")
# まわりの植え込みと木（6864〜6869）
p.box(P["u0"] - 1.5, P["u1"] + 1.5, P["v0"] - 2.3, P["v0"] - 0.6, 0, 0.6, "hedge")              # 道路側の生け垣（6869）
p.box(P["u1"] + 0.6, P["u1"] + 2.6, P["v0"], P["v1"] - 3, 0, 0.6, "hedge")
for x, y in ((P["u0"] - 3, P["v1"] + 2), (P["u0"] - 3, P["v0"] + 4), (P["u1"] + 3, P["v1"] - 1),
             (P["u1"] + 3, P["v0"] + 3), ((P["u0"] + P["u1"]) / 2, P["v0"] - 3.5), (P["u0"] + 8, P["v0"] - 3.5)):
    tree(p, x, y, h=8.0, r=2.0)
p.build("交流プラザ", col)

n = sum(len(o.data.vertices) for o in col.objects if o.type == 'MESH')
print("festival props DONE objects", len(col.objects), "verts", n)
