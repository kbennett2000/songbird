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

function renderBlocks(tokens: MarkdownToken[], jump: (target: RefTarget) => void): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i]!;
    const key = `b${i}`;
    if (t.nesting === 1) {
      const { inner, end } = enclosed(tokens, i);
      const children = renderBlocks(inner, jump);
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
        out.push(
          <p key={key} className="font-semibold">
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
 * bold lines), code and rules. A `ref:` link becomes a button that jumps the reader; no other
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
