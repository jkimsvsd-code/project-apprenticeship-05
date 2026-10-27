"""Deterministic, original geometric artwork for Jjal Card Studio.

Run with Python 3 and Pillow. No downloaded images, models, fonts, or random seed.
The script owns all shapes, faces, colors and rasterization in these twelve PNGs.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, __version__ as pillow_version


ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "apps/demo/public/assets/starter"
MANIFEST = ROOT / "packages/content/src/asset-manifest.json"
SIZE = 512
SCALE = 3
INK = "#29473d"
CREAM = "#fbf6e9"


def polygon(draw: ImageDraw.ImageDraw, points, fill, outline=INK, width=7):
    draw.polygon(points, fill=fill)
    draw.line([*points, points[0]], fill=outline, width=width, joint="curve")


def mascot(character: str, expression: str) -> Image.Image:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse((111, 459, 401, 480), fill=(41, 71, 61, 20))
    body = "#afc7a5" if character == "seed" else "#e6a27d"
    draw.ellipse((155, 420, 230, 471), fill=INK)
    draw.ellipse((283, 420, 358, 471), fill=INK)
    draw.line((135, 303, 94, 340, 84, 324), fill=INK, width=11, joint="curve")
    draw.line((376, 303, 415, 339, 428, 318), fill=INK, width=11, joint="curve")
    if character == "seed":
        draw.line((257, 93, 258, 54), fill=INK, width=8)
        draw.ellipse((201, 34, 259, 68), fill="#b8cc8d", outline=INK, width=5)
        draw.ellipse((257, 24, 310, 58), fill="#93af7a", outline=INK, width=5)
        draw.rounded_rectangle((128, 85, 385, 447), radius=122, fill=body, outline=INK, width=8)
        draw.arc((145, 109, 350, 373), 192, 270, fill="#d7e5c9", width=12)
    else:
        polygon(draw, [(213, 95), (244, 51), (268, 87), (298, 67), (309, 110)], body)
        draw.rounded_rectangle((116, 96, 396, 447), radius=82, fill=body, outline=INK, width=8)
        draw.arc((132, 117, 374, 363), 191, 267, fill="#f5c4a7", width=12)
    draw.ellipse((157, 284, 206, 312), fill="#db8d80")
    draw.ellipse((309, 284, 358, 312), fill="#db8d80")
    if expression == "happy":
        draw.arc((184, 227, 222, 270), 185, 355, fill=INK, width=8)
        draw.arc((289, 227, 327, 270), 185, 355, fill=INK, width=8)
        draw.arc((220, 274, 290, 330), 3, 177, fill=INK, width=9)
    elif expression == "surprised":
        draw.ellipse((190, 231, 213, 265), fill=INK)
        draw.ellipse((298, 231, 321, 265), fill=INK)
        draw.ellipse((239, 286, 275, 330), fill=INK)
        draw.arc((180, 207, 225, 230), 180, 345, fill=INK, width=6)
        draw.arc((285, 207, 330, 230), 195, 360, fill=INK, width=6)
        polygon(draw, [(359, 184), (370, 155), (382, 184), (370, 198)], "#b8d7d0", width=4)
    elif expression == "angry":
        draw.ellipse((190, 246, 211, 271), fill=INK)
        draw.ellipse((298, 246, 319, 271), fill=INK)
        draw.line((182, 222, 221, 237), fill=INK, width=8)
        draw.line((289, 237, 328, 222), fill=INK, width=8)
        draw.arc((226, 303, 286, 341), 195, 345, fill=INK, width=7)
        draw.line((337, 154, 349, 164, 340, 178), fill="#b15d49", width=6)
        draw.line((365, 153, 355, 164, 366, 176), fill="#b15d49", width=6)
    else:
        draw.ellipse((192, 240, 211, 265), fill=INK)
        draw.ellipse((300, 240, 319, 265), fill=INK)
        draw.arc((231, 281, 283, 315), 9, 171, fill=INK, width=7)
    return image


def pattern(kind: str) -> Image.Image:
    image = Image.new("RGBA", (SIZE, SIZE), CREAM)
    draw = ImageDraw.Draw(image)
    if kind == "dots":
        for row in range(-1, 12):
            for col in range(-1, 12):
                x, y = col * 52 + (26 if row % 2 else 0), row * 52
                draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill="#d3ddc7")
    elif kind == "stripes":
        for offset in range(-SIZE, SIZE * 2, 64):
            draw.line((offset, 0, offset - SIZE, SIZE), fill="#f0dfc7", width=22)
    elif kind == "grid":
        for offset in range(0, SIZE + 1, 48):
            draw.line((offset, 0, offset, SIZE), fill="#dfe6d7", width=2)
            draw.line((0, offset, SIZE, offset), fill="#dfe6d7", width=2)
    else:
        for step in range(48):
            angle = step * math.tau / 48
            x, y = 256 + math.cos(angle) * 720, 270 + math.sin(angle) * 720
            draw.line((256 + math.cos(angle) * 125, 270 + math.sin(angle) * 125, x, y),
                      fill="#edddc5", width=5 if step % 2 else 9)
    return image


def main():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    generated = []
    for character, label in [("seed", "새싹 콩"), ("block", "살구 네모")]:
        for expression, emotion in [("neutral", "기본"), ("happy", "기쁨"),
                                    ("surprised", "당황"), ("angry", "분노")]:
            generated.append((f"{character}-{expression}", f"{label} · {emotion}",
                              "character", mascot(character, expression)))
    for kind, label in [("dots", "점"), ("stripes", "줄무늬"), ("grid", "격자"), ("focus", "집중선")]:
        generated.append((f"pattern-{kind}", label, "pattern", pattern(kind)))
    assets = []
    for identifier, label, kind, source in generated:
        # Enlarge/reduce the original drawing to smooth the raster boundary deterministically.
        image = source.resize((SIZE * SCALE, SIZE * SCALE), Image.Resampling.BICUBIC)
        image = image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
        target = DESTINATION / f"{identifier}.png"
        image.save(target, optimize=False, compress_level=9)
        data = target.read_bytes()
        assets.append({
            "asset": {"id": f"starter-{identifier}", "mimeType": "image/png",
                      "byteLength": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                      "pixelWidth": SIZE, "pixelHeight": SIZE},
            "url": f"./assets/starter/{target.name}", "label": label, "category": kind,
        })
    manifest = {
        "collection": "Jjal Card Studio original geometric starter art",
        "createdAt": "2026-10-21",
        "creator": "Jjal Card Studio project, implemented with Codex assistance",
        "generation": {"script": "scripts/generate-starter-assets.py", "pillow": pillow_version,
                       "randomness": "none", "externalArtwork": "none", "canvas": [SIZE, SIZE]},
        "usage": {"statement": "프로젝트에서 직접 작성한 도형·색·표정의 오리지널 소재. 제품과 이용자의 상업적·비상업적 완성 작품에 포함·편집·배포하도록 제공한다.",
                  "attributionRequired": False,
                  "thirdPartyArtwork": False,
                  "reviewNote": "실제 배포 파일과 생성 출처를 기록한 제공 방침이며, 독점권·상표 등록이나 법률 검토 완료를 주장하지 않는다."},
        "assets": assets,
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {len(assets)} original PNGs and {MANIFEST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
