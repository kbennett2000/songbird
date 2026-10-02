import { type ReactNode, useState } from "react";

import { ChartPicture } from "@/components/ChartPicture";
import { ChartViewer } from "@/components/ChartViewer";
import { chartImageUrl } from "@/lib/reader";
import type { DocumentImage } from "@/schemas";

/**
 * A document's reading column: at most 65 characters wide, 16 px text on a 28 px line, blocks and
 * list items spaced apart. Its Markdown goes through `NoteMarkdown` with `headingBase={3}`.
 */
export const DOCUMENT_COLUMN = "mx-auto max-w-prose px-4 py-6 text-base leading-7";
export const DOCUMENT_TEXT = "[&>div]:gap-4 [&_li+li]:mt-1.5";

interface DocumentPicturesOptions {
  /** The Bible the pictures belong to. */
  translation: string;
  /** The document's pictures, with their pixel sizes, so each frame has its shape before loading. */
  images: DocumentImage[];
  /** The document's title, for the large view when a picture has no caption. */
  title: string;
  /** The large view's second line ("Genesis · Introduction"). */
  subtitle: string;
}

/**
 * A document's pictures: `renderImage` places one where its Markdown does — a frame of its own
 * shape, a caption and **⤢ Open larger** — and `viewer` is its large view while one is open (the
 * chart viewer, worded for a picture), to sit inside the dialog but outside its scrolling body.
 * Closing the large view gives focus back to the picture.
 */
export function useDocumentPictures({
  translation,
  images,
  title,
  subtitle,
}: DocumentPicturesOptions): {
  renderImage: (name: string, alt: string) => ReactNode;
  viewer: ReactNode;
} {
  const [open, setOpen] = useState<{
    name: string;
    alt: string;
    button: HTMLButtonElement;
  } | null>(null);

  const renderImage = (name: string, alt: string) => {
    const image = images.find((i) => i.name === name);
    return (
      <figure className="my-2 flex flex-col items-center gap-1">
        <ChartPicture
          size="figure"
          noun="picture"
          src={chartImageUrl(translation, name)}
          alt={alt}
          label={`Open the picture larger: ${alt}`}
          aspect={image ? { width: image.width, height: image.height } : undefined}
          onOpen={(button) => setOpen({ name, alt, button })}
        />
        <figcaption className="text-sm text-gray-600 dark:text-gray-400">
          {alt && <>{alt} · </>}
          {/* For a pointer or a finger; the picture itself is the keyboard's way in. */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="font-medium text-blue-700 dark:text-blue-400 hover:underline"
            onClick={(e) => {
              const picture = e.currentTarget
                .closest("figure")
                ?.querySelector<HTMLButtonElement>("[data-chart-picture] button");
              if (picture) setOpen({ name, alt, button: picture });
            }}
          >
            ⤢ Open larger
          </button>
        </figcaption>
      </figure>
    );
  };

  const viewer = open && (
    <ChartViewer
      src={chartImageUrl(translation, open.name)}
      title={open.alt || title}
      subtitle={subtitle}
      alt={open.alt}
      noun="picture"
      onClose={() => {
        const button = open.button;
        setOpen(null);
        requestAnimationFrame(() => button.focus());
      }}
    />
  );

  return { renderImage, viewer };
}
