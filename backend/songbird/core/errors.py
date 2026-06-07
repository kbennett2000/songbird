"""Structured API errors. Mirrors soap-journal's `{detail:{code,message}}` shape."""

from enum import StrEnum
from typing import NoReturn

from fastapi import HTTPException


class ErrorCode(StrEnum):
    CONCORD_UNREACHABLE = "CONCORD_UNREACHABLE"
    NOT_FOUND = "NOT_FOUND"
    ANNOTATION_NOT_FOUND = "ANNOTATION_NOT_FOUND"
    SERMON_NOTE_NOT_FOUND = "SERMON_NOTE_NOT_FOUND"
    INVALID_SCOPE = "INVALID_SCOPE"
    INVALID_BOOK = "INVALID_BOOK"
    INVALID_TRANSLATION = "INVALID_TRANSLATION"
    NOT_AUTHENTICATED = "NOT_AUTHENTICATED"
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    USERNAME_TAKEN = "USERNAME_TAKEN"
    TOO_MANY_ATTEMPTS = "TOO_MANY_ATTEMPTS"


def raise_http(status: int, code: ErrorCode, message: str | None = None) -> NoReturn:
    raise HTTPException(
        status_code=status,
        detail={"code": code.value, "message": message or code.value},
    )
