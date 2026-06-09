import { http, HttpResponse } from "msw";

// A logged-in user by default, so the gated views render under test (auth-specific tests
// override these per-case via server.use()).
const DEFAULT_USER = {
  id: 1,
  username: "tester",
  is_admin: true,
  last_translation: null,
  last_book: null,
  last_chapter: null,
  theme: null,
  created_at: "2026-01-01T00:00:00Z",
};

export const defaultHandlers = [
  http.get("/api/v1/auth/me", () => HttpResponse.json({ user: DEFAULT_USER })),
  // Echo the patched reading position back as the updated user (position-specific tests override).
  http.patch("/api/v1/auth/me", async ({ request }) => {
    const body = (await request.json()) as {
      last_translation?: string;
      last_book?: string;
      last_chapter?: number;
    };
    return HttpResponse.json({
      user: {
        ...DEFAULT_USER,
        last_translation: body.last_translation ?? null,
        last_book: body.last_book ?? null,
        last_chapter: body.last_chapter ?? null,
      },
    });
  }),
  http.post("/api/v1/auth/login", () => HttpResponse.json({ user: DEFAULT_USER })),
  http.post("/api/v1/auth/register", () =>
    HttpResponse.json({ user: DEFAULT_USER }, { status: 201 }),
  ),
  http.post("/api/v1/auth/logout", () => new HttpResponse(null, { status: 204 })),
  http.get("/healthz", () =>
    HttpResponse.json({
      status: "ok",
      version: "1.6.0",
      concord: {
        base_url: "http://localhost:8000",
        reachable: true,
        status: "ok",
        translation_count: 2,
        error: null,
      },
    }),
  ),
  http.get("/api/v1/translations", () =>
    HttpResponse.json({
      translations: [
        {
          id: "KJV",
          name: "King James Version",
          language: "en",
          versification: "standard",
          attribution: null,
        },
        {
          id: "WEB",
          name: "World English Bible",
          language: "en",
          versification: "standard",
          attribution: null,
        },
      ],
    }),
  ),
  http.get("/api/v1/books", () =>
    HttpResponse.json({
      books: [
        { id: "LUK", name: "Luke", testament: "NT", chapter_count: 24, canonical_order: 42 },
        { id: "JHN", name: "John", testament: "NT", chapter_count: 21, canonical_order: 43 },
        { id: "ACT", name: "Acts", testament: "NT", chapter_count: 28, canonical_order: 44 },
      ],
    }),
  ),
  // Echoes the requested book/chapter so navigation is observable in tests.
  http.get("/api/v1/read/:translation/:book/:chapter", ({ params }) => {
    const book = String(params.book);
    const chapter = Number(params.chapter);
    return HttpResponse.json({
      translation: String(params.translation),
      book,
      chapter,
      reference: `${book} ${chapter}`,
      verses: [
        {
          book,
          chapter,
          verse: 16,
          reference: `${book} ${chapter}:16`,
          text: `${book} ${chapter}:16 — text`,
          annotations: [],
          sermon_notes: [],
        },
      ],
    });
  }),
  http.get("/api/v1/resolve", () =>
    HttpResponse.json({ reference: "John 3", book: "JHN", chapter: 3, verse: null }),
  ),
  http.get("/api/v1/tags", () => HttpResponse.json([])),
  http.get("/api/v1/annotations", () => HttpResponse.json([])),
  http.get("/api/v1/sermon-notes", () => HttpResponse.json([])),
  http.get("/api/v1/cross-references/:book/:chapter/:verse", () => HttpResponse.json([])),
  // Topical Bible (v1.6) defaults — most verses/topics queries are panel-on-demand; topics-specific
  // tests override per-case via server.use().
  http.get("/api/v1/verse-topics/:book/:chapter/:verse", () => HttpResponse.json([])),
  http.get("/api/v1/topics/:topicId/verses", () => HttpResponse.json([])),
  // Topics browse default (Slice 2b) — the TopicsView list; browse-specific tests override
  // per-case. (No /topics/{id} detail default: TopicDetailView is test-only and sets its own.)
  http.get("/api/v1/topics", () => HttpResponse.json({ topics: [], total: 0 })),
  // Word study (v1.6) default — the verse-words strip fetches on panel open; word-study tests
  // override per-case. (No /strongs/{id} or /strongs/{id}/verses defaults: those fetch only on
  // level-2 drill-in, exercised by WordStudy.test which sets its own handlers.)
  http.get("/api/v1/verse-words/:book/:chapter/:verse", () =>
    HttpResponse.json({ reference: "JHN 3:16", text_id: "SBLGNT", tokens: [] }),
  ),
  // Journeys list default (Slice 1c) — the JourneysView list; browse-specific tests override
  // per-case. (No /journeys/{id} detail default: JourneyDetailView is test-only and sets its own.)
  http.get("/api/v1/journeys", () => HttpResponse.json({ journeys: [], total: 0 })),
  // Notes default to empty — most translations (and the public image) ship none, so the reader
  // shows no markers; notes-specific tests override per-case via server.use().
  http.get("/api/v1/notes/:translation/:book/:chapter", () => HttpResponse.json([])),
  // Section headings default to empty — most translations ship none, so the reader shows no
  // headings (and no banner); headings-specific tests override per-case via server.use().
  http.get("/api/v1/headings/:translation/:book/:chapter", () => HttpResponse.json([])),
  http.get("/api/v1/places", () => HttpResponse.json([])),
  // Gazetteer (v1.4) defaults — places-specific tests override per-case via server.use().
  http.get("/api/v1/places/browse", () => HttpResponse.json({ places: [], total: 0 })),
  http.get("/api/v1/place-types", () => HttpResponse.json([])),
  http.get("/api/v1/places/:placeId/verses", () => HttpResponse.json([])),
  // Journeys through a place (v1.6 Slice 2) — most places are on no journey, so the default is
  // empty; place-journeys tests override per-case.
  http.get("/api/v1/places/:placeId/journeys", () => HttpResponse.json([])),
  http.get("/api/v1/places/:placeId", () => HttpResponse.json({})),
  http.get("/api/v1/semantic-search", () => HttpResponse.json([])),
  // Study notes default to empty — the public image ships none, so the Search page's "Study notes"
  // section stays hidden; study-notes tests override per-case via server.use().
  http.get("/api/v1/study-notes-search", () => HttpResponse.json([])),
  // Verse of the day default — Welcome's card; verse-of-the-day tests override per-case.
  http.get("/api/v1/random-verse", () =>
    HttpResponse.json({
      translation: "KJV",
      book: "JHN",
      chapter: 3,
      verse: 16,
      reference: "John 3:16",
      text: "For God so loved the world…",
    }),
  ),
];
