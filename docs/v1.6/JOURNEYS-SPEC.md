# songbird — Journeys (v1.6 feature spec)

> songbird is built on **[Concord](https://github.com/kbennett2000/concord)**, which owns the
> curated journeys (Concord SPEC v7) and their honesty model; songbird stores none. See
> [the design spec](../v1/SPEC.md) for that relationship.

songbird already plots a chapter's places on a relief map. Journeys turn those scattered markers
into a **narrative route** — trace Paul's first missionary journey, follow the Exodus — an ordered
walk of stops, each tied to a passage, drawn on the map you already have. It's the most visual,
most teaching-friendly feature in the epic (the kind of thing that earns its keep in a VBS room).

Two honest framings up front. First: journeys are the most **self-contained** feature here — a
small curated set, not a per-verse layer — but they need a capability the chapter map *doesn't*
have. `MapView` clusters a chapter's place markers; it draws no route. So this builds a **new
route-rendering map component** on top of the existing base-map plumbing — real work, not a clone.
Second: Concord deliberately scoped journeys to avoid a "competing-routes tar pit," so the data
carries its honesty in the open — per-stop confidence/status, unlocated stops, and a
**one-reconstruction `note`** per journey. songbird's job is to present that faithfully, never to
imply a GPS-precise path. That lines up exactly with the `PlaceHonesty` discipline already in place.

Fourth and final feature of the **v1.6 fan-out epic**. The shared Concord pin (epic **Slice 0**,
PR #96) already landed — **no new infra gate**, pure songbird.

---

## 1. What this is (and is not)

**Is:**
- **(Slice 1)** a **Journeys** surface — a list of journeys → a journey detail = a **route map**
  (the located stops drawn as an ordered line with numbered markers) + the **ordered stop list**
  (each with its scripture reference → jump, plus confidence/status), shown alongside the journey's
  `source` and its one-reconstruction `note`.
- **(Slice 2)** "Journeys through here" on `PlaceDetailView` (the reverse lookup).

**Is not:**
- **route editing or alternative-route authoring** — read-only, curated; songbird is explicitly
  *not* a place to assemble competing reconstructions (the tar pit Concord scoped against).
- **animated / turn-by-turn playback** — a static route is the honest representation.
- **mapping unlocated stops** — a stop with no confident location appears in the *list*, never as a
  guessed pin (honesty model).
- **claiming the precise path between stops** — the line connects located stops schematically; it
  is not an assertion of the exact route walked. The `note` carries that caveat, surfaced.

## 2. The boundary — pure songbird (one new map capability), no new Slice 0

Concord **v1.2.0** already exposes every journey endpoint, and the pin + fixture are already at
v1.2.0 (epic Slice 0, PR #96). **No Concord change.** The proxy backend is the topics/places shape
again. The one genuinely new thing is **frontend**: a route-drawing map component. The existing
`MapView` does clustered chapter markers and no polyline, so journeys add a new component built on
the shared base-map plumbing (`lib/map/style.ts` `buildStyle` — the bundled pmtiles relief, ADR
0003; `lib/map/config.ts`; `lib/map/bounds.ts`). Not a Concord change — a songbird capability.

## 3. Concord contract used

```
GET /v1/journeys?limit=&offset=
  → { limit, offset, total, journeys: [ {id, name, scripture, dating?, stop_count} ] }            (Slice 1)

GET /v1/journeys/{id}
  → { id, name, scripture, dating?, source, note,
      stops: [ {ordinal, place_id, name?, friendly_id?, latitude?, longitude?,
                confidence?, status?, reference?} ] }                                              (Slice 1)
    # latitude/longitude/confidence are null when the place has no confident location (honesty model) —
    #   such a stop is listed but NOT mapped. `reference` is the optional scripture citation for that leg.
    # `note` is the one-reconstruction caveat (e.g. "sea crossings drawn as direct lines") — surface it.

GET /v1/places/{id}/journeys
  → { id, total, journeys: [JourneySummary] }                              # the inverse lookup     (Slice 2)
```

`JourneySummary` is shared across all three. A bad/unknown id → 4xx (a not-found), like the others.

## 4. songbird changes

### Slice 1a — backend (all three journey proxies)

The topics/places proxy shape. `api/topics.py` + the places client methods are the templates.

- **Client** (`concord/client.py`), mirroring `list_topics` / `get_topic` / `get_topic_verses`:
  - `list_journeys(limit=50, offset=0)` → `JourneysResponse` (only limit/offset — `/v1/journeys`
    takes no filters).
  - `get_journey(journey_id)` → `JourneyDetail` (quoted id; 400/404 → `ConcordNotFoundError`).
  - `get_place_journeys(place_id)` → `PlaceJourneysResponse` (for Slice 2; cheap to land now).
- **Concord schema** (`concord/schemas.py`): `JourneySummary` (id, name, scripture, dating,
  stop_count), `JourneysResponse`, `JourneyStop` (ordinal, place_id, then name / friendly_id /
  latitude / longitude / confidence / status / reference **all nullable**), `JourneyDetail` (id,
  name, scripture, dating, source, note, stops), `PlaceJourneysResponse`.
- **songbird API** (`api/journeys.py`, **new** router `prefix="/api/v1"`, `tags=["journeys"]`,
  mounted in `main.py`):
  - `GET /journeys?limit=&offset=` → `JourneysPageOut` (`{ journeys, total }`, mirror
    `PlacesPageOut`/`TopicsPageOut`).
  - `GET /journeys/{journey_id}` → `JourneyDetail` (API-layer; carries `note`, `source`, and the
    ordered `stops`).
  - `GET /places/{place_id}/journeys` → `list[JourneySummary]` (bare list — reverse lookup, like
    `/verse-topics`).
  - All **surface errors** (screen primary content): `ConcordNotFoundError` → `404 NOT_FOUND`;
    `ConcordUnreachableError` → `502 CONCORD_UNREACHABLE`. `api/schemas.py` gains API-layer
    `JourneySummary`, `JourneysPageOut`, `JourneyStop`, `JourneyDetail` — **both mirrors kept**.
- **Contract** (**required**): add `("GET", "/v1/journeys")`, `("GET", "/v1/journeys/{}")`, and
  `("GET", "/v1/places/{}/journeys")` to `_REQUIRED_ENDPOINTS`. (Version assertion untouched.)

### Slice 1b — the route map + journey detail (the novel piece)

- **Fetch** (`schemas.ts` + `lib/reader.ts`): `journeySummarySchema`, `journeyStopSchema` (the
  nullable coord/confidence/status/name/reference fields — match 1a so the parse never throws),
  `journeyDetailSchema`, `journeysPageSchema` (`{ journeys, total }`). `fetchJourneys(limit?,
  offset?)`, `fetchJourney(journeyId)`, `fetchPlaceJourneys(placeId)` (the last for Slice 2).
- **Pure route geometry** (`lib/map/journey.ts`, **unit-tested** — mirrors `lib/map/places.ts` /
  `bounds.ts`): a pure function `stops → { route: [lng, lat][], markers: {ordinal, lng, lat}[] }`
  that **filters out unlocated stops** (null lat/lng), **orders by `ordinal`**, and builds the line
  coordinates and the numbered-marker list. Keeping this pure is what makes journeys testable
  without driving MapLibre (the same split songbird already uses: pure `lib/map/*.ts` + thin GL
  glue).
- **`JourneyMap` component** (`frontend/src/components/JourneyMap.tsx`, **new**): reuses the base
  map (`buildStyle`, `lib/map/config`, `boundsForPlaces`/bounds to fit the located stops) and adds
  a **GL line layer** (the route, from `journey.ts`'s coords) plus **ordered/numbered markers** (the
  stop ordinals). Props: `{ stops, onJump }`. **No clustering, no chapter fetch** (unlike
  `MapView`). Unlocated stops never appear on the map. A marker → reveals/anchors its stop; a
  stop's `reference` → `onJump`.
- **`JourneyDetailView`** (`frontend/src/routes/JourneyDetailView.tsx`, **new**): `useQuery(["journey",
  id])` → `fetchJourney`; renders the metadata (`name`, `scripture`, `dating` when present,
  `source`), the **one-reconstruction `note` as a prominent callout** (the honesty requirement —
  not a footnote), the `JourneyMap`, and the **ordered stop list**: each row shows the ordinal,
  place `name`, its `reference` (→ jump when present), and confidence/status via the existing
  `PlaceHonesty` visual treatment; located *and* unlocated stops both appear in the list (unlocated
  simply aren't on the map). Errors **surface** (primary content). Optional connective nicety: a
  stop's place name links to `/places/{place_id}` (closes the loop with Slice 2).

### Slice 1c — the Journeys list surface

- **`JourneysView`** (`frontend/src/routes/JourneysView.tsx`, **new**): `TopNav` gains a
  **Journeys** entry; a **plain paginated list** of journeys (name, scripture, dating, stop_count) →
  click → `JourneyDetailView`. Simpler than `TopicsView`/`PlacesView` — `/journeys` takes no
  `q`/filter, so there's **no search box** (a small curated set; just paginate off `total`). Wire
  `/journeys` → `JourneysView` and `/journeys/:id` → `JourneyDetailView` in `App.tsx`, like the
  places pair.

### Slice 2 — "Journeys through here" on `PlaceDetailView` (frontend only)

The backend (`get_place_journeys`) shipped in 1a. Add a `useQuery(["place-journeys", id])` →
`fetchPlaceJourneys` and render a **"Journeys through here"** section after the verses section: a
list of the journeys naming this place, each linking to `/journeys/{id}`. Empty (no journeys) and
error handled like the verses section.

## 5. Tests

### Slice 1a (backend, `journeys_test.py`)
list_journeys (pagination, total); get_journey (detail incl. `stops`, `note`, `source`; `dating`
null tolerated); get_place_journeys (reverse lookup); unknown id → `404`; unreachable → `502`.
`FakeConcordClient` gains the three methods.

### Slice 1b (frontend)
- `journey.test.ts` (the pure geometry): unlocated stops are filtered out of the route + markers;
  stops are ordered by `ordinal`; the line coords match. *(This carries the load-bearing logic so
  the GL component stays thin.)*
- `JourneyMap.test.tsx`: asserts on what's testable without WebGL — that it's handed only located
  stops / builds the layer from the filtered coords (lean on `journey.ts`); a stop `reference`
  triggers `onJump`.
- `JourneyDetailView.test.tsx`: renders metadata + **the `note` callout** (assert it's shown — the
  honesty check); the ordered stop list; a stop `reference` jumps; confidence/status render; an
  unlocated stop still appears in the list; error state. MSW handler for `/journeys/{id}`.

### Slice 1c (frontend)
`JourneysView.test.tsx`: lists journeys; pagination off `total`; click → detail. MSW handler for
`/journeys`.

### Slice 2 (frontend)
`PlaceDetailView.test.tsx`: a "Journeys through here" section lists journeys + links to
`/journeys/{id}`; empty handled; error handled. MSW handler for `/places/{id}/journeys`.

## 6. Definition of done

- **Slice 1a:** the three proxy routes exist and pass their tests; both schema mirrors present; the
  contract pins the three endpoints (version unchanged); `make check` + `make check-frontend` green;
  a `dev-notes.md` entry.
- **Slice 1b:** a journey detail (reachable at `/journeys/:id`) draws its located stops as an
  ordered route with numbered markers, lists every stop (located and not) with references that jump
  and confidence/status shown, and surfaces the one-reconstruction `note` prominently; the route
  geometry is a unit-tested pure function; gates green; a `dev-notes.md` entry.
- **Slice 1c:** a **Journeys** top-nav surface lists the journeys and opens their details; gates
  green; a `dev-notes.md` entry.
- **Slice 2:** a place's detail shows the journeys that pass through it, linking to each; gates
  green; a `dev-notes.md` entry.

## 7. PR shape

- **Slice 1a — backend:** three proxies + schemas + contract lines + tests.
- **Slice 1b — the map:** `lib/map/journey.ts` + `JourneyMap` + `JourneyDetailView` (reachable by
  URL). **Recommended as its own PR** so the novel route-rendering is reviewed in isolation — it's
  the one genuinely new capability in the whole epic.
- **Slice 1c — the list:** `JourneysView` + `TopNav` + routing. Small.
- **Slice 2 — the place hook:** the `PlaceDetailView` section. Small (1c and 2 are both small and
  could combine if you'd rather, but they touch different surfaces).

Load-bearing correctness lives in 1b: the **honesty presentation** (the `note` callout,
unlocated-stops-listed-not-mapped, confidence/status) — songbird's side of Concord's anti-tar-pit
scoping — and the **route geometry** as a tested pure function so the MapLibre glue stays thin.

## 8. Invariants (CLAUDE.md)

Consume Concord over HTTP through the one client; songbird owns zero Scripture text — journeys and
their stops are Concord-owned curated data, proxied verbatim; branch + PR per slice; tests required;
types/lint clean; never self-merge, push to `main`, or `--force`.
