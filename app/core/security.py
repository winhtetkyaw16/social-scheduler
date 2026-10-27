"""Password hashing, access tokens, and encryption for provider credentials."""

import base64
from datetime import datetime, timedelta, timezone
from hashlib import sha256

from cryptography.fernet import Fernet, InvalidToken
from jose import JWTError, jwt
from passlib.context import CryptContext
from passlib.exc import UnknownHashError

from app.core.config import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    ALGORITHM,
    REFRESH_TOKEN_EXPIRE_DAYS,
    SECRET_KEY,
    TOKEN_ENCRYPTION_KEY,
)

# bcrypt_sha256 safely supports long passwords; legacy bcrypt hashes still verify.
password_context = CryptContext(schemes=["bcrypt_sha256", "bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Hash a plaintext password using the configured password context."""
    return password_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Safely verify a password, rejecting malformed stored hashes."""
    try:
        return password_context.verify(password, password_hash)
    except (UnknownHashError, TypeError, ValueError):
        # A malformed or unsupported stored hash must never authenticate or cause a 500.
        return False


def create_access_token(subject: str) -> str:
    """Create a short-lived signed JWT with a string subject identifier."""
    if not subject:
        raise ValueError("Token subject cannot be empty")
    expires = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": subject, "exp": expires, "typ": "access"}, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(subject: str) -> str:
    """Create a longer-lived refresh JWT. It cannot be used as an API bearer token."""
    if not subject:
        raise ValueError("Token subject cannot be empty")
    expires = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": subject, "exp": expires, "typ": "refresh"}, SECRET_KEY, algorithm=ALGORITHM)


def refresh_token_subject(token: str) -> str:
    """Return the user id from a refresh token, or raise ValueError."""
    try:
        claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise ValueError("Invalid refresh token") from exc
    subject = claims.get("sub")
    if claims.get("typ") != "refresh" or not isinstance(subject, str) or not subject:
        raise ValueError("Invalid refresh token")
    return subject


def _fernet() -> Fernet:
    """Build a Fernet cipher from a configured or derived encryption key."""
    if TOKEN_ENCRYPTION_KEY and not TOKEN_ENCRYPTION_KEY.startswith("REPLACE_"):
        configured_key = TOKEN_ENCRYPTION_KEY.encode()
        try:
            # Keep compatibility with correctly generated Fernet keys.
            return Fernet(configured_key)
        except (TypeError, ValueError):
            # Accept a strong raw secret too, deriving the fixed-size Fernet key.
            if len(configured_key) < 32:
                raise RuntimeError("TOKEN_ENCRYPTION_KEY must be a Fernet key or at least 32 bytes")
            key = base64.urlsafe_b64encode(sha256(b"social-scheduler:token-encryption:v1:" + configured_key).digest())
            return Fernet(key)
    else:
        # Development fallback remains deterministic; production config rejects a missing key.
        key = base64.urlsafe_b64encode(sha256(SECRET_KEY.encode()).digest())
    return Fernet(key)


def encrypt_token(token: str) -> str:
    """Encrypt a provider token before storing it in the database."""
    return _fernet().encrypt(token.encode()).decode()


def decrypt_token(token: str) -> str:
    """Decrypt a stored provider token for a publishing request."""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise ValueError("Stored token could not be decrypted") from exc
