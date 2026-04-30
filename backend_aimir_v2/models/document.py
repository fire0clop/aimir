# models/document.py
from __future__ import annotations
import uuid
from sqlalchemy import Column, ForeignKey, Text, BigInteger
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP
from sqlalchemy.sql import func
from db import Base  # <-- единый Base из db.py

class Document(Base):
    __tablename__ = "documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    original_name = Column(Text, nullable=False)
    storage_key   = Column(Text, nullable=False)   # путь/ключ файла
    file_ext      = Column(Text, nullable=True)
    file_size     = Column(BigInteger, nullable=False, server_default="0")
    created_at    = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
