# 本部棟の内装（1F ロビーの床・2F・3F〜14F・3F↔4F の大階段）：部屋の区切り・教室番号の札・エレベーター・柱・床と天井
# buildings/本部棟.blend を開いて exec(open(path, encoding="utf-8").read()) で実行するか、
#   blender -b buildings/本部棟.blend --python scripts/build_honbuto_interior.py -- --save
# で実行する（--save で保存まで）。
# 先に外観スクリプト（build_honbuto_exterior.py）を実行して、その寸法（MASSES, rect など）を使う。
# 何度実行しても、コレクション「05_本部棟_内装」の中身を作り直すだけ。
#
# 間取りは、各階のフロア案内図（image/11_撮影写真_本部棟/内装_jpg）を今の建物の形に合わせて置いたもの。実寸ではない。
#   3・4F：教室（2301〜2306 / 2401〜2408）
#   5〜9F：研究室・実験室＋真ん中のオープンラボ（エレベーター A・B）
#   10〜14F：高層棟だけ。Lab・会議室（エレベーター B だけ）
import os
import bpy, math

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else \
    r"C:\Users\wyuto\OneDrive\ドキュメント\blender-works\キャンパス\scripts"
exec(open(os.path.join(HERE, "build_honbuto_exterior.py"), encoding="utf-8").read(), globals())

IN_COL = "05_本部棟_内装"
CEIL = 3.0          # 天井の高さ（床から）
WALL_T = 0.12       # 間仕切りの厚さ


def floor_z(f):
    return FL[f]        # 外観スクリプトの階の高さの表（教室棟に合わせた）


# ---------- マテリアル ----------
IM = dict(
    part=mat("内装_間仕切り", (0.86, 0.86, 0.85), 0.5),
    partglass=mat("内装_間仕切りのすりガラス", (0.78, 0.83, 0.85), 0.1, alpha=0.5),
    floor=mat("内装_床", (0.42, 0.42, 0.41), 0.8),
    ceil=mat("内装_天井", (0.9, 0.9, 0.89), 0.8),
    core=mat("内装_コアの壁", (0.88, 0.87, 0.85), 0.6),
    col=mat("内装_柱", (0.9, 0.9, 0.89), 0.5),
    door=mat("内装_ドア", (0.88, 0.88, 0.87), 0.4),
    doorglass=mat("内装_ドアのガラス", (0.6, 0.66, 0.68), 0.05, alpha=0.4),
    evdoor=mat("内装_エレベーター扉", (0.62, 0.63, 0.64), 0.3, 0.8),
    sign=mat("内装_番号札_黒", (0.02, 0.02, 0.025), 0.4),
    signtext=mat("内装_番号札_文字", (0.95, 0.95, 0.95), 0.4),
    stair=mat("内装_大階段_木", (0.72, 0.47, 0.22), 0.45),
    rail=mat("内装_手すり", (0.2, 0.21, 0.23), 0.4, 0.6),
)
MAT.update(IM)


def emit_mat(name, rgb, strength):
    """光る面（エレベーターの中。暗くて怖いので明るくする）。glTF には KHR_materials_emissive_strength で出る"""
    m = mat(name, rgb, 0.6)
    b = bsdf(m)
    b.inputs["Emission Color"].default_value = (*rgb, 1)
    b.inputs["Emission Strength"].default_value = strength
    return m


MAT["evlight"] = emit_mat("内装_エレベーターの中（発光）", (1.0, 0.96, 0.88), 3.0)

# ---------- 準備 ----------
icol = bpy.data.collections.get(IN_COL)
if icol is None:
    icol = bpy.data.collections.new(IN_COL)
    scene.collection.children.link(icol)
for o in list(bpy.data.objects):
    if o.get("本部棟_内装_gen"):
        me = o.data
        bpy.data.objects.remove(o)
        if me is not None and me.users == 0:
            bpy.data.meshes.remove(me)


def build_in(mb, name):
    o = mb.build(name)
    del o["本部棟_gen"]
    o["本部棟_内装_gen"] = True
    col.objects.unlink(o)
    icol.objects.link(o)
    return o


# 文字（番号）をメッシュにして MB に足す（標準フォントには日本語がないので、札の文字は英数字にする）
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


# ---------- 平面の範囲（建物の座標） ----------
TR = (34.6, 54.7, -31.1, 14.3)       # 高層棟＋中央棟（研究室・教室のメインの四角）
WING = (-1.8, 34.6, -0.4, 14.3)      # 低層棟（交流棟側の翼）
TOP = (34.6, 54.7, -31.1, -4.9)      # 10〜14F（高層棟だけ）


def wall(mb, x0, x1, y0, y1, z, key="part"):
    """間仕切り：下の白いパネル・目の高さのすりガラス・上の白、の 3 段（面を分けて色で表す）"""
    for zl, zh, k in ((z, z + 1.0, key), (z + 1.0, z + 2.5, "partglass"), (z + 2.5, z + CEIL, key)):
        mb.box(x0, x1, y0, y1, zl, zh, k, skip=(0, 1))


def room(mb, r, z, area, label=None, door=None):
    """r=(x0,x1,y0,y1) の部屋。外壁に面した辺には壁を作らない。door=(辺, 位置0〜1)"""
    x0, x1, y0, y1 = r
    ax0, ax1, ay0, ay1 = area
    t = WALL_T / 2
    sides = {
        "-y": (abs(y0 - ay0) > 0.3, lambda: wall(mb, x0, x1, y0 - t, y0 + t, z)),
        "+y": (abs(y1 - ay1) > 0.3, lambda: wall(mb, x0, x1, y1 - t, y1 + t, z)),
        "-x": (abs(x0 - ax0) > 0.3, lambda: wall(mb, x0 - t, x0 + t, y0, y1, z)),
        "+x": (abs(x1 - ax1) > 0.3, lambda: wall(mb, x1 - t, x1 + t, y0, y1, z)),
    }
    for k, (inner, fn) in sides.items():
        if inner:
            fn()
    if label is None:
        return
    # ドアのある辺（指定がなければ、部屋の内側の辺のうち建物の真ん中に近い方）
    if door is None:
        cx, cy = (ax0 + ax1) / 2, (ay0 + ay1) / 2
        rx, ry = (x0 + x1) / 2, (y0 + y1) / 2
        cand = [k for k, (inner, _) in sides.items() if inner]
        if not cand:
            return
        dirs = {"-y": (0, -1), "+y": (0, 1), "-x": (-1, 0), "+x": (1, 0)}
        door = (max(cand, key=lambda k: dirs[k][0] * (cx - rx) + dirs[k][1] * (cy - ry)), 0.8)
    side, p = door
    n = {"-y": (0, -1), "+y": (0, 1), "-x": (-1, 0), "+x": (1, 0)}[side]
    if side in ("-y", "+y"):
        wy = (y0 if side == "-y" else y1) + n[1] * (t + 0.01)
        dx = x0 + (x1 - x0) * p
        mb.box(dx - 0.5, dx + 0.5, wy - 0.01, wy + 0.01, z, z + 2.3, "door")
        mb.box(dx - 0.38, dx + 0.38, wy - 0.015, wy + 0.015, z + 0.9, z + 2.1, "doorglass")
        sx = dx - 0.75
        mb.box(sx - 0.14, sx + 0.14, wy - 0.012, wy + 0.012, z, z + 2.6, "sign")
        add_text(mb, label, (sx, wy + n[1] * 0.015, z + 2.1), n, 0.08 if len(label) > 4 else 0.105)
    else:
        wx = (x0 if side == "-x" else x1) + n[0] * (t + 0.01)
        dy = y0 + (y1 - y0) * p
        mb.box(wx - 0.01, wx + 0.01, dy - 0.5, dy + 0.5, z, z + 2.3, "door")
        mb.box(wx - 0.015, wx + 0.015, dy - 0.38, dy + 0.38, z + 0.9, z + 2.1, "doorglass")
        sy = dy - 0.75
        mb.box(wx - 0.012, wx + 0.012, sy - 0.14, sy + 0.14, z, z + 2.6, "sign")
        add_text(mb, label, (wx + n[0] * 0.015, sy, z + 2.1), n, 0.08 if len(label) > 4 else 0.105)


def split(a, b, n):
    return [(a + (b - a) * i / n, a + (b - a) * (i + 1) / n) for i in range(n)]


# ---------- 階ごとの間取り ----------
def plan_classroom(f):
    """3・4F：教室"""
    R = []
    if f == 3:
        for (xa, xb), no in zip([(48.0, 54.7), (42.5, 48.0), (34.6, 42.5)], ("2301", "2302", "2303")):
            R.append((TR, (xa, xb, -31.1, -22.5), no))
        R.append((TR, (34.6, 43.0, 6.0, 14.3), "2304"))
        R.append((TR, (28.0, 34.6, 7.5, 14.3), "2305"))
        R.append((TR, (28.0, 34.6, 1.0, 7.5), "2306"))
    else:
        for (xa, xb), no in zip(split(34.6, 54.7, 3), ("2401", "2402", "2403")):
            R.append((TR, (xa, xb, 6.0, 14.3), no))
        for (ya, yb), no in zip(split(-20.0, 4.0, 4)[::-1], ("2404", "2405", "2406", "2407")):
            R.append((TR, (50.0, 54.7, ya, yb), no))
        R.append((TR, (50.0, 54.7, -27.0, -20.0), "Global"))
        R.append((TR, (34.6, 41.0, -31.1, -25.0), "2408"))
        R.append((TR, (28.0, 34.6, 7.0, 14.3), "Multi"))
        R.append((TR, (28.0, 34.6, -0.4, 6.5), "Faculty"))
    return R


def plan_lab(f):
    """5〜9F：研究室・実験室とオープンラボ"""
    p = "%02d" % f
    R = []
    for (ya, yb), no in zip(split(-31.1, -19.0, 3), ("K01", "K02", "K03")):
        R.append((TR, (50.5, 54.7, ya, yb), p + no))
    for (ya, yb), no in zip(split(-15.5, 14.3, 5), ("K06", "K08", "K10", "K11", "K13")):
        R.append((TR, (50.5, 54.7, ya, yb), p + no))
    for (xa, xb), no in zip(split(34.6, 50.5, 3), ("F01", "G01", "H01")):
        R.append((TR, (xa, xb, -31.1, -26.5), p + no))
    for (xa, xb), no in zip(split(34.6, 50.5, 3), ("I12", "H12", "F12")):
        R.append((TR, (xa, xb, 10.0, 14.3), p + no))
    for (xa, xb), no in zip(split(38.0, 49.0, 3), ("I10", "H10", "G10")):
        R.append((TR, (xa, xb, 5.5, 8.5), p + no))
    R.append((TR, (38.0, 43.5, 2.5, 5.5), "Prep"))
    R.append((TR, (43.5, 49.0, 2.5, 5.5), p + "G09"))
    R.append((TR, (28.0, 34.6, 7.5, 14.3), p + "A09"))
    R.append((TR, (28.0, 34.6, 1.0, 7.5), p + "A08"))
    # 低層棟：真ん中の廊下の両側に研究室
    top = floor_z(f) + CEIL <= MB_BY["L"]["zt"] - 2.4
    if top:
        for i, (xa, xb) in enumerate(split(-1.8, 26.0, 6)):
            R.append((WING, (xa, xb, 8.3, 14.3), p + "B%02d" % (i * 2 + 1)))
            R.append((WING, (xa, xb, -0.4, 5.6), p + "B%02d" % (i * 2 + 2)))
    return R


def plan_top(f):
    """10〜14F：高層棟だけ"""
    R = []
    if f == 10:
        names = ["Lab %d" % i for i in range(1, 13)]
    else:
        names = ["%d%02d" % (f, i) for i in range(1, 13)]
    ys = split(-31.1, -11.0, 4)
    for (ya, yb), no in zip(ys, names[0:4]):
        R.append((TOP, (50.5, 54.7, ya, yb), no))
    for (ya, yb), no in zip(ys, names[4:8]):
        R.append((TOP, (34.6, 38.8, ya, yb), no))
    R.append((TOP, (41.0, 48.0, -20.0, -15.5), "Meeting 1" if f == 10 else names[8]))
    R.append((TOP, (41.0, 48.0, -24.5, -20.0), "Meeting 2" if f == 10 else names[9]))
    R.append((TOP, (40.0, 50.0, -31.1, -27.0), "Incubation" if f == 10 else names[10]))
    return R


def floors():
    for f in range(3, 15):
        if f <= 4:
            yield f, "教室", plan_classroom(f)
        elif f <= 9:
            yield f, "研究室", plan_lab(f)
        else:
            yield f, "上層", plan_top(f)


# ---------- エレベーター・コア ----------
EV_B = dict(x=(37.0, 45.0), y=(-9.0, -6.3), face=+1, letter="B", stops="14|10·4·1")
EV_A = dict(x=(37.0, 45.0), y=(-1.2, 1.5), face=-1, letter="A", stops="9|2·1")


def elevators(mb, ev, z):
    x0, x1 = ev["x"]
    y0, y1 = ev["y"]
    mb.box(x0, x1, y0, y1, z, z + CEIL, "core", skip=(0, 1))
    wy = y1 if ev["face"] > 0 else y0
    n = (0, ev["face"])
    for c in split(x0, x1, 3):
        cx = (c[0] + c[1]) / 2
        mb.box(cx - 0.55, cx + 0.55, wy - 0.02, wy + 0.02, z, z + 2.3, "evdoor")
        sx = cx + 0.8
        mb.box(sx - 0.1, sx + 0.1, wy - 0.025, wy + 0.025, z, z + 2.6, "sign")
        add_text(mb, ev["letter"], (sx, wy + n[1] * 0.03, z + 2.35), n, 0.14)


# EV B の中央の区画をエレベーターのかご（シャフト）にする。グラフのエレベーターの点（trace/add_nodes_5.py の HQ_EV）は
#   (41.0, -5.6) = この区画の扉の 0.7m 前。かごは床・天井を貫く穴で、1F から 14F までつながる（かごの中の高さを真上に動く）
BAY = (39.667, 42.333)                       # EV B の 3 区画のうち真ん中（x）
SH = (BAY[0] + 0.12, BAY[1] - 0.12, EV_B["y"][0] + 0.12, EV_B["y"][1] - 0.2)      # かごの中（床・天井の穴）
OPEN_W = 1.1                                 # 扉の開口の幅


def shaft_level(mb, f, z, z_top):
    """階 f の高さ z〜z_top のかご：内側は発光する壁。扉は開いた状態（扉は開口の両脇に寄せて置く）"""
    cx = (BAY[0] + BAY[1]) / 2
    ya, yb = EV_B["y"]
    t = 0.12
    # 奥の壁（内側 = +y）と両脇の壁（内側 = +x / -x）。面の順: 下, 上, -y, +x, +y, -x
    mb.box(BAY[0], BAY[1], ya, ya + t, z, z_top, "core", keys6=["core", "core", "core", "core", "evlight", "core"], skip=(0, 1))
    mb.box(BAY[0], BAY[0] + t, ya + t, yb - 0.2, z, z_top, "core", keys6=["core", "core", "core", "evlight", "core", "core"], skip=(0, 1))
    mb.box(BAY[1] - t, BAY[1], ya + t, yb - 0.2, z, z_top, "core", keys6=["core", "core", "core", "core", "core", "evlight"], skip=(0, 1))
    # 手前の壁（扉の面）：開口の左右と、開口の上
    kf = ["core", "core", "evlight", "core", "core", "core"]
    mb.box(BAY[0], cx - OPEN_W / 2, yb - 0.2, yb, z, z_top, "core", keys6=kf, skip=(0, 1))
    mb.box(cx + OPEN_W / 2, BAY[1], yb - 0.2, yb, z, z_top, "core", keys6=kf, skip=(0, 1))
    mb.box(cx - OPEN_W / 2, cx + OPEN_W / 2, yb - 0.2, yb, z + 2.3, z_top, "core", keys6=kf, skip=(0, 1))
    # 開いた扉（左右に 0.5m ずつ寄せて、ホール側に少し出す）
    for xa, xb in ((cx - OPEN_W / 2 - 0.5, cx - OPEN_W / 2), (cx + OPEN_W / 2, cx + OPEN_W / 2 + 0.5)):
        mb.box(xa, xb, yb, yb + 0.04, z, z + 2.3, "evdoor")
    # 階の札（扉の上の黒い板に白い文字）と、扉の脇の B
    mb.box(cx - 0.45, cx + 0.45, yb + 0.04, yb + 0.06, z + 2.35, z + 2.85, "sign")
    add_text(mb, "%dF" % f, (cx, yb + 0.06, z + 2.6), (0, 1), 0.3)
    mb.box(BAY[1] + 0.05, BAY[1] + 0.25, yb, yb + 0.05, z, z + 2.6, "sign")
    add_text(mb, "B", (BAY[1] + 0.15, yb + 0.05, z + 2.35), (0, 1), 0.14)


def core(mb, f, z):
    # EV B：両脇の区画は今までどおり（扉は閉）。中央の区画はかご
    x0, x1 = EV_B["x"]
    y0, y1 = EV_B["y"]
    mb.box(x0, BAY[0], y0, y1, z, z + CEIL, "core", skip=(0, 1))
    mb.box(BAY[1], x1, y0, y1, z, z + CEIL, "core", skip=(0, 1))
    for c in (split(x0, x1, 3)[0], split(x0, x1, 3)[2]):
        cxx = (c[0] + c[1]) / 2
        mb.box(cxx - 0.55, cxx + 0.55, y1 - 0.02, y1 + 0.02, z, z + 2.3, "evdoor")
    shaft_level(mb, f, z, FL[f + 1] if f < 14 else z + CEIL)
    if f == 14:
        quad(mb, SH[0], SH[1], SH[2], SH[3], z + CEIL - 0.01, "evlight", up=False)   # かごの天井（発光）
    if f <= 9:
        elevators(mb, EV_A, z)
    # 階段・トイレのかたまり
    y1 = 1.5 if f <= 9 else -4.9
    mb.box(45.5, 49.5, -9.0, y1, z, z + CEIL, "core", skip=(0, 1))
    # 階の大きな数字（エレベーターホールの壁）
    add_text(mb, str(f), (45.5 - 0.01, -4.0, z + 1.6), (-1, 0), 0.9, key="sign")


# ---------- 柱 ----------
COLS_TR = [(x, y) for x in (41.3, 48.0) for y in (-23.0, -15.5, 11.5)]
COLS_WING = [(x, y) for x in (4.5, 11.0, 17.5, 24.0) for y in (2.0, 12.0)]


def columns(mb, f, z):
    pts = list(COLS_TR)
    if f <= 9:
        pts += [(x, y) for x, y in COLS_WING if not (f >= 5 and (y < 5.6 or y > 8.3))] if f <= 4 else []
    if f >= 10:
        pts = [(x, y) for x, y in pts if y < -4.9]
    for x, y in pts:
        mb.box(x - 0.45, x + 0.45, y - 0.45, y + 0.45, z, z + CEIL, "col", skip=(0, 1))


# ---------- 床と天井（その階にある棟ごと） ----------
def quad(mb, x0, x1, y0, y1, zv, key, up=True):
    pts = [(x0, y0, zv), (x1, y0, zv), (x1, y1, zv), (x0, y1, zv)]
    mb.face(pts if up else pts[::-1], key)


def slab_quad(mb, x0, x1, y0, y1, zv, key, up, hole=None):
    """四角い床・天井。hole=(x0,x1,y0,y1)（またはその一覧）があれば、その分を四角く抜く（四角の外側を 4 枚に分ける）"""
    holes = [] if hole is None else (list(hole) if isinstance(hole, list) else [hole])
    clipped = []
    for h in holes:
        c = (max(h[0], x0), min(h[1], x1), max(h[2], y0), min(h[3], y1))
        if c[0] < c[1] and c[2] < c[3]:
            clipped.append(c)
    if not clipped:
        quad(mb, x0, x1, y0, y1, zv, key, up)
        return
    hx0, hx1, hy0, hy1 = clipped[0]
    for r in ((x0, hx0, y0, y1), (hx1, x1, y0, y1), (hx0, hx1, y0, hy0), (hx0, hx1, hy1, y1)):
        if r[0] < r[1] - 1e-6 and r[2] < r[3] - 1e-6:
            slab_quad(mb, *r, zv, key, up, clipped[1:])


def slabs(mb, z, floor_hole=None, ceil_hole=None):
    for m in MASSES:
        if m["kind"] not in ("louver", "white"):
            continue
        if not (m["zb"] - 0.01 <= z and z + CEIL <= m["zt"] - (2.4 if m["kind"] == "louver" else 0.5)):
            continue
        x0, x1, y0, y1 = rect(m, z + 1.0)
        e = 0.06
        slab_quad(mb, x0 + e, x1 - e, y0 + e, y1 - e, z + 0.02, "floor", True, floor_hole)
        slab_quad(mb, x0 + e, x1 - e, y0 + e, y1 - e, z + CEIL, "ceil", False, ceil_hole)


# ---------- 1F ロビー・2F（高層棟_1Fロビーの中）と 3F↔4F の大階段 ----------
LOBBY = MB_BY["TL"]
LB = (LOBBY["x0"], LOBBY["x1"], LOBBY["y0"], LOBBY["y1"])
Z2 = G + 6.0            # 2F の床（地面から 6m。教室棟の 2F と同じ）


def plan_2f():
    """2F：5・6F と同じ研究室の作り（ロビーの四角の中に、+X 側と -Y 側の外壁沿いの部屋だけ）"""
    R = []
    for (ya, yb), no in zip(split(LB[2], -9.5, 4), ("K01", "K02", "K03", "K04")):
        R.append((LB, (49.5, LB[1], ya, yb), "02" + no))
    for (xa, xb), no in zip(split(LB[0], 49.5, 3), ("F01", "G01", "H01")):
        R.append((LB, (xa, xb, LB[2], -25.5), "02" + no))
    return R


# 大階段：中央の吹き抜け（4 回の見取り図の真ん中の階段）。3F 側が -Y、4F 側が +Y（EV B の前まで）。
#   見取り図と写真（3回から4回の間にある階段）から。柱（41.3, 48.0）と 2301〜2303（Y ≤ -22.5）、EV B（Y ≥ -9.0）を避けた
STAIR = (43.0, 46.6, -21.4, -9.6)
N_STEP = 26


def build_stair():
    mb = MB()
    x0, x1, ys, ye = STAIR
    zb, zt = floor_z(3) + 0.02, floor_z(4) + 0.02
    rise, run = (zt - zb) / N_STEP, (ye - ys) / N_STEP
    prof = [(ys, zb)]
    for i in range(N_STEP):
        prof += [(ys + i * run, zb + (i + 1) * rise), (ys + (i + 1) * run, zb + (i + 1) * rise)]
    prof.append((ye, zb))
    mb.prism_x(prof, x0, x1, "stair")
    # 4F の床の吹き抜けの縁の手すり（両側と、3F 側の端）
    z4 = floor_z(4)
    for xa, xb, ya, yb in ((x0 - 0.05, x0, ys, ye), (x1, x1 + 0.05, ys, ye), (x0, x1, ys - 0.05, ys)):
        mb.box(xa, xb, ya, yb, z4, z4 + 1.1, "rail")
    return build_in(mb, "本部棟内装_大階段_3F-4F")


# ---------- 組み立て ----------
for f, kind, rooms in floors():
    z = floor_z(f)
    mb = MB()
    slabs(mb, z, floor_hole=[SH] + ([STAIR] if f == 4 else []),
          ceil_hole=([SH] if f < 14 else []) + ([STAIR] if f == 3 else []))
    for area, r, label in rooms:
        room(mb, r, z, area, label)
    core(mb, f, z)
    columns(mb, f, z)
    o = build_in(mb, "本部棟内装_%02dF_%s" % (f, kind))

build_stair()

# 2F（研究室の作り）：床・天井と部屋。1F ロビーの天井を兼ねるので、2F の床の下側にも面を張る
mb = MB()
x0, x1, y0, y1 = LB
slab_quad(mb, x0 + 0.06, x1 - 0.06, y0 + 0.06, y1 - 0.06, Z2 + 0.02, "floor", True, SH)
slab_quad(mb, x0 + 0.06, x1 - 0.06, y0 + 0.06, y1 - 0.06, Z2 - 0.02, "ceil", False, SH)
slab_quad(mb, x0 + 0.06, x1 - 0.06, y0 + 0.06, y1 - 0.06, Z2 + CEIL, "ceil", False, SH)
# EV 前のホールの床（ロビーの 2F の床から EV B の扉の前まで。グラフの hq-2f-ev (41.0, -5.6) がここ）
HALL2 = (37.0, 45.0, LB[3], -1.2)
quad(mb, *HALL2, Z2 + 0.02, "floor")
quad(mb, *HALL2, Z2 - 0.02, "ceil", up=False)
for area, r, label in plan_2f():
    room(mb, r, Z2, area, label)
build_in(mb, "本部棟内装_02F_研究室")

# 1F・2F のかご（床 G〜3F の床まで）。扉は開いた状態。1F の床はロビーの床（G）、2F の床は上の 2F の床
mb = MB()
shaft_level(mb, 1, G, Z2)
shaft_level(mb, 2, Z2, floor_z(3))
build_in(mb, "本部棟内装_EVかご_1F-2F")

# 1F ロビー：床だけ（写真がない）
mb = MB()
quad(mb, x0 + 0.06, x1 - 0.06, y0 + 0.06, y1 - 0.06, G + 0.02, "floor")
build_in(mb, "本部棟内装_01F_ロビー")

total_in = sum(len(o.data.vertices) for o in icol.all_objects if o.type == 'MESH')
total_out = sum(len(o.data.vertices) for o in col.all_objects if o.type == 'MESH')
print("本部棟 内装 DONE verts", total_in, "外観", total_out)
if "--save" in __import__("sys").argv:
    bpy.ops.wm.save_mainfile()
    print("保存した:", bpy.data.filepath)
