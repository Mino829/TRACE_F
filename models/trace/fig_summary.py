# figures/ の図を 1 枚に並べる → figures/00_まとめ.png
#   python trace/fig_summary.py
import os
from PIL import Image, ImageDraw, ImageFont

FIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "figures")
ITEMS = [("01_配置図_真上から.png", "① 配置図：16か所・23本（真上から）"),
         ("02_3D_全体_豊洲駅側の空から.png", "② 3D：点とつながり（豊洲駅側の空から）"),
         ("03_教室棟3F_ShibaLabまで.png", "③ 教室棟3F：入口→ShibaLab（301）"),
         ("04_軌跡の例_そのまま（建物に隠れる）.png", "④ 軌跡の例：3Dにそのまま置くと建物に隠れる"),
         ("05_軌跡の例_重ねる_直線.png", "⑤ 軌跡の例：線を上に重ねる（直線）"),
         ("06_軌跡の例_重ねる_なめらか.png", "⑥ 軌跡の例：線を上に重ねる（角を丸める）"),
         ("07_チェックポイント一覧.png", "⑦ 点の一覧（緯度経度・アプリの座標・GPSで使うか）")]
CW, CH, PAD, TH, COLS = 900, 506, 30, 56, 2
rows = (len(ITEMS) + 1) // COLS
W = COLS * CW + (COLS + 1) * PAD
H = 120 + rows * (CH + TH + PAD) + PAD
sheet = Image.new("RGB", (W, H), (245, 245, 242))
d = ImageDraw.Draw(sheet)
fb = ImageFont.truetype("C:/Windows/Fonts/meiryob.ttc", 40)
ft = ImageFont.truetype("C:/Windows/Fonts/meiryob.ttc", 24)
d.text((PAD, 36), "TRACE チェックポイントのまとめ（TRACE_F #8・2026-10-17 下書き）", font=fb, fill=(20, 20, 20))
for i, (f, t) in enumerate(ITEMS):
    r, c = divmod(i, COLS)
    x, y = PAD + c * (CW + PAD), 120 + r * (CH + TH + PAD)
    d.text((x, y + TH / 2), t, font=ft, fill=(30, 30, 30), anchor="lm")
    im = Image.open(os.path.join(FIG, f)).convert("RGB")
    im.thumbnail((CW, CH))
    box = Image.new("RGB", (CW, CH), (255, 255, 255))
    box.paste(im, ((CW - im.width) // 2, (CH - im.height) // 2))
    sheet.paste(box, (x, y + TH))
    d.rectangle((x, y + TH, x + CW, y + TH + CH), outline=(200, 200, 200), width=2)
sheet.save(os.path.join(FIG, "00_まとめ.png"))
print(sheet.size)
