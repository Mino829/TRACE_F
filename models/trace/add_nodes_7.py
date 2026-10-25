# 7 回目：研究棟は 1 フロアに 2 点（教室棟側・運河側）を選べるようにする（2026-10-25、TRACE_F #42）
#   研究棟は 2F〜7F がゲートで左右に分かれる。全階（1F〜14F）に左右 1 点ずつ置く
#   - 教室棟側 = 今の EV A の点（research-<n>f）
#   - 運河側 = EV B の位置（研究棟座標 (16, 0)。1F〜14F とも床があり、まわり 0.9m に壁がないことを Blender で確認）。EV B で上下する
#   - 左右は、つながっている 1F と 8F〜14F でだけ行き来できる。2F は人工芝のデッキから両方へ。6F の教室棟からの渡り廊下は運河側に着く
#   python trace/add_nodes_4.py → 5 → 6 → 7（どれも何度実行しても同じ）
import heapq, json, math, os

D = os.path.dirname(os.path.abspath(__file__))
P = json.load(open(os.path.join(os.path.dirname(D), "buildings", "配置.json"), encoding="utf-8"))
SRC = os.path.join(D, "campus_graph.src.json")
src = json.load(open(SRC, encoding="utf-8"))
NODES = {n["id"]: n for n in src["nodes"]}
KENKYU = list(P)[0]


def W(x, y, z):
    t, c = P[KENKYU]["theta"], P[KENKYU]["center"]
    return [round(math.cos(t) * x - math.sin(t) * y + c[0], 2), round(math.sin(t) * x + math.cos(t) * y + c[1], 2), z]


FZ = {**{1: 0.0, 2: 6.0, 3: 11.0, 4: 16.0, 5: 21.0, 6: 26.0, 7: 31.0, 8: 36.0}, **{f: round(40.5 + 3.9 * (f - 9), 1) for f in range(9, 15)}}
EV_B = (16.0, 0.0)
JOINED = [1] + list(range(8, 15))          # ゲートの外：左右が同じ床でつながる階

edges, drop = [], {"research-6f-bridge-end--research-6f"}   # 6F の渡り廊下の端（運河側）は、6F では教室棟側とつながらない

for f, z in FZ.items():
    left, right = f"research-{f}f", f"research-{f}f-east"
    if right not in NODES:
        n = dict(id=right, name=f"研究棟{f}F 運河側", building="研究棟", floor=f"{f}F", blender=W(*EV_B, z), radius=15,
                 gpsSnap=False, note="EV B の位置（研究棟座標 (16, 0)）。ゲートの運河側", role="waypoint")
        src["nodes"].append(n)
        NODES[right] = n
    NODES[right].update(selectable=True, name=f"研究棟{f}F 運河側")
    NODES[left].update(selectable=True, name=f"研究棟{f}F 教室棟側")
    if f > 1:
        edges.append((f"research-{f - 1}f-east", right, "elevator"))
    if f in JOINED:
        edges.append((left, right, "indoor"))
edges += [("research-6f-bridge-end", "research-6f-east", "indoor"), ("research-gate", "research-2f-east", "indoor")]

src["edges"] = [e for e in src["edges"] if e["id"] not in drop]
have = {e["id"] for e in src["edges"]}
for a, b, k in edges:
    i = f"{a}--{b}"
    if i not in have and f"{b}--{a}" not in have:
        src["edges"].append({"id": i, "from": a, "to": b, "kind": k})
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
print("エレベーターで XY が違う線:", [e["id"] for e in src["edges"] if e["kind"] == "elevator" and math.dist(pos[e["from"]][:2], pos[e["to"]][:2]) > 0.5])
print("研究棟 2F〜7F の左右が同じ階で直接つながる線:", [e["id"] for e in src["edges"] if e["kind"] == "indoor" and {e["from"], e["to"]} & {f"research-{f}f-east" for f in range(2, 8)} and {e["from"], e["to"]} & {f"research-{f}f" for f in range(2, 8)}])
