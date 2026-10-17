# チェックポイントの配置図（真上から）をレンダーして、点の名前を書き込む
#   キャンパス全体.blend で trace_graph.build() のあとに Blender の中で exec する
#   → trace/campus_graph_plan.png
import bpy, json, math, os
from mathutils import Vector, Euler
from bpy_extras.object_utils import world_to_camera_view

# キャンパス全体.blend と同じフォルダ（make_campus_all.py のように保存前に exec するときは TRACE_ROOT を先に入れておく）
ROOT = globals().get("TRACE_ROOT") or os.path.dirname(bpy.data.filepath)
PNG = os.path.join(ROOT, "trace", "campus_graph_plan.png")
P = json.load(open(os.path.join(ROOT, "buildings", "配置.json"), encoding="utf-8"))
sc = bpy.context.scene
cps = [o for o in bpy.data.collections["30_TRACE_チェックポイント"].objects if o.type == 'EMPTY']

# 点が全部入る範囲（教室棟の向きに回した座標で）
th = P["教室棟"]["theta"]
rot = lambda v: Vector((math.cos(th) * v.x + math.sin(th) * v.y, -math.sin(th) * v.x + math.cos(th) * v.y))
pts = [rot(o.location) for o in cps]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts)))
mid = (lo + hi) / 2
c = Vector((math.cos(th) * mid.x - math.sin(th) * mid.y, math.sin(th) * mid.x + math.cos(th) * mid.y, 300))

keep = dict(engine=sc.render.engine, cam=sc.camera, rx=sc.render.resolution_x, ry=sc.render.resolution_y,
            fp=sc.render.filepath, pct=sc.render.resolution_percentage)
cd = bpy.data.cameras.new("TRACE_配置図")
cd.type = 'ORTHO'
cd.ortho_scale = max(hi.x - lo.x, (hi.y - lo.y) * 16 / 9) + 50
cd.clip_end = 1000
cam = bpy.data.objects.new("TRACE_配置図", cd)
sc.collection.objects.link(cam)
cam.location = c
cam.rotation_euler = Euler((0, 0, th))
sc.camera = cam
sc.render.engine = 'BLENDER_WORKBENCH'
sh = sc.display.shading
sh.light, sh.color_type = 'STUDIO', 'MATERIAL'
sh.show_shadows = False
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1920, 1080, 100
sc.render.filepath = PNG
bpy.context.view_layer.update()
uv = {o["id"]: (o["name"], list(world_to_camera_view(sc, cam, o.matrix_world.translation))[:2]) for o in cps}
north = list(world_to_camera_view(sc, cam, c + Vector((0, 30, -300))))[:2]
center = list(world_to_camera_view(sc, cam, c + Vector((0, 0, -300))))[:2]
mpp = cd.ortho_scale / 1920
try:
    bpy.ops.render.render(write_still=True)
finally:
    sc.render.engine, sc.camera = keep["engine"], keep["cam"]
    sc.render.resolution_x, sc.render.resolution_y = keep["rx"], keep["ry"]
    sc.render.filepath, sc.render.resolution_percentage = keep["fp"], keep["pct"]
    bpy.data.objects.remove(cam)
    bpy.data.cameras.remove(cd)
json.dump({"labels": uv, "north": [north, center], "metresPerPx": mpp},
          open(os.path.join(ROOT, "trace", "campus_graph_plan.labels.json"), "w", encoding="utf-8"), ensure_ascii=False)
result = {"png": PNG, "metresPerPx": mpp}
