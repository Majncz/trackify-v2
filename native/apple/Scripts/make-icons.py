#!/usr/bin/env python3
"""Generate the Trackify app icons (NATIVE_SPEC §4): black rounded square, white bold "T", green (#22C55E) dot lower right."""
import json, os, sys
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024

def glyph(size, body, radius, bg=(10, 10, 10, 255), shadow=False, transparent=True):
    """Draw the icon at 4x and downsample for smooth edges."""
    k = 4
    W = size * k
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0) if transparent else bg)
    d = ImageDraw.Draw(img)
    x0 = (size - body) / 2 * k
    y0 = x0
    x1 = x0 + body * k
    y1 = y0 + body * k
    if shadow:
        sh = Image.new("RGBA", (W, W), (0, 0, 0, 0))
        sd = ImageDraw.Draw(sh)
        sd.rounded_rectangle([x0, y0 + 10 * k * size / S, x1, y1 + 10 * k * size / S], radius=radius * k, fill=(0, 0, 0, 90))
        sh = sh.filter(ImageFilter.GaussianBlur(14 * k * size / S))
        img.alpha_composite(sh)
        d = ImageDraw.Draw(img)
    if transparent:
        d.rounded_rectangle([x0, y0, x1, y1], radius=radius * k, fill=bg)
    B = body * k
    # Bold "T": crossbar + stem (geometric, like SF Pro Heavy)
    bar_w, bar_h = 0.56 * B, 0.15 * B
    stem_w, stem_h = 0.17 * B, 0.56 * B
    cx = x0 + 0.47 * B
    top = y0 + 0.2 * B
    white = (255, 255, 255, 255)
    d.rounded_rectangle([cx - bar_w / 2, top, cx + bar_w / 2, top + bar_h], radius=0.02 * B, fill=white)
    d.rounded_rectangle([cx - stem_w / 2, top, cx + stem_w / 2, top + stem_h + bar_h * 0.35], radius=0.02 * B, fill=white)
    # Green dot (the "Trackify." dot)
    r = 0.075 * B
    dx, dy = x0 + 0.72 * B, y0 + 0.73 * B
    d.ellipse([dx - r, dy - r, dx + r, dy + r], fill=(34, 197, 94, 255))
    return img.resize((size, size), Image.LANCZOS)

def ios():
    out = os.path.join(ROOT, "iOS/Assets.xcassets/AppIcon.appiconset")
    os.makedirs(out, exist_ok=True)
    # iOS masks corners itself: full-bleed, opaque.
    glyph(S, S, 0, transparent=False).convert("RGB").save(os.path.join(out, "icon-1024.png"))
    # Dark + tinted appearances (iOS 18)
    glyph(S, S, 0, bg=(0, 0, 0, 255), transparent=False).convert("RGB").save(os.path.join(out, "icon-1024-dark.png"))
    tinted = glyph(S, S, 0, bg=(0, 0, 0, 255), transparent=False).convert("L").convert("RGB")
    tinted.save(os.path.join(out, "icon-1024-tinted.png"))
    json.dump({"images": [
        {"filename": "icon-1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"},
        {"appearances": [{"appearance": "luminosity", "value": "dark"}], "filename": "icon-1024-dark.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"},
        {"appearances": [{"appearance": "luminosity", "value": "tinted"}], "filename": "icon-1024-tinted.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"},
    ], "info": {"author": "xcode", "version": 1}}, open(os.path.join(out, "Contents.json"), "w"), indent=2)

def mac():
    out = os.path.join(ROOT, "macOS/Assets.xcassets/AppIcon.appiconset")
    os.makedirs(out, exist_ok=True)
    images = []
    for pt in [16, 32, 128, 256, 512]:
        for scale in [1, 2]:
            px = pt * scale
            # macOS grid: 824/1024 body, ~185 radius, soft drop shadow.
            body = px * 824 / 1024
            img = glyph(px, body, body * 0.2245, shadow=px >= 64)
            name = f"mac-{pt}@{scale}x.png"
            img.save(os.path.join(out, name))
            images.append({"filename": name, "idiom": "mac", "scale": f"{scale}x", "size": f"{pt}x{pt}"})
    json.dump({"images": images, "info": {"author": "xcode", "version": 1}}, open(os.path.join(out, "Contents.json"), "w"), indent=2)

def catalogs():
    for p in ["iOS/Assets.xcassets", "macOS/Assets.xcassets"]:
        json.dump({"info": {"author": "xcode", "version": 1}}, open(os.path.join(ROOT, p, "Contents.json"), "w"), indent=2)
    # Accent colour = foreground (monochrome UI)
    for p in ["iOS/Assets.xcassets/AccentColor.colorset", "macOS/Assets.xcassets/AccentColor.colorset"]:
        os.makedirs(os.path.join(ROOT, p), exist_ok=True)
        json.dump({"colors": [
            {"color": {"color-space": "srgb", "components": {"alpha": "1.000", "blue": "0x17", "green": "0x17", "red": "0x17"}}, "idiom": "universal"},
            {"appearances": [{"appearance": "luminosity", "value": "dark"}],
             "color": {"color-space": "srgb", "components": {"alpha": "1.000", "blue": "0xFA", "green": "0xFA", "red": "0xFA"}}, "idiom": "universal"},
        ], "info": {"author": "xcode", "version": 1}}, open(os.path.join(ROOT, p, "Contents.json"), "w"), indent=2)
    # Preview for docs
    glyph(512, 512 * 824 / 1024, 512 * 824 / 1024 * 0.2245, shadow=True).save(os.path.join(ROOT, "Scripts/icon-preview.png"))

ios(); mac(); catalogs()
print("icons written")
