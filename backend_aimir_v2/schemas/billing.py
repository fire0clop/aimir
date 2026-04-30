from pydantic import BaseModel, Field
from typing import Optional
from datetime import date

class PricesOut(BaseModel):
    sub_month: int
    sub_6m: int
    sub_year: int
    request_price: int

class BillingStatus(BaseModel):
    has_subscription: bool
    subscription_start: Optional[date] = None
    subscription_end: Optional[date] = None
    active: bool
    credits: int
    telegram_id: Optional[str] = None

class SubscribeIn(BaseModel):
    plan: str = Field(pattern="^(month|6m|year)$")  # месяц / 6 мес / год

class CreditsAddIn(BaseModel):
    quantity: int = Field(gt=0, le=100000)
