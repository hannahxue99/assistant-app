#!/usr/bin/env python3
"""生成「一勾即安」全套 App 图标资产。

方向定稿：design/icon-redesign-proposals.html 方向二。
形体：暖纸底 + 四条淡格线（Memo 语境）+ 一枝粗壮的橙勾（短臂粗、长臂细，圆头收笔）。
品牌色沿用 DESIGN_SYSTEM.md：纸 #EFE6D8（画布级微调）、勾 #E0733A。

产出（覆盖 assets/images/ 下同名文件）：
  icon.png                     1024  iOS 主图标 / 通用
  splash-icon.png              1024  Expo splash（contain）
  favicon.png                   48   Web
  android-icon-foreground.png  512   adaptive 前景：仅橙勾，收在 66% 安全区
  android-icon-background.png  512   adaptive 背景：纯纸色
  android-icon-monochrome.png  432   monochrome：白色勾剪影（alpha 即形状）

用法：python3 scripts/generate-icons.py
"""

from PIL import Image, ImageDraw

PAPER = (239, 230, 216, 255)      # #EFE6D8
RULE = (224, 213, 194)            # #E0D5C2（格线）
ORANGE = (224, 115, 58, 255)      # #E0733A
WHITE = (255, 255, 255, 255)

# ---- 勾形：1024 设计坐标系下的两条三次贝塞尔（与提案稿一致）----
CHECK = {
    "short": ((300, 545), (352, 602), (408, 656), (452, 704)),  # 短臂，粗
    "long": ((452, 704), (540, 566), (636, 462), (738, 368)),   # 长臂，细
}
W_SHORT, W_LONG = 132, 106  # 1024 坐标系下的描边宽


def bezier(p0, p1, p2, p3, n=64):
    """三次贝塞尔采样为点列。"""
    pts = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def draw_check(draw, scale, offset=(0, 0), fill=ORANGE):
    """按 scale/offset 绘制勾（圆头收笔：两端圆帽，粗臂盖住接笔点）。"""
    ox, oy = offset
    for seg, w in ((CHECK["short"], W_SHORT), (CHECK["long"], W_LONG)):
        pts = [((x + ox) * scale, (y + oy) * scale) for x, y in bezier(*seg)]
        draw.line(pts, fill=fill, width=max(2, round(w * scale)), joint="curve")
    # 圆帽：起笔、收笔、接笔（接笔用粗臂半径，让粗细过渡自然）
    for (x, y), w in ((CHECK["short"][0], W_SHORT), (CHECK["short"][3], W_SHORT), (CHECK["long"][3], W_LONG)):
        r = w * scale / 2
        cx, cy = (x + ox) * scale, (y + oy) * scale
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=fill)


def render_master(size, ss=4, with_rules=True):
    """超采样渲染完整图标（纸底 + 可选格线 + 勾），再降到目标尺寸。"""
    big = size * ss
    img = Image.new("RGBA", (big, big), PAPER)
    draw = ImageDraw.Draw(img)
    if with_rules:
        s = ss * size / 1024
        for y in (330, 450, 770, 890):
            draw.line([(150 * s, y * s), (874 * s, y * s)], fill=RULE, width=max(1, round(6 * s)))
    draw_check(draw, ss * size / 1024)
    return img.resize((size, size), Image.LANCZOS)


def check_bbox(scale=1.0):
    """勾（含圆帽与描边）在 1024 坐标系下的包围盒，用于安全区缩放。"""
    xs, ys = [], []
    for seg, w in ((CHECK["short"], W_SHORT), (CHECK["long"], W_LONG)):
        for x, y in bezier(*seg, n=128):
            xs += [x - w / 2, x + w / 2]
            ys += [y - w / 2, y + w / 2]
    return min(xs) * scale, min(ys) * scale, max(xs) * scale, max(ys) * scale


def render_foreground(size, fill, fit_ratio):
    """仅勾的透明前景层，整体缩放收在画布中央 fit_ratio 比例的安全区内。"""
    ss = 4
    big = size * ss
    x0, y0, x1, y1 = check_bbox()
    w, h = x1 - x0, y1 - y0
    # 缩放：最大边贴合安全区；再整体平移到画布中心（勾的几何中心，非包盒中心，保持视觉重心）
    scale = (size * fit_ratio) / max(w, h) / 1.0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    off_x = big / (2 * scale * ss) - cx
    off_y = big / (2 * scale * ss) - cy
    # off 是 1024 坐标系平移量：中心对齐画布中心
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw_check(draw, scale * ss, (off_x, off_y), fill)
    return img.resize((size, size), Image.LANCZOS)


def main():
    out = "assets/images"
    render_master(1024).save(f"{out}/icon.png")
    render_master(1024).save(f"{out}/splash-icon.png")
    render_master(48).save(f"{out}/favicon.png")
    # Android adaptive：前景只留勾（66% 安全区），背景纯纸色，monochrome 白勾剪影
    render_foreground(512, ORANGE, 0.62).save(f"{out}/android-icon-foreground.png")
    Image.new("RGBA", (512, 512), PAPER).save(f"{out}/android-icon-background.png")
    render_foreground(432, WHITE, 0.62).save(f"{out}/android-icon-monochrome.png")
    print("done:", *[f for f in ("icon", "splash-icon", "favicon", "fg", "bg", "mono")])


if __name__ == "__main__":
    main()
