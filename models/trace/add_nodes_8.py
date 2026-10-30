# 8 回目：点の位置をモデルに合わせる（2026-10-29、TRACE_F #76）
#   - 本部棟の中の点（エレベーター・ホール・各階）：本部棟.blend の座標は建物の中心が (26.45, -8.4, -1) にあるのに、
#     add_nodes_4/5 はそれを引かずに建物の中心からの座標として使っていた。そのため約 28m ずれて建物の外の空中にあった
#     → ずれ (26.45, -8.4) を建物の向きで回した分だけ戻す（渡り廊下の口・玄関・ピロティは外観に合わせて置いたので動かさない）
#   - 交流棟のかご：エレベーターの扉を渡り廊下側（+X）の面へ移した（build_koryuto_exterior.py の SHAFT）。かごの点をその中心へ。
#     1F の点は +X の妻の入口の中（build_koryuto_exterior.py の VEST_LINK）へ。前は 1F の中の塊の中にあった
#   - 研究棟 EV B：+X の廊下に面した 1 台（Y = 1.6）をくり抜いて扉を開けた（build_kenkyuto.py の EVB_CELL）。かごの点をその中へ。
#     前は扉と扉のあいだの黒い塊の中（16, 0）にあった
#   - 研究棟ゲートの道路側：芝生の北の口から道路へ下りる線を外す（実際には階段がない）
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

# 3F↔4F の大階段（build_honbuto_interior.py の STAIR）：4F 側の点は上の端の踊り場（EV B の裏との間）、3F 側の点は下の端と教室の間の通路
#   前は 4F 側が EV B の箱の中、3F 側が教室 2303 の中にあった。座標は本部棟.blend の座標から原点のずれを引く
put("hq-4f-hall", HONBU, 44.8 - HONBU_ORIGIN[0], -9.7 - HONBU_ORIGIN[1])
put("hq-3f", HONBU, 44.8 - HONBU_ORIGIN[0], -21.95 - HONBU_ORIGIN[1])

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

# ---- 研究棟ゲートの道路側：芝生の北の口から道路へ下りる階段は実際にはない（ユーザーの確認 2026-10-29）。線を外す ----
#   芝生から道路側へは、大階段で広場へ下りて建物の外を回る。行き止まりになった点（o-120 など）は下で消える
src["edges"] = [e for e in src["edges"] if e["id"] != "o-120--research-road"]

# ---- 交流プラザ：中の点は台（0.8m）の上。玄関の扉の 1 組目（u -26.2〜-23.6、build_festival_props.py の DOOR_PAIRS）の真ん中を通る ----
#   前は中の点が高さ 0m（台の中）で、玄関の点が扉と扉の間の柱の位置にあった。外から台へ上がる線は 6 段の石の階段
KYO = KYOSHITSU
for nid, u, v, z in (("o-081", -24.9, None, None), ("o-082", -24.9, -76.2, 0.8)):
    t, c = P[KYO]["theta"], P[KYO]["center"]
    x, y = NODES[nid]["blender"][:2]
    du, dv = x - c[0], y - c[1]
    cu, cv = math.cos(t) * du + math.sin(t) * dv, -math.sin(t) * du + math.cos(t) * dv
    put(nid, KYO, u, cv if v is None else v, z)
NODES["koryu-plaza"]["blender"][2] = 0.8
for e in src["edges"]:
    if e["id"] == "o-081--o-082":
        e["kind"] = "stairs"

# ---- 教室棟 2F の交流棟側：301 の真下の位置は 2F では扉のない部屋の中なので、前の廊下へ ----
put("classroom-2f-koryu", KYOSHITSU, -26.94, -2.5)

# ---- 研究棟 1F の運河側（EV B）と教室棟側（EV A）を直接結ぶ線を外す ----
#   モデルの研究棟 1F は、曲がり角に近い西の端が部屋（01I25・01K28）と詰め物の壁で、EV A へ向かう廊下がない（案内図 6730 の
#   この辺りの廊下の形は分からない）。線が部屋と壁を抜けていたので外す。運河側からは EV B で 2F へ上がって芝生を渡るか、8F 以上で渡る
src["edges"] = [e for e in src["edges"] if e["id"] != "research-1f--research-1f-east"]

# ---- 選べる点を、エレベーターの前から少し歩いた所へ移す（ユーザーの指示 2026-10-29） ----
#   研究棟・本部棟・交流棟の各階の選べる点は、エレベーターのかごの中・扉の前にあった。その階に用がある人は
#   その階の奥まで歩くので、点の位置は reroute_walls.py が「扉の前から廊下を 20m ほど歩いた所」へ移す（印 relocate）。
#   点の id は変えない（アプリ・TRACE_B・テストがそのまま使える）。研究棟の点はかごそのものだったので、
#   かごの役目は新しい点 <id>-car に移し、元の id の点とつなぐ
for f in range(1, 15):
    for nid in (f"research-{f}f", f"research-{f}f-east"):
        car = nid + "-car"
        if car in NODES:
            continue
        n = NODES[nid]
        c = {k: v for k, v in n.items() if k not in ("selectable",)}
        c.update({"id": car, "name": n["name"] + " かごの中", "note": "エレベーターのかごの中（選べる点は reroute_walls.py がその階の奥へ移す）"})
        src["nodes"].append(c)
        NODES[car] = c
        for e in src["edges"]:
            for k in ("from", "to"):
                if e[k] == nid:
                    e[k] = car
            e["id"] = f"{e['from']}--{e['to']}"
        src["edges"].append({"id": f"{car}--{nid}", "from": car, "to": nid, "kind": "indoor"})
        n["relocate"] = True
for nid in [f"hq-{f}f" for f in (5, 7, 8, 9, 10, 11, 12, 13, 14)] + ["x2-001", "exchange-3f", "x4-013", "exchange-5f", "x6-014"]:
    NODES[nid]["relocate"] = True

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
