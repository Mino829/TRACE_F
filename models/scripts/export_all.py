# 全部の建物とキャンパス全体を、Unity / TouchDesigner 用の FBX に書き出す
#   blender -b --factory-startup --python scripts/export_all.py           （FBX だけ）
#   blender -b --factory-startup --python scripts/export_all.py -- --glb  （Web 用の GLB も。重いので普段は作らない）
# 出力：export/
#   建物ごと（原点 = 建物の足元の中心・地面）
#     <building>_exterior.fbx   外観
#     <building>_interior.fbx   内装（教室棟は外観がまだないので、内装に仮の外壁が入っている）
#   キャンパス全体（原点 = 4 棟の真ん中あたりの地面。CAMPUS_ORIGIN）
#     campus_all.fbx            敷地（地面・道路・運河・周辺の建物）＋ 4 棟の外観と内装
#     campus_exterior.fbx       敷地＋ 4 棟の外観だけ（軽い）
# 単位はメートル、Y が上（Unity・TouchDesigner でそのまま 1 = 1m）。マテリアルは色だけ
import bpy, os, json, math, sys
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "export")
os.makedirs(OUT, exist_ok=True)
P = json.load(open(os.path.join(ROOT, "buildings", "配置.json"), encoding="utf-8"))

BUILDINGS = [  # (英語名, 配置.json の名前, ファイル, 外観のコレクション, 内装のコレクション)
    ("research", "研究棟", "buildings/研究棟.blend", "02_研究棟", "02_研究棟_内装"),
    ("classroom", "教室棟", "buildings/教室棟.blend", None, "03_教室棟_内装"),
    ("exchange", "交流棟", "buildings/交流棟.blend", "04_交流棟", "04_交流棟_内装"),
    ("headquarters", "本部棟", "buildings/本部棟.blend", "05_本部棟", "05_本部棟_内装"),
]
# 4 棟の中心の平均（地図の座標）。キャンパス全体のファイルの原点
CAMPUS_ORIGIN = Vector((sum(P[b[1]]["center"][0] for b in BUILDINGS) / 4,
                        sum(P[b[1]]["center"][1] for b in BUILDINGS) / 4, 0.0))
GLB = "--glb" in sys.argv
SKIP_SITE = ("航空写真",)        # 地面と重なる航空写真（Esri は再配布できない）は入れない


def fonts_to_mesh(objs):
    """文字（FONT）をメッシュに置き換える（FBX はカーブを書き出さない）"""
    out = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type == 'FONT':
            me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
            n = bpy.data.objects.new(o.name, me)
            n.matrix_world = o.matrix_world
            for c in o.users_collection:
                c.objects.link(n)
            bpy.data.objects.remove(o)
            out.append(n)
        else:
            out.append(o)
    return out


def export(objs, name, shift):
    """objs を shift だけ動かして（原点合わせ）FBX と GLB に書き出し、元に戻す"""
    objs = [o for o in objs if o.type == 'MESH']
    tops = [o for o in objs if o.parent is None or o.parent not in objs]
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    saved = {o: o.matrix_world.copy() for o in tops}
    for o in tops:
        o.matrix_world = shift @ o.matrix_world
    for o in objs:
        o.hide_set(False)
        o.hide_viewport = False
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.fbx(
        filepath=os.path.join(OUT, name + ".fbx"), use_selection=True, object_types={'MESH'},
        use_mesh_modifiers=True, apply_scale_options='FBX_SCALE_UNITS', axis_forward='-Z', axis_up='Y',
        bake_space_transform=True, mesh_smooth_type='FACE', path_mode='STRIP')
    if GLB:
        bpy.ops.export_scene.gltf(
            filepath=os.path.join(OUT, name + ".glb"), export_format='GLB', use_selection=True,
            export_apply=True, export_yup=True, export_texcoords=False, export_cameras=False, export_lights=False)
    for o, m in saved.items():
        o.matrix_world = m
    nv = sum(len(o.data.vertices) for o in objs)
    print("EXPORT", name, len(objs), "objects", nv, "verts")
    return nv


# ---------- 建物ごと ----------
report = {}
for key, jp, rel, ext_col, int_col in BUILDINGS:
    bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT, rel))
    for cname, part in ((ext_col, "exterior"), (int_col, "interior")):
        if cname is None:
            continue
        col = bpy.data.collections[cname]
        objs = fonts_to_mesh(list(col.all_objects))
        off = Vector(bpy.data.collections[ext_col or int_col].instance_offset)
        report[f"{key}_{part}"] = export(objs, f"{key}_{part}", Matrix.Translation(-off))
    # 建物のファイルは保存しない（文字をメッシュにしたのは書き出しのためだけ）

# ---------- キャンパス全体 ----------
bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT, "キャンパス全体.blend"))
vl = bpy.context.view_layer
# インスタンス（リンクした建物）を実体にする
insts = [o for o in bpy.context.scene.objects if o.instance_type == 'COLLECTION' and o.instance_collection]
groups = {}
for inst in insts:
    for o in vl.objects:
        o.select_set(False)
    inst.select_set(True)
    vl.objects.active = inst
    before = set(bpy.context.scene.objects)
    bpy.ops.object.duplicates_make_real(use_base_parent=False, use_hierarchy=True)
    new = [o for o in bpy.context.scene.objects if o not in before]
    groups[inst.name] = fonts_to_mesh(new)
site = [o for o in bpy.data.collections["00_Site"].all_objects
        if o.type == 'MESH' and not any(s in o.name for s in SKIP_SITE)]
exts = [o for n, objs in groups.items() if n.endswith("_外観") for o in objs]
ints = [o for n, objs in groups.items() if n.endswith("_内装") for o in objs]
shift = Matrix.Translation(-CAMPUS_ORIGIN)
report["campus_exterior"] = export(site + exts, "campus_exterior", shift)
report["campus_all"] = export(site + exts + ints, "campus_all", shift)

json.dump({"campus_origin_map_xy": list(CAMPUS_ORIGIN)[:2], "verts": report},
          open(os.path.join(OUT, "export_info.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("DONE", report)
