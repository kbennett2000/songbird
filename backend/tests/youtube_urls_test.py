"""The YouTube URL → video id helper. Pure, so these are plain unit tests.

The point of the helper is that a sermon link arrives in whatever shape the person copying it
happened to get, and every one of those shapes has to resolve to the same id — while anything
that is not a link to a single video resolves to None, which is a normal answer rather than an
error.
"""

from songbird.youtube.urls import is_video_id, youtube_video_id

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
