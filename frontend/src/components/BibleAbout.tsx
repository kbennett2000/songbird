import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { DocumentDialog } from "@/components/DocumentDialog";
import { DOCUMENT_COLUMN, DOCUMENT_TEXT, useDocumentPictures } from "@/components/DocumentText";
import { NoteMarkdown } from "@/components/NoteMarkdown";
import { ReadingPlanBar, ReadingPlanMonth } from "@/components/ReadingPlan";
import { aboutGroups, aboutKindLabel, documentListOptions, documentOptions } from "@/lib/documents";
import { type PlanDay, parseReadingPlan, planDayId, todayIn } from "@/lib/readingPlan";

/**
 * Where the About page is: the list (`slug` null) or one document, and on a reading plan the month
 * and the day last gone to (null month: today's). Kept only in memory, by whatever opened the view,
 * so reopening it in the same visit comes back here.
 */
export interface AboutPlace {
  slug: string | null;
  month: number | null;
  day: number | null;
}

const THE_LIST: AboutPlace = { slug: null, month: null, day: null };

interface BibleAboutProps {
  /** The Bible ("EMB"). */
  translation: string;
  /** Its name ("Every Man's Bible (NLT)"), the list's title. */
  name: string;
  /** Where closing goes back to ("Genesis 13", "Settings"). */
  backTo: string;
  /** Where to open: the list, unless the view was left somewhere in this visit. */
  initialPlace?: AboutPlace;
  onPlaceChange?: (place: AboutPlace) => void;
  /** A `ref:` link: go there (the reader closes this view as it jumps). */
  onJump: (book: string, chapter: number, verse: number | null) => void;
  /** Called once the view has closed — by Close, Back, Escape or Android's Back from the list. */
  onClose: () => void;
}

/**
 * A study Bible's About page (v1.8 slice C2): its front matter, reading plan and notes on the
 * edition, in a view that fills the window over the reader or Settings (see `DocumentDialog`). It
 * opens on a list of them; each opens in full, and a reading plan shows a month at a time. Every
 * document is fetched from Concord through songbird and never stored (invariants 1 and 5).
 * Escape and Android's Back step back from a document to the list, then close.
 */
export function BibleAbout({
  translation,
  name,
  backTo,
  initialPlace,
  onPlaceChange,
  onJump,
  onClose,
}: BibleAboutProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<AboutPlace>(initialPlace ?? THE_LIST);
  // Bumped by every move, so going to the same day again still scrolls there.
  const [moves, setMoves] = useState(0);
  // The document the list was left for, to give its row focus on the way back.
  const cameFrom = useRef<string | null>(null);
  const [now] = useState(() => new Date());

  const list = useQuery(documentListOptions(translation));
  const groups = aboutGroups(list.data);
  const summary = list.data?.find((d) => d.slug === place.slug);
  const documentQuery = useQuery({
    ...documentOptions(translation, place.slug ?? ""),
    enabled: place.slug !== null,
  });
  const doc = place.slug === null ? undefined : documentQuery.data;
  const plan = useMemo(
    () => (doc?.kind === "reading-plan" ? parseReadingPlan(doc.text) : null),
    [doc],
  );

  const title = summary?.title ?? doc?.title ?? "";
  const kind = aboutKindLabel(summary?.kind ?? doc?.kind ?? "") ?? "About";
  const pictures = useDocumentPictures({
    translation,
    images: doc?.images ?? [],
    title,
    subtitle: `${title} · ${kind}`,
  });

  // A plan opens on today's month and day until one is chosen.
  const today = plan ? todayIn(plan, now) : null;
  const month = place.month ?? today?.month ?? 1;
  const day = place.month === null ? (today?.day ?? null) : place.day;

  const go = (next: AboutPlace) => {
    if (next.slug !== place.slug) cameFrom.current = place.slug;
    setPlace(next);
    setMoves((n) => n + 1);
    onPlaceChange?.(next);
  };
  const backToList = () => go(THE_LIST);

  // Each move scrolls the page: to the day gone to, or else to the top. The body is scrolled by
  // hand, never with scrollIntoView, so the page under the view can't move.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const target = plan && day !== null ? document.getElementById(planDayId({ month, day })) : null;
    body.scrollTop = target
      ? target.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop
      : 0;
  }, [moves, plan, month, day]);

  // Between the list and a document the button pressed is gone: focus goes to the page, or back on
  // the list to the document's own row.
  const firstRender = useRef(true);
  useLayoutEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const row =
      place.slug === null
        ? Array.from(bodyRef.current?.querySelectorAll<HTMLElement>("[data-slug]") ?? []).find(
            (b) => b.dataset.slug === cameFrom.current,
          )
        : undefined;
    (row ?? bodyRef.current)?.focus({ preventScroll: true });
  }, [place.slug]);

  const jump = (b: string, c: number, v: number | null, from?: PlanDay) => {
    if (from) onPlaceChange?.({ slug: place.slug, month: from.month, day: from.day });
    onJump(b, c, v);
  };

  const link = "font-medium text-blue-700 dark:text-blue-400 hover:underline";
  const failure = (what: string, retry: () => void) => (
    <div className="flex flex-col items-start gap-2">
      <p className="text-red-600 dark:text-red-400">
        Couldn&rsquo;t load {what} (is Concord reachable?)
      </p>
      <button type="button" className={link} onClick={retry}>
        Try again
      </button>
    </div>
  );
  const listWhat = `${translation}’s front matter and reading plan`;

  return (
    <DocumentDialog
      dialogRef={dialogRef}
      bodyRef={bodyRef}
      titleId="bible-about-title"
      leading={
        place.slug !== null && (
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded text-2xl leading-none text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label={`Back to About ${translation}`}
            onClick={backToList}
          >
            ‹
          </button>
        )
      }
      eyebrow={place.slug === null ? `About ${translation}` : `${kind} · ${translation}`}
      title={place.slug === null ? name : title}
      wrapTitle
      bar={
        plan && (
          <ReadingPlanBar
            plan={plan}
            month={month}
            day={day}
            onMonth={(m) => go({ slug: place.slug, month: m, day: null })}
            onDay={(d) => go({ slug: place.slug, month, day: d })}
            onToday={() => go({ slug: place.slug, month: today!.month, day: today!.day })}
          />
        )
      }
      onCancel={() => {
        if (place.slug === null) return false;
        backToList();
        return true;
      }}
      onClose={onClose}
      after={pictures.viewer}
    >
      <article className={`${DOCUMENT_COLUMN} ${DOCUMENT_TEXT}`}>
        {place.slug === null ? (
          list.isError ? (
            failure(listWhat, () => void list.refetch())
          ) : list.isPending ? (
            <p className="text-gray-600 dark:text-gray-400">Loading {listWhat}…</p>
          ) : groups.length === 0 ? (
            <p className="text-gray-600 dark:text-gray-400">
              {translation} has no front matter, reading plan or notes on the edition.
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              {groups.map((g) => (
                <section key={g.kind} aria-labelledby={`about-${g.kind}`}>
                  <h3
                    id={`about-${g.kind}`}
                    className="text-[0.85em] font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300"
                  >
                    {g.label}
                  </h3>
                  <ul className="mt-1 divide-y divide-gray-200 dark:divide-gray-700 border-y border-gray-200 dark:border-gray-700">
                    {g.documents.map((d) => (
                      <li key={d.slug}>
                        <button
                          type="button"
                          data-slug={d.slug}
                          className="flex min-h-11 w-full items-center justify-between gap-3 px-1 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
                          onClick={() => go({ slug: d.slug, month: null, day: null })}
                        >
                          <span>{d.title}</span>
                          <span aria-hidden="true" className="text-gray-400">
                            ›
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )
        ) : documentQuery.isError ? (
          failure(title || "it", () => void documentQuery.refetch())
        ) : !doc ? (
          <p className="text-gray-600 dark:text-gray-400">
            {title ? `Loading ${title}…` : "Loading…"}
          </p>
        ) : plan ? (
          <ReadingPlanMonth
            plan={plan}
            month={month}
            today={{ month: now.getMonth() + 1, day: now.getDate() }}
            onJump={jump}
            onMonth={(m) => go({ slug: place.slug, month: m, day: null })}
          />
        ) : (
          <NoteMarkdown
            text={doc.text}
            onJump={(b, c, v) => jump(b, c, v)}
            headingBase={3}
            renderImage={pictures.renderImage}
          />
        )}
        <div className="mt-8 flex flex-col items-start gap-3 border-t border-gray-200 dark:border-gray-700 pt-4">
          {place.slug !== null && (
            <button type="button" className={link} onClick={backToList}>
              ‹ About {translation}
            </button>
          )}
          <button type="button" className={link} onClick={() => dialogRef.current?.close()}>
            ← Back to {backTo}
          </button>
        </div>
      </article>
    </DocumentDialog>
  );
}
