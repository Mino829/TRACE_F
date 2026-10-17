# チェックポイントの説明用の図（3D）をレンダーする。キャンパス全体.blend で trace_graph.build() のあとに exec する
#   shot("01_全体", ...)        … 点とつながりを全部見せる
#   trail(順番, smooth)         … 来場者が歩いた例の光の線（一時的なオブジェクト。clear_trail() で消す）
import bpy, math, os
from mathutils import Vector

# キャンパス全体.blend と同じフォルダ（make_campus_all.py のように保存前に exec するときは TRACE_ROOT を先に入れておく）
ROOT = globals().get("TRACE_ROOT") or os.path.dirname(bpy.data.filepath)
FIG = os.path.join(ROOT, "trace", "figures")
os.makedirs(FIG, exist_ok=True)
COL = "30_TRACE_チェックポイント"
sc = bpy.context.scene


def P(nid):
    return bpy.data.objects["CP_" + nid].matrix_world.translation.copy()


def show_graph(edges=True, rings=True, points=True):
    for o in bpy.data.collections[COL].objects:
        if o.name.startswith("EDGE_"):
            o.hide_render = not edges
        elif o.name.endswith("_範囲"):
            o.hide_render = not rings
        elif o.name.endswith("_球"):
            o.hide_render = not points


def _emit(name, rgb, strength):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*rgb, 1)
    em.inputs["Strength"].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def clear_trail():
    for o in [o for o in bpy.data.objects if o.name.startswith("TRACE_軌跡")]:
        cu = o.data
        bpy.data.objects.remove(o)
        bpy.data.curves.remove(cu)


def trail(seq, smooth=False, lift=1.5, width=0.9, rgb=(0.2, 0.9, 1.0), strength=6.0):
    """点の id の順に光の線を作る。smooth=True は角を丸めた線（NURBS）"""
    clear_trail()
    pts = [P(n) + Vector((0, 0, lift)) for n in seq]
    if smooth:
        # 長い辺の途中にも制御点を足して、角だけが丸くなるようにする
        dense = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            k = max(1, int((b - a).length // 12))
            dense += [a.lerp(b, i / k) for i in range(1, k + 1)]
        pts = dense
    cu = bpy.data.curves.new("TRACE_軌跡", 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = width
    cu.bevel_resolution = 3
    sp = cu.splines.new('NURBS' if smooth else 'POLY')
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1)
    if smooth:
        sp.order_u = 4
        sp.use_endpoint_u = True
        sp.resolution_u = 12
    cu.materials.append(_emit("TRACE_軌跡", rgb, strength))
    o = bpy.data.objects.new("TRACE_軌跡", cu)
    bpy.data.collections[COL].objects.link(o)
    return o


def night(on=True, sun=0.15, sky=0.05):
    """光の線が目立つように暗くする（on=False で元に戻す）"""
    s = bpy.data.objects["太陽"].data
    bg = next(n for n in sc.world.node_tree.nodes if n.type == 'BACKGROUND')
    if on:
        sc["_keep_night"] = (s.energy, bg.inputs["Strength"].default_value)
        s.energy, bg.inputs["Strength"].default_value = sun, sky
    elif "_keep_night" in sc:
        s.energy, bg.inputs["Strength"].default_value = sc["_keep_night"]
        del sc["_keep_night"]


def shot(name, loc, target, lens=28, samples=24, res=(1920, 1080), hide=("周辺建物_OSM",)):
    keep = dict(cam=sc.camera, rx=sc.render.resolution_x, ry=sc.render.resolution_y,
                fp=sc.render.filepath, smp=sc.eevee.taa_render_samples)
    hidden = [c for c in bpy.data.collections if c.name in hide and not c.hide_render]
    for c in hidden:
        c.hide_render = True
    cd = bpy.data.cameras.new("TRACE_図")
    cd.lens, cd.clip_end = lens, 3000
    cam = bpy.data.objects.new("TRACE_図", cd)
    sc.collection.objects.link(cam)
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.eevee.taa_render_samples = samples
    path = os.path.join(FIG, name + ".png")
    sc.render.filepath = path
    try:
        bpy.ops.render.render(write_still=True)
    finally:
        sc.camera = keep["cam"]
        sc.render.resolution_x, sc.render.resolution_y = keep["rx"], keep["ry"]
        sc.render.filepath, sc.eevee.taa_render_samples = keep["fp"], keep["smp"]
        bpy.data.objects.remove(cam)
        bpy.data.cameras.remove(cd)
        for c in hidden:
            c.hide_render = False
    return path


def trail_layer(name):
    """光の線（と点）だけを、背景が透明な画像としてレンダーする（建物に隠れない重ね用）"""
    keep_film = sc.render.film_transparent
    tops = [c for c in sc.collection.children if c.name != COL and not c.hide_render]
    loose = [o for o in sc.collection.objects if o.type != 'CAMERA' and not o.hide_render]
    for c in tops:
        c.hide_render = True
    for o in loose:
        o.hide_render = True
    sc.render.film_transparent = True
    try:
        a, k = _last_view[0]
        return shot(name, *a, **k)
    finally:
        for c in tops:
            c.hide_render = False
        for o in loose:
            o.hide_render = False
        sc.render.film_transparent = keep_film


_last_view = [((), {})]


def view(loc, target, **kw):
    _last_view[0] = ((loc, target), kw)
