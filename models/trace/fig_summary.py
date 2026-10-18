# figures/ の図を 1 枚に並べる → figures/00_まとめ.png
#   python trace/fig_summary.py
import json, os
from PIL import Image, ImageDraw, ImageFont

FIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "figures")
G = json.load(open(os.path.join(os.path.dirname(FIG), "campus_graph.json"), encoding="utf-8"))
ITEMS = [("01_配置図_真上から.png", f"① 配置図：点{len(G['nodes'])}・つながり{len(G['edges'])}（真上から）"),
         ("02_3D_全体_豊洲駅側の空から.png", "② 3D：点とつながり（豊洲駅側の空から）"),
         ("03_建物の中_階ごと.png", "③ 建物の中：階ごとの点とつながり"),
         ("04_軌跡の例_そのまま（建物に隠れる）.png", "④ 軌跡の例：3Dにそのまま置くと建物に隠れる"),
         ("05_軌跡の例_重ねる_直線.png", "⑤ 軌跡の例：線を上に重ねる（直線）"),
         ("06_軌跡の例_重ねる_なめらか.png", "⑥ 軌跡の例：線を上に重ねる（角を丸める）"),
         ("07_チェックポイント一覧.png", "⑦ ゴールの点の一覧（緯度経度・アプリの座標・GPSで使うか）"),
         ("08_3D_建物を消して階を見る.png", "⑧ 建物を消して見た点とつながり（階・渡り廊下）"),
         ("09_上から_全体.png", "⑨ 上から：道の網の全体（建物は半透明）"),
         ("10_上から_教室棟と交流棟のまわり.png", "⑩ 上から：教室棟・交流棟・本部棟のまわり"),
         ("11_横から_道路側から.png", "⑪ 横から：道路側（北西）から"),
         ("12_横から_研究棟側から.png", "⑫ 横から：研究棟側（北東）から"),
         ("13_斜めから_建物を透かして.png", "⑬ 斜めから：建物を透かして")]
CW, CH, PAD, TH, COLS = 900, 506, 30, 56, 2
rows = (len(ITEMS) + 1) // COLS
W = COLS * CW + (COLS + 1) * PAD
H = 120 + rows * (CH + TH + PAD) + PAD
sheet = Image.new("RGB", (W, H), (245, 245, 242))
d = ImageDraw.Draw(sheet)
fb = ImageFont.truetype("C:/Windows/Fonts/meiryob.ttc", 40)
ft = ImageFont.truetype("C:/Windows/Fonts/meiryob.ttc", 24)
d.text((PAD, 36), "TRACE 道の網のまとめ（TRACE_F #8・2026-10-17 下書き 2）", font=fb, fill=(20, 20, 20))
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
