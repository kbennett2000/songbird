"""Concord's location is configuration, never an assumption (CLAUDE.md invariant 2).

These exist because the invariant held in the code and was broken *around* it: the compose
file hardcoded `CONCORD_BASE_URL` into songbird's environment, so the setting below — correct
all along — was handed the wrong value on every boot and songbird read a Concord nobody chose.
`Settings` is the seam that has to keep honouring whatever it is given, wherever Concord lives.
"""

import pytest
from songbird.config import REPO_ROOT, Settings, get_settings


def test_concord_base_url_comes_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONCORD_BASE_URL", "http://192.168.1.62:8000")
    assert Settings().concord_base_url == "http://192.168.1.62:8000"


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:8000",  # same host
        "http://host.docker.internal:8000",  # songbird in Docker, Concord on the host
        "http://192.168.1.62:8000",  # another machine on the LAN
        "http://concord:8000",  # a container on a private compose network
        "https://scripture.example.net",  # no port at all
    ],
)
def test_any_reachable_address_is_taken_verbatim(url: str, monkeypatch: pytest.MonkeyPatch) -> None:
    """No co-location assumption: the value is used as given, not rewritten toward localhost."""
    monkeypatch.setenv("CONCORD_BASE_URL", url)
    assert Settings().concord_base_url == url


def test_environment_wins_over_the_dotenv_file(monkeypatch: pytest.MonkeyPatch) -> None:
    """A developer's checked-out .env must not outrank the deploy's own configuration.

    songbird reads `REPO_ROOT/.env` for local convenience. In the container the address arrives
    as an environment variable instead, and that has to win — otherwise a stray .env inside an
    image would silently redirect Scripture the way the compose file did.
    """
    monkeypatch.setenv("CONCORD_BASE_URL", "http://elsewhere.lan:9000")
    settings = Settings(_env_file=Settings.model_config["env_file"])  # type: ignore[call-arg]
    assert settings.concord_base_url == "http://elsewhere.lan:9000"


def test_get_settings_reflects_the_configured_address(monkeypatch: pytest.MonkeyPatch) -> None:
    """The cached accessor the app actually calls resolves the same value."""
    get_settings.cache_clear()
    monkeypatch.setenv("CONCORD_BASE_URL", "http://192.168.1.62:8000")
    try:
        assert get_settings().concord_base_url == "http://192.168.1.62:8000"
    finally:
        # The cache is process-wide; leaving a test's address in it would leak into the rest
        # of the suite.
        get_settings.cache_clear()


def test_the_sample_settings_file_leaves_concords_address_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`.env.example` is meant to be copied to `.env` as it is, so it must name no Concord.

    It used to carry a live `CONCORD_BASE_URL=http://localhost:8000`. Compose's own fallback to
    the bundled engine (`${CONCORD_BASE_URL:-http://concord:8000}`) only applies when `.env`
    leaves the address unset, so a copy started with `--profile bundled-concord` sent songbird to
    localhost inside its own container, and every page said Concord couldn't be reached. Left
    unset, compose falls back to the bundled engine, and songbird run outside Docker falls back
    to its own default: this machine.
    """
    example = REPO_ROOT / ".env.example"
    live = [
        line
        for line in example.read_text().splitlines()
        if line.strip().removeprefix("export ").lstrip().startswith("CONCORD_BASE_URL")
    ]
    assert live == []

    monkeypatch.delenv("CONCORD_BASE_URL", raising=False)
    settings = Settings(_env_file=example)  # type: ignore[call-arg]
    assert settings.concord_base_url == "http://localhost:8000"
