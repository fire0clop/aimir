# routers/analysis.py
from __future__ import annotations

import json
import os
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Optional, List, Tuple, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Header, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from anthropic import Anthropic

from core.config import settings
from core.security import decode_token
from db import get_db
from models.document import Document
from models.guest import GuestDocument
from models.user import User
from models.contract_analysis import ContractAnalysis
from services.chunker import split_text
from schemas.analysis import (
    PartiesResponse,
    SelectPartyBody,
    SelectPartyResponse,
    AccessInfo,
    OverallAssessment,
    Issue,
    ContractAnalysisResponse,
    SelectPartyResponseV2,
)

router = APIRouter(prefix="/analysis", tags=["analysis"])

DOCS_ROOT = Path(getattr(settings, "DOCUMENTS_DIR", "./documents")).resolve()
DOCS_ROOT.mkdir(parents=True, exist_ok=True)


# --- Anthropic client ---


def _anthropic_client() -> Anthropic:
    api_key = None
    keys = getattr(settings, "ANTHROPIC_KEYS", []) or []
    if keys:
        api_key = keys[0]
    if not api_key:
        api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("No Anthropic API key configured")
    return Anthropic(api_key=api_key)


# --- helpers ---


def _today() -> date:
    return date.today()


def _is_subscription_active(u: User) -> bool:
    """
    Активна ли подписка по датам.
    """
    return bool(u.subscription_end and u.subscription_end >= _today())


def _get_credits(u: User) -> int:
    """
    Кредиты = целое число из balance.
    """
    return int(Decimal(u.balance or 0).quantize(Decimal("1")))


def _get_user_from_auth(authorization: Optional[str], db: Session) -> Optional[User]:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1]
    payload = decode_token(token)
    if not payload:
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    return db.query(User).filter(User.id == user_id).first()


class LoadedDoc(BaseModel):
    kind: str  # "user" | "guest"
    id: str
    owner_id: str
    storage_dir: Path
    text: str


def _load_document_and_text(db: Session, document_id: str) -> LoadedDoc:
    """
    Ищем документ сначала среди юзерских, потом среди гостевых.
    Читаем text.txt, который заранее кладём в ту же папку, что и бинарник.
    """
    # user-doc
    doc = db.query(Document).filter(Document.id == document_id).first()
    if doc:
        storage_key = doc.storage_key
        owner_id = str(doc.user_id)
        kind = "user"
    else:
        gdoc = db.query(GuestDocument).filter(GuestDocument.id == document_id).first()
        if not gdoc:
            raise HTTPException(status_code=404, detail="Document not found")
        storage_key = gdoc.storage_key
        owner_id = str(gdoc.guest_id)
        kind = "guest"

    bin_path = DOCS_ROOT / storage_key
    storage_dir = bin_path.parent
    txt_path = storage_dir / "text.txt"
    if not txt_path.exists():
        raise HTTPException(status_code=409, detail="Text version not prepared yet")

    try:
        text = txt_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to read text version")

    if not text.strip():
        raise HTTPException(status_code=422, detail="Document text is empty")

    return LoadedDoc(
        kind=kind,
        id=str(document_id),
        owner_id=owner_id,
        storage_dir=storage_dir,
        text=text,
    )


def _strip_md_fence(raw: str) -> str:
    """
    Снимаем ``` / ```json обёртку, если модель вернула JSON в markdown-кодблоке.
    """
    if not raw:
        return ""
    s = raw.strip()
    if not s.startswith("```"):
        return s

    lines = s.splitlines()
    if not lines:
        return s

    # первая строка типа ``` или ```json
    if lines[0].lstrip().startswith("```"):
        lines = lines[1:]

    # последняя строка может быть просто ```
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


def _save_analysis_to_disk(storage_dir: Path, data: dict) -> None:
    storage_dir.mkdir(parents=True, exist_ok=True)
    fname = getattr(settings, "ANALYTICS_FILENAME_RESULT", None) or "result.json"
    out_path = storage_dir / fname
    try:
        with out_path.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"WARN: failed to write analysis result file {out_path}: {e!r}")


def _load_analysis_from_disk(storage_dir: Path) -> dict:
    fname = getattr(settings, "ANALYTICS_FILENAME_RESULT", None) or "result.json"
    path = storage_dir / fname
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as f:
            raw = f.read()
    except Exception:
        return {}
    data = _safe_json_loads(raw)
    if isinstance(data, str):
        data = _safe_json_loads(data)
    return data if isinstance(data, dict) else {}


def _usage_tokens(usage) -> int:
    if usage is None:
        return 0
    try:
        return int((usage.input_tokens or 0) + (usage.output_tokens or 0))  # type: ignore[attr-defined]
    except Exception:
        return 0


def _normalize_analysis(data: dict) -> dict:
    """
    Приводим поля summary/key_terms/risks/... к строкам, чтобы фронт мог их
    просто рендерить как текст. Если модель вернула dict/list — склеиваем.
    """
    if not isinstance(data, dict):
        return {}

    res: Dict[str, Any] = dict(data)
    text_fields = [
        "summary",
        "key_terms",
        "risks",
        "ambiguities",
        "fixes",
        "questions",
        "verdict",
    ]

    for field in text_fields:
        v = res.get(field)

        if isinstance(v, dict):
            parts = []
            for k, val in v.items():
                if isinstance(val, (dict, list)):
                    val_str = json.dumps(val, ensure_ascii=False)
                else:
                    val_str = str(val)
                parts.append(f"{k}: {val_str}")
            res[field] = "\n".join(parts)
        elif isinstance(v, list):
            parts = []
            for item in v:
                if isinstance(item, (dict, list)):
                    parts.append("- " + json.dumps(item, ensure_ascii=False))
                else:
                    parts.append(f"- {item}")
            res[field] = "\n".join(parts)
        elif v is None:
            res[field] = ""
        else:
            res[field] = str(v)

    # danger_score — нормализуем в число
    ds = res.get("danger_score")
    if isinstance(ds, (int, float)):
        pass
    else:
        try:
            if ds is None or ds == "":
                res["danger_score"] = 0
            else:
                res["danger_score"] = float(ds)
        except Exception:
            res["danger_score"] = 0

    return res


def _apply_paywall(analysis: dict, mode: str) -> dict:
    """
    Возвращает либо полный анализ, либо превью (summary + key_terms),
    остальные поля заменяет заглушкой.
    mode: "guest" | "preview" | "full"
    """
    if mode == "full":
        return analysis

    res = dict(analysis)
    keep_fields = {"summary", "key_terms"}
    if mode == "guest":
        msg = "Полная аналитика доступна после регистрации и оплаты."
    else:  # preview для незаплатившего пользователя
        msg = "Полная аналитика доступна после разблокировки документа."

    for field in ["risks", "ambiguities", "fixes", "questions", "verdict"]:
        res[field] = msg

    # при желании можно занулить danger_score, чтобы не спойлерить вывод
    res["danger_score"] = 0
    return res


# ---------- 1. Определение сторон договора ----------


@router.get("/parties", response_model=PartiesResponse)
def analyze_parties(
    document_id: str = Query(..., alias="document_id"),
    force: bool = Query(False),
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None, convert_underscores=False),
):
    user = _get_user_from_auth(authorization, db)
    loaded = _load_document_and_text(db, document_id)

    # документы пользователей доступны только их владельцу
    if loaded.kind == "user" and (not user or loaded.owner_id != str(user.id)):
        raise HTTPException(status_code=403, detail="Document does not belong to user")

    text = loaded.text

    client = _anthropic_client()

    base_prompt = settings.PROMPT_IDENTIFY_PARTIES

    preview = text[:2000]
    full_prompt = (
        f"{base_prompt}\n\n"
        "----- DOCUMENT TEXT PREVIEW (first 2000 chars) -----\n"
        f"{preview}\n"
    )

    print("\n========== CLAUDE PROMPT START ==========")
    print(full_prompt[:4000])
    print("========== CLAUDE PROMPT END ==========\n")

    parties_prompt = (
        "Определи все стороны договора из текста ниже.\n"
        "Верни ТОЛЬКО JSON в точном формате — без markdown, без пояснений:\n"
        '{"parties":[{"name":"Название стороны","role":"Роль в договоре"}]}\n\n'
        "Пример ответа:\n"
        '{"parties":[{"name":"ООО Ромашка","role":"Заказчик"},{"name":"ИП Иванов","role":"Исполнитель"}]}\n\n'
        f"{full_prompt}"
    )
    try:
        completion = client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            system="Ты инструмент извлечения данных. Отвечай строго валидным JSON без markdown и без лишнего текста.",
            messages=[{"role": "user", "content": parties_prompt}],
            max_tokens=512,
            # sonnet-5: без явного disabled модель по умолчанию включает adaptive
            # thinking — для извлечения JSON это лишние токены и задержка
            thinking={"type": "disabled"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI error: {e!r}")

    content = completion.content[0].text if completion.content else ""

    print("========== CLAUDE RAW RESPONSE ==========")
    print(f"stop_reason: {completion.stop_reason}")
    print(f"usage: {completion.usage}")
    print(f"content (repr): {content!r}")
    print(f"content (first 2000):\n{content[:2000]}")
    print("========== END ==========\n")

    if not content.strip():
        raise HTTPException(
            status_code=502,
            detail="AI вернул пустой ответ при определении сторон договора",
        )

    data = _safe_json_loads(content)
    if isinstance(data, str):
        data = _safe_json_loads(data)

    parties_struct = data.get("parties") or []
    names: List[str] = []

    if isinstance(parties_struct, list):
        for item in parties_struct:
            if isinstance(item, dict):
                name = (item.get("name") or "").strip()
                role = (item.get("role") or "").strip()
                if name:
                    names.append(name)
                elif role:
                    names.append(role)
    elif isinstance(parties_struct, dict):
        # Клод вернул dict вместо list — нормализуем
        for item in parties_struct.values():
            if isinstance(item, dict):
                name = (item.get("name") or "").strip()
                role = (item.get("role") or "").strip()
                if name:
                    names.append(name)
                elif role:
                    names.append(role)

    return PartiesResponse(parties=names)


# ---------- 2. Полная аналитика по выбранной стороне ----------


def _run_full_analysis_for_party(text: str, party: str) -> Tuple[dict, int, int]:
    """
    Разбиваем текст на части, прогоняем каждую через PROMPT_FULL_ANALYSIS,
    затем объединяем результаты через MERGE_PROMPT (если частей больше одной).

    Возвращает:
        (итоговый_json, потраченные_токены, число_частей)
    """
    chunks = split_text(text)
    if not chunks:
        raise HTTPException(status_code=422, detail="Document text is empty")

    client = _anthropic_client()

    base_prompt = settings.PROMPT_FULL_ANALYSIS
    merge_prompt = settings.MERGE_PROMPT

    base_prompt = base_prompt.replace("{{party}}", party)

    all_part_results: List[dict] = []
    total_tokens = 0
    parts_count = len(chunks)

    for idx, chunk in enumerate(chunks, start=1):
        user_content = (
            f"{base_prompt}\n\n"
            "Верни строго JSON с полями: summary, key_terms, risks, ambiguities, fixes, questions, "
            "verdict, danger_score (число от 0 до 100).\n\n"
            f"Сейчас у тебя только часть #{idx} из {parts_count} полного текста договора. "
            f"Анализируй только этот фрагмент.\n\n"
            f"----- CONTRACT PART {idx}/{parts_count} TEXT -----\n"
            f"{chunk}\n"
        )

        print("\n========== CLAUDE PART PROMPT START ==========")
        print(user_content[:4000])
        print("========== CLAUDE PART PROMPT END ==========\n")

        try:
            completion = client.messages.create(
                model=settings.ANTHROPIC_MODEL,
                system="Ты помощник по юридическому анализу договоров.",
                messages=[{"role": "user", "content": user_content}],
                max_tokens=min(settings.ANTHROPIC_MAX_TOKENS, 1024),
                thinking={"type": "disabled"},
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"AI error (part {idx}): {e!r}")

        content = completion.content[0].text if completion.content else ""

        print("========== CLAUDE PART RAW RESPONSE ==========")
        print(f"part: {idx}/{parts_count}")
        print(f"stop_reason: {completion.stop_reason}")
        print(f"usage: {completion.usage}")
        print(f"content (first 2000):\n{content[:2000]}")
        print("========== END ==========\n")

        if not content.strip():
            raise HTTPException(
                status_code=502,
                detail=f"AI вернул пустой ответ при анализе части {idx}/{parts_count}",
            )

        part_data = _safe_json_loads(content)
        if isinstance(part_data, str):
            part_data = _safe_json_loads(part_data)

        all_part_results.append(part_data)
        total_tokens += _usage_tokens(completion.usage)

    if parts_count == 1:
        final_data = all_part_results[0] if all_part_results else {}
        return final_data, total_tokens, parts_count

    merge_input = {
        "parts": all_part_results
    }

    merge_text = json.dumps(merge_input, ensure_ascii=False)

    merge_user_content = (
        f"{merge_prompt}\n\n"
        "Ниже — список частичных результатов анализа договора по частям, "
        'в поле "parts". Объедини их в один итоговый JSON с полями:\n'
        "summary, key_terms, risks, ambiguities, fixes, questions, verdict, danger_score.\n"
        "Ответ СТРОГО в формате одного JSON-объекта.\n\n"
        "----- PARTIAL ANALYSES JSON -----\n"
        f"{merge_text}\n"
    )

    print("\n========== CLAUDE MERGE PROMPT START ==========")
    print(merge_user_content[:4000])
    print("========== CLAUDE MERGE PROMPT END ==========\n")

    try:
        completion_merge = client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            system="Ты помощник по юридическому анализу договоров.",
            messages=[{"role": "user", "content": merge_user_content}],
            max_tokens=min(settings.ANTHROPIC_MAX_TOKENS, 512),
            thinking={"type": "disabled"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI error (merge): {e!r}")

    content_m = completion_merge.content[0].text if completion_merge.content else ""

    print("========== CLAUDE MERGE RAW RESPONSE ==========")
    print(f"stop_reason: {completion_merge.stop_reason}")
    print(f"usage: {completion_merge.usage}")
    print(f"content (first 2000):\n{content_m[:2000]}")
    print("========== END ==========\n")

    if not content_m.strip():
        raise HTTPException(
            status_code=502,
            detail="AI вернул пустой ответ при объединении результатов анализа",
        )

    final_data = _safe_json_loads(content_m)
    if isinstance(final_data, str):
        final_data = _safe_json_loads(final_data)

    total_tokens += _usage_tokens(completion_merge.usage)

    return final_data, total_tokens, parts_count


@router.post("/select", response_model=SelectPartyResponse)
def select_party(
    body: SelectPartyBody,
    request: Request,
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None, convert_underscores=False),
):
    """
    - Для авторизованного пользователя:
        * проверяем, что документ его;
        * считаем аналитику по всем частям текста;
        * создаём запись ContractAnalysis;
        * сохраняем JSON в папке документа;
        * возвращаем:
            - full, если есть активная подписка или уже оплачен;
            - preview, если подписки нет и ещё не разблокирован.
    - Для гостя (нет Authorization):
        * считаем аналитику по всем частям;
        * сохраняем JSON в папке документа;
        * возвращаем только превью (summary + key_terms).
    """
    selected_party = (body.selected_party or "").strip()
    if not selected_party:
        raise HTTPException(status_code=400, detail="selected_party required")

    user = _get_user_from_auth(authorization, db)
    loaded = _load_document_and_text(db, body.document_id)

    # документы пользователей доступны только их владельцу
    if loaded.kind == "user" and (not user or loaded.owner_id != str(user.id)):
        raise HTTPException(status_code=403, detail="Document does not belong to user")

    text = loaded.text
    storage_dir = loaded.storage_dir

    analysis_data_raw, tokens_full, parts_count = _run_full_analysis_for_party(text, selected_party)
    analysis_data = _normalize_analysis(analysis_data_raw)

    # Всегда сохраняем полный нормализованный JSON
    _save_analysis_to_disk(storage_dir, analysis_data)

    analysis_id: Optional[str] = None
    access: Optional[AccessInfo] = None
    response_analysis: Dict[str, Any] = analysis_data

    if not user:
        # Гость: всегда только превью
        access = AccessInfo(mode="guest", has_subscription=False, credits=0, can_unlock=False)
        response_analysis = _apply_paywall(analysis_data, access.mode)
    else:
        # Авторизованный пользователь
        active = _is_subscription_active(user)
        credits = _get_credits(user)

        # создаём запись ContractAnalysis всегда
        ca = ContractAnalysis(
            document_id=body.document_id,
            user_id=user.id,
            storage_dir=str(storage_dir),
            selected_party=selected_party,
            is_paid=active,  # если подписка активна, сразу считаем оплаченным
            tokens_identify_party=0,
            tokens_full_analysis=tokens_full,
            tokens_total=tokens_full,
            parts_count=parts_count,
            status="completed",
        )
        db.add(ca)
        db.commit()
        db.refresh(ca)
        analysis_id = str(ca.id)

        if active:
            # подписка активна — полный доступ
            access = AccessInfo(
                mode="full",
                has_subscription=True,
                credits=credits,
                can_unlock=False,
            )
            response_analysis = analysis_data
        else:
            # нет подписки — только превью, можно разблокировать за кредит
            access = AccessInfo(
                mode="preview",
                has_subscription=False,
                credits=credits,
                can_unlock=credits > 0,
            )
            response_analysis = _apply_paywall(analysis_data, access.mode)

    return SelectPartyResponse(
        analysis_id=analysis_id,
        document_id=body.document_id,
        selected_party=selected_party,
        status="completed",
        analysis=response_analysis,
        access=access,
    )


@router.post("/unlock/{analysis_id}", response_model=SelectPartyResponse)
def unlock_analysis(
    analysis_id: str,
    authorization: Optional[str] = Header(None, convert_underscores=False),
    db: Session = Depends(get_db),
):
    """
    Разблокировать уже посчитанную аналитику:
    - если есть активная подписка — просто помечаем is_paid и отдаём полный текст;
    - если подписки нет:
        * если уже is_paid=True — отдаём полный текст;
        * иначе пытаемся списать 1 кредит, при нехватке — 402.
    """
    user = _get_user_from_auth(authorization, db)
    if not user:
        raise HTTPException(status_code=401, detail="Auth required")

    ca = db.query(ContractAnalysis).filter(ContractAnalysis.id == analysis_id).first()
    if not ca:
        raise HTTPException(status_code=404, detail="Analysis not found")

    if ca.user_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")

    storage_dir = Path(ca.storage_dir)
    full_raw = _load_analysis_from_disk(storage_dir)
    full_norm = _normalize_analysis(full_raw)

    active = _is_subscription_active(user)
    credits_before = _get_credits(user)

    # если уже оплачен или есть активная подписка — просто отдаём full
    if ca.is_paid or active:
        if active and not ca.is_paid:
            ca.is_paid = True
            db.add(ca)
            db.commit()
            db.refresh(ca)

        access = AccessInfo(
            mode="full",
            has_subscription=active,
            credits=credits_before,
            can_unlock=False,
        )
        return SelectPartyResponse(
            analysis_id=str(ca.id),
            document_id=str(ca.document_id),
            selected_party=ca.selected_party,
            status=ca.status or "completed",
            analysis=full_norm,
            access=access,
        )

    # сюда попадаем: подписка не активна, is_paid=False → нужно списать кредит
    if credits_before <= 0:
        raise HTTPException(
            status_code=402,
            detail="Недостаточно кредитов для разблокировки анализа",
        )

    # списываем 1 кредит
    user.balance = Decimal(user.balance or 0) - Decimal(1)
    ca.is_paid = True

    db.add(user)
    db.add(ca)
    db.commit()
    db.refresh(user)
    db.refresh(ca)

    credits_after = _get_credits(user)

    access = AccessInfo(
        mode="full",
        has_subscription=False,
        credits=credits_after,
        can_unlock=False,
    )

    return SelectPartyResponse(
        analysis_id=str(ca.id),
        document_id=str(ca.document_id),
        selected_party=ca.selected_party,
        status=ca.status or "completed",
        analysis=full_norm,
        access=access,
    )



class FeedbackBody(BaseModel):
    feedback_kind: str  # clear | inaccurate | not_expected

@router.post("/{analysis_id}/feedback", response_model=SelectPartyResponse)
def submit_feedback(
    analysis_id: str,
    body: FeedbackBody,
    authorization: Optional[str] = Header(None, convert_underscores=False),
    db: Session = Depends(get_db),
):
    user = _get_user_from_auth(authorization, db)
    if not user:
        raise HTTPException(status_code=401, detail="Auth required")

    ca = db.query(ContractAnalysis).filter(ContractAnalysis.id == analysis_id).first()
    if not ca:
        raise HTTPException(status_code=404, detail="Analysis not found")

    if ca.user_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")

    # Проверяем, что пользователь реально имеет полный доступ
    active = _is_subscription_active(user)
    if not (active or ca.is_paid):
        raise HTTPException(status_code=403, detail="Full access required")

    if body.feedback_kind not in ("clear", "inaccurate", "not_expected"):
        raise HTTPException(status_code=400, detail="Invalid feedback_kind")

    # Сохраняем
    ca.feedback_kind = body.feedback_kind
    db.add(ca)
    db.commit()
    db.refresh(ca)

    # Грузим итоговую аналитику
    storage_dir = Path(ca.storage_dir)
    full_raw = _load_analysis_from_disk(storage_dir)
    full_norm = _normalize_analysis(full_raw)

    credits = _get_credits(user)

    access = AccessInfo(
        mode="full",
        has_subscription=active,
        credits=credits,
        can_unlock=False,
    )

    return SelectPartyResponse(
        analysis_id=str(ca.id),
        document_id=str(ca.document_id),
        selected_party=ca.selected_party,
        status=ca.status or "completed",
        analysis=full_norm,
        access=access,
    )


# ── Умный анализ договора ──────────────────────────────────────────────────

_ANALYSIS_SYSTEM = """Ты — опытный юрист, который помогает обычным людям разобраться в договорах перед подписанием. Твой клиент — не юрист.

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

_ANALYSIS_USER = """\
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
      "suggestion": "Готовая новая редакция процитированного фрагмента text: юридически корректный текст, который вставится в договор ВМЕСТО text. Сохрани номер пункта, если он есть в начале цитаты. Только текст пункта, без комментариев и кавычек.",
      "severity": "high"
    }}
  ]
}}

danger_score: 100 = полностью безопасно, 0 = крайне опасно. Незаполненные поля черновика НЕ снижают danger_score — оценивай по написанным условиям.
severity: high = финансовые потери или юридическая ответственность | medium = проблемы при исполнении | low = желательно исправить ИЛИ незаполненное поле шаблона
Незаполненные пропуски («___») — это черновик, а не ошибка: собери их в ОДНУ находку severity "low", спокойным тоном, без страшных сценариев."""

_ANALYSIS_USER_PART = """\
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
      "suggestion": "готовая новая редакция фрагмента text (вставится в договор вместо него; сохрани номер пункта, без комментариев)",
      "severity": "high|medium|low"
    }}
  ]
}}"""

_MERGE_SYSTEM = """Ты — юридический аналитик. Объединяешь частичные анализы договора в один итоговый. Отвечаешь строго JSON без markdown-обёртки (без ```json, без ```)."""

_MERGE_USER = """\
Объедини частичные анализы фрагментов одного договора в один итоговый анализ.

Правила:
- summary: напиши единое описание всего договора
- danger_score: среднее, но если есть хоть один high-риск — снизь на 10-15 пунктов
- verdict: итоговая рекомендация по всему договору
- issues: объедини все проблемы, удали дубликаты, отсортируй high→medium→low
- При объединении issues: СОХРАНЯЙ дословные цитаты (text) и готовые редакции (suggestion) без изменений

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


# GPT-4o context: 128k tokens ≈ 384k chars (at ~3 chars/token for Russian)
# Leave ~12k tokens for prompt + response → max input ~348k chars
_MAX_CHARS_SINGLE_PASS = 300_000


def _run_full_analysis_v2(text: str, party: str) -> Tuple[dict, int, int]:
    """
    Smart contract analysis:
    1. Preprocesses text — numbers every paragraph [N] for accurate citations
    2. Single-pass for most contracts (GPT-4o 128k context handles ~300k chars)
    3. Multi-pass + merge for very long contracts
    4. Verifies citations against original paragraphs, fixes wrong references
    """
    from services.preprocessor import number_paragraphs, verify_citations

    if not text or not text.strip():
        raise HTTPException(status_code=422, detail="Document text is empty")

    numbered_text, paragraphs = number_paragraphs(text)
    client = _anthropic_client()

    if len(numbered_text) <= _MAX_CHARS_SINGLE_PASS:
        # ── Single pass ──────────────────────────────────────────────────────
        raw, tokens = _call_analysis_api(
            client=client,
            system=_ANALYSIS_SYSTEM,
            user=_ANALYSIS_USER.format(party=party, numbered_text=numbered_text),
        )
        parts_count = 1
    else:
        # ── Multi-pass ───────────────────────────────────────────────────────
        chunks = split_text(numbered_text)
        parts_count = len(chunks)
        all_parts: List[dict] = []
        total_tokens = 0

        for idx, chunk in enumerate(chunks, start=1):
            part_raw, part_tokens = _call_analysis_api(
                client=client,
                system=_ANALYSIS_SYSTEM,
                user=_ANALYSIS_USER_PART.format(
                    party=party,
                    numbered_text=chunk,
                    part_num=idx,
                    total_parts=parts_count,
                ),
            )
            total_tokens += part_tokens
            all_parts.append(part_raw)

        raw, merge_tokens = _call_analysis_api(
            client=client,
            system=_MERGE_SYSTEM,
            user=_MERGE_USER.format(
                parts_json=json.dumps(all_parts, ensure_ascii=False, indent=2)
            ),
        )
        tokens = total_tokens + merge_tokens

    # ── Citation verification ────────────────────────────────────────────────
    if isinstance(raw.get("issues"), list):
        raw["issues"] = verify_citations(raw["issues"], paragraphs)

    # ── Sort issues: high → medium → low ────────────────────────────────────
    sev_order = {"high": 0, "medium": 1, "low": 2}
    if isinstance(raw.get("issues"), list):
        raw["issues"].sort(key=lambda x: sev_order.get(x.get("severity", "low"), 3))

    return raw, tokens, parts_count


def _call_analysis_api(client: Anthropic, system: str, user: str) -> Tuple[dict, int]:
    """Single Claude call. Returns (parsed_dict, tokens_used)."""
    try:
        completion = client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            system=system,
            messages=[{"role": "user", "content": user}],
            max_tokens=settings.ANTHROPIC_MAX_TOKENS,
            # sonnet-5: без явного disabled модель по умолчанию включает adaptive
            # thinking — для структурного анализа это лишние токены и задержка
            thinking={"type": "disabled"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI error: {e!r}")

    content = completion.content[0].text if completion.content else ""
    tokens = _usage_tokens(completion.usage)

    print("========== CLAUDE ANALYSIS RESPONSE ==========")
    print(f"stop_reason: {completion.stop_reason}")
    print(f"usage: {completion.usage}")
    print(f"content (first 3000):\n{content[:3000]}")
    print("========== END ==========\n")

    if not content.strip():
        raise HTTPException(status_code=502, detail="AI вернул пустой ответ")

    data = _safe_json_loads(content)
    return data, tokens


def _normalize_analysis_v2(data: dict) -> dict:
    """
    Приводим результат к ожидаемой структуре, заполняя отсутствующие поля.
    """
    if not isinstance(data, dict):
        return {"summary": "", "overall_assessment": {"verdict": "", "danger_score": 0}, "issues": []}

    result = {
        "summary": data.get("summary", ""),
        "overall_assessment": {
            "verdict": data.get("overall_assessment", {}).get("verdict", ""),
            "danger_score": float(data.get("overall_assessment", {}).get("danger_score", 0))
        },
        "issues": []
    }

    # Нормализуем issues
    issues = data.get("issues", [])
    if isinstance(issues, list):
        for issue in issues:
            if isinstance(issue, dict):
                normalized_issue = {
                    "clause": issue.get("clause", ""),
                    "text": issue.get("text", ""),
                    "problem": issue.get("problem", ""),
                    "risk": issue.get("risk", ""),
                    "why": issue.get("why", ""),
                    "fix": issue.get("fix", ""),
                    "suggestion": issue.get("suggestion", ""),
                    "severity": issue.get("severity", "low") if issue.get("severity") in ["low", "medium",
                                                                                          "high"] else "low"
                }
                result["issues"].append(normalized_issue)

    return result


@router.post("/select-v2", response_model=SelectPartyResponseV2)
def select_party_v2(
        body: SelectPartyBody,
        request: Request,
        db: Session = Depends(get_db),
        authorization: Optional[str] = Header(None, convert_underscores=False),
):
    """
    Новая версия эндпоинта с структурным анализом по пунктам.
    """
    selected_party = (body.selected_party or "").strip()
    if not selected_party:
        raise HTTPException(status_code=400, detail="selected_party required")

    user = _get_user_from_auth(authorization, db)
    loaded = _load_document_and_text(db, body.document_id)

    # документы пользователей доступны только их владельцу
    if loaded.kind == "user" and (not user or loaded.owner_id != str(user.id)):
        raise HTTPException(status_code=403, detail="Document does not belong to user")

    text = loaded.text
    storage_dir = loaded.storage_dir

    # Используем новую функцию анализа
    analysis_data_raw, tokens_full, parts_count = _run_full_analysis_v2(text, selected_party)
    analysis_data = _normalize_analysis_v2(analysis_data_raw)

    # Сохраняем полный результат
    _save_analysis_to_disk(storage_dir, analysis_data)

    analysis_id: Optional[str] = None
    access: Optional[AccessInfo] = None
    response_analysis: dict = analysis_data

    if not user:
        access = AccessInfo(mode="guest", has_subscription=False, credits=0, can_unlock=False)
        response_analysis = _apply_paywall_v2(analysis_data, "guest")
    else:
        active = _is_subscription_active(user)
        credits = _get_credits(user)

        ca = ContractAnalysis(
            document_id=body.document_id,
            user_id=user.id,
            storage_dir=str(storage_dir),
            selected_party=selected_party,
            is_paid=active,
            tokens_identify_party=0,
            tokens_full_analysis=tokens_full,
            tokens_total=tokens_full,
            parts_count=parts_count,
            status="completed",
        )
        db.add(ca)
        db.commit()
        db.refresh(ca)
        analysis_id = str(ca.id)

        if active:
            access = AccessInfo(
                mode="full",
                has_subscription=True,
                credits=credits,
                can_unlock=False,
            )
            response_analysis = analysis_data
        else:
            access = AccessInfo(
                mode="preview",
                has_subscription=False,
                credits=credits,
                can_unlock=credits > 0,
            )
            response_analysis = _apply_paywall_v2(analysis_data, access.mode)

    return SelectPartyResponseV2(
        analysis_id=analysis_id,
        document_id=body.document_id,
        selected_party=selected_party,
        status="completed",
        analysis=response_analysis,
        access=access,
    )


def _apply_paywall_v2(analysis: dict, mode: str) -> dict:
    """
    Для гостя или preview — оставляем summary и overall_assessment,
    issues скрываем, но сообщаем их количество через issues_locked_count.
    """
    if mode == "full":
        return analysis

    result = dict(analysis)
    result["issues_locked_count"] = len(analysis.get("issues", []))
    result["issues"] = []

    return result

@router.post("/unlock-v2/{analysis_id}", response_model=SelectPartyResponseV2)
def unlock_analysis_v2(
    analysis_id: str,
    authorization: Optional[str] = Header(None, convert_underscores=False),
    db: Session = Depends(get_db),
):
    """Разблокировка аналитики с новой структурой."""
    user = _get_user_from_auth(authorization, db)
    if not user:
        raise HTTPException(status_code=401, detail="Auth required")

    ca = db.query(ContractAnalysis).filter(ContractAnalysis.id == analysis_id).first()
    if not ca:
        raise HTTPException(status_code=404, detail="Analysis not found")

    if ca.user_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")

    storage_dir = Path(ca.storage_dir)
    full_raw = _load_analysis_from_disk(storage_dir)
    full_norm = _normalize_analysis_v2(full_raw)

    active = _is_subscription_active(user)
    credits_before = _get_credits(user)

    if ca.is_paid or active:
        if active and not ca.is_paid:
            ca.is_paid = True
            db.add(ca)
            db.commit()
            db.refresh(ca)

        access = AccessInfo(
            mode="full",
            has_subscription=active,
            credits=credits_before,
            can_unlock=False,
        )
        return SelectPartyResponseV2(
            analysis_id=str(ca.id),
            document_id=str(ca.document_id),
            selected_party=ca.selected_party,
            status=ca.status or "completed",
            analysis=full_norm,
            access=access,
        )

    if credits_before <= 0:
        raise HTTPException(
            status_code=402,
            detail="Недостаточно кредитов для разблокировки анализа",
        )

    user.balance = Decimal(user.balance or 0) - Decimal(1)
    ca.is_paid = True

    db.add(user)
    db.add(ca)
    db.commit()
    db.refresh(user)
    db.refresh(ca)

    credits_after = _get_credits(user)

    access = AccessInfo(
        mode="full",
        has_subscription=False,
        credits=credits_after,
        can_unlock=False,
    )

    return SelectPartyResponseV2(
        analysis_id=str(ca.id),
        document_id=str(ca.document_id),
        selected_party=ca.selected_party,
        status=ca.status or "completed",
        analysis=full_norm,
        access=access,
    )


# ── Применение правок к документу и скачивание результата ──────────────────
#
# Методика: правки применяются к XML внутри .docx детерминированным кодом
# (services/docx_edit.py) — меняется только текст в <w:t>, поэтому
# форматирование, стили и таблицы сохраняются байт-в-байт.


class ApplyEditItem(BaseModel):
    old: str                      # заменяемый фрагмент (цитата из анализа)
    new: str                      # новая редакция (предложение ИИ, возможно правленное)
    clause: Optional[str] = None  # номер пункта вида "5.1" — подсказка для поиска


class ApplyEditsBody(BaseModel):
    document_id: str
    edits: List[ApplyEditItem]


@router.post("/apply-edits")
def apply_document_edits(
    body: ApplyEditsBody,
    request: Request,
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None, convert_underscores=False),
    x_guest_token: Optional[str] = Header(None, alias="X-Guest-Token"),
):
    """
    Принимает список правок «старый фрагмент → новый фрагмент», применяет их
    к оригинальному .docx и возвращает исправленный файл.

    Если хотя бы одна правка не нашлась в документе — файл не отдаётся,
    возвращается 422 со списком проблемных правок (по индексам).
    """
    from services.docx_edit import apply_edits

    if not body.edits:
        raise HTTPException(status_code=400, detail="Список правок пуст")
    if len(body.edits) > 100:
        raise HTTPException(status_code=400, detail="Слишком много правок")

    user = _get_user_from_auth(authorization, db)

    # находим документ и проверяем владение (пользователь или гость)
    doc = db.query(Document).filter(Document.id == body.document_id).first()
    if doc:
        if not user or str(doc.user_id) != str(user.id):
            raise HTTPException(status_code=403, detail="Document does not belong to user")
        storage_key, original_name = doc.storage_key, doc.original_name
    else:
        gdoc = db.query(GuestDocument).filter(GuestDocument.id == body.document_id).first()
        if not gdoc:
            raise HTTPException(status_code=404, detail="Document not found")
        token = x_guest_token or request.cookies.get("guest_token")
        from models.guest import GuestUser
        gu = db.query(GuestUser).filter(GuestUser.label == (token or "")).first()
        if not gu or str(gdoc.guest_id) != str(gu.id):
            raise HTTPException(status_code=403, detail="Document does not belong to guest")
        storage_key, original_name = gdoc.storage_key, gdoc.original_name

    bin_path = DOCS_ROOT / storage_key
    if not bin_path.exists():
        raise HTTPException(status_code=404, detail="Исходный файл не найден")

    # .doc и .pdf приводим к .docx (результат правки всегда выдаётся в DOCX)
    from services.convert import ensure_docx, ConvertError
    try:
        docx_bytes, _converted = ensure_docx(bin_path, original_name or "")
    except ConvertError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        edited_bytes, report = apply_edits(
            docx_bytes,
            [e.dict() for e in body.edits],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка применения правок: {e!r}")

    failed = [r for r in report if not r["ok"]]
    if failed:
        raise HTTPException(status_code=422, detail={"failed": failed})

    from urllib.parse import quote as url_quote
    base = original_name.rsplit(".", 1)[0] if "." in original_name else original_name
    out_name = f"{base} (исправленный).docx"
    return Response(
        content=edited_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition":
                f"attachment; filename=\"edited.docx\"; filename*=UTF-8''{url_quote(out_name)}",
        },
    )