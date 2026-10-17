# TRACE のチェックポイント（グラフの点とつながり）を Blender に置く・書き戻す・書き出す
#   キャンパス全体.blend を開いて、Blender の中で実行する:
#     exec(open(r"<このファイル>", encoding="utf-8").read()); build()   … 元データ → 点と線を作り直す
#     pull()    … Blender で動かした点の位置を元データ（campus_graph.src.json）に書き戻す
#     export()  … バックエンドに渡す campus_graph.json を書き出す（緯度経度・アプリの座標つき）
import bpy, json, math, os, sys
from datetime import date
from mathutils import Matrix

# キャンパス全体.blend と同じフォルダ（make_campus_all.py のように保存前に exec するときは TRACE_ROOT を先に入れておく）
ROOT = globals().get("TRACE_ROOT") or os.path.dirname(bpy.data.filepath)
GRAPH_SRC = os.path.join(ROOT, "trace", "campus_graph.src.json")
GRAPH_OUT = os.path.join(ROOT, "trace", "campus_graph.json")
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import importlib, trace_geo
importlib.reload(trace_geo)

COL = "30_TRACE_チェックポイント"
GRAPH_VERSION = "toyosu-graph-2026-10-17.draft"
KIND_COLOR = {"ground": (0.1, 0.55, 1.0), "stairs": (1.0, 0.6, 0.1), "bridge": (0.75, 0.3, 1.0), "indoor": (0.2, 0.8, 0.3), "escalator": (1.0, 0.85, 0.1)}


def _mat(name, rgb):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Emission Color"].default_value = (*rgb, 1)
    bsdf.inputs["Emission Strength"].default_value = 3.0
    m.diffuse_color = (*rgb, 1)
    return m


def _clear():
    col = bpy.data.collections.get(COL)
    if col:
        for o in list(col.all_objects):
            bpy.data.objects.remove(o, do_unlink=True)
    else:
        col = bpy.data.collections.new(COL)
        bpy.context.scene.collection.children.link(col)
    return col


def build():
    src = json.load(open(GRAPH_SRC, encoding="utf-8"))
    col = _clear()
    pos = {}
    m_pt = _mat("TRACE_点", (1.0, 0.15, 0.1))
    for n in src["nodes"]:
        p = n["blender"]
        pos[n["id"]] = p
        # 点：動かせる空オブジェクト（これが位置の正）＋ 見た目の球（子）
        e = bpy.data.objects.new("CP_" + n["id"], None)
        e.empty_display_type = 'SPHERE'
        e.empty_display_size = 2.0
        e.location = p
        for k in ("id", "name", "building", "floor", "note"):
            e[k] = n.get(k) or ""
        e["radius"] = n.get("radius", 15)
        e["gpsSnap"] = n.get("gpsSnap", True)
        col.objects.link(e)
        me = bpy.data.meshes.get("TRACE_球")
        if not me:
            import bmesh
            me = bpy.data.meshes.new("TRACE_球")
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=1.5)
            bm.to_mesh(me)
            bm.free()
            me.materials.append(m_pt)
        s = bpy.data.objects.new("CP_" + n["id"] + "_球", me)
        s.parent = e
        s.hide_select = True
        col.objects.link(s)
        # 範囲（半径）の輪
        cu = bpy.data.curves.new("CP_" + n["id"] + "_範囲", 'CURVE')
        cu.dimensions = '3D'
        cu.bevel_depth = 0.25
        sp = cu.splines.new('POLY')
        seg = 48
        sp.points.add(seg)
        r = e["radius"]
        for i in range(seg + 1):
            a = 2 * math.pi * i / seg
            sp.points[i].co = (r * math.cos(a), r * math.sin(a), 0.3, 1)
        cu.materials.append(m_pt)
        ring = bpy.data.objects.new("CP_" + n["id"] + "_範囲", cu)
        ring.parent = e
        ring.hide_select = True
        col.objects.link(ring)
    # つながり：点を動かすと線もついてくるように、端点をフックで点につなぐ
    for ed in src["edges"]:
        a, b = bpy.data.objects["CP_" + ed["from"]], bpy.data.objects["CP_" + ed["to"]]
        cu = bpy.data.curves.new("EDGE_" + ed["id"], 'CURVE')
        cu.dimensions = '3D'
        cu.bevel_depth = 0.6
        sp = cu.splines.new('POLY')
        sp.points.add(1)
        sp.points[0].co = (*a.location, 1)
        sp.points[1].co = (*b.location, 1)
        cu.materials.append(_mat("TRACE_線_" + ed["kind"], KIND_COLOR[ed["kind"]]))
        o = bpy.data.objects.new("EDGE_" + ed["id"], cu)
        o["from"], o["to"], o["kind"] = ed["from"], ed["to"], ed["kind"]
        o.hide_select = True
        col.objects.link(o)
        for i, t in enumerate((a, b)):
            h = o.modifiers.new(f"hook{i}", 'HOOK')
            h.object = t
            h.vertex_indices_set([i])
            # 作ったばかりの空は matrix_world がまだ更新されていないので、位置から作る
            h.matrix_inverse = Matrix.Translation(t.location).inverted()
    return {"nodes": len(src["nodes"]), "edges": len(src["edges"])}


def pull():
    """Blender で動かした点の位置を元データに書き戻す"""
    src = json.load(open(GRAPH_SRC, encoding="utf-8"))
    moved = []
    for n in src["nodes"]:
        e = bpy.data.objects.get("CP_" + n["id"])
        if not e:
            continue
        p = [round(v, 2) for v in e.matrix_world.translation]
        if p != n["blender"]:
            moved.append(n["id"])
        n["blender"] = p
        n["radius"] = e.get("radius", n.get("radius", 15))
        n["gpsSnap"] = bool(e.get("gpsSnap", n.get("gpsSnap", True)))
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
            "id": n["id"], "name": n["name"], "building": n["building"], "floor": n["floor"],
            "lat": round(lat, 7), "lon": round(lon, 7),
            "local": {"east": round(east, 2), "north": round(north, 2)},
            "heightMetres": z,
            "threeD": {"x": x, "y": y, "z": z},
            "radiusMetres": n.get("radius", 15),
            "gpsSnap": n.get("gpsSnap", True),
            "note": n.get("note", ""),
        })
    edges = []
    for e in src["edges"]:
        a, b = pos[e["from"]], pos[e["to"]]
        edges.append({"id": e["id"], "from": e["from"], "to": e["to"], "kind": e["kind"],
                      "lengthMetres": round(math.dist(a[:2], b[:2]), 1), "passable": True})
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
        "edgeKinds": {"ground": "地上の道", "stairs": "階段", "bridge": "渡り廊下", "indoor": "建物の中", "escalator": "エスカレーター"},
        "gpsSnap": "true = GPS の位置をこの点にまとめてよい。false = 上の階の点など、GPS では見分けられないので描画（演出）だけに使う",
        "nodes": nodes,
        "edges": edges,
    }
    json.dump(out, open(GRAPH_OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return {"path": GRAPH_OUT, "nodes": len(nodes), "edges": len(edges)}
