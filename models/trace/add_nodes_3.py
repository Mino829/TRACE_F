# 3 回目：建物の中の点を足す（研究棟は除く。ユーザーの指示）。外は 16 か所のまま
#   芝浦祭（第54回）の会場の階：教室棟 3F〜6F・交流棟 4F（401・402）・6F（大講義室）。本部棟は渡り廊下の 4F・6F
#   python trace/add_nodes_3.py
import itertools, json, math, os

D = os.path.dirname(os.path.abspath(__file__))
P = json.load(open(os.path.join(os.path.dirname(D), "buildings", "配置.json"), encoding="utf-8"))
SRC = os.path.join(D, "campus_graph.src.json")
src = json.load(open(SRC, encoding="utf-8"))


def W(b, x, y, z):
    t, c = P[b]["theta"], P[b]["center"]
    return [round(math.cos(t) * x - math.sin(t) * y + c[0], 2), round(math.sin(t) * x + math.cos(t) * y + c[1], 2), z]


# 座標は各建物のスクリプトの値（教室棟：build_kyoshitsu_interior.py、交流棟：build_koryuto_*.py）
# 本部棟の渡り廊下の端は、キャンパス全体.blend の「本部棟_渡り廊下」の範囲から
NEW = [
    ("classroom-4f-lobby", "教室棟4F ロビー（403〜408）", "教室棟", "4F", W("教室棟", 16.6, -5.6, 16.0),
     "3F→4F のエスカレーターを上がったところ。床 16m"),
    ("classroom-5f-lobby", "教室棟5F ロビー（502〜511）", "教室棟", "5F", W("教室棟", 25.0, -5.6, 21.0),
     "4F→5F のエスカレーターを上がったところ。床 21m"),
    ("classroom-6f-bridge", "教室棟6F 渡り廊下の口（大講義室へ）", "教室棟", "6F", W("教室棟", -40.0, -2.5, 26.0),
     "交流棟側の端。芝浦祭のフロアマップでは 6F から交流棟の大講義室へ行く。床 26m"),
    ("exchange-4f", "交流棟4F 401・402", "交流棟", "4F", W("交流棟", 3.2, -8.2, 16.0),
     "廊下（本部棟側）の 401 と 402 の間。床 16m"),
    ("exchange-6f-hall", "交流棟6F 大講義室", "交流棟", "6F", W("交流棟", 0.0, 3.0, 26.0),
     "大講義室の真ん中。床 26m"),
    ("hq-4f-bridge", "本部棟4F 渡り廊下の口", "本部棟", "4F", [-172.5, -51.5, 16.0],
     "交流棟からの渡り廊下（下のデッキ）が本部棟に着くところ。床 16m"),
    ("hq-6f-bridge", "本部棟6F 渡り廊下の口", "本部棟", "6F", [-172.5, -51.5, 26.0],
     "交流棟からの渡り廊下（屋根付き）が本部棟に着くところ。床 26m"),
]
ids = [n["id"] for n in src["nodes"]]
for nid, name, b, f, p, note in NEW:
    if nid not in ids:
        src["nodes"].append(dict(id=nid, name=name, building=b, floor=f, blender=p, radius=15, gpsSnap=False, note=note))
ADD = [("classroom-3f-lobby", "classroom-4f-lobby", "escalator"), ("classroom-4f-lobby", "classroom-5f-lobby", "escalator"),
       ("classroom-5f-lobby", "classroom-6f-bridge", "escalator"),
       ("classroom-4f-lobby", "exchange-4f", "bridge"), ("classroom-6f-bridge", "exchange-6f-hall", "bridge"),
       ("classroom-entrance", "exchange-4f", "indoor"), ("exchange-4f", "exchange-6f-hall", "stairs"),
       ("exchange-4f", "hq-4f-bridge", "bridge"), ("exchange-6f-hall", "hq-6f-bridge", "bridge"),
       ("hq-4f-bridge", "hq-6f-bridge", "stairs"), ("hq-4f-bridge", "hq-entrance", "indoor")]
have = {e["id"] for e in src["edges"]}
for a, b, k in ADD:
    i = f"{a}--{b}"
    if i not in have:
        src["edges"].append({"id": i, "from": a, "to": b, "kind": k})
json.dump(src, open(SRC, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

pos = {n["id"]: n["blender"] for n in src["nodes"]}
snap = [n["id"] for n in src["nodes"] if n.get("gpsSnap", True)]
print("点", len(pos), "（GPS で使う", len(snap), "／中の点", len(pos) - len(snap), "）／線", len(src["edges"]))
print("GPS の点で 30m 未満:", [(a, b) for a, b in itertools.combinations(snap, 2) if math.dist(pos[a][:2], pos[b][:2]) < 30])
used = {e["from"] for e in src["edges"]} | {e["to"] for e in src["edges"]}
print("つながっていない点:", [n for n in pos if n not in used])
