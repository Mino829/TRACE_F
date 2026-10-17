# render_graph_plan.py の配置図に、点の番号・名前・方位・縮尺を書き込む
#   python trace/label_graph_plan.py
import json, math, os
from PIL import Image, ImageDraw, ImageFont

D = os.path.dirname(os.path.abspath(__file__))
img = Image.open(os.path.join(D, "campus_graph_plan.png")).convert("RGB")
lab = json.load(open(os.path.join(D, "campus_graph_plan.labels.json"), encoding="utf-8"))
src = json.load(open(os.path.join(D, "campus_graph.src.json"), encoding="utf-8"))
order = [n["id"] for n in src["nodes"]]
W, H = img.size
d = ImageDraw.Draw(img)
font = ImageFont.truetype("C:/Windows/Fonts/meiryob.ttc", 22)
num = ImageFont.truetype("C:/Windows/Fonts/meiryob.ttc", 20)
# 線（屋根の下の 3F の線も見えるように、図の上に描き直す）
KC = {"ground": (26, 140, 255), "stairs": (255, 153, 26), "escalator": (255, 217, 26), "indoor": (51, 204, 77), "bridge": (190, 77, 255)}
for e in src["edges"]:
    (u0, v0), (u1, v1) = lab["labels"][e["from"]][1], lab["labels"][e["to"]][1]
    d.line((u0 * W, (1 - v0) * H, u1 * W, (1 - v1) * H), fill=KC[e["kind"]], width=6)
for i, nid in enumerate(order, 1):
    name, (u, v) = lab["labels"][nid]
    x, y = u * W, (1 - v) * H
    snap = next(n for n in src["nodes"] if n["id"] == nid).get("gpsSnap", True)
    d.ellipse((x - 15, y - 15, x + 15, y + 15), fill=(200, 30, 30) if snap else (40, 140, 60), outline=(255, 255, 255), width=2)
    d.text((x, y), str(i), font=num, fill=(255, 255, 255), anchor="mm")
    bb = d.textbbox((x + 22, y), name, font=font, anchor="lm")
    d.rounded_rectangle((bb[0] - 6, bb[1] - 4, bb[2] + 6, bb[3] + 4), 6, fill=(255, 255, 255), outline=(60, 60, 60))
    d.text((x + 22, y), name, font=font, fill=(20, 20, 20), anchor="lm")
# 線の色の凡例
leg = [("地上の道", (26, 140, 255)), ("階段", (255, 153, 26)), ("エスカレーター", (255, 217, 26)), ("建物の中", (51, 204, 77))]
for i, (t, c) in enumerate(leg):
    y = 40 + i * 34
    d.rectangle((30, y - 4, 80, y + 4), fill=c)
    d.text((92, y), t, font=font, fill=(20, 20, 20), anchor="lm")
# 方位
(nu, nv), (cu, cv) = lab["north"]
nx, ny = (nu - cu) * W, -(nv - cv) * H
l = math.hypot(nx, ny)
nx, ny = nx / l, ny / l
cx, cy, r = W - 90, 90, 50
d.ellipse((cx - r - 8, cy - r - 8, cx + r + 8, cy + r + 8), fill=(255, 255, 255), outline=(40, 40, 40), width=2)
d.line((cx - nx * r * 0.7, cy - ny * r * 0.7, cx + nx * r * 0.7, cy + ny * r * 0.7), fill=(40, 40, 40), width=4)
d.text((cx + nx * (r + 24), cy + ny * (r + 24)), "N", font=font, fill=(200, 30, 30), anchor="mm")
# 縮尺 50m と、点のまわりの輪 = まとめる範囲（半径 15m）
px = 50 / lab["metresPerPx"]
d.rectangle((30, H - 50, 30 + px, H - 38), fill=(30, 30, 30))
d.text((30, H - 66), "50 m（輪 = 半径15m／緑の番号 = 3F・GPS では使わない）", font=font, fill=(20, 20, 20), anchor="lm")
img.save(os.path.join(D, "campus_graph_plan.png"))
print("labeled")
