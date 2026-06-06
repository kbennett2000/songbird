#!/usr/bin/env python3
"""Render the bundled Bible-world basemap from Natural Earth public-domain vectors.

This is a **dev/build-time tool only**. Its output — `frontend/src/assets/bible-map.png` — is
committed to the repo; songbird's runtime ships only that PNG and never runs this script. So its
dependencies (`pyshp`, `Pillow`) live in `scripts/mapgen/requirements.txt` and are deliberately
NOT in the backend runtime requirements (dependency-discipline canon: no heavy geo stack in
songbird).

The map is **equirectangular (plate carrée)**. Crucially, this script projects lon/lat to pixels
with the *exact same* linear transform the runtime uses (`frontend/src/lib/projection.ts`), into
the *exact same* bounds and pixel size (`frontend/src/lib/mapBounds.ts`). That shared transform is
what guarantees pins land where the coastlines say they should — the basemap and the pins cannot
drift.

⚠ BOUNDS/SIZE BELOW MUST MATCH `frontend/src/lib/mapBounds.ts`. If you change them there, change
them here and re-run this script. (See README.md for how to fetch the Natural Earth data offline.)

Usage:
    pip install -r scripts/mapgen/requirements.txt
    # download + unzip Natural Earth 1:50m shapefiles into scripts/mapgen/data/ (see README.md)
    python scripts/mapgen/generate_map.py
"""

from __future__ import annotations

from pathlib import Path

import shapefile  # pyshp
from PIL import Image, ImageDraw

# --- Single source of truth — keep in lockstep with frontend/src/lib/mapBounds.ts -------------
WEST, EAST, SOUTH, NORTH = 10.0, 50.0, 13.0, 45.0
WIDTH, HEIGHT = 1000, 800

# --- Parchment / ink palette (on-brand; legibility first) -------------------------------------
SEA = (244, 236, 216)  # warm parchment
LAND = (231, 219, 193)  # faint warm land fill, a shade darker than the sea
COAST = (90, 74, 58)  # ink / sepia coastline
RIVER = (120, 134, 148)  # muted blue-grey rivers
LAKE = SEA  # lakes read as the sea colour (holes in the land)

DATA_DIR = Path(__file__).parent / "data"
OUTPUT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "assets" / "bible-map.png"


def project(lon: float, lat: float) -> tuple[float, float]:
    """lon/lat → image pixels. The exact equirectangular transform projection.ts uses."""
    x = (lon - WEST) / (EAST - WEST) * WIDTH
    y = (NORTH - lat) / (NORTH - SOUTH) * HEIGHT
    return x, y


def rings(shape: "shapefile.Shape") -> list[list[tuple[float, float]]]:
    """Split a shape's points into its constituent rings/parts, projected to pixel space."""
    parts = list(shape.parts) + [len(shape.points)]
    out: list[list[tuple[float, float]]] = []
    for start, end in zip(parts, parts[1:]):
        pts = [project(lon, lat) for lon, lat in shape.points[start:end]]
        if len(pts) >= 2:
            out.append(pts)
    return out


def read(name: str) -> list["shapefile.Shape"]:
    """Read a Natural Earth shapefile from data/, or return [] if it isn't present (optional layers)."""
    path = DATA_DIR / f"{name}.shp"
    if not path.exists():
        print(f"  (skipping {name} — not found in {DATA_DIR})")
        return []
    return list(shapefile.Reader(str(path)).shapes())


def draw_polygons(draw: ImageDraw.ImageDraw, shapes: list["shapefile.Shape"], fill: tuple[int, int, int]) -> None:
    for shape in shapes:
        for ring in rings(shape):
            if len(ring) >= 3:
                draw.polygon(ring, fill=fill)


def draw_lines(
    draw: ImageDraw.ImageDraw, shapes: list["shapefile.Shape"], fill: tuple[int, int, int], width: int
) -> None:
    for shape in shapes:
        for ring in rings(shape):
            draw.line(ring, fill=fill, width=width, joint="curve")


def main() -> None:
    if not DATA_DIR.exists() or not any(DATA_DIR.glob("*.shp")):
        raise SystemExit(
            f"No Natural Earth shapefiles found in {DATA_DIR}.\n"
            "See scripts/mapgen/README.md for how to download them (public domain)."
        )

    img = Image.new("RGB", (WIDTH, HEIGHT), SEA)
    draw = ImageDraw.Draw(img)

    print("Rendering basemap…")
    # Land fill first, then carve lakes back to sea, then ink the coast, then thread rivers.
    draw_polygons(draw, read("ne_50m_land"), LAND)
    draw_polygons(draw, read("ne_50m_lakes"), LAKE)
    draw_lines(draw, read("ne_50m_coastline"), COAST, width=2)
    draw_lines(draw, read("ne_50m_rivers_lake_centerlines"), RIVER, width=1)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    # Palette mode + optimize keeps this lean (a few flat colours compress hard).
    img.convert("P", palette=Image.Palette.ADAPTIVE, colors=16).save(OUTPUT, optimize=True)
    kb = OUTPUT.stat().st_size / 1024
    print(f"Wrote {OUTPUT} ({kb:.0f} KB)")


if __name__ == "__main__":
    main()
