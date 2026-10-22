# schemas/review.py
from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel, EmailStr, Field, conint, constr

# -------- Public in --------
class ReviewCreate(BaseModel):
    """
    Публичная форма добавления отзыва.
    published игнорируется — на сервере всегда False.
    """
    email: EmailStr
    title: constr(min_length=1, max_length=300)
    description: Optional[constr(max_length=5000)] = None
    rating: conint(ge=1, le=5)


# -------- Admin in --------
class ReviewUpdate(BaseModel):
    """
    Редактирование отзыва (админ).
    Поля опциональны; published редактируется отдельным эндпоинтом.
    """
    email: Optional[EmailStr] = None
    title: Optional[constr(min_length=1, max_length=300)] = None
    description: Optional[constr(max_length=5000)] = None
    rating: Optional[conint(ge=1, le=5)] = None

class ReviewPublish(BaseModel):
    published: bool = Field(..., description="true=опубликовать, false=скрыть")


# -------- Out --------
class ReviewOut(BaseModel):
    id: int
    email: str  # в публичных ответах приходит замаскированным (a***@host)
    title: str
    description: Optional[str] = None
    rating: int
    published: bool
    created_at: datetime

    class Config:
        from_attributes = True

class ReviewList(BaseModel):
    total: int
    items: List[ReviewOut]
