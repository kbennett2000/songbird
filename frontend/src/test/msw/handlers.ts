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
];
