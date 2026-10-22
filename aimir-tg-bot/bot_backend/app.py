# bot_backend/app.py
import os
import uuid
import time
import json
import hashlib
from decimal import Decimal
from typing import Optional
from urllib.parse import parse_qs

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db import SessionLocal
from models.user import User
from models.billing_transaction import BillingTransaction

from bot_backend.tbank import init_payment
from bot_backend.billing_service import apply_confirmed_transaction

app = FastAPI(title="Aimir TG Bot Backend")


# ====== схемы ======
class SubscribePayIn(BaseModel):
    telegram_id: str
    plan: str = Field(..., pattern="^(month|6m|year)$")


class CreditsPayIn(BaseModel):
    telegram_id: str
    quantity: int = Field(..., ge=1, le=100000)


# ====== цены (из env) ======
PRICE_MONTH = Decimal(os.getenv("SUB_PRICE_MONTH", "450"))
PRICE_6M = Decimal(os.getenv("SUB_PRICE_6M", "1750"))
PRICE_YEAR = Decimal(os.getenv("SUB_PRICE_YEAR", "3150"))
PRICE_REQUEST = Decimal(os.getenv("REQUEST_PRICE", "39"))


# ====== T-Bank webhook token config ======
TBANK_PASSWORD = os.getenv("TBANK_PASSWORD", "")
WEBHOOK_SKIP_TOKEN = os.getenv("TBANK_WEBHOOK_SKIP_TOKEN", "false").lower() in ("1", "true", "yes", "y")


def _get_or_create_user(db: Session, telegram_id: str, name: str = "") -> User:
    u = db.query(User).filter(User.telegram_id == telegram_id).first()
    if u:
        return u

    technical_email = f"tg_{telegram_id}@example.local"
    u = User(
        name=name or "",
        email=technical_email,
        password=None,
        google_id=None,
        telegram_id=telegram_id,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _short_user_id(user: User) -> str:
    return str(user.id).replace("-", "")[:16]


def make_order_id(prefix: str, user_short: str, suffix: str) -> str:
    # пример: cred_abcd1234_10_1700000000
    return f"{prefix}_{user_short}_{suffix}_{int(time.time())}"


def verify_webhook_signature(payload: dict) -> bool:
    """
    Проверка Token вебхука T-Bank — как в твоём working-примере:
    1) убираем Token и пустые значения (None/{})
    2) сортируем по ключу
    3) конкатенируем нормализованные значения
    4) добавляем пароль
    5) sha256 -> сравниваем с Token
    """
    try:
        got = str(payload.get("Token") or "")

        data = {k: v for k, v in payload.items() if k != "Token" and v not in (None, {})}

        def norm(v):
            if isinstance(v, bool):
                return "true" if v else "false"
            if isinstance(v, (dict, list)):
                return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
            return str(v)

        concat_values = "".join(norm(data[k]) for k in sorted(data.keys()))
        concat = concat_values + (TBANK_PASSWORD or "")
        expected = hashlib.sha256(concat.encode("utf-8")).hexdigest()

        ok = (expected == got)
        if not ok and WEBHOOK_SKIP_TOKEN:
            return True
        return ok
    except Exception:
        return bool(WEBHOOK_SKIP_TOKEN)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/pay/subscribe")
def pay_subscribe(body: SubscribePayIn):
    db = SessionLocal()
    try:
        user = _get_or_create_user(db, body.telegram_id, name="")

        price_map = {"month": PRICE_MONTH, "6m": PRICE_6M, "year": PRICE_YEAR}
        months_map = {"month": 1, "6m": 6, "year": 12}

        amount = price_map[body.plan].quantize(Decimal("0.01"))
        months = months_map[body.plan]

        order_id = make_order_id("sub", _short_user_id(user), body.plan)

        # Receipt:
        # подписка = 1 услуга, цена = вся сумма в копейках, количество = 1
        amount_kop = int(amount * 100)

        payment_url, payment_id = init_payment(
            amount_rub=amount,
            order_id=order_id,
            description=f"Подписка {body.plan}",
            receipt_title=f"Подписка — {body.plan}",
            receipt_price_kop=amount_kop,   # цена за 1 шт (копейки)
            receipt_quantity=1,
            receipt_email=user.email,
            receipt_phone=None,
        )

        tx = BillingTransaction(
            id=uuid.uuid4(),
            user_id=user.id,
            kind="subscription",
            plan=body.plan,
            quantity=months,
            amount_rub=amount,
            provider="tbank",
            provider_order_id=order_id,
            provider_payment_id=payment_id or None,
            provider_status="NEW",
            applied=False,
        )
        db.add(tx)
        db.commit()

        return {
            "payment_url": payment_url,
            "order_id": order_id,
            "payment_id": payment_id,
            "amount_rub": float(amount),
        }
    finally:
        db.close()


@app.post("/pay/credits")
def pay_credits(body: CreditsPayIn):
    db = SessionLocal()
    try:
        user = _get_or_create_user(db, body.telegram_id, name="")

        qty = int(body.quantity)
        amount = (PRICE_REQUEST * Decimal(qty)).quantize(Decimal("0.01"))

        order_id = make_order_id("cred", _short_user_id(user), str(qty))

        # Receipt:
        # кредиты = qty услуг, цена за 1 = REQUEST_PRICE в копейках, количество = qty
        price_per_one_kop = int(PRICE_REQUEST * 100)

        payment_url, payment_id = init_payment(
            amount_rub=amount,
            order_id=order_id,
            description=f"Кредиты {qty} шт.",
            receipt_title=f"Кредиты ({qty} шт.)",
            receipt_price_kop=price_per_one_kop,
            receipt_quantity=qty,
            receipt_email=user.email,
            receipt_phone=None,
        )

        tx = BillingTransaction(
            id=uuid.uuid4(),
            user_id=user.id,
            kind="credits",
            plan=None,
            quantity=qty,
            amount_rub=amount,
            provider="tbank",
            provider_order_id=order_id,
            provider_payment_id=payment_id or None,
            provider_status="NEW",
            applied=False,
        )
        db.add(tx)
        db.commit()

        return {
            "payment_url": payment_url,
            "order_id": order_id,
            "payment_id": payment_id,
            "amount_rub": float(amount),
        }
    finally:
        db.close()


def _parse_form_body(raw: bytes) -> dict:
    """
    T-Bank может прислать application/x-www-form-urlencoded.
    """
    text = raw.decode("utf-8", errors="ignore")
    parsed = parse_qs(text, keep_blank_values=True)
    return {k: (v[0] if isinstance(v, list) else v) for k, v in parsed.items()}


@app.post("/tbank/webhook")
async def tbank_webhook(request: Request):
    """
    Вебхук T-Bank.
    Применяем транзакцию только при Status=CONFIRMED.
    Поддерживаем JSON и form-urlencoded.
    """
    db = SessionLocal()
    try:
        raw = await request.body()
        ctype = (request.headers.get("content-type") or "").split(";")[0].strip().lower()

        if ctype == "application/json":
            try:
                data = await request.json()
            except Exception:
                data = {}
        else:
            try:
                data = _parse_form_body(raw)
            except Exception:
                data = {}

        if not isinstance(data, dict):
            data = {}

        # проверка подписи (Token)
        if not verify_webhook_signature(data):
            return {"ok": False, "reason": "bad_token"}

        status_str = str(data.get("Status") or "").upper()
        order_id = str(data.get("OrderId") or "")
        payment_id = str(data.get("PaymentId") or "")

        if not order_id:
            return {"ok": True, "note": "empty_order_id"}

        tx: Optional[BillingTransaction] = (
            db.query(BillingTransaction)
            .filter(
                BillingTransaction.provider == "tbank",
                BillingTransaction.provider_order_id == order_id,
            )
            .first()
        )
        if not tx:
            return {"ok": True, "note": "tx_not_found"}

        # если не CONFIRMED — просто обновляем статус
        if status_str != "CONFIRMED":
            tx.provider_status = status_str
            if payment_id:
                tx.provider_payment_id = payment_id
            db.add(tx)
            db.commit()
            return {"ok": True, "skipped": status_str}

        # CONFIRMED — применяем к пользователю (если ещё не applied)
        apply_confirmed_transaction(db, tx, payment_id=payment_id or None, status_str=status_str)
        return {"ok": True}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()
