# services/analysis_v2.py
# Логика анализа, перенесённая с сайта (backend_aimir_v2/routers/analysis.py):
# Claude вместо OpenAI, нумерация абзацев, чанкинг длинных договоров,
# проверка цитат, структурный разбор по пунктам (issues).
from __future__ import annotations

import json
import os
from typing import List, Tuple

import httpx
from anthropic import Anthropic

from services.chunker import split_text
from services.preprocessor import number_paragraphs, verify_citations

ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
ANTHROPIC_MAX_TOKENS = int(os.getenv("ANTHROPIC_MAX_TOKENS", "8000"))

# Прокси только для Anthropic (API недоступен с российских IP напрямую).
# Telegram и платёжные запросы бота ходят без прокси.
ANTHROPIC_PROXY = os.getenv("ANTHROPIC_PROXY") or ""

_MAX_CHARS_SINGLE_PASS = 300_000


def _anthropic_client() -> Anthropic:
    api_key = (
        os.getenv("ANTHROPIC_API_KEY_1")
        or os.getenv("ANTHROPIC_API_KEY")
        or os.getenv("ANTHROPIC_API_KEY_2")
        or os.getenv("ANTHROPIC_API_KEY_3")
    )
    if not api_key:
        raise RuntimeError("No Anthropic API key configured (ANTHROPIC_API_KEY_1)")
    if ANTHROPIC_PROXY:
        return Anthropic(api_key=api_key, http_client=httpx.Client(proxy=ANTHROPIC_PROXY, timeout=120))
    return Anthropic(api_key=api_key)


# ================== ПРОМПТЫ (идентичны сайту) ==================

PROMPT_IDENTIFY_PARTIES = (
    "Ты юридический аналитик договоров. Твоя задача — по тексту договора определить все стороны. "
    "Всегда возвращай результат строго в формате JSON: "
    '{"parties":[{"name":"<отображаемое_название>","role":"<краткое_описание_роли>"}]}. '
    "Если конкретных названий нет, используй роли вроде Заказчик, Исполнитель и т.п. "
    "Ответ — строго JSON, без комментариев."
)

ANALYSIS_SYSTEM = """Ты — опытный юрист, который помогает обычным людям разобраться в договорах перед подписанием. Твой клиент — не юрист.

Твои правила:
1. Ищи ВСЕ условия, которые могут навредить стороне, которую ты защищаешь — даже если они выглядят безобидно
2. Для каждой проблемы приводи ТОЧНУЮ цитату из договора — слово в слово из указанного абзаца, ничего не перефразируй
3. Объясняй конкретно: что реально может случиться с человеком из-за этого пункта
4. Пропускай стандартные, безопасные, технические пункты (реквизиты, преамбула, стандартные обязательства)
5. Отвечай СТРОГО JSON без markdown-обёртки (без ```json, без ```), никакого текста вне объекта
6. Язык — русский
7. НИКОГДА не сообщай, что пункт «обрезан», «оборван», «неполный», «разорван» или что «текст утерян/потерян». Это артефакты извлечения текста, а НЕ юридическая проблема. Если фрагмент кажется неполным — молча пропусти его и анализируй только содержательные условия.
8. ПРОПУСКИ И НЕЗАПОЛНЕННЫЕ ПОЛЯ («___», «__», пустые места для суммы, срока, даты, номера счёта, реквизитов, ФИО) — это НОРМАЛЬНО для проекта/шаблона договора. Перед тобой ЧЕРНОВИК, который ещё будут заполнять. Это НЕ ошибка, НЕ юридическая дыра и НЕ повод для тревоги. Строгие правила для пропусков:
   - severity ВСЕГДА "low";
   - ЗАПРЕЩЕНО придумывать катастрофические последствия («потеряете жильё/квартиру», «договор признают недействительным/незаключённым/бессрочным», «выселят», «злоупотребления», «крайне сложно доказать»). Это всего лишь ещё не вписанное значение;
   - risk и why — одна спокойная нейтральная фраза в духе «поле пока не заполнено, впишите значение до подписания», без запугивания;
   - ВСЕ пропуски объедини в ОДНУ находку с перечнем (problem: «Незаполненные поля черновика»), а НЕ создавай отдельную запись на каждый прочерк;
   - пропуски НЕ должны быть главной темой анализа и НЕ должны сами по себе сильно снижать danger_score. Оценивай опасность по РЕАЛЬНО написанным условиям, а не по пустым полям."""

ANALYSIS_USER = """\
Проанализируй договор с точки зрения стороны: {party}

Текст договора пронумерован по абзацам [1], [2], ...
При цитировании — копируй точный текст из нужного абзаца и указывай его номер [N].

ДОГОВОР:
{numbered_text}

Верни ТОЛЬКО этот JSON (без пояснений вне объекта):
{{
  "summary": "2-3 предложения: что это за договор, какие главные обязательства для {party}",
  "overall_assessment": {{
    "danger_score": 75,
    "verdict": "Стоит ли подписывать? Какие главные риски — 1-2 предложения"
  }},
  "issues": [
    {{
      "clause": "[42]",
      "text": "точная дословная цитата из абзаца [42] — скопируй текст слово в слово",
      "problem": "Короткое название проблемы (5-7 слов)",
      "risk": "Конкретный сценарий: что может случиться с {party} если это останется в договоре",
      "why": "Простым языком без терминов: почему этот пункт выгоден контрагенту и опасен для {party}",
      "fix": "Что конкретно попросить изменить, добавить или убрать перед подписанием",
      "severity": "high"
    }}
  ]
}}

danger_score: 100 = полностью безопасно, 0 = крайне опасно. Незаполненные поля черновика НЕ снижают danger_score — оценивай по написанным условиям.
severity: high = финансовые потери или юридическая ответственность | medium = проблемы при исполнении | low = желательно исправить ИЛИ незаполненное поле шаблона
Незаполненные пропуски («___») — это черновик, а не ошибка: собери их в ОДНУ находку severity "low", спокойным тоном, без страшных сценариев."""

ANALYSIS_USER_PART = """\
Проанализируй ЧАСТЬ {part_num} из {total_parts} договора с точки зрения стороны: {party}

Это фрагмент большого документа. Анализируй только то, что есть в этом фрагменте.
Текст пронумерован по абзацам [1], [2], ...

ФРАГМЕНТ {part_num}/{total_parts}:
{numbered_text}

Верни ТОЛЬКО этот JSON:
{{
  "summary": "краткое описание этого фрагмента",
  "overall_assessment": {{
    "danger_score": 75,
    "verdict": "оценка этого фрагмента"
  }},
  "issues": [
    {{
      "clause": "[N]",
      "text": "точная цитата из абзаца [N]",
      "problem": "название проблемы",
      "risk": "конкретный сценарий",
      "why": "объяснение простым языком",
      "fix": "что изменить",
      "severity": "high|medium|low"
    }}
  ]
}}"""

MERGE_SYSTEM = """Ты — юридический аналитик. Объединяешь частичные анализы договора в один итоговый. Отвечаешь строго JSON без markdown-обёртки (без ```json, без ```)."""

MERGE_USER = """\
Объедини частичные анализы фрагментов одного договора в один итоговый анализ.

Правила:
- summary: напиши единое описание всего договора
- danger_score: среднее, но если есть хоть один high-риск — снизь на 10-15 пунктов
- verdict: итоговая рекомендация по всему договору
- issues: объедини все проблемы, удали дубликаты, отсортируй high→medium→low
- При объединении issues: СОХРАНЯЙ дословные цитаты без изменений

ЧАСТИЧНЫЕ АНАЛИЗЫ:
{parts_json}

Верни ТОЛЬКО JSON:
{{
  "summary": "...",
  "overall_assessment": {{
    "danger_score": 75,
    "verdict": "..."
  }},
  "issues": [...]
}}"""


# ================== JSON-хелперы (идентичны сайту) ==================

def _strip_md_fence(raw: str) -> str:
    if not raw:
        return ""
    s = raw.strip()
    if not s.startswith("```"):
        return s
    lines = s.splitlines()
    if not lines:
        return s
    if lines[0].lstrip().startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _safe_json_loads(raw: str) -> dict:
    if not raw:
        return {}
    s = _strip_md_fence(raw)
    try:
        return json.loads(s)
    except Exception:
        try:
            return json.loads(s.strip('"').strip("'"))
        except Exception:
            return {}


def _call_claude(client: Anthropic, system: str, user: str, max_tokens: int | None = None) -> dict:
    completion = client.messages.create(
        model=ANTHROPIC_MODEL,
        system=system,
        messages=[{"role": "user", "content": user}],
        max_tokens=max_tokens or ANTHROPIC_MAX_TOKENS,
        # sonnet-5: без явного disabled модель по умолчанию включает adaptive
        # thinking — для структурного анализа это лишние токены и задержка
        thinking={"type": "disabled"},
    )
    content = completion.content[0].text if completion.content else ""
    if not content.strip():
        raise RuntimeError("AI вернул пустой ответ")
    data = _safe_json_loads(content)
    if isinstance(data, str):
        data = _safe_json_loads(data)
    return data


# ================== ПУБЛИЧНОЕ API ==================

def identify_parties(full_text: str) -> List[dict]:
    """Определение сторон договора (как /analysis/parties на сайте)."""
    preview = (full_text or "")[:2000]
    prompt = (
        "Определи все стороны договора из текста ниже.\n"
        "Верни ТОЛЬКО JSON в точном формате — без markdown, без пояснений:\n"
        '{"parties":[{"name":"Название стороны","role":"Роль в договоре"}]}\n\n'
        f"{PROMPT_IDENTIFY_PARTIES}\n\n"
        "----- DOCUMENT TEXT PREVIEW (first 2000 chars) -----\n"
        f"{preview}\n"
    )
    client = _anthropic_client()
    data = _call_claude(
        client,
        system="Ты инструмент извлечения данных. Отвечай строго валидным JSON без markdown и без лишнего текста.",
        user=prompt,
        max_tokens=512,
    )

    parties_struct = data.get("parties") or []
    out: List[dict] = []
    items = (
        parties_struct if isinstance(parties_struct, list)
        else list(parties_struct.values()) if isinstance(parties_struct, dict)
        else []
    )
    for item in items:
        if isinstance(item, dict):
            name = str(item.get("name") or "").strip()
            role = str(item.get("role") or "").strip()
            if name or role:
                out.append({"name": name or role, "role": role})
    return out


def run_full_analysis(text: str, party: str) -> dict:
    """
    Умный анализ договора (как /analysis/select-v2 на сайте):
    1. Нумерует абзацы [N] для точных цитат
    2. Один проход для обычных договоров, чанки + merge для очень длинных
    3. Проверяет цитаты по абзацам-первоисточникам
    Возвращает нормализованную структуру:
    {summary, overall_assessment{verdict, danger_score}, issues[...]}.
    """
    if not text or not text.strip():
        raise RuntimeError("Document text is empty")

    numbered_text, paragraphs = number_paragraphs(text)
    client = _anthropic_client()

    if len(numbered_text) <= _MAX_CHARS_SINGLE_PASS:
        raw = _call_claude(
            client,
            system=ANALYSIS_SYSTEM,
            user=ANALYSIS_USER.format(party=party, numbered_text=numbered_text),
        )
    else:
        chunks = split_text(numbered_text)
        total = len(chunks)
        all_parts: List[dict] = []
        for idx, chunk in enumerate(chunks, start=1):
            part_raw = _call_claude(
                client,
                system=ANALYSIS_SYSTEM,
                user=ANALYSIS_USER_PART.format(
                    party=party, numbered_text=chunk, part_num=idx, total_parts=total,
                ),
            )
            all_parts.append(part_raw)
        raw = _call_claude(
            client,
            system=MERGE_SYSTEM,
            user=MERGE_USER.format(parts_json=json.dumps(all_parts, ensure_ascii=False, indent=2)),
        )

    # проверка цитат по первоисточнику
    if isinstance(raw.get("issues"), list):
        raw["issues"] = verify_citations(raw["issues"], paragraphs)

    # сортировка high → medium → low
    sev_order = {"high": 0, "medium": 1, "low": 2}
    if isinstance(raw.get("issues"), list):
        raw["issues"].sort(key=lambda x: sev_order.get(x.get("severity", "low"), 3))

    return _normalize(raw)


def _normalize(data: dict) -> dict:
    """Приводим результат к ожидаемой структуре (как _normalize_analysis_v2 на сайте)."""
    if not isinstance(data, dict):
        return {"summary": "", "overall_assessment": {"verdict": "", "danger_score": 0}, "issues": []}

    oa = data.get("overall_assessment") or {}
    if not isinstance(oa, dict):
        oa = {}
    try:
        danger = float(oa.get("danger_score", 0))
    except Exception:
        danger = 0.0

    result = {
        "summary": data.get("summary", ""),
        "overall_assessment": {
            "verdict": oa.get("verdict", ""),
            "danger_score": danger,
        },
        "issues": [],
    }

    issues = data.get("issues", [])
    if isinstance(issues, list):
        for issue in issues:
            if isinstance(issue, dict):
                result["issues"].append({
                    "clause": issue.get("clause", ""),
                    "text": issue.get("text", ""),
                    "problem": issue.get("problem", ""),
                    "risk": issue.get("risk", ""),
                    "why": issue.get("why", ""),
                    "fix": issue.get("fix", ""),
                    "severity": issue.get("severity", "low")
                    if issue.get("severity") in ["low", "medium", "high"] else "low",
                })

    return result
