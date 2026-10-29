# 道の網の線を、壁を抜けず、廊下の真ん中を通るように引き直す（2026-10-29、TRACE_F #76）
#   blender -b --factory-startup --python trace/reroute_walls.py            … 引き直して campus_graph.src.json に書き戻す
#   blender -b --factory-startup --python trace/reroute_walls.py -- --check … 点検だけ（書き戻さない）
#   add_nodes_8.py のあとに 1 回だけ実行する（引き直した線をもう一度引き直すことはしない）
# 展示画面と同じ export/campus_web.glb を当たり判定に使う。扉は全部開けてあるので（各建物のスクリプトの OPEN_DOORS）、
# 扉の枠も壁として扱い、扉の真ん中を通す。
#   1. エレベーター：かごの点から 4 方向に光線を当てて扉の向き（一番遠くまで抜ける向き）を探し、
#      扉からまっすぐ 1.5m 出た所（ホールの中）に「エレベーターの前」の点を置く。かごと階をつなぐ線はすべてこの点を通す
#   1b. 壁から 0.5m より近い点（乗り降りの点を除く）を、まわり 1.5m の中で壁から離れた所へ少し動かす
#   2. 研究棟・本部棟・交流棟の中の平らな線と、渡り廊下の線（と、ほかの建物でも壁に近すぎる線）を引き直す：
#      建物の碁盤の目に沿った 0.125m のマス目で、目の高さ（1.0m・1.6m）で壁から 0.3m 以上離れ、足元に床がある所だけを通り、
#      壁から 1.2m より近いほど通りにくくして（廊下の真ん中を通る）、曲がる回数を少なくした道を探し、角に点を置く
#      ただし線の全長で壁から 0.45m 以上離れている線は、そのまま残す
#   3. 最後に全部の線を点検して、壁から 0.35m 以内に入る線を表示する
import bpy, json, math, os, sys, heapq
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "trace", "campus_graph.src.json")
GLB = os.path.join(ROOT, "export", "campus_web.glb")
P = json.load(open(os.path.join(ROOT, "buildings", "配置.json"), encoding="utf-8"))
OX, OY = json.load(open(os.path.join(ROOT, "export", "campus_web.json"), encoding="utf-8"))["campus_origin_map_xy"]
CHECK = "--check" in sys.argv
RES, TURN, PAD = 0.125, 3.0, 20.0
CLEAR, KEEP, PREFER, CENTER_W = 0.3, 0.45, 1.2, 4.0
# 壁が NARROW より近い所では曲がりにくくする：展示の一人称は角を 2m 丸めて歩き、丸めで内側へ最大 0.81m 寄るので、
#   扉を抜けた直後などで曲がると枠に近づく。広い所まで進んでから曲がるようにする
NARROW, NARROW_TURN = 0.9, 40.0
EYES = (1.0, 1.6)
FLAT = ("indoor", "ground", "bridge")
REDRAW = ("研究棟", "本部棟", "交流棟")
DIRS8 = [Vector((math.cos(a * math.pi / 8), math.sin(a * math.pi / 8), 0)) for a in range(16)]

# ---------- 展示の 3D（campus_web.glb）を光線の当たり判定にする ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
dg = bpy.context.evaluated_depsgraph_get()
verts, polys, mats, objs = [], [], [], []
for ob in bpy.context.scene.objects:
    if ob.type != 'MESH':
        continue
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    base, mw, sl = len(verts), ob.matrix_world, ob.material_slots
    verts += [mw @ v.co for v in me.vertices]
    for p in me.polygons:
        polys.append([base + i for i in p.vertices])
        m = sl[p.material_index].material if sl and p.material_index < len(sl) else None
        mats.append(m.name if m else "")
        objs.append(ob.name)
    ev.to_mesh_clear()
bvh = BVHTree.FromPolygons(verts, polys)

src = json.load(open(SRC, encoding="utf-8"))
N = {n["id"]: n for n in src["nodes"]}


def V(i):
    x, y, z = N[i]["blender"]
    return Vector((x - OX, y - OY, z))


def theta_for(i):
    b = N[i].get("building")
    return P[b]["theta"] if b in P else P["教室棟"]["theta"]


def wall_dist(p, reach=PREFER):
    """床の高さ p に立った人の目の高さで、水平に一番近い壁までの距離（reach まで）と、その壁"""
    best, what = reach, None
    for h in EYES:
        q = p + Vector((0, 0, h))
        for d in DIRS8:
            loc, nrm, idx, dist = bvh.ray_cast(q, d, best)
            if loc is not None and dist < best:
                best, what = dist, (objs[idx], mats[idx])
    return best, what


def has_floor(p):
    for off in ((0, 0), (0.3, 0), (-0.3, 0), (0, 0.3), (0, -0.3)):      # 床の継ぎ目の細いすき間は床とみなす
        loc, nrm, idx, d = bvh.ray_cast(p + Vector((off[0], off[1], 0.4)), Vector((0, 0, -1)), 0.7)
        if loc is not None:
            return True
    return False


def line_clearance(a, b, step=0.25):
    """a→b の線に沿って、壁までの一番近い距離と、その壁"""
    L = (b - a).length
    n = max(1, int(L / step))
    best, what = KEEP + 1, None
    for i in range(n + 1):
        d, w = wall_dist(a + (b - a) * (i / n), KEEP + 1)
        if d < best:
            best, what = d, w
    return best, what


def route(a, b, pa=None, pb=None):
    """a→b（同じ高さ）の、壁をよけて廊下の真ん中を通る角ばった道の角の点（両端を含む）。見つからなければ None"""
    pa = pa or V(a)
    pb = pb or V(b)
    z, th = pa.z, theta_for(a)
    ux, uy = Vector((math.cos(th), math.sin(th), 0)), Vector((-math.sin(th), math.cos(th), 0))

    def to_w(u, v):
        w = pa + ux * u + uy * v
        w.z = z
        return w
    d = pb - pa
    ub, vb = d.dot(ux), d.dot(uy)
    start, goal = (0, 0), (round(ub / RES), round(vb / RES))
    pad = int(PAD / RES)
    lo = (min(0, goal[0]) - pad, min(0, goal[1]) - pad)
    hi = (max(0, goal[0]) + pad, max(0, goal[1]) + pad)
    cache = {}

    def cost(c):
        """そのマスに入る重み。通れなければ None"""
        if c not in cache:
            w = to_w(c[0] * RES, c[1] * RES)
            near = min(abs(c[0]) + abs(c[1]), abs(c[0] - goal[0]) + abs(c[1] - goal[1])) * RES < 1.0
            dist, _ = wall_dist(w)
            if dist < CLEAR and not near:
                cache[c] = None
            elif not near and not has_floor(w):
                cache[c] = None
            else:
                cache[c] = (1.0 + CENTER_W * max(0.0, PREFER - dist) / PREFER, dist)
        return cache[c]
    dirs = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    h0 = lambda c: abs(c[0] - goal[0]) + abs(c[1] - goal[1])
    q = [(h0(start), 0.0, start, -1)]
    best, prev, found, it = {(start, -1): 0.0}, {}, None, 0
    while q and it < 1500000:
        f, gc, c, k0 = heapq.heappop(q)
        it += 1
        if c == goal:
            found = (c, k0)
            break
        if gc > best.get((c, k0), 1e18):
            continue
        for k, (dx, dy) in enumerate(dirs):
            n = (c[0] + dx, c[1] + dy)
            if not (lo[0] <= n[0] <= hi[0] and lo[1] <= n[1] <= hi[1]):
                continue
            w = cost(n)
            if w is None:
                continue
            turn = 0.0
            if k0 not in (-1, k):
                here = cost(c)
                turn = TURN / RES + (NARROW_TURN / RES if here is not None and here[1] < NARROW and c not in (start, goal) else 0.0)
            ng = gc + w[0] + turn
            if ng < best.get((n, k), 1e18):
                best[(n, k)] = ng
                prev[(n, k)] = (c, k0)
                heapq.heappush(q, (ng + h0(n), ng, n, k))
    if not found:
        return None
    cells = [found]
    while cells[-1][0] != start:
        cells.append(prev[cells[-1]])
    cells = [c for c, _ in reversed(cells)]
    corners = [cells[0]] + [cells[i] for i in range(1, len(cells) - 1)
                            if (cells[i][0] - cells[i - 1][0], cells[i][1] - cells[i - 1][1]) != (cells[i + 1][0] - cells[i][0], cells[i + 1][1] - cells[i][1])] + [cells[-1]]
    pts = [to_w(c[0] * RES, c[1] * RES) for c in corners]
    pts[0], pts[-1] = pa, pb
    return pts


def add_node(nid, like, w, name, note):
    n = {"id": nid, "name": name, "building": N[like]["building"], "floor": N[like]["floor"],
         "blender": [round(w.x + OX, 2), round(w.y + OY, 2), N[like]["blender"][2]],
         "radius": 3, "gpsSnap": False, "role": "waypoint", "note": note}
    src["nodes"].append(n)
    N[nid] = n


def add_edge(a, b, kind):
    src["edges"].append({"id": f"{a}--{b}", "from": a, "to": b, "kind": kind})


def drop_edge(eid):
    src["edges"] = [e for e in src["edges"] if e["id"] != eid]


def indoor_of(i):
    n = N[i]
    return n.get("building") in REDRAW and not str(n.get("floor", "")).startswith("屋外")


log = {"fronts": [], "kept": 0, "routed": {}, "failed": {}}
if not CHECK:
    # ---------- 1. エレベーターの扉の前（扉からまっすぐ 1.5m 出たホールの中） ----------
    cars = set()
    for e in src["edges"]:
        if e["kind"] == "elevator":
            cars |= {e["from"], e["to"]}
    for car in sorted(cars):
        fid = car + "-door"
        others = [e for e in src["edges"] if car in (e["from"], e["to"]) and e["kind"] != "elevator"]
        if fid in N or not others:
            continue
        th = theta_for(car)
        best = None
        for k in range(4):
            a = th + k * math.pi / 2
            d = Vector((math.cos(a), math.sin(a), 0))
            loc, nrm, idx, dist = bvh.ray_cast(V(car) + Vector((0, 0, 1.2)), d, 30)
            dist = 30 if loc is None else dist
            if best is None or dist > best[0]:
                best = (dist, d)
        d = best[1]
        out = next((t for t in (x * 0.1 for x in range(5, 40)) if wall_dist(V(car) + d * t)[0] >= CLEAR and has_floor(V(car) + d * t)), None)
        if out is None:
            log["failed"][car] = "扉の外に立てる所がない"
            continue
        reach = out
        while reach < out + 1.5 and wall_dist(V(car) + d * (reach + 0.1))[0] >= CLEAR and has_floor(V(car) + d * (reach + 0.1)):
            reach += 0.1
        add_node(fid, car, V(car) + d * reach, N[car]["name"].replace(" かごの中", "") + " エレベーターの前",
                 "reroute_walls.py：扉からまっすぐ出たホールの中")
        for e in others:
            drop_edge(e["id"])
            add_edge(fid, e["to"] if e["from"] == car else e["from"], e["kind"])
        add_edge(car, fid, "indoor")
        log["fronts"].append(car)

    # ---------- 1b. 壁のそばの点を、まわり 1.5m の中で壁から離れた所へ少し動かす ----------
    #   道を探すとき両端は動かさないので、端が壁のそばだと線が壁に寄ったまま残る。エレベーター・エスカレーター・階段の
    #   乗り降りの点（動かすと縦の線が斜めになる）と、エレベーターの前の点は動かさない
    fixed = set()
    for e in src["edges"]:
        if e["kind"] not in FLAT:
            fixed |= {e["from"], e["to"]}
    log["nudged"] = []
    for n in list(src["nodes"]):
        i = n["id"]
        if i in fixed or i.endswith("-door"):
            continue
        p0 = V(i)
        d0, _ = wall_dist(p0)
        if d0 >= KEEP + 0.05:
            continue
        best = (min(d0, 0.8), p0)
        th = theta_for(i)
        ux, uy = Vector((math.cos(th), math.sin(th), 0)), Vector((-math.sin(th), math.cos(th), 0))
        for a in range(-12, 13):
            for b in range(-12, 13):
                if a * a + b * b > 144:
                    continue
                p = p0 + ux * (a * RES) + uy * (b * RES)
                d, _ = wall_dist(p)
                score = min(d, 0.8) - 0.15 * (p - p0).length
                if score > best[0] - 0.15 * (best[1] - p0).length + 1e-6 and d >= KEEP and has_floor(p):
                    best = (min(d, 0.8), p)
        if best[1] is not p0:
            n["blender"] = [round(best[1].x + OX, 2), round(best[1].y + OY, 2), n["blender"][2]]
            log["nudged"].append(i)

    # ---------- 2. 線を引き直す ----------
    for e in list(src["edges"]):
        if e["kind"] not in FLAT:
            continue
        a, b = e["from"], e["to"]
        if abs(V(a).z - V(b).z) > 0.2:
            continue
        must = e["kind"] == "bridge" or indoor_of(a) or indoor_of(b)
        clear, _ = line_clearance(V(a), V(b))
        if clear >= KEEP or (not must and clear >= CLEAR):
            log["kept"] += 1
            continue
        pts = route(a, b)
        if pts is None:
            log["failed"][e["id"]] = f"道が見つからない（今の線は壁まで {clear:.2f}m）"
            continue
        drop_edge(e["id"])
        prev_id = a
        for k, p in enumerate(pts[1:-1], 1):
            nid = f"{e['id']}~{k}"
            add_node(nid, a, p, f"{N[a]['name']} → {N[b]['name']} {k}", "reroute_walls.py：壁をよけて廊下の真ん中を通る")
            add_edge(prev_id, nid, e["kind"])
            prev_id = nid
        add_edge(prev_id, b, e["kind"])
        log["routed"][e["id"]] = len(pts) - 2
    json.dump(src, open(SRC, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# ---------- 3. 点検 ----------
remaining = {}
for e in src["edges"]:
    if e["kind"] in FLAT and abs(V(e["from"]).z - V(e["to"]).z) <= 0.2:
        c, w = line_clearance(V(e["from"]), V(e["to"]))
        if c < CLEAR:
            remaining[e["id"]] = (round(c, 2), w)
print("REROUTE fronts", len(log["fronts"]), "nudged", len(log.get("nudged", [])), "kept", log["kept"], "routed", len(log["routed"]),
      "failed", len(log["failed"]), "remaining", len(remaining))
for k, v in log["failed"].items():
    print("FAILED", k, v)
for k, v in remaining.items():
    print("REMAIN", k, v)
