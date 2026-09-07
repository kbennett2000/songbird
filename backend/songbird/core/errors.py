"""Structured API errors. Mirrors soap-journal's `{detail:{code,message}}` shape."""

from enum import StrEnum
from typing import NoReturn

from fastapi import HTTPException


class ErrorCode(StrEnum):
    CONCORD_UNREACHABLE = "CONCORD_UNREACHABLE"
    # YouTube (v1.7 sermon sources). Unlike Concord, YouTube's absence is a recorded condition,
    # not a fatal one — NOT_CONFIGURED simply means no key was set and the feature is off.
    YOUTUBE_NOT_CONFIGURED = "YOUTUBE_NOT_CONFIGURED"
    YOUTUBE_UNREACHABLE = "YOUTUBE_UNREACHABLE"
    YOUTUBE_QUOTA = "YOUTUBE_QUOTA"
    # The key exists but Google refused it — wrong, restricted, or the Data API not enabled.
    # Distinct from NOT_CONFIGURED (no key at all) because only this one needs a human.
    YOUTUBE_KEY_REJECTED = "YOUTUBE_KEY_REJECTED"
    NOT_FOUND = "NOT_FOUND"
    ANNOTATION_NOT_FOUND = "ANNOTATION_NOT_FOUND"
    SERMON_NOTE_NOT_FOUND = "SERMON_NOTE_NOT_FOUND"
    # Sermon sources (v1.7 slice 3). INVALID_SOURCE_URL is the one the owner meets most: a link
    # songbird cannot resolve, answered with the accepted forms rather than a bare rejection.
    SOURCE_NOT_FOUND = "SOURCE_NOT_FOUND"
    INVALID_SOURCE_URL = "INVALID_SOURCE_URL"
    SOURCE_EXISTS = "SOURCE_EXISTS"
    INVALID_SCOPE = "INVALID_SCOPE"
    INVALID_BOOK = "INVALID_BOOK"
    INVALID_TRANSLATION = "INVALID_TRANSLATION"
    NOT_AUTHENTICATED = "NOT_AUTHENTICATED"
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    USERNAME_TAKEN = "USERNAME_TAKEN"


def raise_http(status: int, code: ErrorCode, message: str | None = None) -> NoReturn:
    raise HTTPException(
        status_code=status,
        detail={"code": code.value, "message": message or code.value},
    )
