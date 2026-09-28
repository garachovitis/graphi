"""Generate every app icon / splash from the master logo (build/logo.png, transparent 2000px).

    python3 scripts/make-icons.py      (needs Pillow)
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = Image.open(ROOT / 'build/logo.png').convert('RGBA')
# Crop to the visible mark (the soft glow fades out well before the canvas edge).
MARK = SRC.crop(SRC.getchannel('A').point(lambda v: 255 if v > 60 else 0).getbbox())
WHITE = (255, 255, 255, 255)


def place(size, frac, bg=(0, 0, 0, 0), shape=None):
    """Logo centred on a size×size canvas, its longer side = frac·size. shape: None | 'round' | 'squircle'."""
    w, h = size if isinstance(size, tuple) else (size, size)
    canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    if shape:
        mask = Image.new('L', (w * 4, h * 4), 0)
        d = ImageDraw.Draw(mask)
        if shape == 'round': d.ellipse((0, 0, w * 4 - 1, h * 4 - 1), fill=255)
        else: d.rounded_rectangle((0, 0, w * 4 - 1, h * 4 - 1), radius=int(w * 4 * .225), fill=255)
        canvas.paste(Image.new('RGBA', (w, h), bg), (0, 0), mask.resize((w, h), Image.LANCZOS))
    else:
        canvas.paste(Image.new('RGBA', (w, h), bg))
    side = frac * min(w, h)
    k = side / max(MARK.size)
    m = MARK.resize((max(1, round(MARK.width * k)), max(1, round(MARK.height * k))), Image.LANCZOS)
    canvas.alpha_composite(m, ((w - m.width) // 2, (h - m.height) // 2))
    return canvas


def save(img, rel, opaque=False):
    p = ROOT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    (img.convert('RGB') if opaque else img).save(p, optimize=True)
    print(rel)


def desktop_icon():
    # macOS grid: 824px rounded body inside a 1024 canvas (also used for Windows / Linux).
    c = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    c.alpha_composite(place(824, .78, WHITE, 'squircle'), (100, 100))
    return c


save(desktop_icon(), 'build/icon.png')

# Web / PWA
save(place(192, .96), 'public/favicon.png')
save(place(180, .8, WHITE), 'public/icons/icon-180.png', opaque=True)  # apple-touch: iOS rounds it
save(place(192, .96), 'public/icons/icon-192.png')
save(place(512, .96), 'public/icons/icon-512.png')
save(place(512, .62, WHITE), 'public/icons/icon-512-maskable.png', opaque=True)  # 80% safe circle
save(place(160, 1), 'public/icons/logo-mark.png')  # in-app brand mark (title bar, File)

# iOS
save(place(1024, .8, WHITE), 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', opaque=True)
for n in ('', '-1', '-2'):
    save(place(2732, .22, WHITE), f'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732{n}.png', opaque=True)

# Android
res = ROOT / 'android/app/src/main/res'
for dens, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    save(place(px, .78, WHITE, 'squircle'), f'android/app/src/main/res/mipmap-{dens}/ic_launcher.png')
    save(place(px, .7, WHITE, 'round'), f'android/app/src/main/res/mipmap-{dens}/ic_launcher_round.png')
    save(place(px * 108 // 48, .56), f'android/app/src/main/res/mipmap-{dens}/ic_launcher_foreground.png')  # 66dp safe zone
for p in sorted(res.glob('drawable*/splash.png')):
    w, h = Image.open(p).size
    save(place((w, h), .3, WHITE), p.relative_to(ROOT), opaque=True)
