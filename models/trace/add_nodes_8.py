# 8 回目：点の位置をモデルに合わせる（2026-10-29、TRACE_F #76）
#   - 本部棟の中の点（エレベーター・ホール・各階）：本部棟.blend の座標は建物の中心が (26.45, -8.4, -1) にあるのに、
#     add_nodes_4/5 はそれを引かずに建物の中心からの座標として使っていた。そのため約 28m ずれて建物の外の空中にあった
#     → ずれ (26.45, -8.4) を建物の向きで回した分だけ戻す（渡り廊下の口・玄関・ピロティは外観に合わせて置いたので動かさない）
#   - 交流棟のかご：エレベーターの扉を渡り廊下側（+X）の面へ移した（build_koryuto_exterior.py の SHAFT）。かごの点をその中心へ。
#     1F の点は +X の妻の入口の中（build_koryuto_exterior.py の VEST_LINK）へ。前は 1F の中の塊の中にあった
#   - 研究棟 EV B：+X の廊下に面した 1 台（Y = 1.6）をくり抜いて扉を開けた（build_kenkyuto.py の EVB_CELL）。かごの点をその中へ。
#     前は扉と扉のあいだの黒い塊の中（16, 0）にあった
#   - 研究棟ゲートの道路側：芝生の北の口に外階段を作った（build_kenkyuto.py の NS_Y1）。階段の上の点をデッキの端へ
#   python trace/add_nodes_4.py → 5 → 6 → 7 → 8（どれも何度実行しても同じ）
#   そのあと Blender で trace/reroute_walls.py（エレベーターの扉の前の点と、壁をよける線）→ trace_graph.export()
import json, math, os, re

D = os.path.dirname(os.path.abspath(__file__))
P = json.load(open(os.path.join(os.path.dirname(D), "buildings", "配置.json"), encoding="utf-8"))
SRC = os.path.join(D, "campus_graph.src.json")
src = json.load(open(SRC, encoding="utf-8"))
NODES = {n["id"]: n for n in src["nodes"]}
KENKYU, KYOSHITSU, KORYU, HONBU = list(P)


def W(b, x, y, z):
    t, c = P[b]["theta"], P[b]["center"]
    return [round(math.cos(t) * x - math.sin(t) * y + c[0], 2), round(math.sin(t) * x + math.cos(t) * y + c[1], 2), z]


def put(nid, b, x, y, z=None):
    n = NODES[nid]
    n["blender"] = W(b, x, y, n["blender"][2] if z is None else z)


# ---- 本部棟：本部棟.blend の原点のずれを戻す（印 fix8 をつけて 1 回だけ） ----
HONBU_ORIGIN = (26.45, -8.4)
t = P[HONBU]["theta"]
odx = math.cos(t) * HONBU_ORIGIN[0] - math.sin(t) * HONBU_ORIGIN[1]
ody = math.sin(t) * HONBU_ORIGIN[0] + math.cos(t) * HONBU_ORIGIN[1]
#   対象は add_nodes_4/5 が本部棟.blend の座標で置いた点だけ（hq-<n>f・-ev・-car・-hall）。
#   reroute_walls.py があとで置く点（-door、~1 など）は正しい座標で置かれるので動かさない
moved = []
for n in src["nodes"]:
    if re.match(r"^hq-\d+f(-ev|-car|-hall)?$", n["id"]) and not n.get("fix8"):
        x, y, z = n["blender"]
        n["blender"] = [round(x - odx, 2), round(y - ody, 2), z]
        n["fix8"] = True
        moved.append(n["id"])

# ---- 交流棟：かご（SHAFT の中心）と 1F の入口の中 ----
SHAFT = (24.05, 26.375, -6.9, -5.2)
for f in range(1, 7):
    put(f"exchange-{f}f-car", KORYU, (SHAFT[0] + SHAFT[1]) / 2, (SHAFT[2] + SHAFT[3]) / 2)
put("exchange-1f", KORYU, 30.6, 7.6, 0.0)
NODES["exchange-1f"]["note"] = "+X の妻の入口（ガラスの自動ドア）を入った所。ここからエレベーターの前室へ"

# ---- 研究棟 EV B：開けたかご（EVB_CELL の中心） ----
EVB_CAR = ((17.4 - 2.5 + 17.4 - 0.12) / 2, 1.6)
for f in range(1, 15):
    put(f"research-{f}f-east", KENKYU, *EVB_CAR)

# ---- 研究棟ゲートの道路側：外階段の上の端（デッキの端 Y = 22.8、ゲートの真ん中 X = -7.6） ----
put("o-120", KENKYU, -7.6, 22.8, 6.0)
put("research-road", KENKYU, -7.6, 31.0, 0)

# ---- 行き止まりの道の点を消す ----
#   教室棟の階段室へ入る枝（10/24 に階段の線を消したので行き止まり。階段室の鉄の扉は壁に貼った板なので、線が壁を抜けていた）と、
#   廊下の端の枝。選べる点・チェックポイント・教室の点でない、つながりが 1 本以下の点を、なくなるまで消す（どこへの道にも使われない）
pruned = []
while True:
    deg = {}
    for e in src["edges"]:
        deg[e["from"]] = deg.get(e["from"], 0) + 1
        deg[e["to"]] = deg.get(e["to"], 0) + 1
    dead = {n["id"] for n in src["nodes"] if n.get("role") == "waypoint" and not n.get("selectable") and deg.get(n["id"], 0) <= 1}
    if not dead:
        break
    pruned += sorted(dead)
    src["nodes"] = [n for n in src["nodes"] if n["id"] not in dead]
    src["edges"] = [e for e in src["edges"] if e["from"] not in dead and e["to"] not in dead]

json.dump(src, open(SRC, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("honbu moved", len(moved), "offset", round(odx, 2), round(ody, 2), "pruned", len(pruned))
