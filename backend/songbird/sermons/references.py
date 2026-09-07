"""Find the things in a sermon's text that look like Scripture references (spec §7).

Pure — no I/O, no Concord, no database. It answers one question: which substrings of this text are
*shaped* like a reference? It does not answer what any of them mean, and it must not try.

**Concord is the judge.** The pattern is deliberately loose, so `Episode 63` and `Sunday 9:30` both
come out of here as candidates and are thrown away a moment later when Concord refuses to resolve
them (confirmed live: both are a 404). That is the whole design. songbird never decides what a book
name means, and a finder tight enough to reject `Episode` would be a finder that had opinions about
book names — the exact thing invariant 4 keeps out of songbird.

**The one exception, and it is not a book-name opinion: a date.** Churches title services by the day
they happened, in two shapes, and both collide with a real reference.

*A month name.* Majestic View writes `Livestream Sunday Worship Service - Mar. 15 2026 …`, and
`Mar.` is an abbreviation Concord accepts for Mark. Left alone, the finder hands Concord `Mar 15`,
Concord correctly says that is Mark 15, and a sermon on John gets a note on Mark. Five notes were
made that way in the first live run before this guard existed.

*All digits.* The same channel also writes
`MVC - Talking About Respect with Pastor John 06-25-2020`. There is no month word to notice — the
tells are that `06` is zero-padded and that a four-digit year sits behind the span. Left alone,
Concord reads `John 06-25` as John 6–25 and a video about respect gets a note spanning sixteen
chapters. That was the one wrong note in 1,082 that survived the live audit of slice 4b.

Both guards recognize **what a date looks like** and decline to offer it — a judgement about the
*shape of the surrounding text*, not about what `Mar` or `John` means. Concord still decides every
string that does leave here.

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

# Month names as a church writes a service date: full, or the three-letter short form, with or
# without the abbreviating period. Only one of these collides with a book abbreviation Concord
# accepts — `Mar.` for Mark — but the guard is uniform, because a uniform rule is one rule to read
# and the others were only ever costing a lookup that came back 404. `Sept` is deliberately absent:
# the short form here is three letters, and nothing Concord knows answers to `Sept`, so the worst it
# can do is spend a lookup — the safe direction.
_MONTHS: Final = frozenset(
    "january february march april may june july august september october november december "
    "jan feb mar apr may jun jul aug sep oct nov dec".split()
)

# What sits after the number when it is a day rather than a chapter: `15 2026`, `15, 2026`,
# `15th 2026`. The trailing `(?!\d)` keeps a longer run of digits from passing as a year.
_YEAR_AFTER: Final = re.compile(r"(?:st|nd|rd|th)?\s*,?\s*\d{4}(?!\d)")

# A number written with a leading zero is a day or a month, never a chapter or a verse: nobody
# writes `John 06` or `John 3:06`, and every numeric date pads. This tell alone catches
# `John 06-25-2020`, with no year needed — and it quietly retires video timestamps like `9:00` and
# `24:03`, which were only ever costing a lookup that came back 404.
_PADDED: Final = re.compile(r"(?<!\d)0\d")

# The rest of a numeric date, sitting immediately behind the span. Whitespace is optional on either
# side of the separator, exactly as it is for the month rule's year.
_SEP: Final = r"\s*[-–—/.]\s*"

# A separator and a four-digit year — with an **optional day of its own in between**, which is the
# part that is easy to leave out and easy to get wrong. `/` is not a span separator, so in
# `John 6/25/2020` the span is only `6` and the year is not behind it: `/25/2020` is. The dash form
# needs no such help, because `6-25` joins the span and leaves `-2020` directly behind. The trailing
# `(?!\d)` is the month rule's, for the month rule's reason: a longer run of digits is not a year.
_DATE_TAIL: Final = re.compile(rf"(?:{_SEP}\d{{1,2}})?{_SEP}\d{{4}}(?!\d)")


def _is_date(word: str, span: str, text: str, end: int) -> bool:
    """Is this a service date rather than a reference?

    A month, and then either shape that says *day* instead of *chapter*: no verse part at all
    (`Mar. 15`, `Sunday Service Mar. 15`), or a four-digit year right behind it (`Mar. 15 2026`).
    `Mar. 15:16-20` satisfies neither and still goes to Concord as Mark — nobody writes a date that
    way, and a church that really does mean Mark keeps its note.
    """
    if word.lower() not in _MONTHS:
        return False
    return ":" not in span or _YEAR_AFTER.match(text, end) is not None


def _is_numeric_date(span: str, text: str, end: int) -> bool:
    """Is this a date written entirely in digits — `06-25-2020` — rather than a chapter and verse?

    Two independent tells, either one enough: a zero-padded number anywhere in the span, or the rest
    of a date behind it. They overlap on the title that prompted them and each catches forms the
    other misses — `John 06-25` has no year, `John 6-25-2020` pads nothing.

    Unlike the month rule this asks nothing about the book part, so it applies to every candidate,
    including the second-word reading.
    """
    return _PADDED.search(span) is not None or _DATE_TAIL.match(text, end) is not None


def _candidate(numeral: str | None, book: str, span: str, text: str, end: int) -> str | None:
    """One normalized candidate string, or `None` for a date.

    `len(words) == 1` is load-bearing, and it guards **only the month rule**. It confines that rule
    to a **bare** month, so the two-word reading of `Sunday Service Mar. 15` — `Service Mar 15` — is
    left exactly as it was: Concord already refuses it, and it was never the string that made the
    wrong note. The one this drops is the second-word fallback, `Mar 15`, which is.

    The numeric rule carries no such guard, because `Pastor John 06-25` and `John 06-25` are *both*
    the date, and leaving either would leave the defect.
    """
    words = book.replace(".", "").split()
    if numeral is not None:
        words.insert(0, _ROMAN.get(numeral, numeral))
    if _is_numeric_date(span, text, end):
        return None
    if len(words) == 1 and _is_date(words[0], span, text, end):
        return None
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
        end = match.end()
        whole = _candidate(numeral, book, span, text, end)
        if whole is not None:
            found.append(whole)
        words = book.split()
        if numeral is None and len(words) == 2:  # not "Song of Solomon", which splits into three
            second = _candidate(None, words[1], span, text, end)
            if second is not None:
                found.append(second)
    return list(dict.fromkeys(found))
