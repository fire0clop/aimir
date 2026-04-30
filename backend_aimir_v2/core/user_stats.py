# core/user_stats.py
from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import func

from models.user import User
from models.document import Document
from models.contract_analysis import ContractAnalysis
from core.config import settings


def get_user_documents_count(user: User, db: Session) -> int:
    return db.query(func.count(Document.id)).filter(Document.user_id == user.id).scalar() or 0


def get_user_tokens_total(user: User, db: Session) -> int:
    total = (
        db.query(func.coalesce(func.sum(ContractAnalysis.tokens_total), 0))
        .filter(ContractAnalysis.user_id == user.id)
        .scalar()
    )
    return int(total or 0)


def get_cost_for_tokens(tokens: int) -> Decimal:
    """
    Возвращаем стоимость токенов в РУБЛЯХ по усреднённой ставке за 1000 токенов.
    """
    price_per_1k_rub = Decimal(str(settings.OPENAI_GPT4O_BLEND_PER_1K_RUB))
    return (Decimal(tokens) / Decimal(1000)) * price_per_1k_rub
