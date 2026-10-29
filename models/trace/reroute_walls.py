# 道の網の線が壁を抜けないように直す（2026-10-29、TRACE_F #76）
#   blender -b --factory-startup --python trace/reroute_walls.py            … 直して campus_graph.src.json に書き戻す
#   blender -b --factory-startup --python trace/reroute_walls.py -- --check … 点検だけ（書き戻さない）
#   blender -b --factory-startup --python trace/reroute_walls.py -- --fine  … 壁から 0.2m・0.125m のマス目で探す
#     （幅 0.9〜1.2m の扉は、0.3m・0.25m だとマス目が扉の真ん中に乗らず通れないことがある。最初の実行で残った線に使う）
# 展示画面と同じ export/campus_web.glb を読み、床から 0.5m・1.0m・1.6m の高さで線に沿って光線を当てる。
# 扉（マテリアル名に「扉」「入口ガラス」）は通れるものとして扱う。
#   1. エレベーター：かごの点から 4 方向に光線を当てて扉の向きを探し、扉を出た所に「エレベーターの前」の点を置く。
#      かごと階をつなぐ線はすべてこの点を通す（前は扉と逆の壁を抜けていた）
#   2. 平らな線（ground / indoor / bridge）で壁に当たるもの：建物の碁盤の目に沿った 0.25m のマス目で、
#      壁から 0.3m 以上離れて、足元に床がある所だけを通る道を探し（曲がる回数を少なく）、角に点を置いた線に置きかえる
#   3. 最後に全部の線をもう一度点検して、残ったものを表示する
import bpy, json, math, os, sys, heapq
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "trace", "campus_graph.src.json")
GLB = os.path.join(ROOT, "export", "campus_web.glb")
P = json.load(open(os.path.join(ROOT, "buildings", "配置.json"), encoding="utf-8"))
OX, OY = json.load(open(os.path.join(ROOT, "export", "campus_web.json"), encoding="utf-8"))["campus_origin_map_xy"]
CHECK = "--check" in sys.argv
PASS = ("扉", "入口ガラス")
CLEAR, RES, TURN, PAD = (0.2, 0.125, 4.0, 15.0) if "--fine" in sys.argv else (0.3, 0.25, 4.0, 15.0)
FLAT = ("indoor", "ground", "bridge")

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
passable = [any(s in m for s in PASS) for m in mats]

src = json.load(open(SRC, encoding="utf-8"))
N = {n["id"]: n for n in src["nodes"]}


def V(i):
    x, y, z = N[i]["blender"]
    return Vector((x - OX, y - OY, z))


def theta_for(i):
    b = N[i].get("building")
    return P[b]["theta"] if b in P else P["教室棟"]["theta"]


def why(p, need_floor=True):
    """p（床の高さ）に人が立てないなら理由、立てるなら None"""
    for h in (0.9, 1.5):
        q = p + Vector((0, 0, h))
        loc, nrm, idx, d = bvh.find_nearest(q, CLEAR)
        if loc is None:
            continue
        if not passable[idx]:
            return (objs[idx], mats[idx])
        for a in range(8):
            dv = Vector((math.cos(a * math.pi / 4), math.sin(a * math.pi / 4), 0))
            l2, n2, i2, d2 = bvh.ray_cast(q, dv, CLEAR)
            if l2 is not None and not passable[i2]:
                return (objs[i2], mats[i2])
    if not need_floor:
        return None
    for off in ((0, 0), (0.3, 0), (-0.3, 0), (0, 0.3), (0, -0.3)):      # 床の継ぎ目の細いすき間は床とみなす
        loc, nrm, idx, d = bvh.ray_cast(p + Vector((off[0], off[1], 0.4)), Vector((0, 0, -1)), 0.7)
        if loc is not None:
            return None
    return ("nofloor", "")


def first_wall(a, b):
    """a→b の線が扉以外に当たる最初の所（高さ, 距離, オブジェクト, マテリアル）。当たらなければ None"""
    for h in (0.5, 1.0, 1.6):
        o = a + Vector((0, 0, h))
        d = (b + Vector((0, 0, h))) - o
        L = d.length
        if L < 1e-3:
            continue
        d.normalize()
        t = 0.0
        while True:
            loc, nrm, idx, dist = bvh.ray_cast(o + d * t, d, L - t)
            if loc is None:
                break
            t += dist
            if not passable[idx]:
                return (h, round(t, 2), objs[idx], mats[idx])
            t += 0.01
    return None


def route(a, b):
    """a→b（同じ高さ）の、壁をよける角ばった道の角の点（両端を含む）。見つからなければ None"""
    pa, pb = V(a), V(b)
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

    def free(c):
        if c in (start, goal):
            return True
        if c not in cache:
            near = min(abs(c[0]) + abs(c[1]), abs(c[0] - goal[0]) + abs(c[1] - goal[1])) * RES < 1.5
            cache[c] = why(to_w(c[0] * RES, c[1] * RES), not near) is None     # かごの中など、両端のそばは床を問わない
        return cache[c]
    dirs = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    h0 = lambda c: abs(c[0] - goal[0]) + abs(c[1] - goal[1])
    q = [(h0(start), 0.0, start, -1)]
    best, prev, found, it = {(start, -1): 0.0}, {}, None, 0
    while q and it < 400000:
        f, gc, c, k0 = heapq.heappop(q)
        it += 1
        if c == goal:
            found = (c, k0)
            break
        if gc > best.get((c, k0), 1e18):
            continue
        for k, (dx, dy) in enumerate(dirs):
            n = (c[0] + dx, c[1] + dy)
            if not (lo[0] <= n[0] <= hi[0] and lo[1] <= n[1] <= hi[1]) or not free(n):
                continue
            ng = gc + 1 + (TURN / RES if k0 not in (-1, k) else 0)
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
    if len(pts) > 2:                      # 両端はマス目に乗っていないので、最初と最後の区間が碁盤の目に沿うようにそろえる
        u1, v1 = (pts[1] - pa).dot(ux), (pts[1] - pa).dot(uy)
        pts[1] = to_w(0, v1) if corners[1][0] == corners[0][0] else to_w(u1, 0)
        un, vn = (pts[-2] - pa).dot(ux), (pts[-2] - pa).dot(uy)
        pts[-2] = to_w(ub, vn) if corners[-1][0] == corners[-2][0] else to_w(un, vb)
    return pts


def add_node(nid, like, w, name):
    n = {"id": nid, "name": name, "building": N[like]["building"], "floor": N[like]["floor"],
         "blender": [round(w.x + OX, 2), round(w.y + OY, 2), N[like]["blender"][2]],
         "radius": 3, "gpsSnap": False, "role": "waypoint", "note": "reroute_walls.py が置いた点（壁をよける）"}
    src["nodes"].append(n)
    N[nid] = n


def add_edge(a, b, kind):
    src["edges"].append({"id": f"{a}--{b}", "from": a, "to": b, "kind": kind})


def drop_edge(eid):
    src["edges"] = [e for e in src["edges"] if e["id"] != eid]


def bad(e):
    return e["kind"] in FLAT and first_wall(V(e["from"]), V(e["to"])) is not None


log = {"fronts": [], "routed": {}, "failed": {}}
if not CHECK:
    # ---------- 1. エレベーターの扉の前 ----------
    cars = {}
    for e in src["edges"]:
        if e["kind"] == "elevator":
            cars.setdefault(e["from"], 0)
            cars.setdefault(e["to"], 0)
    for car in sorted(cars):
        fid = car + "-door"
        others = [e for e in src["edges"] if car in (e["from"], e["to"]) and e["kind"] != "elevator"]
        if fid in N or not others:
            continue
        th = theta_for(car)
        best = None
        for k in range(4):                              # 扉の向き = 扉以外の壁まで一番遠い向き
            a = th + k * math.pi / 2
            d = Vector((math.cos(a), math.sin(a), 0))
            o, tot = V(car) + Vector((0, 0, 1.2)), 0.0
            while tot < 30:
                loc, nrm, idx, dist = bvh.ray_cast(o, d, 30 - tot)
                if loc is None:
                    tot = 30
                    break
                tot += dist
                if not passable[idx]:
                    break
                o, tot = loc + d * 0.01, tot + 0.01
            if best is None or tot > best[0]:
                best = (tot, d)
        d = best[1]
        reach = next((t + 0.6 for t in (x * 0.1 for x in range(8, 40))
                      if why(V(car) + d * t) is None and why(V(car) + d * (t + 0.6)) is None), None)
        if reach is None:
            log["failed"][car] = "扉の前が見つからない"
            continue
        add_node(fid, car, V(car) + d * reach, N[car]["name"].replace(" かごの中", "") + " エレベーターの前")
        for e in others:
            drop_edge(e["id"])
            add_edge(fid, e["to"] if e["from"] == car else e["from"], e["kind"])
        add_edge(car, fid, "indoor")
        log["fronts"].append(car)

    # ---------- 2. 壁に当たる平らな線を、壁をよける線に置きかえる ----------
    for e in list(src["edges"]):
        if not bad(e):
            continue
        a, b = e["from"], e["to"]
        if abs(V(a).z - V(b).z) > 0.2:
            log["failed"][e["id"]] = "高さが違う"
            continue
        pts = route(a, b)
        if pts is None or any(first_wall(p, q) for p, q in zip(pts, pts[1:])):
            log["failed"][e["id"]] = "道が見つからない"
            continue
        drop_edge(e["id"])
        prev_id = a
        for k, p in enumerate(pts[1:-1], 1):
            nid = f"{e['id']}~{k}"
            add_node(nid, a, p, f"{N[a]['name']} → {N[b]['name']} {k}")
            add_edge(prev_id, nid, e["kind"])
            prev_id = nid
        add_edge(prev_id, b, e["kind"])
        log["routed"][e["id"]] = len(pts) - 2
    json.dump(src, open(SRC, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# ---------- 3. 点検 ----------
remaining = {}
for e in src["edges"]:
    if e["kind"] in FLAT:
        hit = first_wall(V(e["from"]), V(e["to"]))
        if hit:
            remaining[e["id"]] = hit
print("REROUTE fronts", len(log["fronts"]), "routed", len(log["routed"]), "failed", len(log["failed"]), "remaining", len(remaining))
for k, v in log["failed"].items():
    print("FAILED", k, v)
for k, v in remaining.items():
    print("REMAIN", k, v)
