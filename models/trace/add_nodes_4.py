# 4 回目：参加者が撮影場所に選べる点（selectable）を、全建物の全階と建物のつなぎ目に置く（2026-10-24、TRACE_F #41）
#   選ぶ点 = 建物 → 階の順に選ぶ（#38）。屋上は無し。各階 1 点、つなぎ目（渡り廊下）にも 1 点
#   python trace/add_nodes_4.py        … campus_graph.src.json に点・つながりを足す（何度実行しても同じ）
#   そのあと campus_graph.json を書き出す（trace_graph.export()。Blender なしでも動く）
import heapq, json, math, os

D = os.path.dirname(os.path.abspath(__file__))
P = json.load(open(os.path.join(os.path.dirname(D), "buildings", "配置.json"), encoding="utf-8"))
SRC = os.path.join(D, "campus_graph.src.json")
src = json.load(open(SRC, encoding="utf-8"))
NODES = {n["id"]: n for n in src["nodes"]}
BUILDINGS = list(P)       # 配置.json の並び = 研究棟・教室棟・交流棟・本部棟
KENKYU, KYOSHITSU, KORYU, HONBU = BUILDINGS


def W(b, x, y, z):
    t, c = P[b]["theta"], P[b]["center"]
    return [round(math.cos(t) * x - math.sin(t) * y + c[0], 2), round(math.sin(t) * x + math.cos(t) * y + c[1], 2), z]


# ---- 階の高さ（地面から）。教室棟・交流棟：5m 刻み（3F = 11m）。研究棟の 9F 以上は階高 3.9m。本部棟の 7F 以上は階高 4.4m
FZ_5 = {1: 0.0, 2: 6.0, 3: 11.0, 4: 16.0, 5: 21.0, 6: 26.0, 7: 31.0, 8: 36.0}
FZ_KENKYU = {**FZ_5, **{f: round(40.5 + 3.9 * (f - 9), 1) for f in range(9, 15)}}
FZ_HONBU = {3: 11.0, 4: 16.0, 5: 21.0, 6: 26.0, **{f: round(26.0 + 4.4 * (f - 6), 1) for f in range(7, 15)}}

KENKYU_EV = (-24.9, 0.0)          # 研究棟の EV A（南棟と北棟をつなぐ橋の位置）。1F〜14F とも同じ XY
HONBU_HALL = (41.0, -3.75)        # 本部棟 3F〜14F のエレベーターホール（build_honbuto_interior.py の EV_A と EV_B の間）
HONBU_TOWER = (44.0, -12.0)       # 本部棟 10F〜14F は高層棟だけ（ホールは y > -4.6 で高層棟の外）。壁から 0.9m 以上離れていることを確認済み
HONBU_STAIR_3F, HONBU_STAIR_4F = (44.8, -23.5), (44.8, -7.8)   # 3F↔4F の大階段の下端・上端のそば（build_honbuto_interior.py の STAIR）
HONBU_LOBBY = (46.0, -17.75)      # 本部棟の 1F ロビー（高層棟_1Fロビー）の中。2F はこの中に置く

NEW, EDGES, REMOVE_EDGES, SELECTABLE = [], [], [], {}


def node(nid, name, building, floor, pos, note="", gps=False):
    NEW.append(dict(id=nid, name=name, building=building, floor=floor, blender=pos, radius=15, gpsSnap=gps, note=note, role="waypoint"))


def pick(nid, name=None, note=None):
    """参加者が選べる点にする（既存の点でもよい）"""
    SELECTABLE[nid] = (name, note)


def edge(a, b, kind):
    EDGES.append((a, b, kind))


# ---- 屋外・屋外2F（既存の点を選べるようにする）
for nid in ("grand-stairs-bottom", "koryu-plaza", "big-tree", "research-south", "sit-lawn"):
    pick(nid)
# 大学の入口：西の道路から屋台の通路を抜けて本部棟の下へ行く直線の始まり。入口の壁（校名入り）のすぐ西
pick("o-125", "大学の入口（入口の壁・屋台の手前）", "入口の壁（build_festival_props.py の ENT）の 5m 西。屋台の 2 列の手前")
# 建物のつなぎ目（屋外）
pick("classroom-research-corner")
pick("hq-exchange-bridge")

# ---- 教室棟 1F〜7F
SX, SY = -190.32, 11.8                      # 階段室（1F〜6F とも同じ XY）
pick("classroom-entrance")
pick("k2-008", "教室棟2F エスカレーターの上り口", "2F は事務室の階。1F→2F のエスカレーターの先")
pick("classroom-3f-lobby")
pick("classroom-4f-lobby")
pick("classroom-5f-lobby")
pick("classroom-6f-bridge")
node("classroom-7f", "教室棟7F 屋上庭園", "教室棟", "7F", [SX, SY, FZ_5[7]], "階段室の真上。床 31m（屋上庭園）")
edge("k6-018", "classroom-7f", "stairs")
pick("classroom-7f")

# ---- 交流棟 1F〜6F。階段室は x2-001 / x4-013 / x6-014 の XY（-190.02, -24.83）
EX, EY = -190.02, -24.83
node("exchange-1f", "交流棟1F 体育館", "交流棟", "1F", [EX, EY, FZ_5[1]], "1F は体育館（写真なし。点だけ）。階段室の真下")
node("exchange-3f", "交流棟3F 食堂", "交流棟", "3F", [EX, EY, FZ_5[3]], "3F は食堂。階段室の高さ 11m")
node("exchange-5f", "交流棟5F", "交流棟", "5F", [EX, EY, FZ_5[5]], "階段室の高さ 21m")
REMOVE_EDGES += ["x2-001--x4-013", "x4-013--x6-014"]            # 3F・5F を飛ばしていた階段をつなぎ直す
for a, b in (("exchange-1f", "x2-001"), ("x2-001", "exchange-3f"), ("exchange-3f", "x4-013"),
             ("x4-013", "exchange-5f"), ("exchange-5f", "x6-014")):
    edge(a, b, "stairs")
edge("classroom-entrance", "exchange-1f", "indoor")             # 交流棟の入口（6648）は教室棟の入口の近く
pick("exchange-1f")
pick("x2-001", "交流棟2F 購買", "2F は購買。階段室のところに置く")
pick("exchange-3f")
pick("exchange-4f")
pick("exchange-5f")
pick("exchange-6f-hall")
# 建物のつなぎ目：教室棟〜交流棟の渡り廊下（2F・4F・6F）。交流棟側の口の点
pick("x2-006", "渡り廊下 教室棟〜交流棟 2F", "交流棟側の口")
pick("x4-024", "渡り廊下 教室棟〜交流棟 4F", "交流棟側の口")
pick("x6-021", "渡り廊下 教室棟〜交流棟 6F", "交流棟側の口")

# ---- 本部棟 1F〜14F（1F は玄関とピロティを 1 つにまとめる。2F は 5・6F と同じ作り。大階段で 3F と 4F をつなぐ）
HX, HY = HONBU_HALL
pick("hq-entrance")
node("hq-2f", "本部棟2F", "本部棟", "2F", W(HONBU, *HONBU_LOBBY, 6.0), "1F ロビーの中。2F は 5・6F と同じ作り（ユーザーの説明）")
edge("hq-entrance", "hq-2f", "indoor")
pick("hq-2f")
node("hq-3f", "本部棟3F", "本部棟", "3F", W(HONBU, *HONBU_STAIR_3F, FZ_HONBU[3]), "中央の大階段の下端（3F 側）。3F は教室（2301〜）")
edge("hq-2f", "hq-3f", "stairs")
pick("hq-3f")
for f in range(4, 15):
    z = FZ_HONBU[f]
    if f in (4, 6):                                              # 4F・6F は交流棟からの渡り廊下の口を選ぶ点にする
        hall = f"hq-{f}f-hall"
        hx, hy = HONBU_STAIR_4F if f == 4 else (HX, HY)
        node(hall, f"本部棟{f}F エレベーターホール", "本部棟", f"{f}F", W(HONBU, hx, hy, z), "渡り廊下の口とつなぐための内部の点" if f == 6 else "中央の大階段の上端（4F 側）")
        edge(f"hq-{f - 1}f" if f == 4 else "hq-5f", hall, "stairs")    # 3F→4F は中央の大階段
        edge(hall, f"hq-{f}f-bridge", "indoor")
        pick(f"hq-{f}f-bridge", f"本部棟{f}F 渡り廊下の口", "交流棟からの渡り廊下が着くところ。本部棟の{0}F の点を兼ねる".format(f))
    else:
        px, py = (HX, HY) if f <= 9 else HONBU_TOWER
        node(f"hq-{f}f", f"本部棟{f}F", "本部棟", f"{f}F", W(HONBU, px, py, z), "エレベーターホール" if f <= 9 else "高層棟の中")
        prev = {5: "hq-4f-hall", 7: "hq-6f-hall"}.get(f, f"hq-{f - 1}f")
        edge(prev, f"hq-{f}f", "stairs")
        pick(f"hq-{f}f")
REMOVE_EDGES.append("hq-4f-bridge--hq-6f-bridge")                # 4F・6F はホールの階段でつながる

# ---- 研究棟 1F〜14F（EV A の XY に積む。1〜8F の -X の端は教室棟の曲がり角なので、3〜6F は教室棟の廊下の端とつなぐ）
KX, KY = KENKYU_EV
for f in range(1, 15):
    node(f"research-{f}f", f"研究棟{f}F", "研究棟", f"{f}F", W(KENKYU, KX, KY, FZ_KENKYU[f]), "EV A の橋の位置")
    if f > 1:
        edge(f"research-{f - 1}f", f"research-{f}f", "stairs")
    pick(f"research-{f}f")
# 研究棟の 1F の入口は、教室棟座標 X=13 の面（Y -15.5〜-12.5）の黒い枠のガラス扉（案内図 6730 のエントランスホール）。教室棟と研究棟の角のすぐ外
node("research-1f-door", "研究棟1F 入口の扉（エントランスホール）", "研究棟", "1F", [-141.0, 35.99, 0.0], "教室棟座標 (13, -14)。扉のあるのは教室棟.blend の曲がり角の壁")
edge("research-1f", "research-1f-door", "indoor")
edge("research-1f-door", "classroom-research-corner", "ground")
for f, k in ((3, "k3-019"), (4, "k4-019"), (5, "k5-021")):
    edge(f"research-{f}f", k, "indoor")
# 6F の渡り廊下（教室棟 6F の脚の南東 → 研究棟南棟の東端。モデルの位置、教室棟の担当の確認 2026-10-24）
node("classroom-research-6f-mouth", "渡り廊下 教室棟〜研究棟 6F 教室棟側の口", "教室棟", "6F", [-121.0, 32.2, 26.0], "脚の南東の口。階段室の部屋をよけて y≈-30.5（教室棟座標）を通る")
node("classroom-research-6f-bridge", "渡り廊下 教室棟〜研究棟 6F", "教室棟", "6F", [-110.1, 22.0, 26.0], "6F の渡り廊下の真ん中（屋根のない通路。両側ガラス）")
node("research-6f-bridge-end", "渡り廊下 教室棟〜研究棟 6F 研究棟側の端", "研究棟", "6F", [-99.25, 11.8, 26.0], "南棟の東端（研究棟座標 (7.35, -10.9)）")
edge("k6-015", "research-6f", "indoor")                       # 教室棟 6F の廊下の先 → EV A
edge("research-6f", "classroom-research-6f-mouth", "indoor")
edge("classroom-research-6f-mouth", "classroom-research-6f-bridge", "bridge")
edge("classroom-research-6f-bridge", "research-6f-bridge-end", "bridge")
edge("research-6f-bridge-end", "research-6f", "indoor")       # 南棟の 6F の廊下を EV A へ
pick("classroom-research-6f-bridge")

# ---- 書き込み
for n in NEW:
    if n["id"] not in NODES:
        src["nodes"].append(n)
        NODES[n["id"]] = n
for nid, (name, note) in SELECTABLE.items():
    n = NODES[nid]
    n["selectable"] = True
    if name:
        n["name"] = name
    if note:
        n["note"] = note
src["edges"] = [e for e in src["edges"] if e["id"] not in REMOVE_EDGES]
have = {e["id"] for e in src["edges"]}
for a, b, k in EDGES:
    i = f"{a}--{b}"
    if i not in have:
        src["edges"].append({"id": i, "from": a, "to": b, "kind": k})
        have.add(i)
json.dump(src, open(SRC, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# ---- 検証：すべての選べる点が ShibaLab までつながっているか／つながっていない点
adj = {}
pos = {n["id"]: n["blender"] for n in src["nodes"]}
for e in src["edges"]:
    d = math.dist(pos[e["from"]], pos[e["to"]])
    adj.setdefault(e["from"], []).append((e["to"], d))
    adj.setdefault(e["to"], []).append((e["from"], d))
dist, q = {"shibalab": 0.0}, [(0.0, "shibalab")]
while q:
    d, u = heapq.heappop(q)
    if d > dist[u]:
        continue
    for v, w in adj.get(u, []):
        if d + w < dist.get(v, 1e18):
            dist[v] = d + w
            heapq.heappush(q, (d + w, v))
sel = [n["id"] for n in src["nodes"] if n.get("selectable")]
print("点", len(src["nodes"]), "線", len(src["edges"]), "選べる点", len(sel))
print("ShibaLab までつながらない選べる点:", [s for s in sel if s not in dist])
print("つながっていない点:", [n for n in pos if n not in adj])
for b in (None, "教室棟", "交流棟", "本部棟", "研究棟"):
    print(b or "屋外ほか", [(NODES[s]["floor"], s) for s in sel if NODES[s]["building"] == b])
