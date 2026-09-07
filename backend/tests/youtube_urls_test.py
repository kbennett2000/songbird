"""The YouTube URL parsers. Pure, so these are plain unit tests.

The point of the helper is that a sermon link arrives in whatever shape the person copying it
happened to get, and every one of those shapes has to resolve to the same id — while anything
that is not a link to a single video resolves to None, which is a normal answer rather than an
error.
"""

from songbird.youtube.urls import is_video_id, parse_source_url, youtube_video_id

_ID = "dQw4w9WgXcQ"

# Every form a sermon link actually turns up in.
_ACCEPTED = (
    # The desktop share/copy form, with and without the junk that rides along.
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1832s",
    "https://www.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    # Mobile.
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    # The short share link, including the "?si=" suffix the share sheet now adds.
    "https://youtu.be/dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?si=Xy1Z_aBcDeFgH",
    "https://youtu.be/dQw4w9WgXcQ?t=60",
    "http://youtu.be/dQw4w9WgXcQ",
    # A livestream — how most of the sermons in question are published.
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ?feature=share",
    # Shorts and embeds, for completeness.
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    # Case in the host is not significant.
    "https://WWW.YouTube.com/watch?v=dQw4w9WgXcQ",
)

_REJECTED = (
    # Not a video: a channel, a handle, a playlist, the home page.
    "https://www.youtube.com/@cornerstonechpl",
    "https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx",
    "https://www.youtube.com/playlist?list=PLxxxxxxxxxxxxxxxxxx",
    "https://www.youtube.com/",
    # A watch URL with nothing to watch.
    "https://www.youtube.com/watch",
    "https://www.youtube.com/watch?v=",
    "https://www.youtube.com/watch?list=PLxxxxxxxx",
    # Ids of the wrong length, or with characters an id can't contain.
    "https://www.youtube.com/watch?v=tooshort",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQextra",
    "https://youtu.be/dQw4w9WgXcQ!",
    # A well-formed id with something appended to the path.
    "https://youtu.be/dQw4w9WgXcQ/clip",
    "https://www.youtube.com/live/dQw4w9WgXcQ/extra",
    # A different host that merely mentions YouTube — the userinfo trick in particular, which a
    # regex hunting for "youtube.com" anywhere would fall for. The real host is evil.test.
    "https://www.youtube.com@evil.test/watch?v=dQw4w9WgXcQ",
    "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    # Other sermon hosts, which are perfectly valid sermon_urls — just not YouTube ones.
    "https://sermons.example.org/2026-01-05",
    "https://vimeo.com/123456789",
    # Not a URL at all.
    "",
    "   ",
    "dQw4w9WgXcQ",
    "youtu.be/dQw4w9WgXcQ",  # no scheme
    "not a url",
    "ftp://youtu.be/dQw4w9WgXcQ",
    "javascript:alert(1)",
    "https://[bad",  # malformed enough that the URL parser itself gives up
)


def test_every_link_form_resolves_to_the_same_id() -> None:
    for url in _ACCEPTED:
        assert youtube_video_id(url) == _ID, url


def test_anything_that_is_not_a_single_video_link_is_none() -> None:
    for url in _REJECTED:
        assert youtube_video_id(url) is None, url


def test_surrounding_whitespace_is_tolerated() -> None:
    # People paste with a trailing newline more often than not.
    assert youtube_video_id(f"  https://youtu.be/{_ID}\n") == _ID


def test_is_video_id_holds_the_eleven_character_rule() -> None:
    assert is_video_id(_ID)
    assert is_video_id("-_11chars__")
    for bad in ("", "short", "twelvechars1", "eleven char", "eleven.char"):
        assert not is_video_id(bad), bad


# --- The source link parser (v1.7 sermon sources, spec §5) ----------------------------------

_HANDLE = "@cornerstonechpl"
_CHANNEL = "UCa1b2c3d4e5f6g7h8i9j0k1"  # "UC" + 22 characters, the canonical shape
_PLAYLIST = "PLw5K9iridI-CW2ABjjNWoHQAwomBqHV5t"

# Every shape a person actually arrives with, and what each one names.
_SOURCES: tuple[tuple[str, tuple[str, str]], ...] = (
    # The common case: the channel's @handle link, from every tab it can be copied from.
    (f"https://www.youtube.com/{_HANDLE}", ("handle", _HANDLE)),
    (f"https://youtube.com/{_HANDLE}", ("handle", _HANDLE)),
    (f"https://m.youtube.com/{_HANDLE}", ("handle", _HANDLE)),
    (f"http://www.youtube.com/{_HANDLE}", ("handle", _HANDLE)),
    (f"https://www.youtube.com/{_HANDLE}/videos", ("handle", _HANDLE)),
    (f"https://www.youtube.com/{_HANDLE}/streams", ("handle", _HANDLE)),
    (f"https://www.youtube.com/{_HANDLE}/featured", ("handle", _HANDLE)),
    (f"https://www.youtube.com/{_HANDLE}?si=Xy1Z_aBcDeFgH", ("handle", _HANDLE)),
    # The handle typed rather than pasted — the form a person says out loud.
    (_HANDLE, ("handle", _HANDLE)),
    # Copied without the scheme, which is what Safari's address bar gives you.
    (f"youtube.com/{_HANDLE}", ("handle", _HANDLE)),
    (f"www.youtube.com/{_HANDLE}", ("handle", _HANDLE)),
    # The raw channel id.
    (f"https://www.youtube.com/channel/{_CHANNEL}", ("channel", _CHANNEL)),
    (f"https://www.youtube.com/channel/{_CHANNEL}/videos", ("channel", _CHANNEL)),
    (f"https://m.youtube.com/channel/{_CHANNEL}", ("channel", _CHANNEL)),
    # A playlist, however the link was copied — including from a video open inside one.
    (f"https://www.youtube.com/playlist?list={_PLAYLIST}", ("playlist", _PLAYLIST)),
    (f"https://youtube.com/playlist?list={_PLAYLIST}", ("playlist", _PLAYLIST)),
    (f"https://www.youtube.com/watch?v=dQw4w9WgXcQ&list={_PLAYLIST}", ("playlist", _PLAYLIST)),
    (f"https://m.youtube.com/playlist?list={_PLAYLIST}&index=3", ("playlist", _PLAYLIST)),
    # Case in the host is not significant, and neither is surrounding whitespace. The bare
    # handle needs its own whitespace case: `urlsplit` trims a URL for us, but nothing trims a
    # value that never reaches it — and "@handle\n" is exactly what a paste produces.
    (f"https://WWW.YouTube.com/{_HANDLE}", ("handle", _HANDLE)),
    (f"  https://www.youtube.com/{_HANDLE}\n", ("handle", _HANDLE)),
    (f"  {_HANDLE}\n", ("handle", _HANDLE)),
)

_NOT_SOURCES = (
    # The old link forms. These are the reason the function returns None rather than guessing:
    # neither can be resolved through the Data API, so the honest answer is to ask for the
    # @handle link instead.
    "https://www.youtube.com/c/CornerstoneChapel",
    "https://www.youtube.com/user/cornerstonechpl",
    "https://www.youtube.com/c/CornerstoneChapel/videos",
    # A single video is a sermon_url, not a source.
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    # Ids of the wrong shape — caught here rather than spent on a doomed lookup.
    "https://www.youtube.com/channel/UCtooshort",
    "https://www.youtube.com/channel/notachannelidatall1234",
    "https://www.youtube.com/@ab",  # handles are at least 3 characters
    "https://www.youtube.com/@has spaces",
    "https://www.youtube.com/playlist?list=PLshort",
    # A radio/mix list is not a playlist anyone curates sermons into.
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ",
    # The channel's own pages that name no channel.
    "https://www.youtube.com/",
    "https://www.youtube.com/feed/subscriptions",
    "https://www.youtube.com/channel",
    # Something after the tab, which no real link has.
    f"https://www.youtube.com/{_HANDLE}/videos/extra",
    # The userinfo trick — the real host is evil.test, and a regex hunting for "youtube.com"
    # anywhere would fall for it.
    f"https://www.youtube.com@evil.test/{_HANDLE}",
    f"https://youtube.com.evil.test/{_HANDLE}",
    f"https://notyoutube.com/{_HANDLE}",
    # Not a link to anything.
    "",
    "   ",
    "not a url",
    "cornerstonechpl",  # a handle without its @
    f"ftp://www.youtube.com/{_HANDLE}",
    "javascript:alert(1)",
    "https://[bad",
)


def test_every_source_link_form_names_what_it_should() -> None:
    for url, expected in _SOURCES:
        assert parse_source_url(url) == expected, url


def test_anything_that_names_no_channel_or_playlist_is_none() -> None:
    for url in _NOT_SOURCES:
        assert parse_source_url(url) is None, url


def test_a_video_link_is_never_read_as_a_source() -> None:
    # The direction that matters: pasting a single sermon's link into "add a source" must be
    # rejected with the message asking for the channel link, never silently accepted as one.
    for url in _ACCEPTED:
        assert parse_source_url(url) is None, url


def test_a_watch_url_inside_a_playlist_names_both_and_that_is_correct() -> None:
    # The one link that satisfies both parsers, because it genuinely carries both facts. Each
    # function answers its own question and neither is wrong: the sermon-note field takes the
    # video, the add-source field takes the playlist. Pinned here so the overlap stays deliberate
    # rather than becoming a surprise when someone tightens one of the two.
    both = f"https://www.youtube.com/watch?v={_ID}&list={_PLAYLIST}"
    assert youtube_video_id(both) == _ID
    assert parse_source_url(both) == ("playlist", _PLAYLIST)

    # Every OTHER source form names no video at all.
    for url, _ in _SOURCES:
        if url == both:
            continue
        assert youtube_video_id(url) is None, url
