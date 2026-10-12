# キャンパス全体.blend から、紹介用の画像（全体像・外観・渡り廊下・内装）をまとめてレンダーする
#   blender -b キャンパス全体.blend --python scripts/render_showcase.py -- <出力フォルダ> [名前,名前,...]
# ファイルは保存しない（足した光とカメラは消えるだけ）
import bpy, sys, os, json, math
from mathutils import Vector, Euler

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "renders/showcase")
ONLY = set(argv[1].split(",")) if len(argv) > 1 else None
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.dirname(bpy.data.filepath)
P = json.load(open(os.path.join(ROOT, "buildings", "配置.json"), encoding="utf-8"))
OFF = {"本部棟": (26.45, -8.4, -1.0)}       # 本部棟のファイルの原点のずれ（コレクションのインスタンスオフセット）


def W(b, x, y, z):
    """建物の座標 → 地図の座標"""
    t = P[b]["theta"]
    c = P[b]["center"]
    o = OFF.get(b, (0, 0, 0))
    x, y, z = x - o[0], y - o[1], z - o[2]
    return Vector((math.cos(t) * x - math.sin(t) * y + c[0], math.sin(t) * x + math.cos(t) * y + c[1], z))


sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Medium High Contrast' if 'AgX - Medium High Contrast' in \
    [i.identifier for i in sc.view_settings.bl_rna.properties['look'].enum_items] else 'None'
# 空（上が青く、地平線が明るい）
w = bpy.data.worlds.new("showcase_sky")
sc.world = w
w.use_nodes = True
nt = w.node_tree
bg = next((n for n in nt.nodes if n.type == 'BACKGROUND'), None) or nt.nodes.new("ShaderNodeBackground")
wo = next((n for n in nt.nodes if n.type == 'OUTPUT_WORLD'), None) or nt.nodes.new("ShaderNodeOutputWorld")
nt.links.new(bg.outputs[0], wo.inputs[0])
sky = nt.nodes.new("ShaderNodeTexSky")
try:
    sky.sky_type = 'NISHITA'
    sky.sun_elevation = math.radians(38)
    sky.sun_rotation = math.radians(200)
    bg.inputs[1].default_value = 0.35
    nt.links.new(sky.outputs[0], bg.inputs[0])
except Exception:
    bg.inputs[0].default_value = (0.55, 0.68, 0.85, 1)
sun = bpy.data.objects.get("太陽")
if sun is None:
    sun = bpy.data.objects.new("showcase_sun", bpy.data.lights.new("showcase_sun", 'SUN'))
    sc.collection.objects.link(sun)
sun.data.energy = 4.0
sun.data.angle = math.radians(1.5)
sun.rotation_euler = Euler((math.radians(52), 0, math.radians(200)))
cam = bpy.data.objects.new("showcase_cam", bpy.data.cameras.new("showcase_cam"))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.clip_start = 0.05
cam.data.clip_end = 4000
surround = bpy.data.collections.get("周辺建物_OSM")
inner = bpy.data.collections.get("20_内装")
temp_lights = []


def lights(points, energy=250, size=1.5):
    for p in points:
        L = bpy.data.objects.new("showcase_pl", bpy.data.lights.new("showcase_pl", 'POINT'))
        L.data.energy = energy
        L.data.shadow_soft_size = size
        L.location = p
        sc.collection.objects.link(L)
        temp_lights.append(L)


def clear_lights():
    for L in temp_lights:
        bpy.data.objects.remove(L)
    temp_lights.clear()


def shot(name, loc, target, lens=24, surroundings=True, interior=False, ortho=None):
    if ONLY and name not in ONLY:
        return
    if surround:
        surround.hide_render = not surroundings
    if inner:
        inner.hide_render = not interior
    cam.data.type = 'ORTHO' if ortho else 'PERSP'
    if ortho:
        cam.data.ortho_scale = ortho
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
    sc.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("render", name)


C = Vector((-160.3, -15.0, 0))   # 4 棟の真ん中
# ---------- 全体像 ----------
shot("01_全体_南東の空から", C + Vector((150, -200, 170)), C + Vector((0, 5, 10)), 32, surroundings=False)
shot("02_全体_北西の空から", C + Vector((-190, 170, 160)), C + Vector((5, -5, 10)), 32, surroundings=False)
# 配置図：真上から。教室棟が横になる向きに回す。建物の名前を書き込む位置を labels.json に書き出す
if not ONLY or "03_配置図_真上から" in ONLY:
    from bpy_extras.object_utils import world_to_camera_view
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 230
    cam.location = C + Vector((0, 0, 400))
    cam.rotation_euler = Euler((0, 0, P["教室棟"]["theta"]))
    bpy.context.view_layer.update()
    marks = {"研究棟 Research": W("研究棟", 0, 0, 0), "教室棟 Classroom": W("教室棟", 0, 0, 0),
             "交流棟 Exchange": W("交流棟", 0, 0, 0), "本部棟 Headquarters": W("本部棟", 30, -2, 0),
             "大階段・SIT": W("研究棟", -7.6, -45, 0), "渡り廊下 2F/4F/6F": W("交流棟", 40, 9, 0),
             "渡り廊下 4F/6F": W("本部棟", 50, 36, 0), "交流プラザ": Vector((-116, -35, 0))}
    lab = {k: list(world_to_camera_view(sc, cam, v))[:2] for k, v in marks.items()}
    json.dump(lab, open(os.path.join(OUT, "labels.json"), "w", encoding="utf-8"), ensure_ascii=False)
    if surround:
        surround.hide_render = True
    sc.render.filepath = os.path.join(OUT, "03_配置図_真上から.png")
    bpy.ops.render.render(write_still=True)
    print("render", "03_配置図_真上から")
# ---------- 外観 ----------
shot("10_広場から研究棟ゲート", W("研究棟", -7.6, -110, 1.7), W("研究棟", -7.6, 0, 26), 22)
shot("11_大階段とSITの芝生", W("研究棟", -7.6, -62, 18), W("研究棟", -7.6, -28, 8.1), 24)
shot("12_通りから本部棟", Vector((-215, -150, 1.7)), W("本部棟", 40, -10, 30), 20)
shot("13_交流棟_道路側", W("交流棟", -10, 60, 1.7), W("交流棟", -5, 0, 14), 22)
# ---------- 渡り廊下 ----------
shot("20_渡り廊下_教室棟と交流棟", W("交流棟", 40, -24, 6), W("交流棟", 40, 9, 16), 24)
shot("21_渡り廊下_本部棟と交流棟", W("交流棟", 60, -30, 2), W("交流棟", 16.5, -20, 18), 22)
# ---------- 内装（点光源を足す） ----------
lights([W("研究棟", x, y, 40.5 + 2.4) for x in range(-30, 41, 6) for y in (-12.95, 11.7)], 120)
shot("30_研究棟_9F廊下", W("研究棟", 39.5, -12.95, 40.5 + 1.6), W("研究棟", -20, -12.95, 40.5 + 1.5), 20, interior=True)
clear_lights()
lights([W("研究棟", x, y, 3.0) for x in range(-20, 41, 6) for y in (-12.6, 13.1)], 150)
shot("31_研究棟_1F廊下", W("研究棟", 39.0, 13.15, 1.6), W("研究棟", -20, 13.15, 1.6), 20, interior=True)
clear_lights()
lights([W("教室棟", x, y, 11.0 + 2.6) for x in range(-36, 37, 6) for y in (-2.3, -7.5)], 200)
shot("32_教室棟_3F廊下と吹き抜け", W("教室棟", 33.0, -2.3, 11.0 + 1.6), W("教室棟", -10, -4.5, 11.0 + 0.5), 18, interior=True)
clear_lights()
lights([W("教室棟", x, y, 31.0 + 3.0) for x in range(-36, 37, 8) for y in (-5, 4)], 150)
shot("33_教室棟_7F空中庭園", W("教室棟", -30, -6, 31.0 + 6.0), W("教室棟", 5, 6, 31.0), 20, interior=True)
clear_lights()
lights([W("交流棟", x, -8.2, 16.0 + 2.6) for x in range(-30, 31, 6)], 200)
shot("34_交流棟_4F廊下", W("交流棟", 14.5, -8.2, 16.0 + 1.6), W("交流棟", -20, -8.0, 16.0 + 1.4), 20, interior=True)
clear_lights()
print("DONE", OUT)
