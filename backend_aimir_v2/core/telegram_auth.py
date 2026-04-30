# core/telegram_auth.py
import hashlib
import hmac
from core.config import settings  # TELEGRAM_BOT_TOKEN

def check_telegram_auth(data: dict) -> bool:
    """
    data — dict с полями, пришедшими от Telegram Login Widget.
    Ожидаем, что сюда прилетает payload целиком (включая hash).
    """
    # 1. Достаём hash
    received_hash = data.pop("hash", None)
    if not received_hash:
        return False

    # 2. Убираем поля, которых не было в изначальном запросе (None)
    data = {k: v for k, v in data.items() if v is not None}

    # 3. Секретный ключ = SHA256(bot_token)
    secret_key = hashlib.sha256(settings.TELEGRAM_BOT_TOKEN.encode()).digest()

    # 4. Формируем строку для проверки как в доке Telegram
    data_check_arr = [f"{k}={v}" for k, v in sorted(data.items())]
    data_check_string = "\n".join(data_check_arr)

    # 5. Считаем HMAC
    h = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    return h == received_hash
