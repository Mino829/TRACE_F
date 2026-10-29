# 交流棟の外観（道路側のフィンと教室の窓・本部棟側のガラス面・石の妻壁・1F の丸柱・入口）を組み立てるスクリプト
# buildings/交流棟.blend を開いて、Blender の Python コンソールか MCP から
#   exec(open(path, encoding="utf-8").read())
# で実行する。何度実行しても、このスクリプトが作ったもの（"交流棟_gen" プロパティ付き）を消して作り直すだけ。
#
# 座標は建物ファイルのルール（原点 = 足元の中心・地面 Z=0、X = 長い辺、Y = 短い辺）。
#   +Y: 道路側（縦フィン＋庇の格子、教室の窓）   -Y: 本部棟側（ガラスのカーテンウォール＋日よけ）
#   -X: 道路側の妻（石＋中央のガラスの帯＋校章）  +X: 教室棟側の妻（石＋スリット、渡り廊下の口、黒い枠の入口）
# 写真：image/交流棟-20261010T064315Z-1-001/交流棟/外観_jpg/
# 実寸より雰囲気優先。数字を変えて再実行すれば形を調整できる。
import bpy, bmesh, math

COL_NAME = "04_交流棟"
REF_COL = "参考_寸法の箱"
GEN = "交流棟_gen"

L2, W2 = 33.2, 11.85    # 箱の半分の長さ・幅（66.4 x 23.7）
# 階の高さは教室棟に合わせる（2026-10-12 ユーザーの指示。渡り廊下で教室棟の 2F・4F・6F、本部棟の 4F・6F とつながる）
F1 = 6.0                # 2F の床（教室棟と同じ。前は 8.7）
FH = 5.0                # 2F 以上の階高（教室棟と同じ。前は 4.8）
NF = 5                  # 2F〜6F
RZ = F1 + FH * NF       # 屋上 31.0
TOP = RZ + 0.4          # パラペットの上端
FLOORS = [F1 + FH * k for k in range(NF)]
IN_FROM = 0             # 2F から上は中を空ける（内装を入れる。2026-10-24：前は 4F から。2F=購買、3F=食堂を作った）

EX = 32.4               # 妻壁の内側の面（妻壁の厚さ 0.8）
# 道路側（+Y）の格子
WP = 10.65              # 窓のある壁の面
FD = 1.2                # 庇・フィンの出（床の上で最大）
FD_TOP = 0.55           # フィンの出（階の上端。段々に細くなるので、横から見るとギザギザ）
GX = 31.75              # 格子の両端（その外は石の角柱）
NB = 20                 # スパン数
BW = 2 * GX / NB
BX = [-GX + BW * i for i in range(NB + 1)]
FT = 0.3                # フィンの厚さ
SILL, HEAD = 0.9, 4.2   # 窓の下端・上端（各階の床から）
TRANSOM = 2.5           # 窓の横桟（窓の下端から）
FW = 0.07               # サッシの見付け
# 本部棟側（-Y）
CW = -11.5              # カーテンウォールのガラス面
CORE = (13.0, 20.0)     # 本部棟の渡り廊下がつく石の壁（X の範囲）
BRIDGE_X = (14.5, 18.5)
BRIDGE_FLOORS = (2, 4)  # 4F・6F（本部棟への渡り廊下。ユーザーの説明）
# 1F
GF = 8.9                # 1F のガラス面（上の階より 3m 下がる）
SLAB0 = F1 - 0.5
# +X 妻の凹み（渡り廊下と入口）
RX = (4.0, 10.55)       # Y の範囲
XBRIDGE_FLOORS = (0, 2, 4)   # 2F・4F・6F（教室棟への渡り廊下。2026-10-12 ユーザーの説明と写真 6758）
# 教室棟（同じ向きで +X 側に並ぶ）との位置関係。buildings/配置.json から計算する
import json, os
_P = json.load(open(os.path.join(os.path.dirname(os.path.dirname(bpy.data.filepath)), "buildings", "配置.json"),
                   encoding="utf-8"))           # buildings/交流棟.blend から見た 配置.json
_dx = _P["教室棟"]["center"][0] - _P["交流棟"]["center"][0]
_dy = _P["教室棟"]["center"][1] - _P["交流棟"]["center"][1]
_t = _P["交流棟"]["theta"]
KYO_DX = math.cos(-_t) * _dx - math.sin(-_t) * _dy       # 教室棟の原点（交流棟の座標で）
KYO_DY = math.sin(-_t) * _dx + math.cos(-_t) * _dy
KYO_WALL = KYO_DX - 42.05                                 # 教室棟の交流棟側の外壁の面（教室棟の L2 = 42.05）
KYO_COR = (-3.9, -1.2)                                    # 教室棟の渡り廊下の口（教室棟の座標。廊下の幅のうち 2.7m）
KYO_DOOR = (KYO_COR[0] + KYO_DY, KYO_COR[1] + KYO_DY)     # → 交流棟の座標で Y ≒ 7.7〜10.4
KYO_FZ = {0: 6.0, 2: 16.0, 4: 26.0}                      # 交流棟の 2F・4F・6F（k=0,2,4）につながる教室棟の床（同じ高さ）

# ---------- マテリアル ----------
def bsdf(m):
    for n in m.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            return n


def mat(name, rgb, rough=0.5, metal=0.0, alpha=1.0):
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


# 本部棟と同じく、Unity でもそのまま使えるように「色だけ」のマテリアルにする
MAT = dict(
    stone=mat("交流棟_石パネル", (0.66, 0.58, 0.45), 0.55),
    joint=mat("交流棟_石の目地", (0.33, 0.29, 0.23), 0.8),
    fin=mat("交流棟_フィンと庇", (0.70, 0.62, 0.48), 0.5),
    wall_in=mat("交流棟_窓まわりの壁", (0.58, 0.51, 0.40), 0.6),
    glass=mat("交流棟_教室の窓ガラス", (0.30, 0.48, 0.56), 0.05, alpha=0.45),
    sash=mat("交流棟_サッシ_銀", (0.62, 0.63, 0.64), 0.3, 1.0),
    cw_glass=mat("交流棟_カーテンウォール", (0.16, 0.24, 0.28), 0.05, alpha=0.45),
    cw_band=mat("交流棟_グレーの帯", (0.42, 0.42, 0.42), 0.45),
    louver=mat("交流棟_日よけ", (0.56, 0.57, 0.58), 0.35, 0.7),
    gf_glass=mat("交流棟_1Fガラス", (0.08, 0.11, 0.13), 0.05),
    column=mat("交流棟_柱", (0.72, 0.70, 0.66), 0.4),
    granite=mat("交流棟_御影石", (0.30, 0.29, 0.28), 0.5),
    soffit=mat("交流棟_軒天", (0.62, 0.57, 0.48), 0.6),
    inner=mat("交流棟_中", (0.10, 0.10, 0.10), 0.9),
    roof=mat("交流棟_屋上", (0.35, 0.35, 0.34), 0.8),
    machine=mat("交流棟_屋上設備", (0.60, 0.60, 0.58), 0.6),
    black=mat("交流棟_黒い枠", (0.025, 0.025, 0.028), 0.35, 0.3),
    door_glass=mat("交流棟_入口ガラス", (0.05, 0.06, 0.065), 0.03),
    sign=mat("交流棟_看板の文字", (0.85, 0.86, 0.87), 0.3),
    logo=mat("交流棟_校章", (0.15, 0.40, 0.25), 0.4),
    floor=mat("交流棟_入口の床", (0.40, 0.38, 0.36), 0.7),
)

# ---------- 準備 ----------
scene = bpy.context.scene
if bpy.context.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
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


# エレベーターのかご（交流棟の座標）。教室棟側の端の EV・トイレのかたまり（CORE_X + 5.0〜10.5）の本部棟側の端（2026-10-24）
#   扉は渡り廊下側（+X）の面（4F の案内図とユーザーの確認、2026-10-29。前は -X の教室側の面だった）
#   かごは 1F〜6F を貫く縦穴。床・天井のスラブと、1F の塊に穴をあける。1F は前室と、+X の妻の入口からの通路
SHAFT = (24.05, 26.375, -6.9, -5.2)      # x0, x1, y0, y1（扉は +X 側のホールに面する。扉の幅 1.1m は y -6.6〜-5.5）
SHAFT_DOOR = (-6.6, -5.5)
VEST = (26.375, 29.1, -7.55, -4.55)      # 1F の前室（扉の前）
VEST_LINK = (29.1, 32.1, -7.55, 8.8)     # 1F の入口（扉 y 6.4〜9.5）から前室までの通路
# 扉は全部開けた状態にする（入口の自動ドア・渡り廊下の口のガラス扉。展示の一人称が通り抜けないように。2026-10-29 ユーザーの指示）
OPEN_DOORS = True
VEST_H = 3.0


def rect_minus(r, holes):
    """長方形 r=(x0,x1,y0,y1) から長方形の穴をくり抜いた残りの長方形のリスト"""
    out = [r]
    for hx0, hx1, hy0, hy1 in holes:
        nxt = []
        for x0, x1, y0, y1 in out:
            if hx1 <= x0 or hx0 >= x1 or hy1 <= y0 or hy0 >= y1:
                nxt.append((x0, x1, y0, y1))
                continue
            cx0, cx1, cy0, cy1 = max(x0, hx0), min(x1, hx1), max(y0, hy0), min(y1, hy1)
            for piece in ((x0, cx0, y0, y1), (cx1, x1, y0, y1), (cx0, cx1, y0, cy0), (cx0, cx1, cy1, y1)):
                if piece[1] - piece[0] > 1e-6 and piece[3] - piece[2] > 1e-6:
                    nxt.append(piece)
        out = nxt
    return out


class MB:
    def __init__(self):
        self.v, self.f, self.mi, self.keys = [], [], [], []

    def _m(self, key):
        if key not in self.keys:
            self.keys.append(key)
        return self.keys.index(key)

    def face(self, pts, key):
        b = len(self.v)
        self.v += [tuple(p) for p in pts]
        self.f.append(tuple(range(b, b + len(pts))))
        self.mi.append(self._m(key))

    def box(self, x0, x1, y0, y1, z0, z1, key, keys6=None, skip=()):
        # 面の順: 下, 上, -y, +x, +y, -x
        x0, x1 = min(x0, x1), max(x0, x1)
        y0, y1 = min(y0, y1), max(y0, y1)
        k = keys6 or [key] * 6
        fs = [
            [(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)],
            [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],
            [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
            [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)],
            [(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)],
            [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)],
        ]
        for i, f in enumerate(fs):
            if i not in skip:
                self.face(f, k[i])

    def boxh(self, x0, x1, y0, y1, z0, z1, key, holes, keys6=None):
        """box に、上下に抜ける長方形の穴をあける（穴の壁もできる）"""
        for px0, px1, py0, py1 in rect_minus((min(x0, x1), max(x0, x1), min(y0, y1), max(y0, y1)), holes):
            self.box(px0, px1, py0, py1, z0, z1, key, keys6=keys6)

    def prism_x(self, prof, x0, x1, key):
        """YZ 平面の多角形 prof を X 方向に押し出す"""
        n = len(prof)
        self.face([(x0, y, z) for y, z in prof][::-1], key)
        self.face([(x1, y, z) for y, z in prof], key)
        for i in range(n):
            (ya, za), (yb, zb) = prof[i], prof[(i + 1) % n]
            self.face([(x0, ya, za), (x0, yb, zb), (x1, yb, zb), (x1, ya, za)], key)

    def cyl(self, cx, cy, r, z0, z1, key, seg=16, cap=False):
        pts = [(cx + r * math.cos(2 * math.pi * i / seg), cy + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
        for i in range(seg):
            a, b = pts[i], pts[(i + 1) % seg]
            self.face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], key)
        if cap:
            self.face([(x, y, z1) for x, y in pts], key)

    def build(self, name):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        for k in self.keys:
            me.materials.append(MAT[k])
        for p, i in zip(me.polygons, self.mi):
            p.material_index = i
        me.validate()
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.001)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = False
        o = bpy.data.objects.new(name, me)
        o[GEN] = True
        col.objects.link(o)
        return o


def top_of(k):
    return RZ if k == NF - 1 else FLOORS[k] + FH


# ---------- 石の目地（パネルの割り付け。面から少し浮かせた細い帯） ----------
jt = MB()
JW = 0.02


def joints(axis, c, sign, u0, u1, v0, v1, du=1.95, dv=2.4):
    """axis の面（座標 c、外向き sign）の u0..u1 x v0..v1 に目地を引く。u は面の横方向、v は高さ"""
    c = c + sign * 0.004

    def quad(ua, ub, va, vb):
        if axis == 'x':
            jt.face([(c, ua, va), (c, ub, va), (c, ub, vb), (c, ua, vb)], "joint")
        else:
            jt.face([(ua, c, va), (ub, c, va), (ub, c, vb), (ua, c, vb)], "joint")

    n = max(1, round((u1 - u0) / du))
    for i in range(1, n):
        u = u0 + (u1 - u0) * i / n
        quad(u - JW / 2, u + JW / 2, v0, v1)
    v = v0 + dv
    while v < v1 - 0.3:
        quad(u0, u1, v - JW / 2, v + JW / 2)
        v += dv


# ---------- 1. 本体（中の塊・2F の床・屋上・パラペット） ----------
body = MB()
# 窓の奥の塊。IN_FROM から上は内装（build_koryuto_interior.py）を入れるので空けて、床のスラブだけ置く
if IN_FROM > 0:
    body.box(-EX, EX, CW + 0.25, WP - 0.3, F1, FLOORS[IN_FROM], "inner")
for z0 in FLOORS[IN_FROM + 1:]:
    body.boxh(-EX, EX, CW + 0.02, WP - 0.3, z0 - 0.45, z0, "inner", [SHAFT])
body.box(-EX, EX, CW + 0.02, WP - 0.3, RZ - 0.6, RZ, "inner", keys6=["inner", "roof", "inner", "inner", "inner", "inner"])
# 1F の中の塊（ガラスの奥）
body.boxh(-EX, 32.1, -GF + 0.1, GF - 0.1, 0, VEST_H, "inner", [SHAFT, VEST, VEST_LINK])  # 下の層：かごと前室と入口からの通路
body.boxh(-EX, 32.1, -GF + 0.1, GF - 0.1, VEST_H, SLAB0, "inner", [SHAFT])
# 2F の床（上の階が 1F より張り出した部分の天井）
body.boxh(-EX, EX, CW - 0.1, W2, SLAB0, F1, "soffit", [SHAFT], keys6=["soffit", "soffit", "cw_band", "soffit", "stone", "soffit"])
# パラペット（本部棟側）
body.box(-EX, EX, -W2, CW + 0.25, RZ, TOP, "cw_band")
body.box(-EX, EX, WP - 0.3, WP, RZ, TOP, "fin")

# 道路側の妻（-X）：石 | ガラスの帯（少し奥） | 石 | 御影石の帯（奥）
GS = (-2.5, 3.5)        # ガラスの帯の Y の範囲
body.box(-L2, -EX, GS[1], W2, 0, TOP, "stone")
body.box(-L2, -EX, -9.5, GS[0], 0, TOP, "stone")
body.box(-L2 + 0.3, -EX, -W2, -9.5, 0, TOP, "granite")
body.box(-L2, -EX, GS[0], GS[1], RZ - 0.3, TOP, "stone")     # ガラスの帯の上の石
joints('x', -L2, -1, GS[1], W2, 0.45, TOP)
joints('x', -L2, -1, -9.5, GS[0], 0.45, TOP)

# 教室棟側の妻（+X）：石（中央にスリット）、道路寄りは凹んで渡り廊下と入口
SL = (-4.0, -3.3)       # スリットの Y の範囲
body.box(EX, L2, -W2, SL[0], 0, TOP, "stone")
body.box(EX, L2, SL[1], RX[0], 0, TOP, "stone")
body.box(EX, L2, SL[0], SL[1], RZ - 0.3, TOP, "stone")
joints('x', L2, 1, -W2, SL[0], 0.45, TOP)
joints('x', L2, 1, SL[1], RX[0], 0.45, TOP)

# 道路側の両端の石の角柱（地面まで）
for s in (-1, 1):
    x0, x1 = s * GX, s * L2
    body.box(x0, x1, RX[1], W2, 0, TOP, "stone")
    joints('y', W2, 1, min(x0, x1), max(x0, x1), 0.45, TOP, du=1.45)
    joints('x', s * L2, s, RX[1], W2, 0.45, TOP, du=1.3)

# 本部棟側の石の壁（渡り廊下がつく。地面まで）。4F・6F は渡り廊下の口（BRIDGE_X）から中の廊下まで通り抜けをあける
# （2026-10-21：前は口のガラス扉の奥が石の塊でふさがっていて、TRACE の線が石を突き抜けていた）
zc = sorted({0.0, TOP} | {FLOORS[k] for k in BRIDGE_FLOORS} | {FLOORS[k] + 3.0 for k in BRIDGE_FLOORS})
for za, zb in zip(zc[:-1], zc[1:]):
    if any(abs(za - FLOORS[k]) < 1e-6 for k in BRIDGE_FLOORS):
        body.box(CORE[0], BRIDGE_X[0], -W2, -GF + 0.1, za, zb, "stone")
        body.box(BRIDGE_X[1], CORE[1], -W2, -GF + 0.1, za, zb, "stone")
    else:
        body.box(CORE[0], CORE[1], -W2, -GF + 0.1, za, zb, "stone")
joints('y', -W2, -1, CORE[0], CORE[1], 0.45, TOP)

# 石の足元の御影石
GB = 0.45
gb = [("x", -L2, -1, GS[1], W2), ("x", -L2, -1, -9.5, GS[0]),
      ("x", L2, 1, -W2, SL[0]), ("x", L2, 1, SL[1], RX[0]), ("x", L2, 1, RX[1], W2),
      ("y", -W2, -1, CORE[0], CORE[1]), ("y", W2, 1, -L2, -GX), ("y", W2, 1, GX, L2)]
for ax, c, s, a, b in gb:
    if ax == 'x':
        body.box(c, c + s * 0.02, a, b, 0, GB, "granite")
    else:
        body.box(a, b, c, c + s * 0.02, 0, GB, "granite")
body.build("交流棟_本体")
jt.build("交流棟_石の目地")

# ---------- 2. 道路側（+Y）：縦フィンと庇の格子 ----------
fin = MB()
for k, z0 in enumerate(FLOORS):
    z1 = top_of(k)
    zs = z0 + SILL                                   # 庇の上 = 窓の下端
    fin.box(-GX, GX, WP, W2, z0 + SILL - 0.35, zs, "fin")   # 庇
    zt = z1 + SILL - 0.35 if k < NF - 1 else RZ
    dt = FD - (FD - FD_TOP) * (zt - zs) / FH
    for i in range(1, NB):
        x = BX[i]
        fin.prism_x([(WP, zs), (WP + FD, zs), (WP + dt, zt), (WP, zt)], x - FT / 2, x + FT / 2, "fin")
# 2F の床から最初の庇まで
for i in range(1, NB):
    fin.box(BX[i] - FT / 2, BX[i] + FT / 2, WP, WP + FD_TOP, F1, F1 + SILL - 0.35, "fin")
# 一番上のコーニス
fin.box(-GX, GX, WP, W2, RZ, TOP, "fin")
fin.build("交流棟_道路側フィン")

# ---------- 3. 教室の窓（腰壁・まぐさ・サッシ・ガラス） ----------
win = MB()
for k, z0 in enumerate(FLOORS):
    z1 = top_of(k)
    win.box(-GX, GX, WP - 0.3, WP, z0, z0 + SILL - 0.35, "wall_in")     # 腰壁（庇の下）
    win.box(-GX, GX, WP - 0.3, WP, z0 + HEAD, z1 if k < NF - 1 else TOP, "wall_in")  # まぐさ
    wa, wb = z0 + SILL, z0 + HEAD
    for i in range(NB):
        a, b = BX[i] + FT / 2, BX[i + 1] - FT / 2
        y0, y1 = WP - 0.18, WP - 0.04                # サッシの奥行き（壁の面から少し奥）
        win.box(a, b, WP - 0.13, WP - 0.11, wa, wb, "glass")
        win.box(a, a + FW, y0, y1, wa, wb, "sash")
        win.box(b - FW, b, y0, y1, wa, wb, "sash")
        win.box(a, b, y0, y1, wa, wa + FW, "sash")
        win.box(a, b, y0, y1, wb - FW, wb, "sash")
        m = (a + b) / 2
        win.box(m - 0.03, m + 0.03, y0, y1 - 0.02, wa, wb, "sash")      # 縦の方立て
        t = wa + TRANSOM
        win.box(a, b, y0, y1 - 0.02, t, t + 0.06, "sash")               # 横桟
        # 窓の下の水切り（庇の上に少し出る）
        win.box(a, b, WP - 0.04, WP + 0.06, wa - 0.02, wa + 0.02, "sash")
win.build("交流棟_教室の窓")

# ---------- 4. 本部棟側（-Y）：カーテンウォール・グレーの帯・日よけ ----------
cw = MB()
SEGS = [(-EX, CORE[0]), (CORE[1], EX)]
HB = BW / 2
for k, z0 in enumerate(FLOORS):
    z1 = top_of(k)
    for xa, xb in SEGS:
        zb0 = SLAB0 if k == 0 else z0
        cw.box(xa, xb, CW - 0.25, CW + 0.1, zb0, z0 + 1.0, "cw_band")            # 腰の帯
        cw.box(xa, xb, CW - 0.01, CW + 0.01, z0 + 1.0, z1, "cw_glass")
        cw.box(xa, xb, CW - 0.14, CW, z0 + 3.6, z0 + 3.66, "sash")               # 横桟
        # 方立て
        n = round((xb - xa) / HB)
        for j in range(n + 1):
            x = xa + (xb - xa) * j / n
            cw.box(x - 0.03, x + 0.03, CW - 0.14, CW, z0 + 1.0, z1, "sash")
        # 日よけ（横の羽根と受け材）
        zl = z0 + 3.9
        cw.box(xa, xb, CW - 1.0, CW - 0.3, zl, zl + 0.06, "louver")
        cw.box(xa, xb, CW - 1.0, CW - 0.94, zl - 0.2, zl + 0.06, "louver")
        n2 = max(1, round((xb - xa) / BW))
        for j in range(n2 + 1):
            x = xa + (xb - xa) * j / n2
            cw.box(x - 0.03, x + 0.03, CW - 1.0, CW - 0.14, zl - 0.3, zl, "louver")
cw.build("交流棟_本部棟側ガラス")

# ---------- 5. 1F（奥に下がったガラスの壁） ----------
gf = MB()


def storefront(y, sign, xa, xb):
    """1F のガラス面：下のガラス・腰の帯・上の明かり取り。sign は外向き"""
    yo = y + sign * 0.1
    g1, b1, g2 = 3.2, 3.8, SLAB0 - 0.3       # 下のガラスの上端・腰の帯の上端・上の明かり取りの上端（2F の床 6m に合わせた）
    gf.box(xa, xb, y - 0.01, y + 0.01, 0, g1, "gf_glass")
    gf.box(xa, xb, y - 0.15, y + 0.15, g1, b1, "wall_in")
    gf.box(xa, xb, y - 0.01, y + 0.01, b1, g2, "gf_glass")
    gf.box(xa, xb, y - 0.15, y + 0.15, g2, SLAB0, "wall_in")
    for za, zb in ((0, 0.1), (2.5, 2.56), (b1, b1 + 0.06)):
        gf.box(xa, xb, y, yo, za, zb, "sash")
    n = round((xb - xa) / HB)
    for j in range(n + 1):
        x = xa + (xb - xa) * j / n
        gf.box(x - 0.035, x + 0.035, y, yo, 0, g1, "sash")
        gf.box(x - 0.035, x + 0.035, y, yo, b1, g2, "sash")


storefront(GF, 1, -EX, 32.1)
storefront(-GF, -1, -EX, CORE[0])
storefront(-GF, -1, CORE[1], 32.1)
# 道路側の妻のガラスの帯の足元の小さな黒い庇
gf.box(-L2 - 1.2, -L2, GS[0] + 1.0, GS[1] - 1.0, 3.0, 3.25, "black")
gf.build("交流棟_1F")

# ---------- 6. 柱（丸柱＋足元の御影石の巻き付け） ----------
cl = MB()
for i in range(1, NB, 2):
    x = BX[i]
    cl.cyl(x, W2 - 0.65, 0.4, 0, SLAB0, "column", seg=20)          # 道路側
    cl.cyl(x, W2 - 0.65, 0.47, 0, 1.3, "granite", seg=20, cap=True)
    if CORE[0] - 0.8 < x < CORE[1] + 0.8:
        continue
    cl.cyl(x, -W2 + 0.9, 0.5, 0, SLAB0, "column", seg=20)          # 本部棟側（太い）
    cl.cyl(x, -W2 + 0.9, 0.58, 0, 1.8, "granite", seg=20, cap=True)
cl.build("交流棟_柱")

# ---------- 7. 妻のガラス（道路側の帯・教室棟側のスリット・本部棟側の石の壁の細い窓） ----------
eg = MB()
# 道路側の妻のガラスの帯
gx = -L2 + 0.4
eg.box(gx - 0.01, gx + 0.01, GS[0], GS[1], 0, RZ - 0.3, "cw_glass")
for j in range(6):
    y = GS[0] + (GS[1] - GS[0]) * j / 5
    eg.box(gx - 0.15, gx, y - 0.04, y + 0.04, 0, RZ - 0.3, "sash")
z = 1.6
while z < RZ - 0.5:
    eg.box(gx - 0.15, gx, GS[0], GS[1], z, z + 0.06, "sash")
    z += 1.6
# 教室棟側のスリット
sx = L2 - 0.3
eg.box(sx - 0.01, sx + 0.01, SL[0], SL[1], 0.6, RZ - 0.3, "cw_glass")
for y in SL:
    eg.box(sx, sx + 0.12, y - 0.04, y + 0.04, 0.6, RZ - 0.3, "sash")
z = 1.8
while z < RZ - 0.5:
    eg.box(sx, sx + 0.12, SL[0], SL[1], z, z + 0.05, "sash")
    z += 1.2
# 本部棟側の石の壁の左端の細い窓（階段）
for z0 in [0.0] + FLOORS:
    za, zb = (z0 + 1.0, z0 + 3.8) if z0 > 0 else (0.6, 7.4)
    eg.box(CORE[0] + 0.3, CORE[0] + 0.9, -W2 - 0.03, -W2 + 0.01, za, zb, "cw_glass")
    eg.box(CORE[0] + 0.25, CORE[0] + 0.95, -W2 - 0.08, -W2, za - 0.05, za, "sash")
    eg.box(CORE[0] + 0.25, CORE[0] + 0.95, -W2 - 0.08, -W2, zb, zb + 0.05, "sash")
eg.build("交流棟_妻のガラス")

# ---------- 8. 教室棟側の凹み（窓・渡り廊下の口） ----------
rc = MB()
RY0, RY1 = RX
DY = KYO_DOOR            # 渡り廊下の口の Y の範囲（教室棟の廊下の正面。下の「教室棟への渡り廊下」を見る）
for k, z0 in enumerate(FLOORS):
    z1 = top_of(k)
    zb = z0 - 0.5 if k else SLAB0
    if k in XBRIDGE_FLOORS:     # 渡り廊下の口の所は床の高さで止める（2026-10-21：前は扉の下 0.9m を石の帯がふさいでいた）
        rc.box(EX, EX + 0.3, RY0, RY1, zb, z0, "stone")
        for ya, yb in ((RY0, KYO_DOOR[0] - 0.15), (KYO_DOOR[1] + 0.15, RY1)):
            rc.box(EX, EX + 0.3, ya, yb, z0, z0 + 0.9, "stone")
    else:
        rc.box(EX, EX + 0.3, RY0, RY1, zb, z0 + 0.9, "stone")  # 床の帯
    rc.box(EX, EX + 0.3, RY0, RY1, z0 + HEAD, z1 if k < NF - 1 else TOP, "stone")
    if k in XBRIDGE_FLOORS:
        # 渡り廊下の口：黒い鉄の枠＋ガラスの扉（扉の下端は床）
        spans = [(RY0, DY[0]), (DY[1], RY1)]
        if not OPEN_DOORS:
            rc.box(EX + 0.05, EX + 0.07, DY[0], DY[1], z0, z0 + 3.0, "door_glass")
        rc.box(EX, EX + 0.3, DY[0], DY[1], z0 + 3.0, z0 + HEAD, "stone")
        rc.box(EX, EX + 0.4, DY[0] - 0.15, DY[0], z0, z0 + 3.15, "black")
        rc.box(EX, EX + 0.4, DY[1], DY[1] + 0.15, z0, z0 + 3.15, "black")
        rc.box(EX, EX + 0.4, DY[0] - 0.15, DY[1] + 0.15, z0 + 3.0, z0 + 3.15, "black")
        m = sum(DY) / 2
        if not OPEN_DOORS:
            rc.box(EX + 0.07, EX + 0.12, m - 0.03, m + 0.03, z0, z0 + 3.0, "sash")
    else:
        spans = [(RY0, RY1)]
    for ya, yb in spans:
        rc.box(EX + 0.05, EX + 0.07, ya, yb, z0 + SILL, z0 + HEAD, "glass")
        n = max(1, round((yb - ya) / 1.3))
        for j in range(n + 1):
            y = ya + (yb - ya) * j / n
            rc.box(EX + 0.07, EX + 0.15, y - 0.035, y + 0.035, z0 + SILL, z0 + HEAD, "sash")
        for zz in (z0 + SILL, z0 + HEAD - FW):
            rc.box(EX + 0.07, EX + 0.15, ya, yb, zz, zz + FW, "sash")
rc.build("交流棟_教室棟側の凹み")

# ---------- 9. 入口（写真 6648：黒い額縁の庇・ガラスの自動ドア・看板） ----------
en = MB()
EY0, EY1 = 4.8, 9.8      # 額縁の外の Y の範囲
EH = 3.9                 # 額縁の上端
OX = EX + 1.6            # 額縁の出
DX = EX - 0.2            # 扉の面
DZ = 3.2                 # 扉の上端
# 1F の壁（石）。扉のところだけ開ける
en.box(DX, EX + 0.3, RY0, EY0 + 0.3, 0, SLAB0, "stone")
en.box(DX, EX + 0.3, EY1 - 0.3, RY1, 0, SLAB0, "stone")
en.box(DX, EX + 0.3, EY0 + 0.3, EY1 - 0.3, EH, SLAB0, "stone")
joints('x', EX + 0.3, 1, RY0, RY1, 0.45, SLAB0, du=1.6)
# 黒い額縁（上の板と左右の板）。内側も黒
en.box(EX + 0.3, OX, EY0, EY1, EH - 0.35, EH, "black")
en.box(EX + 0.3, OX, EY0, EY0 + 0.3, 0, EH, "black")
en.box(EX + 0.3, OX, EY1 - 0.3, EY1, 0, EH, "black")
en.box(DX, EX + 0.3, EY0 + 0.3, EY1 - 0.3, DZ, EH, "black")                     # 扉の上の黒いパネル
# 左の黒い壁（インターホン・看板）と右のガラス
PY = EY0 + 0.3 + 1.3
en.box(DX, DX + 0.05, EY0 + 0.3, PY, 0, DZ, "black")
en.box(DX + 0.05, DX + 0.08, EY0 + 0.5, PY - 0.2, 1.9, 2.15, "sign")               # 看板（白い帯）
en.box(DX + 0.05, DX + 0.07, EY0 + 0.6, EY0 + 0.75, 1.1, 1.45, "sash")            # インターホン
# ガラスの自動ドア（両開き）と袖のガラス
gy = [PY, PY + 0.9, PY + 1.95, PY + 3.0, EY1 - 0.3]
if OPEN_DOORS:
    # 自動ドアが開いた状態：袖のガラス（PY〜PY+0.9、PY+3.0〜）だけ残し、真ん中の 2 枚の扉は袖の裏へ引き込む
    for ya, yb in ((PY, PY + 0.9), (PY + 3.0, EY1 - 0.3)):
        en.box(DX - 0.01, DX + 0.01, ya, yb, 0, DZ, "door_glass")
    for y in (PY, PY + 0.9, PY + 3.0, EY1 - 0.3):
        en.box(DX, DX + 0.08, y - 0.04, y + 0.04, 0, DZ, "sash")
    en.box(DX, DX + 0.08, PY, EY1 - 0.3, DZ - 0.08, DZ, "sash")
else:
    en.box(DX - 0.01, DX + 0.01, PY, EY1 - 0.3, 0, DZ, "door_glass")
    for y in gy:
        en.box(DX, DX + 0.08, y - 0.04, y + 0.04, 0, DZ, "sash")
    for z in (0.0, DZ - 0.08):
        en.box(DX, DX + 0.08, PY, EY1 - 0.3, z, z + 0.08, "sash")
    for y in (PY + 1.95 - 0.05, PY + 1.95 + 0.05):                                # 取っ手
        en.box(DX + 0.08, DX + 0.12, y - 0.015, y + 0.015, 0.9, 1.9, "sash")
# 足元の床（タイル）と、両わきの御影石
en.box(DX, OX, EY0 + 0.3, EY1 - 0.3, 0, 0.02, "floor")
en.box(EX + 0.3, EX + 0.32, RY0, EY0, 0, GB, "granite")
en.box(EX + 0.3, EX + 0.32, EY1, RY1, 0, GB, "granite")
en.build("交流棟_入口")

# ---------- 10. 本部棟側の渡り廊下の口（3F・5F） ----------
bo = MB()
for k in BRIDGE_FLOORS:
    z0 = FLOORS[k]
    xa, xb = BRIDGE_X
    y = -W2
    if not OPEN_DOORS:
        bo.box(xa, xb, y - 0.02, y + 0.02, z0, z0 + 3.0, "door_glass")
    bo.box(xa - 0.15, xa, y - 0.4, y, z0 - 0.3, z0 + 3.2, "black")
    bo.box(xb, xb + 0.15, y - 0.4, y, z0 - 0.3, z0 + 3.2, "black")
    bo.box(xa - 0.15, xb + 0.15, y - 0.4, y, z0 + 3.0, z0 + 3.2, "black")
    bo.box(xa - 0.15, xb + 0.15, y - 0.4, y, z0 - 0.3, z0, "black")
    m = (xa + xb) / 2
    if not OPEN_DOORS:
        bo.box(m - 0.03, m + 0.03, y - 0.1, y, z0, z0 + 3.0, "sash")
bo.build("交流棟_渡り廊下の口")

# ---------- 10b. 教室棟への渡り廊下（2F・4F・6F。ユーザーの説明と写真 6758） ----------
# 交流棟の +X の凹みの口から、教室棟の交流棟側の妻壁まで（約 14m）。屋根のない通路：
# 床の板（下は黒っぽい鉄骨の梁）・両側のガラスの手すり（高さ 1.1m）・明るい色の支柱。
# 階の高さを教室棟に合わせたので水平。もし高さが違ったら、床を斜めにしてつなぐ
def prism_y(mb, prof, y0, y1, key):
    """XZ 平面の多角形 prof を Y 方向に押し出す"""
    n = len(prof)
    mb.face([(x, y0, z) for x, z in prof], key)
    mb.face([(x, y1, z) for x, z in prof][::-1], key)
    for i in range(n):
        (xa, za), (xb, zb) = prof[i], prof[(i + 1) % n]
        mb.face([(xa, y0, za), (xb, y0, zb), (xb, y1, zb), (xa, y1, za)], key)


kb = MB()
bx0, bx1 = EX + 0.4, KYO_WALL                  # 交流棟の口の黒い枠の前 〜 教室棟の外壁
by0, by1 = KYO_DOOR                             # 通路の幅（手すりの内側）
for k in XBRIDGE_FLOORS:
    za, zb = FLOORS[k], KYO_FZ[k]
    zf = lambda x: za + (zb - za) * (x - bx0) / (bx1 - bx0)     # 床の高さ（同じ高さなら水平）
    # 床の板（厚さ 0.25）と、その下の鉄骨の梁（両側）と横の小梁
    prism_y(kb, [(bx0, za - 0.25), (bx1, zb - 0.25), (bx1, zb), (bx0, za)], by0 - 0.3, by1 + 0.3, "cw_band")
    for yb_ in (by0 - 0.25, by1 + 0.05):
        prism_y(kb, [(bx0, za - 0.85), (bx1, zb - 0.85), (bx1, zb - 0.25), (bx0, za - 0.25)], yb_, yb_ + 0.2, "black")
    m = max(2, round((bx1 - bx0) / 2.0))
    for i in range(1, m):
        x = bx0 + (bx1 - bx0) * i / m
        kb.box(x - 0.08, x + 0.08, by0 - 0.25, by1 + 0.25, zf(x) - 0.6, zf(x) - 0.25, "black")
    prism_y(kb, [(bx0, za), (bx1, zb), (bx1, zb + 0.01), (bx0, za + 0.01)], by0 - 0.05, by1 + 0.05, "floor")   # 床の仕上げ
    # 両側の手すり：ガラス・上の笠木・支柱（約 1.6m おき。写真の明るい色の柱）
    for yg in (by0 - 0.15, by1 + 0.15):
        prism_y(kb, [(bx0, za + 0.05), (bx1, zb + 0.05), (bx1, zb + 1.05), (bx0, za + 1.05)], yg - 0.01, yg + 0.01, "glass")
        prism_y(kb, [(bx0, za + 1.05), (bx1, zb + 1.05), (bx1, zb + 1.12), (bx0, za + 1.12)], yg - 0.04, yg + 0.04, "sash")
        n = max(2, round((bx1 - bx0) / 1.6))
        for i in range(n + 1):
            x = bx0 + 0.1 + (bx1 - bx0 - 0.2) * i / n
            kb.box(x - 0.05, x + 0.05, yg - 0.06, yg + 0.06, zf(x) - 0.25, zf(x) + 1.15, "column")
kb.build("交流棟_渡り廊下（教室棟へ）")

# ---------- 11. 屋上の設備と校章 ----------
rf = MB()
rf.box(-12.0, -2.0, -5.0, 3.0, RZ, RZ + 2.6, "machine")
rf.box(4.0, 11.0, -3.0, 5.0, RZ, RZ + 2.0, "machine")
rf.box(18.0, 24.0, -6.0, -1.0, RZ, RZ + 3.2, "machine")
for x in range(-26, 28, 4):                                   # 室外機の列
    rf.box(x, x + 2.2, 6.0, 8.0, RZ, RZ + 1.4, "machine")
# 道路側の妻の校章（緑のマーク＋文字の代わりの帯）
lx = -L2 - 0.03
rf.box(lx, -L2, GS[1] + 0.6, GS[1] + 1.8, RZ - 3.2, RZ - 2.0, "logo")
rf.box(lx, -L2, GS[1] + 0.3, GS[1] + 2.1, RZ - 3.8, RZ - 3.45, "logo")
rf.build("交流棟_屋上と校章")

# ---------- 片付け：寸法の箱は参考コレクションへ（非表示） ----------
ref = bpy.data.collections.get(REF_COL)
if ref is None:
    ref = bpy.data.collections.new(REF_COL)
    scene.collection.children.link(ref)
box = bpy.data.objects.get("交流棟_箱")
if box is not None:
    for c in list(box.users_collection):
        if c != ref:
            c.objects.unlink(box)
    if ref.name not in [c.name for c in box.users_collection]:
        ref.objects.link(box)


def find_lc(lc, name):
    if lc.name == name:
        return lc
    for c in lc.children:
        r = find_lc(c, name)
        if r:
            return r


lc = find_lc(scene.view_layers[0].layer_collection, REF_COL)
if lc:
    lc.hide_viewport = True
ref.hide_render = True

total = sum(len(o.data.vertices) for o in col.all_objects if o.type == 'MESH')
print("交流棟 DONE verts", total)
