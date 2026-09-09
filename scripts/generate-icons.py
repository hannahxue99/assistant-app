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

PAPER = (239, 230, 216, 255)      # #EFE6D8（完整版纸底）
PAPER_SMALL = (247, 243, 236, 255)  # #F7F3EC（小尺寸版亮纸底，修「不亮堂」）
RULE = (224, 213, 194)            # #E0D5C2（格线）
# 真机验收修订（2026-09-09 二轮）：勾改用「图标橙」#C95F28 —— 与品牌橙同色相（H≈20°），
# 加深一档把对纸底对比度从 1.72:1 提到 2.03:1，修 60px 下勾「虚、不实」的问题；
# UI 内主操作色仍用品牌橙 #E0733A（DESIGN_SYSTEM.md 不变），仅图标画布使用加深档
ORANGE = (201, 95, 40, 255)       # #C95F28
WHITE = (255, 255, 255, 255)

# ---- 勾形：1024 设计坐标系下的两条三次贝塞尔 ----
# 真机验收修订（2026-09-09）：勾整体放大 10%（绕画布中心）、臂加粗 12%，
# 修 60px 主屏下发糊的问题；提案稿原值见 design/icon-redesign-proposals.html
_K, _C = 1.10, 512
def _grow(pts):
    return tuple(tuple(_C + (v - _C) * _K for v in p) for p in pts)
CHECK = {
    "short": _grow(((300, 545), (352, 602), (408, 656), (452, 704))),  # 短臂，粗
    "long": _grow(((452, 704), (540, 566), (636, 462), (738, 368))),   # 长臂，细
}
W_SHORT, W_LONG = 148, 118  # 1024 坐标系下的描边宽


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


CHECK_SMALL = None  # 延迟初始化：小尺寸特粗勾（放大 18%）


def _check_small():
    """小尺寸版勾：整体再放大 18%、描边加粗，专供 60px/29px 渲染位。"""
    global CHECK_SMALL
    if CHECK_SMALL is None:
        k, c = 1.18, 512
        CHECK_SMALL = tuple(
            tuple(tuple(c + (v - c) * k for v in p) for p in seg)
            for seg in CHECK.values()
        )
    return CHECK_SMALL


W_SMALL = (190, 150)  # 小尺寸版两臂描边宽（1024 坐标系）


def draw_check_variant(draw, scale, offset, widths, check, fill=ORANGE):
    """按参数绘制勾（小尺寸变体复用）。"""
    ox, oy = offset
    for seg, w in zip(check, widths):
        pts = [((x + ox) * scale, (y + oy) * scale) for x, y in bezier(*seg)]
        draw.line(pts, fill=fill, width=max(2, round(w * scale)), joint="curve")
    for (x, y), w in ((check[0][0], widths[0]), (check[0][3], widths[0]), (check[1][3], widths[1])):
        r = w * scale / 2
        cx, cy = (x + ox) * scale, (y + oy) * scale
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=fill)


def render_small(size, ss=4):
    """主图标（定稿 2026-09-09）：亮纸底 + 特粗勾 + 底部三行渐短渐淡细线（远处三行）。

    细线宽度只有勾的 1/13，缩放时先于勾隐没——60px 主屏位只剩干净的勾，
    大尺寸（App Store / splash）呈现「记完的沉下去了，眼前只有这一勾」的层次。
    勾整体略上移（0.95 纵向），给底部三行留出沉底空间。
    """
    big = size * ss
    img = Image.new("RGBA", (big, big), PAPER_SMALL)
    draw = ImageDraw.Draw(img)
    s = ss * size / 1024
    # 底部三行：等长渐短、全部水平居中（真机验收修订：勾与三行均以画布中心对齐）
    for half, y, col in (
        (212, 856, (218, 208, 192, 255)),   # #DAD0C0，长 424
        (150, 900, (224, 216, 201, 255)),   # #E0D8C9，长 300
        (89, 944, (230, 223, 210, 255)),    # #E6DFD2，长 178
    ):
        draw.line([((512 - half) * s, y * s), ((512 + half) * s, y * s)], fill=col, width=max(1, round(13 * s)))
    # 勾：1.13 放大，按质心（视觉重心）对齐画布中心——bbox 中心会偏右下，
    # 因为长臂收笔圆帽甩向右上、短臂起笔圆帽在左下，形体天然不对称
    check = _check_scaled(1.13)
    draw_check_variant(draw, s, (14, -52), W_SMALL, check)
    return img.resize((size, size), Image.LANCZOS)


def _check_scaled(k):
    """按比例 k（绕画布中心）返回缩放后的勾几何。"""
    c = 512
    return tuple(
        tuple(tuple(c + (v - c) * k for v in p) for p in seg)
        for seg in CHECK.values()
    )


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
    # iOS 26 单尺寸图标：主图 = 小尺寸版设计（远处三行），所有渲染位统一
    render_small(1024).save(f"{out}/icon.png")
    render_small(1024).save(f"{out}/splash-icon.png")
    render_small(48).save(f"{out}/favicon.png")
    # Android adaptive：前景只留勾（66% 安全区），背景亮纸色，monochrome 白勾剪影
    render_foreground(512, ORANGE, 0.62).save(f"{out}/android-icon-foreground.png")
    Image.new("RGBA", (512, 512), PAPER_SMALL).save(f"{out}/android-icon-background.png")
    render_foreground(432, WHITE, 0.62).save(f"{out}/android-icon-monochrome.png")
    print("done:", *[f for f in ("icon", "splash-icon", "favicon", "fg", "bg", "mono")])


if __name__ == "__main__":
    main()
