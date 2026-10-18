# 道の網（細かい点）を作る：campus_graph.src.json の点とつながりを、下の「道」の定義から作り直す
#   python trace/build_network.py
#
# PR #20 のコメント（Mino829・uni-bit）：数m〜10数mごとに点を打ち、京都の町の道のようにカクカクの道にする。
# ゴールの点（今までの 23 か所、role = checkpoint）はそのまま残し、道の線がそこを通るようにする。
#
# 座標は「碁盤の目」（u, v, z）で書く：教室棟の中心が原点、u = 教室棟の長い辺（+u = 研究棟側）、v = +が道路側（北西）。
# 教室棟・交流棟・本部棟はこの向きにそろっていて、研究棟は 90° 回っている（buildings/配置.json）。
# 教室棟の中の座標（build_kyoshitsu_interior.py）は、そのまま u, v になる。
import json, math, os

D = os.path.dirname(os.path.abspath(__file__))
P = json.load(open(os.path.join(os.path.dirname(D), "buildings", "配置.json"), encoding="utf-8"))
SRC = os.path.join(D, "campus_graph.src.json")
TH, C = P["教室棟"]["theta"], P["教室棟"]["center"]
STEP = {"out": 10.0, "in": 6.0}          # 点の間隔の上限（外 10m、建物の中 6m）
MERGE = 0.6                              # これより近い点は同じ点にする（同じ高さのとき）


def to_world(u, v, z):
    return [round(C[0] + math.cos(TH) * u - math.sin(TH) * v, 2), round(C[1] + math.sin(TH) * u + math.cos(TH) * v, 2), z]


def to_grid(x, y):
    dx, dy = x - C[0], y - C[1]
    return math.cos(TH) * dx + math.sin(TH) * dy, -math.sin(TH) * dx + math.cos(TH) * dy


# ---------- ゴールの点（今までの 23 か所。位置は campus_graph.src.json のまま） ----------
old = json.load(open(SRC, encoding="utf-8"))
CHECK = [n for n in old["nodes"] if n.get("role", "checkpoint") == "checkpoint"]
L = {n["id"]: (*to_grid(*n["blender"][:2]), n["blender"][2]) for n in CHECK}


def at(nid):
    return L[nid]


# 交流棟の中の座標 → 碁盤の目（同じ向き。交流棟の中心は u -88.9, v -11.65）
def X(x, y, z):
    return (-88.9 + x, -11.65 + y, z)


# ---------- 道 ----------
# (名前, 場所の記号, 外か中か, [点…], 種類)。点は (u, v, z) か "@ゴールの id"。種類は全体で 1 つか、区間ごとのリスト
PATHS = []


def path(name, area, where, pts, kind="ground"):
    PATHS.append((name, area, where, pts, kind))


# 外（地面 z = 0）
path("道路側（交流棟の北）", "o", "out", [(-130, 10.4, 0), "@exchange-road", (-49, 10.4, 0)])
path("道路側（教室棟の北）", "o", "out", [(-49, 20, 0), "@classroom-road", (65.7, 20, 0)])
path("西の道路", "o", "out", [(-130, 10.4, 0), (-130, -32, 0), "@big-tree"])
path("正面の道（南）", "o", "out", ["@big-tree", (-100, -107.8, 0), (-55, -107.8, 0)])
path("本部棟の東の道", "o", "out", [(-55, -107.8, 0), (-55, -80.8, 0), (-55, -46.2, 0), (-55, -32, 0)])
path("交流棟と本部棟の間", "o", "out", [(-130, -32, 0), (-100, -32, 0), (-88, -32, 0), (-72.7, -32, 0), (-55, -32, 0), (-49, -32, 0)])
path("渡り廊下の下へ", "o", "out", [(-72.7, -32, 0), "@hq-exchange-bridge"])
path("交流棟と教室棟の間", "o", "out", [(-49, 20, 0), (-49, 10.4, 0), (-49, 0.2, 0), (-49, -16.3, 0), (-49, -32, 0), (-49, -46.2, 0)])
path("教室棟の入口へ", "o", "out", [(-49, 0.2, 0), "@classroom-entrance"])
path("広場（東西）", "o", "out", [(-55, -46.2, 0), (-49, -46.2, 0), "@grand-stairs-bottom"])
path("教室棟の南（広場側）", "o", "out", [(-49, -16.3, 0), (-33.8, -16.3, 0), "@classroom-research-corner"])
path("広場から教室棟へ", "o", "out", [(-33.8, -16.3, 0), "@grand-stairs-bottom"])
path("広場（南北）", "o", "out", ["@grand-stairs-bottom", (-33.8, -80.8, 0), "@koryu-plaza"])
path("交流プラザと本部棟の間", "o", "out", [(-55, -80.8, 0), (-33.8, -80.8, 0)])
path("交流プラザから研究棟の南へ", "o", "out", ["@koryu-plaza", (-21.6, -97.7, 0), "@research-south"])
path("研究棟の道路側（東）", "o", "out", [(65.7, 20, 0), "@research-road", (65.7, -97.7, 0), "@research-south"])
# 大階段（u -30.8〜-4.8 で 8.1m 上がる）→ SIT の芝生 → 研究棟ゲート → 道路側へ下りる
path("大階段", "o", "out", ["@grand-stairs-bottom", (-30.8, -46.2, 0), (-4.8, -46.2, 8.1), "@sit-lawn"],
     ["ground", "stairs", "ground"])
path("研究棟ゲート", "o", "out", ["@sit-lawn", "@research-gate", (57.9, -46.0, 8.1), "@research-road"],
     ["ground", "ground", "stairs"])
# 本部棟のまわり（玄関は西の箱の東の面、ピロティは南東）
path("本部棟の玄関とピロティ", "o", "out", ["@hq-entrance", (-100, -57, 0), (-100, -87, 0), "@hq-piloti"])
path("ピロティから正面の道へ", "o", "out", [(-100, -87, 0), (-100, -107.8, 0)])
path("本部棟の玄関から北へ", "o", "out", [(-100, -57, 0), (-88, -57, 0), (-88, -32, 0)])

# 教室棟 1F：入口 → 交流棟側の階段・エスカレーター（1F→2F→3F）
path("教室棟1F", "k1", "in", ["@classroom-entrance", (-38.4, 0.2, 0), (-38.4, -5.6, 0), (-26.2, -5.6, 0)], "indoor")
path("教室棟1F 階段", "k1", "in", [(-38.4, 0.2, 0), (-38.4, 5.4, 0)], "indoor")
path("エスカレーター 1F→3F", "k1", "in", [(-26.2, -5.6, 0), (-13.4, -5.6, 6), (-10.9, -5.6, 6), (0.18, -5.6, 11.0)],
     ["escalator", "indoor", "escalator"])

# 教室棟 3F〜6F：廊下（v -2.5）、教室（v 5.4）、ロビー（v -5.6）、交流棟側の端の階段（u -38.4）
U = 2.9
ROOMS = {
    3: [("301", -27.55), ("302", -13.05), ("303", 1.45), ("304", 15.95), ("305", 29.0)],
    4: [(str(403 + i), -29.0 + 11.6 * i) for i in range(6)],
    5: [(str(502 + i), -30.93 + 7.733 * i) for i in range(6)] + [(str(508 + i), 14.5 + 5.8 * i) for i in range(4)],
    6: [],
}
FZ = {3: 11.0, 4: 16.0, 5: 21.0, 6: 26.0}
LOBBY = {3: ("@classroom-3f-lobby", 1.4), 4: ("@classroom-4f-lobby", 16.6), 5: ("@classroom-5f-lobby", 25.0),
         6: ((30.5, -5.6, 26.0), 30.5)}
ROOM_NODE = {}                                   # (階, 教室) → 点の座標（あとで名前をつける）
# 教室棟 2F：会場ではないが、交流棟への渡り廊下（2F・4F・6F の 3 本のうちの 1 本）がある。エスカレーターの乗り継ぎ → 廊下 → 交流棟側の端
path("教室棟2F 廊下", "k2", "in", [(-42.05, -2.5, 6.0), (-40.0, -2.5, 6.0), (-38.4, -2.5, 6.0), (-13.4, -2.5, 6.0),
                                     (-13.4, -5.6, 6.0)], "indoor")
path("教室棟2F 階段", "k2", "in", [(-38.4, -2.5, 6.0), (-38.4, 5.4, 6.0)], "indoor")
for f, z in FZ.items():
    stops = sorted({-40.0, -38.4, 36.0, LOBBY[f][1]} | {uc for _, uc in ROOMS[f]} | ({-32.6} if f == 3 else set()))
    west = "@classroom-6f-bridge" if f == 6 else (-40.0, -2.5, z)
    wall = [(-42.05, -2.5, z)] if f in (4, 6) else []          # 交流棟への渡り廊下の口（教室棟の壁）
    path(f"教室棟{f}F 廊下", f"k{f}", "in", wall + [west] + [(u, -2.5, z) for u in stops if u > -40.0], "indoor")
    for room, uc in ROOMS[f]:
        p = "@shibalab" if (f, room) == (3, "301") else (uc, 5.4, z)
        path(f"教室棟{f}F {room}", f"k{f}", "in", [(uc, -2.5, z), p], "indoor")
        ROOM_NODE[(round(uc, 2), 5.4, z)] = f"教室棟{f}F {room}"
    lob, lu = LOBBY[f]
    path(f"教室棟{f}F ロビー", f"k{f}", "in", [(lu, -2.5, z), lob], "indoor")
    path(f"教室棟{f}F 階段", f"k{f}", "in", [(-38.4, -2.5, z), (-38.4, 5.4, z)], "indoor")
path("教室棟3F Global Learning Commons", "k3", "in", [(-32.6, -2.5, 11.0), (-32.6, -7.5, 11.0)], "indoor")
ROOM_NODE[(-32.6, -7.5, 11.0)] = "教室棟3F Global Learning Commons"
# 階をまたぐ（エスカレーターはロビーどうし、階段は交流棟側の端）
# エスカレーター（build_kyoshitsu_interior.py の ESC）：乗り口・降り口をロビー側（v -5.6）に置く
#   2F→3F：-10.9→0.18、3F→4F：2.68→13.74、4F→5F・5F→6F：19.4→30.5（同じ XY に重なる）
path("教室棟3F ロビー（エスカレーター）", "k3", "in", [(0.18, -5.6, 11.0), "@classroom-3f-lobby", (2.68, -5.6, 11.0)], "indoor")
path("教室棟4F ロビー（エスカレーター）", "k4", "in", [(13.74, -5.6, 16.0), "@classroom-4f-lobby", (19.4, -5.6, 16.0)], "indoor")
path("教室棟5F ロビー（エスカレーター）", "k5", "in", [(30.5, -5.6, 21.0), "@classroom-5f-lobby", (19.4, -5.6, 21.0)], "indoor")
path("エスカレーター 3F→4F", "k3", "in", [(2.68, -5.6, 11.0), (13.74, -5.6, 16.0)], "escalator")
path("エスカレーター 4F→5F", "k4", "in", [(19.4, -5.6, 16.0), (30.5, -5.6, 21.0)], "escalator")
path("エスカレーター 5F→6F", "k5", "in", [(19.4, -5.6, 21.0), (30.5, -5.6, 26.0)], "escalator")
FZA = {1: 0.0, 2: 6.0, **FZ}
for a, b in ((1, 2), (2, 3), (3, 4), (4, 5), (5, 6)):
    za, zb = FZA[a], FZA[b]
    path(f"教室棟 階段 {a}F→{b}F", f"k{a}", "in", [(-38.4, 5.4, za), (-38.4, 5.4, zb)], "stairs")

# 交流棟 4F・6F：廊下（本部棟側、y -8.25）、教室（道路側）、+X の端から教室棟へ、x 16.5 から本部棟へ
for f, z in ((4, 16.0), (6, 26.0)):
    stops = [-28.0, -3.2, 0.0, 3.2, 9.5, 16.5, 24.0]
    path(f"交流棟{f}F 廊下", f"x{f}", "in", [X(x, -8.25, z) for x in stops], "indoor")
    if f == 4:
        path("交流棟4F 401", "x4", "in", [X(-3.2, -8.25, z), X(-3.2, 2.8, z)], "indoor")
        path("交流棟4F 402", "x4", "in", [X(9.5, -8.25, z), X(9.5, 2.8, z)], "indoor")
        ROOM_NODE[tuple(round(c, 2) for c in X(-3.2, 2.8, z))] = "交流棟4F 401"
        ROOM_NODE[tuple(round(c, 2) for c in X(9.5, 2.8, z))] = "交流棟4F 402"
        path("交流棟4F 廊下の点", "x4", "in", [X(3.2, -8.25, z), "@exchange-4f"], "indoor")
    else:
        path("交流棟6F 大講義室", "x6", "in", [X(0.0, -8.25, z), "@exchange-6f-hall"], "indoor")
    # 教室棟へ（+X の妻の口 → 渡り廊下 → 教室棟の交流棟側の壁の口。口から先は教室棟の廊下）
    path(f"交流棟{f}F から教室棟へ", f"x{f}", "in",
         [X(24.0, -8.25, z), X(28.0, -8.25, z), X(28.0, 9.15, z), X(33.2, 9.15, z), (-42.05, -2.5, z)],
         ["indoor", "indoor", "indoor", "bridge"])
    # 本部棟へ（-Y の口 → 渡り廊下）
    hq = "@hq-4f-bridge" if f == 4 else "@hq-6f-bridge"
    path(f"交流棟{f}F から本部棟へ", f"x{f}", "in", [X(16.5, -8.25, z), X(16.5, -11.85, z), hq], ["indoor", "bridge"])
# 交流棟 2F：教室棟からの渡り廊下（2F）の口 → +X の端の階段（4F・6F へ）
path("交流棟2F から教室棟へ", "x2", "in",
     [X(24.0, -8.25, 6.0), X(28.0, -8.25, 6.0), X(28.0, 9.15, 6.0), X(33.2, 9.15, 6.0), (-42.05, -2.5, 6.0)],
     ["indoor", "indoor", "indoor", "bridge"])
path("交流棟 階段 2F→4F", "x2", "in", [X(24.0, -8.25, 6.0), X(24.0, -8.25, 16.0)], "stairs")
path("交流棟 階段 4F→6F", "x4", "in", [X(24.0, -8.25, 16.0), X(24.0, -8.25, 26.0)], "stairs")
# 本部棟：渡り廊下の口どうし（階段）と、4F から 1F の玄関へ
path("本部棟 階段 4F→6F", "h4", "in", ["@hq-4f-bridge", "@hq-6f-bridge"], "stairs")
path("本部棟 階段 4F→1F", "h4", "in", ["@hq-4f-bridge", (-72.3, -50.9, 0)], "stairs")
path("本部棟1F", "h1", "in", [(-72.3, -50.9, 0), (-88, -50.9, 0), (-88, -57, 0)], "indoor")   # 玄関の前の道（外）につながる

# ---------- 点を打つ ----------
nodes = [dict(n, role="checkpoint") for n in CHECK]
grid = {n["id"]: L[n["id"]] for n in CHECK}       # id → (u, v, z)
count, edges = {}, {}


def find(p):
    for nid, q in grid.items():
        if abs(q[2] - p[2]) < 0.5 and math.hypot(q[0] - p[0], q[1] - p[1]) < MERGE:
            return nid
    return None


def node(p, area, where, label):
    nid = find(p)
    if nid:
        return nid
    count[area] = count.get(area, 0) + 1
    nid = f"{area}-{count[area]:03d}"
    grid[nid] = p
    key = tuple(round(c, 2) for c in p)
    name = ROOM_NODE.get(key, f"{label}")
    floor = "屋外" if where == "out" else f"{area[1]}F"
    building = None if where == "out" else {"k": "教室棟", "x": "交流棟", "h": "本部棟"}[area[0]]
    nodes.append(dict(id=nid, name=name, building=building, floor=floor, blender=to_world(*p), radius=5 if where == "out" else 3,
                      gpsSnap=(where == "out" and p[2] == 0), role="room" if key in ROOM_NODE else "waypoint", note=""))
    return nid


def edge(a, b, kind):
    if a == b:
        return
    k = tuple(sorted((a, b)))
    if k not in edges:
        edges[k] = {"id": f"{a}--{b}", "from": a, "to": b, "kind": kind}


for name, area, where, pts, kind in PATHS:
    pts = [at(p[1:]) if isinstance(p, str) else p for p in pts]
    kinds = kind if isinstance(kind, list) else [kind] * (len(pts) - 1)
    prev = node(pts[0], area, where, name)
    for (a, b), k in zip(zip(pts, pts[1:]), kinds):
        d = math.hypot(b[0] - a[0], b[1] - a[1])
        n = 1 if k in ("stairs", "escalator", "bridge") and d < 1 else max(1, math.ceil(d / STEP[where]))
        if k in ("escalator", "bridge") or (k == "stairs" and d < 1):
            n = 1                                   # エスカレーター・渡り廊下・縦の階段は途中に点を打たない
        for i in range(1, n + 1):
            t = i / n
            p = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, round(a[2] + (b[2] - a[2]) * t, 2))
            cur = node(p, area, where, name)
            edge(prev, cur, k)
            prev = cur

# 名前に番号をつける（同じ道の点が並ぶので）
seen = {}
for n in nodes:
    if n["role"] == "waypoint":
        seen[n["name"]] = seen.get(n["name"], 0) + 1
        n["name"] = f'{n["name"]} {seen[n["name"]]}'
src = {"$comment": old["$comment"] + "。点とつながりは build_network.py で作る（道の定義を直して作り直す）",
       "nodes": nodes, "edges": list(edges.values())}
json.dump(src, open(SRC, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# ---------- 確かめる ----------
ids = {n["id"] for n in nodes}
deg = {i: 0 for i in ids}
for e in src["edges"]:
    deg[e["from"]] += 1
    deg[e["to"]] += 1
adj = {i: set() for i in ids}
for e in src["edges"]:
    adj[e["from"]].add(e["to"])
    adj[e["to"]].add(e["from"])
seenc, stack = {"classroom-entrance"}, ["classroom-entrance"]
while stack:
    for m in adj[stack.pop()] - seenc:
        seenc.add(m)
        stack.append(m)
lens = [math.dist(grid[e["from"]][:2], grid[e["to"]][:2]) for e in src["edges"] if e["kind"] in ("ground", "indoor")]
roles = {}
for n in nodes:
    roles[n["role"]] = roles.get(n["role"], 0) + 1
print("点", len(nodes), roles, "／ つながり", len(src["edges"]))
print("道の点の間隔（m）: 最小 %.1f 平均 %.1f 最大 %.1f" % (min(lens), sum(lens) / len(lens), max(lens)))
print("入口からたどれない点:", sorted(ids - seenc))
print("どこにもつながっていない点:", [i for i, d in deg.items() if d == 0])
