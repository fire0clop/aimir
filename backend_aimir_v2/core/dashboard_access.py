# core/dashboard_access.py
import json
import os
from functools import lru_cache


@lru_cache(maxsize=1)
def get_dashboard_whitelist() -> set[str]:
    """
    Возвращает множество e-mail'ов, которым разрешён доступ к дашборду.
    Читает core/dashboard_whitelist.json один раз (кэшируется).
    """
    base_dir = os.path.dirname(__file__)
    path = os.path.join(base_dir, "dashboard_whitelist.json")

    if not os.path.exists(path):
        return set()

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    emails = set()
    for item in data:
        if isinstance(item, str):
            emails.add(item.strip().lower())
    return emails
