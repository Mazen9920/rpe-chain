"""MFA (TOTP) endpoints: enroll, verify, disable."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.security import (
    build_totp_uri,
    decrypt_value,
    encrypt_value,
    generate_recovery_codes,
    generate_totp_secret,
    verify_totp,
)
from app.core.users import current_active_user
from app.models.user import User

router = APIRouter(prefix="/mfa", tags=["mfa"])


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class MfaEnrollResponse(_Camel):
    secret: str
    otpauth_uri: str


class MfaVerifyRequest(_Camel):
    code: str = Field(min_length=6, max_length=6)


class MfaVerifyResponse(_Camel):
    mfa_enabled: bool
    recovery_codes: list[str]


class MfaDisableRequest(_Camel):
    code: str = Field(min_length=6, max_length=6)


@router.post("/enroll", response_model=MfaEnrollResponse)
async def enroll_mfa(
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> MfaEnrollResponse:
    """Generate a TOTP secret and provisioning URI. MFA not yet active until verified."""
    if user.mfa_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA already enabled",
        )
    secret = generate_totp_secret()
    user.totp_secret_encrypted = encrypt_value(secret)
    await db.commit()
    uri = build_totp_uri(secret, user.email)
    return MfaEnrollResponse(secret=secret, otpauth_uri=uri)


@router.post("/verify", response_model=MfaVerifyResponse)
async def verify_mfa(
    body: MfaVerifyRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> MfaVerifyResponse:
    """Confirm enrollment by submitting a valid 6-digit code; returns recovery codes once."""
    if not user.totp_secret_encrypted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA enrollment not started",
        )
    secret = decrypt_value(user.totp_secret_encrypted)
    if not verify_totp(secret, body.code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid TOTP code",
        )
    codes = generate_recovery_codes()
    user.recovery_codes_encrypted = encrypt_value(",".join(codes))
    user.mfa_enabled = True
    await db.commit()
    return MfaVerifyResponse(mfa_enabled=True, recovery_codes=codes)


@router.post("/disable", status_code=status.HTTP_204_NO_CONTENT)
async def disable_mfa(
    body: MfaDisableRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    if not user.mfa_enabled or not user.totp_secret_encrypted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA not enabled",
        )
    secret = decrypt_value(user.totp_secret_encrypted)
    if not verify_totp(secret, body.code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid TOTP code",
        )
    user.mfa_enabled = False
    user.totp_secret_encrypted = None
    user.recovery_codes_encrypted = None
    await db.commit()
