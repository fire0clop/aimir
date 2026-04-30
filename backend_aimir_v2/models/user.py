# models/user.py
import uuid
from sqlalchemy import Column, String, Boolean, Numeric, Date
from sqlalchemy.dialects.postgresql import UUID
from db import Base

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)  # можно оставить not null
    password = Column(String, nullable=True)
    google_id = Column(String, unique=True, nullable=True)

    # НОВОЕ:
    telegram_id = Column(String, unique=True, nullable=True)

    has_subscription = Column(Boolean, nullable=False, default=False)
    balance = Column(Numeric(12, 2), nullable=False, default=0)
    subscription_start = Column(Date, nullable=True)
    subscription_end   = Column(Date, nullable=True)

    owner = Column(Boolean, nullable=False, default=False)
