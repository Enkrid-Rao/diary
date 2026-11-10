# -*- coding: utf-8 -*-
"""生成日记应用图标：深色玻璃圆角方块 + 琥珀色羽毛笔/书页，输出多尺寸 .ico"""
from PIL import Image, ImageDraw

S = 1024  # 超采样画布，最后缩小抗锯齿

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# --- 圆角方块底（深色带一点渐变感：上下两层色） ---
m = 56            # 边距
r = 220           # 圆角半径
top = (26, 29, 38, 255)
bot = (16, 18, 24, 255)
# 纵向渐变：分条画
steps = 256
x0, y0, x1, y1 = m, m, S - m, S - m
for i in range(steps):
    t = i / (steps - 1)
    c = tuple(int(top[j] + (bot[j] - top[j]) * t) for j in range(4))
    yy0 = y0 + (y1 - y0) * i // steps
    yy1 = y0 + (y1 - y0) * (i + 1) // steps
    d.rectangle([x0, yy0, x1, yy1], fill=c)
# 用圆角蒙版裁切
mask = Image.new("L", (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=255)
img.putalpha(mask)
d = ImageDraw.Draw(img)

# --- 玻璃高光：顶部一道柔光 ---
hl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
hd = ImageDraw.Draw(hl)
hd.rounded_rectangle([x0 + 30, y0 + 26, x1 - 30, y0 + 120], radius=90, fill=(255, 255, 255, 26))
img = Image.alpha_composite(img, hl)
d = ImageDraw.Draw(img)

# --- 琥珀色书页（左页右页，打开的书） ---
amber = (232, 179, 102, 255)
amber_soft = (232, 179, 102, 200)
cx = S // 2
by0, by1 = 300, 700          # 书的上下
bw = 300                     # 半宽
d.polygon([(cx, by0 + 60), (cx - bw, by0), (cx - bw, by1 - 60), (cx, by1)], fill=amber)
d.polygon([(cx, by0 + 60), (cx + bw, by0), (cx + bw, by1 - 60), (cx, by1)], fill=amber_soft)
# 书脊中线
d.line([(cx, by0 + 60), (cx, by1)], fill=(20, 22, 28, 255), width=10)
# 书页上的文字线（左页深色线）
line_c = (20, 22, 28, 190)
for i, w in enumerate([180, 200, 150]):
    yy = by0 + 130 + i * 90
    d.rounded_rectangle([cx - bw + 55, yy, cx - bw + 55 + w, yy + 26], radius=13, fill=line_c)
for i, w in enumerate([170, 190, 130]):
    yy = by0 + 145 + i * 90
    d.rounded_rectangle([cx + 45, yy, cx + 45 + w, yy + 26], radius=13, fill=(20, 22, 28, 150))

img = img.resize((256, 256), Image.LANCZOS)
img.save("app.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
img.save("app.png")
print("icon ok")
