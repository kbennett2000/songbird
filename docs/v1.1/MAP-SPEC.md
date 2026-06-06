# songbird — Map View (v1.1 feature spec)

The places data Concord provides comes to life on a **map**, not a list. This adds a small
**globe icon** in the reader that, when a passage has mappable places, opens a **map of those
places** — plotted on a bundled, offline Bible-world atlas, honest about confidence and about
what it can't place.

This is a **v1.1 feature.** songbird v1.0.0 ships with the existing places *list*; this is the
natural first thing built on top.

---

## 1. What this is (and is not)

**Is:** a visual map of the located places in the passage you're reading. A globe affordance in
the reader (enabled only when there's something to plot), opening a modal map with pins for
each located place, confidence shown visually, and a clear note of any places whose location is
unknown. Fully offline.

**Is not:** an interactive slippy/tile map (no pan/zoom in v1.1 — fixed-fit), no online map
service, no routing/journeys (a possible future Concord capability, not this), no editing of
place data (Concord owns the data).

## 2. The boundary — this is a pure songbird slice

**No Concord changes.** Concord already returns, per place, its **canonical coordinates,
`status`, and `confidence`** (the S6 geography endpoints songbird already proxies). The *data*
is Concord's and is done; the *map* is **presentation — songbird's**. This is the same
"know what's the foundation's job vs. what's yours" lesson: geography is handled; the map is
songbird's to build. songbird stores no new place data; it plots what Concord already serves.

## 3. The offline constraint — the design driver

The whole stack runs **offline** (Concord `--network none`; songbird offline-except-Concord;
the README promises "works without an internet connection"). Therefore:

- **No runtime calls to any map service or tile server** (no Leaflet+OSM, Mapbox, Google,
  etc.) — that would break the offline promise and add a third-party runtime dependency this
  project has always refused.
- The map is a **bundled static image asset**, shipped inside songbird, plotted on with
  songbird's own code. Zero outbound calls at runtime.

## 4. The atlas asset — the load-bearing requirement

Pins are placed by converting **lat/lon → x/y pixels** on the bundled map. That math is only
correct if the map's **projection and exact geographic bounds are known.** Therefore:

- The bundled map MUST be an **equirectangular (plate carrée) projection** with **documented
  exact bounds** (min/max longitude and latitude). Equirectangular makes the projection math
  simple and linear:
  - `x = (lon − west) / (east − west) × imageWidth`
  - `y = (north − lat) / (north − south) × imageHeight`
- **Source:** render the base map from **Natural Earth public-domain vector data** (coastlines,
  land, rivers, lakes) at commit/build time, so the **bounds are exact by construction** and
  the **licensing is clean** (Natural Earth is public domain). Style it simply and legibly
  (and ideally in keeping with songbird's parchment/ink character, but legibility first).
- **Extent:** broad enough to cover the **biblical world**, not just the Holy Land — Rome,
  Babylon, Egypt, Ararat, Tarshish, Cush, etc. (roughly the Mediterranean → Mesopotamia →
  Nile span; pick documented bounds that comfortably contain the places Concord locates).
  Anything Concord locates that falls **outside** the chosen extent is **listed as off-map**
  (see §6), never clipped silently.
- The asset stays modest in size (a static raster or a rendered vector — keep it lean; this is
  the featherweight app).

**The accuracy test (this slice's backbone — its canonical-coordinate-bridge equivalent):**
plot a set of **known landmarks at known coordinates** (e.g. Jerusalem ~31.78,35.23; Rome
~41.9,12.5; Babylon ~32.5,44.4; a Nile-delta point) and assert each pin lands at the **correct
pixel within tolerance.** Wrong pin placement is *confidently wrong* — worse than no map — so
this test is mandatory and gates the feature.

## 5. The reader affordance — the globe icon

- A **globe icon** appears in the reader for the current passage.
- **Enabled** only when the passage has **≥1 place with coordinates** (a located place). A
  passage can mention places that are *all* unknown (Eden, Nod) — places exist, but nothing is
  mappable; in that case the icon is **disabled/greyed**, with a tooltip like "No mapped
  locations in this passage." ("Greyed" means *nothing to plot*, not merely *no places*.)
- Determining enabled/disabled reuses the places data songbird already fetches for the passage
  (the existing S6 surface). (Optional small optimization: fold a "has-mappable-places" signal
  into the chapter read so the icon state needs no extra call — not required.)
- Clicking/tapping the globe opens the **map modal** (§7).

## 6. The honesty model — carried onto the map

Consistent with everything songbird/Concord already does (cross-ref votes, out-of-scope
markers, unknown places shown unknown):

- **Plot every place that has coordinates** — do **not** hide medium/low-confidence places
  (hiding them is *less* informative). Instead **encode confidence visually**:
  - **high / identified** → a solid, full pin.
  - **medium / low** → a faded or hollow pin (clearly less certain).
  - **disputed** → a distinct "contested" treatment (e.g. a different marker / a "?" ).
- **Never plot an unknown/symbolic place** (it has no coordinates — null) and **never fabricate
  a coordinate.**
- The modal **states what it can't place**: a clear line such as *"Also mentioned, location
  unknown: Eden, Nod"* and *"Off this map: Tarshish"* (for located-but-outside-extent places).
  The map never pretends to be the whole passage.

## 7. The map modal — and mobile

A **modal** (maps want room; the side panel is too cramped). **Mobile is a first-class
constraint** (songbird has a mobile audience):

- **Responsive sizing:** near-full-screen on small viewports (not a tiny centered box); the map
  image **scales to fit** its container without causing horizontal page scroll; preserves
  aspect ratio.
- **Touch-first interaction:** **tap a pin to select it** (mobile has no hover — do **not** rely
  on hover to reveal pin detail, unlike the desktop cross-refs surface). A selected pin shows a
  small card: **place name, status, confidence, and "jump to verses"** (reusing the existing
  jump — selecting a place → its verses, navigating the reader and closing the modal).
- **Finger-sized hit targets:** pins/markers are large enough to tap reliably (not 4px dots);
  overlapping pins in dense areas degrade gracefully (e.g. slight offset or a "+N here").
- **Obvious close:** a clear close control; tapping the backdrop or pressing Esc closes
  (desktop), a visible ✕ on mobile.
- **Fixed-fit view (v1.1):** the whole atlas extent is shown at once with pins plotted; **no
  pan/zoom** in v1.1 (the Holy Land clusters tightly — acceptable for v1.1; zoom is a later
  polish item, explicitly deferred).

## 8. Scope

- **Whole-chapter** places (consistent with the existing places surface), not a single selected
  verse. The map shows the located places mentioned anywhere in the chapter being read.

## 9. What's deferred (not this slice)

- Pan/zoom and clustering beyond graceful overlap handling.
- Per-verse (vs per-chapter) mapping.
- Routes/journeys between places (a possible future *Concord* capability — songbird would only
  render).
- Any online map tiles / map service (forbidden by the offline constraint).
- Heatmaps, alternate projections, multiple base maps.

## 10. Definition of done (feature)

- A globe icon in the reader, **enabled only when the chapter has ≥1 located place**, disabled
  (with tooltip) otherwise.
- Clicking it opens a **modal** with a **bundled, offline** equirectangular Bible-world map
  (rendered from Natural Earth public-domain data, documented bounds), the chapter's located
  places **plotted as pins**.
- **Pin placement is correct** (the accuracy test passes for known landmarks within tolerance).
- **Confidence is encoded visually**; unknown/symbolic places are **not** plotted but are
  **listed** ("location unknown: …"), and located-but-off-extent places are listed ("off this
  map: …").
- **Tap-to-select** a pin shows name/status/confidence/"jump to verses"; jumping reuses
  existing navigation and closes the modal.
- **Mobile-correct:** near-full-screen modal, scaled map, finger-sized pins, no hover
  dependence, obvious close.
- **Fully offline** — no runtime map-service calls.
- **No Concord changes**; songbird stores no new place data.

## 11. Open questions — resolved

1. **Asset format** → **committed PNG.** A pre-rendered raster lives at
   `frontend/src/assets/bible-map.png`, rendered from Natural Earth public-domain vectors by the
   dev-only `scripts/mapgen/generate_map.py` (pyshp + Pillow — not in the runtime). Leanest path
   (~14 KB), zero runtime deps, and bounds are exact by construction because the renderer projects
   with the *same* equirectangular transform the runtime uses. See ADR
   `docs/adr/0001-offline-bundled-equirectangular-basemap.md`.
2. **Exact bounds** → **west 10°E, east 50°E, south 13°N, north 45°N**, rendered at **1000×800 px**
   (5:4, 25 px/degree, undistorted). Contains Rome, the Nile delta, Mesopotamia/Babylon, Ararat,
   Cush. The single source of truth is `frontend/src/lib/mapBounds.ts`. Off-extent detection: a
   located place whose `project(lat, lon)` returns `null` (out of bounds) is listed under "Off this
   map", never clipped.
3. **Pin/marker visual design** → `disputed` → a `?` in an amber ring; `high`/`identified` → a
   solid filled (blue) pin; `medium`/`low`/null confidence → a faded hollow pin. Markers are
   buttons with ≥24–28px tap targets and `aria-label`s.
4. **Globe-state data path** → **reuse the existing per-chapter places fetch.** The reader runs the
   same `["places", book, chapter]` query the map and the list already use; the globe is enabled
   when ≥1 place has coordinates. No extra call, no chapter-read change, no Concord change.
5. **Overlap handling** → first cut: render all pins with a small deterministic offset for those
   that collide; clustering/"+N" is explicitly deferred (§9).
