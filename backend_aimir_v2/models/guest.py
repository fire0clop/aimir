# models/guest.py
import uuid
from datetime import datetime, timedelta
from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from core.config import settings
from db import Base


class GuestUser(Base):
    __tablename__ = "guest_users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    label = Column(String(64), nullable=False, unique=True, default=lambda: uuid.uuid4().hex[:16])
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    documents = relationship("GuestDocument", back_populates="guest", cascade="all, delete-orphan")


class GuestDocument(Base):
    __tablename__ = "guest_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    guest_id = Column(UUID(as_uuid=True), ForeignKey("guest_users.id", ondelete="CASCADE"), nullable=False)
    original_name = Column(String, nullable=False)
    storage_key = Column(String, nullable=False)
    file_ext = Column(String(10), nullable=False)
    file_size = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    guest = relationship("GuestUser", back_populates="documents")
