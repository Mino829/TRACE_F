# 交流棟の内装（4F〜6F）：廊下・教室の間仕切りと扉・柱と黒い板・番号札・エレベーターホール・床と天井
# buildings/交流棟.blend を開いて exec(open(path, encoding="utf-8").read()) で実行する。
# 先に外観スクリプト（build_koryuto_exterior.py）を実行して、その寸法（FLOORS, BX, CW, WP など）を使う。
# 何度実行しても、コレクション「04_交流棟_内装」の中身を作り直すだけ。
#
# 間取りは 4F のフロア案内図（写真 6657）を、柱の間隔（窓 2 スパン = 6.35m）に合わせて置いたもの。実寸ではない。
#   廊下：本部棟側（-Y）の外壁沿い。教室：道路側（+Y）。教室棟側（+X）の端にエレベーター・トイレ・階段
#   4F：402・401 教室、教職員組合室   5F：501 教室、女子学生・女性教職員休憩室   6F：大講義室
#   道路側の端（-X）は机が置いてある広い場所（写真 6662）
# 間仕切りは写真 6659〜6661：白いパネル（下・上）＋目の高さのガラス、白い枠の扉、柱ごとに廊下へ出る黒い板
import os
import bpy, math

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else \
    r"C:\Users\wyuto\OneDrive\ドキュメント\blender-works\キャンパス\scripts"
exec(open(os.path.join(HERE, "build_koryuto_exterior.py"), encoding="utf-8").read(), globals())

IN_COL = "04_交流棟_内装"
IN_GEN = "交流棟_内装_gen"
CEIL = 3.0              # 天井の高さ（床から）
PY = -5.0               # 教室の間仕切りの線（廊下 = CW〜PY）
WT = 0.12               # 間仕切りの厚さ
COLX = [BX[i] for i in range(1, NB, 2)]     # 柱の X（外の 1F の丸柱と同じ列。6.35m おき）
CORE_X = COLX[7]        # ここから +X がエレベーター・トイレ・階段
LOUNGE_X = COLX[2]      # ここから -X が広い場所

# 部屋：(名前, 番号札, -X 端の柱の番号, +X 端の柱の番号, 間仕切りにガラスがあるか)
ROOMS = {
    2: [("402教室", "402", 5, 7, True), ("401教室", "401", 3, 5, True), ("教職員組合室", "SIT Union", 2, 3, False)],
    3: [("501教室", "501", 3, 7, True), ("女子学生・女性教職員休憩室", "Ladies' Lounge", 2, 3, False)],
    4: [("大講義室", "Lecture Hall", 2, 7, True)],
}
FLOOR_NAME = {2: "4F", 3: "5F", 4: "6F"}

# ---------- マテリアル ----------
IM = dict(
    carpet=mat("交流棟内装_カーペット", (0.06, 0.06, 0.065), 0.9),
    stripe=mat("交流棟内装_床の白い線", (0.55, 0.55, 0.53), 0.8),
    ceil=mat("交流棟内装_天井", (0.78, 0.77, 0.74), 0.9),
    light=mat("交流棟内装_照明", (1.0, 1.0, 0.97), 0.3),
    vent=mat("交流棟内装_空調の吹き出し", (0.45, 0.45, 0.44), 0.6),
    wall=mat("交流棟内装_白い壁", (0.80, 0.79, 0.76), 0.6),
    panel=mat("交流棟内装_間仕切りパネル", (0.84, 0.83, 0.80), 0.4),
    pglass=mat("交流棟内装_間仕切りのガラス", (0.60, 0.68, 0.70), 0.05, alpha=0.25),
    trim=mat("交流棟内装_枠_銀", (0.66, 0.67, 0.68), 0.3, 0.8),
    base=mat("交流棟内装_幅木", (0.35, 0.35, 0.35), 0.5),
    col=mat("交流棟内装_柱", (0.80, 0.79, 0.76), 0.5),
    fin=mat("交流棟内装_黒い板", (0.02, 0.02, 0.025), 0.35),
    signtext=mat("交流棟内装_番号札の文字", (0.95, 0.95, 0.95), 0.4),
    door=mat("交流棟内装_扉", (0.86, 0.85, 0.82), 0.4),
    dglass=mat("交流棟内装_扉のガラス", (0.55, 0.62, 0.64), 0.05, alpha=0.3),
    evwall=mat("交流棟内装_エレベーターホールの黒い壁", (0.03, 0.03, 0.035), 0.4),
    evdoor=mat("交流棟内装_エレベーター扉", (0.62, 0.63, 0.64), 0.3, 0.8),
    wc=mat("交流棟内装_トイレの入口", (0.12, 0.12, 0.13), 0.6),
    board=mat("交流棟内装_黒板", (0.08, 0.14, 0.11), 0.7),
)
MAT.update(IM)

# ---------- 準備 ----------
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


def build_in(mb, name):
    o = mb.build(name)
    del o[GEN]
    o[IN_GEN] = True
    col.objects.unlink(o)
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


# ---------- 部品 ----------
def partition_panel(mb, xa, xb, z, glass=True):
    """間仕切りの 1 区画：下の白・目の高さのガラス（銀の枠）・上の白。y = PY"""
    y0, y1 = PY - WT / 2, PY + WT / 2
    if not glass:
        mb.box(xa, xb, y0, y1, z, z + CEIL, "panel")
    else:
        mb.box(xa, xb, y0, y1, z, z + 0.95, "panel")
        mb.box(xa, xb, y0, y1, z + 2.35, z + CEIL, "panel")
        mb.box(xa, xb, PY - 0.005, PY + 0.005, z + 0.95, z + 2.35, "pglass")
        for ya, yb in ((y0 - 0.01, y0 + 0.02), (y1 - 0.02, y1 + 0.01)):          # ガラスの枠（廊下側・教室側）
            mb.box(xa, xb, ya, yb, z + 0.93, z + 0.97, "trim")
            mb.box(xa, xb, ya, yb, z + 2.33, z + 2.37, "trim")
    # パネルの継ぎ目（廊下側）と幅木
    mb.box(xa, xa + 0.01, y0 - 0.008, y0, z, z + CEIL, "trim")
    mb.box(xa, xb, y0 - 0.01, y1 + 0.01, z, z + 0.08, "base")


def door(mb, xa, xb, z, label_glass=True):
    """白い枠の扉（写真 6661：大きなガラスの入った片引き戸）。枠の中は廊下から少し奥"""
    y0, y1 = PY - WT / 2, PY + WT / 2
    DH = 2.6
    fw = 0.06
    mb.box(xa, xb, y0, y1, z + DH, z + CEIL, "panel")                         # 扉の上の白
    mb.box(xa, xa + fw, y0 - 0.02, y1 + 0.02, z, z + DH + fw, "door")          # 枠
    mb.box(xb - fw, xb, y0 - 0.02, y1 + 0.02, z, z + DH + fw, "door")
    mb.box(xa, xb, y0 - 0.02, y1 + 0.02, z + DH, z + DH + fw, "door")
    # 扉（白い框＋ガラス）
    a, b = xa + fw, xb - fw
    dy0, dy1 = PY - 0.02, PY + 0.02
    m = 0.12
    if label_glass:
        mb.box(a, b, dy0, dy1, z, z + 0.35, "door")
        mb.box(a, b, dy0, dy1, z + DH - m, z + DH, "door")
        mb.box(a, a + m, dy0, dy1, z + 0.35, z + DH - m, "door")
        mb.box(b - m, b, dy0, dy1, z + 0.35, z + DH - m, "door")
        mb.box(a + m, b - m, PY - 0.004, PY + 0.004, z + 0.35, z + DH - m, "dglass")
    else:
        mb.box(a, b, dy0, dy1, z, z + DH, "door")
    hx = a + 0.12                                                              # 取っ手（縦の引き手）
    for s in (-1, 1):
        yy = PY + s * 0.03
        mb.box(hx - 0.015, hx + 0.015, min(yy, yy + s * 0.03), max(yy, yy + s * 0.03), z + 0.85, z + 1.25, "trim")


def column(mb, x, z):
    """柱：廊下の窓側の角柱・間仕切りの丸柱・道路側の窓の角柱"""
    mb.box(x - 0.4, x + 0.4, CW + 0.1, CW + 1.0, z, z + CEIL, "col")
    mb.box(x - 0.41, x + 0.41, CW + 0.1, CW + 1.01, z, z + 0.08, "base")
    mb.cyl(x, PY, 0.45, z, z + CEIL, "col", seg=20)
    mb.cyl(x, PY, 0.46, z, z + 0.08, "base", seg=20)
    mb.box(x - 0.45, x + 0.45, WP - 1.1, WP - 0.3, z, z + CEIL, "col")


def black_fin(mb, x, z, labels=()):
    """柱の前に立つ黒い板（廊下へ 1.1m 出る）。labels = [(文字, 向き +1/-1), ...]"""
    t = 0.05
    y0, y1 = PY - 0.45 - 1.1, PY - 0.45 + 0.1
    mb.box(x - t, x + t, y0, y1, z, z + CEIL - 0.1, "fin")
    for s, d in labels:
        size = 0.32 if len(s) <= 4 else 0.13
        add_text(mb, s, (x + d * (t + 0.001), (y0 + y1) / 2, z + 2.25), (d, 0), size)


# ---------- 階ごとに作る ----------
X0, X1 = -EX, EX
Y0, Y1 = CW + 0.1, WP - 0.3
total_in = 0
for k in range(IN_FROM, NF):
    z = FLOORS[k]
    fl = FLOOR_NAME[k]
    rooms = ROOMS[k]

    # 床・天井・照明
    fc = MB()
    fc.box(X0, X1, Y0, Y1, z, z + 0.02, "carpet")
    fc.box(X0, X1, Y0, Y1, z + CEIL, z + CEIL + 0.05, "ceil")
    for x in COLX:                                    # 柱の列ごとの床の白い線（廊下を横切る、2 本）
        for dx in (-0.25, 0.25):
            fc.box(x + dx - 0.06, x + dx + 0.06, Y0, PY - 0.5, z + 0.02, z + 0.025, "stripe")
    x = X0 + 1.6
    while x < X1 - 1.0:                               # ダウンライト（廊下は 1 列、部屋は 3 列）
        for y in (CW + 3.5, PY + 3.0, PY + 7.5, PY + 12.0):
            fc.box(x - 0.12, x + 0.12, y - 0.12, y + 0.12, z + CEIL - 0.005, z + CEIL, "light")
        x += 3.175
    for x in COLX[:-1]:                               # 空調の吹き出し
        xm = x + 3.175
        for y in (CW + 2.2, PY + 5.0, PY + 10.5):
            fc.box(xm - 0.3, xm + 0.3, y - 0.3, y + 0.3, z + CEIL - 0.006, z + CEIL - 0.001, "vent")
    build_in(fc, f"交流棟_{fl}_床と天井")

    # 柱と黒い板
    cf = MB()
    for x in COLX:
        column(cf, x, z)
    labeled = {}
    for name, label, ia, ib, glass in rooms:
        labeled.setdefault(ib, []).append((label, -1))   # 部屋の +X 端の板：-X 側の面（部屋の扉の近く）
        labeled.setdefault(ia, []).append((label, 1))
    for i, x in enumerate(COLX):
        if 2 <= i <= 7:
            black_fin(cf, x, z, labeled.get(i, ()))
    build_in(cf, f"交流棟_{fl}_柱と黒い板")

    # 教室の間仕切り・扉・部屋の間の壁
    pw = MB()
    for name, label, ia, ib, glass in rooms:
        xa, xb = COLX[ia], COLX[ib]
        spans = [(COLX[j], COLX[j + 1]) for j in range(ia, ib)]
        for j, (ca, cb) in enumerate(spans):
            a, b = ca + 0.45, cb - 0.45
            n = 4
            mods = [(a + (b - a) * m / n, a + (b - a) * (m + 1) / n) for m in range(n)]
            # 扉の位置：部屋の両端の区画（1 区画だけの部屋は 1 つ）、大講義室は真ん中にも
            doors = set()
            if j == len(spans) - 1:
                doors.add(n - 1)
            if j == 0 and len(spans) > 1:
                doors.add(0)
            if len(spans) >= 5 and j == len(spans) // 2:
                doors.add(1)
            for m, (ma, mb_) in enumerate(mods):
                if m in doors:
                    door(pw, ma, mb_, z, glass)
                else:
                    partition_panel(pw, ma, mb_, z, glass)
        # 部屋の両端の壁（間仕切りの線から道路側の外壁まで）
        for xw in (xa, xb):
            pw.box(xw - WT / 2, xw + WT / 2, PY + 0.45, WP - 1.1, z, z + CEIL, "wall")
        # 黒板（教室の +X 側の壁、教室側の面）
        if glass:
            pw.box(xb - WT / 2 - 0.03, xb - WT / 2, PY + 2.0, WP - 2.5, z + 0.9, z + 2.1, "board")
    build_in(pw, f"交流棟_{fl}_教室の間仕切りと扉")

    # 教室棟側の端：エレベーター・トイレ・階段（写真 6651・6653・6654）
    cr = MB()
    # 402 の +X 側の壁（教室とホールの間）は上の部屋の壁で作ってある
    # エレベーターとトイレのかたまり：廊下側の面は黒い壁、エレベーターの扉 2 つ
    bx0, bx1, by0, by1 = CORE_X + 5.0, CORE_X + 10.5, -7.5, 6.0
    cr.box(bx0, bx1, by0, by1, z, z + CEIL, "wall", keys6=["wall", "wall", "wall", "wall", "wall", "evwall"])
    for ya in (-6.6, -4.6):
        cr.box(bx0 - 0.03, bx0, ya, ya + 1.1, z, z + 2.3, "evdoor")
        cr.box(bx0 - 0.05, bx0, ya - 0.08, ya + 1.18, z + 2.3, z + 2.38, "trim")
        cr.box(bx0 - 0.031, bx0, ya + 0.545, ya + 0.555, z, z + 2.3, "trim")     # 扉の合わせ目
    cr.box(bx0 - 0.04, bx0, -3.0, -2.6, z + 1.0, z + 1.4, "trim")              # 呼びボタン
    add_text(cr, fl[0], (bx0 - 0.002, -2.0, z + 2.0), (-1, 0), 0.9)          # 階数の大きな数字（写真 6653）
    for ya, yb in ((-0.5, 1.4), (3.2, 5.1)):                                # トイレの入口（男・女）
        cr.box(bx0 - 0.02, bx0, ya, yb, z, z + 2.4, "wc")
    # 階段室（本部棟側の角）
    sx0, sy1 = EX - 4.2, -6.0
    cr.box(sx0, sx0 + WT, Y0, sy1, z, z + CEIL, "wall")
    cr.box(sx0, EX, sy1 - WT / 2, sy1 + WT / 2, z, z + CEIL, "wall")
    cr.box(sx0 - 0.02, sx0, -8.6, -7.2, z, z + 2.3, "evdoor")                 # 階段の扉（鉄の扉）
    build_in(cr, f"交流棟_{fl}_エレベーターホール")

    total_in += sum(len(o.data.vertices) for o in icol.objects if o.name.startswith(f"交流棟_{fl}"))

print("交流棟 内装 DONE verts", total_in)
