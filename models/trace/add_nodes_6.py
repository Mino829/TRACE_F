# 6 回目：教室棟は 1 フロアに 3 点（交流棟側・エスカレーター・研究棟側）を選べるようにする（2026-10-25、TRACE_F #42）
#   - 交流棟側 = 301（ShibaLab）の XY を各階の高さに（3F は ShibaLab そのもの）。8F は教室棟の上に床がないので無し
#   - エスカレーター = 各階のエスカレーターの乗り降り口
#   - 研究棟側 = 曲がり角の帯の中（教室棟座標 (44, -6)。1F〜8F とも床があることを Blender で確認）
#   - 3 点以外の教室棟の点（入口・2F の上り口・6F の渡り廊下の口）は選べる点から外す。渡り廊下の口は交流棟・研究棟の側で選ぶ
#   python trace/add_nodes_4.py → add_nodes_5.py → add_nodes_6.py（どれも何度実行しても同じ）
import heapq, json, math, os

D = os.path.dirname(os.path.abspath(__file__))
P = json.load(open(os.path.join(os.path.dirname(D), "buildings", "配置.json"), encoding="utf-8"))
SRC = os.path.join(D, "campus_graph.src.json")
src = json.load(open(SRC, encoding="utf-8"))
NODES = {n["id"]: n for n in src["nodes"]}
KYOSHITSU = list(P)[1]


def W(x, y, z):
    t, c = P[KYOSHITSU]["theta"], P[KYOSHITSU]["center"]
    return [round(math.cos(t) * x - math.sin(t) * y + c[0], 2), round(math.sin(t) * x + math.cos(t) * y + c[1], 2), z]


FZ = {1: 0.0, 2: 6.0, 3: 11.0, 4: 16.0, 5: 21.0, 6: 26.0, 7: 31.0, 8: 36.0}
ROOM_301 = NODES["shibalab"]["blender"][:2]
KENKYU_SIDE = (44.0, -6.0)
ESCALATOR = {1: "k1-005", 2: "k1-008", 3: "classroom-3f-lobby", 4: "classroom-4f-lobby", 5: "classroom-5f-lobby", 6: "k6-019", 7: "classroom-7f", 8: "classroom-8f"}
UNSELECT = ["classroom-entrance", "k2-008", "classroom-6f-bridge"]

added, edges = [], []


def node(nid, name, floor, pos, note):
    if nid not in NODES:
        n = dict(id=nid, name=name, building="教室棟", floor=floor, blender=pos, radius=15, gpsSnap=False, note=note, role="waypoint")
        src["nodes"].append(n)
        NODES[nid] = n
    added.append(nid)


def nearest(nid):
    """The closest other node of the classroom building on the same floor, to join a new point to the network."""
    me = NODES[nid]
    same = [n for n in src["nodes"] if n["id"] != nid and n["building"] == "教室棟" and n["floor"] == me["floor"] and n["id"] not in added]
    return min(same, key=lambda n: math.dist(n["blender"], me["blender"]))["id"] if same else None


def select(nid, name, note=None):
    n = NODES[nid]
    n["selectable"] = True
    n["name"] = name
    if note:
        n["note"] = note


for f, z in FZ.items():
    label = f"{f}F"
    # 交流棟側
    if f == 3:
        select("shibalab", "教室棟3F 交流棟側（301 ShibaLab）")
    elif f != 8:
        nid = f"classroom-{f}f-koryu"
        node(nid, f"教室棟{f}F 交流棟側", label, [*ROOM_301, z], "301（ShibaLab）の真上・真下。交流棟側の端")
        select(nid, f"教室棟{f}F 交流棟側")
        edges.append((nid, nearest(nid)))
    # エスカレーター
    select(ESCALATOR[f], f"教室棟{f}F エスカレーター")
    # 研究棟側
    nid = f"classroom-{f}f-kenkyu"
    node(nid, f"教室棟{f}F 研究棟側", label, W(*KENKYU_SIDE, z), "曲がり角の帯の中（教室棟座標 (44, -6)）。研究棟の EV A へ続く")
    select(nid, f"教室棟{f}F 研究棟側")
    near = nearest(nid)
    if near:
        edges.append((nid, near))
    edges.append((nid, f"research-{f}f"))

for nid in UNSELECT:
    NODES[nid].pop("selectable", None)
# 大学の入口と大樹は 1 つの「大学入口」にまとめ、少し大学の中へ（入口から本部棟の下へ行く直線の 2 つ目の点。入口の壁と屋台の間）（2026-10-25）
for nid in ("o-125", "big-tree"):
    NODES[nid].pop("selectable", None)
select("o-126", "大学入口", "西の道路から入って約 10m。入口の壁（校名入り）と屋台の間。大樹もこの近く")
# 6F の教室棟〜研究棟の渡り廊下は、研究棟の 6F で選ぶ
NODES["classroom-research-6f-bridge"]["building"] = "研究棟"

have = {e["id"] for e in src["edges"]}
for a, b in edges:
    if b is None:
        continue
    i = f"{a}--{b}"
    if i not in have and f"{b}--{a}" not in have:
        src["edges"].append({"id": i, "from": a, "to": b, "kind": "indoor"})
        have.add(i)
json.dump(src, open(SRC, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# ---- 検証
pos = {n["id"]: n["blender"] for n in src["nodes"]}
adj = {}
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
sel = [n for n in src["nodes"] if n.get("selectable")]
print("点", len(src["nodes"]), "線", len(src["edges"]), "選べる点", len(sel))
print("ShibaLab までつながらない選べる点:", [n["id"] for n in sel if n["id"] not in dist])
for f in FZ:
    print(f"{f}F", [(n["id"], n["name"]) for n in sel if n["building"] == "教室棟" and n["floor"] == f"{f}F"])
