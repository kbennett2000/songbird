/**
 * Split a Concord keyword-search snippet into runs of plain text and highlighted (matched) text.
 *
 * Concord wraps each matched term in `<mark>…</mark>` (e.g. "rivers of <mark>living</mark>
 * <mark>water</mark>."). We parse those tokens into typed segments so the UI can render the marked
 * runs as React `<mark>` elements and the plain runs as ordinary text nodes — every run renders as
 * an escaped React text node, so the snippet is NEVER injected as raw HTML (no
 * `dangerouslySetInnerHTML`; same safety stance as {@link verseSegments}). Concatenating the
 * segment `text`s reconstructs the snippet with its `<mark>` tags removed.
 *
 * Only the literal `<mark>`/`</mark>` tokens are treated as markup; any other `<`/`>` in the verse
 * text is left verbatim (and React-escaped on render). Pure + testable.
 */
export interface MarkSegment {
  text: string;
  mark: boolean;
  key: string;
}

const MARK_RE = /<mark>(.*?)<\/mark>/g;

export function markSegments(snippet: string): MarkSegment[] {
  const segments: MarkSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  MARK_RE.lastIndex = 0;
  while ((match = MARK_RE.exec(snippet)) !== null) {
    if (match.index > cursor) {
      segments.push({ text: snippet.slice(cursor, match.index), mark: false, key: `t${cursor}` });
    }
    segments.push({ text: match[1] ?? "", mark: true, key: `m${match.index}` });
    cursor = match.index + match[0].length;
  }
  if (cursor < snippet.length) {
    segments.push({ text: snippet.slice(cursor), mark: false, key: `t${cursor}` });
  }
  return segments;
}
