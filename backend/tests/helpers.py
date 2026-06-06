"""Shared test helpers."""

from songbird.concord.schemas import Chapter, ChapterVerse


def build_chapter(
    book: str = "JHN", chapter: int = 3, translation: str = "KJV", verses: int = 20
) -> Chapter:
    """A canned Concord chapter for one translation — canonical coords, distinguishable text."""
    return Chapter(
        reference=f"{book} {chapter}",
        translations=[translation],
        verses=[
            ChapterVerse(
                book=book,
                chapter=chapter,
                verse=v,
                reference=f"{book} {chapter}:{v}",
                text={translation: f"{translation} text for {book} {chapter}:{v}"},
            )
            for v in range(1, verses + 1)
        ],
    )


ANNOTATION_BODY = {
    "book_usfm": "JHN",
    "start_chapter": 3,
    "start_verse": 16,
    "end_chapter": 3,
    "end_verse": 16,
    "note_markdown": "**For God so loved** — see [context](http://example.test).",
}
