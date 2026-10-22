# bot_backend/tbank.py
import os
import json
import hashlib
import logging
from decimal import Decimal
from typing import Optional, Tuple

import requests

logger = logging.getLogger(__name__)

TBANK_TERMINAL_KEY = os.getenv("TBANK_TERMINAL_KEY", "")
TBANK_PASSWORD = os.getenv("TBANK_PASSWORD", "")
TBANK_API_BASE = (os.getenv("TBANK_API") or "").rstrip("/")  # https://securepay.tinkoff.ru/v2
TBANK_INIT_URL = f"{TBANK_API_BASE}/Init"

PUBLIC_BASE_URL = (os.getenv("PUBLIC_BASE_URL") or "").rstrip("/")
TBANK_SUCCESS_URL = os.getenv("TBANK_SUCCESS_URL") or (PUBLIC_BASE_URL + "/billing") if PUBLIC_BASE_URL else ""
TBANK_FAIL_URL = os.getenv("TBANK_FAIL_URL") or (PUBLIC_BASE_URL + "/billing") if PUBLIC_BASE_URL else ""
TBANK_NOTIFY_URL = os.getenv("TBANK_NOTIFY_URL") or (PUBLIC_BASE_URL + "/tg-bot/tbank/webhook") if PUBLIC_BASE_URL else ""

# Receipt (FFD 1.2) — как у тебя в примере
RECEIPT_FFD_VERSION = os.getenv("RECEIPT_FFD_VERSION", "1.2")
RECEIPT_TAXATION = os.getenv("RECEIPT_TAXATION", "usn_income")
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
    Token для /v2/Init:
    исключаем Token, Receipt, DATA, Shops.
    Остальные непустые поля сортируем по ключу,
    конкатенируем значения + Password, SHA-256.
    """
    exclude_keys = {"Token", "Receipt", "DATA", "Shops"}
    data = {}
    for k, v in payload.items():
        if k in exclude_keys:
            continue
        if v in (None, "", [], {}):
            continue
        data[k] = v

    data["Password"] = TBANK_PASSWORD or ""
    concat = "".join(str(data[k]) for k in sorted(data))
    return hashlib.sha256(concat.encode("utf-8")).hexdigest()


def init_payment(
    *,
    amount_rub: Decimal,
    order_id: str,
    description: str,
    receipt_title: str,
    receipt_price_kop: int,
    receipt_quantity: int,
    receipt_email: Optional[str] = None,
    receipt_phone: Optional[str] = None,
) -> Tuple[str, str]:
    if not (TBANK_TERMINAL_KEY and TBANK_PASSWORD and TBANK_API_BASE):
        raise RuntimeError("T-Bank env is not configured (TBANK_TERMINAL_KEY/TBANK_PASSWORD/TBANK_API)")

    amount_kop = int(Decimal(amount_rub) * 100)

    payload = {
        "TerminalKey": TBANK_TERMINAL_KEY,
        "Amount": amount_kop,
        "OrderId": order_id,
        "Description": (description or "")[:250],
        "NotificationURL": TBANK_NOTIFY_URL,
        "SuccessURL": TBANK_SUCCESS_URL,
        "FailURL": TBANK_FAIL_URL,
        "Receipt": _receipt_make(
            title=receipt_title,
            price_kop=receipt_price_kop,
            quantity=receipt_quantity,
            email=receipt_email,
            phone=receipt_phone,
        ),
    }
    payload["Token"] = _tbank_init_token(payload)

    r = requests.post(TBANK_INIT_URL, json=payload, timeout=20)
    try:
        data = r.json()
    except Exception:
        data = {}

    if r.status_code != 200 or not data.get("Success"):
        msg = data.get("Message") or "Init failed"
        raise RuntimeError(f"T-Bank Init failed: {msg}; resp={data}")

    payment_url = data.get("PaymentURL") or ""
    payment_id = str(data.get("PaymentId") or "")

    if not payment_url or not payment_id:
        raise RuntimeError(f"T-Bank Init returned empty PaymentURL/PaymentId; resp={data}")

    return payment_url, payment_id
