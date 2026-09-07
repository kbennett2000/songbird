"""Find the things in a sermon's text that look like Scripture references (spec §7).

Pure — no I/O, no Concord, no database. It answers one question: which substrings of this text are
*shaped* like a reference? It does not answer what any of them mean, and it must not try.

**Concord is the judge.** The pattern is deliberately loose, so `Episode 63`, `Sunday 9:00` and
`Israel 24:03` all come out of here as candidates and are thrown away a moment later when Concord
refuses to resolve them (confirmed live: all three are a 404). That is the whole design. songbird
never decides what a book name means, and a finder tight enough to reject `Episode` would be a
finder that had opinions about book names — the exact thing invariant 4 keeps out of songbird.

What it DOES do is normalize, so that two spellings of one reference are one string:

* `–` and `—` become `-`, and the spaces around a dash go
* the abbreviating `.` in `2 Cor.` is dropped
* `I` / `II` / `III` become `1` / `2` / `3`
* runs of whitespace collapse to one space

Only the last three matter for resolution — Concord accepts Roman numerals, trailing periods and
mixed case perfectly well. They matter for **counting**: the boilerplate rule tallies how many of a
source's videos a candidate appears in, and a template that writes `II Timothy 2:2` one week and
`2 Timothy 2:2` the next must be counted once, not twice.
"""

import re
from typing import Final

# `III` before `II` before `I`, or the alternation matches the first character and stops.
_NUMERAL: Final = r"(?:[123]|III|II|I)"

# One word of a book name. At least two characters, so a stray capital in `A 3` is not a candidate
# and does not cost a Concord call. Mixed case is left alone: Concord reads `JOHN 3:16` — a real
# shape in a shouted YouTube description — exactly as it reads `John 3:16`.
_WORD: Final = r"[A-Z][A-Za-z]{1,14}\.?"

# `Song of Solomon` is the three-word shape; `First Corinthians` the two-word one.
_BOOK: Final = rf"(?:(?P<numeral>{_NUMERAL})\s+)?(?P<book>{_WORD}(?:\s+(?:of\s+)?{_WORD})?)"

# A chapter, optionally a verse, optionally a range whose end may carry its own verse — which is
# what makes `2 Chronicles 30:1-31:7` one candidate rather than two.
_N: Final = r"\d{1,3}"
_SPAN: Final = rf"{_N}(?::{_N})?(?:\s*[-–—]\s*{_N}(?::{_N})?)?"

# The trailing `(?!\d)` stops a year being read as a chapter: without it `July 2026` would offer
# `July 202`, a candidate that is pure noise and still costs a lookup.
_CANDIDATE: Final = re.compile(rf"\b{_BOOK}\s+(?P<span>{_SPAN})(?!\d)")

_ROMAN: Final = {"I": "1", "II": "2", "III": "3"}
_DASHES: Final = re.compile(r"\s*[-–—]\s*")


def _normalize(numeral: str | None, book: str, span: str) -> str:
    words = book.replace(".", "").split()
    if numeral is not None:
        words.insert(0, _ROMAN.get(numeral, numeral))
    return f"{' '.join(words)} {_DASHES.sub('-', span)}"


def find_candidates(text: str) -> list[str]:
    """Every reference-shaped string in `text`, normalized, in order of appearance, deduplicated.

    **One candidate can yield two strings**, and the reason is a real miss rather than a
    hypothetical one. A book name of two capitalized words is allowed because people write
    `First Corinthians 13` — but that also lets the pattern swallow a real reference behind any
    capitalized word in front of it. In `Sunday Service John 3:16` the book part matches
    `Service John`, Concord refuses it (checked live), and `John 3:16` is never even offered: a
    sermon that plainly states its passage would go to the review list.

    So when a two-word book carries no leading numeral, the second word is offered on its own as
    well. `First Corinthians 13` still resolves; `John 3:16` is rescued from behind `Service`. The
    cost is one extra lookup, answered from the run's cache after the first time.

    The fuller candidate comes first, because it is the more specific reading of the text and the
    rules take references in the order they are found.
    """
    found: list[str] = []
    for match in _CANDIDATE.finditer(text):
        numeral, book, span = match.group("numeral"), match.group("book"), match.group("span")
        found.append(_normalize(numeral, book, span))
        words = book.split()
        if numeral is None and len(words) == 2:  # not "Song of Solomon", which splits into three
            found.append(_normalize(None, words[1], span))
    return list(dict.fromkeys(found))
