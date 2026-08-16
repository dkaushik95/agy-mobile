import math
from PIL import Image, ImageDraw

def create_antigravity_icon(size):
    # Create image with RGBA
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Scale factor
    scale = size / 512.0
    
    # Background squircle / rounded rect
    corner_radius = int(115 * scale)
    draw.rounded_rectangle(
        [(0, 0), (size - 1, size - 1)],
        radius=corner_radius,
        fill=(19, 19, 20, 255),
        outline=(255, 255, 255, 30),
        width=int(max(1, 4 * scale))
    )
    
    # Glowing orb gradient in center
    cx, cy = size // 2, size // 2
    glow_radius = int(150 * scale)
    for r in range(glow_radius, 0, -2):
        alpha = int(35 * (1.0 - (r / glow_radius)))
        draw.ellipse(
            [cx - r, cy - r, cx + r, cy + r],
            fill=(66, 133, 244, alpha)
        )
    
    # Antigravity Chevron Emblem
    # Coordinates for size 512, scaled:
    # Top: (256, 170)
    # Bottom Right: (330, 310)
    # Inner Cut: (256, 260)
    # Bottom Left: (182, 310)
    points = [
        (int(256 * scale), int(160 * scale)), # Top peak
        (int(340 * scale), int(310 * scale)), # Bottom right
        (int(300 * scale), int(310 * scale)), # Inner right
        (int(256 * scale), int(240 * scale)), # Center inner
        (int(212 * scale), int(310 * scale)), # Inner left
        (int(172 * scale), int(310 * scale)), # Bottom left
    ]
    
    # Draw glowing shadow for emblem
    for offset in range(int(10 * scale), 0, -2):
        alpha = int(40 * (1.0 - (offset / (10 * scale))))
        shadow_pts = [(x, y + int(offset * 0.5)) for x, y in points]
        draw.polygon(shadow_pts, fill=(155, 114, 203, alpha))
        
    # Main chevron fill
    draw.polygon(points, fill=(66, 133, 244, 255))
    
    # Green core dot
    dot_radius = int(14 * scale)
    dot_cy = int(345 * scale)
    draw.ellipse(
        [cx - dot_radius, dot_cy - dot_radius, cx + dot_radius, dot_cy + dot_radius],
        fill=(48, 209, 88, 255)
    )
    
    # Subtle dot glow
    draw.ellipse(
        [cx - dot_radius * 2, dot_cy - dot_radius * 2, cx + dot_radius * 2, dot_cy + dot_radius * 2],
        outline=(48, 209, 88, 60),
        width=int(max(1, 2 * scale))
    )
    
    return img

if __name__ == "__main__":
    for size, name in [
        (192, "frontend/public/icon-192.png"),
        (512, "frontend/public/icon-512.png"),
        (180, "frontend/public/apple-touch-icon.png"),
        (64, "frontend/public/favicon.png"),
        (192, "public/icon-192.png"),
        (512, "public/icon-512.png")
    ]:
        icon = create_antigravity_icon(size)
        icon.save(name, "PNG")
        print(f"Generated {name} ({size}x{size})")
