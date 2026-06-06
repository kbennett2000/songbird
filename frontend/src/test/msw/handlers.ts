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
        {
          id: "JHN",
          name: "John",
          testament: "NT",
          chapter_count: 21,
          canonical_order: 43,
        },
      ],
    }),
  ),
  http.get("/api/v1/read/:translation/:book/:chapter", () =>
    HttpResponse.json({
      translation: "KJV",
      book: "JHN",
      chapter: 3,
      reference: "John 3",
      verses: [
        {
          book: "JHN",
          chapter: 3,
          verse: 16,
          reference: "John 3:16",
          text: "For God so loved the world...",
          annotations: [],
        },
        {
          book: "JHN",
          chapter: 3,
          verse: 17,
          reference: "John 3:17",
          text: "For God sent not his Son...",
          annotations: [],
        },
      ],
    }),
  ),
];
