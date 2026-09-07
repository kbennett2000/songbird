"""The passage rules and the boilerplate rule (v1.7 sermon sources, spec §7). Pure unit tests.

These pick text and count strings; nothing here resolves anything. That separation is the whole
reason §7's rules can be tested without a database or a network — the caller runs the finder over
whichever text wins and asks Concord what survives.

Fixtures are one-line shapes taken from the four real channels, not whole descriptions.
"""

from songbird.sermons.passages import (
    boilerplate,
    first_line,
    rule_texts,
    scripture_line,
)

# The label forms churches actually write, decoration and all.
_LABELLED = (
    "Scripture: John 3:16",
    "SCRIPTURE: John 3:16",
    "Main Scripture: John 3:16",
    "Scriptures: John 3:16",
    "Text: John 3:16",
    "Passage: John 3:16",
    "Passages: John 3:16",
    "Key Verse: John 3:16",
    "Key Verses: John 3:16",
    "Bible Reference: John 3:16",
    "References: John 3:16",
    "Reading: John 3:16",
    "📖 Scripture: John 3:16",
    "**Scripture:** John 3:16",
    "  scripture  :  John 3:16",
)

# A colon does not make a label.
_NOT_LABELLED = (
    "Sermon: a study in John 3:16",
    "Watch at 9:00",
    "John 3:16",
)


def test_every_label_a_church_writes_is_recognised() -> None:
    for line in _LABELLED:
        text = scripture_line(line)
        assert text is not None, line
        assert "John 3:16" in text, line


def test_a_colon_alone_is_not_a_scripture_line() -> None:
    for line in _NOT_LABELLED:
        assert scripture_line(line) is None, line


def test_the_whole_labelled_line_is_taken_not_just_its_first_reference() -> None:
    # Celebration Church's shape — two passages on one line become two notes.
    line = "Main Scripture: Acts 7:33-35 (with reference to Exodus 3:5-10)"
    assert scripture_line(line) == " Acts 7:33-35 (with reference to Exodus 3:5-10)"


def test_a_heading_takes_the_references_written_underneath_it() -> None:
    description = "Scripture References:\nGenesis 1:1\nJohn 3:16\n\nGive at example.test"
    assert scripture_line(description) == "Genesis 1:1\nJohn 3:16"


def test_a_blank_line_under_the_heading_is_formatting_not_the_end() -> None:
    description = "Scripture References:\n\nGenesis 1:1\nJohn 3:16"
    assert scripture_line(description) == "Genesis 1:1\nJohn 3:16"


def test_the_block_stops_at_a_blank_line() -> None:
    description = "Scripture References:\nGenesis 1:1\n\nJohn 3:16"
    assert scripture_line(description) == "Genesis 1:1"


def test_the_block_stops_at_a_line_with_no_reference_on_it() -> None:
    description = "Scripture References:\nGenesis 1:1\nSubscribe for more\nJohn 3:16"
    assert scripture_line(description) == "Genesis 1:1"


def test_an_empty_label_does_not_shadow_a_real_one_below_it() -> None:
    description = "Text:\n\nSubscribe for more\n\nMain Scripture: John 3:16"
    text = scripture_line(description)
    assert text is not None and "John 3:16" in text


def test_a_labelled_line_with_no_reference_on_it_does_not_shadow_one_below() -> None:
    # A labelled line WINS by carrying a reference, not by existing. "Scripture: TBA" would
    # otherwise be taken as the answer and the real one below it never looked at.
    description = "Scripture: TBA\n\nMain Scripture: John 3:16"
    text = scripture_line(description)
    assert text is not None and "John 3:16" in text


def test_the_first_line_is_the_first_one_with_anything_on_it() -> None:
    # Cornerstone's shape, under a couple of blank lines.
    assert first_line("\n\n  7/22/2026 An in-depth study of 2 Chronicles 29.\nmore") == (
        "  7/22/2026 An in-depth study of 2 Chronicles 29."
    )
    assert first_line("") is None
    assert first_line("\n \n\t\n") is None


def test_the_rules_are_offered_in_the_spec_order() -> None:
    texts = rule_texts("A title (1 Peter 1:6-7)", "Scripture: John 3:16\nsecond line")
    assert [rule for rule, _ in texts] == ["scripture_line", "title", "first_line"]


def test_a_rule_with_no_text_to_read_is_simply_absent() -> None:
    # No labelled line, and an empty description: only the title is left to try.
    assert [rule for rule, _ in rule_texts("A title", "")] == ["title"]
    # And an untitled video with only a description falls to the first line.
    assert [rule for rule, _ in rule_texts("   ", "John 3:16")] == ["first_line"]


# --- Boilerplate: the channel's template, not any sermon's passage ----------------------------


def test_a_reference_in_over_half_of_a_sources_videos_is_boilerplate() -> None:
    # 2819 Church is named after Matthew 28:19 and puts it in its template.
    assert boilerplate({"Matthew 28:19": 6, "John 3:16": 1}, total=8) == frozenset(
        {"Matthew 28:19"}
    )


def test_exactly_half_is_enough() -> None:
    assert boilerplate({"Matthew 28:19": 4}, total=8) == frozenset({"Matthew 28:19"})
    assert boilerplate({"Matthew 28:19": 3}, total=8) == frozenset()


def test_an_odd_total_rounds_the_threshold_up() -> None:
    # Half of nine is four and a half; four appearances is not half.
    assert boilerplate({"Matthew 28:19": 5}, total=9) == frozenset({"Matthew 28:19"})
    assert boilerplate({"Matthew 28:19": 4}, total=9) == frozenset()


def test_the_rule_does_not_apply_to_a_source_with_too_few_videos() -> None:
    # Under five videos there is no frequency to measure: half is two, and a two-part series on
    # one passage would have its own passage struck out. A short series in the review list is the
    # failure this accepts instead.
    assert boilerplate({"Matthew 28:19": 4}, total=4) == frozenset()
    assert boilerplate({"Romans 8": 2}, total=3) == frozenset()
    # Five is where it starts.
    assert boilerplate({"Matthew 28:19": 3}, total=5) == frozenset({"Matthew 28:19"})


def test_a_source_with_nothing_in_it_excludes_nothing() -> None:
    assert boilerplate({}, total=0) == frozenset()
