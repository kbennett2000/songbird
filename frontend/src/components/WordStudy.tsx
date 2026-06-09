import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { VerseRefList } from "@/components/VerseRefList";
import { fetchStrongs, fetchStrongsVerses, fetchVerseWords } from "@/lib/reader";
import type { WordToken } from "@/schemas";

interface WordStudyProps {
  book: string;
  chapter: number;
  verse: number;
  translation: string;
  onJump: (book: string, chapter: number, verse: number) => void;
}

/** Original-language word study — Concord's tagged Hebrew/Greek text + Strong's lexicon +
 * concordance (songbird owns none). Two levels in one panel: the verse's interlinear strip, then
 * (tapping a tagged word) that Strong's entry + every verse it occurs in, each jump-able back into
 * the reader. User-invoked, so an outage shows an inline error. */
export function WordStudy({
  book,
  chapter,
  verse,
  translation,
  onJump,
}: WordStudyProps): JSX.Element {
  const [selectedStrongsId, setSelectedStrongsId] = useState<string | null>(null);

  if (selectedStrongsId) {
    return (
      <StrongsDetailPanel
        strongsId={selectedStrongsId}
        translation={translation}
        onBack={() => setSelectedStrongsId(null)}
        onJump={onJump}
      />
    );
  }

  return <WordStrip book={book} chapter={chapter} verse={verse} onSelect={setSelectedStrongsId} />;
}

/** Level 1 — the interlinear strip. Three distinct states: inline error; a graceful "no data"
 * message for a valid-but-untagged verse (tokens: []); and the rendered strip. */
function WordStrip({
  book,
  chapter,
  verse,
  onSelect,
}: {
  book: string;
  chapter: number;
  verse: number;
  onSelect: (strongsId: string) => void;
}): JSX.Element {
  const query = useQuery({
    queryKey: ["verse-words", book, chapter, verse],
    queryFn: () => fetchVerseWords(book, chapter, verse),
  });

  if (query.isPending)
    return <p className="text-sm text-gray-500 dark:text-gray-400">Loading words…</p>;
  if (query.isError)
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        Couldn&rsquo;t load (is Concord reachable?).
      </p>
    );
  if (query.data.tokens.length === 0)
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        No original-language data for this verse.
      </p>
    );

  // Hebrew is right-to-left; detect it from the Strong's id prefix (H… = Hebrew, G… = Greek),
  // with text_id as corroboration. Rendering Hebrew LTR is wrong.
  const isHebrew = query.data.tokens.some((t) => t.strongs_id?.startsWith("H"));

  return (
    <div dir={isHebrew ? "rtl" : "ltr"} className="flex flex-wrap gap-2">
      {query.data.tokens.map((token) => (
        <WordTokenCell key={token.position} token={token} onSelect={onSelect} />
      ))}
    </div>
  );
}

/** One token in the strip. Tagged tokens (with a `strongs_id`) are tappable → level 2; untagged
 * tokens render as plain, non-interactive markup. */
function WordTokenCell({
  token,
  onSelect,
}: {
  token: WordToken;
  onSelect: (strongsId: string) => void;
}): JSX.Element {
  const inner = (
    <>
      <span className="block text-xl">{token.surface_form}</span>
      {(token.transliteration || token.gloss) && (
        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
          {[token.transliteration, token.gloss].filter(Boolean).join(" · ")}
        </span>
      )}
      {token.morph_code && (
        <span className="mt-0.5 block font-mono text-[0.65rem] text-gray-400 dark:text-gray-500">
          {token.morph_code}
        </span>
      )}
    </>
  );

  if (token.strongs_id) {
    return (
      <button
        type="button"
        className="rounded border border-gray-200 dark:border-gray-700 p-2 text-center hover:bg-gray-50 dark:hover:bg-gray-700"
        onClick={() => onSelect(token.strongs_id as string)}
      >
        {inner}
      </button>
    );
  }
  return <span className="p-2 text-center text-gray-700 dark:text-gray-300">{inner}</span>;
}

/** Level 2 — the Strong's entry (definition + lexical fields) and its concordance. */
function StrongsDetailPanel({
  strongsId,
  translation,
  onBack,
  onJump,
}: {
  strongsId: string;
  translation: string;
  onBack: () => void;
  onJump: (book: string, chapter: number, verse: number) => void;
}): JSX.Element {
  const detail = useQuery({
    queryKey: ["strongs", strongsId],
    queryFn: () => fetchStrongs(strongsId),
  });
  const verses = useQuery({
    queryKey: ["strongs-verses", strongsId, translation],
    queryFn: () => fetchStrongsVerses(strongsId, translation),
  });

  return (
    <div className="flex flex-col gap-3">
      <div>
        <button
          type="button"
          className="text-sm text-blue-700 dark:text-blue-400 hover:underline"
          onClick={onBack}
        >
          ← Words
        </button>
        <h3 className="mt-1 font-semibold">
          {detail.data?.lemma ?? strongsId}{" "}
          <span className="text-sm font-normal text-gray-400 dark:text-gray-500">{strongsId}</span>
        </h3>
      </div>

      {detail.isPending && (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading definition…</p>
      )}
      {detail.isError && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Couldn&rsquo;t load (is Concord reachable?).
        </p>
      )}
      {detail.data && (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-gray-700 dark:text-gray-200">{detail.data.definition}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {[detail.data.transliteration, detail.data.gloss].filter(Boolean).join(" · ")}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">{detail.data.source}</p>
        </div>
      )}

      <h4 className="mt-2 text-sm font-semibold text-gray-600 dark:text-gray-300">Concordance</h4>
      {verses.isPending && (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading verses…</p>
      )}
      {verses.isError && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Couldn&rsquo;t load (is Concord reachable?).
        </p>
      )}
      {verses.data && verses.data.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">No verses for this word.</p>
      )}
      {verses.data && verses.data.length > 0 && (
        <VerseRefList verses={verses.data} onJump={onJump} />
      )}
    </div>
  );
}
