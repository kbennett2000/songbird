import { Fragment, type ReactNode, useMemo } from "react";

import {
  type MarkdownToken,
  parseNoteMarkdown,
  type RefTarget,
  refLinkTarget,
} from "@/lib/noteMarkdown";

interface NoteMarkdownProps {
  text: string;
  /** Jump the reader to a `ref:` link's passage — the same jump a cross-reference button makes. */
  onJump: (book: string, chapter: number, verse: number | null) => void;
}

/** The tokens between an opening token at `start` and its matching close, and where it ends. */
function enclosed(tokens: MarkdownToken[], start: number): { inner: MarkdownToken[]; end: number } {
  let depth = 1;
  let i = start + 1;
  while (i < tokens.length && depth > 0) {
    depth += tokens[i]!.nesting;
    i++;
  }
  return { inner: tokens.slice(start + 1, i - 1), end: i };
}

function renderInline(tokens: MarkdownToken[], jump: (target: RefTarget) => void): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i]!;
    const key = `i${i}`;
    if (t.nesting === 1) {
      const { inner, end } = enclosed(tokens, i);
      const children = renderInline(inner, jump);
      if (t.type === "strong_open") out.push(<strong key={key}>{children}</strong>);
      else if (t.type === "em_open") out.push(<em key={key}>{children}</em>);
      else if (t.type === "link_open") {
        // Only a well-formed `ref:` link does anything; any other link is just its words.
        const target = refLinkTarget(t.attrGet("href") ?? "");
        out.push(
          target ? (
            <button
              key={key}
              type="button"
              className="font-medium text-blue-700 dark:text-blue-400 hover:underline"
              onClick={() => jump(target)}
            >
              {children}
            </button>
          ) : (
            <span key={key}>{children}</span>
          ),
        );
      } else out.push(<span key={key}>{children}</span>);
      i = end;
      continue;
    }
    if (t.type === "softbreak") out.push("\n");
    else if (t.type === "hardbreak") out.push(<br key={key} />);
    else if (t.type === "code_inline") out.push(<code key={key}>{t.content}</code>);
    // An image shows its alt text (images are a later slice); text and anything else, its
    // content — React escapes it, so stray HTML stays visible text.
    else out.push(t.content);
    i++;
  }
  return out;
}

/**
 * Each Markdown heading level's look: `#` and `##` a little larger with a rule under them, `###`
 * and below small capitals — distinct from each other, from the note's title and from bold words.
 * Sizes are in `em`, so they scale with the text around them.
 */
function headingClass(level: number): string {
  return level <= 2
    ? "mt-1 border-b border-gray-200 dark:border-gray-600 pb-0.5 text-[1.07em] font-semibold leading-snug text-gray-900 dark:text-gray-50"
    : "text-[0.85em] font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300";
}

/** Whether a line is only a `ref:` link, perhaps in brackets: a poem's or quotation's source. */
function isReferenceLine(line: MarkdownToken[]): boolean {
  let links = 0;
  for (let i = 0; i < line.length; ) {
    const t = line[i]!;
    if (t.type === "link_open") {
      if (!refLinkTarget(t.attrGet("href") ?? "")) return false;
      links++;
      i = enclosed(line, i).end;
      continue;
    }
    if (t.type !== "text" || !/^[\s().,;]*$/.test(t.content)) return false;
    i++;
  }
  return links === 1;
}

/**
 * A paragraph's lines when it's poetry — two or more lines of words split by hard breaks, not
 * counting a last line that's only its reference — otherwise null. A prose quotation followed by
 * its reference is one line of words, so it isn't poetry and keeps its plain line break.
 */
function poetryLines(tokens: MarkdownToken[]): MarkdownToken[][] | null {
  const lines: MarkdownToken[][] = [[]];
  let depth = 0;
  for (const t of tokens) {
    if (t.type === "hardbreak" && depth === 0) {
      lines.push([]);
      continue;
    }
    depth += t.nesting;
    lines[lines.length - 1]!.push(t);
  }
  const wordLines = isReferenceLine(lines[lines.length - 1]!) ? lines.length - 1 : lines.length;
  return wordLines >= 2 ? lines : null;
}

function renderBlocks(tokens: MarkdownToken[], jump: (target: RefTarget) => void): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i]!;
    const key = `b${i}`;
    if (t.nesting === 1) {
      const { inner, end } = enclosed(tokens, i);
      const lines =
        t.type === "paragraph_open" && inner.length === 1 && inner[0]!.type === "inline"
          ? poetryLines(inner[0]!.children ?? [])
          : null;
      // Poetry: each line its own block with a hanging indent, so a long line that wraps reads as
      // one line carried over, not as two lines of the poem.
      const children = lines
        ? lines.map((line, n) => (
            <span key={`l${n}`} data-poetry-line="" className="block pl-[1.5em] -indent-[1.5em]">
              {renderInline(line, jump)}
            </span>
          ))
        : renderBlocks(inner, jump);
      if (t.type === "paragraph_open") {
        // A tight list's paragraphs are hidden: their words sit straight in the list item.
        out.push(
          t.hidden ? <Fragment key={key}>{children}</Fragment> : <p key={key}>{children}</p>,
        );
      } else if (t.type === "bullet_list_open") {
        out.push(
          <ul key={key} className="list-disc pl-5">
            {children}
          </ul>,
        );
      } else if (t.type === "ordered_list_open") {
        const start = Number(t.attrGet("start") ?? 1);
        out.push(
          <ol key={key} className="list-decimal pl-5" start={start}>
            {children}
          </ol>,
        );
      } else if (t.type === "list_item_open") out.push(<li key={key}>{children}</li>);
      else if (t.type === "blockquote_open") {
        out.push(
          <blockquote
            key={key}
            className="space-y-2 border-l-2 border-gray-300 dark:border-gray-600 pl-3 text-gray-700 dark:text-gray-300"
          >
            {children}
          </blockquote>,
        );
      } else if (t.type === "heading_open") {
        const level = Number(t.tag.slice(1));
        out.push(
          <p key={key} data-md-heading={level} className={headingClass(level)}>
            {children}
          </p>,
        );
      } else out.push(<div key={key}>{children}</div>);
      i = end;
      continue;
    }
    if (t.type === "inline") out.push(...renderInline(t.children ?? [], jump));
    else if (t.type === "fence" || t.type === "code_block") {
      out.push(
        <pre key={key} className="whitespace-pre-wrap font-mono text-xs">
          {t.content}
        </pre>,
      );
    } else if (t.type === "hr")
      out.push(<hr key={key} className="border-gray-200 dark:border-gray-700" />);
    else if (t.content) out.push(t.content);
    i++;
  }
  return out;
}

/**
 * A note's Markdown, rendered read-only: paragraphs, emphasis, lists, block quotes, headings (as
 * lines with a look per level), poetry (hanging-indented lines), code and rules. A `ref:` link becomes a button that jumps the reader; no other
 * link is clickable, and no HTML is ever injected (see `lib/noteMarkdown.ts`).
 */
export function NoteMarkdown({ text, onJump }: NoteMarkdownProps): JSX.Element {
  const tokens = useMemo(() => parseNoteMarkdown(text), [text]);
  const jump = (target: RefTarget) => onJump(target.book, target.chapter, target.verse);
  return (
    <div className="flex flex-col gap-2 break-words text-gray-800 dark:text-gray-100">
      {renderBlocks(tokens, jump)}
    </div>
  );
}
