# 教室棟の内装（2F〜7F）：教室・廊下・吹き抜けとエスカレーター・7F の空中庭園
# buildings/教室棟.blend を開いて exec(open(path, encoding="utf-8").read()) で実行する。
# 何度実行しても、コレクション「03_教室棟_内装」の中身を作り直すだけ（"教室棟_内装_gen" 付きのものを消す）。
#
# 座標は建物ファイルのルール（原点 = 足元の中心・地面 Z=0、X = 長い辺、Y = 短い辺）。
#   +X: 研究棟側（研究棟南とつながる）   -X: 交流棟側（交流棟への渡り廊下）
#   +Y: 道路側（教室が並ぶ）             -Y: 南東のガラス面（高い吹き抜け・エスカレーター）
# 写真：image/教室棟と研究棟-20261010T080330Z-1-001/教室棟と研究棟/jpg/
#   4F 案内図 6679・5F 6681・7F 6693/6694、廊下 6663/6670/6671、吹き抜け 6669/6672/6673/6685、7F の庭園 6688〜6690
# 間取りは案内図を、教室の幅（2.9m 単位）と柱の間隔（5.8m）にそろえて置いたもの。実寸ではない。
#   1F→5F：エスカレーターが交流棟側から研究棟側へ一直線に上る（4 本）
#   5F→6F・6F→7F：4F→5F の真上に、同じ向き・同じ XY で高さだけ違う（ユーザーの説明）
#   7F→8F：研究棟側の端のホールから、南東（-Y）へ向かって上る（案内図 6694、写真 6703）
#   7F：案内図 6694（4F の案内図と上下が逆）で、庭園は道路側（+Y）、廊下は南東側（-Y）
# 2026-10-11 の訂正（写真：…/訂正/jpg/ 1F 6713・2F 6712・3F 6711・6F 6704・7F 6703・渡り廊下 6706/6707・外観 6715/6716）
#   吹き抜けは階ごとに研究棟側へずれる階段状（VOIDS）。エスカレーターより研究棟側はどの階も床がある
#   1F：南東側はピロティ（ガラスは Y = YG1 まで引っ込む）。2F：廊下より南東側に床はない（ピロティの屋根）
#   研究棟側の端で建物が南東へ L 字に曲がる（曲がり角 = 研究棟北棟の端。EV A・階段・トイレ・部屋の箱）
#   6F：曲がり角から、ゲートの向こうの研究棟（研究棟.blend）への渡り廊下
#   2F・4F・6F：交流棟側の妻壁に渡り廊下の口（渡り廊下の本体は交流棟.blend。2026-10-12）
# 外観は南東面だけ写真（6716）から作り、道路側と妻壁は「仮の外壁」のまま。
import bpy, bmesh, math

IN_COL = "03_教室棟_内装"
IN_GEN = "教室棟_内装_gen"

L2, W2 = 42.05, 11.75           # 箱の半分の長さ・幅（84.1 x 23.5）
YN, YS = 11.45, -11.45          # 外壁の内側の面（道路側 / 南東のガラス側）
YCW = -0.6                      # 教室と廊下の間仕切り
YCOR = -3.9                     # 廊下と吹き抜けの境（ガラスの手すり）
FZ = {1: 0.0, 2: 6.0, 3: 11.0, 4: 16.0, 5: 21.0, 6: 26.0, 7: 31.0}   # 各階の床（3F = 11m、階高 5m）
CEIL = 3.0                      # 天井の高さ（床から）
SLAB = 0.35
U = 2.9                         # 教室の幅の単位
RX0, RX1 = -34.8, 34.8          # 教室が並ぶ範囲（両端は階段）
COLX = [RX0 + 2 * U * i for i in range(13)]       # 間仕切りの柱（5.8m おき）
AX0, AX1 = RX0 + 4 * U, RX0 + 21 * U              # 吹き抜けの X の範囲（-23.2〜26.1）
EY = (-4.3, -7.0)               # エスカレーター 2 台分の Y の範囲
PY = -7.4                       # エスカレーターの乗り場の床の端
TAN = math.tan(math.radians(30))
FLAT = 1.2                      # エスカレーターの水平部分
LAND = 2.5                      # 乗り継ぎの床の長さ


def run(rise):
    return rise / TAN + 2 * FLAT


# 交流棟側の階段室（道路側の端の部屋）の階段：1F〜6F を折り返しの階段でつなぐ（2026-10-24。TRACE の点 k1-006〜k5-043 が通る所）
#   行き（A）は X が小さい側、戻り（B）は X が大きい側。どちらも Y = SY0 → SY1 へ上り、SY1〜の踊り場で折り返す。
#   各階の床は B の真上に穴をあける（A の上は床がある）。階の乗り降りは Y = SY0 の側（部屋の扉の側）
STAIR_A = (-41.45, -38.55)
STAIR_B = (-38.30, -35.40)
SY0, SY1, SY_LAND = 2.5, 8.6, 11.35
STAIR_FLIGHTS = [(1, 2), (2, 3), (3, 4), (4, 5), (5, 6)]


def stair_hole(f):
    """f 階の床（と下の階の天井）に、階段の戻り（B）が抜ける穴"""
    if 2 <= f <= 6:
        return (STAIR_B[0], STAIR_B[1], SY0, SY1)
    return None


# エスカレーター：(下の階, 上の階, 下の端の X, 上の端の X)。端 = 水平部分の外側
# 4F→5F（と真上の 5F→6F・6F→7F）は案内図で X = 19〜31。4F の乗り継ぎは 5.7m 歩く
E4_TOP = 30.5
E4_BOT = E4_TOP - run(5)
E3_TOP = AX1 + FLAT - run(5) - LAND
E3_BOT = E3_TOP - run(5)
E2_TOP = E3_BOT - LAND
E2_BOT = E2_TOP - run(5)
E1_TOP = E2_BOT - LAND
E1_BOT = E1_TOP - run(6)    # 1F の乗り口は 2F の床の下（交流棟側の部屋の下）
ESC = [
    (1, 2, E1_BOT, E1_TOP),
    (2, 3, E2_BOT, E2_TOP),
    (3, 4, E3_BOT, E3_TOP),
    (4, 5, E4_BOT, E4_TOP),
    (5, 6, E4_BOT, E4_TOP),     # 4F→5F の真上（同じ向き・同じ XY）
    (6, 7, E4_BOT, E4_TOP),
]



def scaled(rooms, total=RX1 - RX0):
    s = total / sum(w for _, w in rooms)
    return [(n, w * s) for n, w in rooms]


# 部屋（道路側）：(番号札, 幅) を -X から順に。幅は U の倍数か m（案内図の比で並べて、RX0〜RX1 に合わせる）
NORTH = {
    2: scaled([("Intl. Programs", 6.4), ("SGU", 6.4), ("Career Support", 6.4), ("Admin. Office", 14.7),
               ("Student Affairs", 9.6), ("Academic Planning", 9.5), ("Admissions", 14.7)]),
    # 3F・4F は公式の図の部屋の幅の比（2026-10-21、TRACE_F #32）。3F は /log の平面図（CAD の図）と案内図 6711、4F は案内図 6679
    3: scaled([("301", 22.6), ("302", 23.6), ("303", 19.7), ("304", 19.7), ("305", 14.5)]),
    4: scaled([("403", 150), ("404", 145), ("405", 125), ("406", 120), ("407", 125), ("408", 125)]),
    5: [(str(n), 46.4 / 6) for n in range(502, 508)] + [(str(n), 2 * U) for n in range(508, 512)],
    6: scaled([("601", 13.4), ("602", 8.6), ("603", 11.3), ("604", 5.7), ("605", 5.3), ("606", 5.2),
               ("607", 5.4), ("608", 5.3), ("609", 10.2)]),
}
# 部屋（南東・交流棟側）：(X の始まり, [(番号札, 幅)])。2F は南東側に床がない
SOUTH = {
    3: (-L2 + 0.3, [("Global Learning Commons", -23.2 + L2 - 0.3)]),
    4: (-L2 + 0.3, [("Global Learning Commons", -17.7 + L2 - 0.3)]),
    5: (-35.2, [("05Q16", 5.7), ("05Q17", 5.7), ("512", 5.7), ("513", 5.7)]),
    6: (-29.4, [("Dean's Office", 5.6), ("06Q18", 5.7), ("Grad Lounge 2", 5.4), ("Grad Lounge 3", 5.3)]),
}
SOLID = {"Dean's Office"}       # ガラスのない部屋
# 吹き抜け（その階の床の穴、南東側 Y = YS〜YCOR）の X の範囲。案内図の灰色
VOIDS = {3: (-23.2, -2.5), 4: (-17.7, 11.3), 5: (-11.8, 11.1), 6: (-5.3, 12.7)}
YG1 = -7.6                      # 1F のガラスの線・2F の床の南東の端（その外はピロティ）

# 研究棟側の L 字の曲がり角（研究棟北棟の端）。内側の面の座標
WX0 = 30.5                      # 曲がり角の帯（EV A の並び）の交流棟側の端
LX0 = 13.0                      # 脚（南東へ伸びる部分）の交流棟側の端
HX1 = 57.7                      # 頭（教室棟の端より先）の研究棟側の端
WY1 = -31.2                     # 曲がり角の南東の端
LY0 = -19.5                     # 脚の北西の端（その外は 3F 以上で外。1F・2F は玄関ホール）
HY0 = 2.2                       # 頭の道路側の端
FZ8 = 36.0                      # 8F（研究棟の図書館）の床
E8X = (38.0, 40.7)              # 7F→8F のエスカレーター（2 台）の X の範囲
E8Y = -5.6                      # 7F の乗り口の Y。ここから -Y へ上る
VB2 = (18.7, 28.3, -18.1, -9.7)  # 2F の玄関ホールの上の吹き抜け（2F 案内図の灰色の四角）
BRX, BRY = (22.5, 25.3), -61.0   # 6F の渡り廊下の X の範囲と、南棟側の端の Y（案内図 6704）
H7 = 3.4                        # 7F の天井の高さ


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


# 本部棟・交流棟と同じく「色だけ」のマテリアル（Unity 向け）
MAT = dict(
    carpet=mat("教室棟内装_カーペット", (0.06, 0.06, 0.065), 0.9),
    stripe=mat("教室棟内装_床の白い線", (0.55, 0.55, 0.53), 0.8),
    ceil=mat("教室棟内装_天井", (0.78, 0.77, 0.74), 0.9),
    soffit=mat("教室棟内装_床の裏", (0.70, 0.69, 0.66), 0.8),
    fascia=mat("教室棟内装_床の縁_グレー", (0.45, 0.45, 0.44), 0.5),
    light=mat("教室棟内装_照明", (1.0, 1.0, 0.97), 0.3),
    vent=mat("教室棟内装_空調の吹き出し", (0.45, 0.45, 0.44), 0.6),
    wall=mat("教室棟内装_白い壁", (0.80, 0.79, 0.76), 0.6),
    panel=mat("教室棟内装_間仕切りパネル", (0.84, 0.83, 0.80), 0.4),
    pglass=mat("教室棟内装_間仕切りのガラス", (0.60, 0.68, 0.70), 0.05, alpha=0.25),
    trim=mat("教室棟内装_枠_銀", (0.66, 0.67, 0.68), 0.3, 0.8),
    base=mat("教室棟内装_幅木", (0.35, 0.35, 0.35), 0.5),
    col=mat("教室棟内装_柱", (0.55, 0.55, 0.54), 0.5),
    tallcol=mat("教室棟内装_吹き抜けの柱", (0.25, 0.25, 0.26), 0.4, 0.3),
    fin=mat("教室棟内装_黒い板", (0.02, 0.02, 0.025), 0.35),
    signtext=mat("教室棟内装_番号札の文字", (0.95, 0.95, 0.95), 0.4),
    door=mat("教室棟内装_扉", (0.86, 0.85, 0.82), 0.4),
    dglass=mat("教室棟内装_扉のガラス", (0.55, 0.62, 0.64), 0.05, alpha=0.3),
    steeldoor=mat("教室棟内装_階段の鉄扉", (0.50, 0.50, 0.50), 0.4, 0.5),
    board=mat("教室棟内装_黒板", (0.08, 0.14, 0.11), 0.7),
    rglass=mat("教室棟内装_手すりのガラス", (0.70, 0.78, 0.78), 0.05, alpha=0.2),
    steel=mat("教室棟内装_手すり_銀", (0.70, 0.71, 0.72), 0.25, 1.0),
    esc_body=mat("教室棟内装_エスカレーターの側面", (0.62, 0.63, 0.64), 0.3, 0.9),
    esc_step=mat("教室棟内装_エスカレーターの踏み板", (0.12, 0.12, 0.13), 0.35, 0.8),
    esc_rail=mat("教室棟内装_エスカレーターの手すり", (0.02, 0.02, 0.02), 0.6),
    plate=mat("教室棟内装_乗り口の板", (0.55, 0.56, 0.57), 0.3, 1.0),
    # 仮の外壁
    ext_wall=mat("教室棟仮外壁_壁", (0.80, 0.80, 0.78), 0.6),
    ext_glass=mat("教室棟仮外壁_ガラス", (0.55, 0.65, 0.70), 0.05, alpha=0.35),
    ext_frame=mat("教室棟仮外壁_サッシ", (0.35, 0.36, 0.37), 0.4, 0.6),
    blind=mat("教室棟仮外壁_ロールスクリーン", (0.86, 0.85, 0.82), 0.8, alpha=0.6),
    dark=mat("教室棟外観_黒（玄関の庇）", (0.05, 0.05, 0.05), 0.9),
    # 1F（写真 6714）・南東の外観（6716）・曲がり角の外壁（6715）
    granite=mat("教室棟1F_床の石", (0.42, 0.42, 0.42), 0.6),
    granite_l=mat("教室棟1F_床の白い石", (0.70, 0.70, 0.68), 0.6),
    drum=mat("教室棟1F_黒い円筒", (0.06, 0.06, 0.065), 0.5),
    paving=mat("教室棟外構_ピロティの舗装", (0.30, 0.29, 0.28), 0.9),
    roofgray=mat("教室棟外観_屋根", (0.38, 0.38, 0.37), 0.9),
    louver=mat("教室棟外観_ルーバー", (0.62, 0.62, 0.60), 0.4, 0.6),
    sleeve=mat("教室棟外観_柱の石の袴", (0.58, 0.57, 0.55), 0.6),
    rib=mat("教室棟外観_波形の壁", (0.62, 0.55, 0.50), 0.7),
    # 7F の空中庭園
    deck=mat("教室棟庭園_ウッドデッキ", (0.22, 0.17, 0.14), 0.7),
    brick=mat("教室棟庭園_植え込みの縁", (0.30, 0.20, 0.15), 0.8),
    hedge=mat("教室棟庭園_植え込み", (0.10, 0.20, 0.07), 0.9),
    trunk=mat("教室棟庭園_幹", (0.20, 0.14, 0.10), 0.9),
    leaf=mat("教室棟庭園_木の葉", (0.16, 0.30, 0.10), 0.9),
    canopy=mat("教室棟庭園_屋根", (0.45, 0.46, 0.47), 0.5, 0.5),
    # EV A のかごの中（2026-10-24：暗くて怖いので明るく）
    evwall=mat("教室棟EV_壁", (0.90, 0.90, 0.88), 0.5),
    evglow=mat("教室棟EV_照明", (1.0, 1.0, 0.95), 0.3),
)
_g = bsdf(MAT["evglow"])
_g.inputs["Emission Color"].default_value = (1.0, 0.98, 0.9, 1)
_g.inputs["Emission Strength"].default_value = 4.0

# ---------- 準備 ----------
scene = bpy.context.scene
if bpy.context.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
icol = bpy.data.collections.get(IN_COL)
if icol is None:
    icol = bpy.data.collections.new(IN_COL)
    scene.collection.children.link(icol)
for o in list(bpy.data.objects):
    if o.get(IN_GEN):
        me = o.data
        bpy.data.objects.remove(o)
        if me is not None and me.users == 0:
            bpy.data.meshes.remove(me)


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
        if x1 - x0 < 1e-4 or y1 - y0 < 1e-4 or z1 - z0 < 1e-4:
            return
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

    def prism_y(self, prof, y0, y1, key):
        """XZ 平面の多角形 prof を Y 方向に押し出す"""
        n = len(prof)
        self.face([(x, y0, z) for x, z in prof], key)
        self.face([(x, y1, z) for x, z in prof][::-1], key)
        for i in range(n):
            (xa, za), (xb, zb) = prof[i], prof[(i + 1) % n]
            self.face([(xa, y0, za), (xb, y0, zb), (xb, y1, zb), (xa, y1, za)], key)

    def cyl(self, cx, cy, r, z0, z1, key, seg=16):
        pts = [(cx + r * math.cos(2 * math.pi * i / seg), cy + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
        for i in range(seg):
            a, b = pts[i], pts[(i + 1) % seg]
            self.face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], key)

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
        o[IN_GEN] = True
        icol.objects.link(o)
        return o


# 文字（番号）をメッシュにして MB に足す（標準フォントには日本語がないので英数字）
_font_cache = {}


def text_mesh(s):
    if s in _font_cache:
        return _font_cache[s]
    cu = bpy.data.curves.new("_tmp_txt", 'FONT')
    cu.body = s
    cu.size = 1.0
    cu.resolution_u = 2
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    ob = bpy.data.objects.new("_tmp_txt", cu)
    scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    vs = [tuple(v.co) for v in me.vertices]
    fs = [tuple(p.vertices) for p in me.polygons]
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    _font_cache[s] = (vs, fs)
    return vs, fs


def add_text(mb, s, center, normal, size, key="signtext"):
    """center に、normal の向きに向いた文字を置く"""
    vs, fs = text_mesh(s)
    nx, ny = normal
    rx, ry = -ny, nx            # 見る人から見て右
    cx, cy, cz = center
    base = len(mb.v)
    for x, y, _ in vs:
        mb.v.append((cx + rx * x * size + nx * 0.005, cy + ry * x * size + ny * 0.005, cz + y * size))
    for f in fs:
        mb.f.append(tuple(base + i for i in f))
        mb.mi.append(mb._m(key))


# ---------- 平面の道具：長方形の引き算 ----------
def sub(rects, hole):
    """rects（(x0,x1,y0,y1) のリスト）から hole を引く"""
    hx0, hx1, hy0, hy1 = hole
    out = []
    for x0, x1, y0, y1 in rects:
        if hx1 <= x0 or hx0 >= x1 or hy1 <= y0 or hy0 >= y1:
            out.append((x0, x1, y0, y1))
            continue
        if x0 < hx0:
            out.append((x0, hx0, y0, y1))
        if hx1 < x1:
            out.append((hx1, x1, y0, y1))
        cx0, cx1 = max(x0, hx0), min(x1, hx1)
        if y0 < hy0:
            out.append((cx0, cx1, y0, hy0))
        if hy1 < y1:
            out.append((cx0, cx1, hy1, y1))
    return out


def esc_hole(fb, ft, xb, xt, top=None):
    """下の階 fb → 上の階 ft のエスカレーターが、上の床（または高さ top の天井）を抜ける穴。
    頭がぶつからない（踏み板 + 2.3m）所から、傾きの終わりまで"""
    sb, st = xb + FLAT, xt - FLAT
    lim = (FZ[ft] - SLAB) if top is None else top
    xh = sb + (lim - 2.3 - FZ[fb]) / TAN
    return (xh, st, EY[1] - 0.15, EY[0] + 0.15)


def holes(f, top=None):
    """f 階の床を抜けるエスカレーターの穴"""
    return [esc_hole(fb, ft, xb, xt, top) for fb, ft, xb, xt in ESC if ft == f]


def bar_rects(f):
    """教室棟（長方形の部分）の f 階の床の外形"""
    if f in (1, 2):     # 1F はガラスの線まで、2F は廊下まで（南東側はピロティ）。脚から研究棟側は全部床
        return [(-L2 + 0.3, L2 - 0.3, YG1, YN), (LX0, L2 - 0.3, YS, YG1)]
    return [(-L2 + 0.3, L2 - 0.3, YS, YN)]


def floor_rects(f):
    """f 階の床の範囲（吹き抜けと、エスカレーターの穴を除く）"""
    rects = bar_rects(f)
    if f in VOIDS:
        vx0, vx1 = VOIDS[f]
        rects = sub(rects, (vx0, vx1, YS, YCOR))
    for h in holes(f):
        rects = sub(rects, h)
    if f == 2:
        rects = sub(rects, VB2)
    if stair_hole(f):
        rects = sub(rects, stair_hole(f))
    return rects


def ceil_rects(f):
    """f 階の天井の範囲（上の階の吹き抜け・エスカレーターの穴の所はなし）"""
    rects = bar_rects(f)
    if f + 1 in VOIDS:
        vx0, vx1 = VOIDS[f + 1]
        rects = sub(rects, (vx0, vx1, YS, YCOR))
    for h in holes(f + 1, top=FZ[f] + (CEIL if f > 1 else FZ[2] - SLAB - 0.15)):
        rects = sub(rects, h)
    if f == 1:
        rects = sub(rects, VB2)
    if 1 <= f <= 5:                 # 階段室：行き・戻り・踊り場の頭の上は天井をあける（踊り場は天井から 0.5m しか空かない）
        rects = sub(rects, (STAIR_A[0], STAIR_B[1], SY0, SY_LAND))
    return rects


# 6F→7F が 7F の床を抜けるところ
E6_HOLE = holes(7)[0]


# ---------- 部品 ----------
def railing(mb, p0, p1, z, h=1.1):
    """ガラスの手すり（写真 6663・6669：ガラス板＋上に銀の手すり）"""
    (xa, ya), (xb, yb) = p0, p1
    if abs(xb - xa) + abs(yb - ya) < 0.05:
        return
    if abs(ya - yb) < 1e-6:
        mb.box(xa, xb, ya - 0.01, ya + 0.01, z + 0.05, z + h - 0.05, "rglass")
        mb.box(xa, xb, ya - 0.03, ya + 0.03, z + h - 0.05, z + h, "steel")
        mb.box(xa, xb, ya - 0.03, ya + 0.03, z, z + 0.06, "steel")
        n = max(1, round(abs(xb - xa) / 1.5))
        for i in range(n + 1):
            x = xa + (xb - xa) * i / n
            mb.box(x - 0.02, x + 0.02, ya - 0.04, ya + 0.04, z, z + h, "steel")
    else:
        mb.box(xa - 0.01, xa + 0.01, ya, yb, z + 0.05, z + h - 0.05, "rglass")
        mb.box(xa - 0.03, xa + 0.03, ya, yb, z + h - 0.05, z + h, "steel")
        mb.box(xa - 0.03, xa + 0.03, ya, yb, z, z + 0.06, "steel")


def partition_panel(mb, xa, xb, yp, z, glass=True):
    """間仕切りの 1 区画：下の白・目の高さのガラス（銀の枠）・上の白"""
    y0, y1 = yp - 0.06, yp + 0.06
    if not glass:
        mb.box(xa, xb, y0, y1, z, z + CEIL, "panel")
    else:
        mb.box(xa, xb, y0, y1, z, z + 0.95, "panel")
        mb.box(xa, xb, y0, y1, z + 2.35, z + CEIL, "panel")
        mb.box(xa, xb, yp - 0.005, yp + 0.005, z + 0.95, z + 2.35, "pglass")
        for ya, yb in ((y0 - 0.01, y0 + 0.02), (y1 - 0.02, y1 + 0.01)):
            mb.box(xa, xb, ya, yb, z + 0.93, z + 0.97, "trim")
            mb.box(xa, xb, ya, yb, z + 2.33, z + 2.37, "trim")
    mb.box(xa, xa + 0.01, y0 - 0.008, y1 + 0.008, z, z + CEIL, "trim")      # パネルの継ぎ目
    mb.box(xa, xb, y0 - 0.01, y1 + 0.01, z, z + 0.08, "base")


def door(mb, xa, xb, yp, z, glass=True):
    """白い枠の扉（写真 6670：大きなガラスの入った引き戸）"""
    y0, y1 = yp - 0.06, yp + 0.06
    DH, fw, m = 2.6, 0.06, 0.12
    mb.box(xa, xb, y0, y1, z + DH, z + CEIL, "panel")
    mb.box(xa, xa + fw, y0 - 0.02, y1 + 0.02, z, z + DH + fw, "door")
    mb.box(xb - fw, xb, y0 - 0.02, y1 + 0.02, z, z + DH + fw, "door")
    mb.box(xa, xb, y0 - 0.02, y1 + 0.02, z + DH, z + DH + fw, "door")
    a, b = xa + fw, xb - fw
    dy0, dy1 = yp - 0.02, yp + 0.02
    if glass:
        mb.box(a, b, dy0, dy1, z, z + 0.35, "door")
        mb.box(a, b, dy0, dy1, z + DH - m, z + DH, "door")
        mb.box(a, a + m, dy0, dy1, z + 0.35, z + DH - m, "door")
        mb.box(b - m, b, dy0, dy1, z + 0.35, z + DH - m, "door")
        mb.box(a + m, b - m, yp - 0.004, yp + 0.004, z + 0.35, z + DH - m, "dglass")
    else:
        mb.box(a, b, dy0, dy1, z, z + DH, "door")
    hx = a + 0.12
    mb.box(hx - 0.015, hx + 0.015, yp - 0.06, yp + 0.06, z + 0.85, z + 1.25, "trim")   # 引き手


def black_fin(mb, x, yp, side, z, labels=()):
    """部屋の境に立つ黒い板（廊下側へ 0.9m 出る）。labels = [(文字, 向き +1/-1), ...]"""
    t = 0.05
    ya, yb = yp + side * 0.9, yp - side * 0.1
    mb.box(x - t, x + t, ya, yb, z, z + CEIL - 0.1, "fin")
    for s, d in labels:
        size = 0.30 if len(s) <= 5 else 0.10
        add_text(mb, s, (x + d * (t + 0.001), (ya + yb) / 2, z + 2.25), (d, 0), size)


def room_row(mb, rooms, x_start, yp, side, z, y_far, door_side_far=False):
    """部屋を X 方向に並べる。yp = 廊下側の間仕切り、side = 廊下のある向き（-1 / +1）、y_far = 奥の外壁"""
    x = x_start
    bounds = []
    for label, w in rooms:
        bounds.append((label, x, x + w))
        x += w
    for i, (label, xa, xb) in enumerate(bounds):
        glass = label not in SOLID
        n = max(2, round((xb - xa) / 1.45))
        mods = [(xa + (xb - xa) * m / n, xa + (xb - xa) * (m + 1) / n) for m in range(n)]
        doors = {1, n - 2} if n >= 6 else {n - 2} if n >= 3 else {0}
        for m, (ma, mb_) in enumerate(mods):
            if m in doors:
                door(mb, ma + 0.1, mb_ - 0.1, yp, z, glass)
                partition_panel(mb, ma, ma + 0.1, yp, z, False)
                partition_panel(mb, mb_ - 0.1, mb_, yp, z, False)
            else:
                partition_panel(mb, ma, mb_, yp, z, glass)
        # 部屋の境の壁（外壁まで）
        for xw in (xa, xb):
            mb.box(xw - 0.06, xw + 0.06, min(yp, y_far), max(yp, y_far), z, z + CEIL, "wall")
        # 黒板（研究棟側の壁。教室だけ）
        if label[:1].isdigit() and len(label) <= 3:
            yy = sorted((yp - side * 1.5, y_far + side * 1.5))
            mb.box(xb - 0.09, xb - 0.06, yy[0], yy[1], z + 0.9, z + 2.1, "board")
    # 黒い板と番号札
    edges = {}
    for label, xa, xb in bounds:
        edges.setdefault(round(xa, 3), []).append((label, 1))
        edges.setdefault(round(xb, 3), []).append((label, -1))
    for x, labels in edges.items():
        black_fin(mb, x, yp, side, z, labels)


def escalator(mb, xb, xt, zb, zt, w0, w1):
    """X 方向のエスカレーター 1 台。xb（下の端）→ xt（上の端）へ上る。w0..w1 = Y の範囲"""
    d = 1 if xt > xb else -1
    sb, st = xb + d * FLAT, xt - d * FLAT          # 傾きの始まりと終わり
    # 本体（銀の側面・下の斜め）
    mb.prism_y([(xb, zb - 0.05), (xb, zb), (sb, zb), (st, zt), (xt, zt), (xt, zt - 1.0),
                (st - d * 0.5, zt - 1.0), (sb + d * 1.2, zb - 0.05)], w0, w1, "esc_body")
    # 踏み板（黒）と乗り口の板
    for (a, za), (b, zb_) in (((xb, zb), (sb, zb)), ((sb, zb), (st, zt)), ((st, zt), (xt, zt))):
        mb.face([(a, w0 + 0.12, za + 0.005), (a, w1 - 0.12, za + 0.005),
                 (b, w1 - 0.12, zb_ + 0.005), (b, w0 + 0.12, zb_ + 0.005)], "esc_step")
    for xx in (xb, xt):
        zz = zb if xx == xb else zt
        mb.box(xx, xx + d * (0.6 if xx == xb else -0.6), w0 + 0.12, w1 - 0.12, zz, zz + 0.012, "plate")
    # ガラスの欄干と黒い手すり（両側）
    for g in (w0 + 0.06, w1 - 0.06):
        mb.prism_y([(xb + d * 0.3, zb + 0.1), (sb, zb + 0.1), (st, zt + 0.1), (xt - d * 0.3, zt + 0.1),
                    (xt - d * 0.3, zt + 0.95), (st, zt + 0.95), (sb, zb + 0.95), (xb + d * 0.3, zb + 0.95)],
                   g - 0.01, g + 0.01, "rglass")
        mb.prism_y([(xb + d * 0.1, zb + 0.95), (sb, zb + 0.95), (st, zt + 0.95), (xt - d * 0.1, zt + 0.95),
                    (xt - d * 0.1, zt + 1.03), (st, zt + 1.03), (sb, zb + 1.03), (xb + d * 0.1, zb + 1.03)],
                   g - 0.04, g + 0.04, "esc_rail")
        mb.box(xb, xb + d * 0.3, g - 0.06, g + 0.06, zb, zb + 1.0, "esc_body")      # 乗り口の黒い支柱代わり
        mb.box(xt, xt - d * 0.3, g - 0.06, g + 0.06, zt, zt + 1.0, "esc_body")


def downlights(mb, rects, z):
    for x0, x1, y0, y1 in rects:
        nx, ny = max(1, int((x1 - x0) / 2.9)), max(1, int((y1 - y0) / 3.2))
        for i in range(nx):
            for j in range(ny):
                x = x0 + (x1 - x0) * (i + 0.5) / nx
                y = y0 + (y1 - y0) * (j + 0.5) / ny
                mb.box(x - 0.1, x + 0.1, y - 0.1, y + 0.1, z - 0.005, z, "light")


def room_box(mb, label, x0, x1, y0, y1, z, face, h=CEIL, door_key="door", size=None, with_door=True):
    """部屋の箱（壁だけ）。face（'+x' '-x' '+y' '-y'）の面の真ん中に扉と番号札"""
    t = 0.06
    mb.box(x0 - t, x1 + t, y0 - t, y0 + t, z, z + h, "wall")
    mb.box(x0 - t, x1 + t, y1 - t, y1 + t, z, z + h, "wall")
    mb.box(x0 - t, x0 + t, y0, y1, z, z + h, "wall")
    mb.box(x1 - t, x1 + t, y0, y1, z, z + h, "wall")
    sx = {"+x": (1, 0), "-x": (-1, 0), "+y": (0, 1), "-y": (0, -1)}[face]
    if sx[0]:
        xf = x1 if sx[0] > 0 else x0
        yc = (y0 + y1) / 2
        if with_door:
            mb.box(xf, xf + sx[0] * (t + 0.02), yc - 0.5, yc + 0.5, z, z + 2.2, door_key)
        center = (xf + sx[0] * (t + 0.021), yc, z + 2.55)
    else:
        yf = y1 if sx[1] > 0 else y0
        xc = (x0 + x1) / 2
        if with_door:
            mb.box(xc - 0.5, xc + 0.5, yf, yf + sx[1] * (t + 0.02), z, z + 2.2, door_key)
        center = (xc, yf + sx[1] * (t + 0.021), z + 2.55)
    if label:
        add_text(mb, label, center, sx, size or (0.30 if len(label) <= 5 else 0.14))


def merge_mapped(dst, src, fn):
    """src の頂点を fn で動かして dst に足す（Y 向きのエスカレーター用）"""
    base = len(dst.v)
    dst.v += [fn(*p) for p in src.v]
    for f, i in zip(src.f, src.mi):
        dst.f.append(tuple(base + k for k in f))
        dst.mi.append(dst._m(src.keys[i]))


def void_railings(mb, f, z):
    """f 階の吹き抜けと、エスカレーターの穴のまわりの手すり"""
    vx0, vx1 = VOIDS.get(f, (0.0, 0.0))
    if f in VOIDS:
        railing(mb, (vx0, YCOR), (vx1, YCOR), z)
        s_end = SOUTH[f][0] + sum(w for _, w in SOUTH[f][1]) if f in SOUTH else -1e9
        if vx0 > s_end + 0.05:                  # 部屋と吹き抜けの間に床がある
            railing(mb, (vx0, YS + 0.3), (vx0, YCOR), z)
    hs = holes(f) + ([VB2] if f == 2 else [])
    # 吹き抜けの研究棟側の端（エスカレーターの穴が続く所はあける）
    if f in VOIDS:
        cuts = sorted((h[2], h[3]) for h in hs if h[0] < vx1 < h[1])
        ys = [YS + 0.3]
        for a, b in cuts:
            ys += [a, b]
        ys.append(YCOR)
        for i in range(0, len(ys), 2):
            railing(mb, (vx1, ys[i]), (vx1, ys[i + 1]), z)
    for hx0, hx1, hy0, hy1 in hs:
        a, b = hx0, hx1
        if f in VOIDS:                          # 吹き抜けの中の部分は手すりなし
            if vx0 <= a and b <= vx1:
                continue
            if a < vx1 < b:
                a = vx1
            if a < vx0 < b:
                b = vx0
        railing(mb, (a, hy0), (b, hy0), z)
        railing(mb, (a, hy1), (b, hy1), z)
        if not (f in VOIDS and vx0 <= hx0 <= vx1):
            railing(mb, (hx0, hy0), (hx0, hy1), z)
        if (hx0, hx1, hy0, hy1) == VB2:
            railing(mb, (hx1, hy0), (hx1, hy1), z)


# ---------- 階ごとに作る（教室棟の長方形の部分） ----------
for f in range(1, 7):
    z = FZ[f]
    tag = f"{f}F"

    # 床（スラブ）と天井
    fc = MB()
    for x0, x1, y0, y1 in floor_rects(f):
        if f == 1:
            fc.box(x0, x1, y0, y1, z - 0.02, z + 0.02, "granite")
        else:
            fc.box(x0, x1, y0, y1, z - SLAB, z + 0.02, "carpet",
                   keys6=["soffit", "carpet", "fascia", "fascia", "fascia", "fascia"])
    zc = z + (CEIL if f > 1 else FZ[2] - SLAB - 0.15)
    crs = ceil_rects(f)
    # 天井から上の階の床の裏までを詰める（2026-10-21：前は厚さ 4cm の板だけで、吹き抜けやエスカレーターの穴の縁から
    # 天井と床の間の空洞が見えていた）。下の面が天井、横の面は床の縁と同じグレー
    ztop = FZ[f + 1] - SLAB if f + 1 in FZ else zc + 0.04
    for x0, x1, y0, y1 in crs:
        fc.box(x0, x1, y0, y1, zc, max(zc + 0.04, ztop), "ceil", keys6=["ceil", "ceil", "fascia", "fascia", "fascia", "fascia"])
    downlights(fc, crs, zc)
    if f == 2:
        # ピロティの屋根（2F の床の南東の外。歩けない）
        fc.box(-L2 + 0.3, LX0, YS, YG1, z - SLAB, z - 0.05, "roofgray",
               keys6=["soffit", "roofgray", "fascia", "fascia", "fascia", "fascia"])
    if f >= 2:
        # 床の白い線（柱の列ごとに廊下を横切る 2 本）
        for x in COLX:
            for dx in (-0.25, 0.25):
                fc.box(x + dx - 0.06, x + dx + 0.06, YCOR + 0.05, YCW - 0.1, z + 0.02, z + 0.025, "stripe")
    fc.build(f"教室棟_{tag}_床と天井")
    if f == 1:
        continue

    # 部屋（道路側の教室・南東の交流棟側の部屋）
    rm = MB()
    room_row(rm, NORTH[f], RX0, YCW, -1, z, YN)
    if f in SOUTH:
        sx0, s_rooms = SOUTH[f]
        room_row(rm, s_rooms, sx0, YCOR, 1, z, YS)
        xe = sx0 + sum(w for _, w in s_rooms)
        # 南東の部屋の、研究棟側の壁（ガラス）
        n = round((YCOR - YS) / 1.45)
        for m in range(n):
            a, b = YS + (YCOR - YS) * m / n, YS + (YCOR - YS) * (m + 1) / n
            rm.box(xe - 0.06, xe + 0.06, a, b, z, z + 0.95, "panel")
            rm.box(xe - 0.005, xe + 0.005, a, b, z + 0.95, z + 2.35, "pglass")
            rm.box(xe - 0.06, xe + 0.06, a, b, z + 2.35, z + CEIL, "panel")
    # 両端の階段室（道路側）
    for xa, xb, dx in ((RX1, L2 - 0.3, RX1 + 0.1), (-L2 + 0.3, RX0, RX0 - 0.1)):
        rm.box(dx, dx + (0.12 if dx > 0 else -0.12), YCW, YN, z, z + CEIL, "wall")
        rm.box(xa, xb, YCW - 0.06, YCW + 0.06, z, z + CEIL, "wall")
        dc = (xa + xb) / 2
        rm.box(dc - 0.5, dc + 0.5, YCW - 0.09, YCW - 0.06, z, z + 2.2, "steeldoor")
    rm.build(f"教室棟_{tag}_教室と扉")

    # 柱
    cl = MB()
    vx0, vx1 = VOIDS.get(f, (1e9, 1e9))
    for x in COLX:
        cl.cyl(x, YCW, 0.4, z, z + CEIL, "col", seg=20)
        cl.box(x - 0.35, x + 0.35, YN - 0.7, YN, z, z + CEIL, "col")             # 道路側の窓の柱
        if f >= 3 and not (vx0 - 0.5 < x < vx1 + 0.5) and x < WX0:
            cl.cyl(x, YCOR, 0.4, z, z + CEIL, "col", seg=20)
    cl.build(f"教室棟_{tag}_柱")

    # 吹き抜け・エスカレーターの穴の手すり。2F は南東の床の端も
    rl = MB()
    void_railings(rl, f, z)
    sh = stair_hole(f)
    if sh:                                      # 階段室の穴：A との間と、踊り場側に手すり（乗り降りの側はあける）
        railing(rl, (sh[0], sh[2]), (sh[0], sh[3]), z)
        railing(rl, (sh[0], sh[3]), (sh[1], sh[3]), z)
    if f == 2:
        railing(rl, (-L2 + 0.3, YG1), (LX0, YG1), z)
    rl.build(f"教室棟_{tag}_吹き抜けの手すり")

# ---------- エスカレーター ----------
es = MB()
for fb, ft, xb, xt in ESC:
    zb, zt = FZ[fb], FZ[ft]
    escalator(es, xb, xt, zb, zt, EY[0] - 1.35, EY[0])
    escalator(es, xb, xt, zb, zt, EY[1], EY[1] + 1.35)
# 7F→8F：X 向きに作って、-Y へ上る向きに回す（u = 乗り口からの距離、w = X）
e8 = MB()
L8 = run(FZ8 - FZ[7])
escalator(e8, 0.0, L8, FZ[7], FZ8, E8X[0], (E8X[0] + E8X[1]) / 2)
escalator(e8, 0.0, L8, FZ[7], FZ8, (E8X[0] + E8X[1]) / 2, E8X[1])
merge_mapped(es, e8, lambda u, w, zz: (w, E8Y - u, zz))
es.build("教室棟_エスカレーター")
H7T = FZ[7] + H7                      # 7F の天井
E8_SB = E8Y - FLAT                    # 7F→8F の傾きの始まり（Y）
E8_ST = E8Y - L8 + FLAT               # 傾きの終わり


def e8_hole(top):
    """7F→8F が高さ top の天井（床）を抜ける穴（X, Y の長方形）"""
    yh = E8_SB - (top - 2.3 - FZ[7]) / TAN
    return (E8X[0] - 0.15, E8X[1] + 0.15, E8_ST, yh)


# 階段室の階段（コンクリートの踏み面・斜めの裏・踊り場）。写真がないので簡素な作り
def prism_x(mb, prof, x0, x1, key):
    """YZ 平面の多角形 prof を X 方向に押し出す"""
    n = len(prof)
    mb.face([(x0, y, z) for y, z in prof][::-1], key)
    mb.face([(x1, y, z) for y, z in prof], key)
    for i in range(n):
        (ya, za), (yb, zb) = prof[i], prof[(i + 1) % n]
        mb.face([(x0, ya, za), (x0, yb, zb), (x1, yb, zb), (x1, ya, za)], key)


def stair_run(mb, xr, z0, z1, key):
    """1 本の直線階段。Y = SY0 の端の高さ z0 → SY1 の端の高さ z1 へ、踏み面が 0.18m ずつ変わる（z1 < z0 なら下り）"""
    n = max(2, round(abs(z1 - z0) / 0.18))
    dy, r = (SY1 - SY0) / n, (z1 - z0) / n
    top = [(SY0, z0)]
    for i in range(n):
        z = z0 + (i + 1) * r
        top += [(SY0 + i * dy, z), (SY0 + (i + 1) * dy, z)]
    prism_x(mb, top + [(SY1, z1 - 0.25), (SY0, z0 + r - 0.25)], xr[0], xr[1], key)


st = MB()
for fb, ft in STAIR_FLIGHTS:
    zb, zt = FZ[fb], FZ[ft]
    zm = (zb + zt) / 2
    stair_run(st, STAIR_A, zb, zm, "col")                     # 行き：SY0 で floor fb → SY1 で中段
    stair_run(st, STAIR_B, zt, zm, "col")                     # 戻り：SY1 で中段 → SY0 で floor ft
    st.box(STAIR_A[0], STAIR_B[1], SY1, SY_LAND, zm - 0.25, zm, "col")      # 踊り場
st.build("教室棟_階段室の階段")

# ピロティの柱（1F は外、2F から上は南東のガラスの内側に立つ高い柱。写真 6716）
tc = MB()
for x in COLX:
    if x < LX0 - 1.0:
        tc.cyl(x, YS + 0.9, 0.45, 0, FZ[7] - SLAB, "tallcol", seg=16)
        tc.cyl(x, YS + 0.9, 0.55, 0, 1.6, "sleeve", seg=16)
tc.build("教室棟_ピロティの柱")

# ---------- 1F（案内図 6713・写真 6714） ----------
# 道路側に SIT 総合研究所（テクノプラザ）、廊下の真ん中に黒い楕円の部屋（テクノプラザ IV）、
# 研究棟側の端は玄関ホール（受付・丸いトイレの塔・防災センター）。南東側はピロティ（ガラスは YG1）
H1 = FZ[2] - SLAB - 0.15
f1 = MB()
# 道路側の部屋（ガラスの間仕切り。案内図の緑）
YR1 = 2.7
for label, xa, xb in (("SIT Research Labs / Techno Plaza", -35.0, LX0), ("Shared Facilities", LX0, 19.8)):
    n = max(2, round((xb - xa) / 1.45))
    for m in range(n):
        a, b = xa + (xb - xa) * m / n, xa + (xb - xa) * (m + 1) / n
        if m in (1, n - 2):
            door(f1, a + 0.1, b - 0.1, YR1, 0.0)
            partition_panel(f1, a, a + 0.1, YR1, 0.0, False)
            partition_panel(f1, b - 0.1, b, YR1, 0.0, False)
        else:
            partition_panel(f1, a, b, YR1, 0.0)
    for xw in (xa, xb):
        f1.box(xw - 0.06, xw + 0.06, YR1, YN, 0, CEIL, "wall")
    black_fin(f1, xb, YR1, -1, 0.0, [(label if len(label) <= 18 else "Techno Plaza", -1)])
f1.box(-35.0, 19.8, YR1 - 0.06, YR1 + 0.06, CEIL, H1, "wall")
# 防災センター（壁だけ）と両端の階段
room_box(f1, "Safety Center", 24.6, 37.0, 3.0, YN, 0.0, "-y", h=H1)
room_box(f1, "", 37.0, L2 - 0.3, 5.0, YN, 0.0, "-y", h=H1, door_key="steeldoor")
room_box(f1, "", -L2 + 0.3, -35.0, 1.8, YN, 0.0, "-y", h=H1, door_key="steeldoor")
# 黒い楕円の部屋（テクノプラザ IV）：両端が半円
OX0, OX1, OY0, OY1 = -6.55, 17.05, -5.7, -0.2
r = (OY1 - OY0) / 2
oc = (OY0 + OY1) / 2
seg = 12
pts = [(OX1 + r * math.cos(-math.pi / 2 + math.pi * i / seg), oc + r * math.sin(-math.pi / 2 + math.pi * i / seg))
       for i in range(seg + 1)]
pts += [(OX0 + r * math.cos(math.pi / 2 + math.pi * i / seg), oc + r * math.sin(math.pi / 2 + math.pi * i / seg))
        for i in range(seg + 1)]
for i in range(len(pts)):
    (ax, ay), (bx, by) = pts[i], pts[(i + 1) % len(pts)]
    f1.face([(ax, ay, 0), (bx, by, 0), (bx, by, 4.6), (ax, ay, 4.6)], "drum")
f1.face([(x, y, 4.6) for x, y in pts], "drum")
add_text(f1, "TECHNO PLAZA IV", ((OX0 + OX1) / 2, OY0 - 0.01, 3.6), (0, -1), 0.35)
# 丸いトイレの塔（黒い円筒）と受付
f1.cyl(33.7, -4.4, 4.0, 0, 4.6, "drum", seg=28)
f1.box(33.7 - 4.0, 33.7 + 4.0, -8.4, -0.4, 4.55, 4.6, "drum")
f1.box(27.0, 28.0, -6.5, -2.3, 0, 1.05, "panel")
f1.box(26.9, 28.1, -6.6, -2.2, 1.05, 1.1, "trim")
add_text(f1, "Reception", (26.89, -4.4, 1.3), (-1, 0), 0.2)
# 床の白い石の帯（交流棟側から玄関ホールへ）
for x in range(-36, 42, 6):
    f1.box(x, x + 1.2, YG1 + 0.1, YR1 - 0.1, 0.02, 0.025, "granite_l")
f1.build("教室棟_1F_部屋と玄関ホール")

# ---------- 7F：空中庭園（写真 6688〜6690）・廊下・吹き抜けの屋根（案内図 6694） ----------
# 案内図の読み取り（4F の案内図と上下が逆。研究棟が下）：
#   庭園：道路側。交流棟寄り（X < C7X）は Y = -7.8 から、研究棟寄りは Y = -1.0 から道路側の外壁まで
#   廊下：交流棟寄りは南東の外壁沿い、研究棟寄りは真ん中（Y = -4.1〜-1.0）。エスカレーターの着き場で南東へ広がる
#   グレー：研究棟寄りの南東側は吹き抜けの屋根（歩けない）。交流棟側の端の道路寄りは機械室
z7 = FZ[7]
G7X0, G7X1 = -30.1, 36.2        # 庭園の X の範囲
C7X = 0.8                       # 廊下が南東の外壁沿い → 真ん中へ移るところ
GY0, GY1 = -7.8, -1.0           # 庭園の南東の端（交流棟寄り / 研究棟寄り）
CY = -4.1                       # 研究棟寄りの廊下の南東の端
EX7 = E6_HOLE[0] - 0.2          # ここから研究棟側は、廊下がエスカレーターの着き場まで広がる
GARDEN = [(G7X0, C7X, GY0, YN), (C7X, G7X1, GY1, YN)]
CORR7 = [(-L2 + 0.3, -37.4, YS, YN), (-37.4, G7X0, YS, -2.2), (G7X0, C7X, YS, GY0),
         (C7X, EX7, CY, GY1), (EX7, G7X1, GY0, GY1), (G7X1, L2 - 0.3, YS, YN)]
MACH7 = (-37.4, G7X0, -2.2, YN)
ROOF7 = [(C7X, EX7, YS, CY), (EX7, G7X1, YS, GY0)]

g = MB()
for x0, x1, y0, y1 in floor_rects(7):
    g.box(x0, x1, y0, y1, z7 - 0.6, z7, "carpet", keys6=["soffit", "carpet", "fascia", "fascia", "fascia", "fascia"])
for x0, x1, y0, y1 in GARDEN:
    g.box(x0, x1, y0, y1, z7, z7 + 0.04, "deck")
    x = x0
    while x < x1:                                                           # デッキの目地
        g.box(x, min(x + 0.02, x1), y0, y1, z7 + 0.04, z7 + 0.045, "trunk")
        x += 0.9
for x0, x1, y0, y1 in ROOF7:
    g.box(x0, x1, y0, y1, z7, z7 + 0.03, "canopy")
# 植え込み（レンガの縁＋刈り込んだ低木）と木（6688・6689）
BEDS = [(-27, -17, 1.0, 4.0), (-13, -3, 1.0, 4.0), (3, 13, 2.0, 5.0), (17, 27, 2.0, 5.0),
        (-26, -14, -6.0, -4.0), (-10, -1, -6.0, -4.0), (5, 15, 0.0, 1.0)]
for xa, xb, ya, yb in BEDS:
    g.box(xa, xb, ya, yb, z7 + 0.04, z7 + 0.45, "brick")
    g.box(xa + 0.15, xb - 0.15, ya + 0.15, yb - 0.15, z7 + 0.45, z7 + 1.05, "hedge")
for tx, ty in ((-24, 2.5), (-8, 2.5), (8, 3.5), (22, 3.5), (-20, -5), (-5, -5), (31, 4.0)):
    g.cyl(tx, ty, 0.12, z7 + 0.45, z7 + 3.0, "trunk", seg=8)
    g.box(tx - 1.3, tx + 1.3, ty - 1.3, ty + 1.3, z7 + 2.6, z7 + 4.2, "leaf")
# 道路側の縁：屋根付きの通路（柱と屋根）とガラスの手すり
x = G7X0 + 1.0
while x < G7X1:
    g.box(x - 0.15, x + 0.15, 9.0, 9.3, z7, z7 + 3.2, "canopy")
    x += 2 * U
g.box(G7X0, G7X1, 8.7, YN, z7 + 3.2, z7 + 3.4, "canopy")
railing(g, (G7X0, YN - 0.1), (G7X1, YN - 0.1), z7, h=1.2)
g.build("教室棟_7F_空中庭園")

hl = MB()


def glass_wall(mb, p0, p1, z0, h):
    """床から天井までのガラスの壁（方立て 2.9m おき）"""
    (xa, ya), (xb, yb) = p0, p1
    if abs(ya - yb) < 1e-6:
        mb.box(xa, xb, ya - 0.01, ya + 0.01, z0, z0 + h, "ext_glass")
        n = max(1, round(abs(xb - xa) / U))
        for i in range(n + 1):
            x = xa + (xb - xa) * i / n
            mb.box(x - 0.04, x + 0.04, ya - 0.06, ya + 0.06, z0, z0 + h, "ext_frame")
        mb.box(xa, xb, ya - 0.06, ya + 0.06, z0 + h - 0.1, z0 + h, "ext_frame")
    else:
        mb.box(xa - 0.01, xa + 0.01, ya, yb, z0, z0 + h, "ext_glass")
        n = max(1, round(abs(yb - ya) / U))
        for i in range(n + 1):
            y = ya + (yb - ya) * i / n
            mb.box(xa - 0.06, xa + 0.06, y - 0.04, y + 0.04, z0, z0 + h, "ext_frame")
        mb.box(xa - 0.06, xa + 0.06, ya, yb, z0 + h - 0.1, z0 + h, "ext_frame")


# 廊下と庭園の間・廊下と屋根の間のガラス
for p0, p1 in (((G7X0, GY0), (C7X, GY0)), ((C7X, CY), (C7X, GY1)), ((C7X, GY1), (G7X1, GY1)),
               ((G7X0, GY0), (G7X0, -2.2)), ((C7X, CY), (EX7, CY)), ((EX7, GY0), (EX7, CY)),
               ((EX7, GY0), (G7X1, GY0)), ((G7X1, YS), (G7X1, YN)), ((WX0, YS), (G7X1, YS))):
    glass_wall(hl, p0, p1, z7, H7)
# 交流棟寄りの庭園と吹き抜けの屋根の境の手すり
railing(hl, (C7X, GY0), (C7X, CY), z7)
# 機械室（グレー、道路側の交流棟側の端）
mx0, mx1, my0, my1 = MACH7
hl.box(mx0, mx1, my0, my0 + 0.15, z7, z7 + H7, "wall")
hl.box(mx1 - 0.15, mx1, my0, my1, z7, z7 + H7, "wall")
hl.box(mx0 + 2.0, mx0 + 3.2, my0 - 0.03, my0, z7, z7 + 2.2, "steeldoor")
# 天井と屋根（廊下・ホール・機械室）
for x0, x1, y0, y1 in [r for rr in CORR7 for r in sub([rr], e8_hole(H7T))] + [MACH7]:
    hl.box(x0, x1, y0, y1, z7 + H7, z7 + H7 + 0.4, "ceil",
           keys6=["ceil", "ext_wall", "ext_wall", "ext_wall", "ext_wall", "ext_wall"])
    downlights(hl, [(x0, x1, y0, y1)], z7 + H7)
# 6F→7F のエスカレーターの穴のまわりの手すり
hx0, hx1, hy0, hy1 = E6_HOLE
railing(hl, (hx0, hy0), (hx1, hy0), z7)
railing(hl, (hx0, hy1), (hx1, hy1), z7)
railing(hl, (hx0, hy0), (hx0, hy1), z7)
hl.build("教室棟_7F_廊下と機械室")


# ---------- 研究棟側の L 字の曲がり角（案内図 1F 6713・2F 6712・3F 6711・4F 6679・5F 6681・6F 6704・7F 6694） ----------
# 帯 = 教室棟の端から南東へ（EV A・トイレ・ロビー）、脚 = 帯から交流棟側へ伸びる部分（階段・部屋）、
# 頭 = 教室棟の端より先（研究棟北棟の端。部屋の箱だけ）。高さは教室棟の階にそろえる
BAND = (WX0, L2 - 0.3, WY1, YS)
LEG = (LX0, WX0, WY1, LY0)
HEAD = (L2 - 0.3, HX1, WY1, HY0)
NOTCH = (LX0, WX0, LY0, YS)          # 3F 以上は外（1F・2F は玄関ホール）
# 各階の部屋：(番号札, x0, x1, y0, y1, 扉の向き)
WING_ROOMS = {
    1: [("01J25", LX0, 24.0, WY1, LY0, "+y"), ("01N30", L2, 49.0, -24.5, -16.6, "+x"),
        ("01M30", L2, 49.0, WY1, -24.5, "+x"), ("01Q32", 51.1, HX1, -7.5, HY0, "-x"),
        ("01O32", 51.1, HX1, -18.8, -7.5, "-x"), ("01M32", 51.1, HX1, WY1, -18.8, "-x")],
    2: [("Learning Support", LX0, 17.0, -24.5, -18.0, "+x"), ("Regional Coop.", LX0, 17.0, WY1, -24.5, "+x"),
        ("Health Center", 44.0, HX1, -5.0, HY0, "-x"), ("General Affairs", 44.0, HX1, -19.0, -8.9, "-x"),
        ("Faculty Support", 44.0, HX1, WY1, -20.0, "-x")],
    3: [("President Annex", LX0, 20.5, WY1, LY0, "+x"), ("President", 47.8, HX1, WY1, HY0, "-x"),
        ("", L2, 47.8, WY1, -21.4, "+y")],
    4: [("Faculty Office", LX0, 21.0, WY1, LY0, "+x"), ("Research Promotion", 44.0, HX1, WY1, HY0, "-x")],
    5: [("S.I.Tech", LX0, 21.0, WY1, LY0, "+x"), ("Asset / Facilities", 46.5, HX1, -9.6, HY0, "-x"),
        ("Conference", 46.5, HX1, WY1, -9.6, "-x")],
    6: [("S.I.Tech", LX0, 21.5, WY1, LY0, "+x"), ("Info. Innovation", L2, HX1, WY1, -17.9, "+y")],
    7: [("07M25", LX0, 23.5, WY1, LY0, "+x"), ("07M30", L2, 45.1, WY1, -25.6, "+x"),
        ("07M31", 45.1, 49.4, WY1, -25.6, "+y"), ("07M32", 49.4, HX1, WY1, -20.2, "-x"),
        ("07O32", 49.4, HX1, -20.2, -13.1, "-x"), ("07P32", 49.4, HX1, -13.1, -5.9, "-x"),
        ("07R32", 49.4, HX1, -5.9, HY0, "-x")],
}
# トイレ（階で場所が違う）
WING_WC = {
    2: [(31.0, 37.0, -13.0, -6.0)],
    3: [(35.5, 41.0, -7.1, -1.7), (35.5, 41.0, -17.9, -9.0)],
    4: [(35.5, 41.0, -7.1, -1.7), (35.5, 41.0, -17.9, -9.0)],
    5: [(35.5, 41.0, -7.1, -1.7), (35.5, 41.0, -17.9, -9.0)],
    6: [(46.0, 50.5, -12.0, -3.0), (46.0, 50.5, -17.0, -13.0)],
    7: [(44.3, 47.4, -24.0, -15.3)],
}
EVA = (33.26, 38.98, WY1, -28.45)     # EV A（2 台、扉は道路側を向く）。研究棟.blend の EV A（9F〜）の真下にそろえた（2026-10-24）：
#   かご（内側）の中心 X は (34.62, 37.62)、前の壁は Y -28.45。TRACE の点 world (-115.49, 41.7) = (34.62, -28.69) が左のかごの中（扉の 0.2m 奥）に入る
EVA_HOLE = (EVA[0], EVA[1], EVA[2], EVA[3])     # かごの筒の内側（床・天井の穴）
STAIR_L = (25.5, WX0 - 0.1, -29.8, -25.5)   # 脚の階段


def wing_rects(f):
    rs = [BAND, LEG, HEAD]
    if f <= 2:
        rs.append(NOTCH)
    return rs


wg = MB()
for f in range(1, 8):
    z = FZ[f]
    h = H7 if f == 7 else (FZ[2] - SLAB - 0.15 if f == 1 else CEIL)
    rects = wing_rects(f)
    fl = rects
    if f == 2:
        fl = [r for rr in rects for r in sub([rr], VB2)]
    if f >= 2:          # EV A のかごは階をまたぐ縦の筒。床に穴をあける
        fl = [r for rr in fl for r in sub([rr], EVA_HOLE)]
    # 床
    for x0, x1, y0, y1 in fl:
        if f == 1:
            wg.box(x0, x1, y0, y1, z - 0.02, z + 0.02, "granite")
        else:
            wg.box(x0, x1, y0, y1, z - SLAB, z + 0.02, "carpet",
                   keys6=["soffit", "carpet", "fascia", "fascia", "fascia", "fascia"])
    # 天井（1F は玄関ホールの上の吹き抜けをあける。7F は 7F→8F の穴をあける）
    cr = rects
    if f == 1:
        cr = [r for rr in rects for r in sub([rr], VB2)]
    if f == 7:
        cr = [r for rr in cr for r in sub([rr], e8_hole(H7T))]
    cr = [r for rr in cr for r in sub([rr], EVA_HOLE)]
    ztop = FZ[f + 1] - SLAB if (f + 1 in FZ and f < 7) else z + h + 0.04     # 上の階の床の裏まで詰める（上と同じ）
    for x0, x1, y0, y1 in cr:
        wg.box(x0, x1, y0, y1, z + h, max(z + h + 0.04, ztop), "ceil", keys6=["ceil", "ceil", "fascia", "fascia", "fascia", "fascia"])
    downlights(wg, cr, z + h)
    # 部屋・トイレ・EV A・階段
    for label, x0, x1, y0, y1, face in WING_ROOMS[f]:
        room_box(wg, label, x0, x1, y0, y1, z, face, h=h)
    for x0, x1, y0, y1 in WING_WC.get(f, []):
        room_box(wg, "WC", x0, x1, y0, y1, z, "-x" if x0 < 42 else "+x", h=h)
    room_box(wg, "", *STAIR_L, z, "+y", h=h, door_key="steeldoor")
    if f == 1:      # 玄関の床の白い石
        wg.box(LX0 + 1.0, LX0 + 6.0, -18.0, -10.0, 0.02, 0.025, "granite_l")
    if f == 2:      # 2F の床の、ピロティ側の端
        railing(wg, (LX0, YG1), (LX0, YS), z)
wg.build("研究棟側_曲がり角_床と部屋")

# ---------- EV A：1F〜8F をつなぐ縦の筒（2 台）。TRACE の点（world (-115.5, 41.7) = ここの (34.6, -28.7)）が真上に通る ----------
#   かごは動かさない。通り抜ける人に、各階の開いた扉が見えて階が変わったと分かるようにする。中は明るい（発光する帯）。
#   筒は 8F の天井（FZ8 + 3m）まで。その上（9F 以上）は研究棟.blend の EV A が続く
ev = MB()
ex0, ex1, ey0, ey1 = EVA
exm = (ex0 + ex1) / 2
EV_TOP = FZ8 + 3.0
EV_CARS = (34.62, 37.62)                    # 2 台の扉の中心 X（研究棟.blend の EV A のかごの中心 y=0・y=3 の真下）
EV_DW, EV_DH = 0.55, 2.2                    # 開口の半幅・高さ
EV_Z = [FZ[k] for k in range(1, 8)] + [FZ8]
t = 0.06
ev.box(ex0 - t, ex1 + t, ey0 - t, ey0 + t, 0, EV_TOP, "evwall")                # 奥
ev.box(ex0 - t, ex0 + t, ey0, ey1, 0, EV_TOP, "evwall")                        # 交流棟側
ev.box(ex1 - t, ex1 + t, ey0, ey1, 0, EV_TOP, "evwall")                        # 研究棟側
ev.box(exm - t, exm + t, ey0, ey1, 0, EV_TOP, "evwall")                        # 2 台の仕切り
# 手前（道路側）の壁：階ごとに 2 つの開口。開口の上と、階と階の間は壁
ev.box(ex0 - t, ex1 + t, ey1 - t, ey1 + t, 0, 0.02, "evwall")
for zk in EV_Z:
    ev.box(ex0 - t, ex1 + t, ey1 - t, ey1 + t, zk + EV_DH, zk + EV_DH + 0.02, "evwall")
for za, zb in zip(EV_Z, EV_Z[1:] + [EV_TOP]):
    ev.box(ex0 - t, ex1 + t, ey1 - t, ey1 + t, za + EV_DH, zb, "evwall")        # 開口の上から次の階の床まで
    px = [ex0 - t] + [x for xc in EV_CARS for x in (xc - EV_DW, xc + EV_DW)] + [ex1 + t]
    for xa, xb in ((px[0], px[1]), (px[2], px[3]), (px[4], px[5])):
        ev.box(xa, xb, ey1 - t, ey1 + t, za, za + EV_DH, "evwall")              # 開口の脇
# 開いた扉（左右に引き込んだ 2 枚）・枠・階の札
for zk, name in zip(EV_Z, ("1F", "2F", "3F", "4F", "5F", "6F", "7F", "8F")):
    for xc in EV_CARS:
        for sgn in (-1, 1):
            xa, xb = sorted((xc + sgn * EV_DW, xc + sgn * (EV_DW + 0.5)))
            ev.box(xa, xb, ey1 + t, ey1 + t + 0.03, zk, zk + EV_DH - 0.05, "steeldoor")
        ev.box(xc - EV_DW - 0.05, xc + EV_DW + 0.05, ey1 + t, ey1 + t + 0.02, zk + EV_DH - 0.05, zk + EV_DH + 0.1, "trim")
        ev.box(xc - EV_DW, xc + EV_DW, ey1 - t - 0.01, ey1 + t + 0.01, zk - 0.02, zk + 0.02, "trim")   # 敷居
    add_text(ev, name, (exm, ey1 + t + 0.03, zk + 1.55), (0, 1), 0.28)
    add_text(ev, "A", (exm, ey1 + t + 0.03, zk + 2.5), (0, 1), 0.3)
# 発光する帯（奥の壁・仕切り・両端の壁の内側）。筒の全高
for xc in EV_CARS:
    for dx in (-0.9, 0.9):
        ev.box(xc + dx - 0.07, xc + dx + 0.07, ey0 + t, ey0 + t + 0.02, 0.2, EV_TOP - 0.2, "evglow")
for xw, side in ((ex0 + t, 1), (exm - t, -1), (exm + t, 1), (ex1 - t, -1)):
    ev.box(xw, xw + side * 0.02, (ey0 + ey1) / 2 - 0.07, (ey0 + ey1) / 2 + 0.07, 0.2, EV_TOP - 0.2, "evglow")
ev.build("EV_A_かごの筒")

# 外壁（窓の帯）。p0→p1 の線、out = 外向き（+1/-1 で X か Y）、z0〜z1 の高さ
ow = MB()


def wing_wall(p0, p1, z0, z1, out, windows=True, key="ext_wall"):
    (xa, ya), (xb, yb) = p0, p1
    t = 0.3
    horiz = abs(ya - yb) < 1e-6
    levels = [FZ[k] for k in range(1, 8)] + [FZ8]
    for i in range(7):
        za, zb = max(levels[i], z0), min(levels[i + 1], z1)
        if zb - za < 0.05:
            continue
        w0, w1 = za + 0.9, min(za + 2.8, zb - 0.3)
        if horiz:
            yo = ya + out * t
            if windows and w1 - w0 > 0.5:
                ow.box(xa, xb, ya, yo, za, w0, key)
                ow.box(xa, xb, ya + out * 0.1, ya + out * 0.12, w0, w1, "ext_glass")
                ow.box(xa, xb, ya, yo, w1, zb, key)
                n = max(1, round(abs(xb - xa) / 1.45))
                for i in range(n + 1):
                    x = xa + (xb - xa) * i / n
                    ow.box(x - 0.03, x + 0.03, ya, ya + out * 0.1, w0, w1, "ext_frame")
            else:
                ow.box(xa, xb, ya, yo, za, zb, key)
        else:
            xo = xa + out * t
            if windows and w1 - w0 > 0.5:
                ow.box(xa, xo, ya, yb, za, w0, key)
                ow.box(xa + out * 0.1, xa + out * 0.12, ya, yb, w0, w1, "ext_glass")
                ow.box(xa, xo, ya, yb, w1, zb, key)
                n = max(1, round(abs(yb - ya) / 1.45))
                for i in range(n + 1):
                    y = ya + (yb - ya) * i / n
                    ow.box(xa, xa + out * 0.1, y - 0.03, y + 0.03, w0, w1, "ext_frame")
            else:
                ow.box(xa, xo, ya, yb, za, zb, key)


ZL = H7T + 0.4                         # 脚の屋上
# 頭：研究棟側（+X）・道路側（+Y）。南東の切り口は研究棟.blend の北棟とつながる（白い壁で閉じる）
wing_wall((HX1, WY1 - 0.3), (HX1, HY0 + 0.3), 0, FZ8, +1)
wing_wall((L2, HY0), (HX1 + 0.3, HY0), 0, FZ8, +1)
ow.box(L2 - 0.3, HX1 + 0.3, WY1 - 0.32, WY1 - 0.3, 0, FZ8, "ext_wall")
# 帯の南東（EV A の外）・帯の交流棟側（3F 以上は外）
wing_wall((WX0 - 0.3, WY1), (L2 - 0.3, WY1), 0, FZ8, -1)
wing_wall((WX0, LY0), (WX0, YS - 0.3), FZ[3], FZ8, -1)
# 脚の南東・脚の道路側（3F 以上）・脚の交流棟側（波形の壁、写真 6715）
for f in range(1, 8):
    za, zb = FZ[f], (FZ[f + 1] if f < 7 else ZL)
    if f == 6:      # 6F の渡り廊下の口をあける
        wing_wall((LX0 - 0.3, WY1), (BRX[0], WY1), za, zb, -1)
        wing_wall((BRX[1], WY1), (WX0, WY1), za, zb, -1)
        ow.box(BRX[0], BRX[1], WY1 - 0.3, WY1, za + 2.8, zb, "ext_wall")
    else:
        wing_wall((LX0 - 0.3, WY1), (WX0, WY1), za, zb, -1)
wing_wall((LX0, LY0), (WX0 - 0.3, LY0), FZ[3], ZL, +1)
ow.box(LX0 - 0.3, LX0, WY1 - 0.3, LY0 + 0.3, 0, ZL, "rib")
zz = 0.3
while zz < ZL:
    ow.box(LX0 - 0.42, LX0 - 0.3, WY1 - 0.3, LY0 + 0.3, zz, zz + 0.25, "rib")
    zz += 0.6
# 1F・2F の脚の交流棟側の手前（玄関：ガラスと扉、2F：窓）と、玄関の庇（写真 6715）
# 研究棟の入口（案内図 6730 のエントランスホール＝ここの玄関ホール）：黒い枠のガラスの両開き扉（2026-10-24）。
#   扉の所（Y -15.5〜-12.5）だけガラスの壁をあけ、扉の上はガラス。前は壁の面に枠の板が貼ってあるだけで、扉がなかった
DOOR_Y = (-15.5, -12.5)
glass_wall(ow, (LX0, YG1), (LX0, DOOR_Y[1]), 0, FZ[2] - SLAB)
glass_wall(ow, (LX0, DOOR_Y[0]), (LX0, LY0 + 0.3), 0, FZ[2] - SLAB)
DH_E, DC = 2.6, sum(DOOR_Y) / 2
ow.box(LX0 - 0.01, LX0 + 0.01, DOOR_Y[0], DOOR_Y[1], DH_E, FZ[2] - SLAB, "ext_glass")           # 扉の上のガラス
ow.box(LX0 - 0.07, LX0 + 0.07, DOOR_Y[0], DOOR_Y[1], DH_E - 0.1, DH_E, "dark")                  # 扉の上の枠
for ya, yb in ((DOOR_Y[0], DOOR_Y[0] + 0.1), (DOOR_Y[1] - 0.1, DOOR_Y[1]), (DC - 0.03, DC + 0.03)):
    ow.box(LX0 - 0.07, LX0 + 0.07, ya, yb, 0, DH_E, "dark")                                       # 両側の柱と真ん中の召し合わせ
for la, lb in ((DOOR_Y[0] + 0.1, DC - 0.03), (DC + 0.03, DOOR_Y[1] - 0.1)):                      # 扉 2 枚：下と上の枠、ガラス
    ow.box(LX0 - 0.05, LX0 + 0.05, la, lb, 0, 0.2, "dark")
    ow.box(LX0 - 0.05, LX0 + 0.05, la, lb, DH_E - 0.3, DH_E - 0.1, "dark")
    ow.box(LX0 - 0.005, LX0 + 0.005, la, lb, 0.2, DH_E - 0.3, "dglass")
for yh in (DC - 0.12, DC + 0.12):                                                                 # 取っ手
    ow.box(LX0 - 0.1, LX0 - 0.06, yh - 0.015, yh + 0.015, 0.85, 1.35, "steel")
ow.box(LX0 - 3.8, LX0, -18.8, -10.2, 4.3, 4.7, "dark")
wing_wall((LX0, LY0 + 0.3), (LX0, YS - 0.3), FZ[2], FZ[3], -1)
# 3F の脚の手前の屋根（外。歩けない）
ow.box(LX0, WX0, LY0, YS, FZ[3] - SLAB, FZ[3] - 0.1, "roofgray",
       keys6=["ceil", "roofgray", "ext_wall", "ext_wall", "ext_wall", "ext_wall"])
# 屋上：脚は 7F の上、帯と頭は 8F の床（その上は研究棟.blend）
ow.box(LX0 - 0.3, WX0, WY1 - 0.3, LY0 + 0.3, H7T, ZL, "roofgray",
       keys6=["ceil", "roofgray", "ext_wall", "ext_wall", "ext_wall", "ext_wall"])
ow.box(WX0 - 0.3, WX0, WY1 - 0.3, LY0, ZL, FZ8, "ext_wall")      # 脚の屋上と 8F の床の段差
for r in sub(sub([(WX0 - 0.3, HX1 + 0.3, WY1 - 0.3, YS - 0.3)], e8_hole(FZ8 - SLAB)), EVA_HOLE) +         [(L2 - 0.3, HX1 + 0.3, YS - 0.3, HY0 + 0.3)]:
    ow.box(*r, FZ8 - SLAB, FZ8 + 0.02, "carpet",
           keys6=["ceil", "carpet", "ext_wall", "ext_wall", "ext_wall", "ext_wall"])
ow.build("研究棟側_曲がり角_外壁")

# 8F：エスカレーターの着き場。8F の図書館（壁・家具）は研究棟.blend（scripts/build_kenkyuto.py）にある
e8 = MB()
hx0, hx1, hy0, hy1 = e8_hole(FZ8 - SLAB)
railing(e8, (hx0, hy0), (hx0, YS - 0.3), FZ8)
railing(e8, (hx1, hy0), (hx1, YS - 0.3), FZ8)
# 教室棟の 7F の屋根から出る所の箱（ガラスの側面と屋根）
lx0, lx1 = hx0, hx1
ly1 = e8_hole(H7T)[3]
glass_wall(e8, (lx0, YS), (lx0, ly1), H7T + 0.4, FZ8 + 2.6 - H7T - 0.4)
glass_wall(e8, (lx1, YS), (lx1, ly1), H7T + 0.4, FZ8 + 2.6 - H7T - 0.4)
glass_wall(e8, (lx0, ly1), (lx1, ly1), H7T + 0.4, FZ8 + 2.6 - H7T - 0.4)
e8.box(lx0 - 0.1, lx1 + 0.1, YS - 0.3, ly1 + 0.1, FZ8 + 2.6, FZ8 + 2.9, "roofgray")
e8.build("研究棟側_8Fのエスカレーターの着き場")

# 6F の渡り廊下（写真 6706・6707：両側ガラス・銀の手すり・グレーの床）
br = MB()
z6 = FZ[6]
bx0, bx1 = BRX
by0, by1 = BRY, WY1 - 0.3
br.box(bx0, bx1, by0, by1, z6 - 0.6, z6 + 0.02, "fascia",
       keys6=["soffit", "fascia", "fascia", "fascia", "fascia", "fascia"])
br.box(bx0 + 0.05, bx1 - 0.05, by0, by1, z6 + 0.02, z6 + 0.03, "roofgray")
for xs, out in ((bx0, -1), (bx1, 1)):
    br.box(xs - 0.01, xs + 0.01, by0, by1, z6 + 0.1, z6 + 2.8, "ext_glass")
    n = round((by1 - by0) / 1.8)
    for i in range(n + 1):
        y = by0 + (by1 - by0) * i / n
        br.box(xs - 0.05, xs + 0.05, y - 0.04, y + 0.04, z6, z6 + 2.9, "ext_frame")
    br.box(xs - 0.05, xs + 0.05, by0, by1, z6, z6 + 0.15, "steel")
    br.box(xs - out * 0.12, xs - out * 0.06, by0, by1, z6 + 0.85, z6 + 0.9, "steel")   # 手すり
br.box(bx0 - 0.1, bx1 + 0.1, by0, by1, z6 + 2.9, z6 + 3.3, "ext_wall",
       keys6=["ceil", "roofgray", "ext_wall", "ext_wall", "ext_wall", "ext_wall"])
downlights(br, [(bx0, bx1, by0, by1)], z6 + 2.9)
# 南棟側の端：ガラスの両開き扉（その先は研究棟.blend のゲートの東の壁）
door(br, bx0 + 0.2, bx1 - 0.2, by0 + 0.2, z6)
br.box(bx0, bx1, by0, by0 + 0.1, z6, z6 + 2.9, "ext_wall")
# 教室棟側の口（曲がり角の帯の南東の壁）：ガラスの両開き扉（2026-10-24。口に扉が無かった）
door(br, bx0 + 0.2, bx1 - 0.2, WY1 - 0.15, z6)
br.build("研究棟側_6Fの渡り廊下")

# ---------- 外壁：南東面は写真 6716 から。道路側と妻壁は「仮の外壁」のまま ----------
ex = MB()
ZTOP = FZ[7]
gy = -W2 + 0.15
# 南東（-Y）：1F はピロティの奥のガラス、2F の床の高さに帯、その上はカーテンウォールと横のルーバー
glass_wall(ex, (-L2 + 0.3, YG1), (LX0, YG1), 0, FZ[2] - SLAB)
ex.box(-L2 + 0.3, LX0, YG1 - 0.06, YG1 + 0.06, 2.95, 3.05, "ext_frame")
ex.box(-L2, LX0, -W2 - 2.0, YG1, -0.03, 0.0, "paving")
ZB = FZ[2] + 1.4                         # 2F の帯の上の端
ex.box(-L2, LX0, -W2, -W2 + 0.3, FZ[2] - SLAB - 0.3, ZB, "ext_wall")
for xa, xb, za in ((-L2, LX0, ZB), (LX0, WX0 - 0.3, FZ[3])):
    ex.box(xa, xb, gy - 0.01, gy + 0.01, za, ZTOP, "ext_glass")
    n = max(1, round((xb - xa) / 1.45))
    for i in range(n + 1):
        x = xa + (xb - xa) * i / n
        ex.box(x - 0.04, x + 0.04, -W2, gy, za, ZTOP, "ext_frame")
    for k in range(3, 8):
        if FZ[k] > za:
            ex.box(xa, xb, -W2, gy, FZ[k] - SLAB - 0.05, FZ[k] + 0.05, "ext_frame")
    zz = za + 0.6
    while zz < ZTOP - 0.3:
        ex.box(xa, xb, -W2 - 0.55, -W2, zz, zz + 0.05, "louver")
        zz += 1.25
# 道路側（+Y）：各階の腰壁・窓・上の壁
for f in range(1, 8):
    z = FZ[f]
    zt = FZ[f + 1] if f < 7 else z + H7 + 0.4
    w0, w1 = (z + 0.6, z + 4.5) if f == 1 else (z + 0.9, z + 2.8)
    spans = [(-L2, L2)] if f < 7 else [(-L2, G7X0), (G7X1, L2)]     # 7F は庭園の所は壁なし
    for xa, xb in spans:
        ex.box(xa, xb, YN, W2, z, w0, "ext_wall")
        ex.box(xa, xb, YN + 0.1, YN + 0.12, w0, w1, "ext_glass")
        ex.box(xa, xb, YN, W2, w1, zt, "ext_wall")
        for x in [-L2 + U / 2 * i for i in range(int(4 * L2 / U) + 2)]:
            if xa <= x <= xb:
                ex.box(x - 0.03, x + 0.03, YN, YN + 0.1, w0, w1, "ext_frame")
# 妻壁（±X）。研究棟側は道路側の階段室の所だけ（廊下から南東は曲がり角の頭へつながる）。
# 交流棟側は 1F のガラスまで、渡り廊下のガラス扉（2F・4F・6F）
z7t = FZ[7] + H7 + 0.4
# 1F：交流棟側の入口（ユーザーの指摘 2026-10-21：軌跡が通るのに扉がなかった）。TRACE の原点（Y 0.2）の所に
# ガラスの両開き扉をあける。交流棟 6648 の入口と向かい合う。黒い庇つき
DY = (-1.3, 1.7)
ex.box(-L2, -L2 + 0.3, YG1, DY[0], 0, FZ[2], "ext_wall")
ex.box(-L2, -L2 + 0.3, DY[1], W2, 0, FZ[2], "ext_wall")
ex.box(-L2, -L2 + 0.3, DY[0], DY[1], 3.0, FZ[2], "ext_wall")
ex.box(-L2 + 0.14, -L2 + 0.16, DY[0], DY[1], 0, 2.9, "dglass")
for yy in (DY[0] + 0.05, sum(DY) / 2 - 0.03, sum(DY) / 2 + 0.03, DY[1] - 0.05):
    ex.box(-L2 + 0.1, -L2 + 0.2, yy - 0.04, yy + 0.04, 0, 2.9, "ext_frame")
ex.box(-L2 + 0.1, -L2 + 0.2, DY[0], DY[1], 2.9, 3.0, "ext_frame")
for z in (1.0,):                                            # 押し板の横桟
    ex.box(-L2 + 0.1, -L2 + 0.2, DY[0], DY[1], z, z + 0.05, "ext_frame")
ex.box(-L2 - 1.6, -L2, DY[0] - 0.8, DY[1] + 0.8, 3.1, 3.3, "dark")      # 庇
ex.box(-L2 - 0.05, -L2 + 0.1, DY[0] - 0.8, DY[0] - 0.7, 0, 3.1, "dark")
ex.box(-L2 - 0.05, -L2 + 0.1, DY[1] + 0.7, DY[1] + 0.8, 0, 3.1, "dark")
# 交流棟側の妻壁：2F・4F・6F は渡り廊下の口をあける（交流棟.blend の渡り廊下がここにつく。2026-10-12 ユーザーの説明）
KD = (YCOR, YCOR + 2.7)         # 口の Y の範囲（廊下の幅のうち 2.7m。交流棟のスクリプトの KYO_COR と同じ）
KF = (2, 4, 6)                  # 渡り廊下のある階（写真 6758）
zs = [FZ[2]]
for f in KF:
    zs += [FZ[f], FZ[f] + 2.6]
zs.append(z7t)
zs = sorted(set(zs))
for za, zb in zip(zs[:-1], zs[1:]):
    if any(abs(za - FZ[f]) < 1e-6 for f in KF):     # 口の高さの帯：口の左右だけ壁
        ex.box(-L2, -L2 + 0.3, -W2, KD[0], za, zb, "ext_wall")
        ex.box(-L2, -L2 + 0.3, KD[1], W2, za, zb, "ext_wall")
    else:
        ex.box(-L2, -L2 + 0.3, -W2, W2, za, zb, "ext_wall")
ex.box(L2 - 0.3, L2, YCW, W2, 0, z7t, "ext_wall")
for f in KF:
    z = FZ[f]
    ex.box(-L2 + 0.14, -L2 + 0.16, KD[0], KD[1], z, z + 2.5, "dglass")
    for yy in (KD[0] + 0.04, sum(KD) / 2, KD[1] - 0.04):
        ex.box(-L2 + 0.1, -L2 + 0.2, yy - 0.04, yy + 0.04, z, z + 2.5, "ext_frame")
    ex.box(-L2 + 0.1, -L2 + 0.2, KD[0], KD[1], z + 2.5, z + 2.6, "ext_frame")
# 7F：交流棟寄りの廊下の南東のガラス。吹き抜けの屋根の縁は低い立ち上がり（曲がり角の帯まで）
ex.box(-L2 + 0.3, C7X, gy - 0.01, gy + 0.01, FZ[7], z7t - 0.4, "ext_glass")
ex.box(-L2 + 0.3, C7X, -W2, gy, z7t - 0.4, z7t, "ext_wall")
ex.box(C7X, WX0, -W2, gy + 0.2, FZ[7], FZ[7] + 1.1, "ext_wall")
ex.build("教室棟_外壁（南東は写真から・道路側と妻壁は仮）")

total = sum(len(o.data.vertices) for o in icol.objects if o.type == 'MESH')
print("教室棟 内装 DONE verts", total)
