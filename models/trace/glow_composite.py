# 背景（建物）の上に、光の線だけの画像をグローつきで重ねる
#   python trace/glow_composite.py <背景.png> <線だけ.png> <出力.png>
import sys
from PIL import Image, ImageChops, ImageFilter

base = Image.open(sys.argv[1]).convert("RGB")
layer = Image.open(sys.argv[2]).convert("RGBA")
line = Image.new("RGB", layer.size)
line.paste(layer, mask=layer.split()[3])
out = base
for r, k in ((24, 0.9), (8, 1.0)):            # 広いにじみ → 細いにじみ
    g = line.filter(ImageFilter.GaussianBlur(r)).point(lambda v: min(255, int(v * k * 1.3)))
    out = ImageChops.add(out, g)
out = ImageChops.screen(out, line)              # 線の芯
out.save(sys.argv[3])
print("saved", sys.argv[3])
