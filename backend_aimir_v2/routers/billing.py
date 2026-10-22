# routers/billing.py
from calendar import monthrange
from datetime import date
from decimal import Decimal
import uuid
import os
import time
import json
import hashlib
import logging
from typing import Optional

import requests
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from db import get_db
from core.config import settings
from core.security import decode_token
from models.user import User
from models.billing_transaction import BillingTransaction
from schemas.billing import PricesOut, BillingStatus, SubscribeIn, CreditsAddIn

router = APIRouter(prefix="/billing", tags=["billing"])
logger = logging.getLogger(__name__)

# ---------------------------
# Вспомогательные функции
# ---------------------------
def _today() -> date:
    return date.today()


def _get_current_user(authorization: str, db: Session) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization.split(" ", 1)[1]
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _is_active(u: User) -> bool:
    """Подписка активна, если есть дата окончания и она сегодня/в будущем."""
    return bool(u.subscription_end and u.subscription_end >= _today())


def _ensure_subscription_flag(user: User, db: Session) -> None:
    """
    Держим флаг has_subscription в соответствии с датой окончания.
    Активность определяется именно по датам, флаг — служебный индикатор.
    """
    should_be = _is_active(user)
    if user.has_subscription != should_be:
        user.has_subscription = should_be
        db.add(user)
        db.commit()
        db.refresh(user)


def _status(u: User) -> dict:
    # balance трактуем как "кредиты" (целое число запросов)
    credits = int(Decimal(u.balance or 0).quantize(Decimal("1")))
    return {
        "has_subscription": bool(u.has_subscription),
        "subscription_start": u.subscription_start,
        "subscription_end": u.subscription_end,
        "active": _is_active(u),
        "credits": credits,
        "telegram_id": u.telegram_id,
    }


def add_months(d: date, months: int) -> date:
    """
    Корректно добавляет календарные месяцы (учитывает 28/29/30/31).
    Пример: 31 января + 1 месяц = 28(29) февраля.
    """
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    day = min(d.day, monthrange(y, m)[1])
    return date(y, m, day)

def _short_user_id(user: User) -> str:
    # убираем дефисы и берём первые 16 символов — этого за глаза хватает
    return str(user.id).replace("-", "")[:16]


# ---------------------------
# Конфиг T-Банк / Tinkoff
# ---------------------------
TBANK_TERMINAL_KEY = settings.TBANK_TERMINAL_KEY
TBANK_PASSWORD = settings.TBANK_PASSWORD
TBANK_API_BASE = settings.TBANK_API.rstrip("/")  # например, https://securepay.tinkoff.ru/v2
TBANK_INIT_URL = f"{TBANK_API_BASE}/Init"

PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")
TBANK_SUCCESS_URL = os.getenv("TBANK_SUCCESS_URL") or ((PUBLIC_BASE_URL + "/billing") if PUBLIC_BASE_URL else "")
TBANK_FAIL_URL = os.getenv("TBANK_FAIL_URL") or ((PUBLIC_BASE_URL + "/billing") if PUBLIC_BASE_URL else "")
TBANK_NOTIFY_URL = os.getenv("TBANK_NOTIFY_URL") or ((PUBLIC_BASE_URL + "/billing/webhook") if PUBLIC_BASE_URL else "")

# флаг, чтобы в dev можно было тестировать без проверки подписи
WEBHOOK_SKIP_TOKEN = os.getenv("TBANK_WEBHOOK_SKIP_TOKEN", "false").lower() in ("1", "true", "yes", "y")

# Receipt (FFD 1.2)
RECEIPT_FFD_VERSION = os.getenv("RECEIPT_FFD_VERSION", "1.2")
RECEIPT_TAXATION = os.getenv("RECEIPT_TAXATION", "usn_income")  # УСН доход
RECEIPT_EMAIL_DEFAULT = os.getenv("RECEIPT_EMAIL_DEFAULT", "")
RECEIPT_PHONE_DEFAULT = os.getenv("RECEIPT_PHONE_DEFAULT", "")
RECEIPT_MEASUREMENT_UNIT = os.getenv("RECEIPT_MEASUREMENT_UNIT", "шт")


def _receipt_make(
    *,
    title: str,
    price_kop: int,
    quantity: int,
    email: Optional[str],
    phone: Optional[str],
) -> dict:
    """
    Строит объект Receipt для Init (FFD 1.2).
    Полная предоплата, услуга, налог none, единица измерения из окружения.
    """
    qty = max(1, int(quantity or 1))
    price = int(price_kop)
    amount = price * qty

    item = {
        "Name": str(title or "")[:128],
        "Price": price,            # копейки
        "Quantity": qty,
        "Amount": amount,          # копейки
        "PaymentMethod": "full_prepayment",
        "PaymentObject": "service",
        "Tax": "none",
        "MeasurementUnit": RECEIPT_MEASUREMENT_UNIT,
    }
    receipt = {
        "Items": [item],
        "FfdVersion": RECEIPT_FFD_VERSION,
        "Taxation": RECEIPT_TAXATION,
        "Payments": {
            "Electronic": amount,
            "Cash": 0,
            "AdvancePayment": 0,
            "Credit": 0,
            "Provision": 0,
        },
    }
    if email or RECEIPT_EMAIL_DEFAULT:
        receipt["Email"] = email or RECEIPT_EMAIL_DEFAULT
    if phone or RECEIPT_PHONE_DEFAULT:
        receipt["Phone"] = phone or RECEIPT_PHONE_DEFAULT
    return receipt


def _tbank_init_token(payload: dict) -> str:
    """
    Токен для /v2/Init:
    не включаем Token, а также вложенные объекты Receipt, DATA, Shops.
    Остальные непустые поля сортируем по ключу, конкатенируем значения и хешируем SHA-256.
    """
    exclude_keys = {"Token", "Receipt", "DATA", "Shops"}
    data = {}
    for k, v in payload.items():
        if k in exclude_keys:
            continue
        if v in (None, "", []):
            continue
        data[k] = v
    data["Password"] = TBANK_PASSWORD or ""
    concat = "".join(str(data[k]) for k in sorted(data))
    return hashlib.sha256(concat.encode("utf-8")).hexdigest()


def _tbank_webhook_token(payload: dict) -> str:
    """
    Генерация Token для вебхука T-Банка.
    """
    # 1) Убираем Token и значения None / {}
    data = {
        k: v
        for k, v in payload.items()
        if k != "Token" and v not in (None, {})
    }

    def norm(v):
        if isinstance(v, bool):
            return "true" if v else "false"
        if isinstance(v, (dict, list)):
            return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
        return str(v)

    # отсортированные пары (ключ, значение)
    items_sorted = sorted(data.items())
    # конкатенация значений БЕЗ пароля
    concat_values = "".join(norm(v) for _, v in items_sorted)
    # полная строка с паролем
    concat = concat_values + (TBANK_PASSWORD or "")
    token_hex = hashlib.sha256(concat.encode("utf-8")).hexdigest()
    return token_hex


def _tb_bool(v) -> bool:
    return str(v).strip().lower() in ("1", "true", "t", "yes", "y")


def _coerce_types(d: dict) -> dict:
    """
    Приводим Success/Amount к bool/int, как в старом проекте.
    """
    out = {}
    for k, v in d.items():
        if isinstance(v, list):
            v = v[0] if v else ""
        if k in ("Success", "SuccessNew"):
            out[k] = _tb_bool(v)
        elif k in ("Amount", "NewAmount"):
            try:
                out[k] = int(v)
            except Exception:
                out[k] = v
        else:
            out[k] = v
    return out


# ---------------------------
# Цены из .env (для фронта)
# ---------------------------
@router.get("/prices", response_model=PricesOut)
def get_prices():
    return {
        "sub_month": settings.SUB_PRICE_MONTH,
        "sub_6m": settings.SUB_PRICE_6M,
        "sub_year": settings.SUB_PRICE_YEAR,
        "request_price": settings.REQUEST_PRICE,
    }


# ---------------------------
# Статус биллинга
# ---------------------------
@router.get("/status", response_model=BillingStatus)
def billing_status(authorization: str = Header(None), db: Session = Depends(get_db)):
    user = _get_current_user(authorization, db)
    _ensure_subscription_flag(user, db)
    return _status(user)


# Алиас для обратной совместимости
@router.get("/me", response_model=BillingStatus)
def billing_me(authorization: str = Header(None), db: Session = Depends(get_db)):
    user = _get_current_user(authorization, db)
    _ensure_subscription_flag(user, db)
    return _status(user)


# ---------------------------
# Оформить / продлить подписку (СТАРЫЙ способ, без оплаты)
# ---------------------------
@router.post("/subscribe", response_model=BillingStatus, status_code=status.HTTP_200_OK)
def subscribe(
    body: SubscribeIn,
    authorization: str = Header(None),
    db: Session = Depends(get_db),
):
    """
    ВАЖНО: этот эндпоинт НЕ ходит в банк — подписка активируется сразу.
    Оставляем для обратной совместимости / тестов.
    """
    # при настроенном эквайринге бесплатная активация запрещена
    if TBANK_TERMINAL_KEY and TBANK_PASSWORD:
        raise HTTPException(status_code=403, detail="Use payment flow")

    user = _get_current_user(authorization, db)

    months_map = {"month": 1, "6m": 6, "year": 12}
    if body.plan not in months_map:
        raise HTTPException(status_code=400, detail="Unknown plan")

    months = months_map[body.plan]

    price_map = {
        "month": Decimal(settings.SUB_PRICE_MONTH),
        "6m": Decimal(settings.SUB_PRICE_6M),
        "year": Decimal(settings.SUB_PRICE_YEAR),
    }
    price_rub = price_map[body.plan]

    today = _today()
    if _is_active(user) and user.subscription_end:
        user.subscription_end = add_months(user.subscription_end, months)
    else:
        user.subscription_start = today
        user.subscription_end = add_months(today, months)

    user.has_subscription = True

    db.add(user)

    tx = BillingTransaction(
        id=uuid.uuid4(),
        user_id=user.id,
        kind="subscription",
        plan=body.plan,
        quantity=months,
        amount_rub=price_rub,
        applied=True,  # т.к. мы сразу изменили пользователя
    )
    db.add(tx)

    db.commit()
    db.refresh(user)

    _ensure_subscription_flag(user, db)
    return _status(user)


# ---------------------------
# Купить кредиты (СТАРЫЙ способ, без оплаты)
# ---------------------------
@router.post("/credits/add", response_model=BillingStatus, status_code=status.HTTP_200_OK)
def add_credits(
    body: CreditsAddIn,
    authorization: str = Header(None),
    db: Session = Depends(get_db),
):
    """
    ВАЖНО: этот эндпоинт НЕ ходит в банк — кредиты сразу начисляются.
    Оставляем для обратной совместимости / тестов.
    """
    # при настроенном эквайринге бесплатное начисление запрещено
    if TBANK_TERMINAL_KEY and TBANK_PASSWORD:
        raise HTTPException(status_code=403, detail="Use payment flow")

    user = _get_current_user(authorization, db)

    user.balance = (Decimal(user.balance or 0) + Decimal(body.quantity))
    db.add(user)

    price_per_request = Decimal(settings.REQUEST_PRICE)
    amount_rub = price_per_request * Decimal(body.quantity)

    tx = BillingTransaction(
        id=uuid.uuid4(),
        user_id=user.id,
        kind="credits",
        plan=None,
        quantity=body.quantity,
        amount_rub=amount_rub,
        applied=True,  # сразу применили к пользователю
    )
    db.add(tx)

    db.commit()
    db.refresh(user)

    _ensure_subscription_flag(user, db)
    return _status(user)


# ---------------------------
# НОВОЕ: Инициация оплаты подписки через T-Банк
# ---------------------------
@router.post("/subscribe/pay")
def subscribe_pay(
    body: SubscribeIn,
    authorization: str = Header(None),
    db: Session = Depends(get_db),
):
    """
    Создаёт платёж в T-Банк для подписки.
    Ничего не изменяет у пользователя до webhook'а.
    """
    user = _get_current_user(authorization, db)

    if not (TBANK_TERMINAL_KEY and TBANK_PASSWORD and TBANK_API_BASE):
        raise HTTPException(status_code=500, detail="T-Bank не сконфигурирован")

    months_map = {"month": 1, "6m": 6, "year": 12}
    if body.plan not in months_map:
        raise HTTPException(status_code=400, detail="Unknown plan")

    months = months_map[body.plan]

    price_map = {
        "month": Decimal(settings.SUB_PRICE_MONTH),
        "6m": Decimal(settings.SUB_PRICE_6M),
        "year": Decimal(settings.SUB_PRICE_YEAR),
    }
    price_rub = price_map[body.plan]
    amount_kop = int(price_rub * 100)

    uid_short = _short_user_id(user)
    order_id = f"sub_{uid_short}_{body.plan}_{int(time.time())}"

    payload = {
        "TerminalKey": TBANK_TERMINAL_KEY,
        "Amount": amount_kop,
        "OrderId": order_id,
        "Description": f"Подписка — {body.plan}",
        "NotificationURL": TBANK_NOTIFY_URL,
        "SuccessURL": TBANK_SUCCESS_URL,
        "FailURL": TBANK_FAIL_URL,
        "Receipt": _receipt_make(
            title=f"Подписка — {body.plan}",
            price_kop=amount_kop,
            quantity=1,
            email=user.email,
            phone=None,
        ),
    }
    payload["Token"] = _tbank_init_token(payload)

    try:
        r = requests.post(TBANK_INIT_URL, json=payload, timeout=20)
        data = r.json()
    except Exception as e:
        logger.exception("[BILLING] T-Bank Init error (subscribe): %s", e)
        raise HTTPException(status_code=502, detail="Ошибка инициации платежа")

    if r.status_code != 200 or not data.get("Success"):
        logger.error("[BILLING] T-Bank Init failed (subscribe): %s", data)
        msg = data.get("Message") or "Init failed"
        raise HTTPException(status_code=400, detail=f"T-Bank: {msg}")

    payment_id = data.get("PaymentId")
    payment_url = data.get("PaymentURL")

    # создаём запись транзакции с applied=False
    tx = BillingTransaction(
        id=uuid.uuid4(),
        user_id=user.id,
        kind="subscription",
        plan=body.plan,
        quantity=months,
        amount_rub=price_rub,
        provider="tbank",
        provider_order_id=order_id,
        provider_payment_id=str(payment_id) if payment_id else None,
        provider_status=str(data.get("Status") or ""),
        applied=False,
    )
    db.add(tx)
    db.commit()

    logger.info("[BILLING] subscribe INIT user=%s order_id=%s amount_kop=%s", user.id, order_id, amount_kop)

    return {
        "payment_url": payment_url,
        "payment_id": payment_id,
        "order_id": order_id,
        "plan": body.plan,
        "amount_rub": float(price_rub),
    }


# ---------------------------
# НОВОЕ: Инициация оплаты кредитов через T-Банк
# ---------------------------
@router.post("/credits/pay")
def credits_pay(
    body: CreditsAddIn,
    authorization: str = Header(None),
    db: Session = Depends(get_db),
):
    """
    Создаёт платёж в T-Банк для покупки кредитов.
    Ничего не изменяет у пользователя до webhook'а.
    """
    user = _get_current_user(authorization, db)

    if not (TBANK_TERMINAL_KEY and TBANK_PASSWORD and TBANK_API_BASE):
        raise HTTPException(status_code=500, detail="T-Bank не сконфигурирован")

    if body.quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be > 0")

    price_per_request = Decimal(settings.REQUEST_PRICE)
    amount_rub = price_per_request * Decimal(body.quantity)
    amount_kop = int(amount_rub * 100)

    uid_short = _short_user_id(user)
    order_id = f"cred_{uid_short}_{body.quantity}_{int(time.time())}"
    payload = {
        "TerminalKey": TBANK_TERMINAL_KEY,
        "Amount": amount_kop,
        "OrderId": order_id,
        "Description": f"Покупка {body.quantity} кредитов",
        "NotificationURL": TBANK_NOTIFY_URL,
        "SuccessURL": TBANK_SUCCESS_URL,
        "FailURL": TBANK_FAIL_URL,
        "Receipt": _receipt_make(
            title=f"Кредиты ({body.quantity} шт.)",
            price_kop=int(price_per_request * 100),
            quantity=body.quantity,
            email=user.email,
            phone=None,
        ),
    }
    payload["Token"] = _tbank_init_token(payload)

    try:
        r = requests.post(TBANK_INIT_URL, json=payload, timeout=20)
        data = r.json()
    except Exception as e:
        logger.exception("[BILLING] T-Bank Init error (credits): %s", e)
        raise HTTPException(status_code=502, detail="Ошибка инициации платежа")

    if r.status_code != 200 or not data.get("Success"):
        logger.error("[BILLING] T-Bank Init failed (credits): %s", data)
        msg = data.get("Message") or "Init failed"
        raise HTTPException(status_code=400, detail=f"T-Bank: {msg}")

    payment_id = data.get("PaymentId")
    payment_url = data.get("PaymentURL")

    tx = BillingTransaction(
        id=uuid.uuid4(),
        user_id=user.id,
        kind="credits",
        plan=None,
        quantity=body.quantity,
        amount_rub=amount_rub,
        provider="tbank",
        provider_order_id=order_id,
        provider_payment_id=str(payment_id) if payment_id else None,
        provider_status=str(data.get("Status") or ""),
        applied=False,
    )
    db.add(tx)
    db.commit()

    logger.info("[BILLING] credits INIT user=%s order_id=%s amount_kop=%s", user.id, order_id, amount_kop)

    return {
        "payment_url": payment_url,
        "payment_id": payment_id,
        "order_id": order_id,
        "quantity": body.quantity,
        "amount_rub": float(amount_rub),
    }


# ---------------------------
# WEBHOOK от T-Банк
# ---------------------------
@router.post("/webhook", include_in_schema=False)
async def tbank_webhook(request: Request, db: Session = Depends(get_db)):

    raw = await request.body()
    logger.info("[TBANK][DEBUG] WEBHOOK HEADERS: %s", dict(request.headers))
    logger.info("[TBANK][DEBUG] RAW BODY: %s", raw.decode("utf-8", errors="ignore"))

    ctype = (request.headers.get("content-type") or "").split(";")[0].strip().lower()

    logger.info("[TBANK] webhook: ctype=%s raw_len=%s", ctype, len(raw))

    try:
        if ctype == "application/json":
            data = json.loads(raw.decode("utf-8") or "{}")
        else:
            from urllib.parse import parse_qs

            text = raw.decode("utf-8", errors="ignore")
            data = {k: v[0] if isinstance(v, list) else v for k, v in parse_qs(text, keep_blank_values=True).items()}
    except Exception as e:
        logger.exception("[TBANK] webhook parse error: %s", e)
        data = {}
    data = _coerce_types(data)
    logger.info("[TBANK][DEBUG] RAW DATA: %s", data)

    try:
        # какие поля мы реально используем
        token_input = {k: v for k, v in data.items() if k != "Token" and v not in (None, {})}
        logger.info("[TBANK] webhook fields: %s", sorted(token_input.keys()))
    except Exception as e:
        logger.error("[TBANK] error inspecting webhook payload: %s", e)

    payment_id = str(data.get("PaymentId") or "")
    order_id = str(data.get("OrderId") or "")
    status_str = str(data.get("Status") or "").upper()

    logger.info(
        "[TBANK] webhook payload: order_id=%s status=%s payment_id=%s",
        order_id,
        status_str,
        payment_id,
    )

    # проверка подписи
    try:
        expected = _tbank_webhook_token({k: v for k, v in data.items() if k is not None})
    except Exception as e:
        logger.exception("[TBANK] token build error: %s", e)
        expected = ""
    got = str(data.get("Token") or "")
    logger.info("[TBANK] TOKEN DEBUG: got(from bank)=%s expected(by_us)=%s", got, expected)
    if expected != got:
        if WEBHOOK_SKIP_TOKEN:
            logger.warning("[TBANK] token mismatch, but WEBHOOK_SKIP_TOKEN=true — proceeding")
        else:
            logger.error("[TBANK] token mismatch: got=%s expected=%s", got, expected)
            return {"ok": False, "token": "bad"}

    if status_str != "CONFIRMED":
        logger.info("[TBANK] webhook: skip apply for status=%s (waiting CONFIRMED)", status_str)
        # можем просто принять, но ничего не менять
        return PlainTextResponse("OK")  # skipped status

    if not order_id:
        logger.warning("[TBANK] webhook: empty OrderId")
        return PlainTextResponse("OK")  # empty order id

    # ищем транзакцию по провайдеру и order_id
    tx: Optional[BillingTransaction] = (
        db.query(BillingTransaction)
        .filter(
            BillingTransaction.provider == "tbank",
            BillingTransaction.provider_order_id == order_id,
        )
        .first()
    )

    if not tx:
        logger.warning("[TBANK] webhook: transaction not found for order_id=%s", order_id)
        return PlainTextResponse("OK")  # transaction not found

    # если уже применена — просто обновим статус провайдера и выйдем
    if tx.applied:
        tx.provider_status = status_str
        if payment_id:
            tx.provider_payment_id = payment_id
        db.add(tx)
        db.commit()
        logger.info("[TBANK] webhook: duplicate for order_id=%s (already applied)", order_id)
        return PlainTextResponse("OK")  # duplicate

    # получаем пользователя
    user: Optional[User] = db.query(User).filter(User.id == tx.user_id).first()
    if not user:
        logger.error("[TBANK] webhook: user not found for tx.user_id=%s", tx.user_id)
        return {"ok": False, "reason": "user_not_found"}

    # простая проверка суммы (если есть Amount)
    try:
        amount_kop_from_webhook = int(data.get("Amount") or 0)
    except Exception:
        amount_kop_from_webhook = 0

    expected_amount_kop = 0
    try:
        expected_amount_kop = int(Decimal(tx.amount_rub or 0) * 100)
    except Exception:
        expected_amount_kop = 0

    if expected_amount_kop and amount_kop_from_webhook and amount_kop_from_webhook < expected_amount_kop:
        logger.error(
            "[TBANK] webhook: amount mismatch order_id=%s expected=%s got=%s",
            order_id,
            expected_amount_kop,
            amount_kop_from_webhook,
        )
        return {"ok": False, "reason": "amount_mismatch"}

    # применяем транзакцию
    if tx.kind == "credits":
        # пополняем баланс на quantity кредитов
        user.balance = (Decimal(user.balance or 0) + Decimal(tx.quantity or 0))
        db.add(user)
        logger.info(
            "[BILLING] CREDITS APPLIED user_id=%s order_id=%s qty=%s new_balance=%s",
            user.id,
            order_id,
            tx.quantity,
            user.balance,
        )
    elif tx.kind == "subscription":
        months_map = {"month": 1, "6m": 6, "year": 12}
        months = months_map.get(tx.plan or "month", 1)
        today = _today()

        if _is_active(user) and user.subscription_end:
            base = user.subscription_end
        else:
            base = today
            # если раньше подписки не было — зафиксируем старт сегодня
            if not user.subscription_start:
                user.subscription_start = today

        user.subscription_end = add_months(base, months)
        user.has_subscription = True

        db.add(user)
        logger.info(
            "[BILLING] SUBSCRIPTION APPLIED user_id=%s order_id=%s plan=%s new_end=%s",
            user.id,
            order_id,
            tx.plan,
            user.subscription_end,
        )
    else:
        logger.warning("[TBANK] webhook: unknown tx.kind=%s for order_id=%s", tx.kind, order_id)
        return {"ok": False, "reason": "unknown_tx_kind"}

    # помечаем транзакцию как применённую
    tx.applied = True
    tx.provider_status = status_str
    if payment_id:
        tx.provider_payment_id = payment_id
    db.add(tx)

    db.commit()

    _ensure_subscription_flag(user, db)

    return PlainTextResponse("OK")
