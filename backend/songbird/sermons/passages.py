"""Which text a sermon's passage is read out of, and which references belong to the channel's
template rather than to any sermon (v1.7 sermon sources, spec §7). Pure — no I/O.

These functions pick text and count strings. They never resolve anything: the caller takes each
text, runs the finder over it, and asks Concord what survives. Keeping the choosing separate from
the asking is what makes every rule in §7 a one-line test with no database and no network.
"""

import re
from collections.abc import Mapping
from typing import Final, Literal

from songbird.sermons.references import find_candidates

# Which rule placed a note. `manual` is the review list's (slice 5) and is never returned here.
PlacedBy = Literal["scripture_line", "title", "first_line"]

# The labels a church actually puts in front of its passage, spec §7 rule 1. Singular and plural
# both, because both are written.
_LABELS: Final = frozenset(
    {
        "scripture",
        "scriptures",
        "main scripture",
        "text",
        "passage",
        "passages",
        "key verse",
        "key verses",
        "bible reference",
        "bible references",
        "scripture reference",
        "scripture references",
        "reference",
        "references",
        "reading",
    }
)

_LEADING_DECORATION: Final = re.compile(r"^[^A-Za-z]+")
_TRAILING_DECORATION: Final = re.compile(r"[^A-Za-z]+$")

# A source needs this many ledgered videos before "appears in half of them" means anything. Under
# five, half is two or three — and a two-part series on one passage would mark its own passage as
# the channel's template. It is a sample-size floor, not a count of appearances.
BOILERPLATE_MIN_VIDEOS: Final = 5


def _label_of(line: str) -> str | None:
    """The label a line puts before its colon, normalized, or None if it has no colon.

    Leading and trailing decoration is stripped, so `📖 Scripture:` and `**Scripture:**` are read
    the same as `Scripture:`. Churches decorate their headings and a rule that only matched the
    bare word would miss most of them.
    """
    head, colon, _ = line.partition(":")
    if not colon:
        return None
    label = _TRAILING_DECORATION.sub("", _LEADING_DECORATION.sub("", head))
    return " ".join(label.split()).lower() or None


def _block_beneath(lines: list[str], start: int) -> str | None:
    """The list of references written underneath a heading, spec §7 rule 1's extension.

    `Scripture References:` with the passages on the lines below is as common as putting them on
    the label line itself, and reading only the label line would miss every one of them. Blank
    lines directly under the heading are formatting and are stepped over; once content starts, a
    blank line or a line with no reference on it ends the block.

    The stop rule asks whether a line HAS a reference, not whether Concord likes it — so where the
    block ends never depends on a network call.
    """
    taken: list[str] = []
    for line in lines[start:]:
        if not line.strip():
            if taken:
                break
            continue  # formatting under the heading, not the end of the block
        if not find_candidates(line):
            break
        taken.append(line)
    return "\n".join(taken) if taken else None


def scripture_line(description: str) -> str | None:
    """The text of the labeled scripture line, or None if the description has none (§7 rule 1).

    Every labeled line is considered, in order, and the first that actually yields a reference
    wins — so a stray empty `Text:` earlier in a description does not shadow a real
    `Main Scripture:` below it.
    """
    lines = description.splitlines()
    for index, line in enumerate(lines):
        label = _label_of(line)
        if label is None or label not in _LABELS:
            continue
        rest = line.partition(":")[2]
        if find_candidates(rest):
            return rest
        beneath = _block_beneath(lines, index + 1)
        if beneath is not None:
            return beneath
    return None


def first_line(description: str) -> str | None:
    """The first line of the description with anything on it (§7 rule 3)."""
    for line in description.splitlines():
        if line.strip():
            return line
    return None


def rule_texts(title: str, description: str) -> list[tuple[PlacedBy, str]]:
    """The texts spec §7's rules read, in the order they are tried. First hit wins.

    A rule with no text to read is simply absent from the list rather than present and empty, so
    the caller loops over what there is instead of testing each one for emptiness.
    """
    texts: list[tuple[PlacedBy, str]] = []
    labeled = scripture_line(description)
    if labeled is not None:
        texts.append(("scripture_line", labeled))
    if title.strip():
        texts.append(("title", title))
    opening = first_line(description)
    if opening is not None:
        texts.append(("first_line", opening))
    return texts


def boilerplate(counts: Mapping[str, int], total: int) -> frozenset[str]:
    """The references that belong to the channel rather than to any of its sermons (§7).

    A giving verse, or the verse a church is named after (2819 Church is literally named for
    Matthew 28:19), turns up in most of its descriptions. Placing a note on it every week would be
    a wrong anchor every week, so anything appearing in at least half of a source's ledgered videos
    is ignored for that source — in the rules and in the suggestions alike.

    Half of *what* matters. Under five videos there is no meaningful frequency to measure: half is
    two or three, and a two-part series preached on one passage would have its own passage struck
    out as boilerplate. So the rule does not apply at all until a source has five videos to judge
    from. The failure it accepts in exchange is a short series landing in the review list, which is
    one tap each — the direction this feature always leans.
    """
    if total < BOILERPLATE_MIN_VIDEOS:
        return frozenset()
    threshold = (total + 1) // 2  # ceil(total / 2)
    return frozenset(reference for reference, seen in counts.items() if seen >= threshold)
