# Web（three.js）の展示画面用に、キャンパス全体（敷地＋4 棟の外観と内装）を GLB 1 つに書き出す
#   blender -b --factory-startup --python scripts/export_web.py
# 出力：export/campus_web.glb（Draco 圧縮）と export/campus_web.json（原点）
#   どのオブジェクトにもカスタムプロパティ trace_layer（exterior / interior / site / surroundings）をつける。
#   glTF の extras になり、three.js の userData.trace_layer で、地図とドローンの見え方を分ける
#   原点 = export_all.py の CAMPUS_ORIGIN（4 棟の真ん中あたりの地面）。Y が上、1 = 1m
#   Blender の座標 (x, y, z) → three.js の座標 (x - ox, z, -(y - oy))
import bpy, os, json, sys
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "export")
P = json.load(open(os.path.join(ROOT, "buildings", "配置.json"), encoding="utf-8"))
NAMES = ["研究棟", "教室棟", "交流棟", "本部棟"]
CAMPUS_ORIGIN = Vector((sum(P[b]["center"][0] for b in NAMES) / 4, sum(P[b]["center"][1] for b in NAMES) / 4, 0.0))
SKIP_SITE = ("航空写真",)        # 地面と重なる航空写真（Esri は再配布できない）は入れない

bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT, "キャンパス全体.blend"))
vl = bpy.context.view_layer
# インスタンス（リンクした建物）を実体にする
insts = [o for o in bpy.context.scene.objects if o.instance_type == 'COLLECTION' and o.instance_collection]
made = []
LAYER = {}                        # オブジェクト → trace_layer
for inst in insts:
    for o in vl.objects:
        o.select_set(False)
    inst.select_set(True)
    vl.objects.active = inst
    before = set(bpy.context.scene.objects)
    bpy.ops.object.duplicates_make_real(use_base_parent=False, use_hierarchy=True)
    new = [o for o in bpy.context.scene.objects if o not in before]
    made += new
    # 10_建物 のインスタンス（<建物>_外観）は外観、20_内装 のインスタンスは内装。
    # 教室棟は外観がまだなく、03_教室棟_内装（仮の外壁つき）を外観として並べているので外観扱い
    for o in new:
        LAYER[o] = "interior" if inst.name.endswith("_内装") else "exterior"
# 文字（校名など）はメッシュにする
dg = bpy.context.evaluated_depsgraph_get()
objs = []
for o in made + list(bpy.data.collections["00_Site"].all_objects):
    if any(s in o.name for s in SKIP_SITE) or any(c.name in SKIP_SITE for c in o.users_collection):
        continue
    layer = LAYER.get(o) or ("surroundings" if any(c.name == "周辺建物_OSM" for c in o.users_collection) else "site")
    o["trace_layer"] = layer
    if o.type == 'FONT':
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        n = bpy.data.objects.new(o.name, me)
        n.matrix_world = o.matrix_world
        bpy.context.scene.collection.objects.link(n)
        n["trace_layer"] = layer
        objs.append(n)
    elif o.type == 'MESH':
        objs.append(o)
# 原点を合わせる（親のないものだけ動かす）
shift = Matrix.Translation(-CAMPUS_ORIGIN)
for o in [o for o in objs if o.parent is None or o.parent not in objs]:
    o.matrix_world = shift @ o.matrix_world
for o in vl.objects:
    o.select_set(False)
for o in objs:
    o.hide_set(False)
    o.hide_viewport = False
    o.select_set(True)
vl.objects.active = objs[0]
glb = os.path.join(OUT, "campus_web.glb")
bpy.ops.export_scene.gltf(
    filepath=glb, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
    export_texcoords=False, export_normals=True, export_cameras=False, export_lights=False, export_extras=True,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
nv = sum(len(o.data.vertices) for o in objs)
count = {}
for o in objs:
    count[o["trace_layer"]] = count.get(o["trace_layer"], 0) + 1
json.dump({"campus_origin_map_xy": list(CAMPUS_ORIGIN)[:2], "objects": len(objs), "verts": nv, "layers": count,
           "axes": "three = (x - ox, z, -(y - oy))"},
          open(os.path.join(OUT, "campus_web.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("WEB_GLB", glb, len(objs), "objects", nv, "verts", os.path.getsize(glb) // 1024, "KB")
