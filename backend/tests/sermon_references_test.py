"""The candidate finder (v1.7 sermon sources, spec §7). Pure, so these are plain unit tests.

Two things are being pinned, and they pull in opposite directions on purpose.

The finder must be **loose**: `Episode 63`, `Sunday 9:30` and `Israel 24:13` have to come out of it
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
# (The zero-padded `9:00` and `24:03` used to be here. They are now dropped by the numeric-date
# rule below — a padded number is never a chapter — which is a small bonus, not the point of it.)
_JUNK_THAT_STILL_COUNTS = ("Episode 63", "Sunday 9:30", "Israel 24:13")

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
    assert find_candidates("7/22/2026 An in-depth study of 2 Chronicles 29.") == ["2 Chronicles 29"]


# --- A service date is not a book of the Bible -------------------------------------------------

# Every form a church writes a service date in, paired with the candidate that must NOT come out of
# it. `Mar` is the one that mattered — Concord accepts it for Mark, so `Mar. 15 2026` made a note on
# Mark 15 in the first live run. The rest are here because the guard is one uniform rule.
_DATES = (
    ("Livestream Sunday Worship Service  - Mar. 15 2026", "Mar 15"),
    ("Livestream Sunday Worship Service  - Mar. 15, 2026", "Mar 15"),
    ("Livestream Sunday Worship Service  - Mar. 15th 2026", "Mar 15"),
    ("Sunday Service Mar. 15", "Mar 15"),  # no year at all, and still a date
    ("Recorded March 15 2026", "March 15"),
    ("Christmas Eve service, Dec. 7 2025", "Dec 7"),
    ("SUNDAY SERVICE JAN 4 2026", "JAN 4"),
    ("Outdoor service May 3", "May 3"),
)


def test_a_service_date_is_never_offered_as_a_reference() -> None:
    for text, absent in _DATES:
        assert absent not in find_candidates(text), text


def test_the_two_titles_that_made_the_wrong_notes() -> None:
    # Verbatim from Majestic View. The first states its passage after the date and must keep it; the
    # second states none at all and must offer nothing, so the video goes to the review list.
    assert find_candidates(
        "Livestream Sunday Worship Service  - Mar. 15 2026 Victory in a chaotic world  Jn. 16:16-33"
    ) == ["Jn 16:16-33"]
    assert find_candidates("Livestream Sunday Worship Service  - Mar. 16 2025") == []


def test_a_church_that_really_means_mark_keeps_its_note() -> None:
    # The guard is about the shape of a date, not about what `Mar` means — Concord still decides.
    assert find_candidates("Mark 15") == ["Mark 15"]
    # A verse part and no year is nobody's way of writing a date, so this is still Mark.
    assert find_candidates("Mar. 15:16-20") == ["Mar 15:16-20"]


def test_the_date_guard_drops_one_candidate_and_leaves_the_other() -> None:
    # `Mar 15` is the string that made the wrong note; `Service Mar 15` never could — Concord
    # refuses it. Only the first is dropped, so the guard stays as small as the defect.
    assert find_candidates("Sunday Service Mar. 15") == ["Service Mar 15"]


# The year clause on its own. These shapes look strange on purpose: every everyday date — `Mar. 15`,
# `Mar. 15, 2026`, `Mar. 15th 2026` — is already caught by having no verse part, so a span with a
# `:` in it is the only place a trailing year is the thing doing the work. A mutation pass proved
# these branches were otherwise unpinned and could be deleted with every other test still green.
_DATED_WITH_A_VERSE_PART = (
    "Mar. 15:16 2026",
    "Mar. 15:16, 2026",
    "Mar. 15:16th 2026",
)


def test_a_year_behind_the_number_settles_it_even_with_a_verse_part() -> None:
    for text in _DATED_WITH_A_VERSE_PART:
        assert find_candidates(text) == [], text
    # And with no year behind it, the same string is Mark and goes to Concord.
    assert find_candidates("Mar. 15:16") == ["Mar 15:16"]


# --- A date written in digits is not a book of the Bible ----------------------------------------


def test_the_title_that_made_the_one_wrong_note_in_1082() -> None:
    # Verbatim from Majestic View, and the reason this rule exists: `John 06-25` is a reference
    # Concord reads as John 6-25, so a video about respect carried a note spanning sixteen chapters.
    # It was the only wrong note the by-eye audit of the four live channels found.
    assert find_candidates("MVC - Talking About Respect with Pastor John 06-25-2020") == []


def test_every_way_a_numeric_date_is_written_is_dropped() -> None:
    for text in ("John 06-25-2020", "John 6-25-2020", "John 6/25/2020", "John 6.25.2020"):
        assert find_candidates(text) == [], text


def test_a_padded_number_is_a_day_and_needs_no_year_to_prove_it() -> None:
    # The padding clause on its own: nothing follows these, so the year clause cannot be what drops
    # them. A chapter is never written `06`, and a verse is never written `:03`.
    assert find_candidates("John 06-25") == []
    assert find_candidates("Israel 24:03") == []


def test_a_year_behind_the_span_is_a_date_even_when_nothing_is_padded() -> None:
    # The year clause on its own: `6-25` is a perfectly ordinary span, so only what follows it says
    # this is 25 June 2020.
    assert find_candidates("John 6-25-2020") == []


def test_a_slashed_date_is_dropped_though_the_year_is_not_directly_behind_it() -> None:
    # `/` is not a span separator, so the candidate here is only `John 6` and `/25/2020` sits behind
    # it — the day part of the tail is what closes this, and without it `John 6` goes to Concord.
    assert find_candidates("John 6/25/2020") == []


def test_a_longer_run_of_digits_is_not_a_year() -> None:
    # Same guard the month rule carries, for the same reason: five digits are not a date.
    assert find_candidates("John 6-20200") == ["John 6"]


def test_a_real_reference_that_merely_looks_numeric_still_reaches_concord() -> None:
    # The controls. None of these is padded and none has a year behind it, so the rule must not
    # touch them — a chapter range in particular is the shape closest to a date.
    for text in ("John 6-25", "John 6:25", "Genesis 1-11", "Psalm 119:105", "Psalm 100"):
        assert find_candidates(text) == [text], text


def test_the_cost_of_the_year_clause_is_a_miss_into_the_review_list() -> None:
    """The one shape this rule gets wrong, pinned so it is a decision rather than a surprise.

    Whitespace is allowed either side of the separator, as it is for the month rule's year, so a
    series title that puts a year behind a chapter loses its candidate. The video goes to the review
    list and gets placed in one tap — the direction spec §13 calls the safe one.
    """
    assert find_candidates("Genesis 1 - 2025 Vision Series") == []
