# tilegen — the bundled, offline map assets

`build.py` produces the two committed assets MapLibre renders in songbird's Map View:

- [`frontend/public/tiles/relief.pmtiles`](../../frontend/public/tiles/relief.pmtiles) — natural-color
  shaded-relief **raster** tiles (terrain, deserts, seas).
- [`frontend/public/tiles/bible-physical.geojson`](../../frontend/public/tiles/bible-physical.geojson) —
  the physical **vector** overlay (coastlines, rivers, lakes, playas, reefs, minor islands), crisp at
  any zoom.

This is a **dev/build-time tool**. The outputs are committed and are what ships; **songbird's runtime
never runs this script** and never depends on its libraries. That is why `requirements.txt` here
(`rasterio`, `rio-pmtiles`, `pyshp`) is separate from the backend requirements — the runtime stays
lean (no geo/ML stack), per the dependency-discipline canon.

## Why this keeps the offline promise

The renderer (MapLibre GL) reads **only** these committed files, served by songbird's own backend over
HTTP Range. No tile server, no map CDN, **zero outbound calls at runtime** — Concord remains the only
runtime network dependency (see [`docs/adr/0003`](../../docs/adr/0003-maplibre-offline-pmtiles-basemap.md)).
Text (curated labels, cluster counts) is drawn as DOM markers, so **no font/glyph CDN is needed** either.

## Extent (single source of truth)

```
WEST 9°E   SOUTH 12°N   EAST 51°E   NORTH 46°N
```

A small margin around the map's `BIBLE_WORLD_BOUNDS` (10–50°E, 13–45°N). **⚠ Keep `BBOX` in
`build.py` in lockstep with `frontend/src/lib/map/config.ts`.** Re-run this script if either changes.

## Data — Natural Earth (public domain)

Source: [Natural Earth](https://www.naturalearthdata.com/) — public domain (no permission/attribution
required; credit appreciated). Sources are **not** committed (only the rendered outputs are); download
them once into `scripts/tilegen/data/` (gitignored). Downloading is the only step that touches the
network; the build itself makes zero network calls.

```sh
cd scripts/tilegen/data
base=https://naturalearth.s3.amazonaws.com
curl -O $base/10m_raster/NE1_HR_LC_SR_W.zip          # natural-color relief (~323 MB)
for f in coastline rivers_lake_centerlines_scale_rank lakes playas reefs minor_islands; do
  curl -O $base/10m_physical/ne_10m_$f.zip
done
```

`build.py` unzips these automatically.

## Regenerate

```sh
pip install -r scripts/tilegen/requirements.txt   # ships manylinux wheels; no system GDAL needed
python scripts/tilegen/build.py
```

Then commit the updated `frontend/public/tiles/*` and run the frontend test suite.
