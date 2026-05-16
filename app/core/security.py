"""Security primitives: password hashing, JWT, TOTP, Fernet encryption."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import jwt
import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings

_settings = get_settings()
_hasher = PasswordHasher()

ALGORITHM = "HS256"
TokenType = Literal["access", "refresh"]


# ---- Password hashing ------------------------------------------------------


def hash_password(plain: str) -> str:
    return _hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, plain)
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def password_needs_rehash(hashed: str) -> bool:
    return _hasher.check_needs_rehash(hashed)


# ---- JWT -------------------------------------------------------------------


def _utcnow() -> datetime:
    return datetime.now(UTC)


def create_token(
    subject: str,
    token_type: TokenType = "access",  # noqa: S107
    extra_claims: dict[str, Any] | None = None,
) -> str:
    now = _utcnow()
    if token_type == "access":  # noqa: S105
        expires = now + timedelta(seconds=_settings.access_token_ttl_seconds)
    else:
        expires = now + timedelta(seconds=_settings.refresh_token_ttl_seconds)

    payload: dict[str, Any] = {
        "sub": subject,
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "jti": secrets.token_urlsafe(16),
    }
    if extra_claims:
        payload.update(extra_claims)

    return jwt.encode(payload, _settings.secret_key, algorithm=ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, _settings.secret_key, algorithms=[ALGORITHM])


# ---- TOTP ------------------------------------------------------------------


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def build_totp_uri(secret: str, account_name: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=account_name, issuer_name=_settings.totp_issuer)


def verify_totp(secret: str, code: str, *, valid_window: int = 1) -> bool:
    return pyotp.TOTP(secret).verify(code, valid_window=valid_window)


def generate_recovery_codes(n: int = 10) -> list[str]:
    return [secrets.token_hex(5) for _ in range(n)]


# ---- Symmetric encryption (Fernet) for at-rest secrets ---------------------


def _fernet() -> Fernet:
    key = _settings.encryption_key
    if not key:
        raise RuntimeError("ENCRYPTION_KEY not configured")
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_value(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_value(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as e:
        raise ValueError("Invalid encrypted token") from e
