#!/usr/bin/env python3
"""Build songbird's bundled, offline map assets from Natural Earth public-domain data.

Outputs (committed; what ships):
  frontend/public/tiles/relief.pmtiles        — natural-color shaded-relief RASTER tiles
  frontend/public/tiles/bible-physical.geojson — physical VECTOR overlay (coast/rivers/lakes/…)

This is a **dev/build-time tool only**. songbird's runtime never runs it and never depends on its
libraries (rasterio/rio-pmtiles/pyshp live in this folder's requirements.txt, NOT the backend
runtime — the runtime stays lean, per canon). The map renderer (MapLibre) reads only the committed
outputs, served locally by songbird's own backend over HTTP Range — zero outbound calls at runtime,
so the offline invariant holds.

⚠ BBOX below is the single source of truth for the map's extent — keep it in lockstep with
`frontend/src/lib/map/config.ts` (BIBLE_WORLD_BOUNDS, plus this margin). Re-run on data/bounds change.

Usage:
    pip install -r scripts/tilegen/requirements.txt
    # download Natural Earth sources into scripts/tilegen/data/ (see README.md)
    python scripts/tilegen/build.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import zipfile
from pathlib import Path

import shapefile  # pyshp

# --- Extent (single source of truth; mirror in frontend/src/lib/map/config.ts) ---------------
# A small margin beyond BIBLE_WORLD_BOUNDS (10..50 E, 13..45 N) so edge features render cleanly.
WEST, SOUTH, EAST, NORTH = 9.0, 12.0, 51.0, 46.0

# Relief raster zoom ceiling. Natural Earth HR (~2400 px across this box) is the source limit;
# MapLibre over-zooms the raster past this while the vector overlay stays crisp.
RELIEF_MAX_ZOOM = 8

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
OUT = HERE.parents[1] / "frontend" / "public" / "tiles"

RELIEF_SRC = "NE1_HR_LC_SR_W"  # Natural Earth I: natural color + shaded relief + water

# Vector layers → the `kind` each feature is tagged with in the combined GeoJSON.
VECTOR_LAYERS: list[tuple[str, str, str]] = [
    # (shapefile stem, kind, geom: "line" | "polygon")
    ("ne_10m_coastline", "coastline", "line"),
    ("ne_10m_rivers_lake_centerlines_scale_rank", "river", "line"),
    ("ne_10m_lakes", "lake", "polygon"),
    ("ne_10m_playas", "playa", "polygon"),
    ("ne_10m_reefs", "reef", "line"),
    ("ne_10m_minor_islands", "island", "polygon"),
]

Point = tuple[float, float]
CLIP = (WEST, SOUTH, EAST, NORTH)


# --- Geometry clipping to the bbox (keeps the committed GeoJSON small) -----------------------
def clip_polygon(ring: list[Point]) -> list[Point]:
    """Sutherland–Hodgman: clip a polygon ring (lon/lat) to the bbox. [] if fully outside."""
    xmin, ymin, xmax, ymax = CLIP
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
            if inside(cur):
                if not inside(prev):
                    out.append(_intersect(prev, cur, axis, bound))
                out.append(cur)
            elif inside(prev):
                out.append(_intersect(prev, cur, axis, bound))
        poly = out
    return poly


def _intersect(a: Point, b: Point, axis: str, bound: float) -> Point:
    if axis == "x":
        t = (bound - a[0]) / (b[0] - a[0])
        return (bound, a[1] + t * (b[1] - a[1]))
    t = (bound - a[1]) / (b[1] - a[1])
    return (a[0] + t * (b[0] - a[0]), bound)


def _code(p: Point) -> int:
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
    """Cohen–Sutherland: clip a segment (lon/lat) to the bbox, or None if fully outside."""
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


def _rings(shape: "shapefile.Shape") -> list[list[Point]]:
    parts = list(shape.parts) + [len(shape.points)]
    out: list[list[Point]] = []
    for start, end in zip(parts, parts[1:]):
        pts = [(float(x), float(y)) for x, y in shape.points[start:end]]
        if len(pts) >= 2:
            out.append(pts)
    return out


def _round(pts: list[Point]) -> list[list[float]]:
    return [[round(x, 4), round(y, 4)] for x, y in pts]


# --- Build the vector overlay GeoJSON --------------------------------------------------------
def build_vectors() -> None:
    features: list[dict] = []
    for stem, kind, geom in VECTOR_LAYERS:
        shp = DATA / f"{stem}.shp"
        if not shp.exists():
            print(f"  (skipping {stem} — not found)")
            continue
        n = 0
        for shape in shapefile.Reader(str(shp)).shapes():
            if geom == "polygon":
                clipped = [clip_polygon(r) for r in _rings(shape)]
                clipped = [c for c in clipped if len(c) >= 3]
                if not clipped:
                    continue
                features.append(
                    {
                        "type": "Feature",
                        "properties": {"kind": kind},
                        "geometry": {
                            "type": "Polygon" if len(clipped) == 1 else "MultiPolygon",
                            "coordinates": (
                                [_round(clipped[0])]
                                if len(clipped) == 1
                                else [[_round(c)] for c in clipped]
                            ),
                        },
                    }
                )
                n += 1
            else:  # line
                segs: list[list[list[float]]] = []
                for ring in _rings(shape):
                    run: list[Point] = []
                    for i in range(len(ring) - 1):
                        clipped_seg = clip_segment(ring[i], ring[i + 1])
                        if clipped_seg is None:
                            if len(run) >= 2:
                                segs.append(_round(run))
                            run = []
                            continue
                        a, b = clipped_seg
                        if not run:
                            run = [a, b]
                        else:
                            run.append(b)
                    if len(run) >= 2:
                        segs.append(_round(run))
                if not segs:
                    continue
                features.append(
                    {
                        "type": "Feature",
                        "properties": {"kind": kind},
                        "geometry": {
                            "type": "LineString" if len(segs) == 1 else "MultiLineString",
                            "coordinates": segs[0] if len(segs) == 1 else segs,
                        },
                    }
                )
                n += 1
        print(f"  {kind}: {n} features")

    OUT.mkdir(parents=True, exist_ok=True)
    fc = {"type": "FeatureCollection", "features": features}
    dest = OUT / "bible-physical.geojson"
    dest.write_text(json.dumps(fc, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {dest} ({dest.stat().st_size / 1024:.0f} KB, {len(features)} features)")


# --- Build the relief raster PMTiles ---------------------------------------------------------
def build_relief() -> None:
    tif = next(DATA.glob(f"{RELIEF_SRC}*/*.tif"), None) or next(DATA.glob(f"{RELIEF_SRC}*.tif"), None)
    if tif is None:
        print(f"  (skipping relief — {RELIEF_SRC}.tif not found in {DATA})")
        return

    # A bbox-polygon cutline so rio-pmtiles only exports tiles within our extent (tiny output).
    cutline = DATA / "_bbox.geojson"
    cutline.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {},
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [
                                [
                                    [WEST, SOUTH],
                                    [EAST, SOUTH],
                                    [EAST, NORTH],
                                    [WEST, NORTH],
                                    [WEST, SOUTH],
                                ]
                            ],
                        },
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / "relief.pmtiles"
    # rio-pmtiles is a CLI; use the one next to this interpreter (works inside a venv off PATH).
    rio = Path(sys.executable).parent / "rio"
    cmd = [
        str(rio) if rio.exists() else "rio", "pmtiles", str(tif), "-o", str(dest),
        "--zoom-levels", f"0..{RELIEF_MAX_ZOOM}",
        "--format", "WEBP", "--resampling", "lanczos",
        "--cutline", str(cutline),
        "--name", "songbird relief",
        "--attribution", "Natural Earth (public domain)",
    ]
    print("Building relief.pmtiles (rio pmtiles)…")
    subprocess.run(cmd, check=True)
    print(f"Wrote {dest} ({dest.stat().st_size / 1024 / 1024:.1f} MB)")


def ensure_unzipped() -> None:
    """Unzip any Natural Earth .zip in data/ that hasn't been extracted yet."""
    for zip_path in DATA.glob("*.zip"):
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(DATA)


def main() -> None:
    if not DATA.exists() or not any(DATA.iterdir()):
        sys.exit(f"No Natural Earth sources in {DATA}. See scripts/tilegen/README.md.")
    ensure_unzipped()
    build_vectors()
    build_relief()


if __name__ == "__main__":
    main()
