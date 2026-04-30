# models/billing_transaction.py
from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import Column, String, Integer, Numeric, DateTime, ForeignKey, Boolean, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from db import Base


class BillingTransaction(Base):
    """
    Лог всех операций по биллингу:
    - покупка подписки
    - покупка кредитов (разовые запросы)
    - в том числе через платёжные провайдеры (T-Банк и др.)
    """

    __tablename__ = "billing_transactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # тип операции: "subscription" или "credits" (можно расширять)
    kind = Column(String, nullable=False)

    # для подписки: "month" / "6m" / "year"
    # для кредитов: можно оставить NULL
    plan = Column(String, nullable=True)

    # для кредитов: сколько кредитов купили
    # для подписки можно оставить 0 или количество месяцев
    quantity = Column(Integer, nullable=False, default=0)

    # сумма в рублях (итого за операцию)
    amount_rub = Column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))

    # когда произошло (создана запись)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # ===== интеграция с платёжным провайдером (T-Банк) =====
    # имя провайдера, например: "tbank"
    provider = Column(String, nullable=True)

    # order_id, который мы сами сгенерировали и передали в T-Банк
    provider_order_id = Column(String, nullable=True, index=True)

    # PaymentId от T-Банка (может быть удобен для поиска)
    provider_payment_id = Column(String, nullable=True, index=True)

    # последний известный статус от провайдера (например, "CONFIRMED", "REJECTED")
    provider_status = Column(String, nullable=True)

    # применена ли операция к балансу/подписке пользователя
    applied = Column(Boolean, nullable=False, default=False)

    __table_args__ = (
        # не даём создать две транзакции с одинаковым провайдером и order_id
        UniqueConstraint("provider", "provider_order_id", name="uq_billing_tx_provider_order"),
    )
