# mapgen — the bundled Bible-world basemap

`generate_map.py` renders the offline atlas that songbird's Map View plots places onto:
[`frontend/src/assets/bible-map.svg`](../../frontend/src/assets/bible-map.svg).

This is a **dev/build-time tool**. The SVG it produces is committed to the repo and is what
ships; **songbird's runtime never runs this script** and never depends on its library. That is
why `requirements.txt` here (`pyshp`) is intentionally separate from the backend requirements —
the runtime stays lean (no geo/ML stack), per the dependency-discipline canon. The output is
**vector SVG** (not raster) so the basemap stays crisp at any zoom level (see
[`docs/adr/0002`](../../docs/adr/0002-vector-basemap-and-pan-zoom.md)); the geometry is clipped to
the viewBox so the committed file stays small.

## Why it can be trusted (the load-bearing bit)

The map is **equirectangular (plate carrée)** with exact, documented bounds. The renderer
projects lon/lat → pixels with the **same linear transform** the runtime uses
([`frontend/src/lib/projection.ts`](../../frontend/src/lib/projection.ts)), into the **same
bounds and pixel size** ([`frontend/src/lib/mapBounds.ts`](../../frontend/src/lib/mapBounds.ts)).
Because the coastlines and the pins are placed by identical math, a pin lands exactly where the
coastline says it should. The pixel-accuracy test
([`frontend/src/lib/projection.test.ts`](../../frontend/src/lib/projection.test.ts)) locks the
runtime side of that contract.

⚠ The bounds/size are duplicated at the top of `generate_map.py` and in `mapBounds.ts`. If you
change one, change the other and re-run this script.

## Bounds

```
west = 10°E   east = 50°E    north = 45°N   south = 13°N    image = 1000 × 800 px
```

Comfortably contains the biblical world Concord locates — Rome, the Nile delta,
Mesopotamia/Babylon, Ararat, Cush. Places outside the box (e.g. Tarshish in Iberia) are surfaced
by songbird as "off this map", never clipped.

## Data — Natural Earth (public domain)

Source: [Natural Earth](https://www.naturalearthdata.com/) 1:50m physical vectors. Natural Earth
is released into the **public domain** (no permission or attribution required; credit is
appreciated). The source vectors are **not** committed — only the rendered SVG is.

Download once (this is the only step that touches the network; the renderer itself makes zero
network calls), unzip into `scripts/mapgen/data/` (gitignored):

- `ne_50m_land` — land polygons (required)
- `ne_50m_coastline` — coastlines (required)
- `ne_50m_lakes` — lakes (optional; carved back to sea colour)
- `ne_50m_rivers_lake_centerlines` — rivers (optional)

You want the `.shp`, `.shx`, and `.dbf` for each. Layout:

```
scripts/mapgen/data/
  ne_50m_land.shp        ne_50m_land.shx        ne_50m_land.dbf
  ne_50m_coastline.shp   ne_50m_coastline.shx   ne_50m_coastline.dbf
  ne_50m_lakes.shp       …
  ne_50m_rivers_lake_centerlines.shp …
```

## Regenerate

```sh
pip install -r scripts/mapgen/requirements.txt
python scripts/mapgen/generate_map.py
```

Then commit the updated `frontend/src/assets/bible-map.svg` and run the frontend test suite.
