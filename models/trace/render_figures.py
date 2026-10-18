# チェックポイントの説明用の図（3D）をレンダーする。キャンパス全体.blend で trace_graph.build() のあとに exec する
#   shot("01_全体", ...)        … 点とつながりを全部見せる
#   trail(順番, smooth)         … 来場者が歩いた例の光の線（一時的なオブジェクト。clear_trail() で消す）
import bpy, math, os
exec(open(os.path.join(os.path.dirname(bpy.data.filepath), "trace", "trace_graph.py"), encoding="utf-8").read())   # set_input など
from mathutils import Vector

# キャンパス全体.blend と同じフォルダ（make_campus_all.py のように保存前に exec するときは TRACE_ROOT を先に入れておく）
ROOT = globals().get("TRACE_ROOT") or os.path.dirname(bpy.data.filepath)
FIG = os.path.join(ROOT, "trace", "figures")
os.makedirs(FIG, exist_ok=True)
COL = "30_TRACE_チェックポイント"
sc = bpy.context.scene


def P(nid):
    """点の位置（元データ campus_graph.src.json から）"""
    import json
    if "_pos" not in globals():
        g = json.load(open(os.path.join(ROOT, "trace", "campus_graph.src.json"), encoding="utf-8"))
        globals()["_pos"] = {n["id"]: n["blender"] for n in g["nodes"]}
    return Vector(_pos[nid])


def show_graph(edges=True, rings=True, points=True):
    """道の網の見た目を切りかえる。points = "check" ならゴールの点だけ"""
    o = bpy.data.objects["TRACE_道の網"]
    mod = o.modifiers["見た目"]
    vals = {"線": edges, "輪": rings, "点": bool(points), "ゴールの点だけ": points == "check"}
    for item in mod.node_group.interface.items_tree:
        if item.in_out == 'INPUT' and item.name in vals:
            set_input(mod, item.identifier, vals[item.name])
    o.update_tag()


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


# 軌跡の例：大樹（豊洲駅側）から入って広場へ。本部棟から渡り廊下で交流棟 4F・6F（大講義室）、教室棟 6F→5F→4F→3F と下りて ShibaLab へ
SEQ = ["big-tree", "hq-piloti", "koryu-plaza", "grand-stairs-bottom", "hq-exchange-bridge", "hq-entrance", "hq-4f-bridge",
       "exchange-4f", "exchange-6f-hall", "classroom-6f-bridge", "classroom-5f-lobby", "classroom-4f-lobby",
       "classroom-3f-lobby", "shibalab"]
VIEW = ((-330, -190, 170), (-150, -20, 0))


def route(seq):
    """ゴールの点の順番を、道の網の上の最短の道（点の id の列）に広げる"""
    import heapq, json
    g = json.load(open(os.path.join(ROOT, "trace", "campus_graph.src.json"), encoding="utf-8"))
    pos = {n["id"]: Vector(n["blender"]) for n in g["nodes"]}
    adj = {i: [] for i in pos}
    for e in g["edges"]:
        w = (pos[e["from"]] - pos[e["to"]]).length
        adj[e["from"]].append((e["to"], w))
        adj[e["to"]].append((e["from"], w))
    out = [seq[0]]
    for a, b in zip(seq, seq[1:]):
        dist, prev, q = {a: 0.0}, {}, [(0.0, a)]
        while q:
            d, u = heapq.heappop(q)
            if u == b:
                break
            if d > dist[u]:
                continue
            for v, w in adj[u]:
                if d + w < dist.get(v, 1e18):
                    dist[v], prev[v] = d + w, u
                    heapq.heappush(q, (d + w, v))
        part, u = [], b
        while u != a:
            part.append(u)
            u = prev[u]
        out += part[::-1]
    return out


def render_all(seq=SEQ, samples=16):
    """figures/ の 02（全体）と 04（そのまま）、05・06 の素材（_背景_夜・_線_直線・_線_なめらか）を撮る"""
    out = []
    try:
        show_graph(True, True, True)
        out.append(shot("02_3D_全体_豊洲駅側の空から", *VIEW, lens=32, samples=24))
        show_graph(False, False, "check")
        night(True)
        seq = route(seq)
        trail(seq, smooth=True, strength=1.5)
        out.append(shot("04_軌跡の例_そのまま（建物に隠れる）", *VIEW, lens=32, samples=samples))
        clear_trail()
        show_graph(False, False, False)
        out.append(shot("_背景_夜", *VIEW, lens=32, samples=samples))
        night(False)
        view(*VIEW, lens=32, samples=samples)
        for sm in (False, True):
            trail(seq, smooth=sm, strength=1.5)
            show_graph(False, False, "check")
            out.append(trail_layer("_線_" + ("なめらか" if sm else "直線")))
    finally:
        night(False)
        clear_trail()
        show_graph(True, True, True)
    return out


def render_floors(samples=24):
    """建物を消して、点とつながりだけを斜めから撮る（階の重なりが見える）→ figures/08"""
    show_graph(True, False, True)
    night(True)
    try:
        return shot("08_3D_建物を消して階を見る", (-105, -125, 40), (-190, -15, 13), lens=26, samples=samples,
                    hide=("周辺建物_OSM", "10_建物", "20_内装"))
    finally:
        night(False)
        show_graph(True, True, True)


# ---------- 確認用の図（上から・横から・斜めから。建物を透かして道の網を重ねる） ----------
# Workbench で「建物だけ（半透明）」と「道の網だけ（背景が透明）」を別々に撮り、check_overlay.py で重ねる
import json as _json
from bpy_extras.object_utils import world_to_camera_view as _w2c
FLOOR_Z = {"1F": 0.0, "2F": 6.0, "3F": 11.0, "4F": 16.0, "5F": 21.0, "6F": 26.0}


def _grid_dirs():
    P = _json.load(open(os.path.join(ROOT, "buildings", "配置.json"), encoding="utf-8"))
    t = P["教室棟"]["theta"]
    return Vector((math.cos(t), math.sin(t), 0)), Vector((-math.sin(t), math.cos(t), 0)), t


def _wb_pass(path, cam, network, ghost_alpha=0.22):
    """network=False：建物を半透明で（道の網は隠す）。network=True：道の網だけ、背景は透明"""
    keep = dict(engine=sc.render.engine, film=sc.render.film_transparent, xray=sc.display.shading.show_xray,
                xa=sc.display.shading.xray_alpha, ct=sc.display.shading.color_type, light=sc.display.shading.light,
                sh=sc.display.shading.show_shadows, cav=sc.display.shading.show_cavity, fp=sc.render.filepath, cam=sc.camera)
    net = bpy.data.objects["TRACE_道の網"]
    tops = [c for c in sc.collection.children if c.name != COL and not c.hide_render]
    osm = [c for c in bpy.data.collections if c.name == "周辺建物_OSM" and not c.hide_render]
    sh = sc.display.shading
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh.color_type, sh.light, sh.show_shadows = 'MATERIAL', 'STUDIO', False
    sh.show_cavity = not network
    sc.camera = cam
    sc.render.filepath = path
    try:
        for c in osm:
            c.hide_render = True
        if network:
            for c in tops:
                c.hide_render = True
            sc.render.film_transparent, sh.show_xray = True, False
        else:
            net.hide_render = True
            sc.render.film_transparent, sh.show_xray, sh.xray_alpha = False, True, ghost_alpha
        bpy.ops.render.render(write_still=True)
    finally:
        for c in tops + osm:
            c.hide_render = False
        net.hide_render = False
        sc.render.engine, sc.render.film_transparent = keep["engine"], keep["film"]
        sh.show_xray, sh.xray_alpha, sh.color_type, sh.light = keep["xray"], keep["xa"], keep["ct"], keep["light"]
        sh.show_shadows, sh.show_cavity = keep["sh"], keep["cav"]
        sc.render.filepath, sc.camera = keep["fp"], keep["cam"]


def check_view(name, title, loc, target, ortho=None, lens=30, res=(1920, 1080), floors=False):
    """確認用の図を 1 枚：_<name>_建物.png と _<name>_網.png を撮り、重ねるための情報を JSON に書く"""
    cd = bpy.data.cameras.new("TRACE_確認")
    cd.clip_end = 3000
    if ortho:
        cd.type, cd.ortho_scale = 'ORTHO', ortho
    else:
        cd.lens = lens
    cam = bpy.data.objects.new("TRACE_確認", cd)
    sc.collection.objects.link(cam)
    cam.location = loc
    d = Vector(target) - Vector(loc)
    if d.normalized().z < -0.999:                     # 真上から：画面の横 = 碁盤の目の u（教室棟の長い辺）
        cam.rotation_euler = (0, 0, _grid_dirs()[2])
    else:
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    keep = (sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage)
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = *res, 100
    show_graph(True, False, True)
    try:
        bpy.context.view_layer.update()
        meta = {"title": title, "floors": {}, "metresPerPx": (ortho / res[0]) if ortho else None}
        if floors:                                    # 階の高さの線（画面の高さ方向の位置）
            for f, z in FLOOR_Z.items():
                meta["floors"][f] = 1 - _w2c(sc, cam, Vector((target[0], target[1], z))).y
        _wb_pass(os.path.join(FIG, f"_{name}_建物.png"), cam, False)
        _wb_pass(os.path.join(FIG, f"_{name}_網.png"), cam, True)
        _json.dump(meta, open(os.path.join(FIG, f"_{name}.json"), "w", encoding="utf-8"), ensure_ascii=False)
    finally:
        show_graph(True, True, True)
        sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = keep
        bpy.data.objects.remove(cam)
        bpy.data.cameras.remove(cd)
    return name


def render_checks():
    """上から（全体・教室棟まわり）、横から（2 方向）、斜めから"""
    g = _json.load(open(os.path.join(ROOT, "trace", "campus_graph.src.json"), encoding="utf-8"))
    ps = [Vector(n["blender"]) for n in g["nodes"]]
    U, V, t = _grid_dirs()
    us = [p.dot(U) for p in ps]
    vs = [p.dot(V) for p in ps]
    cu, cv = (min(us) + max(us)) / 2, (min(vs) + max(vs)) / 2
    c = U * cu + V * cv
    w, h = max(us) - min(us), max(vs) - min(vs)
    out = []
    # 上から：全体（u が画面の横）
    out.append(check_view("09_上から_全体", "上から：道の網の全体（建物は半透明）", c + Vector((0, 0, 400)), c,
                          ortho=max(w, h * 16 / 9) + 30))
    # 上から：教室棟・交流棟・本部棟のまわり（建物の中の道が多いところ）
    ck = Vector((*_json.load(open(os.path.join(ROOT, "buildings", "配置.json"), encoding="utf-8"))["教室棟"]["center"], 0))
    ck = ck + U * (-40) + V * (-20)
    out.append(check_view("10_上から_教室棟と交流棟のまわり", "上から：教室棟・交流棟・本部棟のまわり（建物の中の道も見える）",
                          ck + Vector((0, 0, 400)), ck, ortho=130))
    # 横から：道路側（+v）から見る（u が横、高さが縦）
    out.append(check_view("11_横から_道路側から", "横から：道路側（北西）から見る（建物の長い辺の向き）",
                          c + V * 400 + Vector((0, 0, 30)), c + Vector((0, 0, 30)), ortho=w + 30, floors=True))
    # 横から：研究棟側（+u）から見る（v が横）
    out.append(check_view("12_横から_研究棟側から", "横から：研究棟側（北東）から見る",
                          c + U * 400 + Vector((0, 0, 30)), c + Vector((0, 0, 30)), ortho=h + 30, floors=True))
    # 斜めから：建物を透かして
    out.append(check_view("13_斜めから_建物を透かして", "斜めから：建物を透かして見る（豊洲駅側の空から）",
                          (-330, -190, 170), (-150, -20, 0), lens=32))
    return out
