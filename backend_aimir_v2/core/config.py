# core/config.py
import os
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()


class Settings:
    # === БАЗА ДАННЫХ ===
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://ii@localhost:5432/analytics_app")

    # === JWT ===
    JWT_SECRET: str = os.getenv("JWT_SECRET", "dev_secret_change_me")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    ACCESS_TOKEN_MINUTES: int = int(os.getenv("ACCESS_TOKEN_MINUTES", "30"))
    REFRESH_TOKEN_DAYS: int = int(os.getenv("REFRESH_TOKEN_DAYS", "7"))

    # === SMTP ===
    SMTP_HOST: str = os.getenv("SMTP_HOST", "smtp.yandex.com")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "465"))
    SMTP_USER: str = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM: str = os.getenv("SMTP_FROM", "")
    SMTP_TLS: bool = os.getenv("SMTP_TLS", "true").lower() == "true"

    # === Режим окружения ===
    ENV: str = os.getenv("ENV", "dev")

    # === Биллинг / цены (если применимо) ===
    SUB_PRICE_MONTH: int = int(os.getenv("SUB_PRICE_MONTH", "450"))
    SUB_PRICE_6M: int = int(os.getenv("SUB_PRICE_6M", "1750"))
    SUB_PRICE_YEAR: int = int(os.getenv("SUB_PRICE_YEAR", "3150"))
    REQUEST_PRICE: int = int(os.getenv("REQUEST_PRICE", "39"))

    # === Тбанк ключи ===
    TBANK_TERMINAL_KEY: str = os.getenv("TBANK_TERMINAL_KEY", "")
    TBANK_PASSWORD: str = os.getenv("TBANK_PASSWORD", "")
    TBANK_API: str = os.getenv("TBANK_API", "https://securepay.tinkoff.ru/v2")

    TELEGRAM_BOT_TOKEN: str = os.getenv("TELEGRAM_BOT_TOKEN", "")

    YANDEX_METRIKA_COUNTER_ID: int = 104333423
    YANDEX_METRIKA_TOKEN: str = os.getenv("YANDEX_METRIKA_TOKEN", "")

    # === Документы / гости ===
    DOCUMENTS_DIR: str = os.getenv("DOCUMENTS_DIR", os.path.abspath("documents"))
    GUEST_TTL_DAYS: int = int(os.getenv("GUEST_TTL_DAYS", "7"))
    PROMPT_FULL_ANALYSIS_V2: str = os.getenv("PROMPT_FULL_ANALYSIS", "")  # подставь значение из переменной окружения
    MERGE_PROMPT_V2: str = os.getenv("MERGE_PROMPT", "")
    @property
    def GUEST_TTL_DELTA(self) -> timedelta:
        return timedelta(days=self.GUEST_TTL_DAYS)

    # === OpenAI / модель ===
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o")
    OPENAI_TIMEOUT_SECONDS: float = float(os.getenv("OPENAI_TIMEOUT_SECONDS", "60"))
    OPENAI_MAX_TOKENS: int = int(os.getenv("OPENAI_MAX_TOKENS", "1024"))

    # Ключи (до трёх, для ротации)
    OPENAI_API_KEY_1: str | None = os.getenv("OPENAI_API_KEY_1") or None
    OPENAI_API_KEY_2: str | None = os.getenv("OPENAI_API_KEY_2") or None
    OPENAI_API_KEY_3: str | None = os.getenv("OPENAI_API_KEY_3") or None

    @property
    def OPENAI_KEYS(self) -> list[str]:
        return [k.strip() for k in (self.OPENAI_API_KEY_1, self.OPENAI_API_KEY_2, self.OPENAI_API_KEY_3) if k and k.strip()]

    PROMPT_IDENTIFY_PARTIES: str = os.getenv(
        "PROMPT_IDENTIFY_PARTIES",
        "Ты юридический аналитик договоров. Твоя задача — по тексту договора определить все стороны. "
        "Всегда возвращай результат строго в формате JSON: "
        '{"parties":[{"name":"<отображаемое_название>","role":"<краткое_описание_роли>"}]}. '
        "Если конкретных названий нет, используй роли вроде Заказчик, Исполнитель и т.п. "
        "Ответ — строго JSON, без комментариев."
    )

    PROMPT_FULL_ANALYSIS: str = os.getenv(
        "PROMPT_FULL_ANALYSIS",
        "Ты юридический аналитик. Проанализируй договор с точки зрения стороны \"{{party}}\". "
        "Верни строгий JSON с полями: summary, key_terms, risks, ambiguities, fixes, questions, verdict, danger_score."
    )

    MERGE_PROMPT: str = os.getenv(
        "MERGE_PROMPT",
        "Объедини результаты анализа частей в один итог по тем же разделам. Верни строгий JSON "
        "с полями: summary, key_terms, risks, ambiguities, fixes, questions, verdict, danger_score."
    )
    # === Стоимость 1к токенов в рублях===
    OPENAI_GPT4O_BLEND_PER_1K_RUB: float = float(os.getenv("OPENAI_GPT4O_BLEND_PER_1K_RUB", "1.06"))

    # === Верификация / OTP ===
    VERIFICATION_CODE_LENGTH: int = int(os.getenv("VERIFICATION_CODE_LENGTH", "6"))
    VERIFICATION_CODE_TTL_MINUTES: int = int(os.getenv("VERIFICATION_CODE_TTL_MINUTES", "15"))

    # === Google OAuth ===
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET: str | None = os.getenv("GOOGLE_CLIENT_SECRET") or None


    # === Разбиение текста и параллелизм ===
    ANALYSIS_CHUNK_CHARS: int = int(os.getenv("ANALYSIS_CHUNK_CHARS", "10000"))
    ANALYSIS_CHUNK_OVERLAP: int = int(os.getenv("ANALYSIS_CHUNK_OVERLAP", "800"))
    ANALYSIS_CONCURRENCY: int = int(os.getenv("ANALYSIS_CONCURRENCY", "3"))
    MAX_TOKENS_PER_CHUNK: int = int(os.getenv("MAX_TOKENS_PER_CHUNK", "50000"))

    # === Имена файлов аналитики ===
    ANALYTICS_FILENAME_PARTIES: str = os.getenv("ANALYTICS_FILENAME_PARTIES", "parties.json")
    ANALYTICS_FILENAME_RESULT: str = os.getenv("ANALYTICS_FILENAME_RESULT", "result.json")


settings = Settings()
