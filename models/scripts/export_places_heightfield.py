# 棟の「縦の断面」（1m 格子ごとに、真上から真下まで順に当たった面の高さの列）を models/trace/places_heightfield.json に足す
#   blender -b models/buildings/<棟>.blend --python models/scripts/export_places_heightfield.py -- <棟の名前> <出力.json>
#   例：blender -b models/buildings/研究棟.blend --python models/scripts/export_places_heightfield.py -- 研究棟 models/trace/places_heightfield.json
# 座標は配置.json の「局所座標」（棟のファイルの座標。本部棟だけはファイルの原点のずれを引く）。高さは地面 = 0 にそろえる（本部棟のファイルは地面が -1m）。
# models/trace/export_places.py が、ここから階ごとの輪郭を作る（ピロティやゲートの吹き抜けは、上下の面が離れているので空く）
import bpy, json, math, os, sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

name, out = sys.argv[sys.argv.index("--") + 1:][:2]
# 棟の見た目のコレクションだけ（敷地・航空写真・周辺・参考の箱・旧ブロックアウトは入れない）
PREFIX = {"研究棟": "02_研究棟", "教室棟": "03_教室棟", "交流棟": "04_交流棟", "本部棟": "05_本部棟"}[name]
Z_OFFSET = {"本部棟": 1.0}.get(name, 0.0)       # 本部棟のファイルは地面が G = -1m
# 本部棟のファイルは建物の中心（配置.json の center）が (26.45, -8.4) にある（コレクションのインスタンスオフセット）。
#   局所座標にするには引く（前は引いておらず、地図の本部棟の輪郭が約 28m ずれていた。2026-10-29、TRACE_F #76）
XY_OFFSET = {"本部棟": (26.45, -8.4)}.get(name, (0.0, 0.0))
CELL = 1.0
TOP = 300.0
MAX_HITS = 160

dg = bpy.context.evaluated_depsgraph_get()
verts, polys, lo, hi = [], [], [1e9, 1e9], [-1e9, -1e9]
for col in bpy.data.collections:
    if not col.name.startswith(PREFIX):
        continue
    for o in col.all_objects:
        if o.type != 'MESH' or len(o.data.vertices) == 0:
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.transform(o.matrix_world)
        base = len(verts)
        verts += [v.co.copy() for v in me.vertices]
        polys += [tuple(base + i for i in p.vertices) for p in me.polygons]
        ev.to_mesh_clear()
for v in verts:
    lo[0], lo[1] = min(lo[0], v.x), min(lo[1], v.y)
    hi[0], hi[1] = max(hi[0], v.x), max(hi[1], v.y)
tree = BVHTree.FromPolygons(verts, polys)        # 棟全体を 1 本の木に（速い）

x0, y0 = math.floor(lo[0]) - 1, math.floor(lo[1]) - 1
nx, ny = math.ceil(hi[0]) + 1 - x0, math.ceil(hi[1]) + 1 - y0
down = Vector((0, 0, -1))
hits = []
for j in range(ny):
    for i in range(nx):
        x, y = x0 + (i + 0.5) * CELL, y0 + (j + 0.5) * CELL
        z, col = TOP, []
        while len(col) < MAX_HITS:
            hit = tree.ray_cast(Vector((x, y, z)), down)
            if hit[0] is None:
                break
            hz = hit[0].z
            if not col or abs(col[-1] - (hz + Z_OFFSET)) > 0.05:
                col.append(round(hz + Z_OFFSET, 2))
            z = hz - 0.02
        hits.append(col)
data = json.load(open(out, encoding="utf-8")) if os.path.exists(out) else {}
data[name] = {"x0": x0 - XY_OFFSET[0], "y0": y0 - XY_OFFSET[1], "nx": nx, "ny": ny, "cell": CELL, "hits": hits}
json.dump(data, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("heightfield", name, nx, ny, len(polys), "faces", max((c[0] for c in hits if c), default=0))
