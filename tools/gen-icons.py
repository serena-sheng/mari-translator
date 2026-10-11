#!/usr/bin/env python3
"""生成方向 C「08号机」扩展图标：粉白渐变 squircle + 白色 KT。"""
import math
from PIL import Image, ImageDraw, ImageFont

SIZES = [16, 32, 48, 128, 192]
GRAD_TOP = (255, 194, 218)      # #FFC2DA 樱粉
GRAD_BOTTOM = (240, 69, 126)    # #F0457E 品红
ACTIVE_TOP = (240, 69, 126)
ACTIVE_BOTTOM = (194, 24, 91)   # 深品红，激活态更饱和
FONT = "/System/Library/Fonts/SFNS.ttf"
SS = 4  # 超采样倍数


def squircle_mask(size, n=4.5):
    """超椭圆（Apple squircle 近似）蒙版，size 为超采样后的像素。"""
    mask = Image.new("L", (size, size), 0)
    px = mask.load()
    half = size / 2
    r = half * 0.98  # 留一点边，避免贴边发虚
    for y in range(size):
        for x in range(size):
            dx = abs(x + 0.5 - half) / r
            dy = abs(y + 0.5 - half) / r
            if dx ** n + dy ** n <= 1:
                px[x, y] = 255
    return mask


def gradient(size, top, bottom):
    """对角（左上→右下）线性渐变。"""
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return img


def make_icon(size, top, bottom, active=False):
    S = size * SS
    icon = gradient(S, top, bottom)

    # 顶部柔光：让玻璃感落在图标上
    sheen = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(sheen)
    d.ellipse([-S * 0.25, -S * 0.75, S * 1.25, S * 0.45], fill=70)
    white = Image.new("RGB", (S, S), (255, 255, 255))
    icon = Image.composite(white, icon, sheen.point(lambda v: v // 3))

    mask = squircle_mask(S)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(icon, (0, 0), mask)

    d = ImageDraw.Draw(out)
    if active:
        # 激活态：白色细内环表示「正在翻译」
        inset = round(S * 0.075)
        ring = Image.new("L", (S, S), 0)
        rd = ImageDraw.Draw(ring)
        rd.ellipse([inset, inset, S - inset, S - inset],
                   outline=255, width=max(2, round(S * 0.028)))
        inner = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        inner.paste(Image.new("RGB", (S, S), (255, 255, 255)), (0, 0), ring)
        out = Image.alpha_composite(out, inner)
        d = ImageDraw.Draw(out)

    # 白色 KT，SF Bold；字号随图标大小微调字重观感
    font_size = round(S * 0.46)
    font = ImageFont.truetype(FONT, font_size)
    try:
        font.set_variation_by_name("Bold")
    except Exception:
        pass
    bbox = d.textbbox((0, 0), "KT", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    # 视觉居中：x 按字宽居中，y 按字高居中并略收上偏
    tx = (S - tw) / 2 - bbox[0]
    ty = (S - th) / 2 - bbox[1] - S * 0.01
    d.text((tx, ty), "KT", font=font, fill=(255, 255, 255, 255))

    return out.resize((size, size), Image.LANCZOS)


for size in SIZES:
    make_icon(size, GRAD_TOP, GRAD_BOTTOM).save(f"public/images/logo{size}.png")
    make_icon(size, ACTIVE_TOP, ACTIVE_BOTTOM, active=True).save(
        f"public/images/logo{size}_active.png"
    )
    print(f"logo{size} done")

# favicon 用 32 尺寸重出
make_icon(32, GRAD_TOP, GRAD_BOTTOM).save("public/favicon.ico", sizes=[(16, 16), (32, 32)])
print("favicon done")
