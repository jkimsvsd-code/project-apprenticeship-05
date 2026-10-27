"""직접 그린 검사 전용 이미지. 재생성 시 Python + Pillow 필요, 테스트 실행에는 불필요."""
from pathlib import Path
from PIL import Image, ImageDraw
import struct
import zlib

root = Path(__file__).parent / 'images'
root.mkdir(exist_ok=True)
def scene(width, height, transparent=False):
    image = Image.new('RGBA', (width, height), (0, 0, 0, 0) if transparent else '#b9d1bb')
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, width // 5, height), fill='#c87858')
    draw.rectangle((width * 4 // 5, 0, width, height), fill='#476c80')
    draw.rectangle((width // 3, height // 5, width * 2 // 3, height * 4 // 5), fill='#e6c56d')
    draw.ellipse((width // 3, height // 3, width * 2 // 3, height * 2 // 3), fill='#35644a')
    return image

scene(400, 1200).save(root / 'portrait.png')
scene(1200, 400).convert('RGB').save(root / 'landscape.jpg', quality=95)
scene(640, 640, True).save(root / 'transparent.png')
scene(640, 480).save(root / 'static.webp', lossless=True)
scene(640, 480).convert('RGB').save(root / 'lossy.webp', quality=90)
scene(640, 480, True).save(root / 'alpha.webp', quality=90)
scene(3000, 1500).save(root / 'large.png')
exif = Image.Exif()
exif[274] = 6
scene(1200, 400).convert('RGB').save(root / 'rotated.jpg', quality=95, exif=exif)
frames = [scene(80, 80), Image.new('RGBA', (80, 80), '#59642b')]
frames[0].save(root / 'animated.png', save_all=True, append_images=frames[1:], duration=100, loop=0)
frames[0].save(root / 'animated.webp', save_all=True, append_images=frames[1:], duration=100, loop=0)
(root / 'signature-only.png').write_bytes(b'\x89PNG\r\n\x1a\n')
(root / 'not-image.txt').write_text('This is a text file, not an image.', encoding='utf-8')
original = (root / 'portrait.png').read_bytes()
def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data))
(root / 'too-many-pixels.png').write_bytes(original[:8] + chunk(b'IHDR', struct.pack('>II', 10000, 10000) + original[24:29]) + original[33:])
(root / 'bad-compression.png').write_bytes(original[:33] + chunk(b'IDAT', b'not zlib data') + chunk(b'IEND', b''))
print(f'Generated {len(list(root.iterdir()))} synthetic fixtures')
