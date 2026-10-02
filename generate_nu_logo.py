#!/usr/bin/env python3
import os
import math
from PIL import Image, ImageDraw, ImageFont

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def create_nu_logo(size=512):
    # Create RGBA canvas
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = size * 0.04
    center = size / 2

    # 1. Outer glow / shadow circle
    draw.ellipse(
        [margin, margin, size - margin, size - margin],
        fill=(15, 23, 42, 255) # Dark slate / navy
    )

    # 2. Main gradient-like circular background (Navy to Blue)
    inner_margin = size * 0.06
    for i in range(int(size * 0.44)):
        r = int(size * 0.44) - i
        ratio = i / (size * 0.44)
        # Gradient from Deep Royal Blue #1e3a8a to Vibrant Azure #2563eb
        red = int(15 + ratio * 22)
        green = int(40 + ratio * 59)
        blue = int(138 + ratio * 97)
        draw.ellipse(
            [center - r, center - r, center + r, center + r],
            fill=(red, green, blue, 255)
        )

    # 3. Golden & Cyan concentric accent rings
    ring_thick = max(2, int(size * 0.018))
    draw.ellipse(
        [inner_margin, inner_margin, size - inner_margin, size - inner_margin],
        outline=(6, 182, 212, 230), # Cyan
        width=ring_thick
    )
    draw.ellipse(
        [inner_margin + ring_thick * 1.5, inner_margin + ring_thick * 1.5, 
         size - inner_margin - ring_thick * 1.5, size - inner_margin - ring_thick * 1.5],
        outline=(245, 158, 11, 200), # Gold
        width=max(1, int(ring_thick * 0.6))
    )

    # 4. Academic Graduation Cap Icon at top center
    cap_cx = center
    cap_cy = size * 0.26
    cap_w = size * 0.28
    cap_h = size * 0.12

    # Diamond cap top
    diamond = [
        (cap_cx, cap_cy - cap_h / 2),
        (cap_cx + cap_w / 2, cap_cy),
        (cap_cx, cap_cy + cap_h / 2),
        (cap_cx - cap_w / 2, cap_cy)
    ]
    draw.polygon(diamond, fill=(255, 255, 255, 255))
    draw.polygon(diamond, outline=(245, 158, 11, 255), width=max(1, int(size * 0.01)))

    # Cap skull band
    skull = [
        (cap_cx - cap_w * 0.28, cap_cy + cap_h * 0.2),
        (cap_cx + cap_w * 0.28, cap_cy + cap_h * 0.2),
        (cap_cx + cap_w * 0.22, cap_cy + cap_h * 0.75),
        (cap_cx - cap_w * 0.22, cap_cy + cap_h * 0.75)
    ]
    draw.polygon(skull, fill=(245, 158, 11, 255))

    # Tassel
    tassel_pts = [
        (cap_cx, cap_cy),
        (cap_cx + cap_w * 0.45, cap_cy + cap_h * 0.5),
        (cap_cx + cap_w * 0.48, cap_cy + cap_h * 0.9)
    ]
    draw.line(tassel_pts, fill=(245, 158, 11, 255), width=max(2, int(size * 0.015)))
    draw.ellipse(
        [cap_cx + cap_w * 0.44, cap_cy + cap_h * 0.85, 
         cap_cx + cap_w * 0.52, cap_cy + cap_h * 0.98],
        fill=(245, 158, 11, 255)
    )

    # 5. Bold "NU" Letters in center
    # Try finding system bold fonts (Arial, Segoe UI, Impact, DejaVuSans)
    font = None
    font_size = int(size * 0.38)
    font_paths = [
        "C:\\Windows\\Fonts\\arialbd.ttf",
        "C:\\Windows\\Fonts\\seguiemj.ttf",
        "C:\\Windows\\Fonts\\segoeuib.ttf",
        "C:\\Windows\\Fonts\\calibrib.ttf",
        "C:\\Windows\\Fonts\\arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                font = ImageFont.truetype(fp, font_size)
                break
            except Exception:
                pass

    if font is None:
        font = ImageFont.load_default()

    text = "NU"
    # Get bounding box
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    tx = (size - text_w) / 2
    ty = size * 0.36

    # Text shadow
    draw.text((tx + size * 0.01, ty + size * 0.01), text, fill=(10, 15, 30, 200), font=font)
    # Text main
    draw.text((tx, ty), text, fill=(255, 255, 255, 255), font=font)

    # 6. Stylized River Nile Wave below text
    wave_y = size * 0.76
    wave_pts = []
    for x in range(int(size * 0.22), int(size * 0.78)):
        norm_x = (x - size * 0.22) / (size * 0.56)
        y = wave_y + math.sin(norm_x * math.pi * 3) * (size * 0.025)
        wave_pts.append((x, y))

    if len(wave_pts) > 1:
        draw.line(wave_pts, fill=(6, 182, 212, 255), width=max(3, int(size * 0.02)))
        
        # Second subtle gold wave
        gold_wave_pts = [(x, y + size * 0.035) for x, y in wave_pts]
        draw.line(gold_wave_pts, fill=(245, 158, 11, 230), width=max(2, int(size * 0.012)))

    # 7. Subtitle text "NILE UNIVERSITY"
    sub_font_size = max(10, int(size * 0.062))
    sub_font = None
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                sub_font = ImageFont.truetype(fp, sub_font_size)
                break
            except Exception:
                pass
    if sub_font is None:
        sub_font = ImageFont.load_default()

    sub_text = "NILE UNIVERSITY"
    s_bbox = draw.textbbox((0, 0), sub_text, font=sub_font)
    s_w = s_bbox[2] - s_bbox[0]
    draw.text(((size - s_w) / 2, size * 0.84), sub_text, fill=(226, 232, 240, 255), font=sub_font)

    return img

def main():
    print("[1/5] Generating master 512x512 Nile University logo...")
    logo512 = create_nu_logo(512)

    # 1. Save Windows ICO with multiple resolutions (256, 128, 64, 48, 32, 16)
    ico_path = os.path.join(BASE_DIR, "app.ico")
    icon_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    ico_images = [logo512.resize(s, Image.Resampling.LANCZOS) for s in icon_sizes]
    
    # Save master ICO
    ico_images[0].save(
        ico_path,
        format="ICO",
        sizes=icon_sizes,
        append_images=ico_images[1:]
    )
    print(f"[OK] Generated Windows icon: {ico_path}")

    # 2. Save public web assets
    public_dir = os.path.join(BASE_DIR, "public")
    if os.path.exists(public_dir):
        logo512.save(os.path.join(public_dir, "icon-512.png"), format="PNG")
        logo192 = logo512.resize((192, 192), Image.Resampling.LANCZOS)
        logo192.save(os.path.join(public_dir, "icon-192.png"), format="PNG")
        logo32 = logo512.resize((32, 32), Image.Resampling.LANCZOS)
        logo32.save(os.path.join(public_dir, "favicon.ico"), format="ICO")
        print("[OK] Saved web icons in public/")

    # 3. Save Android mipmaps for Flutter
    res_dir = os.path.join(BASE_DIR, "flutter_app", "android", "app", "src", "main", "res")
    mipmap_targets = {
        "mipmap-mdpi": (48, 48),
        "mipmap-hdpi": (72, 72),
        "mipmap-xhdpi": (96, 96),
        "mipmap-xxhdpi": (144, 144),
        "mipmap-xxxhdpi": (192, 192),
    }

    for folder, dim in mipmap_targets.items():
        folder_path = os.path.join(res_dir, folder)
        if os.path.exists(folder_path):
            resized = logo512.resize(dim, Image.Resampling.LANCZOS)
            resized.save(os.path.join(folder_path, "ic_launcher.png"), format="PNG")
            print(f"[OK] Generated {folder}/ic_launcher.png ({dim[0]}x{dim[1]})")

    # 4. Save Flutter in-app asset logo
    assets_dir = os.path.join(BASE_DIR, "flutter_app", "assets", "images")
    os.makedirs(assets_dir, exist_ok=True)
    logo512.save(os.path.join(assets_dir, "nu_logo.png"), format="PNG")
    print(f"[OK] Saved Flutter asset: {os.path.join(assets_dir, 'nu_logo.png')}")

if __name__ == "__main__":
    main()
