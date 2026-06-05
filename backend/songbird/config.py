"""Application configuration via pydantic-settings.

`CONCORD_BASE_URL` is the one knob that points songbird at Concord. Its default is a
convenience (the common same-host case), never an assumption that Concord is co-located —
songbird calls whatever URL it is given (CLAUDE.md invariant 2).
"""

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT: Path = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    port: int = 8077
    bind_host: str = "0.0.0.0"
    data_dir: Path = Path("./data")

    # Concord — songbird's hard runtime HTTP dependency.
    concord_base_url: str = "http://localhost:8000"
    concord_timeout: float = 5.0

    # Set in production (by the Docker image) to the built SPA's dist dir.
    frontend_dist_dir: Path | None = None

    @field_validator("data_dir")
    @classmethod
    def _resolve_data_dir(cls, value: Path) -> Path:
        if not value.is_absolute():
            value = REPO_ROOT / value
        return value.resolve()

    @property
    def database_url(self) -> str:
        db_path = self.data_dir / "songbird.db"
        return f"sqlite+aiosqlite:///{db_path}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
