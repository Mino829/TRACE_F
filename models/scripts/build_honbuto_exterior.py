# 本部棟の外観（ルーバー・窓・白い棟・ピロティ・階段・エスカレーター・渡り廊下）を組み立てるスクリプト
# buildings/本部棟.blend を開いて、Blender の Python コンソールか MCP から
#   exec(open(path, encoding="utf-8").read())
# で実行する。何度実行しても、このスクリプトが作ったもの（"本部棟_gen" プロパティ付き）を消して作り直すだけ。
#
# 座標はユーザーが置いた箱と同じ（地面 Z=-1）。
#   -Y: 正面（交差点・広場側）  +Y: 交流棟側（張り出さない）  -X: 南西の道路側  +X: 北東側
# 実寸より雰囲気優先。数字を変えて再実行すれば形を調整できる。
import bpy, bmesh, math
from mathutils import Vector

COL_NAME = "05_本部棟"
REF_COL = "参考_自分で置いた箱"
G = -1.0            # 地面の高さ
# 階の高さ（地面から）。2026-10-12 に教室棟の階に合わせた（渡り廊下で交流棟の 4F・6F とつながるため）
#   3F 11m・4F 16m・5F 21m・6F 26m（教室棟・交流棟と同じ）、7F から上は階高 4.4m（てっぺんの高さは前と同じ）
FL = {3: G + 11.0, 4: G + 16.0, 5: G + 21.0, 6: G + 26.0}
PITCH = 4.4         # 7F から上の階高
for _f in range(7, 17):
    FL[_f] = FL[6] + PITCH * (_f - 6)
WIN0, WIN1 = 1.0, 3.4   # 窓の下端・上端（各階の床から）
PILOTI = FL[3]      # ピロティの天井（3F の床の底）
LOW1F = G + 7.7     # 左の棟の1F の高さ

# ---------- 建物のかたまり ----------
# lean: その面が一番上で何 m 外へ出るか（1階ごとに段々に出る）
MASSES = [
    dict(key="T", name="高層棟", x0=34.3, x1=55.0, y0=-31.4, y1=-4.6, zb=PILOTI, zt=G + 72.0,
         lean={"-y": 9.0, "+x": 4.0}, kind="louver"),
    dict(key="M", name="中央棟", x0=27.6, x1=55.0, y0=-12.0, y1=14.6, zb=PILOTI, zt=G + 46.0,
         lean={"+x": 4.0}, kind="louver"),
    dict(key="L", name="低層棟", x0=-2.1, x1=28.5, y0=-0.7, y1=14.6, zb=LOW1F, zt=G + 40.0,
         lean={"-x": 5.0}, kind="louver"),
    dict(key="W", name="白い棟", x0=21.5, x1=34.3, y0=-17.0, y1=-2.0, zb=PILOTI, zt=G + 55.0,
         lean={}, kind="white"),
    # 1F のかたまり（ルーバーの隠れ判定にも使う）
    dict(key="TL", name="高層棟_1Fロビー", x0=39.6, x1=53.5, y0=-29.0, y1=-6.5, zb=G, zt=PILOTI,
         lean={}, kind="lobby"),
    dict(key="LL", name="低層棟_1F", x0=-0.2, x1=28.2, y0=-0.7, y1=13.7, zb=G, zt=LOW1F,
         lean={}, kind="none"),
]
MB_BY = {m["key"]: m for m in MASSES}

# ---------- マテリアル ----------
def bsdf(m):
    for n in m.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            return n


def sock(node, ident, out=False):
    for s in (node.outputs if out else node.inputs):
        if s.identifier == ident:
            return s
    raise KeyError(ident)


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


class NB:
    """シェーダーノードを短く書くための道具"""
    def __init__(self, m):
        self.nt = m.node_tree
        self.b = bsdf(m)
        g = self.nt.nodes.new("ShaderNodeNewGeometry")
        s = self.nt.nodes.new("ShaderNodeSeparateXYZ")
        self.nt.links.new(g.outputs["Position"], s.inputs[0])
        self.x, self.y, self.z = s.outputs[0], s.outputs[1], s.outputs[2]

    def m(self, op, a, b=None, c=None):
        n = self.nt.nodes.new("ShaderNodeMath")
        n.operation = op
        for i, v in enumerate((a, b, c)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                self.nt.links.new(v, n.inputs[i])
        return n.outputs[0]

    def mixc(self, f, a, b):
        n = self.nt.nodes.new("ShaderNodeMix")
        n.data_type = 'RGBA'
        self.nt.links.new(f, sock(n, "Factor_Float"))
        sock(n, "A_Color").default_value = (*a, 1)
        sock(n, "B_Color").default_value = (*b, 1)
        return sock(n, "Result_Color", True)

    def mixf(self, f, a, b):
        n = self.nt.nodes.new("ShaderNodeMix")
        n.data_type = 'FLOAT'
        self.nt.links.new(f, sock(n, "Factor_Float"))
        sock(n, "A_Float").default_value = a
        sock(n, "B_Float").default_value = b
        return sock(n, "Result_Float", True)

    def noise_id(self, a, b):
        c = self.nt.nodes.new("ShaderNodeCombineXYZ")
        self.nt.links.new(a, c.inputs[0])
        self.nt.links.new(b, c.inputs[1])
        w = self.nt.nodes.new("ShaderNodeTexWhiteNoise")
        w.noise_dimensions = '3D'
        self.nt.links.new(c.outputs[0], w.inputs["Vector"])
        return w.outputs["Value"]

    def out(self, color=None, rough=None, metal=None, alpha=None):
        for k, v in (("Base Color", color), ("Roughness", rough), ("Metallic", metal), ("Alpha", alpha)):
            if v is not None:
                self.nt.links.new(v, self.b.inputs[k])


def band(nb, v, lo, hi):
    return nb.m('MULTIPLY', nb.m('GREATER_THAN', v, lo), nb.m('LESS_THAN', v, hi))


# Unity でもそのまま使えるように、模様のシェーダーは使わず「色だけ」のマテリアルにする。
# 窓などの模様は、面を分けて別のマテリアルを付けることで表す。
MAT = dict(
    wall=mat("本部棟_外壁", (0.30, 0.31, 0.33), 0.5),
    glass=mat("本部棟_窓ガラス", (0.05, 0.08, 0.11), 0.05, 0.3),
    roof=mat("本部棟_屋上", (0.35, 0.35, 0.34), 0.8),
    soffit=mat("本部棟_軒天_白", (0.86, 0.86, 0.85), 0.35),
    step_soffit=mat("本部棟_張り出しの裏", (0.55, 0.56, 0.57), 0.5),
    louver=mat("本部棟_ルーバー", (0.58, 0.59, 0.6), 0.35, 0.6),
    bracket=mat("本部棟_ルーバー受け", (0.32, 0.33, 0.35), 0.4, 0.6),
    white=mat("本部棟_白い帯", (0.88, 0.88, 0.87), 0.3),
    wglass=mat("本部棟_白い棟ガラス", (0.06, 0.10, 0.12), 0.05, 0.3),
    curtain=mat("本部棟_ロビーガラス", (0.03, 0.035, 0.04), 0.05, 0.3),
    black=mat("本部棟_黒パネル", (0.025, 0.025, 0.028), 0.3, 0.2),
    bglass=mat("本部棟_黒い箱のガラス", (0.08, 0.1, 0.11), 0.05),
    column=mat("本部棟_柱_白", (0.85, 0.85, 0.84), 0.25),
    granite=mat("本部棟_御影石", (0.45, 0.45, 0.46), 0.6),
    steel=mat("本部棟_黒い鉄", (0.03, 0.03, 0.035), 0.4, 0.6),
    rail=mat("本部棟_手すり格子", (0.03, 0.03, 0.035), 0.4, 0.6, alpha=0.5),
    escstep=mat("本部棟_エスカレーター踏み板", (0.12, 0.12, 0.13), 0.35, 0.8),
    handrail=mat("本部棟_手すりゴム", (0.02, 0.02, 0.02), 0.6),
    bridge_glass=mat("本部棟_渡り廊下ガラス", (0.55, 0.68, 0.70), 0.03, alpha=0.3),
    machine=mat("本部棟_屋上設備", (0.62, 0.62, 0.6), 0.6),
    logo=mat("本部棟_SITロゴ", (0.15, 0.45, 0.25), 0.4),
    entglass=mat("本部棟_入口ガラス", (0.05, 0.06, 0.065), 0.03, alpha=0.55),
    frame=mat("本部棟_サッシ_銀", (0.7, 0.71, 0.72), 0.3, 1.0),
    frosted=mat("本部棟_すりガラス_緑", (0.62, 0.78, 0.72), 0.45, alpha=0.9),
    brownwall=mat("本部棟_こげ茶の壁", (0.16, 0.11, 0.08), 0.7),
    signtext=mat("本部棟_看板の文字", (0.85, 0.86, 0.87), 0.3, 0.8),
    signband=mat("本部棟_看板帯", (0.04, 0.035, 0.03), 0.6),
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
    if o.get("本部棟_gen"):
        me = o.data
        bpy.data.objects.remove(o)
        if me is not None and me.users == 0:
            if isinstance(me, bpy.types.Mesh):
                bpy.data.meshes.remove(me)
            elif isinstance(me, bpy.types.Curve):
                bpy.data.curves.remove(me)


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
        k = keys6 or [key] * 6
        P = lambda x, y, z: (x, y, z)
        fs = [
            [P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0)],
            [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)],
            [P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)],
            [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)],
            [P(x1, y1, z0), P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1)],
            [P(x0, y1, z0), P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1)],
        ]
        for i, f in enumerate(fs):
            if i not in skip:
                self.face(f, k[i])

    def prism_x(self, prof, x0, x1, key, keys_side=None):
        """YZ 平面の多角形 prof を X 方向に押し出す"""
        n = len(prof)
        self.face([(x0, y, z) for y, z in prof][::-1], keys_side or key)
        self.face([(x1, y, z) for y, z in prof], keys_side or key)
        for i in range(n):
            (ya, za), (yb, zb) = prof[i], prof[(i + 1) % n]
            self.face([(x0, ya, za), (x0, yb, zb), (x1, yb, zb), (x1, ya, za)], key)

    def prism_y(self, prof, y0, y1, key, keys_side=None):
        """XZ 平面の多角形 prof を Y 方向に押し出す"""
        n = len(prof)
        self.face([(x, y0, z) for x, z in prof], keys_side or key)
        self.face([(x, y1, z) for x, z in prof][::-1], keys_side or key)
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
        # マテリアルは整理する前に付ける（validate や remove_doubles で面が消えると順番がずれるため）
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
        o["本部棟_gen"] = True
        col.objects.link(o)
        return o


# ---------- かたまりの形（1階ごとの段） ----------
def next_level(z):
    """z より上の次の階の床（FL）。表より上は PITCH ずつ"""
    for v in sorted(FL.values()):
        if v > z + 0.01:
            return v
    return z + PITCH


def segments(m):
    zs, z = [], m["zb"]
    while z < m["zt"] - 0.01:
        z1 = min(next_level(z), m["zt"])
        if m["zt"] - z1 < 1.5:
            z1 = m["zt"]
        zs.append((z, z1))
        z = z1
    return zs


def rect(m, z):
    """高さ z での、その階の外形（段ごとに張り出した値）"""
    segs = segments(m)
    zb, zt = m["zb"], m["zt"]
    seg = next((s for s in segs if s[0] - 1e-6 <= z < s[1] + 1e-6), segs[-1])
    t = ((seg[0] + seg[1]) / 2 - zb) / max(zt - zb, 1e-6)
    L = m["lean"]
    return (m["x0"] - L.get("-x", 0) * t, m["x1"] + L.get("+x", 0) * t,
            m["y0"] - L.get("-y", 0) * t, m["y1"] + L.get("+y", 0) * t)


def inside(px, py, z, skip_key):
    for m in MASSES:
        if m["key"] == skip_key or not (m["zb"] - 1e-6 <= z <= m["zt"] + 1e-6):
            continue
        x0, x1, y0, y1 = rect(m, z)
        if x0 < px < x1 and y0 < py < y1:
            return True
    return False


def exposed(m, side, z, off=0.6):
    """面 side の高さ z で、ほかの棟に隠れていない区間 [(a, b, 端が角か, 端が角か)]"""
    x0, x1, y0, y1 = rect(m, z)
    if side in ("-y", "+y"):
        c = y0 - off if side == "-y" else y1 + off
        a0, a1 = x0, x1
        pt = lambda a: (a, c)
    else:
        c = x0 - off if side == "-x" else x1 + off
        a0, a1 = y0, y1
        pt = lambda a: (c, a)
    N = max(2, int((a1 - a0) / 0.25))
    vis = [not inside(*pt(a0 + (a1 - a0) * (i + 0.5) / N), z, m["key"]) for i in range(N)]
    out, i = [], 0
    while i < N:
        if vis[i]:
            j = i
            while j < N and vis[j]:
                j += 1
            out.append((a0 + (a1 - a0) * i / N, a0 + (a1 - a0) * j / N, i == 0, j == N))
            i = j
        else:
            i += 1
    # 角の先がほかの棟の中なら、角として延ばさない
    res = []
    for a, b, ca, cb in out:
        if ca:
            p = pt(a - 0.9)
            ca = not inside(p[0], p[1], z, None)
        if cb:
            p = pt(b + 0.9)
            cb = not inside(p[0], p[1], z, None)
        res.append((a, b, ca, cb))
    return res


SIDES = ("-y", "+x", "+y", "-x")


def face_line(m, side, z):
    x0, x1, y0, y1 = rect(m, z)
    return {"-y": y0, "+y": y1, "-x": x0, "+x": x1}[side]


# ---------- 1. 建物の本体 ----------
# 交流棟への渡り廊下の付け根（中央の棟 M の +Y 面、X 48.3〜52.3）の 4F・6F は、壁に扉の口をあける（2026-10-29：
#   前は扉が壁の表面に貼ってあるだけで、壁は穴がなく、展示の一人称が壁を抜けていた）。扉は開けた状態（OPEN_DOORS）
OPEN_DOORS = True
BR_DOOR = (48.35, 52.25, 2.75)        # 口の X の範囲と高さ（床から）


# 1F ロビー（高層棟_1Fロビー）の +Y のガラス面の口：1F・2F の EV B のかごの扉の前（かごの扉がガラス面の外を向いているため）と、
#   2F の EV ホール（build_honbuto_interior.py の HALL2）からロビーの 2F へ入る扉（2026-10-29）
LOBBY_DOORS = [(40.45, 41.55, G, G + 2.35), (40.45, 41.55, G + 6.0, G + 6.0 + 2.35), (45.6, 47.4, G + 6.0, G + 6.0 + 2.4)]


def yface(mb, x0, x1, y, zl, zh, key, hole=None, holes=()):
    """+Y を向く壁の面。hole / holes = (x0, x1, z0, z1) の所をあける"""
    holes = list(holes) + ([hole] if hole else [])
    xs = sorted({x0, x1} | {v for h in holes for v in h[:2] if x0 < v < x1})
    for xa, xb in zip(xs[:-1], xs[1:]):
        zs = [(zl, zh)]
        for hx0, hx1, hz0, hz1 in holes:
            if hx0 <= xa + 1e-6 and xb <= hx1 + 1e-6:
                zs = [q for a, b in zs for q in ((a, min(b, hz0)), (max(a, hz1), b)) if q[1] - q[0] > 1e-6]
        for c, d in zs:
            mb.face([(xb, y, c), (xa, y, c), (xa, y, d), (xb, y, d)], key)


body = MB()
for m in MASSES:
    if m["kind"] in ("none",):
        continue
    segs = segments(m)
    top_wall = m["zt"] - (2.4 if m["kind"] == "louver" else 0)
    for i, (za, zb_) in enumerate(segs):
        x0, x1, y0, y1 = rect(m, (za + zb_) / 2)
        z1 = min(zb_, top_wall)
        if za >= z1:
            break
        bottom = "soffit" if i == 0 else "step_soffit"
        top = "roof" if z1 >= top_wall - 1e-6 else "wall"
        if m["kind"] == "louver":
            # 床・屋根の面と、側面を「腰壁・窓・梁の帯」の 3 段に分ける
            body.box(x0, x1, y0, y1, za, z1, None, [bottom, top, "wall", "wall", "wall", "wall"], skip=(2, 3, 4, 5))
            # 側面は、ほかの棟に隠れていない所（外に面した所）だけ張る（2026-10-29：前は 4 面とも全部張っていて、
            #   棟どうしが重なった建物の内側にも窓ガラスの壁ができ、各階のホールと渡り廊下の口の側が分かれていた）
            door_floor = m["key"] == "M" and any(abs(za - FL[f]) < 1e-6 for f in (4, 6))
            for zl, zh, key in ((za, za + WIN0, "wall"), (za + WIN0, za + WIN1, "glass"), (za + WIN1, z1, "wall")):
                zh = min(zh, z1)
                if zh - zl > 0.05:
                    for side in SIDES:
                        for a, b, _, _ in exposed(m, side, (zl + zh) / 2, off=0.05):
                            if side == "+y":
                                hole = (BR_DOOR[0], BR_DOOR[1], za, za + BR_DOOR[2]) if door_floor else None
                                yface(body, a, b, y1, zl, zh, key, hole)
                            elif side == "-y":
                                body.face([(a, y0, zl), (b, y0, zl), (b, y0, zh), (a, y0, zh)], key)
                            elif side == "+x":
                                body.face([(x1, a, zl), (x1, b, zl), (x1, b, zh), (x1, a, zh)], key)
                            else:
                                body.face([(x0, b, zl), (x0, a, zl), (x0, a, zh), (x0, b, zh)], key)
        elif m["kind"] == "lobby":
            body.box(x0, x1, y0, y1, za, z1, None, ["roof", "soffit", "curtain", "curtain", "curtain", "curtain"], skip=(4,))
            yface(body, x0, x1, y1, za, z1, "curtain", holes=LOBBY_DOORS)
        elif m["kind"] == "white":
            last = (i == len(segs) - 1)
            if last:
                body.box(x0 - 0.3, x1 + 0.3, y0 - 0.3, y1 + 0.3, za, zb_, "white")
            else:
                body.box(x0 - 0.3, x1 + 0.3, y0 - 0.3, y1 + 0.3, za, za + 1.0, "white", skip=() if i == 0 else (0,))
                body.box(x0, x1, y0, y1, za + 1.0, zb_, "wglass", skip=(0, 1))
body.build("本部棟_本体")

# ---------- 2. ルーバー（横の羽根と、縦の受け材） ----------
lv = MB()
OFF0, OFF1, TH = 0.5, 0.85, 0.05   # 壁からの距離（内側・外側）と羽根の厚み
# 交流棟への渡り廊下が付く所（下の「8.」の BX0〜BX1、4F のデッキ・6F の廊下の扉）はルーバーを切る
# （2026-10-21 ユーザー：扉の前をルーバーが柵のようにふさいでいて邪魔）
BR_HOLE_X = (48.3 - 0.3, 52.3 + 0.3)
BR_HOLE_Z = [(FL[4] - 0.2, FL[4] + 3.0), (FL[6] - 0.2, FL[6] + 3.4)]
BR_FACE_Y = MB_BY["M"]["y1"]


def in_br_hole(side, c, z):
    return side == "+y" and abs(c - BR_FACE_Y) < 0.6 and any(z0 <= z <= z1 for z0, z1 in BR_HOLE_Z)
for m in MASSES:
    if m["kind"] != "louver":
        continue
    for za, zb_ in segments(m):
        n = max(3, round((zb_ - za) / 0.55))
        zm = (za + zb_) / 2
        for side in SIDES:
            c = face_line(m, side, zm)
            sg = -1 if side[0] == "-" else 1
            for a, b, ca, cb in exposed(m, side, zm):
                a2 = a - (OFF1 if ca else 0)
                b2 = b + (OFF1 if cb else 0)
                if b2 - a2 < 0.3:
                    continue
                w0, w1 = sorted((c + sg * OFF0, c + sg * OFF1))
                for k in range(n):
                    z = za + (k + 0.5) * (zb_ - za) / n
                    if side in ("-y", "+y"):
                        if in_br_hole(side, c, z):
                            for x0, x1 in ((a2, min(b2, BR_HOLE_X[0])), (max(a2, BR_HOLE_X[1]), b2)):
                                if x1 - x0 > 0.05:
                                    lv.box(x0, x1, w0, w1, z - TH / 2, z + TH / 2, "louver")
                        else:
                            lv.box(a2, b2, w0, w1, z - TH / 2, z + TH / 2, "louver")
                    else:
                        lv.box(w0, w1, a2, b2, z - TH / 2, z + TH / 2, "louver")
                # 受け材（縦）2.4m おき
                q0, q1 = sorted((c, c + sg * OFF1))
                cnt = max(1, int((b - a) / 2.4))
                for k in range(cnt + 1):
                    p = a + (b - a) * k / cnt
                    if side in ("-y", "+y"):
                        if side == "+y" and abs(c - BR_FACE_Y) < 0.6 and BR_HOLE_X[0] < p < BR_HOLE_X[1]:
                            cuts = sorted([za, zb_] + [max(za, min(zb_, v)) for h in BR_HOLE_Z for v in h])
                            for z0, z1 in zip(cuts[:-1], cuts[1:]):
                                if z1 - z0 > 0.05 and not any(h0 <= (z0 + z1) / 2 <= h1 for h0, h1 in BR_HOLE_Z):
                                    lv.box(p - 0.04, p + 0.04, q0, q1, z0, z1, "bracket")
                        else:
                            lv.box(p - 0.04, p + 0.04, q0, q1, za, zb_, "bracket")
                    else:
                        lv.box(q0, q1, p - 0.04, p + 0.04, za, zb_, "bracket")
lv.build("本部棟_ルーバー")

# ---------- 3. 屋上の設備と SIT ロゴ ----------
roof = MB()
T = MB_BY["T"]
tr = rect(T, T["zt"] - 1)
rz = T["zt"] - 2.4
for (fx0, fy0, fx1, fy1, h) in [(0.15, 0.2, 0.45, 0.45, 2.0), (0.55, 0.15, 0.85, 0.35, 1.6), (0.2, 0.6, 0.5, 0.85, 1.8),
                                (0.6, 0.5, 0.8, 0.8, 2.1), (0.45, 0.4, 0.55, 0.55, 1.2)]:
    roof.box(tr[0] + (tr[1] - tr[0]) * fx0, tr[0] + (tr[1] - tr[0]) * fx1,
             tr[2] + (tr[3] - tr[2]) * fy0, tr[2] + (tr[3] - tr[2]) * fy1, rz, rz + h, "machine")
for key, fr in (("M", [(0.3, 0.3, 0.6, 0.6, 1.5)]), ("L", [(0.2, 0.25, 0.5, 0.7, 1.6), (0.6, 0.3, 0.8, 0.6, 1.2)])):
    mm = MB_BY[key]
    r_ = rect(mm, mm["zt"] - 1)
    z0 = mm["zt"] - 2.4
    for fx0, fy0, fx1, fy1, h in fr:
        roof.box(r_[0] + (r_[1] - r_[0]) * fx0, r_[0] + (r_[1] - r_[0]) * fx1,
                 r_[2] + (r_[3] - r_[2]) * fy0, r_[2] + (r_[3] - r_[2]) * fy1, z0, z0 + h, "machine")
roof.build("本部棟_屋上設備")

cu = bpy.data.curves.new("本部棟_SITロゴ", 'FONT')
cu.body = "SIT"
cu.size = 3.2
cu.extrude = 0.08
cu.align_x = 'CENTER'
logo = bpy.data.objects.new("本部棟_SITロゴ", cu)
logo["本部棟_gen"] = True
logo.data.materials.append(MAT["logo"])
logo.location = (tr[1] - 5.5, tr[2] - OFF1 - 0.15, T["zt"] - 3.2)
logo.rotation_euler = (math.radians(90), 0, 0)
col.objects.link(logo)

# ---------- 4. ピロティ：浮いている黒い箱・2F デッキ ----------
pil = MB()
Z2 = G + 7.6                     # 2F の床（デッキ）の高さ
ZL1 = G + 4.1                    # エスカレーターの踊り場の高さ
# 2F デッキ（L 棟の脇）と、その上の黒い箱
DX0, DX1, DY0, DY1 = 28.3, 35.4, -8.5, 7.3
pil.box(DX0, DX1, DY0, DY1, Z2 - 0.5, Z2, "black")
for (x0, x1, y0, y1, zb) in [(28.3, 33.4, -8.5, 4.0, Z2), (44.5, 55.0, 9.8, 14.6, G + 6.3)]:
    pil.box(x0, x1, y0, y1, zb, PILOTI - 1.3, "black")
    pil.box(x0 + 0.15, x1 - 0.15, y0 + 0.15, y1 - 0.15, PILOTI - 1.3, PILOTI, "bglass", skip=(0, 1))
# エスカレーター①の向き（ユーザーが回した角度）。下の端 E1_BOT から角度 E1_ANG で上る
E1_RUN = (ZL1 - G) / math.tan(math.radians(30))
E1_BOT = (32.14, -8.90)
E1_ANG = math.atan2(3.06, 6.41)
E1_W = 1.3
_c, _s = math.cos(E1_ANG), math.sin(E1_ANG)
E1_TOP = (E1_BOT[0] + E1_RUN * _c, E1_BOT[1] + E1_RUN * _s)
# 踊り場：エスカレーター①の上端の線から始まり、エスカレーター②の乗り口まで
E1_P1 = (E1_TOP[0] + _s * E1_W / 2, E1_TOP[1] - _c * E1_W / 2)   # 上端の右（ロビー側）
E1_P2 = (E1_TOP[0] - _s * E1_W / 2, E1_TOP[1] + _c * E1_W / 2)   # 上端の左
LAND = [E1_P1, (43.0, E1_P1[1]), (43.0, -1.0), (37.6, -1.0), E1_P2]
pil.face([(x, y, ZL1) for x, y in LAND], "black")
pil.face([(x, y, ZL1 - 0.4) for x, y in LAND][::-1], "black")
for i in range(len(LAND)):
    (xa, ya), (xb, yb) = LAND[i], LAND[(i + 1) % len(LAND)]
    pil.face([(xa, ya, ZL1 - 0.4), (xb, yb, ZL1 - 0.4), (xb, yb, ZL1), (xa, ya, ZL1)], "black")
for px, py in [(42.6, -1.4), (42.6, -6.0), (38.0, -1.4)]:
    pil.box(px - 0.15, px + 0.15, py - 0.15, py + 0.15, G, ZL1 - 0.4, "steel")
# 正面のピロティを支える柱が見える位置に、白い棟の前の柱を足す
for cx, cy in [(22.6, -15.6), (33.2, -15.6), (46.0, -3.2)]:
    pil.cyl(cx, cy, 0.65, G, PILOTI, "column")
pil.build("本部棟_ピロティ")

# ---------- 5. 手すり（縦格子＋上の手すり） ----------
rail = MB()


def railing(p0, p1, z0a, z0b, h=1.1, posts=1.5):
    """p0→p1 の線に沿った手すり。z0a / z0b は両端の足元の高さ（階段なら傾く）"""
    (xa, ya), (xb, yb) = p0, p1
    if math.hypot(xb - xa, yb - ya) < 0.05:
        return
    rail.face([(xa, ya, z0a + 0.05), (xb, yb, z0b + 0.05), (xb, yb, z0b + h - 0.05), (xa, ya, z0a + h - 0.05)], "rail")
    L = math.hypot(xb - xa, yb - ya)
    dx, dy = (xb - xa) / L, (yb - ya) / L
    nx, ny = -dy * 0.03, dx * 0.03
    # 上の手すり（細い角材）
    for zz in (h, 0.05):
        rail.face([(xa - nx, ya - ny, z0a + zz - 0.03), (xb - nx, yb - ny, z0b + zz - 0.03),
                   (xb + nx, yb + ny, z0b + zz - 0.03), (xa + nx, ya + ny, z0a + zz - 0.03)], "steel")
        rail.face([(xa - nx, ya - ny, z0a + zz + 0.03), (xa + nx, ya + ny, z0a + zz + 0.03),
                   (xb + nx, yb + ny, z0b + zz + 0.03), (xb - nx, yb - ny, z0b + zz + 0.03)], "steel")
        rail.face([(xa - nx, ya - ny, z0a + zz - 0.03), (xa - nx, ya - ny, z0a + zz + 0.03),
                   (xb - nx, yb - ny, z0b + zz + 0.03), (xb - nx, yb - ny, z0b + zz - 0.03)], "steel")
        rail.face([(xa + nx, ya + ny, z0a + zz - 0.03), (xb + nx, yb + ny, z0b + zz - 0.03),
                   (xb + nx, yb + ny, z0b + zz + 0.03), (xa + nx, ya + ny, z0a + zz + 0.03)], "steel")
    cnt = max(1, int(L / posts))
    for k in range(cnt + 1):
        t = k / cnt
        px, py, pz = xa + (xb - xa) * t, ya + (yb - ya) * t, z0a + (z0b - z0a) * t
        rail.box(px - 0.03, px + 0.03, py - 0.03, py + 0.03, pz, pz + h, "steel")


# ---------- 6. エスカレーター ----------
# ① 入口側(-Y)から、1F ロビーの壁に沿って +Y へ上り、踊り場へ
# ② 踊り場から向きを変えて -X へ上り、2F デッキへ
esc = MB()


def escalator(axis, w0, w1, s_bot, s_top, z_bot, z_top, flat=1.4):
    """axis='x' なら X 方向に上る（w は Y の範囲）。s_bot → s_top へ上る"""
    d = 1 if s_top > s_bot else -1
    sb2 = s_bot - d * flat

    def pr(profile, a0, a1, key):
        if axis == 'x':
            esc.prism_y(profile, a0, a1, key)
        else:
            esc.prism_x(profile, a0, a1, key)

    def F(s, w, z):
        return (s, w, z) if axis == 'x' else (w, s, z)

    pr([(sb2, z_bot), (sb2, z_bot + 0.15), (s_bot, z_bot + 0.15), (s_top, z_top), (s_top, z_top - 1.1),
        (s_bot + d * 1.6, z_bot)], w0 + 0.12, w1 - 0.12, "black")
    esc.face([F(sb2, w0 + .15, z_bot + .16), F(sb2, w1 - .15, z_bot + .16), F(s_bot, w1 - .15, z_bot + .16),
              F(s_bot, w0 + .15, z_bot + .16)], "escstep")
    esc.face([F(s_bot, w0 + .15, z_bot + .16), F(s_bot, w1 - .15, z_bot + .16), F(s_top, w1 - .15, z_top + .01),
              F(s_top, w0 + .15, z_top + .01)], "escstep")
    for a0, a1 in ((w0, w0 + 0.12), (w1 - 0.12, w1)):
        pr([(sb2 - d * 0.6, z_bot), (sb2 - d * 0.6, z_bot + 1.0), (s_bot - d * 0.3, z_bot + 1.0),
            (s_top - d * 0.3, z_top + 1.0), (s_top + d * 0.3, z_top + 1.0), (s_top + d * 0.3, z_top - 1.1),
            (s_bot + d * 1.6, z_bot)], a0, a1, "black")
        pr([(sb2 - d * 0.6, z_bot + 1.0), (sb2 - d * 0.6, z_bot + 1.08), (s_bot - d * 0.3, z_bot + 1.08),
            (s_top - d * 0.3, z_top + 1.08), (s_top + d * 0.3, z_top + 1.08), (s_top + d * 0.3, z_top + 1.0),
            (s_top - d * 0.3, z_top + 1.0), (s_bot - d * 0.3, z_bot + 1.0)], a0 - 0.02, a1 + 0.02, "handrail")


_n0 = len(esc.v)
escalator('x', -E1_W / 2, E1_W / 2, 0.0, E1_RUN, G, ZL1)      # いったん X 向きに作って、回して置く
for i in range(_n0, len(esc.v)):
    x, y, z = esc.v[i]
    esc.v[i] = (E1_BOT[0] + x * _c - y * _s, E1_BOT[1] + x * _s + y * _c, z)
E2_RUN = (Z2 - ZL1) / math.tan(math.radians(30))
escalator('x', -3.0, -1.5, DX1 + E2_RUN, DX1, ZL1, Z2)
esc.build("本部棟_エスカレーター")

# ---------- 7. 階段（御影石の台 → 2 回折り返して 2F デッキへ） ----------
# ① 台から -X へ（建物側へ）→ 踊り場1 → ② +Y へ → 踊り場2 → ③ 折り返して -Y へ → 2F
st = MB()


def sbox(axis, a, b, w0, w1, z0, z1, key):
    a, b = sorted((a, b))
    if axis == 'x':
        st.box(a, b, w0, w1, z0, z1, key)
    else:
        st.box(w0, w1, a, b, z0, z1, key)


def flight(axis, w0, w1, s_bot, s_top, z_bot, z_top):
    d = 1 if s_top > s_bot else -1
    n = max(2, round((z_top - z_bot) / 0.175))
    rh = (z_top - z_bot) / n
    td = abs(s_top - s_bot) / (n - 1)
    for k in range(n - 1):
        s0 = s_bot + d * k * td
        z = z_bot + (k + 1) * rh
        sbox(axis, s0, s0 + d * (td + 0.03), w0 + 0.08, w1 - 0.08, z - 0.05, z, "steel")
    for a0, a1 in ((w0, w0 + 0.08), (w1 - 0.08, w1)):
        prof = [(s_bot, z_bot), (s_bot, z_bot + 0.35), (s_top, z_top + 0.05), (s_top, z_top - 0.45)]
        if axis == 'x':
            st.prism_y(prof, a0, a1, "steel")
        else:
            st.prism_x(prof, a0, a1, "steel")
    for w in (w0 + 0.04, w1 - 0.04):
        p0 = (s_bot, w) if axis == 'x' else (w, s_bot)
        p1 = (s_top, w) if axis == 'x' else (w, s_top)
        railing(p0, p1, z_bot + rh, z_top, posts=1.8)


ZA, ZB = G + 2.8, G + 5.2       # 踊り場1・踊り場2
PODIUM_H = 0.45
# 御影石の台（3 段）
for k in range(3):
    st.box(37.6, 40.0 - k * 0.35, 4.9 + k * 0.15, 7.8 - k * 0.15, G, G + (k + 1) * 0.15, "granite")
flight('x', 5.4, 7.3, 37.6, 33.6, G + PODIUM_H, ZA)          # ①
st.box(31.6, 33.6, 5.4, 7.3, ZA - 0.3, ZA, "steel")            # 踊り場1
flight('y', 31.6, 33.6, 7.3, 11.0, ZA, ZB)                     # ②
st.box(28.2, 33.6, 11.0, 13.2, ZB - 0.3, ZB, "steel")          # 踊り場2
flight('y', 28.2, 30.2, 11.0, DY1, ZB, Z2)                     # ③
for px, py, z in [(31.8, 5.6, ZA), (33.4, 5.6, ZA), (28.4, 13.0, ZB), (33.4, 13.0, ZB)]:
    st.box(px - 0.08, px + 0.08, py - 0.08, py + 0.08, G, z - 0.3, "steel")
st.build("本部棟_階段")

# 踊り場とデッキの手すり
railing((31.6, 5.4), (33.6, 5.4), ZA, ZA)
railing((31.6, 5.4), (31.6, 7.3), ZA, ZA)
railing((28.2, 13.2), (33.6, 13.2), ZB, ZB)
railing((33.6, 11.0), (33.6, 13.2), ZB, ZB)
railing((30.2, 11.0), (31.6, 11.0), ZB, ZB)
railing((DX1, DY0), (DX1, -3.1), Z2, Z2)                       # 2F デッキの東側（エスカレーターの降り口をあける）
railing((DX1, -1.4), (DX1, DY1), Z2, Z2)
railing((DX1, DY1), (30.3, DY1), Z2, Z2)                       # 交流棟側（階段③の降り口をあける）
railing((33.4, DY0), (DX1, DY0), Z2, Z2)
railing(E1_P2, (37.6, -1.0), ZL1, ZL1)                       # エスカレーターの踊り場
railing((37.6, -1.0), (43.0, -1.0), ZL1, ZL1)
railing(E1_P1, (39.6, E1_P1[1]), ZL1, ZL1)
railing((43.0, -1.0), (43.0, -1.4), ZL1, ZL1)
railing((43.0, -3.1), (43.0, E1_P1[1]), ZL1, ZL1)
rail.build("本部棟_手すり")

# ---------- 8. 交流棟への渡り廊下（上：ガラスの廊下、下：ガラス手すりのデッキ） ----------
br = MB()
# 交流棟の 3F・5F の口（交流棟の座標で X 14.5〜18.5）の正面。交流棟の壁は本部棟の座標で Y ≒ 41.0 なので、
# 口の黒い枠（壁から 0.4m）の前まで伸ばす（2026-10-12。前は Y 32 で止まっていて約 9m 届かなかった）
BX0, BX1 = 48.3, 52.3
BY0, BY1 = MB_BY["M"]["y1"], 40.6
ZL, ZU = FL[4], FL[6]           # 交流棟の 4F・6F（ユーザーの説明。教室棟と同じ 16m・26m）
br.box(BX0, BX1, BY0, BY1, ZL - 0.6, ZL, "step_soffit")                       # 下のデッキ
for x0, x1 in ((BX0, BX0 + 0.05), (BX1 - 0.05, BX1)):
    br.box(x0, x1, BY0, BY1, ZL, ZL + 1.1, "bridge_glass")
br.box(BX0 - 0.1, BX1 + 0.1, BY0, BY1, ZU - 0.6, ZU, "step_soffit")           # 上の廊下の床
for x0, x1 in ((BX0, BX0 + 0.05), (BX1 - 0.05, BX1)):
    br.box(x0, x1, BY0, BY1, ZU, ZU + 3.0, "bridge_glass")
br.box(BX0 - 0.3, BX1 + 0.3, BY0, BY1, ZU + 3.0, ZU + 3.7, "step_soffit")     # 屋根
# 縦の柱と、斜めの鉄骨（下のデッキ → 上の廊下）
for y in (BY0 + 1.5, BY1 - 1.5):
    for x in (BX0 - 0.15, BX1 + 0.15):
        br.box(x - 0.12, x + 0.12, y - 0.12, y + 0.12, ZL - 0.6, ZU + 3.0, "bracket")
ym = (BY0 + BY1) / 2
for x in (BX0 - 0.15, BX1 + 0.15):
    for (ya, za), (yb, zb_) in (((BY0 + 1.5, ZL), (ym, ZU - 0.6)), ((BY1 - 1.5, ZL), (ym, ZU - 0.6))):
        d = 0.14
        br.prism_x([(ya - d, za), (ya + d, za), (yb + d, zb_), (yb - d, zb_)], x - 0.1, x + 0.1, "bracket")
# 渡り廊下の付け根（本部棟の壁 Y = BY0）の扉。4F のデッキと 6F の廊下（2026-10-21：前は扉がなく、TRACE の線が窓ガラスを抜けていた）
for zf in (ZL, ZU):
    y = BY0 + 0.03
    if not OPEN_DOORS:
        br.box(BX0 + 0.2, BX1 - 0.2, y, y + 0.03, zf, zf + 2.6, "entglass")           # ガラスの両開き扉（開けた状態では作らない）
    br.box(BX0 + 0.05, BX0 + 0.2, y, y + 0.12, zf, zf + 2.75, "steel")                # 黒い枠
    br.box(BX1 - 0.2, BX1 - 0.05, y, y + 0.12, zf, zf + 2.75, "steel")
    br.box(BX0 + 0.05, BX1 - 0.05, y, y + 0.12, zf + 2.6, zf + 2.75, "steel")
    xm = (BX0 + BX1) / 2
    if not OPEN_DOORS:
        br.box(xm - 0.03, xm + 0.03, y, y + 0.08, zf, zf + 2.6, "steel")              # 扉の合わせ目
br.build("本部棟_渡り廊下")

# ---------- 9. 高層棟の入口（1F ロビーの西側の面、自動ドア） ----------
# 写真「本部棟の高い方の入り口」：白いひさし／黒い看板帯と白い文字／ガラスの自動ドア 2 組／右に緑がかったすりガラスの柱／左にこげ茶の壁
ent = MB()
EX = MB_BY["TL"]["x0"]           # ロビーの西の面
EC = -22.26                      # 入口の中心（ユーザーが置いたキューブの位置）
EY0, EY1 = EC - 3.0, EC + 3.0    # ガラス面の範囲
DW = 1.0                         # 自動ドア 1 枚の幅（両開きで 2 枚）
ZD, ZG, ZS, ZC = G + 2.6, G + 3.0, G + 4.3, G + 4.55   # ドアの上端・ガラスの上端・看板の上端・ひさしの上端
DY0, DY1 = EC - DW - 0.1, EC + DW + 0.1                # ドアの枠の外側
# ガラス面（中は暗いロビー）
ent.box(EX - 0.12, EX - 0.08, EY0, EY1, G, ZG, "entglass")
# 縦の枠（銀）：はめ殺し | 太い枠 | 自動ドア 2 枚 | 太い枠 | はめ殺し
for y, w in ((EY0, 0.05), (EY1, 0.05), (DY0, 0.1), (DY1, 0.1)):
    ent.box(EX - 0.22, EX - 0.05, y - w, y + w, G, ZG, "frame")
ent.box(EX - 0.22, EX - 0.05, EY0, EY1, ZG - 0.08, ZG, "frame")          # 上の枠
ent.box(EX - 0.22, EX - 0.05, EY0, EY1, G, G + 0.05, "frame")            # 下の枠
ent.box(EX - 0.22, EX - 0.05, DY0, DY1, ZD, ZD + 0.12, "frame")          # ドアの上の枠
# 自動ドア（両開き 1 組）：銀の縦框と、下の幅の広い蹴板
for la, lb in ((EC - DW, EC - 0.01), (EC + 0.01, EC + DW)):
    ent.box(EX - 0.32, EX - 0.24, la, la + 0.07, G + 0.03, ZD, "frame")
    ent.box(EX - 0.32, EX - 0.24, lb - 0.07, lb, G + 0.03, ZD, "frame")
    ent.box(EX - 0.32, EX - 0.24, la, lb, ZD - 0.07, ZD, "frame")
    ent.box(EX - 0.32, EX - 0.24, la, lb, G + 0.03, G + 0.38, "frame")
    ent.box(EX - 0.29, EX - 0.27, la + 0.07, lb - 0.07, G + 0.38, ZD - 0.07, "entglass")
ent.box(EX - 2.0, EX - 0.22, EC - DW, EC + DW, G, G + 0.02, "black")     # 足もとのマット
# 看板帯（黒っぽい横の羽目板）
ent.box(EX - 0.4, EX, EY0 - 0.3, EY1 + 0.3, ZG, ZS, "signband")
# 白いひさし
ent.box(EX - 2.4, EX, EY0 - 0.8, EY1 + 0.8, ZS, ZC, "white")
# 外から見て右（-Y 側）：緑がかったすりガラスの柱　左（+Y 側）：こげ茶の壁
ent.box(EX - 1.0, EX, EY0 - 1.7, EY0 - 0.3, G, ZS, "frosted")
ent.box(EX - 0.1, EX, EY1 + 0.3, EY1 + 2.8, G, ZS, "brownwall")
ent.build("本部棟_入口")

tx = bpy.data.curves.new("本部棟_入口の文字", 'FONT')
tx.body = "SHIBAURA INSTITUTE OF TECHNOLOGY"
tx.size = 0.3
tx.extrude = 0.01
tx.align_x = 'CENTER'
tx.align_y = 'CENTER'
tobj = bpy.data.objects.new("本部棟_入口の文字", tx)
tobj["本部棟_gen"] = True
tobj.data.materials.append(MAT["signtext"])
tobj.location = (EX - 0.42, EC + 0.3, ZG + 0.35)
tobj.rotation_euler = (math.radians(90), 0, math.radians(-90))
col.objects.link(tobj)

# ---------- 片付け：既存の柱・1F の壁は 05_本部棟 へ、置いた箱は参考コレクションへ ----------
ref = bpy.data.collections.get(REF_COL)
if ref is None:
    ref = bpy.data.collections.new(REF_COL)
    scene.collection.children.link(ref)
KEEP = ["一階壁", "一回の壁", "平面.001", "平面.002"]
for o in list(bpy.data.objects):
    if o.get("本部棟_gen") or o.type not in ('MESH', 'EMPTY'):
        continue
    if o.name.startswith("円柱") or o.name in KEEP:
        target = col
        if o.name.startswith("円柱") and o.type == 'MESH':
            o.data.materials.clear()
            o.data.materials.append(MAT["column"])
    elif o.name.startswith("立方体") or o.name == "エンプティ":  # 置いた箱・目印のキューブ
        target = ref
    else:
        continue
    for c in list(o.users_collection):
        if c != target:
            c.objects.unlink(o)
    if target.name not in [c.name for c in o.users_collection]:
        target.objects.link(o)


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
print("本部棟 DONE verts", total)
