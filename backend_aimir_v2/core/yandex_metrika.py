# core/yandex_metrika.py
from datetime import date
from typing import List, Dict, Any

import requests
from requests import HTTPError

from core.config import settings


BASE_URL = "https://api-metrika.yandex.net/stat/v1"

# цели из Метрики
GOALS = [
    {
        "id": 488503811,
        "key": "visit_upload",
        "name": "Посещение",
    },
    {
        "id": 488503867,
        "key": "upload_doc",
        "name": "Загрузка документа",
    },
    {
        "id": 488504606,
        "key": "select_party",
        "name": "Выбор стороны и получение аналитики",
    },
    {
        "id": 488504731,
        "key": "go_billing",
        "name": "Переход к оплате",
    },
    {
        "id": 488504768,
        "key": "payment_success",
        "name": "Успешная оплата",
    },
]


def _get_headers() -> Dict[str, str]:
    token = settings.YANDEX_METRIKA_TOKEN
    if not token:
        # чтобы сразу было видно, если забыли токен
        raise RuntimeError("YANDEX_METRIKA_TOKEN is not set in settings")
    return {
        "Authorization": f"OAuth {token}",
    }


def fetch_visits_timeseries(
    start_date: date,
    end_date: date,
    counter_id: int | None = None,
) -> List[Dict[str, Any]]:
    """
    Таймсерия посещений по дням.
    """
    if counter_id is None:
        counter_id = settings.YANDEX_METRIKA_COUNTER_ID

    url = f"{BASE_URL}/data/bytime"

    params = {
        "ids": counter_id,
        "metrics": "ym:s:visits",
        "date1": start_date.isoformat(),
        "date2": end_date.isoformat(),
        "group": "day",
    }

    resp = requests.get(url, headers=_get_headers(), params=params, timeout=10)

    try:
        resp.raise_for_status()
    except HTTPError as e:
        # добавим body в текст ошибки
        raise HTTPError(f"Yandex Metrika bytime error: {e} | body={resp.text}") from e

    data = resp.json()

    # time_intervals: [[date1, date2], ...]
    intervals = data.get("time_intervals") or []
    data_rows = data.get("data") or []

    if not data_rows:
        return []

    # твой пример: "metrics": [[14.0, 6.0, ...]]
    row0 = data_rows[0]
    metrics_list = row0.get("metrics") or []

    if not metrics_list:
        metrics = []
    else:
        # бывает [[...]] или просто [...], поддержим оба варианта
        raw = metrics_list[0]
        if isinstance(raw, list):
            metrics = raw
        else:
            metrics = metrics_list

    items: List[Dict[str, Any]] = []
    for interval, value in zip(intervals, metrics):
        day_str = interval[0]  # "2025-11-14"
        items.append(
            {
                "date": day_str,
                "visits": int(value),
            }
        )

    return items


def fetch_goals_funnel(
    start_date: date,
    end_date: date,
    counter_id: int | None = None,
) -> Dict[str, Any]:
    """
    Воронка: визиты + цели.
    """
    if counter_id is None:
        counter_id = settings.YANDEX_METRIKA_COUNTER_ID

    # сначала метрика по визитам, затем по всем целям
    metrics_parts = ["ym:s:visits"]
    for g in GOALS:
        metrics_parts.append(f"ym:s:goal{g['id']}reaches")
    metrics_str = ",".join(metrics_parts)

    url = f"{BASE_URL}/data"
    params = {
        "ids": counter_id,
        "metrics": metrics_str,
        "date1": start_date.isoformat(),
        "date2": end_date.isoformat(),
        # group по умолчанию ок, нам нужны суммарные значения
    }

    resp = requests.get(url, headers=_get_headers(), params=params, timeout=10)

    try:
        resp.raise_for_status()
    except HTTPError as e:
        raise HTTPError(f"Yandex Metrika goals error: {e} | body={resp.text}") from e

    data = resp.json()

    # Варианты, которые реально бывают:
    #  - один metric: "totals": [2.0]
    #  - несколько metrics: "totals": [14.0, 2.0, 1.0, ...]
    raw_totals = data.get("totals") or []

    if not raw_totals:
        metric_values: list[float] = []
    else:
        first = raw_totals[0]
        # если это список, значит totals = [[...]]
        if isinstance(first, list):
            metric_values = first
        else:
            # если как в твоём curl: [2.0]
            metric_values = raw_totals

    if not metric_values:
        visits_total = 0
    else:
        # первый элемент — ym:s:visits
        visits_total = int(metric_values[0])

    steps: List[Dict[str, Any]] = []
    prev_count = visits_total
    first_count = visits_total or 1  # чтобы не делить на 0

    # metric_values[1:] соответствуют целям в порядке GOALS
    for idx, g in enumerate(GOALS, start=1):
        value = 0
        if idx < len(metric_values):
            try:
                value = int(metric_values[idx])
            except (ValueError, TypeError):
                value = 0

        conv_from_prev = (value / prev_count * 100) if prev_count else 0.0
        conv_from_first = (value / first_count * 100) if first_count else 0.0

        steps.append(
            {
                "key": g["key"],
                "name": g["name"],
                "count": value,
                "conversion_from_prev": round(conv_from_prev, 2),
                "conversion_from_first": round(conv_from_first, 2),
            }
        )

        prev_count = value

    return {
        "visits_total": visits_total,
        "steps": steps,
    }
