# 5 回目：建物の中の階の移動を「エレベーター（elevator）かエスカレーター」だけにする（2026-10-24、TRACE_F #38）
#   - 建物の中の階段の線は消す（大階段 3F↔4F と、屋外の大階段・ゲートの下りだけ残す）
#   - エレベーターは同じ XY に点を積む（かごは真上に動くだけ。展示では向きを変えない）
#   - 研究棟 2F・人工芝のデッキ・教室棟 2F の高さを教室棟 2F の 6.0m にそろえる（教室棟の階の高さが全体の基準）
#   - 教室棟 6F→7F→8F をエスカレーターでつなぐ。8F 以上は教室棟と研究棟でつながる
#   python trace/add_nodes_4.py → python trace/add_nodes_5.py（どちらも何度実行しても同じ）
import heapq, json, math, os

D = os.path.dirname(os.path.abspath(__file__))
P = json.load(open(os.path.join(os.path.dirname(D), "buildings", "配置.json"), encoding="utf-8"))
SRC = os.path.join(D, "campus_graph.src.json")
src = json.load(open(SRC, encoding="utf-8"))
NODES = {n["id"]: n for n in src["nodes"]}
KENKYU, KYOSHITSU, KORYU, HONBU = list(P)


def W(b, x, y, z):
    t, c = P[b]["theta"], P[b]["center"]
    return [round(math.cos(t) * x - math.sin(t) * y + c[0], 2), round(math.sin(t) * x + math.cos(t) * y + c[1], 2), z]


DECK_OLD, DECK = 8.1, 6.0
HQ_EV = (41.0, -5.6)               # 本部棟のエレベーターのかご（3F〜14F とも床がある。2F は床を足す）
HQ_Z = {1: 0.0, 2: 6.0, 3: 11.0, 4: 16.0, 5: 21.0, 6: 26.0, **{f: round(26.0 + 4.4 * (f - 6), 1) for f in range(7, 15)}}

NEW, ADD, DROP = [], [], set()


def node(nid, name, building, floor, pos, note="", role="waypoint"):
    NEW.append(dict(id=nid, name=name, building=building, floor=floor, blender=pos, radius=15, gpsSnap=False, note=note, role=role))


def edge(a, b, kind):
    ADD.append((a, b, kind))


# ---- 1. 高さ：人工芝のデッキ（大階段の上〜研究棟ゲート）を 8.1m → 6.0m
for n in src["nodes"]:
    if n["blender"][2] == DECK_OLD:
        n["blender"][2] = DECK
        if n["id"] in ("sit-lawn", "research-gate"):
            n["note"] = "デッキ（人工芝）の床 6.0m。教室棟 2F・研究棟 2F と同じ高さ"
for nid, z in (("o-112", 2.0), ("o-113", 4.0)):                  # 大階段の途中の点（0 → 6.0 を 3 等分）
    NODES[nid]["blender"][2] = z

# ---- 2. 階段 → エレベーター（建物の中。大階段 3F↔4F だけ階段のまま）
KEEP_STAIRS = {"o-111--o-112", "o-112--o-113", "o-113--o-114", "o-120--research-road", "hq-3f--hq-4f-hall"}
for e in src["edges"]:
    if e["kind"] == "stairs" and e["id"] not in KEEP_STAIRS:
        a, b = NODES[e["from"]], NODES[e["to"]]
        if a["blender"][:2] == b["blender"][:2] or "hq" in e["id"] or "classroom" in e["id"] or e["id"].startswith("k"):
            e["kind"] = "elevator"
# 教室棟の階段室の階段と、7F の階段は無くす（エスカレーターとエレベーターで行き来する）
DROP |= {"k6-015--classroom-research-6f-bridge", "classroom-research-6f-bridge--research-6f", "k1-006--k2-010", "k2-010--k3-034", "k3-034--k4-036", "k4-036--k5-043", "k5-043--k6-018", "k6-018--classroom-7f"}
# 本部棟：エレベーターの点を積み直す。大階段（3F↔4F）はそのまま
for e in src["edges"]:
    if e["id"].startswith("hq-") and e["kind"] == "elevator" and e["id"] != "hq-3f--hq-4f-hall":
        DROP.add(e["id"])
DROP |= {"hq-entrance--hq-2f", "hq-2f--hq-3f"}
for f in (1, 2, 3, 4):
    node(f"hq-{f}f-ev", f"本部棟{f}F エレベーター", "本部棟", f"{f}F", W(HONBU, *HQ_EV, HQ_Z[f]), "エレベーターのかご（同じ XY に積む）")
for f in (5, 6) + tuple(range(7, 15)):                           # 既存の点をかごの XY へ
    nid = "hq-6f-hall" if f == 6 else f"hq-{f}f"
    NODES[nid]["blender"] = W(HONBU, *HQ_EV, HQ_Z[f])
    if f in (6,):
        NODES[nid]["name"] = "本部棟6F エレベーター"
chain = ["hq-1f-ev", "hq-2f-ev", "hq-3f-ev", "hq-4f-ev", "hq-5f", "hq-6f-hall"] + [f"hq-{f}f" for f in range(7, 15)]
# かごの中（本部棟座標 (41.0, -7.65)。扉の 0.7m 奥）に点を積み、エレベーターで乗っている間はかごの中を通す。扉の前の点とは indoor でつなぐ
HQ_CAR = (41.0, -7.65)
for a, b in zip(chain, chain[1:]):
    DROP.add(f"{a}--{b}")
for f, front in enumerate(chain, start=1):
    node(f"hq-{f}f-car", f"本部棟{f}F かごの中", "本部棟", f"{f}F", W(HONBU, *HQ_CAR, HQ_Z[f]), "エレベーターのかごの中（EV B の中央の区画）")
    edge(f"hq-{f}f-car", front, "indoor")
    if f > 1:
        edge(f"hq-{f - 1}f-car", f"hq-{f}f-car", "elevator")
edge("hq-1f-ev", "hq-entrance", "ground")                         # 1F はピロティ（屋外）
edge("hq-2f-ev", "hq-2f", "indoor")
edge("hq-3f-ev", "hq-3f", "indoor")
edge("hq-4f-ev", "hq-4f-hall", "indoor")

# ---- 2b. 交流棟：かごの中（交流棟座標 (22.04, -6.05)。扉の前の点とは indoor でつなぐ）にエレベーターの点を積む
KORYU_CAR = (22.04, -6.05)
KORYU_FRONT = ["exchange-1f", "x2-001", "exchange-3f", "x4-013", "exchange-5f", "x6-014"]
KORYU_Z = [0.0, 6.0, 11.0, 16.0, 21.0, 26.0]
for a, b in zip(KORYU_FRONT, KORYU_FRONT[1:]):
    DROP.add(f"{a}--{b}")
for f, (front, z) in enumerate(zip(KORYU_FRONT, KORYU_Z), start=1):
    node(f"exchange-{f}f-car", f"交流棟{f}F かごの中", "交流棟", f"{f}F", W(KORYU, *KORYU_CAR, z), "エレベーターのかごの中")
    edge(f"exchange-{f}f-car", front, "indoor")
    if f > 1:
        edge(f"exchange-{f - 1}f-car", f"exchange-{f}f-car", "elevator")

# ---- 3. 教室棟：エスカレーターで 6F→7F→8F。7F の点を階段室から、エスカレーターの上に移す
ESC_BOTTOM6 = [(-143.29, 45.83), (-142.74, 46.41)]               # 5F→6F の乗り口の真上（同じ XY）
ESC_TOP7 = (-135.14, 54.5)
node("k6-020", "教室棟6F 乗り口（6F→7F） 1", "教室棟", "6F", [*ESC_BOTTOM6[0], 26.0])
node("k6-021", "教室棟6F 乗り口（6F→7F） 2", "教室棟", "6F", [*ESC_BOTTOM6[1], 26.0])
edge("k6-012", "k6-020", "indoor")
edge("k6-020", "k6-021", "indoor")
NODES["classroom-7f"]["blender"] = [*ESC_TOP7, 31.0]
NODES["classroom-7f"]["note"] = "6F→7F のエスカレーターを上がったところ（屋上庭園）。床 31m"
edge("k6-021", "classroom-7f", "escalator")
ESC8_BOT, ESC8_TOP = (-129.55, 60.51), (-121.48, 52.95)           # 7F→8F：モデルの位置（教室棟の担当の確認 2026-10-24）
node("classroom-7f-e8", "教室棟7F 乗り口（7F→8F）", "教室棟", "7F", [*ESC8_BOT, 31.0])
node("classroom-8f", "教室棟8F 降り口（研究棟8Fへ）", "教室棟", "8F", [*ESC8_TOP, 36.0])
edge("classroom-7f", "classroom-7f-e8", "indoor")
edge("classroom-7f-e8", "classroom-8f", "escalator")
edge("classroom-8f", "research-8f", "indoor")                    # 8F 以上は教室棟と研究棟でつながる（EV A で 14F まで）

# ---- 4. 研究棟のエレベーター（EV A）へ、教室棟の各階から。2F は人工芝のデッキともつながる
edge("research-2f", "research-gate", "indoor")                    # デッキ（人工芝）の床 = 2F
edge("research-2f", "k2-008", "indoor")                           # 教室棟 2F の廊下の先（点が足りない所。未作図）

# ---- 書き込み
for n in NEW:
    if n["id"] not in NODES:
        src["nodes"].append(n)
        NODES[n["id"]] = n
src["edges"] = [e for e in src["edges"] if e["id"] not in DROP]
have = {e["id"] for e in src["edges"]}
for a, b, k in ADD:
    i = f"{a}--{b}"
    if i not in have:
        src["edges"].append({"id": i, "from": a, "to": b, "kind": k})
        have.add(i)
    else:
        next(e for e in src["edges"] if e["id"] == i)["kind"] = k
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
sel = [n["id"] for n in src["nodes"] if n.get("selectable")]
print("点", len(src["nodes"]), "線", len(src["edges"]), "選べる点", len(sel))
print("ShibaLab までつながらない選べる点:", [s for s in sel if s not in dist])
print("つながっていない点:", [n for n in pos if n not in adj], "／ShibaLab から行けない点:", [n for n in pos if n not in dist][:20])
kinds = {}
for e in src["edges"]:
    kinds[e["kind"]] = kinds.get(e["kind"], 0) + 1
print("線の種類", kinds)
print("エレベーターで XY が違う線:", [e["id"] for e in src["edges"] if e["kind"] == "elevator" and math.dist(pos[e["from"]][:2], pos[e["to"]][:2]) > 0.5])
print("階をまたぐのに elevator/escalator/stairs でない線:", [e["id"] for e in src["edges"] if e["kind"] in ("indoor", "ground", "bridge") and abs(pos[e["from"]][2] - pos[e["to"]][2]) > 1.0])
print("建物の中の階段の線:", [e["id"] for e in src["edges"] if e["kind"] == "stairs"])
