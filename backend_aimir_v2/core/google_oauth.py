# core/google_oauth.py
from typing import Optional, TypedDict

from google.oauth2 import id_token
from google.auth.transport import requests

from core.config import settings


class GoogleUserInfo(TypedDict, total=False):
    sub: str
    email: str
    email_verified: bool
    name: str
    picture: str


def verify_google_token(raw_id_token: str) -> Optional[GoogleUserInfo]:
    """
    Проверяет Google ID token и возвращает информацию о пользователе,
    либо None, если токен невалиден.
    """
    try:
        # Проверяем подпись и audience (наш GOOGLE_CLIENT_ID)
        idinfo = id_token.verify_oauth2_token(
            raw_id_token,
            requests.Request(),
            settings.GOOGLE_CLIENT_ID,   # должен быть в твоём settings
        )

        # Дополнительная проверка issuer
        if idinfo.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
            return None

        return GoogleUserInfo(
            sub=idinfo["sub"],
            email=idinfo.get("email", ""),
            email_verified=bool(idinfo.get("email_verified", False)),
            name=idinfo.get("name", ""),
            picture=idinfo.get("picture", ""),
        )
    except Exception:
        # Любая ошибка верификации → считаем токен невалидным
        return None
