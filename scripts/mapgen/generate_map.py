#!/usr/bin/env python3
"""Render the bundled Bible-world basemap from Natural Earth public-domain vectors, as SVG.

This is a **dev/build-time tool only**. Its output — `frontend/src/assets/bible-map.svg` — is
committed to the repo; songbird's runtime ships only that SVG and never runs this script. So its
one dependency (`pyshp`, to read the shapefiles) lives in `scripts/mapgen/requirements.txt` and is
deliberately NOT in the backend runtime requirements (dependency-discipline canon: no heavy geo
stack in songbird).

The map is **equirectangular (plate carrée)**. Crucially, this script projects lon/lat to the SVG
coordinate space with the *exact same* linear transform the runtime uses
(`frontend/src/lib/projection.ts`), into the *exact same* bounds and `viewBox` size
(`frontend/src/lib/mapBounds.ts`). That shared transform is what guarantees pins land where the
coastlines say they should — the basemap and the pins cannot drift.

SVG (vector) rather than PNG (raster): the map view supports pan/zoom, and a vector basemap stays
crisp at any zoom level (see docs/adr/0002). The geometry is the same Natural Earth source and the
same projection; only the output format changed.

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

# --- Single source of truth — keep in lockstep with frontend/src/lib/mapBounds.ts -------------
WEST, EAST, SOUTH, NORTH = 10.0, 50.0, 13.0, 45.0
WIDTH, HEIGHT = 1000, 800

# --- Parchment / ink palette (on-brand; legibility first) -------------------------------------
SEA = "#f4ecd8"  # warm parchment
LAND = "#e7dbc1"  # faint warm land fill, a shade darker than the sea
COAST = "#5a4a3a"  # ink / sepia coastline
RIVER = "#788694"  # muted blue-grey rivers

DATA_DIR = Path(__file__).parent / "data"
OUTPUT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "assets" / "bible-map.svg"

# Clip everything to the viewBox (plus a small margin so edge strokes look right). Natural Earth
# is global; without this the SVG would carry every continent's geometry — megabytes of paths the
# viewBox merely hides. Clipping keeps the committed asset small AND identical on screen.
MARGIN = 16.0
CLIP = (-MARGIN, -MARGIN, WIDTH + MARGIN, HEIGHT + MARGIN)  # (xmin, ymin, xmax, ymax)


def project(lon: float, lat: float) -> tuple[float, float]:
    """lon/lat → SVG units. The exact equirectangular transform projection.ts uses."""
    x = (lon - WEST) / (EAST - WEST) * WIDTH
    y = (NORTH - lat) / (NORTH - SOUTH) * HEIGHT
    return x, y


def rings(shape: "shapefile.Shape") -> list[list[tuple[float, float]]]:
    """Split a shape's points into its constituent rings/parts, projected to SVG space."""
    parts = list(shape.parts) + [len(shape.points)]
    out: list[list[tuple[float, float]]] = []
    for start, end in zip(parts, parts[1:]):
        pts = [project(lon, lat) for lon, lat in shape.points[start:end]]
        if len(pts) >= 2:
            out.append(pts)
    return out


Point = tuple[float, float]


def clip_polygon(ring: list[Point]) -> list[Point]:
    """Sutherland–Hodgman: clip a polygon ring to the CLIP rectangle. Returns [] if fully outside."""
    xmin, ymin, xmax, ymax = CLIP
    # Each edge is (inside-test, intersect) against one rectangle side.
    edges = (
        (lambda p: p[0] >= xmin, "x", xmin),
        (lambda p: p[0] <= xmax, "x", xmax),
        (lambda p: p[1] >= ymin, "y", ymin),
        (lambda p: p[1] <= ymax, "y", ymax),
    )
    poly = ring
    for inside, axis, bound in edges:
        if not poly:
            break
        out: list[Point] = []
        for i, cur in enumerate(poly):
            prev = poly[i - 1]
            cur_in, prev_in = inside(cur), inside(prev)
            if cur_in:
                if not prev_in:
                    out.append(_intersect(prev, cur, axis, bound))
                out.append(cur)
            elif prev_in:
                out.append(_intersect(prev, cur, axis, bound))
        poly = out
    return poly


def _intersect(a: Point, b: Point, axis: str, bound: float) -> Point:
    """Where segment a→b crosses the line axis==bound."""
    if axis == "x":
        t = (bound - a[0]) / (b[0] - a[0])
        return (bound, a[1] + t * (b[1] - a[1]))
    t = (bound - a[1]) / (b[1] - a[1])
    return (a[0] + t * (b[0] - a[0]), bound)


def _code(p: Point) -> int:
    """Cohen–Sutherland region code for a point against the CLIP rectangle."""
    xmin, ymin, xmax, ymax = CLIP
    c = 0
    if p[0] < xmin:
        c |= 1
    elif p[0] > xmax:
        c |= 2
    if p[1] < ymin:
        c |= 4
    elif p[1] > ymax:
        c |= 8
    return c


def clip_segment(a: Point, b: Point) -> tuple[Point, Point] | None:
    """Cohen–Sutherland: clip a single segment to the CLIP rectangle, or None if fully outside."""
    xmin, ymin, xmax, ymax = CLIP
    ax, ay = a
    bx, by = b
    ca, cb = _code((ax, ay)), _code((bx, by))
    while True:
        if not (ca | cb):
            return (ax, ay), (bx, by)
        if ca & cb:
            return None
        c = ca or cb
        if c & 8:
            x, y = ax + (bx - ax) * (ymax - ay) / (by - ay), ymax
        elif c & 4:
            x, y = ax + (bx - ax) * (ymin - ay) / (by - ay), ymin
        elif c & 2:
            x, y = xmax, ay + (by - ay) * (xmax - ax) / (bx - ax)
        else:
            x, y = xmin, ay + (by - ay) * (xmin - ax) / (bx - ax)
        if c == ca:
            ax, ay, ca = x, y, _code((x, y))
        else:
            bx, by, cb = x, y, _code((x, y))


def read(name: str) -> list["shapefile.Shape"]:
    """Read a Natural Earth shapefile from data/, or return [] if it isn't present (optional layers)."""
    path = DATA_DIR / f"{name}.shp"
    if not path.exists():
        print(f"  (skipping {name} — not found in {DATA_DIR})")
        return []
    return list(shapefile.Reader(str(path)).shapes())


def _poly_to_d(ring: list[Point]) -> str:
    head = ring[0]
    parts = [f"M{head[0]:.1f},{head[1]:.1f}"]
    parts += [f"L{x:.1f},{y:.1f}" for x, y in ring[1:]]
    parts.append("Z")
    return "".join(parts)


def polygons_d(shapes: list["shapefile.Shape"]) -> str:
    """One SVG path `d` for filled shapes, each ring clipped to the viewBox. Coords rounded to 0.1px."""
    segments: list[str] = []
    for shape in shapes:
        for ring in rings(shape):
            clipped = clip_polygon(ring)
            if len(clipped) >= 3:
                segments.append(_poly_to_d(clipped))
    return "".join(segments)


def lines_d(shapes: list["shapefile.Shape"]) -> str:
    """One SVG path `d` for stroked shapes, each segment clipped to the viewBox. Coords rounded to 0.1px."""
    segments: list[str] = []
    for shape in shapes:
        for ring in rings(shape):
            for i in range(len(ring) - 1):
                seg = clip_segment(ring[i], ring[i + 1])
                if seg is None:
                    continue
                (ax, ay), (bx, by) = seg
                segments.append(f"M{ax:.1f},{ay:.1f}L{bx:.1f},{by:.1f}")
    return "".join(segments)


def main() -> None:
    if not DATA_DIR.exists() or not any(DATA_DIR.glob("*.shp")):
        raise SystemExit(
            f"No Natural Earth shapefiles found in {DATA_DIR}.\n"
            "See scripts/mapgen/README.md for how to download them (public domain)."
        )

    print("Rendering basemap (SVG)…")
    # Land fill first, then carve lakes back to sea, then ink the coast, then thread rivers —
    # the same layer order the raster renderer used, expressed as stacked SVG paths.
    land = polygons_d(read("ne_50m_land"))
    lakes = polygons_d(read("ne_50m_lakes"))
    coast = lines_d(read("ne_50m_coastline"))
    rivers = lines_d(read("ne_50m_rivers_lake_centerlines"))

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}" '
        f'preserveAspectRatio="xMidYMid meet" role="img" '
        f'aria-label="Map of the biblical world">'
        f'<rect width="{WIDTH}" height="{HEIGHT}" fill="{SEA}"/>'
        f'<path d="{land}" fill="{LAND}" fill-rule="evenodd"/>'
        f'<path d="{lakes}" fill="{SEA}" fill-rule="evenodd"/>'
        f'<path d="{coast}" fill="none" stroke="{COAST}" stroke-width="1.5" '
        f'stroke-linejoin="round" stroke-linecap="round"/>'
        f'<path d="{rivers}" fill="none" stroke="{RIVER}" stroke-width="0.8" '
        f'stroke-linejoin="round" stroke-linecap="round"/>'
        f"</svg>\n"
    )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(svg, encoding="utf-8")
    kb = OUTPUT.stat().st_size / 1024
    print(f"Wrote {OUTPUT} ({kb:.0f} KB)")


if __name__ == "__main__":
    main()
