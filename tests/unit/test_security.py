"""Unit tests for security primitives."""

from __future__ import annotations

import jwt
import pytest

from app.core.config import get_settings
from app.core.security import (
    build_totp_uri,
    create_token,
    decode_token,
    decrypt_value,
    encrypt_value,
    generate_recovery_codes,
    generate_totp_secret,
    hash_password,
    verify_password,
    verify_totp,
)


def test_password_hash_and_verify() -> None:
    h = hash_password("hunter2-correct-horse")
    assert h != "hunter2-correct-horse"
    assert verify_password("hunter2-correct-horse", h)
    assert not verify_password("wrong-password", h)


def test_password_verify_rejects_garbage() -> None:
    assert not verify_password("anything", "not-a-real-hash")


def test_token_roundtrip() -> None:
    token = create_token("user-123", token_type="access")
    payload = decode_token(token)
    assert payload["sub"] == "user-123"
    assert payload["type"] == "access"
    assert "exp" in payload and "iat" in payload and "jti" in payload


def test_token_signature_verified() -> None:
    token = create_token("user-x")
    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(token, "wrong-secret", algorithms=["HS256"])


def test_totp_verify_with_matching_code() -> None:
    import pyotp

    secret = generate_totp_secret()
    code = pyotp.TOTP(secret).now()
    assert verify_totp(secret, code)
    assert not verify_totp(secret, "000000")


def test_totp_uri_format() -> None:
    secret = generate_totp_secret()
    uri = build_totp_uri(secret, "user@example.com")
    assert uri.startswith("otpauth://totp/")
    assert get_settings().totp_issuer in uri


def test_recovery_codes_unique_and_sized() -> None:
    codes = generate_recovery_codes(10)
    assert len(codes) == 10
    assert len(set(codes)) == 10
    assert all(len(c) == 10 for c in codes)


def test_fernet_roundtrip() -> None:
    cipher = encrypt_value("super-secret-totp-base32")
    assert cipher != "super-secret-totp-base32"
    assert decrypt_value(cipher) == "super-secret-totp-base32"


def test_fernet_rejects_tampered() -> None:
    cipher = encrypt_value("payload")
    # Flip the middle of the ciphertext — invalidates HMAC.
    mid = len(cipher) // 2
    tampered = cipher[:mid] + ("A" if cipher[mid] != "A" else "B") + cipher[mid + 1 :]
    with pytest.raises(ValueError):
        decrypt_value(tampered)
