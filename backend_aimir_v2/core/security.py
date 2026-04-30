from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Tuple
from jose import jwt, JWTError
from passlib.context import CryptContext
from core.config import settings

# Поддерживаем и новые хэши (bcrypt_sha256), и старые (bcrypt) для обратной совместимости
pwd_context = CryptContext(
    schemes=["bcrypt_sha256", "bcrypt"],
    deprecated="auto",
)

def hash_password(password: str) -> str:
    return pwd_context.hash(password)  # по умолчанию bcrypt_sha256

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)  # сам поймёт схема хэша

def _create_token(subject: str, expires_delta: timedelta) -> str:
    now = datetime.utcnow()
    payload: Dict[str, Any] = {"sub": subject, "iat": now, "exp": now + expires_delta}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)

def create_token_pair(user_id: str) -> Tuple[str, str]:
    access = _create_token(user_id, timedelta(minutes=settings.ACCESS_TOKEN_MINUTES))
    refresh = _create_token(user_id, timedelta(days=settings.REFRESH_TOKEN_DAYS))
    return access, refresh

def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None
