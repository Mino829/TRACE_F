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
ORDER = [n["id"] for n in SRC["nodes"]]


def local(n):
    """地図の座標 → 教室棟の座標（X = 長い辺、+Y = 道路側）"""
    x, y = n["threeD"]["x"] - P["center"][0], n["threeD"]["y"] - P["center"][1]
    t = P["theta"]
    return math.cos(t) * x + math.sin(t) * y, -math.sin(t) * x + math.cos(t) * y


# ---------- 教室棟3F ----------
# 寸法は scripts/build_kyoshitsu_interior.py と同じ
L2, YN, YS, YCW, YCOR, U, RX0 = 42.05, 11.45, -11.45, -0.6, -3.9, 2.9, -34.8
S, OX, OY = 20, 80, 120                       # 1m = 20px、余白
Wd, Hd = int(2 * L2 * S + 2 * OX), int(2 * 11.75 * S + OY + 330)
img = Image.new("RGB", (Wd, Hd), (250, 250, 248))
d = ImageDraw.Draw(img)
X = lambda x: OX + (x + L2) * S
Y = lambda y: OY + (11.75 - y) * S
d.text((OX, 30), "教室棟 3F（床 11m）— ShibaLab（301）までの道", font=F(34, True), fill=(20, 20, 20))
d.text((OX, 78), "上 = 道路側（北西）／左 = 交流棟側。寸法は内装スクリプト（build_kyoshitsu_interior.py）の値", font=F(20), fill=(90, 90, 90))
d.rectangle((X(-L2), Y(11.75), X(L2), Y(-11.75)), outline=(40, 40, 40), width=4)
# 教室（道路側）
x = RX0
for name, w in [("301", 5 * U), ("302", 5 * U), ("303", 5 * U), ("304", 5 * U), ("305", 4 * U)]:
    hi = name == "301"
    d.rectangle((X(x), Y(YN), X(x + w), Y(YCW)), fill=(255, 225, 225) if hi else (235, 235, 235), outline=(120, 120, 120), width=2)
    d.text(((X(x) + X(x + w)) / 2, Y(8.5)), name, font=F(30, True), fill=(180, 30, 30) if hi else (60, 60, 60), anchor="mm")
    x += w
d.text(((X(RX0) + X(RX0 + 5 * U)) / 2, Y(2.6)), "ShibaLab の展示", font=F(20, True), fill=(180, 30, 30), anchor="mm")
# 階段（両端）・廊下・吹き抜け・グローバルラーニングコモンズ
for x0, x1 in ((-L2, RX0), (RX0 + 24 * U, L2)):
    d.rectangle((X(x0), Y(YN), X(x1), Y(YCW)), fill=(255, 240, 215), outline=(120, 120, 120), width=2)
    d.text(((X(x0) + X(x1)) / 2, Y(5.4)), "階段", font=F(20), fill=(150, 90, 20), anchor="mm")
d.rectangle((X(-L2), Y(YCW), X(L2), Y(YCOR)), fill=(250, 250, 248))
d.text((X(30), Y(-2.25)), "廊下", font=F(20), fill=(110, 110, 110), anchor="mm")
d.rectangle((X(-L2), Y(YCOR), X(-23.2), Y(YS)), fill=(225, 235, 245), outline=(120, 120, 120), width=2)
d.text(((X(-L2) + X(-23.2)) / 2, Y(-7.7)), "Global Learning\nCommons", font=F(19), fill=(60, 80, 110), anchor="mm", align="center")
d.rectangle((X(-23.2), Y(YCOR - 0.3), X(26.1), Y(YS)), fill=(232, 232, 232), outline=(150, 150, 150), width=2)
d.text((X(20), Y(-9.5)), "吹き抜け（ロビー）", font=F(20), fill=(110, 110, 110), anchor="mm")
for x0, x1, t in ((-10.9, 0.18, "2F→3F"), (2.68, 13.74, "3F→4F")):
    d.rectangle((X(x0), Y(-4.3), X(x1), Y(-7.0)), fill=(255, 245, 190), outline=(200, 160, 0), width=2)
    d.text(((X(x0) + X(x1)) / 2, Y(-8.0)), "エスカレーター " + t, font=F(16), fill=(120, 90, 0), anchor="mm")
# 点とつながり
nodes = {n["id"]: n for n in G["nodes"]}
show = ["classroom-entrance", "classroom-3f-lobby", "shibalab"]
for e in G["edges"]:
    if e["from"] in show and e["to"] in show:
        (x0, y0), (x1, y1) = local(nodes[e["from"]]), local(nodes[e["to"]])
        if e["kind"] == "stairs":          # 端の階段を通る（見た目のための折れ線）
            pts = [(x0, y0), (-38.5, 0.2), (-38.5, 3), (x1, y1)]
        elif e["kind"] == "escalator":
            pts = [(x0, y0), (-39.5, y0), (-39.5, -3.3), (-12.5, -3.3), (-10.9, -5.65), (x1, y1)]
        else:
            pts = [(x0, y0), (x0, -1.5), (x1, -1.5), (x1, y1)]
        d.line([(X(a), Y(b)) for a, b in pts], fill=KC[e["kind"]], width=7, joint="curve")
for nid in show:
    x, y = local(nodes[nid])
    i = ORDER.index(nid) + 1
    snap = nodes[nid]["gpsSnap"]
    c = (200, 30, 30) if snap else (40, 140, 60)
    d.ellipse((X(x) - 18, Y(y) - 18, X(x) + 18, Y(y) + 18), fill=c, outline=(255, 255, 255), width=3)
    d.text((X(x), Y(y)), str(i), font=F(20, True), fill=(255, 255, 255), anchor="mm")
# 凡例と説明
ly = Y(-11.75) + 40
items = [((200, 30, 30), "①入口（1F・アプリの原点）"), ((40, 140, 60), "⑭3Fロビー・⑮ShibaLab（GPS では使わない＝演出だけ）")]
for i, (c, t) in enumerate(items):
    d.ellipse((OX, ly + i * 40 - 12, OX + 24, ly + i * 40 + 12), fill=c)
    d.text((OX + 36, ly + i * 40), t, font=F(22), fill=(30, 30, 30), anchor="lm")
for i, (k, t) in enumerate((("escalator", "エスカレーター：①→1F→2F→⑭（2台乗り継ぐ）"), ("indoor", "廊下：⑭→⑮"), ("stairs", "階段：①→交流棟側の端の階段→⑮"))):
    yy = ly + 100 + i * 40
    d.line((OX, yy, OX + 50, yy), fill=KC[k], width=7)
    d.text((OX + 64, yy), t, font=F(22), fill=(30, 30, 30), anchor="lm")
d.text((Wd - OX, ly), "1F の入口 ① は 3F の真下の位置に描いている", font=F(20), fill=(90, 90, 90), anchor="rm")
d.line((Wd - OX - 10 * S, ly + 60, Wd - OX, ly + 60), fill=(30, 30, 30), width=6)
d.text((Wd - OX - 5 * S, ly + 85), "10 m", font=F(20), fill=(30, 30, 30), anchor="mm")
img.save(os.path.join(FIG, "03_教室棟3F_ShibaLabまで.png"))

# ---------- 点の一覧表 ----------
cols = [("#", 50), ("名前", 430), ("階", 80), ("高さ", 80), ("緯度", 150), ("経度", 160), ("east", 100), ("north", 100), ("GPS", 70), ("メモ", 560)]
rh, top = 46, 120
Wt = sum(w for _, w in cols) + 60
img = Image.new("RGB", (Wt, top + rh * (len(G["nodes"]) + 1) + 160), (250, 250, 248))
d = ImageDraw.Draw(img)
d.text((30, 28), "TRACE チェックポイント一覧（campus_graph.json）", font=F(34, True), fill=(20, 20, 20))
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
d.text((30, y), f'つながり {len(G["edges"])} 本：' + "・".join(f'{G["edgeKinds"][k]} {v}' for k, v in kinds.items()), font=F(22, True), fill=(30, 30, 30))
d.text((30, y + 44), "GPS ○ = 位置をこの点にまとめてよい点（半径 15m、点どうしは 30m 以上離す）。— = 上の階など、演出だけに使う点", font=F(20), fill=(70, 70, 70))
d.text((30, y + 84), "要確認：⑩本部棟 玄関・⑪ピロティ・⑯大樹の位置、⑤研究棟 道路側の口の高さ、線が実際に通れる道か", font=F(20), fill=(180, 30, 30))
img.save(os.path.join(FIG, "07_チェックポイント一覧.png"))
print("ok")
