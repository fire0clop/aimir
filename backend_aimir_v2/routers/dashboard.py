# routers/dashboard.py
from requests import RequestException
from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from db import get_db
from models.user import User
from models.document import Document
from models.contract_analysis import ContractAnalysis
from models.billing_transaction import BillingTransaction
from core.security import decode_token
from core.dashboard_access import get_dashboard_whitelist
from core.config import settings
from core.user_stats import get_cost_for_tokens  # считает стоимость токенов в РУБЛЯХ
from core.yandex_metrika import fetch_visits_timeseries, fetch_goals_funnel
router = APIRouter(prefix="/dashboard", tags=["dashboard"])


# --------- общая auth-обвязка для дашборда ---------


def get_current_user(
    authorization: str = Header(None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Bearer token",
        )

    token = authorization.split(" ", 1)[1]
    payload = decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return user


# --------- основной дашборд (подписки + выручка по состоянию) ---------


@router.get("", status_code=status.HTTP_200_OK)
def dashboard_data(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    start_date: date | None = None,
    end_date: date | None = None,
):
    whitelist = get_dashboard_whitelist()
    if current_user.email.lower() not in whitelist:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )

    users = db.query(User).all()
    today = date.today()

    # -------- subscriptions.by_type (как и было — состояние "на сегодня") --------
    counts = {
        "month": 0,
        "six_months": 0,
        "year": 0,
        "other": 0,
        "balance_only": 0,
        "none": 0,
    }

    for u in users:
        has_active_sub = (
            bool(u.has_subscription)
            and u.subscription_start is not None
            and u.subscription_end is not None
            and u.subscription_end >= today
        )

        if has_active_sub:
            delta_days = (u.subscription_end - u.subscription_start).days

            if 25 <= delta_days <= 40:
                key = "month"
            elif 150 <= delta_days <= 210:
                key = "six_months"
            elif 350 <= delta_days <= 380:
                key = "year"
            else:
                key = "other"

            counts[key] += 1
        else:
            if u.balance is not None and Decimal(u.balance) > 0:
                counts["balance_only"] += 1
            else:
                counts["none"] += 1

    total_users = len(users)

    # -------- Фильтр по транзакциям (общий для всех расчётов ниже) --------
    tx_filters = [BillingTransaction.applied.is_(True)]

    if start_date or end_date:
        if end_date is None:
            end_date = today
        if start_date is None:
            # "открытый левый край" — можно подправить под свою реальность
            start_date = date(2000, 1, 1)

        if start_date > end_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="start_date must be <= end_date",
            )

        from_dt = start_date
        to_dt = end_date + timedelta(days=1)

        tx_filters.append(BillingTransaction.created_at >= from_dt)
        tx_filters.append(BillingTransaction.created_at < to_dt)

    # -------- revenue по транзакциям --------

    # агрегируем подписочные транзакции по plan
    sub_rows = (
        db.query(
            BillingTransaction.plan.label("plan"),
            func.sum(BillingTransaction.amount_rub).label("amount_rub"),
        )
        .filter(
            BillingTransaction.kind == "subscription",
            *tx_filters,
            # по желанию:
            # BillingTransaction.provider_status == "CONFIRMED",
        )
        .group_by(BillingTransaction.plan)
        .all()
    )

    revenue_by_type_dec: dict[str, Decimal] = {
        "month": Decimal("0"),
        "six_months": Decimal("0"),
        "year": Decimal("0"),
    }

    for row in sub_rows:
        plan = (row.plan or "").lower()

        # маппинг plan -> ключи, которые ждёт фронт
        if plan in ("month", "1m"):
            key = "month"
        elif plan in ("6m", "six_months"):
            key = "six_months"
        elif plan in ("year", "12m"):
            key = "year"
        else:
            # если хочешь учитывать "левые" планы — можно завести "other"
            continue

        revenue_by_type_dec[key] += Decimal(row.amount_rub or 0)

    total_subscriptions_revenue: Decimal = sum(revenue_by_type_dec.values())

    # кредиты: все пополнения разовых запросов
    credits_total_rub_raw = (
        db.query(func.coalesce(func.sum(BillingTransaction.amount_rub), 0))
        .filter(
            BillingTransaction.kind == "credits",
            *tx_filters,
            # при желании:
            # BillingTransaction.provider_status == "CONFIRMED",
        )
        .scalar()
    )
    credits_total_rub: Decimal = Decimal(credits_total_rub_raw or 0)

    grand_total_estimated: Decimal = total_subscriptions_revenue + credits_total_rub

    def d2f(x: Decimal) -> float:
        return float(x.quantize(Decimal("0.01")))

    return {
        "subscriptions": {
            "by_type": counts,
            "total_users": total_users,
        },
        "revenue": {
            "by_type": {
                "month": d2f(revenue_by_type_dec["month"]),
                "six_months": d2f(revenue_by_type_dec["six_months"]),
                "year": d2f(revenue_by_type_dec["year"]),
            },
            "total_subscriptions": d2f(total_subscriptions_revenue),
            "balance_total": d2f(credits_total_rub),
            "grand_total_estimated": d2f(grand_total_estimated),
        },
    }

@router.get("/users/summary", status_code=status.HTTP_200_OK)
def dashboard_users_summary(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Сводка по всем пользователям, у которых есть хотя бы один документ (не гости).

    Для каждого пользователя возвращаем:
      - id, email, name
      - documents_count        — количество загруженных им документов
      - has_subscription       — есть ли подписка (флаг)
      - subscription_start     — дата начала подписки
      - subscription_end       — дата окончания подписки
      - credits_balance        — сколько запросов на балансе (user.balance)
      - tokens_total           — суммарные токены по анализам
      - cost_tokens_rub        — наши расходы на токены (РУБЛИ)
      - revenue_total_rub      — все деньги от пользователя (все applied транзакции)
      - net_rub                — доход − расход (РУБЛИ)
    """
    whitelist = get_dashboard_whitelist()
    if current_user.email.lower() not in whitelist:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )

    # --- сколько документов у каждого user_id ---
    docs_subq = (
        db.query(
            Document.user_id.label("user_id"),
            func.count(Document.id).label("docs_count"),
        )
        .group_by(Document.user_id)
        .subquery()
    )

    # --- суммарные токены по анализам ---
    tokens_subq = (
        db.query(
            ContractAnalysis.user_id.label("user_id"),
            func.coalesce(func.sum(ContractAnalysis.tokens_total), 0).label("tokens_total"),
        )
        .group_by(ContractAnalysis.user_id)
        .subquery()
    )

    # --- суммарные деньги по всем применённым транзакциям ---
    tx_subq = (
        db.query(
            BillingTransaction.user_id.label("user_id"),
            func.coalesce(func.sum(BillingTransaction.amount_rub), 0).label("revenue_total_rub"),
        )
        .filter(BillingTransaction.applied.is_(True))
        .group_by(BillingTransaction.user_id)
        .subquery()
    )

    # берём только тех юзеров, у кого есть хотя бы один документ
    rows = (
        db.query(
            User,
            docs_subq.c.docs_count,
            func.coalesce(tokens_subq.c.tokens_total, 0).label("tokens_total"),
            func.coalesce(tx_subq.c.revenue_total_rub, 0).label("revenue_total_rub"),
        )
        .join(docs_subq, docs_subq.c.user_id == User.id)
        .outerjoin(tokens_subq, tokens_subq.c.user_id == User.id)
        .outerjoin(tx_subq, tx_subq.c.user_id == User.id)
        .all()
    )

    def d2f(x: Decimal) -> float:
        return float(Decimal(x or 0).quantize(Decimal("0.01")))

    items = []

    for user, docs_count, tokens_total, revenue_total_rub in rows:
        docs_count = int(docs_count or 0)
        tokens_total = int(tokens_total or 0)

        # расходы на токены
        cost_tokens: Decimal = get_cost_for_tokens(tokens_total)

        # все деньги от пользователя
        revenue_total: Decimal = Decimal(revenue_total_rub or 0)

        # net
        net_rub: Decimal = revenue_total - cost_tokens

        # баланс как "кол-во запросов" — у тебя balance это кредиты
        try:
            credits_balance = int(Decimal(user.balance or 0))
        except Exception:
            credits_balance = 0

        items.append(
            {
                "id": str(user.id),
                "email": user.email,
                "name": user.name,
                "documents_count": docs_count,
                "has_subscription": bool(user.has_subscription),
                "subscription_start": user.subscription_start,
                "subscription_end": user.subscription_end,
                "credits_balance": credits_balance,
                "tokens_total": tokens_total,
                "cost_tokens_rub": d2f(cost_tokens),
                "revenue_total_rub": d2f(revenue_total),
                "net_rub": d2f(net_rub),
            }
        )

    return {"items": items}

# --------- выручка по транзакциям (по периодам, для графиков) ---------


@router.get("/revenue/timeseries", status_code=status.HTTP_200_OK)
def revenue_timeseries(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    start_date: date | None = None,
    end_date: date | None = None,
    group_by: str = "day",  # "day" или "month"
):
    """
    Фактическая выручка по транзакциям (billing_transactions).

    Параметры:
      - start_date / end_date (date, опционально)
          по умолчанию: последние 30 дней
      - group_by: "day" или "month"

    Возвращает:
      - start_date, end_date, group_by
      - items: список точек:
          {
            "bucket": "YYYY-MM-DD" (день или первый день месяца),
            "kind": "subscription" | "credits",
            "amount_rub": float
          }
      - totals:
          {
            "by_kind": { "subscription": ..., "credits": ... },
            "grand_total": ...
          }
    """
    whitelist = get_dashboard_whitelist()
    if current_user.email.lower() not in whitelist:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )

    if group_by not in ("day", "month"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="group_by must be 'day' or 'month'",
        )

    today = date.today()
    if end_date is None:
        end_date = today
    if start_date is None:
        start_date = end_date - timedelta(days=30)

    # включительно по end_date → фильтруем < end_date + 1 день
    from_dt = start_date
    to_dt = end_date + timedelta(days=1)

    trunc_unit = "day" if group_by == "day" else "month"

    # агрегируем по bucket (день/месяц) и виду транзакции
    q = (
        db.query(
            func.date_trunc(trunc_unit, BillingTransaction.created_at).label("bucket"),
            BillingTransaction.kind.label("kind"),
            func.sum(BillingTransaction.amount_rub).label("amount_rub"),
        )
        .filter(BillingTransaction.applied.is_(True))
        .filter(BillingTransaction.created_at >= from_dt)
        .filter(BillingTransaction.created_at < to_dt)
        .group_by("bucket", BillingTransaction.kind)
        .order_by("bucket", BillingTransaction.kind)
    )

    rows = q.all()

    def d2f(x) -> float:
        return float(Decimal(x or 0).quantize(Decimal("0.01")))

    items = []
    for r in rows:
        # r.bucket — datetime
        bucket_date = r.bucket.date()
        if group_by == "month":
            # нормализуем к первому числу месяца
            bucket_date = bucket_date.replace(day=1)

        items.append(
            {
                "bucket": bucket_date.isoformat(),
                "kind": r.kind,
                "amount_rub": d2f(r.amount_rub),
            }
        )

    # Итоги за период по видам
    totals_rows = (
        db.query(
            BillingTransaction.kind.label("kind"),
            func.sum(BillingTransaction.amount_rub).label("amount_rub"),
        )
        .filter(BillingTransaction.applied.is_(True))
        .filter(BillingTransaction.created_at >= from_dt)
        .filter(BillingTransaction.created_at < to_dt)
        .group_by(BillingTransaction.kind)
        .all()
    )

    totals_by_kind: dict[str, float] = {}
    grand_total = Decimal("0")

    for t in totals_rows:
        amt = Decimal(t.amount_rub or 0)
        totals_by_kind[t.kind] = d2f(amt)
        grand_total += amt

    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "group_by": group_by,
        "items": items,
        "totals": {
            "by_kind": totals_by_kind,
            "grand_total": d2f(grand_total),
        },
    }

@router.get("/metrika", status_code=status.HTTP_200_OK)
def dashboard_metrika(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),  # db оставим, чтобы сигнатура была как у других
    start_date: date | None = None,
    end_date: date | None = None,
):
    """
    Данные Яндекс.Метрики для дашборда:
      - visits_timeseries: [{ date, visits }]
      - funnel: { visits_total, steps: [...] }
    """
    whitelist = get_dashboard_whitelist()
    if current_user.email.lower() not in whitelist:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )

    today = date.today()
    if end_date is None:
        end_date = today
    if start_date is None:
        start_date = end_date - timedelta(days=30)

    if start_date > end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="start_date must be <= end_date",
        )

    try:
        visits_ts = fetch_visits_timeseries(start_date=start_date, end_date=end_date)
        funnel = fetch_goals_funnel(start_date=start_date, end_date=end_date)
    except RequestException as e:
        # ошибки сети / HTTP от Яндекса
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Ошибка при запросе к Яндекс.Метрике: {e}",
        )
    except Exception as e:
        # любая другая наша ошибка
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Внутренняя ошибка дашборда Метрики: {e}",
        )

    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "visits_timeseries": visits_ts,
        "funnel": funnel,
    }