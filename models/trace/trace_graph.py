# TRACE のチェックポイント（グラフの点とつながり）を Blender に置く・書き戻す・書き出す
#   キャンパス全体.blend を開いて、Blender の中で実行する:
#     exec(open(r"<このファイル>", encoding="utf-8").read()); build()   … 元データ → 点と線を作り直す
#     pull()    … 編集モードで動かした頂点（点）の位置を元データ（campus_graph.src.json）に書き戻す
#   点とつながりは 1 つのメッシュ「TRACE_道の網」（頂点 = 点、辺 = つながり）。見た目は Geometry Nodes
#     export()  … バックエンドに渡す campus_graph.json を書き出す（緯度経度・アプリの座標つき）
import bpy, json, math, os, sys
from datetime import date

# キャンパス全体.blend と同じフォルダ（make_campus_all.py のように保存前に exec するときは TRACE_ROOT を先に入れておく）
ROOT = globals().get("TRACE_ROOT") or os.path.dirname(bpy.data.filepath)
GRAPH_SRC = os.path.join(ROOT, "trace", "campus_graph.src.json")
GRAPH_OUT = os.path.join(ROOT, "trace", "campus_graph.json")
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import importlib, trace_geo
importlib.reload(trace_geo)

COL = "30_TRACE_チェックポイント"
GRAPH_VERSION = "toyosu-graph-2026-10-25.1.draft"
KIND_COLOR = {"ground": (0.1, 0.55, 1.0), "stairs": (1.0, 0.6, 0.1), "bridge": (0.75, 0.3, 1.0), "indoor": (0.2, 0.8, 0.3), "escalator": (1.0, 0.85, 0.1), "elevator": (0.95, 0.95, 0.95)}


def _mat(name, rgb):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Emission Color"].default_value = (*rgb, 1)
    bsdf.inputs["Emission Strength"].default_value = 3.0
    m.diffuse_color = (*rgb, 1)
    return m


KINDS = list(KIND_COLOR)                    # 辺の属性 kind の番号の順
ROLES = ["checkpoint", "room", "waypoint"]  # 頂点の属性 role の番号の順
NET = "TRACE_道の網"


def _clear():
    col = bpy.data.collections.get(COL)
    if col:
        objs = list(col.all_objects)
        datas = [o.data for o in objs if o.data]
        bpy.data.batch_remove(objs)             # 1 つずつ消すと遅い（前の版は点ごとに 3 つのオブジェクトがあった）
        bpy.data.batch_remove([d for d in datas if d.users == 0])
    else:
        col = bpy.data.collections.new(COL)
        bpy.context.scene.collection.children.link(col)
    return col


def _sock(node, ident):
    """Compare の整数の入力は、版によって A_INT（4.x）か A（5.x）"""
    for name in (ident, ident.split("_")[0]):
        for s in node.inputs:
            if s.identifier == name and s.type == 'INT':
                return s
    raise KeyError(ident)


def _gn():
    """道の網の見た目：辺 → 種類ごとの色の管、頂点 → 球（ゴールは大きく）、ゴールのまわりに半径の輪"""
    ng = bpy.data.node_groups.get("TRACE_道の網の見た目")
    if ng:
        bpy.data.node_groups.remove(ng)
    ng = bpy.data.node_groups.new("TRACE_道の網の見た目", 'GeometryNodeTree')
    io = ng.interface
    io.new_socket("Geometry", in_out='INPUT', socket_type='NodeSocketGeometry')
    for name, val in (("線", True), ("点", True), ("ゴールの点だけ", False), ("輪", True)):
        io.new_socket(name, in_out='INPUT', socket_type='NodeSocketBool').default_value = val
    io.new_socket("Geometry", in_out='OUTPUT', socket_type='NodeSocketGeometry')
    N, Lk = ng.nodes, ng.links.new
    gi, go = N.new("NodeGroupInput"), N.new("NodeGroupOutput")
    join = N.new("GeometryNodeJoinGeometry")
    Lk(join.outputs[0], go.inputs[0])

    def attr(name, dtype):
        a = N.new("GeometryNodeInputNamedAttribute")
        a.data_type = dtype
        a.inputs["Name"].default_value = name
        return a.outputs["Attribute"]

    def eq(value, k):
        c = N.new("FunctionNodeCompare")
        c.data_type, c.operation = 'INT', 'EQUAL'
        Lk(value, _sock(c, "A_INT"))
        _sock(c, "B_INT").default_value = k
        return c.outputs[0]

    def boolean(op, a, b=None):
        m = N.new("FunctionNodeBooleanMath")
        m.operation = op
        Lk(a, m.inputs[0])
        if b is not None:
            Lk(b, m.inputs[1])
        return m.outputs[0]

    def tube(geo, radius, mat):
        prof = N.new("GeometryNodeCurvePrimitiveCircle")
        prof.inputs["Resolution"].default_value = 8
        prof.inputs["Radius"].default_value = radius
        cm = N.new("GeometryNodeCurveToMesh")
        Lk(geo, cm.inputs["Curve"])
        Lk(prof.outputs["Curve"], cm.inputs["Profile Curve"])
        sm = N.new("GeometryNodeSetMaterial")
        Lk(cm.outputs[0], sm.inputs["Geometry"])
        sm.inputs["Material"].default_value = mat
        return sm.outputs[0]

    # 線（種類ごと）
    kind = attr("kind", 'INT')
    for k, name in enumerate(KINDS):
        sep = N.new("GeometryNodeSeparateGeometry")
        sep.domain = 'EDGE'
        Lk(gi.outputs["Geometry"], sep.inputs["Geometry"])
        Lk(boolean('AND', eq(kind, k), gi.outputs["線"]), sep.inputs["Selection"])
        m2c = N.new("GeometryNodeMeshToCurve")
        Lk(sep.outputs["Selection"], m2c.inputs["Mesh"])
        Lk(tube(m2c.outputs[0], 0.6, _mat("TRACE_線_" + name, KIND_COLOR[name])), join.inputs[0])
    # 点（球）。ゴールは半径 1.5m、ほかは 0.6m
    role = attr("role", 'INT')
    is_check = eq(role, 0)
    sel = boolean('AND', gi.outputs["点"], boolean('OR', boolean('NOT', gi.outputs["ゴールの点だけ"]), is_check))
    sph = N.new("GeometryNodeMeshUVSphere")
    sph.inputs["Segments"].default_value, sph.inputs["Rings"].default_value, sph.inputs["Radius"].default_value = 16, 8, 1.0
    sw = N.new("GeometryNodeSwitch")
    sw.input_type = 'FLOAT'
    Lk(is_check, sw.inputs["Switch"])
    sw.inputs["False"].default_value, sw.inputs["True"].default_value = 0.6, 1.5
    iop = N.new("GeometryNodeInstanceOnPoints")
    Lk(gi.outputs["Geometry"], iop.inputs["Points"])
    Lk(sel, iop.inputs["Selection"])
    Lk(sph.outputs["Mesh"], iop.inputs["Instance"])
    Lk(sw.outputs[0], iop.inputs["Scale"])
    smp = N.new("GeometryNodeSetMaterial")
    Lk(iop.outputs[0], smp.inputs["Geometry"])
    smp.inputs["Material"].default_value = _mat("TRACE_点", (1.0, 0.15, 0.1))
    Lk(smp.outputs[0], join.inputs[0])
    # 半径の輪（ゴールだけ。半径は頂点の属性 radius）
    circ = N.new("GeometryNodeCurvePrimitiveCircle")
    circ.inputs["Resolution"].default_value, circ.inputs["Radius"].default_value = 48, 1.0
    # 半径 1m の輪を radius 倍に広げるので、管の太さは先に割っておく（ゴールの radius はどれも 15m）
    ring = tube(circ.outputs["Curve"], 0.25 / 15, _mat("TRACE_点", (1.0, 0.15, 0.1)))
    iop2 = N.new("GeometryNodeInstanceOnPoints")
    Lk(gi.outputs["Geometry"], iop2.inputs["Points"])
    Lk(boolean('AND', is_check, gi.outputs["輪"]), iop2.inputs["Selection"])
    Lk(ring, iop2.inputs["Instance"])
    Lk(attr("radius", 'FLOAT'), iop2.inputs["Scale"])
    Lk(iop2.outputs[0], join.inputs[0])
    return ng


def build():
    """元データ → 1 つのメッシュ（頂点 = 点、辺 = つながり）。点の順番 = 頂点の番号"""
    src = json.load(open(GRAPH_SRC, encoding="utf-8"))
    col = _clear()
    index = {n["id"]: i for i, n in enumerate(src["nodes"])}
    me = bpy.data.meshes.new(NET)
    me.from_pydata([n["blender"] for n in src["nodes"]], [(index[e["from"]], index[e["to"]]) for e in src["edges"]], [])
    me.attributes.new("kind", 'INT', 'EDGE').data.foreach_set("value", [KINDS.index(e["kind"]) for e in src["edges"]])
    me.attributes.new("role", 'INT', 'POINT').data.foreach_set(
        "value", [ROLES.index(n.get("role", "checkpoint")) for n in src["nodes"]])
    me.attributes.new("radius", 'FLOAT', 'POINT').data.foreach_set("value", [float(n.get("radius", 15)) for n in src["nodes"]])
    o = bpy.data.objects.new(NET, me)
    o["node_ids"] = [n["id"] for n in src["nodes"]]       # 頂点の番号 → 点の id（pull() で使う）
    col.objects.link(o)
    o.modifiers.new("見た目", 'NODES').node_group = _gn()
    return {"nodes": len(src["nodes"]), "edges": len(src["edges"])}


def set_input(mod, identifier, value):
    """Geometry Nodes のモディファイアの入力に値を入れる（5.x は properties.inputs、4.x は mod[identifier]）"""
    props = getattr(mod, "properties", None)
    if props is not None and hasattr(props.inputs, identifier):
        getattr(props.inputs, identifier).value = value
    else:
        mod[identifier] = value


def show(**kw):
    """見た目の切りかえ：show(線=True, 点=True, ゴールの点だけ=False, 輪=True)"""
    o = bpy.data.objects[NET]
    mod = o.modifiers["見た目"]
    for item in mod.node_group.interface.items_tree:
        if item.in_out == 'INPUT' and item.name in kw:
            set_input(mod, item.identifier, kw[item.name])
    o.update_tag()


def pull():
    """編集モードで動かした頂点の位置を元データに書き戻す（頂点を足したり消したりしない。順番が点の id とずれる）"""
    src = json.load(open(GRAPH_SRC, encoding="utf-8"))
    o = bpy.data.objects[NET]
    if o.mode == 'EDIT':
        bpy.ops.object.mode_set(mode='OBJECT')
    ids = list(o["node_ids"])
    if len(o.data.vertices) != len(ids) or ids != [n["id"] for n in src["nodes"]]:
        raise RuntimeError("頂点の数か順番が元データと合わない。頂点を足したり消したりしたときは build_network.py の道を直す")
    moved = []
    for n, v in zip(src["nodes"], o.data.vertices):
        p = [round(c, 2) for c in (o.matrix_world @ v.co)]
        if p != n["blender"]:
            moved.append(n["id"])
        n["blender"] = p
    json.dump(src, open(GRAPH_SRC, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return {"moved": moved}


def export():
    """バックエンドに渡す JSON（座標はアプリのローカル ENU、緯度経度、3DCG の座標を全部つける）"""
    src = json.load(open(GRAPH_SRC, encoding="utf-8"))
    nodes, pos = [], {}
    for n in src["nodes"]:
        x, y, z = n["blender"]
        lat, lon = trace_geo.blender_to_latlon(x, y)
        east, north = trace_geo.latlon_to_enu(lat, lon)
        pos[n["id"]] = (east, north, z)
        nodes.append({
            "id": n["id"], "name": n["name"], "role": n.get("role", "checkpoint"), "building": n["building"], "floor": n["floor"],
            "lat": round(lat, 7), "lon": round(lon, 7),
            "local": {"east": round(east, 2), "north": round(north, 2)},
            "heightMetres": z,
            "threeD": {"x": x, "y": y, "z": z},
            "radiusMetres": n.get("radius", 15),
            "gpsSnap": n.get("gpsSnap", True),
            "selectable": n.get("selectable", False),
            "note": n.get("note", ""),
        })
    edges = []
    for e in src["edges"]:
        a, b = pos[e["from"]], pos[e["to"]]
        edges.append({"id": e["id"], "from": e["from"], "to": e["to"], "kind": e["kind"],
                      # 高さも入れた距離（平面だけだと、真上に上がる階段が 0m になって最短の道を探すときに「タダ」になる）
                      "lengthMetres": round(math.dist(a, b), 1), "planarLengthMetres": round(math.dist(a[:2], b[:2]), 1),
                      "passable": True})
    out = {
        "schemaVersion": 1,
        "campusGraphVersion": GRAPH_VERSION,
        "coordinateVersion": trace_geo.APP_COORDINATE_VERSION,
        "threeDMapVersion": "キャンパス全体.blend " + date.today().isoformat(),
        "exportedAt": date.today().isoformat(),
        "coordinates": {
            "local": "アプリのローカル ENU（原点 = 教室棟1F南面の自動ドア, east/north はメートル）。coordinateVersion の式で緯度経度から計算",
            "threeD": "キャンパス全体.blend の座標（1 = 1m, Z 上, 地面 = 0）。平面直角座標系 第IX系 (X=-37645, Y=-3322) を原点にずらしたもの",
            "heightMetres": "地面からの高さ。MVP は高さ固定なので経路の計算には使わない",
        },
        "roles": {"checkpoint": "ゴール・目印の点（名前がある）", "room": "教室の中の点", "waypoint": "道の途中の点（数m〜10m おき）"},
        "edgeKinds": {"ground": "地上の道", "stairs": "階段", "bridge": "渡り廊下", "indoor": "建物の中", "escalator": "エスカレーター", "elevator": "エレベーター（同じ XY を真上に動く。展示では向きを変えない）"},
        "selectable": "true = 参加者が写真の撮影場所として選べる点（建物 → 階の順に選ぶ。#38）。false = 経路を引くための内部の点で、参加者には見せない",
        "gpsSnap": "true = GPS の位置をこの点にまとめてよい。false = 上の階の点など、GPS では見分けられないので描画（演出）だけに使う",
        "nodes": nodes,
        "edges": edges,
    }
    json.dump(out, open(GRAPH_OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return {"path": GRAPH_OUT, "nodes": len(nodes), "edges": len(edges)}
