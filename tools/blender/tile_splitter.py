"""
CLWA Visual Overhaul — Tile Splitter
=====================================
Splits a large AI-painted image into tiles for Godot 2D.

Usage:
  python tile_splitter.py <input_image> [--tile-size 2048] [--output-dir ./tiles]

Also processes occlusion and walkable masks if found alongside the input.
"""

import argparse
import os
import sys

try:
    from PIL import Image
except ImportError:
    print("Pillow not installed. Run: pip install Pillow")
    sys.exit(1)


def split_image(image_path, tile_size, output_dir, prefix="tile"):
    """Split an image into tiles of given size."""
    img = Image.open(image_path)
    width, height = img.size

    cols = (width + tile_size - 1) // tile_size
    rows = (height + tile_size - 1) // tile_size

    os.makedirs(output_dir, exist_ok=True)

    tiles = []
    for row in range(rows):
        for col in range(cols):
            left = col * tile_size
            top = row * tile_size
            right = min(left + tile_size, width)
            bottom = min(top + tile_size, height)

            tile = img.crop((left, top, right, bottom))

            # Pad to full tile size if needed (edge tiles)
            if tile.size != (tile_size, tile_size):
                padded = Image.new(img.mode, (tile_size, tile_size), (0, 0, 0, 0) if img.mode == 'RGBA' else (0, 0, 0))
                padded.paste(tile, (0, 0))
                tile = padded

            filename = f"{prefix}_{col}_{row}.png"
            tile_path = os.path.join(output_dir, filename)
            tile.save(tile_path, "PNG")
            tiles.append(filename)

    return {
        "source": os.path.basename(image_path),
        "source_size": [width, height],
        "tile_size": tile_size,
        "grid": [cols, rows],
        "tile_count": len(tiles),
        "tiles": tiles,
    }


def main():
    parser = argparse.ArgumentParser(description="Split large image into tiles for Godot 2D")
    parser.add_argument("input", help="Path to the AI-painted image")
    parser.add_argument("--tile-size", type=int, default=2048, help="Tile size in pixels (default: 2048)")
    parser.add_argument("--output-dir", default=None, help="Output directory (default: ./tiles/ next to input)")
    parser.add_argument("--prefix", default="tile", help="Tile filename prefix (default: 'tile')")
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"Error: {args.input} not found")
        sys.exit(1)

    output_dir = args.output_dir or os.path.join(os.path.dirname(args.input), "tiles")

    print(f"Input: {args.input}")
    print(f"Tile size: {args.tile_size}px")
    print(f"Output: {output_dir}")
    print()

    # Split main image
    info = split_image(args.input, args.tile_size, output_dir, args.prefix)
    print(f"Painted background: {info['grid'][0]}x{info['grid'][1]} tiles ({info['tile_count']} total)")
    print(f"Source size: {info['source_size'][0]}x{info['source_size'][1]}px")

    # Look for companion masks in the same directory
    input_dir = os.path.dirname(args.input)
    masks = {
        "occlusion_mask": "occlusion",
        "walkable_mask": "walkable",
    }

    for mask_file, mask_prefix in masks.items():
        mask_path = os.path.join(input_dir, mask_file + ".png")
        if os.path.exists(mask_path):
            mask_info = split_image(mask_path, args.tile_size, output_dir, mask_prefix)
            print(f"{mask_file}: {mask_info['tile_count']} tiles")
        else:
            print(f"{mask_file}: not found, skipping")

    # Write metadata JSON for Godot
    import json
    meta = {
        "tile_size": args.tile_size,
        "grid_cols": info["grid"][0],
        "grid_rows": info["grid"][1],
        "source_width": info["source_size"][0],
        "source_height": info["source_size"][1],
        "prefix": args.prefix,
    }
    meta_path = os.path.join(output_dir, "tilemap_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"\nMetadata: {meta_path}")

    print("\nDone!")


if __name__ == "__main__":
    main()
