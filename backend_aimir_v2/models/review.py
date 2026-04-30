# models/review.py
from sqlalchemy import Column, Integer, Text, Boolean, DateTime, CheckConstraint
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.sql import func

from db import Base

class Review(Base):
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(CITEXT, nullable=False)
    title = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    published = Column(Boolean, nullable=False, default=False)
    rating = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint("rating BETWEEN 1 AND 5", name="reviews_rating_check"),
    )
