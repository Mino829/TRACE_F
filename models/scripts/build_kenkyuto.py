# 研究棟：外観（フィンの外壁・ゲート・大階段・光庭）と、1F〜14F の内装（8F の図書館だけ作らない）
# buildings/研究棟.blend を開いて exec(open(path, encoding="utf-8").read()) で実行するか、
#   blender -b buildings/研究棟.blend --python scripts/build_kenkyuto.py -- --save
# で実行する。何度実行しても、このスクリプトが作ったもの（"研究棟_gen" 付き）を消して作り直すだけ。
#
# 座標は建物ファイルのルール（原点 = 足元の中心・地面 Z=0）。
#   -Y: 広場側（南棟。大階段とゲート）   +Y: 道路側（北棟）
#   -X: 教室棟側（EV A。1〜8F の端は 教室棟.blend の「曲がり角」）   +X: 運河側の端（EV B）
#   南棟（Y -22.9〜-4.5）と北棟（Y 4.6〜22.8）の間は光庭。EV A・EV B の箱が橋のように渡る
#   ゲート：X -22.5〜7.3（西の端 = 曲がり角の脚、東の端 = 教室棟.blend の 6F の渡り廊下の先）、床 6.0（2F と同じ）〜天井 34.4
# 写真：image/研究棟-20261012T084110Z-1-001/研究棟/jpg/（1F 案内図 6730、7F 6731、6F 6733、外観 6720/6721）
#       image/研究棟2回目-20261012T092852Z-1-001/研究棟2回目/jpg/（9F 案内図 6747、3F 6752、夜の外観 6753/6756/6757）
# 間取りは案内図を箱の大きさに合わせて置いたもの（実寸ではない）。部屋番号 = 階 + 列（A〜R、+X から）+ 行（25〜32、-Y から）
#   1F：案内図 6730 のとおり（-X 端の玄関ホール・EV A は教室棟.blend）
#   9F〜14F：9F の案内図 6747 を全部の階に使う（ユーザーの指示）。10〜14F は 9F の形の「リンク複製」
#   2F〜8F（2026-10-24）：3F（案内図 6752）・6F（6733）・7F（6731）は +X 側を案内図に合わせ、2・4・5・8F は資料がなく 12F と同じ形（ユーザーの指示）。
#     X < KX は教室棟.blend の曲がり角なので切ってある。8F の図書館は重くなるので作らない（ユーザーの指示）
import bpy, bmesh, math, sys

COL = "02_研究棟"
IN_COL = "02_研究棟_内装"
REF_COL = "参考_寸法の箱"
GEN = "研究棟_gen"

# ---------- 外形 ----------
SX0, SX1, SY0, SY1 = -32.5, 40.6, -22.9, -4.5     # 南棟（広場側）
NX0, NX1, NY0, NY1 = -54.1, 46.0, 4.6, 22.8       # 北棟（道路側）
NY0W = 7.25                                       # 北棟の -X の端（X < XB）は教室棟の曲がり角の「頭」に合わせて細い
XB = -42.35                                       # 教室棟の南東の面（曲がり角の帯の西の端）
KX = -22.4                                        # 1〜8F は、これより -X が教室棟.blend（曲がり角）
GX0, GX1 = -22.5, 7.3                             # ゲート
DECK = 6.0                                        # ゲートの床（大階段の上）。教室棟 2F・研究棟 2F と同じ高さ（2026-10-24 ユーザーの指示。前は 8.1）
GATE_TOP = 34.4                                   # ゲートの天井
LEG_TOP = 34.8                                    # 教室棟.blend の脚の屋上（その上から研究棟）
FZ = {1: 0.0, 2: 6.0, 3: 11.0, 4: 16.0, 5: 21.0, 6: 26.0, 7: 31.0, 8: 36.0}   # 1〜8F は教室棟と同じ
FH = 3.9
for _f in range(9, 15):
    FZ[_f] = 40.5 + FH * (_f - 9)                 # 9F = 40.5 … 14F = 60.0
ROOF = FZ[14] + FH                                # 63.9
PARA = 64.6                                       # パラペットの上（北棟の箱の高さ）
SLAB = 0.35
# 光庭を渡る箱
EVB = (12.0, 17.4)          # EV B と階段（X）。その +X の X 17.4〜19.8 が南北をつなぐ廊下
EVB_COR = (17.4, 19.8)
EVB_CORE = (12.0, 19.8)
EVA = (-25.2, -21.1)        # EV A と階段（X）。その -X の X -28.7〜-25.2 が廊下
EVA_COR = (-28.7, -25.2)
EVA_CORE = (-28.7, -21.1)
ESC8 = (-41.8, -38.1, 3.3, 6.4)   # 教室棟 7F→8F のエスカレーターの穴（教室棟.blend）
INTERIOR_Z = {FZ[f] for f in range(1, 15)}   # 内装を作る階（窓の奥を暗くしない）。2〜8F も作った

SAVE = "--save" in sys.argv


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


# ほかの建物と同じく「色だけ」のマテリアル（Unity 向け）
MAT = dict(
    # 外観（写真 6720・6721・6753）
    fin=mat("研究棟_フィン", (0.80, 0.80, 0.78), 0.55),
    rib=mat("研究棟_フィンの横筋", (0.58, 0.59, 0.58), 0.6),
    panel=mat("研究棟_外壁パネル", (0.74, 0.75, 0.74), 0.55),
    panel_d=mat("研究棟_外壁パネル_濃い", (0.56, 0.57, 0.57), 0.55),
    ledge=mat("研究棟_窓の庇", (0.88, 0.88, 0.86), 0.5),
    glass=mat("研究棟_窓ガラス", (0.22, 0.29, 0.33), 0.05, alpha=0.55),
    frame=mat("研究棟_サッシ", (0.82, 0.83, 0.82), 0.4, 0.5),
    backdrop=mat("研究棟_窓の奥（作っていない階）", (0.07, 0.07, 0.08), 0.9),
    blind=mat("研究棟_ブラインド", (0.85, 0.85, 0.83), 0.7, alpha=0.7),
    court=mat("研究棟_光庭の壁", (0.68, 0.68, 0.66), 0.6),
    grating=mat("研究棟_光庭の点検通路", (0.20, 0.21, 0.22), 0.6, 0.6),
    concrete=mat("研究棟_ゲートの壁", (0.66, 0.65, 0.62), 0.8),
    soffit=mat("研究棟_ゲートの天井", (0.82, 0.82, 0.80), 0.7),
    sign=mat("研究棟_ゲートの文字", (0.10, 0.10, 0.10), 0.5),
    emblem=mat("研究棟_校章", (0.15, 0.35, 0.18), 0.5),
    roof=mat("研究棟_屋上", (0.40, 0.40, 0.39), 0.9),
    louver=mat("研究棟_機械室のルーバー", (0.70, 0.70, 0.68), 0.5, 0.4),
    gglass=mat("研究棟_1Fのガラス", (0.30, 0.37, 0.40), 0.05, alpha=0.45),
    paving=mat("研究棟_ゲートの床", (0.60, 0.59, 0.56), 0.8),
    step=mat("研究棟_大階段の段", (0.50, 0.48, 0.45), 0.8),
    stone=mat("研究棟_大階段の石", (0.62, 0.61, 0.58), 0.7),
    hedge=mat("研究棟_植え込み", (0.12, 0.25, 0.08), 0.9),
    turf=mat("研究棟_人工芝", (0.10, 0.36, 0.08), 0.85),
    turf_text=mat("研究棟_人工芝のSITの文字", (0.92, 0.92, 0.90), 0.7),
    flower_r=mat("研究棟_花壇_赤", (0.65, 0.07, 0.05), 0.8),
    flower_w=mat("研究棟_花壇_白", (0.88, 0.87, 0.85), 0.8),
    flower_g=mat("研究棟_花壇_緑", (0.18, 0.32, 0.12), 0.9),
    steel=mat("研究棟_手すり_銀", (0.72, 0.73, 0.74), 0.25, 1.0),
    # 内装（1F：写真 6723〜6729、9F：6745〜6751）
    wall=mat("研究棟内装_白い壁", (0.82, 0.81, 0.78), 0.6),
    base=mat("研究棟内装_幅木", (0.48, 0.49, 0.49), 0.5),
    floor1=mat("研究棟内装_1Fの床", (0.47, 0.46, 0.43), 0.12),
    ceil_b=mat("研究棟内装_むき出しの天井", (0.03, 0.03, 0.035), 0.9),
    tray=mat("研究棟内装_ケーブルラック", (0.55, 0.56, 0.57), 0.4, 0.8),
    tube=mat("研究棟内装_蛍光灯", (1.0, 1.0, 0.97), 0.3),
    carpet=mat("研究棟内装_タイルカーペット", (0.20, 0.20, 0.21), 0.9),
    carpet2=mat("研究棟内装_タイルカーペット_薄い", (0.30, 0.30, 0.31), 0.9),
    ceil=mat("研究棟内装_天井", (0.86, 0.85, 0.83), 0.9),
    lab_ceil=mat("研究棟内装_研究室の天井", (0.16, 0.16, 0.17), 0.8),
    lab_floor=mat("研究棟内装_研究室の床", (0.62, 0.62, 0.60), 0.6),
    door=mat("研究棟内装_扉の枠", (0.86, 0.86, 0.84), 0.4),
    dglass=mat("研究棟内装_扉のガラス", (0.55, 0.62, 0.64), 0.05, alpha=0.3),
    strip=mat("研究棟内装_黒い札", (0.03, 0.03, 0.035), 0.4),
    signtext=mat("研究棟内装_札の文字", (0.95, 0.95, 0.95), 0.4),
    ev_b=mat("研究棟内装_EVの黒い壁", (0.04, 0.04, 0.045), 0.4),
    ev_w=mat("研究棟内装_EVの扉", (0.88, 0.87, 0.85), 0.35),
    steeldoor=mat("研究棟内装_鉄扉", (0.62, 0.62, 0.62), 0.4, 0.4),
    shaft=mat("研究棟内装_シャフト・機械室", (0.55, 0.55, 0.54), 0.7),
    ev_in=mat("研究棟内装_EVの中の壁（明るい）", (0.93, 0.93, 0.91), 0.45),
    ev_lamp=mat("研究棟内装_EVの照明（発光）", (1.0, 0.97, 0.88), 0.4),
    ev_call=mat("研究棟内装_EV扉の上の表示（発光）", (0.35, 0.85, 1.0), 0.4),
)
# 発光（glTF にも KHR_materials_emissive_strength で出る）。ライトは書き出しで失われるので、明るさは発光マテリアルでつける
for _k, _s in (("ev_lamp", 4.0), ("ev_call", 3.0)):
    _b = bsdf(MAT[_k])
    _b.inputs["Emission Color"].default_value = (*MAT[_k].diffuse_color[:3], 1)
    _b.inputs["Emission Strength"].default_value = _s

# ---------- 準備 ----------
scene = bpy.context.scene
if bpy.context.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')


def get_col(name, parent=None, hide=False):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        (parent or scene.collection).children.link(c)
    if hide:
        c.hide_viewport = True
        c.hide_render = True
    return c


col = get_col(COL)
icol = get_col(IN_COL)
rcol = get_col(REF_COL, hide=True)
for o in list(bpy.data.objects):
    if o.get(GEN):
        me = o.data
        bpy.data.objects.remove(o)
        if me is not None and me.users == 0:
            bpy.data.meshes.remove(me)
# 寸法の箱は参考のコレクションへ（交流棟と同じ）
for n in ("研究棟_北棟_箱", "研究棟_南棟_箱"):
    o = bpy.data.objects.get(n)
    if o and o.name not in rcol.objects:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        rcol.objects.link(o)
# 旧ブロックアウトは重なるので、ビューポートでもレンダーでも隠す（消さない）
old = bpy.data.collections.get("旧ブロックアウト（参考）")
if old:
    old.hide_viewport = True
    old.hide_render = True


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

    def box(self, x0, x1, y0, y1, z0, z1, key, skip=()):
        # 面の順: 下, 上, -y, +x, +y, -x
        x0, x1 = min(x0, x1), max(x0, x1)
        y0, y1 = min(y0, y1), max(y0, y1)
        z0, z1 = min(z0, z1), max(z0, z1)
        if x1 - x0 < 1e-4 or y1 - y0 < 1e-4 or z1 - z0 < 1e-4:
            return
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
                self.face(f, key)

    def hquad(self, x0, x1, y0, y1, z, key):
        """上向きの水平な面"""
        self.face([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], key)

    def cyl(self, cx, cy, r, z0, z1, key, seg=12, cap=False):
        pts = [(cx + r * math.cos(2 * math.pi * i / seg), cy + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
        for i in range(seg):
            a, b = pts[i], pts[(i + 1) % seg]
            self.face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], key)
        if cap:
            self.face([(x, y, z1) for x, y in pts], key)

    def prism_x(self, prof, x0, x1, key):
        """YZ 平面の多角形 prof を X 方向に押し出す"""
        n = len(prof)
        self.face([(x0, y, z) for y, z in prof][::-1], key)
        self.face([(x1, y, z) for y, z in prof], key)
        for i in range(n):
            (ya, za), (yb, zb) = prof[i], prof[(i + 1) % n]
            self.face([(x0, ya, za), (x0, yb, zb), (x1, yb, zb), (x1, ya, za)], key)

    def build(self, name, collection, loc=(0, 0, 0)):
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
        o.location = loc
        o[GEN] = True
        collection.objects.link(o)
        return o


# 文字（番号）をメッシュにして MB に足す（標準フォントには日本語がないので英数字）
_font_cache = {}


def text_mesh(s):
    if s in _font_cache:
        return _font_cache[s]
    cu = bpy.data.curves.new("_tmp_txt", 'FONT')
    cu.body = s
    cu.size = 1.0
    cu.resolution_u = 1
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
    """center に、normal（(nx, ny)）の向きに向いた文字を置く"""
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


def sub(rects, hole):
    """長方形のリスト rects（(x0,x1,y0,y1)）から hole を引く"""
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


def sub_u(segs, holes):
    """1 次元の区間 segs から holes を引く"""
    for h0, h1 in holes:
        out = []
        for a, b in segs:
            if h1 <= a or h0 >= b:
                out.append((a, b))
                continue
            if a < h0:
                out.append((a, h0))
            if h1 < b:
                out.append((h1, b))
        segs = out
    return segs


# ======================================================================
# 外観
# ======================================================================
# 外壁の面を (ax, line, out) で表す。ax='x' なら Y = line の面（X 方向に伸びる）、ax='y' なら X = line の面。
# out = 外向き（+1/-1）。面の上の座標 u（ax の方向）・d（外向きの出。外壁の面 = 0）・z
def P(ax, line, out, u, d, z):
    return (u, line + out * d, z) if ax == 'x' else (line + out * d, u, z)


def B(mb, ax, line, out, u0, u1, d0, d1, z0, z1, key):
    if ax == 'x':
        mb.box(u0, u1, line + out * d0, line + out * d1, z0, z1, key)
    else:
        mb.box(line + out * d0, line + out * d1, u0, u1, z0, z1, key)


def Q(mb, ax, line, out, u0, u1, d, z0, z1, key):
    """外を向いた縦の面 1 枚"""
    pts = [P(ax, line, out, u0, d, z0), P(ax, line, out, u1, d, z0),
           P(ax, line, out, u1, d, z1), P(ax, line, out, u0, d, z1)]
    mb.face(pts, key)


LEVELS = [FZ[f] for f in range(1, 15)] + [ROOF]


def bands(z0, z1):
    """z0〜z1 を階ごとに切った (za, zb) のリスト"""
    zs = sorted({z0, z1} | {z for z in LEVELS if z0 < z < z1})
    return list(zip(zs[:-1], zs[1:]))


def window_row(mb, f, u0, u1, wa, wb, wins, glass="glass", ledge=True):
    """u0〜u1 の壁に、高さ wa〜wb の窓（wins = [(u の中心, 幅)]）をあける。f = (ax, line, out)"""
    cur = u0
    for c, w in sorted(wins):
        a, b = max(u0, c - w / 2), min(u1, c + w / 2)
        if b - a < 0.2:
            continue
        B(mb, *f, cur, a, -0.3, 0, wa, wb, "panel")
        Q(mb, *f, a, b, -0.15, wa, wb, glass)
        B(mb, *f, (a + b) / 2 - 0.03, (a + b) / 2 + 0.03, -0.15, -0.08, wa, wb, "frame")
        if ledge:
            B(mb, *f, a - 0.1, b + 0.1, -0.15, 0.35, wa - 0.12, wa, "ledge")
        cur = b
    B(mb, *f, cur, u1, -0.3, 0, wa, wb, "panel")


def facade(mb, f, u0, u1, z0, z1, wins_fn, rows_fn=None, top_key="panel"):
    """外壁の面 1 枚分。階ごとに窓の段を作る。wins_fn(za, zb) → [(u, 幅)]、
    rows_fn(za, zb) → [(窓の下, 窓の上)]（階の中で何段か）"""
    for za, zb in bands(z0, z1):
        h = zb - za
        if za >= ROOF - 0.01 or h < 2.4:          # パラペット・梁の帯は壁だけ
            B(mb, *f, u0, u1, -0.3, 0, za, zb, top_key)
            continue
        rows = rows_fn(za, zb) if rows_fn else [(za + 1.0, zb - 0.6)]
        cur = za
        for wa, wb in rows:
            B(mb, *f, u0, u1, -0.3, 0, cur, wa, "panel")
            window_row(mb, f, u0, u1, wa, wb, wins_fn(za, zb))
            cur = wb
        B(mb, *f, u0, u1, -0.3, 0, cur, zb, "panel")
        if za not in INTERIOR_Z:                   # 中を作っていない階は、窓の奥に暗い面
            Q(mb, *f, u0, u1, -1.2, za, zb, "backdrop")


def two_rows(za, zb):
    """フィンの面は 1 階に窓が 2 段（写真 6720 の細かい格子）"""
    h = zb - za
    if h < 3.4:
        return [(za + 0.9, zb - 0.5)]
    m = h / 2
    return [(za + 0.55, za + m - 0.45), (za + m + 0.55, zb - 0.45)]


def fin_positions(segs):
    """区間ごとに、両端を含めてだいたい 5.6〜6m おきのフィンの位置"""
    us = set()
    for a, b in segs:
        n = max(1, round((b - a) / 5.8))
        for i in range(n + 1):
            us.add(round(a + (b - a) * i / n, 3))
    return sorted(us)


def fins(mb, f, us, z_of, top):
    """フィン（幅 1.2・出 1.4、横筋つき。写真 6720・6753）。z_of(u) = 下端"""
    for u in us:
        z0 = z_of(u)
        if z0 is None:
            continue
        B(mb, *f, u - 0.6, u + 0.6, 0, 1.4, z0, top, "fin")
        z = z0 + 1.3
        while z < top - 0.3:
            Q(mb, *f, u - 0.6, u + 0.6, 1.402, z, z + 0.08, "rib")
            z += 1.3


def bay_windows(us, margin=0.95):
    """フィンの間に窓 1 つ（幅 = 間隔 - フィン - 両側の壁）"""
    def fn(za, zb):
        return [((a + b) / 2, b - a - 1.2 - 2 * margin) for a, b in zip(us[:-1], us[1:])]
    return fn


def even_windows(u0, u1, pitch=2.9, w=1.8):
    def fn(za, zb):
        n = max(1, int((u1 - u0) / pitch))
        return [(u0 + (u1 - u0) * (i + 0.5) / n, w) for i in range(n)]
    return fn


ext = MB()

# ---------- 広場側（南棟の -Y 面）：フィンと細かい窓、真ん中にゲート ----------
fS = ('x', SY0, -1)
S_SEGS = [(SX0, GX0), (GX0, GX1), (GX1, SX1)]
usS = fin_positions(S_SEGS)


def zlo_S(u):
    if u < GX0 - 0.01:
        return LEG_TOP                 # 教室棟の脚の上
    if u < GX1 - 0.01:
        return GATE_TOP if u > GX0 + 0.01 else DECK
    return 0.0


facade(ext, fS, SX0, GX0 - 0.6, LEG_TOP, PARA, bay_windows([u for u in usS if u <= GX0 + 0.01]), two_rows)
facade(ext, fS, GX0 + 0.6, GX1 - 0.6, GATE_TOP, PARA, bay_windows([u for u in usS if GX0 - 0.01 <= u <= GX1 + 0.01]), two_rows)
facade(ext, fS, GX1 + 0.6, SX1, DECK, PARA, bay_windows([u for u in usS if u >= GX1 - 0.01]), two_rows)
fins(ext, fS, usS, zlo_S, PARA + 1.2)
# 1F・2F（ゲートの東）：植え込みの奥のガラスと壁
for a, b in zip([u for u in usS if u >= GX1 - 0.01][:-1], [u for u in usS if u >= GX1 - 0.01][1:]):
    a, b = a + 0.6, b - 0.6
    B(ext, *fS, a, b, -0.3, 0, 4.2, DECK, "panel_d")
    Q(ext, *fS, a, b, -0.2, 0.0, 4.2, "gglass")
    B(ext, *fS, a, b, -0.2, 0.25, 4.2, 4.5, "ledge")
    for i in range(4):
        u = a + (b - a) * i / 3
        B(ext, *fS, u - 0.04, u + 0.04, -0.2, -0.1, 0, 4.2, "frame")

# ---------- 道路側（北棟の +Y 面） ----------
fN = ('x', NY1, +1)
N_SEGS = [(NX0, GX0), (GX0, GX1), (GX1, NX1)]
usN = fin_positions(N_SEGS)


def zlo_N(u):
    if u < KX - 0.01:
        return FZ[8]
    if GX0 + 0.01 < u < GX1 - 0.01:
        return GATE_TOP
    return 0.0


facade(ext, fN, NX0, KX, FZ[8], PARA, bay_windows([u for u in usN if u <= GX0 + 0.01]), two_rows)
facade(ext, fN, KX, GX1 + 0.6, GATE_TOP, PARA, bay_windows([u for u in usN if GX0 - 0.01 <= u <= GX1 + 0.01]), two_rows)
facade(ext, fN, GX1 + 0.6, NX1, DECK, PARA, bay_windows([u for u in usN if u >= GX1 - 0.01]), two_rows)
fins(ext, fN, usN, zlo_N, PARA + 1.2)
# 1F・2F（ゲートの下も）：ガラスの開口（写真 6753）。ゲートの下（X KX〜GX1）は 2F の高さまで
usN_low = [u for u in usN if u >= KX - 0.01]
for a, b in zip(usN_low[:-1], usN_low[1:]):
    a, b = a + 0.6, b - 0.6
    top = DECK
    B(ext, *fN, a, b, -0.3, 0, 4.2, top, "panel_d")
    Q(ext, *fN, a, b, -0.2, 0.0, 4.2, "gglass")
    B(ext, *fN, a, b, -0.2, 0.25, 4.2, 4.5, "ledge")
    for i in range(4):
        u = a + (b - a) * i / 3
        B(ext, *fN, u - 0.04, u + 0.04, -0.2, -0.1, 0, 4.2, "frame")
    Q(ext, *fN, a, b, -1.2, 4.5, DECK, "backdrop")
# ゲートの下の北の面にも、端の X = KX からフィンの最初までの壁
B(ext, *fN, KX, usN_low[0] - 0.6, -0.3, 0, 0, DECK, "panel_d")

# ---------- 妻（±X の端）：平らな壁に窓の縦の列（写真 6757） ----------
def end_wins(u0, u1, extra=()):
    c = (u0 + u1) / 2

    def fn(za, zb):
        return [(c - 4.5, 1.6), (c + 4.5, 1.6)] + [(e, 1.6) for e in extra]
    return fn


COR_S = (-14.0, -11.9)          # 南棟の廊下（Y）
COR_N = (10.6, 12.8)            # 北棟の廊下（Y）
fE_S = ('y', SX1, +1)
facade(ext, fE_S, SY0, SY1, 0, PARA, end_wins(SY0, SY1, [sum(COR_S) / 2]))
fE_N = ('y', NX1, +1)
facade(ext, fE_N, NY0, NY1, 0, PARA, end_wins(NY0, NY1, [sum(COR_N) / 2]))
fE_G = ('y', SX1, +1)           # 光庭の東の口の下（1F・2F）
B(ext, *fE_G, SY1, NY0, -0.3, 0, 4.2, DECK, "panel_d")
Q(ext, *fE_G, SY1, NY0, -0.2, 0, 4.2, "gglass")
# 西の端（8F から上）
fW_S = ('y', SX0, -1)
facade(ext, fW_S, SY0, SY1, LEG_TOP, PARA, end_wins(SY0, SY1, [sum(COR_S) / 2]))
fW_N = ('y', NX0, -1)
facade(ext, fW_N, NY0W, NY1, FZ[8], PARA, end_wins(NY0W, NY1, [sum(COR_N) / 2]))
# 8F の、光庭の上（帯の上）の西の壁：教室棟 7F→8F のエスカレーターが入る口をあける
fW_B = ('y', XB, -1)
ex0, ex1, ey0, ey1 = ESC8
for a, b in sub_u([(-4.3, NY0W)], [(ey0, ey1)]):
    facade(ext, fW_B, a, b, FZ[8], FZ[9], even_windows(a, b, 3.0, 1.8))
B(ext, *fW_B, ey0, ey1, -0.3, 0, FZ[8] + 2.7, FZ[9], "panel")
# 8F の帯の上の南の壁（Y = -4.3）
facade(ext, ('x', -4.3, -1), XB, SX0, FZ[8], FZ[9], even_windows(XB, SX0, 3.0, 1.8))
# 北棟の西の部分の、細くなる段（X = XB、Y NY0〜NY0W、9F から上）
facade(ext, ('y', XB, -1), NY0, NY0W, FZ[9], PARA, lambda za, zb: [])

# ---------- 光庭（南棟と北棟の間）：窓と点検通路（写真 6756） ----------
def court_face(f, segs, z0, z1):
    for a, b in segs:
        if b - a < 0.5:
            continue
        facade(ext, f, a, b, z0, z1, even_windows(a, b, 2.9, 1.7), None, "court")
        for za, zb in bands(z0, min(z1, ROOF)):
            if zb - za < 2.4:
                continue
            B(ext, *f, a, b, 0, 1.0, za - 0.05, za + 0.03, "grating")      # 点検通路の床（グレーチング）
            B(ext, *f, a, b, 0.95, 1.0, za + 0.03, za + 1.1, "grating")    # 手すりの格子


fCS = ('x', SY1, +1)            # 南棟の光庭側の面（+Y を向く）
fCN = ('x', NY0, -1)            # 北棟の光庭側の面（-Y を向く）
cores = [EVB_CORE]
court_face(fCS, sub_u([(GX1, SX1)], [EVB_CORE]), DECK, FZ[8])
court_face(fCN, sub_u([(GX1, SX1)], [EVB_CORE]), DECK, FZ[8])
court_face(fCS, sub_u([(SX0, SX1)], [EVB_CORE, EVA_CORE]), FZ[9], PARA)
court_face(fCN, sub_u([(XB, NX1)], [EVB_CORE, EVA_CORE]), FZ[9], PARA)
court_face(fCN, [(SX1, NX1)], 0, FZ[9])                      # 北棟が南棟より東へ出ている所
court_face(('x', NY0W, -1), [(NX0, XB)], FZ[8], PARA)        # 北棟の西の部分（教室棟の上）
# 8F は光庭をふさぐ（図書館の階）。東の口の壁
facade(ext, ('y', SX1, +1), SY1, NY0, FZ[8], FZ[9], even_windows(SY1, NY0, 3.0, 1.8))
# 1F・2F の上の光庭の床（屋上）と、8F の屋根（9F の床の高さ）
for x0, x1 in sub_u([(GX1, SX1)], [EVB_CORE]):
    ext.box(x0, x1, SY1, NY0, DECK - SLAB, DECK, "roof")
for x0, x1 in sub_u([(SX0, SX1)], [EVB_CORE, EVA_CORE]):
    ext.box(x0, x1, SY1, NY0, FZ[9] - SLAB, FZ[9], "roof")
ext.box(XB, SX0, -4.3, NY0, FZ[9] - SLAB, FZ[9], "roof")
ext.box(XB, SX0, NY0, NY0W, FZ[9] - SLAB, FZ[9], "roof")
# 光庭の床の下側（ゲートの天井と同じ高さの、8F の床の裏）
for x0, x1 in sub_u([(GX1, SX1)], [EVB_CORE]):
    ext.box(x0, x1, SY1, NY0, FZ[8] - SLAB, FZ[8], "soffit")


# ---------- 光庭を渡る箱（EV B・EV A）：±X の面にブラインドの窓（写真 6751） ----------
def core_box(x0, x1, z0, z1, top):
    for xf, out in ((x0, -1), (x1, +1)):
        f = ('y', xf, out)
        for za, zb in bands(z0, z1):
            if zb - za < 2.4:
                B(ext, *f, SY1, NY0, -0.3, 0, za, zb, "court")
                continue
            B(ext, *f, SY1, NY0, -0.3, 0, za, za + 0.9, "court")
            B(ext, *f, SY1, NY0, -0.3, 0, zb - 0.6, zb, "court")
            B(ext, *f, SY1, SY1 + 1.2, -0.3, 0, za + 0.9, zb - 0.6, "court")
            B(ext, *f, NY0 - 1.2, NY0, -0.3, 0, za + 0.9, zb - 0.6, "court")
            Q(ext, *f, SY1 + 1.2, NY0 - 1.2, -0.12, za + 0.9, zb - 0.6, "glass")
            Q(ext, *f, SY1 + 1.2, NY0 - 1.2, -0.3, za + 0.9, zb - 0.6, "blind")
    ext.box(x0, x1, SY1, NY0, top - 0.3, top, "roof")


core_box(*EVB_CORE, DECK, ROOF + 1.0, ROOF + 2.5)
ext.box(EVB_CORE[0], EVB_CORE[1], SY1, NY0, ROOF, ROOF + 2.5, "court")
core_box(*EVA_CORE, FZ[9], ROOF + 1.0, ROOF + 2.5)
ext.box(EVA_CORE[0], EVA_CORE[1], SY1, NY0, ROOF, ROOF + 2.5, "court")

# ---------- ゲート（写真 6720・6721） ----------
# 天井（8F の床の下）と、正面の梁の帯の文字・校章
ext.box(GX0, GX1, SY0, NY1, GATE_TOP, FZ[8] - SLAB, "soffit")
for i in range(1, 6):            # 天井の目地（縦の梁）
    x = GX0 + (GX1 - GX0) * i / 6
    ext.box(x - 0.25, x + 0.25, SY0, NY1, GATE_TOP - 0.6, GATE_TOP, "soffit")
gc = (GX0 + GX1) / 2
add_text(ext, "SHIBAURA INSTITUTE OF TECHNOLOGY", (gc + 1.2, SY0 - 0.32, GATE_TOP + 0.75), (0, -1), 0.55, "sign")
ext.box(gc - 9.0, gc - 7.9, SY0 - 0.36, SY0 - 0.3, GATE_TOP + 0.3, GATE_TOP + 1.35, "emblem")
# 東の壁（X = GX1、-X を向く）：コンクリートの壁と縦長のガラス、6F の渡り廊下の口
for (y0, y1) in ((SY0, SY1), (NY0, NY1)):
    f = ('y', GX1, -1)
    B(ext, *f, y0, y1, -0.3, 0, DECK, GATE_TOP, "concrete")
    yc = (y0 + y1) / 2
    Q(ext, *f, yc - 0.9, yc + 0.9, 0.01, DECK + 3.0, GATE_TOP - 1.0, "glass")
    for z in range(int(DECK) + 4, int(GATE_TOP), 3):
        Q(ext, *f, y0, y1, 0.005, z, z + 0.03, "rib")
f = ('y', GX1, -1)
Q(ext, *f, -12.3, -9.5, 0.02, FZ[6], FZ[6] + 2.9, "glass")     # 渡り廊下の先の扉
# 東の壁の南棟と北棟のあいだ（光庭の幅）：芝生から光庭がのぞけていたのでふさぐ（ユーザーの指示 2026-10-29）
B(ext, *f, SY1, NY0, -0.3, 0, DECK, GATE_TOP, "concrete")
for z in range(int(DECK) + 4, int(GATE_TOP), 3):
    Q(ext, *f, SY1, NY0, 0.005, z, z + 0.03, "rib")
# 西の壁（北棟の部分。+X を向く。教室棟.blend の曲がり角の「頭」の切り口の前）
f = ('y', KX + 0.5, +1)
B(ext, *f, NY0W, NY1, -0.3, 0, DECK, GATE_TOP, "concrete")
Q(ext, *f, 14.0, 16.0, 0.01, DECK + 3.0, GATE_TOP - 1.0, "glass")
for z in range(int(DECK) + 4, int(GATE_TOP), 3):
    Q(ext, *f, NY0W, NY1, 0.005, z, z + 0.03, "rib")
# 床（ゲートの下の 1F の天井 = 大階段の上の広場）
ext.box(GX0, GX1, SY0, NY1, DECK - 0.5, DECK, "paving", skip=(1,))
ext.hquad(GX0, GX1, SY0, NY1, DECK, "turf")      # ゲートの下も奥まで人工芝（ユーザーの指示 2026-10-12）
# 北の口：植え込みと手すり。まん中は道路へ下りる外階段（芝生を歩いて道路側へ出られる。ユーザーの指示 2026-10-29）
#   TRACE の道の網の「研究棟ゲート → 道路側へ下りる」線（ゲートの真ん中、道路側の点 Y = NY1 + 8.2）に合わせる
NS_X0, NS_X1 = (GX0 + GX1) / 2 - 2.0, (GX0 + GX1) / 2 + 2.0     # 階段の幅 4m
NS_Y1 = NY1 + 8.2                                                # 階段の下の端（道路側の歩道）
for xa, xb in ((GX0 + 0.5, NS_X0 - 0.3), (NS_X1 + 0.3, GX1 - 0.5)):
    ext.box(xa, xb, NY1 - 1.6, NY1, DECK, DECK + 0.6, "stone")
    ext.box(xa + 0.1, xb - 0.1, NY1 - 1.5, NY1 - 0.1, DECK + 0.6, DECK + 1.2, "hedge")
for x in (GX0 + 1.0, GX1 - 1.0):
    ext.box(x - 0.3, x + 0.3, NY1 - 1.5, NY1, DECK, DECK + 1.8, "stone")
n_ns = 36                                                        # 蹴上 1/6 m、踏面 0.23m
for i in range(n_ns - 1):
    ya, yb = NY1 + (NS_Y1 - NY1) * i / n_ns, NY1 + (NS_Y1 - NY1) * (i + 1) / n_ns
    ext.box(NS_X0, NS_X1, ya, yb, 0, DECK * (n_ns - 1 - i) / n_ns, "step")
for xa, xb in ((NS_X0 - 0.3, NS_X0), (NS_X1, NS_X1 + 0.3)):     # 両側の石の袖壁（上の端は芝生の植え込みにつながる）
    ext.prism_x([(NY1, 0), (NS_Y1, 0), (NS_Y1, 0.6), (NY1, DECK + 0.6), (NY1 - 1.6, DECK + 0.6), (NY1 - 1.6, DECK), (NY1, DECK)], xa, xb, "stone")
for x in (NS_X0 + 0.15, NS_X1 - 0.15):                           # 手すり
    ext.prism_x([(NY1 - 1.6, DECK + 0.95), (NY1, DECK + 0.95), (NS_Y1, 0.95), (NS_Y1, 1.0), (NY1, DECK + 1.0), (NY1 - 1.6, DECK + 1.0)],
                x - 0.03, x + 0.03, "steel")

# ---------- 大階段とゲート前の広場（写真 6720・6721） ----------
ST_Y0, ST_Y1 = -65.5, -39.5     # 階段（下の端・上の端）。上の端からゲートまでは 6.0m の広場
LOW_Y = ST_Y0 + 3.0             # 一番下の広い段の奥
LOW_Z = 1.2
ext.box(GX0, GX1, ST_Y1, SY0, 0, DECK - 0.5, "stone")      # 広場の下（中は部屋 01I21。作らない）
ext.box(GX0, GX1, ST_Y1, SY0, DECK - 0.5, DECK, "paving",
        skip=(1,))                                          # 上の面は人工芝で張る
# ゲート前の広場は人工芝に白い「SIT」（Esri の航空写真で確認。ユーザーの指示 2026-10-12）
# 文字はゲートの真ん中の正面、幅約 12m・高さ約 5m。大階段から上ってくる人が読める向き（上が +Y）
ext.hquad(GX0, GX1, ST_Y1, SY0, DECK, "turf")


def flat_text(mb, s, cx, cy, z, width, height, key):
    """地面に寝かせた文字。上が +Y。width x height の箱に収まるように縮める（曲線を細かく・少し太く）"""
    cu = bpy.data.curves.new("_tmp_flat", 'FONT')
    cu.body = s
    cu.resolution_u = 8
    cu.offset = 0.03                # 少し太らせる
    cu.space_character = 1.35       # 文字の間をあける
    ob = bpy.data.objects.new("_tmp_flat", cu)
    scene.collection.objects.link(ob)
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    vs = [tuple(v.co) for v in me.vertices]
    fs = [tuple(p.vertices) for p in me.polygons]
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    x0, x1 = min(v[0] for v in vs), max(v[0] for v in vs)
    y0, y1 = min(v[1] for v in vs), max(v[1] for v in vs)
    k = min(width / (x1 - x0), height / (y1 - y0))
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    base = len(mb.v)
    for x, y, _ in vs:
        mb.v.append((cx + (x - mx) * k, cy + (y - my) * k, z))
    for f in fs:
        mb.f.append(tuple(base + i for i in f))
        mb.mi.append(mb._m(key))


flat_text(ext, "SIT", (GX0 + GX1) / 2, -33.5, DECK + 0.01, 12.0, 5.0, "turf_text")
for x in (GX0 + 0.15, GX1 - 0.15):                          # 広場の両側の手すり
    ext.box(x - 0.03, x + 0.03, ST_Y1, SY0, DECK, DECK + 1.1, "steel")
# 一番下の広い段（全幅）
n_low = 8
for i in range(n_low):
    y = ST_Y0 + (LOW_Y - ST_Y0) * i / n_low
    ext.box(GX0, GX1, y, LOW_Y, LOW_Z * i / n_low, LOW_Z * (i + 1) / n_low, "step")
# 幅の割り振り：植え込み | 階段 | 花壇 | 階段 | 植え込み
W = GX1 - GX0
xs = [GX0, GX0 + 5.4, GX0 + 8.9, GX1 - 8.9, GX1 - 5.4, GX1]
n_st = 32                       # 6.0m まで上がる（蹴上 0.15m 前後）
for k in (1, 3):                 # 2 本の階段
    a, b = xs[k], xs[k + 1]
    for i in range(n_st):
        y = LOW_Y + (ST_Y1 - LOW_Y) * i / n_st
        z = LOW_Z + (DECK - LOW_Z) * (i + 1) / n_st
        ext.box(a, b, y, ST_Y1, z - (DECK - LOW_Z) / n_st, z, "step")
    for x in (a + 0.25, b - 0.25):                     # 手すり
        ext.prism_x([(LOW_Y, LOW_Z + 0.95), (ST_Y1, DECK + 0.95), (ST_Y1, DECK + 1.0), (LOW_Y, LOW_Z + 1.0)],
                    x - 0.03, x + 0.03, "steel")
        for i in range(6):
            t = i / 5
            y = LOW_Y + (ST_Y1 - LOW_Y) * t
            z = LOW_Z + (DECK - LOW_Z) * t
            ext.box(x - 0.025, x + 0.025, y - 0.025, y + 0.025, z, z + 0.97, "steel")


def slope(a, b, key, y0=LOW_Y, y1=ST_Y1, z0=LOW_Z, z1=DECK, lift=0.0):
    """斜めの植え込み（Y の手前 y0 で高さ z0、奥 y1 で z1）"""
    ext.prism_x([(y0, 0.0), (y1, 0.0), (y1, z1 + lift), (y0, z0 + lift)], a, b, key)


slope(xs[0], xs[1], "hedge", lift=0.5)
slope(xs[4], xs[5], "hedge", lift=0.5)
# 真ん中の花壇：段々の帯（赤・白・緑）
n_fl = 9
keys = ["flower_g", "flower_w", "flower_r", "flower_w", "flower_r", "flower_r", "flower_w", "flower_r", "flower_r"]
for i in range(n_fl):
    ya = LOW_Y + (ST_Y1 - LOW_Y) * i / n_fl
    yb = LOW_Y + (ST_Y1 - LOW_Y) * (i + 1) / n_fl
    za = LOW_Z + (DECK - LOW_Z) * i / n_fl
    zb = LOW_Z + (DECK - LOW_Z) * (i + 1) / n_fl
    ext.prism_x([(ya, 0.0), (yb, 0.0), (yb, zb + 0.15), (ya, za + 0.15)], xs[2], xs[3], keys[i])
ext.box(xs[2], xs[3], ST_Y1 - 0.4, ST_Y1, 0, DECK + 0.35, "hedge")   # 上の端の生け垣

# ---------- 屋上：屋根・機械室（北棟の西の端が高い。写真 6720 の左奥） ----------
for x0, x1, y0, y1 in ((SX0, SX1, SY0, SY1), (XB, NX1, NY0, NY1), (NX0, XB, NY0W, NY1)):
    ext.box(x0, x1, y0, y1, ROOF - 0.4, ROOF, "roof")
PH = (NX0 + 0.3, NX0 + 15.0, NY0W + 1.0, NY1 - 0.3)
ext.box(*PH, ROOF, 68.6, "louver")
z = ROOF + 0.6
while z < 68.4:
    for x0, x1, y0, y1 in ((PH[0], PH[1], PH[2] - 0.05, PH[2]), (PH[0], PH[1], PH[3], PH[3] + 0.05)):
        ext.box(x0, x1, y0, y1, z, z + 0.08, "rib")
    z += 0.5
for x0, x1, y0, y1 in ((25.0, 33.0, SY0 + 3.0, SY1 - 3.0), (-8.0, 4.0, NY0 + 4.0, NY1 - 4.0)):
    ext.box(x0, x1, y0, y1, ROOF, ROOF + 2.2, "louver")

# ---------- 2F〜7F：外観だけ。床の縁と、8F の床（教室棟の脚の上）----------
ext.box(SX0, KX, SY0, -4.3, LEG_TOP, FZ[8], "panel")
ext.build("研究棟_外観", col)

# ======================================================================
# 内装の道具
# ======================================================================
WT = 0.12                       # 間仕切りの厚さ


def wall(mb, ax, line, u0, u1, z, h, doors=(), key="wall", base=True):
    """間仕切り（厚さ WT）。ax='x' なら Y = line に沿う。doors = [(u の中心, 幅, 高さ)] は開けておく"""
    cur = u0
    pieces = []
    for c, w, dh in sorted(doors):
        a, b = c - w / 2, c + w / 2
        pieces.append((cur, a, 0, h))
        pieces.append((a, b, dh, h))
        cur = b
    pieces.append((cur, u1, 0, h))
    for a, b, za, zb in pieces:
        if b - a < 0.01:
            continue
        if ax == 'x':
            mb.box(a, b, line - WT / 2, line + WT / 2, z + za, z + zb, key)
            if base and za == 0:
                mb.box(a, b, line - WT / 2 - 0.012, line + WT / 2 + 0.012, z, z + 0.1, "base")
        else:
            mb.box(line - WT / 2, line + WT / 2, a, b, z + za, z + zb, key)
            if base and za == 0:
                mb.box(line - WT / 2 - 0.012, line + WT / 2 + 0.012, a, b, z, z + 0.1, "base")


def glass_door(mb, ax, line, c, z, w=1.7, dh=2.4, side=+1, label=None, strip=True):
    """白い枠のガラスの両開き扉（写真 6725・6746）と、横の黒い縦の札。side = 札を見る側（廊下）"""
    a, b = c - w / 2, c + w / 2
    fw = 0.08

    def bx(u0, u1, t0, t1, z0, z1, key):
        if ax == 'x':
            mb.box(u0, u1, line + t0, line + t1, z + z0, z + z1, key)
        else:
            mb.box(line + t0, line + t1, u0, u1, z + z0, z + z1, key)

    bx(a - fw, a, -0.09, 0.09, 0, dh + fw, "door")
    bx(b, b + fw, -0.09, 0.09, 0, dh + fw, "door")
    bx(a - fw, b + fw, -0.09, 0.09, dh, dh + fw, "door")
    for la, lb in ((a, c), (c, b)):
        m = 0.11
        bx(la, lb, -0.025, 0.025, 0, 0.15, "door")
        bx(la, lb, -0.025, 0.025, dh - m, dh, "door")
        bx(la, la + m, -0.025, 0.025, 0.15, dh - m, "door")
        bx(lb - m, lb, -0.025, 0.025, 0.15, dh - m, "door")
        bx(la + m, lb - m, -0.004, 0.004, 0.15, dh - m, "dglass")
    if strip:
        s0, s1 = b + fw + 0.05, b + fw + 0.55
        bx(s0, s1, side * 0.06, side * 0.08, 0.08, dh + 0.3, "strip")
        if label:
            if ax == 'x':
                center, normal = ((s0 + s1) / 2, line + side * 0.081, z + 1.95), (0, side)
            else:
                center, normal = (line + side * 0.081, (s0 + s1) / 2, z + 1.95), (side, 0)
            add_text(mb, label, center, normal, 0.12)


def steel_door(mb, ax, line, c, z, side, w=1.0, dh=2.1):
    if ax == 'x':
        mb.box(c - w / 2, c + w / 2, line + side * 0.06, line + side * 0.08, z, z + dh, "steeldoor")
    else:
        mb.box(line + side * 0.06, line + side * 0.08, c - w / 2, c + w / 2, z, z + dh, "steeldoor")


def ev_doors(mb, ax, line, us, z, side, label=None):
    """EV の扉（白）と、間の黒い壁（写真 6732・6751）"""
    for u in us:
        if ax == 'x':
            mb.box(u - 0.55, u + 0.55, line + side * 0.06, line + side * 0.085, z, z + 2.3, "ev_w")
            mb.box(u - 1.1, u - 0.55, line + side * 0.06, line + side * 0.08, z, z + 2.9, "ev_b")
            mb.box(u + 0.55, u + 1.1, line + side * 0.06, line + side * 0.08, z, z + 2.9, "ev_b")
        else:
            mb.box(line + side * 0.06, line + side * 0.085, u - 0.55, u + 0.55, z, z + 2.3, "ev_w")
            mb.box(line + side * 0.06, line + side * 0.08, u - 1.1, u - 0.55, z, z + 2.9, "ev_b")
            mb.box(line + side * 0.06, line + side * 0.08, u + 0.55, u + 1.1, z, z + 2.9, "ev_b")


# EV A のかご 2 台（9F〜14F）。扉は -X の廊下を向く。かごの中は床も天井もなく、真上に抜ける（展示の点が (-24.9, 0) を真上に動く）
EVA_DOORS_Y = (0.0, 3.0)
EVA_X0, EVA_X1 = EVA[0] + 0.12, EVA[0] + 2.5          # かごの奥行き（前の壁の厚さ 0.12 を除く）
EVA_HALF = 1.3                                          # かごの幅の半分
EVA_CELLS = [(EVA_X0, EVA_X1, c - EVA_HALF, c + EVA_HALF) for c in EVA_DOORS_Y]
FH_ = FH - SLAB                                         # 階ごとの、かごの壁の高さ（-SLAB から次の階の -SLAB まで）


def ev_doors_open(mb, line, us, z, side):
    """EV の扉を開けた状態：開口、両脇の黒い壁、脇に寄せた 2 枚の扉、敷居、扉の上の表示灯"""
    for u in us:
        mb.box(line + side * 0.06, line + side * 0.08, u - 1.1, u - 0.55, z, z + 2.9, "ev_b")
        mb.box(line + side * 0.06, line + side * 0.08, u + 0.55, u + 1.1, z, z + 2.9, "ev_b")
        mb.box(line + side * 0.06, line + side * 0.08, u - 0.55, u + 0.55, z + 2.3, z + 2.9, "ev_b")
        mb.box(line + side * 0.085, line + side * 0.105, u - 1.08, u - 0.55, z, z + 2.3, "ev_w")      # 開いた扉（脇へ）
        mb.box(line + side * 0.085, line + side * 0.105, u + 0.55, u + 1.08, z, z + 2.3, "ev_w")
        mb.box(line - 0.15, line + 0.15, u - 0.55, u + 0.55, z - 0.02, z + 0.015, "steel")             # 敷居
        mb.box(line + side * 0.085, line + side * 0.11, u - 0.3, u + 0.3, z + 2.45, z + 2.6, "ev_call")  # 扉の上の表示灯


def ev_cell(mb, tx, fl, z_top_extra=0.0):
    """EV A のかご 2 台の中：明るい壁、奥の壁の発光パネル、階の大きな数字（この階だけ tx に入れる）"""
    for (x0, x1, y0, y1), c in zip(EVA_CELLS, EVA_DOORS_Y):
        zb, zt = -SLAB, FH_
        mb.box(x1 - 0.04, x1, y0, y1, zb, zt, "ev_in")                       # 奥の壁
        mb.box(x0, x1, y0, y0 + 0.04, zb, zt, "ev_in")                       # 両側の壁
        mb.box(x0, x1, y1 - 0.04, y1, zb, zt, "ev_in")
        mb.box(x1 - 0.047, x1 - 0.04, c - 0.95, c + 0.95, 0.3, 3.3, "ev_lamp")           # 奥の壁の発光パネル（各階に 1 枚）
        mb.box(x0 + 0.04, x1 - 0.04, y0 + 0.04, y0 + 0.047, 0.5, 3.1, "ev_lamp")         # 横の壁の発光帯
        mb.box(x0 + 0.04, x1 - 0.04, y1 - 0.047, y1 - 0.04, 0.5, 3.1, "ev_lamp")
        add_text(tx, str(fl), (x1 - 0.055, c, 1.8), (-1, 0), 1.0, key="strip")             # 階の数字（明るいパネルに黒）


# EV B の +X の廊下に面した 2 台のうち、Y = 1.6 の 1 台をくり抜いて扉を開ける（展示の点がこのかごを真上に動く。2026-10-29）
#   前は EV B 全体が黒い塊で、点（u 16, v 0）は扉と扉のあいだの塊の中にあった
EVB_DOOR_Y = 1.6
EVB_CELL = (EVB[1] - 2.5, EVB[1] - 0.12, EVB_DOOR_Y - 1.3, EVB_DOOR_Y + 1.3)


def evb_open(mb, y0, y1, h, closed):
    """EV B（X EVB[0]〜EVB[1]、Y y0〜y1、高さ h）：開いた 1 台のかごと、closed の Y の閉じた扉"""
    for r in sub([(EVB[0], EVB[1] - 0.12, y0, y1)], EVB_CELL):
        mb.box(r[0], r[1], r[2], r[3], 0, h, "ev_b")
    wall(mb, 'y', EVB[1] - 0.06, y0, y1, 0, h, [(EVB_DOOR_Y, 1.1, 2.3)], key="ev_b", base=False)
    ev_doors(mb, 'y', EVB[1], closed, 0, +1)
    ev_doors_open(mb, EVB[1], [EVB_DOOR_Y], 0, +1)
    x0, x1, c0, c1 = EVB_CELL
    mb.box(x0, x0 + 0.04, c0, c1, 0, h, "ev_in")                                      # 奥の壁
    mb.box(x0, x1, c0, c0 + 0.04, 0, h, "ev_in")                                      # 両側の壁
    mb.box(x0, x1, c1 - 0.04, c1, 0, h, "ev_in")
    mb.box(x0, x1, c0, c1, h - 0.05, h, "ev_in")                                      # 天井
    mb.box(x0 + 0.04, x0 + 0.047, EVB_DOOR_Y - 0.95, EVB_DOOR_Y + 0.95, 0.3, h - 0.3, "ev_lamp")   # 奥の壁の発光パネル


def row_rooms(mb, xs, labels, y_corr, y_far, z, h, side, door_at=0.75):
    """X 方向に部屋を並べる。xs = 境の X（小さい順）、labels[i] = xs[i]〜xs[i+1] の部屋（None = 壁だけ、"" = 扉なし）。
    y_corr = 廊下側の壁、side = 廊下のある向き（+1/-1）"""
    doors = []
    for (a, b), lab in zip(zip(xs[:-1], xs[1:]), labels):
        if lab is None or lab == "":
            continue
        c = b - min(door_at + 0.9, (b - a) / 2) if b - a > 2.4 else (a + b) / 2
        doors.append((c, lab))
    wall(mb, 'x', y_corr, xs[0], xs[-1], z, h, [(c, 1.86, 2.48) for c, _ in doors])
    for c, lab in doors:
        glass_door(mb, 'x', y_corr, c, z, side=side, label=lab, strip=lab not in ("WC",))
    for x in xs:
        wall(mb, 'y', x, min(y_corr, y_far), max(y_corr, y_far), z, h)


# ======================================================================
# 1F（案内図 6730）。天井はむき出しで黒、ケーブルラックと蛍光灯（写真 6723）
# ======================================================================
H1 = 3.6
g1 = MB()
Z1 = 0.0
S_IN0, N_IN1 = SY0 + 0.3, NY1 - 0.3
X1_0, X1_1 = KX, NX1 - 0.3
# 床（1F は南棟・光庭・北棟とゲートの下の全部）
g1.box(KX, SX1 - 0.3, S_IN0, NY0, -0.1, 0.0, "floor1")
g1.box(KX, X1_1, NY0, N_IN1, -0.1, 0.0, "floor1")
g1.box(SX1 - 0.3, X1_1, SY1, NY0, -0.1, 0.0, "floor1")
# 部屋：(番号札, x0, x1, y0, y1, 扉の面)
R1 = [
    ("01B25", 16.8, SX1 - 0.3, S_IN0, -13.7, "+y"),
    ("01F25", -4.9, 16.8, S_IN0, -13.7, "+y"),
    ("01I25", KX, -4.9, S_IN0, -5.5, "+x"),
    ("KENSHU CTR", 21.7, SX1 - 0.3, -11.6, -4.5, "-y"),
    ("01C28", 18.7, 27.6, -4.5, 3.75, "-x"),
    ("01D30", 18.7, 27.6, 3.75, 11.9, "-x"),
    ("01G27", 0.0, 12.0, -11.6, 1.7, "-y"),
    ("01G29", 0.0, 12.0, 1.7, 11.9, "+y"),
    ("01I27", -10.8, 0.0, -5.5, 11.9, "+y"),
    ("01K28", -20.7, -10.8, -5.5, 11.9, "+y"),
    ("01A32", 22.1, X1_1, 14.4, N_IN1, "-y"),
    ("01E32", 10.9, 22.1, 14.4, N_IN1, "-y"),
    ("01G32", 0.0, 10.9, 14.4, N_IN1, "-y"),
    ("TECHNO PLAZA V", -10.8, 0.0, 14.4, N_IN1, "-y"),
    ("01K32", KX, -10.8, 14.4, N_IN1, "-y"),
]


def room1(mb, label, x0, x1, y0, y1, face, z=Z1, h=H1):
    """部屋の 4 枚の壁。face の面に扉と札"""
    ax_of = {"+y": ('x', y1, +1), "-y": ('x', y0, -1), "+x": ('y', x1, +1), "-x": ('y', x0, -1)}
    ax, line, side = ax_of[face]
    for fc, (a2, l2, s2) in ax_of.items():
        u0, u1 = (x0, x1) if a2 == 'x' else (y0, y1)
        if fc == face:
            c = max(u0 + 1.2, min(u1 - 1.2, (u0 + u1) / 2 if u1 - u0 < 4 else u1 - 1.6))
            wall(mb, a2, l2, u0, u1, z, h, [(c, 1.86, 2.48)])
            glass_door(mb, a2, l2, c, z, side=side, label=label)
        else:
            wall(mb, a2, l2, u0, u1, z, h)


for r in R1:
    room1(g1, *r)
# 1F の EV B と階段（EV の扉は +X の廊下を向く）・トイレ
g1.box(EVB[0], EVB[1], -11.6, -4.5, 0, H1, "wall")
steel_door(g1, 'y', EVB[1], -8.0, 0, +1)
evb_open(g1, -4.5, 3.75, H1, [-2.3])
add_text(g1, "B", (EVB[1] + 0.09, -0.4, 2.65), (1, 0), 0.4)
room1(g1, "WC", EVB[0], EVB[1], 3.75, 11.9, "+x")
# 搬入口の奥（灰色の所。作らない）・EV A の手前の詰め
g1.box(27.6, X1_1, -4.5, 11.9, 0, H1, "shaft")
g1.box(KX, -20.7, -5.5, 11.9, 0, H1, "wall")
# 天井（黒）・ケーブルラック・蛍光灯（廊下）
g1.box(KX, X1_1, S_IN0, N_IN1, H1, H1 + 0.05, "ceil_b")
COR1 = [(-4.9, SX1 - 0.3, -13.7, -11.6), (-4.9, 0.0, -11.6, -5.5), (16.8, 18.7, -11.6, 11.9),
        (KX, X1_1, 11.9, 14.4)]
for x0, x1, y0, y1 in COR1:
    along_x = (x1 - x0) >= (y1 - y0)
    if along_x:
        yc = (y0 + y1) / 2
        g1.box(x0, x1, yc - 0.32, yc - 0.28, H1 - 0.45, H1 - 0.4, "tray")
        g1.box(x0, x1, yc + 0.28, yc + 0.32, H1 - 0.45, H1 - 0.4, "tray")
        x = x0 + 0.6
        while x < x1:
            g1.box(x - 0.02, x + 0.02, yc - 0.3, yc + 0.3, H1 - 0.45, H1 - 0.43, "tray")
            x += 1.2
        x = x0 + 2.0
        while x < x1 - 1.0:
            g1.box(x - 0.6, x + 0.6, yc - 0.06, yc + 0.06, H1 - 0.75, H1 - 0.7, "tube")
            x += 4.0
    else:
        xc = (x0 + x1) / 2
        g1.box(xc - 0.3, xc + 0.3, y0, y1, H1 - 0.45, H1 - 0.4, "tray")
        y = y0 + 2.0
        while y < y1 - 1.0:
            g1.box(xc - 0.06, xc + 0.06, y - 0.6, y + 0.6, H1 - 0.75, H1 - 0.7, "tube")
            y += 4.0
g1.build("研究棟_内装_1F", icol)

# ======================================================================
# 9F〜14F（案内図 6747 を全部の階に）。床からの高さで作って、各階に置く
# ======================================================================
HC = 2.7                        # 廊下の天井
HR = 3.4                        # 研究室の天井（むき出し）
S_OUT, S_C0, S_C1, S_IN = SY0 + 0.3, COR_S[0], COR_S[1], SY1 - 0.3
N_IN, N_C0, N_C1, N_OUT = NY0 + 0.3, COR_N[0], COR_N[1], NY1 - 0.3
SXa, SXb = SX0 + 0.3, SX1 - 0.3
NXa, NXb = NX0 + 0.3, NX1 - 0.3
# 南棟・外側の列（行 25）：境の X（小さい順）と部屋の列の文字
ROW25 = ([SXa, -23.2, -14.9, -6.7, 1.7, 10.1, 18.5, 27.2, SXb], ["N", "L", "K", "I", "H", "F", "E", "B"])
# 南棟・光庭側（行 27）。None = 壁だけ（シャフト）、"WC" = トイレ
ROW27 = ([SXa, EVA_COR[0], EVA_COR[1], EVA[1], -15.2, -9.9, -4.3, 1.0, 6.6, EVB[0], EVB[1], EVB_COR[1], 32.1, 35.0, SXb],
         [None, "COR", "STAIR_A", "L", "K", "J", "I", "H", "G", "STAIR_B", "COR", "WC", "C", "B"])
# 北棟・光庭側（行 30）
ROW30 = ([NXa, -36.0, EVA_COR[0], EVA_COR[1], -10.5, 0.6, EVB_COR[0], EVB_COR[1], 28.5, NXb],
         [None, "WC", "COR", "K", "I", "F", "COR", "D", None])
# 北棟・外側（行 32）
ROW32 = ([NXa, -45.3, -37.4, -29.6, -21.6, -13.6, -5.4, 2.8, 10.8, 19.2, 27.8, 36.5, NXb],
         ["R", "P", "O", "M", "L", "J", "I", "G", "F", "D", "C", "A"])


def clip_row(row, xmin):
    """行の境（xs）と部屋の列（labs）を X >= xmin だけにする。先頭が 1.5m 未満の切れ端なら捨てる"""
    xs, labs = row
    if xmin is None:
        return xs, labs
    nx, nl = [xmin], []
    for (a, b), lab in zip(zip(xs[:-1], xs[1:]), labs):
        if b <= xmin + 1e-6:
            continue
        nl.append(lab)
        nx.append(b)
    if len(nx) > 2 and nx[1] - nx[0] < 1.5:
        nx, nl = nx[1:], nl[1:]
    return nx, nl


def cut_row(row, xmax):
    """行を X <= xmax だけにする（それより +X はひと続きの広間にする階）"""
    xs, labs = row
    nx, nl = [xs[0]], []
    for (a, b), lab in zip(zip(xs[:-1], xs[1:]), labs):
        if a >= xmax - 1e-6:
            break
        nl.append(lab)
        nx.append(min(b, xmax))
    return nx, nl


def tag_size(name):
    return 0.12 if len(name) <= 6 else max(0.07, 0.12 * 6 / len(name))


def tag_name(fl, lab, code_row):
    return lab[1:] if lab.startswith("=") else f"{fl:02d}{lab}{code_row}"


# 階ごとの違い。2〜8F は X < KX が教室棟.blend（曲がり角）なので xmin = KX で切る。
#   3F（案内図 6752）・6F（6733）・7F（6731）は +X 側（EV B のまわり）を写真に合わせ、ほかは 9F の形
#   2F・4F・5F・8F は資料がない（ネットにも無かった）ので、ユーザーの指示どおり 12F と同じ形
#   部屋の文字が "=" で始まるときは、そのまま番号札に書く（標準フォントに日本語がないので英語）
#   infill = 光庭の +X 側をふさぐ部屋（案内図では 3F・6F・7F でここにも部屋がある）
_R27_B = (ROW27[0][:13] + [SXb], ROW27[1][:12])
#   ゲート（X GX0〜GX1）は 2F の床（人工芝のデッキ）から 8F の床の下まで抜けているので、2F〜7F の部屋は GX1 より +X だけ（8F は上を通る）
SPECS = {
    "low": dict(xmin=KX),
    "lowg": dict(xmin=GX1),
    "f3": dict(
        xmin=GX1,
        row30=([NXa, -36.0, EVA_COR[0], EVA_COR[1], -10.5, 0.6, 11.8, EVB_COR[0], EVB_COR[1], 28.5, NXb],
               [None, "WC", "COR", "K", "I", "F", "=03F30-1", "COR", "=ENG MTG", None]),
        infill=[("03C28", 19.8, 31.6, S_IN, 0.05, "-x"), ("03C29", 19.8, 31.6, 0.05, N_IN, "-x")]),
    "f6": dict(
        xmin=GX1,
        row25=([SXa, -23.2, -14.9, -6.7, 1.7, 11.8, 20.0, SXb], ["N", "L", "K", "I", "H", "=LAB 6-2", "=LAB 6-1"]),
        row27=(_R27_B[0], _R27_B[1] + ["=MTG 3"]),
        row30=([NXa, -36.0, EVA_COR[0], EVA_COR[1], -10.5, 0.6, 11.8, EVB_COR[0], EVB_COR[1], 28.5, NXb],
               [None, "WC", "COR", "K", "I", "F", "=MTG 5", "COR", "=MTG 4", None]),
        row32=(ROW32[0][:11] + [NXb], ROW32[1][:10] + ["A"]),
        infill=[("=STUDIO 2", 19.8, 34.0, S_IN, N_IN, "-x")]),
    "f7": dict(
        xmin=GX1,
        row25=([SXa, -23.2, -14.9, -6.7, 1.7, 10.1, SXb], ["N", "L", "K", "I", "H", "=LAB 7"]),
        row27=(_R27_B[0], _R27_B[1] + ["=MTG 1"]),
        commons=10.8,                               # 北棟の +X 側はラーニングコモンズ（ひと続きの広間）
        infill=[("=STUDIO 1", 20.6, 34.2, S_IN, N_IN, "-x"), ("=MTG 2", 27.8, 34.8, N_IN, N_IN + 4.5, "+y")]),
    "high": dict(),
}
FLOOR_SPEC = {2: "lowg", 3: "f3", 4: "lowg", 5: "lowg", 6: "f6", 7: "f7", 8: "low", **{f: "high" for f in range(9, 15)}}


def typical_floor(fl, spec):
    """標準階（9F の形）に spec の違いを足す。fl = 番号札に使う階。番号札は別のオブジェクト（階ごと）に分ける"""
    mb = MB()
    tx = MB()
    xmin = spec.get("xmin")
    lo = xmin if xmin is not None else -1e9
    commons = spec.get("commons")
    rows = {k: clip_row(spec.get(k, base), xmin) for k, base in
            (("row25", ROW25), ("row27", ROW27), ("row30", ROW30), ("row32", ROW32))}
    if commons is not None:
        rows["row30"] = cut_row(rows["row30"], commons)
        rows["row32"] = cut_row(rows["row32"], commons)
    # 床（カーペット）と、研究室の床
    for x0, x1, y0, y1 in ((SXa, SXb, S_OUT, S_IN), (NXa, NXb, N_IN, N_OUT)):
        if max(x0, lo) < x1:
            mb.box(max(x0, lo), x1, y0, y1, -SLAB, 0, "carpet")
    cores = (EVB_CORE,) if xmin is not None else (EVB_CORE, EVA_CORE)    # EV A は教室棟.blend の曲がり角にある
    for x0, x1 in cores:
        rects = [(x0, x1, SY1, NY0)]
        if (x0, x1) == EVA_CORE:                    # EV A のかごは床がない（真上に抜ける）
            for h in EVA_CELLS:
                rects = sub(rects, h)
        for r in rects:
            mb.box(r[0], r[1], r[2], r[3], -SLAB, 0, "carpet")
    if xmin is None:
        # 北棟の西の部分（X < XB）は細い
        mb.box(NXa, XB, N_IN, NY0W, -SLAB - 0.01, 0.01, "shaft")

    def row(xs_labels, y_corr, y_far, side, code_row):
        xs, labs = xs_labels
        rl = []
        for (a, b), lab in zip(zip(xs[:-1], xs[1:]), labs):
            if lab is None:
                mb.box(a, b, min(y_corr, y_far), max(y_corr, y_far), 0, HC + 0.7, "shaft")
                rl.append(None)
            elif lab == "COR":
                rl.append(None)
            elif lab.startswith("STAIR"):
                mb.box(a, b, min(y_corr, y_far), max(y_corr, y_far), 0, HC + 0.7, "wall")
                rl.append(None)
            elif lab == "WC":
                rl.append("WC")
            else:
                rl.append(tag_name(fl, lab, code_row))
        # 廊下側の壁と扉（COR・階段・シャフトの所は扉なし）
        for (a, b), lab, name in zip(zip(xs[:-1], xs[1:]), labs, rl):
            if name is None:
                continue
            c = max(a + 1.1, min(b - 1.1, b - 1.6 if b - a > 4 else (a + b) / 2))
            wall(mb, 'x', y_corr, a, b, 0, HC + 0.7, [(c, 1.86, 2.48)])
            glass_door(mb, 'x', y_corr, c, 0, side=side, label=None, strip=name != "WC")
            if name != "WC":
                fw = 0.08
                s0, s1 = c + 0.93 + fw + 0.05, c + 0.93 + fw + 0.55
                add_text(tx, name, ((s0 + s1) / 2, y_corr + side * 0.081, 1.95), (0, side), tag_size(name))
            # 研究室の床・天井（むき出しの暗い天井）
            y0, y1 = sorted((y_corr, y_far))
            mb.hquad(a, b, y0, y1, 0.005, "lab_floor" if name != "WC" else "carpet2")
            mb.box(a, b, y0, y1, HR, HR + 0.05, "lab_ceil")
        for x in xs:
            wall(mb, 'y', x, min(y_corr, y_far), max(y_corr, y_far), 0, HC + 0.7)

    row(rows["row25"], S_C0, S_OUT, +1, 25)     # side = 廊下のある向き
    row(rows["row27"], S_C1, S_IN, -1, 27)
    row(rows["row30"], N_C0, N_IN, +1, 30)
    row(rows["row32"], N_C1, N_OUT, -1, 32)
    # 廊下の天井（白）と、埋め込みの細長い照明（写真 6745）
    cors = [(max(SXa, lo), SXb, S_C0, S_C1), (max(NXa, lo), commons if commons is not None else NXb, N_C0, N_C1),
            (EVB_COR[0], EVB_COR[1], S_C1, N_C0)]
    if xmin is None:
        cors.append((EVA_COR[0], EVA_COR[1], S_C1, N_C0))
    for x0, x1, y0, y1 in cors:
        mb.box(x0, x1, y0, y1, HC, HC + 0.05, "ceil")
        if x1 - x0 > y1 - y0:
            x = x0 + 2.0
            while x < x1 - 1.0:
                mb.box(x - 0.6, x + 0.6, (y0 + y1) / 2 - 0.08, (y0 + y1) / 2 + 0.08, HC - 0.005, HC, "tube")
                x += 4.5
        else:
            y = y0 + 2.0
            while y < y1 - 1.0:
                mb.box((x0 + x1) / 2 - 0.08, (x0 + x1) / 2 + 0.08, y - 0.6, y + 0.6, HC - 0.005, HC, "tube")
                y += 4.0
    if commons is not None:                     # ラーニングコモンズの天井（壁も仕切りもない広間）
        mb.box(commons, NXb, N_IN, N_OUT, HR, HR + 0.05, "ceil")
    # 光庭の +X 側をふさぐ部屋（案内図の 3F・6F・7F）
    for label, x0, x1, y0, y1, face in spec.get("infill", []):
        room1(mb, label[1:] if label.startswith("=") else label, x0, x1, y0, y1, face, z=0.0, h=HC + 0.7)
        mb.hquad(x0, x1, y0, y1, 0.005, "lab_floor")
        mb.box(x0, x1, y0, y1, HR, HR + 0.05, "lab_ceil")
    # EV B（光庭の上、扉は +X の廊下を向く）と大きな階の数字（写真 6751）
    evb_open(mb, SY1, NY0, HC + 0.7, [-2.0])
    add_text(tx, str(fl), (EVB[1] + 0.09, -3.6, 2.2), (1, 0), 0.9)
    add_text(tx, "B", (EVB[1] + 0.09, -0.2, 2.6), (1, 0), 0.3)
    steel_door(mb, 'y', EVB[1], (S_C1 + S_IN) / 2, 0, +1)
    if xmin is None:
        # EV A（扉は -X の廊下を向く。教室棟.blend の EV A の真上）。かごの中をくり抜き、前の壁に扉の開口をあける
        for x0, x1, y0, y1 in sub(sub([(EVA[0] + 0.12, EVA[1], SY1, NY0)], EVA_CELLS[0]), EVA_CELLS[1]):
            mb.box(x0, x1, y0, y1, 0, HC + 0.7, "ev_b")
        wall(mb, 'y', EVA[0] + 0.06, SY1, NY0, 0, HC + 0.7, [(c, 1.1, 2.3) for c in EVA_DOORS_Y], key="ev_b", base=False)
        ev_doors_open(mb, EVA[0], EVA_DOORS_Y, 0, -1)
        ev_cell(mb, tx, fl)
        add_text(tx, "A", (EVA[0] - 0.09, -2.0, 2.6), (-1, 0), 0.3)
        steel_door(mb, 'y', EVA[0], (S_C1 + S_IN) / 2, 0, -1)
    # 廊下の突き当たりのごみ箱置き場（写真 6748）
    mb.box(SXb - 0.6, SXb, S_C0 + 0.2, S_C1 - 0.2, 0, 0.9, "ev_b")
    return mb, tx


# 2F〜14F。同じ形の階（4・5F、9〜14F）は 1 つのメッシュのリンク複製にして、番号札だけ階ごとに作る
COURT_FILLED = (2, 8)
shared = {}                     # spec 名 → 最初に作った階のオブジェクト（メッシュを共有する）
n_unique = 0
for fl in range(2, 15):
    sname = FLOOR_SPEC[fl]
    mb, tx = typical_floor(fl, SPECS[sname])
    if sname in shared:
        o = bpy.data.objects.new(f"研究棟_内装_{fl}F", shared[sname].data)     # 同じメッシュ（リンク複製）
        o.location = (0, 0, FZ[fl])
        o[GEN] = True
        icol.objects.link(o)
    else:
        name = "研究棟_内装_9F〜14F_標準階" if sname == "high" else f"研究棟_内装_{fl}F"
        shared[sname] = mb.build(name, icol, (0, 0, FZ[fl]))
        n_unique += len(shared[sname].data.vertices)
    tx.build(f"研究棟_内装_番号札_{fl}F", icol, (0, 0, FZ[fl]))
    if fl in COURT_FILLED:      # 2F・8F は光庭もふさがっている（1F と同じ）。床と天井だけの小さなメッシュ
        cf = MB()
        cx0 = GX1 if fl == 2 else KX                # 2F はゲートの穴の東だけ（8F はゲートの上）
        cf.box(cx0, SXb, S_IN, N_IN, -SLAB, 0, "carpet")
        cf.box(cx0, SXb, S_IN, N_IN, HR, HR + 0.05, "ceil")
        cf.build(f"研究棟_内装_光庭のふさぎ_{fl}F", icol, (0, 0, FZ[fl]))


# EV A のかごの上端（14F の天井の上、屋上の下）に発光パネルでふたをする
_cap = MB()
for _x0, _x1, _y0, _y1 in EVA_CELLS:
    _cap.box(_x0, _x1, _y0, _y1, ROOF - 0.35, ROOF - 0.3, "ev_lamp")
_cap.build("研究棟_内装_EV_Aのかごの天井", icol)

# ---------- 数を数える ----------
nv = sum(len(o.data.vertices) for o in col.objects if o.get(GEN))
ni = sum(len(o.data.vertices) for o in icol.objects if o.get(GEN) and o.data.users == 1)
ni += n_unique
print(f"研究棟: 外観 {nv} 頂点, 内装 {ni} 頂点（10〜14F はリンク複製なので 1 回だけ数える）")

if SAVE:
    bpy.ops.wm.save_mainfile()
    print("saved", bpy.data.filepath)
