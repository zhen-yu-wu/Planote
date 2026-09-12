"""Generate crisp local PNG icons for the native WeChat tab bar."""

from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "icons"
SIZE = 81
SCALE = 4
NORMAL = "#8A8F85"
ACTIVE = "#2F6B4F"


def canvas():
    image = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
    return image, ImageDraw.Draw(image)


def line(draw, points, color, width=5):
    draw.line([(x * SCALE, y * SCALE) for x, y in points], fill=color,
              width=width * SCALE, joint="curve")


def rounded(draw, box, radius, color, width=5):
    draw.rounded_rectangle(tuple(value * SCALE for value in box), radius * SCALE,
                           outline=color, width=width * SCALE)


def ellipse(draw, box, color, width=5):
    draw.ellipse(tuple(value * SCALE for value in box), outline=color, width=width * SCALE)


def today(draw, color):
    ellipse(draw, (15, 15, 66, 66), color)
    line(draw, [(27, 41), (37, 51), (55, 31)], color, 6)


def inbox(draw, color):
    rounded(draw, (13, 24, 68, 63), 8, color)
    line(draw, [(14, 47), (29, 47), (34, 54), (47, 54), (52, 47), (67, 47)], color, 5)
    line(draw, [(40.5, 14), (40.5, 38)], color, 5)
    line(draw, [(31, 29), (40.5, 38), (50, 29)], color, 5)


def calendar(draw, color):
    rounded(draw, (13, 17, 68, 67), 8, color)
    line(draw, [(14, 32), (67, 32)], color, 5)
    line(draw, [(27, 12), (27, 23)], color, 5)
    line(draw, [(54, 12), (54, 23)], color, 5)
    for x in (27, 41, 55):
        for y in (43, 55):
            draw.ellipse(((x - 2) * SCALE, (y - 2) * SCALE,
                          (x + 2) * SCALE, (y + 2) * SCALE), fill=color)


def profile(draw, color):
    ellipse(draw, (28, 13, 53, 38), color)
    draw.arc((14 * SCALE, 37 * SCALE, 67 * SCALE, 75 * SCALE),
             start=192, end=348, fill=color, width=5 * SCALE)


def save_icon(name, painter, color, suffix):
    image, draw = canvas()
    painter(draw, color)
    image.resize((SIZE, SIZE), Image.Resampling.LANCZOS).save(
        OUTPUT / f"{name}-{suffix}.png", optimize=True
    )


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, painter in {
        "today": today,
        "inbox": inbox,
        "calendar": calendar,
        "profile": profile,
    }.items():
        save_icon(name, painter, NORMAL, "normal")
        save_icon(name, painter, ACTIVE, "active")


if __name__ == "__main__":
    main()
