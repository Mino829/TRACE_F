# render_figures.render_checks() で撮った「建物（半透明）」と「道の網」を重ねて、見出し・凡例・階の線を書く
#   python trace/check_overlay.py   → figures/09〜13
import glob, json, os
from PIL import Image, ImageDraw, ImageFont

FIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "figures")
F = lambda s, b=False: ImageFont.truetype("C:/Windows/Fonts/meiryob.ttc" if b else "C:/Windows/Fonts/meiryo.ttc", s)
LEG = [("地上の道", (26, 140, 255)), ("階段", (255, 153, 26)), ("エスカレーター", (255, 217, 26)),
       ("建物の中", (51, 204, 77)), ("渡り廊下", (190, 77, 255))]

for meta_path in sorted(glob.glob(os.path.join(FIG, "_*.json"))):
    name = os.path.basename(meta_path)[1:-5]
    meta = json.load(open(meta_path, encoding="utf-8"))
    base = Image.open(os.path.join(FIG, f"_{name}_建物.png")).convert("RGBA")
    net = Image.open(os.path.join(FIG, f"_{name}_網.png")).convert("RGBA")
    img = Image.alpha_composite(base, net).convert("RGB")
    W, H = img.size
    d = ImageDraw.Draw(img)
    # 階の高さの線（横からの図）
    for f, v in meta["floors"].items():
        y = v * H
        for x in range(0, W, 24):
            d.line((x, y, x + 12, y), fill=(120, 120, 120), width=1)
        bb = d.textbbox((14, y), f, font=F(20, True), anchor="lm")
        d.rounded_rectangle((bb[0] - 6, bb[1] - 4, bb[2] + 6, bb[3] + 4), 5, fill=(255, 255, 255))
        d.text((14, y), f, font=F(20, True), fill=(30, 30, 30), anchor="lm")
    # 見出しと凡例
    d.rectangle((0, 0, W, 52), fill=(255, 255, 255))
    d.text((16, 26), meta["title"], font=F(26, True), fill=(20, 20, 20), anchor="lm")
    x = W - 16
    for t, c in reversed(LEG):
        tw = d.textlength(t, font=F(18))
        x -= tw
        d.text((x, 26), t, font=F(18), fill=(30, 30, 30), anchor="lm")
        x -= 46
        d.line((x, 26, x + 36, 26), fill=c, width=6)
        x -= 18
    if meta.get("metresPerPx"):                       # 正投影なら縮尺
        px = 20 / meta["metresPerPx"]
        d.rounded_rectangle((W - 50 - px, H - 74, W - 14, H - 16), 6, fill=(255, 255, 255))
        d.rectangle((W - 30 - px, H - 36, W - 30, H - 28), fill=(30, 30, 30))
        d.text((W - 30 - px / 2, H - 42), "20 m", font=F(18), fill=(30, 30, 30), anchor="mb")
    img.save(os.path.join(FIG, f"{name}.png"))
    print(name)
