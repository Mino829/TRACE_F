# キャンパス全体のファイル（キャンパス全体.blend）を作り直す
#   blender -b --factory-startup --python scripts/make_campus_all.py
# 敷地（site.blend）と、各建物の外観・内装のコレクションをリンクで読み込み、配置.json の位置・向きに並べる。
# 建物を直したら、建物のファイルで保存してから、このファイルを開き直す（またはライブラリをリロード）だけで反映される。
# toyosu_campus.blend（今までの親ファイル）は変えない。違い：内装も全部入っている・教室棟は内装のコレクション（仮の外壁と曲がり角）を使う
import bpy, json, math, os
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "キャンパス全体.blend")
P = json.load(open(os.path.join(ROOT, "buildings", "配置.json"), encoding="utf-8"))

# 建物：(配置.json の名前, ファイル, [(コレクション, 内装か)])
BUILDINGS = [
    ("研究棟", "buildings/研究棟.blend", [("02_研究棟", False), ("02_研究棟_内装", True)]),
    # 教室棟は外観がまだなので、内装のコレクション（仮の外壁・研究棟側の曲がり角を含む）を外観の側に入れる
    ("教室棟", "buildings/教室棟.blend", [("03_教室棟_内装", False)]),
    ("交流棟", "buildings/交流棟.blend", [("04_交流棟", False), ("04_交流棟_内装", True)]),
    ("本部棟", "buildings/本部棟.blend", [("05_本部棟", False), ("05_本部棟_内装", True)]),
]

# ---------- 空のシーンから ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = "キャンパス全体"
scene.unit_settings.system = 'METRIC'
bpy.ops.wm.save_as_mainfile(filepath=OUT)      # 先に保存して、相対パスで読み込めるようにする


def new_col(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or scene.collection).children.link(c)
    return c


def link_collections(path, names):
    with bpy.data.libraries.load(path, link=True, relative=True) as (src, dst):
        dst.collections = [n for n in names if n in src.collections]
    return {c.name: c for c in dst.collections if c is not None}


# ---------- 敷地（リンクをそのまま置く） ----------
site = link_collections(os.path.join(ROOT, "site.blend"), ["00_Site"])
scene.collection.children.link(site["00_Site"])

# ---------- 建物（インスタンスで置く） ----------
c_ext = new_col("10_建物")
c_int = new_col("20_内装")
for name, rel, cols in BUILDINGS:
    linked = link_collections(os.path.join(ROOT, rel), [c for c, _ in cols])
    theta = P[name]["theta"]
    cx, cy = P[name]["center"]
    # 外観のコレクションの原点（インスタンスオフセット）が地図の「center」に来る。内装も同じ所に来るようにずらす
    base_off = Vector(linked[cols[0][0]].instance_offset)
    for cname, is_int in cols:
        c = linked[cname]
        d = Vector(c.instance_offset) - base_off
        d.rotate(Matrix.Rotation(theta, 3, 'Z'))
        o = bpy.data.objects.new(f"{name}_{'内装' if is_int else '外観'}", None)
        o.instance_type = 'COLLECTION'
        o.instance_collection = c
        o.location = (cx + d.x, cy + d.y, d.z)
        o.rotation_euler = (0, 0, theta)
        o.empty_display_size = 5
        (c_int if is_int else c_ext).objects.link(o)

# ---------- 太陽・カメラ・空（今までの親ファイルから持ってくる） ----------
c_cam = new_col("00_カメラとライト")
OLD = os.path.join(ROOT, "toyosu_campus.blend")       # 前の親ファイル（無いときは太陽を新しく作る）
if os.path.exists(OLD):
    with bpy.data.libraries.load(OLD, link=False) as (src, dst):
        dst.objects = [n for n in ("太陽", "Cam_広場から研究棟ゲート", "Cam_通りから本部棟") if n in src.objects]
        dst.worlds = list(src.worlds)[:1]
    for o in dst.objects:
        if o is not None:
            o.parent = None
            c_cam.objects.link(o)
    if dst.worlds and dst.worlds[0] is not None:
        scene.world = dst.worlds[0]
else:
    sun = bpy.data.objects.new("太陽", bpy.data.lights.new("太陽", 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(200))
    c_cam.objects.link(sun)
# 全体を見るカメラ（南東の空から・北西の空から）
for nm, loc, tgt, lens in (("Cam_全体_南東の空から", (-30, -210, 240), (-155, -20, 0), 30),
                           ("Cam_全体_北西の空から", (-300, 150, 230), (-150, -20, 0), 30)):
    cam = bpy.data.objects.new(nm, bpy.data.cameras.new(nm))
    d = Vector(tgt) - Vector(loc)
    cam.location = loc
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
    cam.data.clip_end = 3000
    c_cam.objects.link(cam)
scene.camera = bpy.data.objects.get("Cam_全体_南東の空から")

# ---------- 表示とレンダー ----------
vl = scene.view_layers[0]
vl.name = "全体"


def find_lc(lc, name):
    if lc.collection.name == name:
        return lc
    for ch in lc.children:
        r = find_lc(ch, name)
        if r:
            return r


aer = find_lc(vl.layer_collection, "航空写真")       # 地面と重なる航空写真は外しておく（使うときはチェックを入れる）
if aer:
    aer.exclude = True
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
scene.view_settings.view_transform = 'AgX'
# 持ってくるのに使った toyosu_campus.blend への参照は残さない（持ってきた物はこのファイルの中にある）
for lib in list(bpy.data.libraries):
    if os.path.basename(lib.filepath) == "toyosu_campus.blend":
        bpy.data.libraries.remove(lib)
bpy.ops.wm.save_as_mainfile(filepath=OUT, relative_remap=True)
print("saved", OUT, [l.filepath for l in bpy.data.libraries])
