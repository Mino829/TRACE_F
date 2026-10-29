# 展示の一人称のカメラが壁に入らないかを点検する（2026-10-29、TRACE_F #76）
#   blender -b --factory-startup --python trace/check_walk_camera.py [-- <地点の id> ...]
# 参加者が選べる点（selectable）すべてから ShibaLab まで、TRACE_B と同じく距離で一番短い道を出し、
# 展示画面（TRACE_F src/lib/display/player.ts）の一人称と同じ計算でカメラの位置を出す：
#   体の位置 = 線の前後 2m を 7 点で平均した点（roundedPointAt、角が丸くなる）、目の高さ 1.6m。
#   エレベーターの近くでは丸めを小さくする：かごの 2.5m 手前から丸めなし、4.5m 手前で元の 2m（player.ts の walkRound）
# その目の高さで、水平に壁から 0.3m 以内に入る所と、道の線そのものが壁に当たる所を表示する。
# エスカレーターの乗り降りの点につながる線（乗り口）は、手すりのそばを通るのが当たり前なので分けて数える。
#   地点の id を渡すと、その地点からの道だけを点検し、道の点も表示する
import os, sys, json, heapq, math
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
_code = open(os.path.join(HERE, "reroute_walls.py"), encoding="utf-8").read()
sys.argv = [a for a in sys.argv if a != "--check"] + ["--check"]
__file__ = os.path.join(HERE, "reroute_walls.py")
exec(compile(_code[:_code.index("log = {")], __file__, "exec"))

ONLY = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ONLY = [a for a in ONLY if a != "--check"]
ROUND, EYE, NEAR, STEP = 2.0, 1.6, 0.3, 0.25

adj = {}
for e in src["edges"]:
    L = (V(e["from"]) - V(e["to"])).length
    adj.setdefault(e["from"], []).append((e["to"], L, e["kind"]))
    adj.setdefault(e["to"], []).append((e["from"], L, e["kind"]))


def shortest(a, b):
    d, pv, q = {a: 0.0}, {}, [(0.0, a)]
    while q:
        du, u = heapq.heappop(q)
        if u == b:
            break
        if du > d[u]:
            continue
        for v, L, k in adj.get(u, []):
            if du + L < d.get(v, 1e18):
                d[v] = du + L
                pv[v] = (u, k)
                heapq.heappush(q, (d[v], v))
    if b not in d:
        return None
    ids, kinds = [b], []
    while ids[-1] != a:
        u, k = pv[ids[-1]]
        kinds.append(k)
        ids.append(u)
    return ids[::-1], kinds[::-1]


def walk_points(ids):
    pts = [V(i) for i in ids]
    at = [0.0]
    for p, q in zip(pts, pts[1:]):
        at.append(at[-1] + (q - p).length)
    return pts, at


def point_at(pts, at, s):
    if s <= 0:
        return pts[0].copy()
    if s >= at[-1]:
        return pts[-1].copy()
    lo, hi = 0, len(at) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if at[mid] <= s:
            lo = mid
        else:
            hi = mid
    f = (s - at[lo]) / ((at[hi] - at[lo]) or 1)
    return pts[lo].lerp(pts[hi], f)


def rounded(pts, at, s, lifts=()):
    """展示（player.ts の walkRound）と同じく、エレベーターに近い所では丸めを小さくする（かごの 2.5m 手前から丸めなし）"""
    near = min((a - s if s < a else s - b if s > b else 0.0) for a, b in lifts) if lifts else float("inf")
    r = min(ROUND, max(0.2, near - 2.5))
    acc = Vector((0, 0, 0))
    for i in range(7):
        acc += point_at(pts, at, s - r + 2 * r * i / 6)
    return acc / 7


def eye_dist(p):
    best, what = NEAR + 1, None
    q = p + Vector((0, 0, EYE))
    for d in DIRS8:
        loc, nrm, idx, dist = bvh.ray_cast(q, d, best)
        if loc is not None and dist < best:
            best, what = dist, (objs[idx], mats[idx])
    return best, what


starts = ONLY or [n["id"] for n in src["nodes"] if n.get("selectable") and n["id"] != "shibalab"]
bad_routes = 0
seen = {}
boarding = set()
for sid in starts:
    r = shortest(sid, "shibalab")
    if r is None:
        print("ROUTE", sid, "NO PATH")
        bad_routes += 1
        continue
    ids, kinds = r
    pts, at = walk_points(ids)
    lifts = [(at[k], at[k + 1]) for k, kd in enumerate(kinds) if kd == "elevator"]
    issues = []
    # 道の線そのもの（平らな線）。エスカレーターの乗り降りの点につながる線で、近いのがエスカレーターの手すり・側面なら
    #   「乗り口」として分ける（乗る直前・降りた直後に手すりのそばを通るのは、実際に乗るときと同じ）
    esc_ends = {x for e in src["edges"] if e["kind"] == "escalator" for x in (e["from"], e["to"])}
    for a, b, k in zip(ids, ids[1:], kinds):
        if k in FLAT and abs(V(a).z - V(b).z) <= 0.2:
            c, w = line_clearance(V(a), V(b))
            if c < CLEAR:
                if (a in esc_ends or b in esc_ends) and w and "エスカレーター" in w[1]:
                    boarding.add((a, b))
                    continue
                issues.append(f"線 {a}->{b} 壁まで {c:.2f}m {w}")
    # 一人称のカメラ（エレベーター・エスカレーター・階段に乗っている所は除く）
    s = 0.0
    while s <= at[-1]:
        i = max(0, min(len(kinds) - 1, next((k for k in range(len(at) - 1) if at[k] <= s < at[k + 1]), len(kinds) - 1)))
        if kinds[i] in FLAT and abs(pts[i].z - pts[i + 1].z) <= 0.2 and not ({ids[i], ids[i + 1]} & esc_ends):
            body = rounded(pts, at, s, lifts)
            body.z = pts[i].z
            d, w = eye_dist(body)
            if d < NEAR:
                key = (ids[i], ids[i + 1])
                if key not in seen:
                    seen[key] = (round(d, 2), w)
                issues.append(f"カメラ {ids[i]}->{ids[i + 1]} s={s:.1f} 壁まで {d:.2f}m {w}")
        s += STEP
    name = N[sid]["name"]
    if issues:
        bad_routes += 1
        # 同じ区間の重複はまとめる
        uniq = []
        for t in issues:
            k = t.split(" s=")[0].split(" 壁まで")[0]
            if k not in [u.split(" s=")[0].split(" 壁まで")[0] for u in uniq]:
                uniq.append(t)
        print("ROUTE", sid, name, f"{at[-1]:.0f}m", "NG", len(uniq))
        for t in uniq:
            print("   ", t)
    else:
        print("ROUTE", sid, name, f"{at[-1]:.0f}m", "OK")
    if ONLY:
        print("   PATH", " ".join(ids))
print("SUMMARY routes", len(starts), "ng", bad_routes, "camera_segments", len(seen), "escalator_boarding_lines", len(boarding))
