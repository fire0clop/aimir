import secrets
from datetime import datetime, timedelta, timezone
from core.config import settings

def gen_code() -> str:
    n = settings.VERIFICATION_CODE_LENGTH
    return "".join(secrets.choice("0123456789") for _ in range(n))

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def expires_at() -> datetime:
    return now_utc() + timedelta(minutes=settings.VERIFICATION_CODE_TTL_MINUTES)
