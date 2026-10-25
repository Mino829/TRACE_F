# 参加者の画面（撮影場所を選ぶ地図）に渡す小さなデータ src/lib/places/places.json を書き出す（TRACE_F #38 / #42）
#   python models/trace/export_places.py
#   - 選べる点 = campus_graph.json の selectable な点（建物 → 階 → 点）。グラフの内部の点は入れない
#   - 建物の輪郭 = 棟ごとの高さ場（models/trace/places_heightfield.json）から、階ごとの「その高さより高い所」の外周を出す。
#     高さ場は Blender で作る：blender -b models/buildings/<棟>.blend --python models/scripts/export_places_heightfield.py -- <出力>
#     高さ場が無いときは 配置.json の箱で代わりにする（粗い）
#   - 座標は Blender の座標（m）から ORIGIN を引いたもの。ORIGIN は scripts/export_web.py の CAMPUS_ORIGIN と同じ（4 棟の center の平均）
#   何度実行しても同じ。Blender は要らない。
import io, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))                    # TRACE_F のルート
GRAPH = os.path.join(HERE, "campus_graph.json")
PLACEMENT = os.path.join(ROOT, "models", "buildings", "配置.json")
HEIGHTFIELD = os.path.join(HERE, "places_heightfield.json")
OUT = os.path.join(ROOT, "src", "lib", "places", "places.json")

# 配置.json の棟の名前 → 画面の id と名前
BUILDINGS = [("研究棟", "kenkyu"), ("教室棟", "kyoshitsu"), ("交流棟", "koryu"), ("本部棟", "honbu")]
IDS = dict(BUILDINGS)
OUTDOOR = ("屋外", "屋外2F")
OUTDOOR_Z = {"屋外": 0.0, "屋外2F": 6.0}
# 渡り廊下の点：選べる点の中で、もう 1 つの棟とつなぐもの
#   教室棟は 1 フロア 3 点（交流棟側・エスカレーター・研究棟側）だけにするので、教室棟〜交流棟・研究棟の渡り廊下は相手の棟だけで出す（2026-10-25）
JOINS = {
    "hq-4f-bridge": "koryu", "hq-6f-bridge": "koryu",
}
# 階の高さに建物の実体があるかの判定（縦の断面の面の列から）：その階の床から 1.5m の高さ（目の高さ）を見て、
#   下 2.2m 以内に床（面）があり、上 8.0m 以内に天井か上の階の床（面）があれば建物の中。
#   本部棟のピロティ（1F・2F の上が 11m まで空）や、研究棟のゲート（デッキ 6.0m の上が天井 34.4m まで空）は空く
EYE, BELOW, ABOVE = 1.5, 2.2, 8.0
# 教室棟と研究棟は 1〜8F の研究棟側の端（研究棟座標 X < -22.4、教室棟の「曲がり角」）が教室棟.blend にあり、
# 8F より上の研究棟の端は研究棟.blend にある。その範囲だけ、もう一方の棟のファイルの断面も足す
SHARED_X = -22.4
CELL = 1.0
MAX_POINTS = 200


def nbytes(o):
    return len(json.dumps(o, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


# ---------- 輪郭 ----------
def outline(occ, x0, y0, cell):
    """占有格子（occ[j][i]、True = 建物）の外周。閉じたループの配列（局所座標）。穴も別のループになる"""
    ny, nx = len(occ), len(occ[0]) if occ else 0
    inside = lambda i, j: 0 <= i < nx and 0 <= j < ny and occ[j][i]
    out = {}
    for j in range(ny):
        for i in range(nx):
            if not occ[j][i]:
                continue
            # 反時計回りの辺。隣が空のところだけ
            if not inside(i, j - 1):
                out.setdefault((i, j), []).append((i + 1, j))
            if not inside(i + 1, j):
                out.setdefault((i + 1, j), []).append((i + 1, j + 1))
            if not inside(i, j + 1):
                out.setdefault((i + 1, j + 1), []).append((i, j + 1))
            if not inside(i - 1, j):
                out.setdefault((i, j + 1), []).append((i, j))
    loops = []
    while out:
        start = next(iter(out))
        loop, cur = [start], start
        while True:
            nxts = out[cur]
            nxt = nxts.pop()
            if not nxts:
                del out[cur]
            if nxt == start:
                break
            loop.append(nxt)
            cur = nxt
            if cur not in out:
                break
        loops.append(loop)
    return [[(x0 + i * cell, y0 + j * cell) for i, j in simplify_collinear(loop)] for loop in loops if len(loop) >= 4]


def simplify_collinear(loop):
    n = len(loop)
    keep = []
    for k in range(n):
        a, b, c = loop[k - 1], loop[k], loop[(k + 1) % n]
        if (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) != 0:
            keep.append(b)
    return keep


def douglas(points, tol):
    """閉じたループの点を、許す誤差 tol(m) で間引く"""
    if len(points) <= 4:
        return points
    # 一番離れた 2 点で割って、それぞれ開いた線として間引く
    i0 = 0
    i1 = max(range(len(points)), key=lambda k: math.dist(points[0], points[k]))
    def open_line(pts):
        if len(pts) < 3:
            return pts
        (ax, ay), (bx, by) = pts[0], pts[-1]
        L = math.hypot(bx - ax, by - ay) or 1e-9
        d = [abs((bx - ax) * (ay - p[1]) - (ax - p[0]) * (by - ay)) / L for p in pts[1:-1]]
        m = max(range(len(d)), key=lambda k: d[k])
        if d[m] <= tol:
            return [pts[0], pts[-1]]
        return open_line(pts[: m + 2])[:-1] + open_line(pts[m + 1:])
    a = open_line(points[i0: i1 + 1])
    b = open_line(points[i1:] + [points[0]])
    return a[:-1] + b[:-1]


MIN_TOLERANCE = 1.0      # 格子（1m）の段差は間引く。斜めの壁が階段状にならないように


def limit(loops, cap=MAX_POINTS):
    tol = MIN_TOLERANCE
    loops = [douglas(l, tol) for l in loops]
    loops = [l for l in loops if len(l) >= 3]
    while sum(len(l) for l in loops) > cap and tol < 20:
        tol += 0.5
        loops = [douglas(l, tol) for l in loops]
        loops = [l for l in loops if len(l) >= 3]
    return loops


MIN_LOOP_AREA = 25.0     # これより小さいループ（エレベーターの縦穴・階段の穴・柱）は捨てる


def area(loop):
    return 0.5 * sum(loop[k][0] * loop[(k + 1) % len(loop)][1] - loop[(k + 1) % len(loop)][0] * loop[k][1] for k in range(len(loop)))


def to_world(loops, theta, center, origin):
    loops = [l for l in loops if abs(area(l)) >= MIN_LOOP_AREA]
    c, s = math.cos(theta), math.sin(theta)
    return [[[round(c * x - s * y + center[0] - origin[0], 1), round(s * x + c * y + center[1] - origin[1], 1)] for x, y in l] for l in loops]


# ---------- 高さ場（Blender が作る）か、配置.json の箱 ----------
def grid_from_heightfield(hf):
    nx, ny = hf["nx"], hf["ny"]
    h = hf["hits"]
    return dict(x0=hf["x0"], y0=hf["y0"], cell=hf["cell"], nx=nx, ny=ny, hits=[[h[j * nx + i] for i in range(nx)] for j in range(ny)])


def grid_from_boxes(boxes):
    """配置.json の箱から高さ場の代わりを作る。z0 が地面でない箱（浮いた階）は、その下の階の占有に数えない"""
    xs, ys = [], []
    rects = []
    for b in boxes:
        if "L" in b:
            cx, cy = b["pos"]
            r = (cx - b["L"] / 2, cx + b["L"] / 2, cy - b["W"] / 2, cy + b["W"] / 2, 0.0, b["H"])
        else:
            r = (b["x0"], b["x1"], b["y0"], b["y1"], b["z0"], b["z1"])
        rects.append(r)
        xs += [r[0], r[1]]
        ys += [r[2], r[3]]
    x0, y0 = math.floor(min(xs)) - 1, math.floor(min(ys)) - 1
    nx, ny = math.ceil(max(xs)) + 1 - x0, math.ceil(max(ys)) + 1 - y0
    return dict(x0=x0, y0=y0, cell=CELL, nx=nx, ny=ny, rects=rects)


def occupied(grid, z):
    """高さ z の水平な面で、建物のある格子（局所座標）"""
    nx, ny, cell = grid["nx"], grid["ny"], grid["cell"]
    occ = [[False] * nx for _ in range(ny)]
    if "hits" in grid:
        eye = z + EYE
        for j in range(ny):
            for i in range(nx):
                col = grid["hits"][j][i]
                occ[j][i] = any(eye - BELOW <= h <= eye for h in col) and any(eye < h <= eye + ABOVE for h in col)
        return occ
    for j in range(ny):
        for i in range(nx):
            x, y = grid["x0"] + (i + 0.5) * cell, grid["y0"] + (j + 0.5) * cell
            occ[j][i] = any(r[0] <= x < r[1] and r[2] <= y < r[3] and r[4] <= z < r[5] for r in grid["rects"])
    return occ


def max_height(grid, cells=None):
    if "hits" in grid:
        tops = [grid["hits"][j][i][0] for j, i in cells if grid["hits"][j][i]] if cells else [c[0] for row in grid["hits"] for c in row if c]
        return max(tops, default=0.0)
    return max(r[5] for r in grid["rects"])


def main():
    graph = json.load(io.open(GRAPH, encoding="utf-8"))
    placement = json.load(io.open(PLACEMENT, encoding="utf-8"))
    hfs = json.load(io.open(HEIGHTFIELD, encoding="utf-8")) if os.path.exists(HEIGHTFIELD) else {}
    origin = [sum(placement[b]["center"][0] for b, _ in BUILDINGS) / 4, sum(placement[b]["center"][1] for b, _ in BUILDINGS) / 4]

    # --- 選べる点
    cps = []
    for n in graph["nodes"]:
        if not n.get("selectable"):
            continue
        if n["floor"] in OUTDOOR or n["building"] is None:
            b = "outdoor"
        else:
            b = IDS[n["building"]]
        cp = {"id": n["id"], "name": n["name"], "building": b, "floor": n["floor"],
              "x": round(n["threeD"]["x"] - origin[0], 1), "y": round(n["threeD"]["y"] - origin[1], 1), "z": round(n["threeD"]["z"], 1)}
        if n["id"] in JOINS:
            cp["joins"] = JOINS[n["id"]]
        cps.append(cp)

    # --- 棟（格子と、world の点でその棟の階に建物があるかを引く関数）
    grids = {jp: (grid_from_heightfield(hfs[jp]) if jp in hfs else grid_from_boxes(placement[jp]["boxes"])) for jp, _ in BUILDINGS}
    occ_cache = {}

    def occ_of(jp, z):
        key = (jp, z)
        if key not in occ_cache:
            occ_cache[key] = occupied(grids[jp], z)
        return occ_cache[key]

    def local(jp, wx, wy):
        P = placement[jp]
        c, s_ = math.cos(P["theta"]), math.sin(P["theta"])
        dx, dy = wx - P["center"][0], wy - P["center"][1]
        return c * dx + s_ * dy, -s_ * dx + c * dy

    def world(jp, lx, ly):
        P = placement[jp]
        c, s_ = math.cos(P["theta"]), math.sin(P["theta"])
        return c * lx - s_ * ly + P["center"][0], s_ * lx + c * ly + P["center"][1]

    RB = placement["研究棟"]["boxes"]
    RY = (min(b["pos"][1] - b["W"] / 2 for b in RB), max(b["pos"][1] + b["W"] / 2 for b in RB))   # 南棟〜北棟（光庭も入れる）
    RX = min(b["pos"][0] - b["L"] / 2 for b in RB)

    def inside_research_boxes(lx, ly):
        return RX <= lx and RY[0] <= ly <= RY[1]

    def column(jp, wx, wy):
        """world の点の、その棟のファイルの断面（面の高さの列）。高さ場が無ければ空"""
        g = grids[jp]
        if "hits" not in g:
            return []
        lx, ly = local(jp, wx, wy)
        i, j = int((lx - g["x0"]) // g["cell"]), int((ly - g["y0"]) // g["cell"])
        return g["hits"][j][i] if 0 <= i < g["nx"] and 0 <= j < g["ny"] else []

    def shared_occ(jp, z):
        """その棟の階の占有。教室棟と研究棟の端（曲がり角）は、もう一方のファイルの断面も足す"""
        own = occ_of(jp, z)
        other = {"研究棟": "教室棟", "教室棟": "研究棟"}.get(jp)
        if not other:
            return own
        g = grids[jp]
        out = [row[:] for row in own]
        for j in range(g["ny"]):
            for i in range(g["nx"]):
                if out[j][i]:
                    continue
                wx, wy = world(jp, g["x0"] + (i + 0.5) * g["cell"], g["y0"] + (j + 0.5) * g["cell"])
                rx, ry = local("研究棟", wx, wy)
                if not (rx < SHARED_X and inside_research_boxes(rx, ry)):
                    continue
                # 両方のファイルの面を合わせて判定する（8F の床は教室棟、その上の天井は研究棟、のように分かれている）
                col = column(jp, wx, wy) + column(other, wx, wy)
                eye = z + EYE
                out[j][i] = any(eye - BELOW <= h <= eye for h in col) and any(eye < h <= eye + ABOVE for h in col)
        return out

    buildings = []
    def fnum(label):
        return 0 if label in OUTDOOR else int(label[:-1])
    for jp, bid in BUILDINGS:
        P = placement[jp]
        grid = grids[jp]
        mine = [c for c in cps if c["building"] == bid]
        floors = {}
        for c in mine:
            floors.setdefault(c["floor"], c["z"])
        def loops(occ):
            return to_world(limit(outline(occ, grid["x0"], grid["y0"], grid["cell"])), P["theta"], P["center"], origin)
        occs = {lab: shared_occ(jp, z) for lab, z in floors.items()}
        # 上から見た形 = どれかの階に建物がある所（大階段・デッキ・ピロティの下は入らない）
        union = [[any(o[j][i] for o in occs.values()) for i in range(grid["nx"])] for j in range(grid["ny"])]
        cells = [(j, i) for j in range(grid["ny"]) for i in range(grid["nx"]) if union[j][i]]
        footprint = loops(union)
        fl = [{"label": lab, "z": z, "outlines": loops(occs[lab])} for lab, z in sorted(floors.items(), key=lambda kv: fnum(kv[0]))]
        flat = [p for l in footprint for p in l]
        cx = sum(p[0] for p in flat) / len(flat)
        cy = sum(p[1] for p in flat) / len(flat)
        roof = round(max_height(grid, cells), 1)
        buildings.append({"id": bid, "name": jp, "labelAt": [round(cx, 1), round(cy, 1), roof], "roofZ": roof, "footprint": footprint, "floors": fl})

    # --- 屋外：輪郭は無し。デッキ（屋外2F）は 6.0m
    out_floors = sorted({c["floor"] for c in cps if c["building"] == "outdoor"}, key=lambda l: OUTDOOR_Z.get(l, 0))
    buildings.append({"id": "outdoor", "name": "屋外", "labelAt": [0.0, 0.0, 0.0], "roofZ": 0.0, "footprint": [],
                      "floors": [{"label": l, "z": OUTDOOR_Z.get(l, 0.0), "outlines": []} for l in out_floors]})

    # --- 目印：教室棟のエスカレーター（グラフの escalator の線の両端）
    nodes = {n["id"]: n for n in graph["nodes"]}
    landmarks = []
    for e in graph["edges"]:
        if e["kind"] != "escalator":
            continue
        a, b = nodes[e["from"]], nodes[e["to"]]
        if a["building"] != "教室棟" or b["building"] != "教室棟":
            continue
        pt = lambda n: [round(n["threeD"]["x"] - origin[0], 1), round(n["threeD"]["y"] - origin[1], 1), round(n["threeD"]["z"], 1)]
        lo, hi = sorted((a, b), key=lambda n: n["threeD"]["z"])
        landmarks.append({"kind": "escalator", "building": "kyoshitsu", "from": pt(lo), "to": pt(hi), "width": 2.7})

    data = {"graphVersion": graph["campusGraphVersion"], "origin": [round(origin[0], 2), round(origin[1], 2)], "buildings": buildings, "checkpoints": cps, "landmarks": landmarks}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    io.open(OUT, "w", encoding="utf-8", newline="").write(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print("places.json", nbytes(data), "bytes", len(cps), "点", "高さ場:" + ",".join(hfs) if hfs else "箱から")
    # 検証：選べる点がどれかの棟の階に入っている
    have = {(b["id"], f["label"]) for b in buildings for f in b["floors"]}
    miss = [c["id"] for c in cps if (c["building"], c["floor"]) not in have]
    print("階に入っていない点:", miss)
    # 検証：点がその階の輪郭の中にあるか（屋外は除く。2m の余裕）
    def inside(loops, x, y):
        k = False
        for l in loops:
            for a in range(len(l)):
                (x1, y1), (x2, y2) = l[a], l[(a + 1) % len(l)]
                if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                    k = not k
        return k
    near = lambda loops, x, y: any(inside(loops, x + dx, y + dy) for dx in (-2, 0, 2) for dy in (-2, 0, 2))
    fmap = {(b["id"], f["label"]): f for b in buildings for f in b["floors"]}
    print("輪郭の外の点:", [c["id"] for c in cps if c["building"] != "outdoor" and not near(fmap[(c["building"], c["floor"])]["outlines"], c["x"], c["y"])])
    return 0


if __name__ == "__main__":
    sys.exit(main())
