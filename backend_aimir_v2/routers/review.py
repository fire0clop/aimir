# routers/reviews.py
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from db import get_db
from core.security import decode_token
from core.dashboard_access import get_dashboard_whitelist
from models.user import User
from models.review import Review
from schemas.review import (
    ReviewCreate, ReviewUpdate, ReviewPublish,
    ReviewOut, ReviewList,
)

router = APIRouter(prefix="/reviews", tags=["reviews"])

# ----------------- helpers -----------------
def _current_user(authorization: str | None, db: Session) -> User:
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


def _ensure_dashboard_access(user: User):
    """
    Те же права, что и для дашборда:
    доступ только для email-ов из core/dashboard_whitelist.json
    """
    whitelist = get_dashboard_whitelist()
    if user.email.lower() not in whitelist:
        raise HTTPException(status_code=403, detail="Access denied")


# ----------------- public ------------------
@router.post(
    "", response_model=ReviewOut, status_code=status.HTTP_201_CREATED,
    summary="Отправить отзыв (публично)",
)
def create_review(payload: ReviewCreate, db: Session = Depends(get_db)):
    """
    Создаёт отзыв с published=False.
    Отображаться на главной начнёт только после модерации.
    """
    r = Review(
        email=payload.email,
        title=payload.title,
        description=payload.description,
        rating=payload.rating,
        published=False,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@router.get(
    "", response_model=ReviewList, summary="Список опубликованных отзывов (для главной)"
)
def list_published_reviews(
    db: Session = Depends(get_db),
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    q = db.query(Review).filter(Review.published.is_(True)).order_by(Review.id.desc())
    total = q.count()
    items = q.limit(limit).offset(offset).all()
    return {"total": total, "items": items}


# ----------------- admin (whitelist) -----------------
@router.get(
    "/admin", response_model=ReviewList, summary="(Админ) список всех отзывов"
)
def admin_list_reviews(
    authorization: str = Header(None),
    db: Session = Depends(get_db),
    published: bool | None = Query(None, description="true/false — фильтр по публикации"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    search: str | None = Query(None, description="поиск по email/title (ILIKE)"),
):
    user = _current_user(authorization, db)
    _ensure_dashboard_access(user)

    q = db.query(Review)
    if published is not None:
        q = q.filter(Review.published.is_(published))
    if search:
        like = f"%{search}%"
        q = q.filter((Review.email.ilike(like)) | (Review.title.ilike(like)))
    q = q.order_by(Review.id.desc())
    total = q.count()
    items = q.limit(limit).offset(offset).all()
    return {"total": total, "items": items}


@router.patch(
    "/{review_id}", response_model=ReviewOut, summary="(Админ) редактировать отзыв"
)
def admin_update_review(
    review_id: int,
    body: ReviewUpdate,
    authorization: str = Header(None),
    db: Session = Depends(get_db),
):
    user = _current_user(authorization, db)
    _ensure_dashboard_access(user)

    r = db.query(Review).filter(Review.id == review_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Review not found")

    # обновляем только переданные поля
    if body.email is not None:
        r.email = body.email
    if body.title is not None:
        r.title = body.title
    if body.description is not None:
        r.description = body.description
    if body.rating is not None:
        r.rating = body.rating

    db.commit()
    db.refresh(r)
    return r


@router.patch(
    "/{review_id}/publish", response_model=ReviewOut, summary="(Админ) опубликовать/скрыть отзыв"
)
def admin_set_publish_state(
    review_id: int,
    body: ReviewPublish,
    authorization: str = Header(None),
    db: Session = Depends(get_db),
):
    user = _current_user(authorization, db)
    _ensure_dashboard_access(user)

    r = db.query(Review).filter(Review.id == review_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Review not found")

    r.published = body.published
    db.commit()
    db.refresh(r)
    return r


@router.delete(
    "/{review_id}", status_code=status.HTTP_204_NO_CONTENT, summary="(Админ) удалить отзыв"
)
def admin_delete_review(
    review_id: int,
    authorization: str = Header(None),
    db: Session = Depends(get_db),
):
    user = _current_user(authorization, db)
    _ensure_dashboard_access(user)

    r = db.query(Review).filter(Review.id == review_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Review not found")
    db.delete(r)
    db.commit()
    return None


# ----------------- public: один опубликованный отзыв -----------------
@router.get(
    "/{review_id}", response_model=ReviewOut,
    summary="Просмотр одного опубликованного отзыва"
)
def get_published_review(review_id: int, db: Session = Depends(get_db)):
    r = db.query(Review).filter(
        Review.id == review_id,
        Review.published.is_(True)
    ).first()
    if not r:
        raise HTTPException(status_code=404, detail="Review not found")
    return r
