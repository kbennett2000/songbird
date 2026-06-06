import { http, HttpResponse } from "msw";

export const defaultHandlers = [
  http.get("/healthz", () =>
    HttpResponse.json({
      status: "ok",
      version: "0.1.0",
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
        },
      ],
    });
  }),
  http.get("/api/v1/resolve", () =>
    HttpResponse.json({ reference: "John 3", book: "JHN", chapter: 3, verse: null }),
  ),
];
