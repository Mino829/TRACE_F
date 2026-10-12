# 配置図（render_showcase.py の 03_配置図_真上から.png）に、建物の名前と方位を書き込む
#   python scripts/label_plan.py <画像があるフォルダ>
import json, math, os, sys
from PIL import Image, ImageDraw, ImageFont

D = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
img = Image.open(os.path.join(D, "03_配置図_真上から.png")).convert("RGB")
lab = json.load(open(os.path.join(D, "labels.json"), encoding="utf-8"))
theta = json.load(open(os.path.join(ROOT, "buildings", "配置.json"), encoding="utf-8"))["教室棟"]["theta"]
W, H = img.size
d = ImageDraw.Draw(img)
font = ImageFont.truetype("C:/Windows/Fonts/meiryob.ttc", 30)
small = ImageFont.truetype("C:/Windows/Fonts/meiryo.ttc", 24)
for k, (u, v) in lab.items():
    x, y = u * W, (1 - v) * H
    f = small if ("渡り" in k or "階段" in k or "プラザ" in k) else font
    bb = d.textbbox((x, y), k, font=f, anchor="mm")
    d.rounded_rectangle((bb[0] - 10, bb[1] - 6, bb[2] + 10, bb[3] + 6), 8, fill=(255, 255, 255), outline=(40, 40, 40), width=2)
    d.text((x, y), k, font=f, fill=(20, 20, 20), anchor="mm")
# 方位（北）。カメラは教室棟の向きに回してあるので、北は右上
cx, cy, r = W - 110, 120, 60
nx, ny = math.sin(theta), -math.cos(theta)
d.ellipse((cx - r - 10, cy - r - 10, cx + r + 10, cy + r + 10), fill=(255, 255, 255), outline=(40, 40, 40), width=2)
d.line((cx - nx * r * 0.7, cy - ny * r * 0.7, cx + nx * r * 0.7, cy + ny * r * 0.7), fill=(40, 40, 40), width=5)
d.polygon([(cx + nx * r, cy + ny * r), (cx + nx * r * 0.5 - ny * 14, cy + ny * r * 0.5 + nx * 14),
           (cx + nx * r * 0.5 + ny * 14, cy + ny * r * 0.5 - nx * 14)], fill=(200, 30, 30))
d.text((cx + nx * (r + 32), cy + ny * (r + 32)), "N", font=font, fill=(200, 30, 30), anchor="mm")
# 縮尺（50m）。正投影の幅 230m
px = W / 230 * 50
d.rectangle((60, H - 80, 60 + px, H - 66), fill=(30, 30, 30))
d.text((60 + px / 2, H - 100), "50 m", font=small, fill=(20, 20, 20), anchor="mm")
img.save(os.path.join(D, "03_配置図_真上から.png"))
print("labeled")
