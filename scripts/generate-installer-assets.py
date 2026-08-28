#!/usr/bin/env python3
"""Generate deterministic Harbor Desk Windows installer branding assets."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "apps" / "desktop" / "build"

NAVY = (6, 28, 73)
HEADER_BLUE = (8, 45, 114)
BLUE = (29, 99, 237)
BLUE_STRONG = (11, 69, 196)
TEAL = (0, 165, 140)
WHITE = (255, 255, 255)


def interpolate(start: tuple[int, int, int], end: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    return tuple(round(a + (b - a) * amount) for a, b in zip(start, end))


def vertical_gradient(size: tuple[int, int], start: tuple[int, int, int], end: tuple[int, int, int]) -> Image.Image:
    width, height = size
    image = Image.new("RGB", size)
    pixels = image.load()
    for y in range(height):
        color = interpolate(start, end, y / max(1, height - 1))
        for x in range(width):
            pixels[x, y] = color
    return image


def horizontal_gradient(size: tuple[int, int], start: tuple[int, int, int], end: tuple[int, int, int]) -> Image.Image:
    width, height = size
    image = Image.new("RGB", size)
    pixels = image.load()
    for x in range(width):
        color = interpolate(start, end, x / max(1, width - 1))
        for y in range(height):
            pixels[x, y] = color
    return image


def draw_mark(image: Image.Image, box: tuple[int, int, int, int]) -> None:
    left, top, right, bottom = box
    width = right - left
    height = bottom - top
    radius = round(min(width, height) * 0.2)

    gradient = vertical_gradient((width, height), BLUE, BLUE_STRONG).convert("RGBA")
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, width - 1, height - 1), radius=radius, fill=255)
    image.paste(gradient, (left, top), mask)

    draw = ImageDraw.Draw(image)
    stroke = max(3, round(width * 0.065))
    center_y = top + height * 0.5
    bracket_top = top + height * 0.28
    bracket_bottom = top + height * 0.72
    left_outer = left + width * 0.39
    left_inner = left + width * 0.24
    right_outer = left + width * 0.61
    right_inner = left + width * 0.76

    draw.line(
        [(left_outer, bracket_top), (left_inner, center_y), (left_outer, bracket_bottom)],
        fill=WHITE,
        width=stroke,
        joint="curve",
    )
    draw.line(
        [(right_outer, bracket_top), (right_inner, center_y), (right_outer, bracket_bottom)],
        fill=WHITE,
        width=stroke,
        joint="curve",
    )

    accent_width = max(2, round(width * 0.025))
    draw.rounded_rectangle(
        (
            round(left + width * 0.47),
            round(top + height * 0.33),
            round(left + width * 0.53),
            round(top + height * 0.67),
        ),
        radius=accent_width,
        fill=(*TEAL, 255),
    )


def make_icon() -> Image.Image:
    scale = 4
    size = 512 * scale
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    margin = 24 * scale
    draw_mark(canvas, (margin, margin, size - margin, size - margin))
    return canvas.resize((512, 512), Image.Resampling.LANCZOS)


def add_container_stack(draw: ImageDraw.ImageDraw, *, x: int, y: int, width: int, rows: int) -> None:
    row_height = 18
    gap = 7
    for row in range(rows):
        offset = 8 if row % 2 else 0
        top = y + row * (row_height + gap)
        draw.rounded_rectangle(
            (x + offset, top, x + width - offset, top + row_height),
            radius=4,
            fill=(17, 55 + row * 6, 112 + row * 8),
            outline=(36, 91, 164),
            width=1,
        )
        for divider in (0.33, 0.66):
            divider_x = round(x + offset + (width - offset * 2) * divider)
            draw.line((divider_x, top + 4, divider_x, top + row_height - 4), fill=(58, 109, 177), width=1)


def make_sidebar(*, uninstall: bool) -> Image.Image:
    width, height = 164, 314
    image = vertical_gradient((width, height), NAVY, (8, 14, 19)).convert("RGBA")
    draw = ImageDraw.Draw(image)

    draw.polygon([(0, 212), (164, 150), (164, 314), (0, 314)], fill=(8, 38, 91, 230))
    draw.line((0, 211, 164, 149), fill=(*BLUE, 150), width=2)
    draw.line((0, 229, 164, 167), fill=(*TEAL, 85), width=1)

    draw_mark(image, (30, 28, 134, 132))
    add_container_stack(draw, x=26, y=181, width=112, rows=3)

    accent = (145, 164, 183) if uninstall else TEAL
    draw.rounded_rectangle((26, 278, 92, 282), radius=2, fill=accent)
    draw.rounded_rectangle((26, 289, 122, 292), radius=2, fill=(56, 92, 132))
    return image.convert("RGB")


def make_header() -> Image.Image:
    width, height = 150, 57
    image = horizontal_gradient((width, height), (244, 247, 251), HEADER_BLUE).convert("RGBA")
    draw = ImageDraw.Draw(image)
    draw.polygon([(58, 57), (96, 0), (150, 0), (150, 57)], fill=(8, 45, 114, 220))
    draw.line((56, 57, 94, 0), fill=(*BLUE, 170), width=2)
    draw_mark(image, (103, 8, 144, 49))
    return image.convert("RGB")


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)

    icon = make_icon()
    icon.save(OUTPUT / "icon.png", format="PNG", optimize=True)
    icon.save(
        OUTPUT / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    make_header().save(OUTPUT / "installerHeader.bmp", format="BMP")
    make_sidebar(uninstall=False).save(OUTPUT / "installerSidebar.bmp", format="BMP")
    make_sidebar(uninstall=True).save(OUTPUT / "uninstallerSidebar.bmp", format="BMP")

    print(f"Generated Harbor Desk installer assets in {OUTPUT}")


if __name__ == "__main__":
    main()
