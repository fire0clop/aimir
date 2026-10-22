# bot_backend/billing_service.py
from __future__ import annotations

from calendar import monthrange
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from models.user import User
from models.billing_transaction import BillingTransaction


def _today() -> date:
    return date.today()


def is_active_subscription(u: User) -> bool:
    return bool(u.subscription_end and u.subscription_end >= _today())


def add_months(d: date, months: int) -> date:
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    day = min(d.day, monthrange(y, m)[1])
    return date(y, m, day)


def ensure_subscription_flag(user: User) -> None:
    should_be = is_active_subscription(user)
    user.has_subscription = should_be


def apply_confirmed_transaction(db: Session, tx: BillingTransaction, payment_id: Optional[str], status_str: str) -> None:
    """
    Применяет tx к пользователю (если tx.applied=False), и помечает tx.applied=True.
    """
    if tx.applied:
        # просто обновим статус
        tx.provider_status = status_str
        if payment_id:
            tx.provider_payment_id = payment_id
        db.add(tx)
        db.commit()
        return

    user: Optional[User] = db.query(User).filter(User.id == tx.user_id).first()
    if not user:
        raise RuntimeError("User not found for transaction")

    if tx.kind == "credits":
        user.balance = (Decimal(user.balance or 0) + Decimal(tx.quantity or 0))
        db.add(user)

    elif tx.kind == "subscription":
        months_map = {"month": 1, "6m": 6, "year": 12}
        months = months_map.get(tx.plan or "month", 1)
        today = _today()

        base = user.subscription_end if is_active_subscription(user) and user.subscription_end else today
        if not user.subscription_start:
            user.subscription_start = today

        user.subscription_end = add_months(base, months)
        user.has_subscription = True
        db.add(user)

    else:
        raise RuntimeError(f"Unknown tx.kind={tx.kind}")

    tx.applied = True
    tx.provider_status = status_str
    if payment_id:
        tx.provider_payment_id = payment_id
    db.add(tx)

    ensure_subscription_flag(user)
    db.add(user)

    db.commit()
