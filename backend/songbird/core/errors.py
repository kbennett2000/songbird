"""Structured API errors. Mirrors soap-journal's `{detail:{code,message}}` shape."""

from enum import StrEnum
from typing import NoReturn

from fastapi import HTTPException


class ErrorCode(StrEnum):
    CONCORD_UNREACHABLE = "CONCORD_UNREACHABLE"


def raise_http(status: int, code: ErrorCode, message: str | None = None) -> NoReturn:
    raise HTTPException(
        status_code=status,
        detail={"code": code.value, "message": message or code.value},
    )
