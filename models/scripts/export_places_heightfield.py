# 棟の高さ場（真上からのレイキャストで、1m 格子ごとの最大の高さ）を models/trace/places_heightfield.json に足す
#   blender -b models/buildings/<棟>.blend --python models/scripts/export_places_heightfield.py -- <棟の名前> <出力.json>
#   例：blender -b models/buildings/研究棟.blend --python models/scripts/export_places_heightfield.py -- 研究棟 models/trace/places_heightfield.json
# 座標は棟のファイルの座標（= 配置.json の「局所座標」）。models/trace/export_places.py がここから階ごとの輪郭を作る
import bpy, json, os, sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

name, out = sys.argv[sys.argv.index("--") + 1:][:2]
# 棟の見た目のコレクションだけ（敷地・航空写真・周辺・参考の箱・旧ブロックアウトは入れない）
PREFIX = {"研究棟": "02_研究棟", "教室棟": "03_教室棟", "交流棟": "04_交流棟", "本部棟": "05_本部棟"}[name]
CELL = 1.0
TOP = 300.0

dg = bpy.context.evaluated_depsgraph_get()
trees, lo, hi = [], [1e9, 1e9], [-1e9, -1e9]
for col in bpy.data.collections:
    if not col.name.startswith(PREFIX):
        continue
    for o in col.all_objects:
        if o.type != 'MESH' or len(o.data.vertices) == 0:
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.transform(o.matrix_world)
        verts = [v.co.copy() for v in me.vertices]
        polys = [tuple(p.vertices) for p in me.polygons]
        ev.to_mesh_clear()
        if not polys:
            continue
        trees.append(BVHTree.FromPolygons(verts, polys))
        for v in verts:
            lo[0], lo[1] = min(lo[0], v.x), min(lo[1], v.y)
            hi[0], hi[1] = max(hi[0], v.x), max(hi[1], v.y)

import math
x0, y0 = math.floor(lo[0]) - 1, math.floor(lo[1]) - 1
nx, ny = math.ceil(hi[0]) + 1 - x0, math.ceil(hi[1]) + 1 - y0
h = []
down = Vector((0, 0, -1))
for j in range(ny):
    for i in range(nx):
        o = Vector((x0 + (i + 0.5) * CELL, y0 + (j + 0.5) * CELL, TOP))
        best = -1.0
        for t in trees:
            hit = t.ray_cast(o, down)
            if hit[0] is not None:
                best = max(best, hit[0].z)
        h.append(round(best, 1))
data = json.load(open(out, encoding="utf-8")) if os.path.exists(out) else {}
data[name] = {"x0": x0, "y0": y0, "nx": nx, "ny": ny, "cell": CELL, "h": h}
json.dump(data, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("heightfield", name, nx, ny, len(trees), "objects", max(h))
