"""The default-user claim must not orphan existing annotations: a note that already belongs to
the seeded author (id=1) is owned by — and visible to — whoever first registers."""

from collections.abc import Callable

import httpx
from songbird.db.models import Annotation, User
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from tests.conftest import FakeConcordClient


async def test_first_registration_inherits_default_users_annotations(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # Pre-existing note owned by the seeded default user (id=1), as if created before auth.
    async with db_sessionmaker() as session:
        session.add(
            Annotation(
                book_usfm="JHN",
                start_chapter=3,
                start_verse=16,
                end_chapter=3,
                end_verse=16,
                note_markdown="A note from the single-user era.",
                scope_type="all",
                author_id=1,
            )
        )
        await session.commit()

    async with unauth_client(make_concord()) as client:
        reg = await client.post(
            "/api/v1/auth/register", json={"username": "kris", "password": "password1"}
        )
        assert reg.status_code == 201
        assert reg.json()["user"]["id"] == 1  # claimed, not a new row

        # The pre-auth note is now visible to the registered account — not orphaned.
        browse = await client.get("/api/v1/annotations")
        assert browse.status_code == 200
        notes = browse.json()
        assert len(notes) == 1
        assert notes[0]["note_markdown"] == "A note from the single-user era."
        assert notes[0]["author_id"] == 1

    # And there is still exactly one user row (the default was claimed in place).
    async with db_sessionmaker() as session:
        users = (await session.execute(select(User))).scalars().all()
        assert len(users) == 1
        assert users[0].username == "kris"
