"""Unit tests for the in-memory login throttle: lock after N failures, per-key isolation,
reset clears, and window expiry frees a key — driven by an injected clock so they're
deterministic (no sleeping on wall-clock time)."""

from datetime import UTC, datetime, timedelta

from songbird.core.login_throttle import LoginThrottle


class _Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 1, 1, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, td: timedelta) -> None:
        self.now += td


def test_locks_after_max_failures() -> None:
    t = LoginThrottle(max_failures=3, window=timedelta(minutes=10), clock=_Clock())
    assert not t.is_locked("kris", "10.0.0.1")
    t.record_failure("kris", "10.0.0.1")
    t.record_failure("kris", "10.0.0.1")
    assert not t.is_locked("kris", "10.0.0.1")
    t.record_failure("kris", "10.0.0.1")
    assert t.is_locked("kris", "10.0.0.1")


def test_key_isolation_by_username_and_ip() -> None:
    t = LoginThrottle(max_failures=2, window=timedelta(minutes=10), clock=_Clock())
    t.record_failure("kris", "10.0.0.1")
    t.record_failure("kris", "10.0.0.1")
    assert t.is_locked("kris", "10.0.0.1")
    # Same IP, different username — not locked.
    assert not t.is_locked("other", "10.0.0.1")
    # Same username, different IP — not locked.
    assert not t.is_locked("kris", "10.0.0.2")


def test_reset_clears_failures() -> None:
    t = LoginThrottle(max_failures=2, window=timedelta(minutes=10), clock=_Clock())
    t.record_failure("kris", "10.0.0.1")
    t.record_failure("kris", "10.0.0.1")
    assert t.is_locked("kris", "10.0.0.1")
    t.reset("kris", "10.0.0.1")
    assert not t.is_locked("kris", "10.0.0.1")


def test_failures_expire_after_window() -> None:
    clock = _Clock()
    t = LoginThrottle(max_failures=2, window=timedelta(minutes=10), clock=clock)
    t.record_failure("kris", "10.0.0.1")
    t.record_failure("kris", "10.0.0.1")
    assert t.is_locked("kris", "10.0.0.1")
    # Past the window the old failures age out → unlocked again.
    clock.advance(timedelta(minutes=11))
    assert not t.is_locked("kris", "10.0.0.1")
    # A fresh failure starts a new count, not immediately locked.
    t.record_failure("kris", "10.0.0.1")
    assert not t.is_locked("kris", "10.0.0.1")
