"""Best-effort in-memory login throttle — a brute-force speed bump layered on top of Argon2's
cost, NOT a distributed limiter. State lives in this object (one per process), so it resets on
restart and is not shared across workers. Keyed by (username, client IP): once a key reaches
``max_failures`` within ``window``, attempts are locked out until the oldest still-counted
failure ages out of the window; a successful login clears the key. See docs/SECURITY.md §6."""

from collections import deque
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

MAX_FAILURES = 5
WINDOW = timedelta(minutes=15)


def _utcnow() -> datetime:
    return datetime.now(UTC)


class LoginThrottle:
    def __init__(
        self,
        *,
        max_failures: int = MAX_FAILURES,
        window: timedelta = WINDOW,
        clock: Callable[[], datetime] = _utcnow,
    ) -> None:
        self._max = max_failures
        self._window = window
        self._clock = clock
        self._failures: dict[tuple[str, str], deque[datetime]] = {}

    def _prune(self, key: tuple[str, str]) -> deque[datetime] | None:
        """Drop failures older than the window; forget the key entirely if none remain."""
        dq = self._failures.get(key)
        if dq is None:
            return None
        cutoff = self._clock() - self._window
        while dq and dq[0] <= cutoff:
            dq.popleft()
        if not dq:
            del self._failures[key]
            return None
        return dq

    def is_locked(self, username: str, ip: str) -> bool:
        dq = self._prune((username, ip))
        return dq is not None and len(dq) >= self._max

    def record_failure(self, username: str, ip: str) -> None:
        key = (username, ip)
        dq = self._prune(key)
        if dq is None:
            dq = self._failures[key] = deque[datetime]()
        dq.append(self._clock())

    def reset(self, username: str, ip: str) -> None:
        self._failures.pop((username, ip), None)
