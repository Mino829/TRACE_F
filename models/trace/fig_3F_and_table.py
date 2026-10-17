# 説明用の図：教室棟3F（ShibaLab までの道）と、点の一覧表
#   python trace/fig_3F_and_table.py
import json, math, os
from PIL import Image, ImageDraw, ImageFont

D = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(D)
FIG = os.path.join(D, "figures")
G = json.load(open(os.path.join(D, "campus_graph.json"), encoding="utf-8"))
SRC = json.load(open(os.path.join(D, "campus_graph.src.json"), encoding="utf-8"))
P = json.load(open(os.path.join(ROOT, "buildings", "配置.json"), encoding="utf-8"))["教室棟"]
F = lambda s, b=False: ImageFont.truetype("C:/Windows/Fonts/meiryob.ttc" if b else "C:/Windows/Fonts/meiryo.ttc", s)
KC = {"ground": (26, 140, 255), "stairs": (255, 153, 26), "escalator": (230, 190, 0), "indoor": (51, 180, 77), "bridge": (190, 77, 255)}
ORDER = [n["id"] for n in SRC["nodes"] if n.get("role", "checkpoint") == "checkpoint"]   # 番号はゴールの点だけ
nodes = {n["id"]: n for n in G["nodes"]}


def local(n):
    """地図の座標 → 教室棟の座標（X = 長い辺、+Y = 道路側）"""
    x, y = n["threeD"]["x"] - P["center"][0], n["threeD"]["y"] - P["center"][1]
    t = P["theta"]
    return math.cos(t) * x + math.sin(t) * y, -math.sin(t) * x + math.cos(t) * y


# ---------- 建物の中（階ごと） ----------
# 碁盤の目の座標（u = 教室棟の長い辺、v = +が道路側）で、階ごとに点とつながりを描く
FLOORS = [("教室棟", "3F", 11.0, (-46, 42), "ShibaLab（301）がある階"), ("教室棟", "4F", 16.0, (-46, 42), "403〜408"),
          ("教室棟", "5F", 21.0, (-46, 42), "502〜511"), ("教室棟", "6F", 26.0, (-46, 42), "交流棟の大講義室への渡り廊下"),
          ("交流棟", "4F", 16.0, (-122, -40), "401・402"), ("交流棟", "6F", 26.0, (-122, -40), "大講義室")]
BOX = {"教室棟": (-42.05, 42.05, -11.75, 11.75), "交流棟": (-122.1, -55.7, -23.5, 0.2)}
grid = {n["id"]: local(n) for n in G["nodes"]}
S, PADX, PH = 11, 40, 440                      # 1m = 11px、1 段の高さ
Wd = int(88 * S + 2 * PADX) * 2 + 40
img = Image.new("RGB", (Wd, 110 + PH * 3), (250, 250, 248))
d = ImageDraw.Draw(img)
d.text((PADX, 28), "建物の中の点とつながり（階ごと）", font=F(34, True), fill=(20, 20, 20))
d.text((PADX, 74), "上 = 道路側（北西）。大きい番号 = ゴールの点、小さい丸 = 道の点（6m おき）、四角 = 教室の点。色は線の種類（配置図と同じ）",
       font=F(18), fill=(90, 90, 90))
for k, (b, fl, z, (u0, u1), memo) in enumerate(FLOORS):
    col, row = (0, k) if b == "教室棟" and k < 3 else (1, k - 3)
    ox, oy = PADX + col * (int(88 * S + 2 * PADX) + 40), 110 + row * PH
    X = lambda u: ox + (u - u0) * S
    bu0, bu1, bv0, bv1 = BOX[b]
    Y = lambda v: oy + 70 + (bv1 + 4 - v) * S
    d.text((ox, oy + 14), f"{b} {fl}（床 {z:g}m）", font=F(24, True), fill=(20, 20, 20))
    d.text((ox + 260, oy + 18), memo, font=F(18), fill=(90, 90, 90))
    d.rectangle((X(bu0), Y(bv1), X(bu1), Y(bv0)), fill=(238, 238, 236), outline=(60, 60, 60), width=3)
    on = {i for i, n in nodes.items() if abs(n["heightMetres"] - z) < 0.5 and n["building"]
          and u0 - 2 <= grid[i][0] <= u1 + 2 and bv0 - 4 <= grid[i][1] <= bv1 + 4}
    for e in G["edges"]:
        if e["from"] in on and e["to"] in on:
            (a0, b0), (a1, b1) = grid[e["from"]], grid[e["to"]]
            d.line((X(a0), Y(b0), X(a1), Y(b1)), fill=KC[e["kind"]], width=5)
        elif e["from"] in on or e["to"] in on:          # ほかの階・ほかの建物へ（エスカレーター・階段・渡り廊下）
            i, j = (e["from"], e["to"]) if e["from"] in on else (e["to"], e["from"])
            (a0, b0) = grid[i]
            other = nodes[j]
            t = "↑" if other["heightMetres"] > z else ("↓" if other["heightMetres"] < z else "→")
            d.text((X(a0) + 8, Y(b0) + 10), t + (other["building"] or "外") + other["floor"], font=F(14), fill=KC[e["kind"]])
    for i in on:
        n = nodes[i]
        x, y = X(grid[i][0]), Y(grid[i][1])
        if n["role"] == "checkpoint":
            d.ellipse((x - 13, y - 13, x + 13, y + 13), fill=(40, 140, 60), outline=(255, 255, 255), width=2)
            d.text((x, y), str(ORDER.index(i) + 1), font=F(16, True), fill=(255, 255, 255), anchor="mm")
        elif n["role"] == "room":
            d.rectangle((x - 7, y - 7, x + 7, y + 7), fill=(40, 140, 60))
            d.text((x, y - 12), n["name"].split(" ")[-1], font=F(15, True), fill=(30, 30, 30), anchor="mb")
        else:
            d.ellipse((x - 4, y - 4, x + 4, y + 4), fill=(40, 140, 60))
    sy = Y(bv0) + 34
    d.line((X(u1) - 10 * S - 50, sy, X(u1) - 50, sy), fill=(30, 30, 30), width=4)
    d.text((X(u1) - 42, sy), "10 m", font=F(16), fill=(30, 30, 30), anchor="lm")
img.save(os.path.join(FIG, "03_建物の中_階ごと.png"))

# ---------- 点の一覧表 ----------
cols = [("#", 50), ("名前", 430), ("階", 80), ("高さ", 80), ("緯度", 150), ("経度", 160), ("east", 100), ("north", 100), ("GPS", 70), ("メモ", 560)]
rh, top = 46, 120
Wt = sum(w for _, w in cols) + 60
img = Image.new("RGB", (Wt, top + rh * (len(ORDER) + 1) + 200), (250, 250, 248))
d = ImageDraw.Draw(img)
d.text((30, 28), "TRACE ゴールの点の一覧（campus_graph.json）", font=F(34, True), fill=(20, 20, 20))
d.text((30, 76), f'{G["campusGraphVersion"]} ／ 座標 {G["coordinateVersion"]} ／ east・north = アプリの原点（①）からのメートル', font=F(20), fill=(90, 90, 90))
x = 30
for name, w in cols:
    d.rectangle((x, top, x + w, top + rh), fill=(60, 60, 70))
    d.text((x + 10, top + rh / 2), name, font=F(20, True), fill=(255, 255, 255), anchor="lm")
    x += w
for r, nid in enumerate(ORDER):
    n = nodes[nid]
    y = top + rh * (r + 1)
    row = [str(r + 1), n["name"], n["floor"], f'{n["heightMetres"]:g}m', f'{n["lat"]:.6f}', f'{n["lon"]:.6f}',
           f'{n["local"]["east"]:.1f}', f'{n["local"]["north"]:.1f}', "○" if n["gpsSnap"] else "—", n["note"]]
    x = 30
    for (name, w), v in zip(cols, row):
        d.rectangle((x, y, x + w, y + rh), fill=(255, 255, 255) if r % 2 else (242, 244, 247), outline=(220, 220, 220))
        f = F(18)
        while d.textlength(v, font=f) > w - 16 and len(v) > 2:
            v = v[:-2] + "…"
        d.text((x + 8, y + rh / 2), v, font=f, fill=(25, 25, 25), anchor="lm")
        x += w
y = top + rh * (len(ORDER) + 1) + 30
kinds = {}
for e in G["edges"]:
    kinds[e["kind"]] = kinds.get(e["kind"], 0) + 1
roles = {}
for n in G["nodes"]:
    roles[n["role"]] = roles.get(n["role"], 0) + 1
d.text((30, y - 2), f'点 {len(G["nodes"])} か所：ゴール {roles.get("checkpoint", 0)}・教室 {roles.get("room", 0)}・道の点 {roles.get("waypoint", 0)}（この表はゴールの点だけ）',
       font=F(22, True), fill=(30, 30, 30))
y += 40
d.text((30, y), f'つながり {len(G["edges"])} 本：' + "・".join(f'{G["edgeKinds"][k]} {v}' for k, v in kinds.items()), font=F(22, True), fill=(30, 30, 30))
d.text((30, y + 44), "GPS ○ = 位置をこの点にまとめてよい点。— = 建物の上の階の点（GPS では階を見分けられないので演出だけに使う）", font=F(20), fill=(70, 70, 70))
d.text((30, y + 84), "要確認：⑩本部棟 玄関・⑪ピロティ・⑯大樹の位置、⑤研究棟 道路側の口の高さ、道が実際に通れるか", font=F(20), fill=(180, 30, 30))
img.save(os.path.join(FIG, "07_チェックポイント一覧.png"))
print("ok")
