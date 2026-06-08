import Link from "@tiptap/extension-link";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback } from "react";
import { Markdown } from "tiptap-markdown";

/** Pull Markdown out of the editor (tiptap-markdown's storage API), defensively typed. */
function getMarkdown(editor: Editor): string {
  const storage = editor.storage as { markdown?: { getMarkdown?: () => string } };
  return storage.markdown?.getMarkdown?.() ?? "";
}

interface NoteEditorProps {
  initialMarkdown: string;
  saving?: boolean;
  onSave: (markdown: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

const toolbarButton =
  "rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50";

/**
 * A TipTap rich-text editor that reads and writes **Markdown** (CLAUDE.md invariant 6) —
 * never editor-native JSON. Supports links + basic formatting.
 */
export function NoteEditor({
  initialMarkdown,
  saving,
  onSave,
  onCancel,
  onDelete,
}: NoteEditorProps): JSX.Element {
  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false }), Markdown],
    content: initialMarkdown,
    immediatelyRender: false, // React 18 strict mode double-render guard
  });

  const handleSave = useCallback(() => {
    if (!editor) return;
    onSave(getMarkdown(editor));
  }, [editor, onSave]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");
    if (url === null) return;
    const chain = editor.chain().focus().extendMarkRange("link");
    if (url === "") {
      chain.unsetLink().run();
    } else {
      chain.setLink({ href: url }).run();
    }
  }, [editor]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1">
        <button
          type="button"
          className={`${toolbarButton} font-bold`}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          B
        </button>
        <button
          type="button"
          className={`${toolbarButton} italic`}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          I
        </button>
        <button type="button" className={toolbarButton} onClick={setLink}>
          Link
        </button>
      </div>

      <div className="rounded border border-gray-300 dark:border-gray-600 p-3">
        <EditorContent editor={editor} data-testid="note-editor" />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          onClick={handleSave}
          disabled={saving}
        >
          Save
        </button>
        <button
          type="button"
          className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
          onClick={onCancel}
        >
          Cancel
        </button>
        {onDelete && (
          <button
            type="button"
            className="ml-auto rounded px-3 py-1 text-sm text-red-600 dark:text-red-400 hover:bg-red-50"
            onClick={onDelete}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
