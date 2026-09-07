"""The candidate finder (v1.7 sermon sources, spec §7). Pure, so these are plain unit tests.

Two things are being pinned, and they pull in opposite directions on purpose.

The finder must be **loose**: `Episode 63`, `Sunday 9:00` and `Israel 24:03` have to come out of it
as candidates, because Concord is what decides they are not references (live: all three 404). A
finder tight enough to reject them would be a finder with opinions about book names, which is
exactly what invariant 4 keeps out of songbird.

And it must **normalize**, so that two spellings of one reference count as one string. That is what
the boilerplate rule needs: a channel template writing `II Timothy 2:2` one week and
`2 Timothy 2:2` the next must be tallied once.
"""

from songbird.sermons.references import find_candidates

# Every shape spec §7 names, and what it must normalize to.
_SHAPES = (
    # Plain, chapter-and-verse and chapter-only.
    ("John 3:16", "John 3:16"),
    ("Acts 7", "Acts 7"),
    # Numbered books, in digits and in Roman numerals.
    ("1 Peter 1:6-7", "1 Peter 1:6-7"),
    ("II Timothy 2:2", "2 Timothy 2:2"),
    ("III John 1", "3 John 1"),
    ("I Corinthians 13", "1 Corinthians 13"),
    # The abbreviating period is dropped.
    ("2 Cor. 5:17", "2 Cor 5:17"),
    ("Ps. 23", "Ps 23"),
    # Both long dashes become a plain hyphen, and the spaces around one go.
    ("James 1:2–4", "James 1:2-4"),
    ("James 1:2 — 4", "James 1:2-4"),
    # A verse on the range end, which is what makes a cross-chapter span one candidate.
    ("2 Chronicles 30:1–31:7", "2 Chronicles 30:1-31:7"),
    # A three-word name, and a shouted one.
    ("Song of Solomon 2:1", "Song of Solomon 2:1"),
    ("MATTHEW 28:19", "MATTHEW 28:19"),
    # Whitespace collapses.
    ("2   Chronicles\t29", "2 Chronicles 29"),
)

# Reference-shaped enough to reach Concord, which is where they are thrown out.
_JUNK_THAT_STILL_COUNTS = ("Episode 63", "Sunday 9:00", "Israel 24:03")

# Nothing here is shaped like a reference at all, so nothing should cost a lookup.
_NOT_CANDIDATES = (
    "",
    "no book here at all",
    "A 3",  # a single capital is not a book name
    "Recorded July 2026, posted August 2026",  # a year is not a chapter
    "7/22/2026",
    "Give generously — it matters.",
)


def test_every_shape_the_spec_names_is_found_and_normalized() -> None:
    for text, expected in _SHAPES:
        assert find_candidates(text)[0] == expected, text


def test_a_reference_shaped_string_is_a_candidate_even_when_it_is_nonsense() -> None:
    # songbird never decides what a book name means; Concord rejects these a moment later.
    for text in _JUNK_THAT_STILL_COUNTS:
        assert find_candidates(text) == [text], text


def test_text_with_nothing_reference_shaped_costs_no_lookup() -> None:
    for text in _NOT_CANDIDATES:
        assert find_candidates(text) == [], text


def test_a_year_is_not_read_as_a_chapter() -> None:
    # Without the guard this offers "July 202" — noise that still costs a Concord call.
    assert find_candidates("Recorded July 2026") == []
    # But a three-digit chapter is real.
    assert find_candidates("Psalm 119:105") == ["Psalm 119:105"]


def test_every_reference_on_a_line_is_found_in_order() -> None:
    line = "Main Scripture: Acts 7:33–35 (with reference to Exodus 3:5–10)"
    assert find_candidates(line) == ["Acts 7:33-35", "Exodus 3:5-10"]


def test_the_same_reference_twice_is_one_candidate() -> None:
    text = "Give at Matthew 28:19. And again, Matthew 28:19."
    assert find_candidates(text) == ["Matthew 28:19"]


def test_two_spellings_of_one_reference_normalize_to_the_same_string() -> None:
    # The boilerplate tally counts strings, so this is what stops a template that alternates
    # spellings from being counted as two different references and escaping the rule.
    assert find_candidates("II Timothy 2:2") == find_candidates("2 Timothy 2:2")
    assert find_candidates("2 Cor. 5:17") == find_candidates("2  Cor 5:17")


def test_a_two_word_name_also_offers_its_second_word_alone() -> None:
    # A capitalized word in front of a reference is otherwise swallowed by the two-word book form:
    # "Service John" is what the pattern sees, Concord refuses it, and the sermon's own stated
    # passage never gets offered at all.
    assert find_candidates("Sunday Service John 3:16") == ["Service John 3:16", "John 3:16"]
    # The fuller reading comes first, because the rules take references in the order found.
    assert find_candidates("First Corinthians 13") == ["First Corinthians 13", "Corinthians 13"]


def test_the_second_word_is_not_offered_when_it_would_be_wrong() -> None:
    # A leading numeral belongs to the book, so "1 Peter" must not also offer "Peter".
    assert find_candidates("1 Peter 1:6-7") == ["1 Peter 1:6-7"]
    # "Song of Solomon" is three words, not two, so there is no second-word reading to make.
    assert find_candidates("Song of Solomon 2:1") == ["Song of Solomon 2:1"]
    # One word offers only itself.
    assert find_candidates("John 3:16") == ["John 3:16"]


def test_a_reference_is_found_wherever_it_sits_in_a_sentence() -> None:
    # Parentheses, a leading date, a trailing full stop — the real shapes from the four sources.
    assert find_candidates("The Faithfulness of God (1 Peter 1:6-7)") == ["1 Peter 1:6-7"]
    assert find_candidates("7/22/2026 An in-depth study of 2 Chronicles 29.") == [
        "2 Chronicles 29"
    ]
