"""Verification boundary for the app-issued managed Genie MCP capability."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import time
from collections.abc import Mapping
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

PUBLIC_KEY_CONFIG = "genie_mcp_public_key"
AUDIENCE_CONFIG = "genie_mcp_audience"
PUBLIC_KEY_ENV = "PLAYER_INSIGHTS_GENIE_MCP_PUBLIC_KEY"
AUDIENCE_ENV = "PLAYER_INSIGHTS_GENIE_MCP_AUDIENCE"
CAPABILITY_INPUT = "genie_mcp_capability"
VERSION = 1
PURPOSE = "genie:mcp"
MAX_LIFETIME_SECONDS = 60
MAX_CLOCK_SKEW_SECONDS = 5
_PENDING: ContextVar[Any | None] = ContextVar(
    "adapt_genie_mcp_capability",
    default=None,
)


@dataclass(frozen=True)
class Verification:
    authorized: bool
    reason: str


@dataclass(frozen=True)
class Config:
    public_key: str
    audience: str


class CapabilitySanitizationError(RuntimeError):
    """The request object could not be stripped before tracing."""


def from_artifact(baked: Mapping[str, Any] | None) -> Config:
    values = baked or {}
    public_key = values.get(PUBLIC_KEY_CONFIG)
    audience = values.get(AUDIENCE_CONFIG)
    return Config(
        public_key=public_key.strip() if isinstance(public_key, str) else "",
        audience=audience.strip() if isinstance(audience, str) else "",
    )


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    ).encode("utf-8")


def _decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _integer(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _same_user(left: str, right: str) -> bool:
    return bool(left) and left.casefold() == right.strip().casefold()


def _public_key(value: str) -> Ed25519PublicKey:
    key = serialization.load_der_public_key(_decode(value))
    if not isinstance(key, Ed25519PublicKey):
        raise ValueError("not Ed25519")
    return key


def key_id(key: Ed25519PublicKey) -> str:
    der = key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return base64.urlsafe_b64encode(hashlib.sha256(der).digest()[:16]).decode().rstrip("=")


def consume(custom_inputs: dict[str, Any]) -> None:
    """Remove bearer-like material before any trace or early response."""

    _PENDING.set(custom_inputs.pop(CAPABILITY_INPUT, None))


def capability_pending() -> bool:
    return _PENDING.get() is not None


def clear() -> None:
    """Drop request-local material on every completion and cancellation path."""

    _PENDING.set(None)


def activate(
    custom_inputs: Mapping[str, Any],
    *,
    config: Config,
    request_id: str,
    observed_user: str,
    now: int | None = None,
) -> Verification:
    """Verify the consumed capability, clearing it before returning."""

    capability = _PENDING.get()
    try:
        return verify(
            {**custom_inputs, CAPABILITY_INPUT: capability},
            config=config,
            request_id=request_id,
            observed_user=observed_user,
            now=now,
        )
    finally:
        _PENDING.set(None)


def verify(
    custom_inputs: Mapping[str, Any],
    *,
    config: Config,
    request_id: str,
    observed_user: str,
    now: int | None = None,
) -> Verification:
    if custom_inputs.get("genie_transport") != "mcp":
        return Verification(False, "transport")
    envelope = custom_inputs.get(CAPABILITY_INPUT)
    if not isinstance(envelope, Mapping):
        return Verification(False, "missing")
    claims = envelope.get("claims")
    signature = _text(envelope.get("signature"))
    if not isinstance(claims, Mapping) or not signature:
        return Verification(False, "malformed")
    if not config.public_key or not config.audience:
        return Verification(False, "unconfigured")

    issued_at = _integer(claims.get("iat"))
    expires_at = _integer(claims.get("exp"))
    current = int(time.time()) if now is None else now
    if issued_at is None or expires_at is None:
        return Verification(False, "time")
    if issued_at > current + MAX_CLOCK_SKEW_SECONDS:
        return Verification(False, "future")
    if expires_at <= current:
        return Verification(False, "expired")
    if expires_at <= issued_at or expires_at - issued_at > MAX_LIFETIME_SECONDS:
        return Verification(False, "lifetime")

    try:
        public_key = _public_key(config.public_key)
    except (TypeError, ValueError, binascii.Error):
        return Verification(False, "public_key")

    subject = _text(claims.get("sub"))
    if _text(claims.get("request_id")) != request_id.strip():
        return Verification(False, "request")
    if not _same_user(subject, observed_user):
        return Verification(False, "user")
    expected = {
        "v": VERSION,
        "aud": config.audience,
        "purpose": PURPOSE,
        "sub": subject,
        "request_id": request_id.strip(),
        "iat": issued_at,
        "exp": expires_at,
        "transport": "mcp",
        "kid": key_id(public_key),
    }
    if dict(claims) != expected:
        return Verification(False, "claims")

    try:
        public_key.verify(_decode(signature), canonical_json(dict(claims)))
    except (InvalidSignature, ValueError, binascii.Error):
        return Verification(False, "signature")
    return Verification(True, "verified")
