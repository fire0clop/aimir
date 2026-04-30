# models/contract_analysis.py
from __future__ import annotations
import uuid
from sqlalchemy import Column, Text, Boolean, Integer, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP
from sqlalchemy.sql import func
from db import Base

class ContractAnalysis(Base):
    __tablename__ = "contract_analysis"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    user_id     = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    storage_dir     = Column(Text, nullable=False)
    selected_party  = Column(Text, nullable=False)
    is_paid         = Column(Boolean, nullable=False, default=False)

    tokens_identify_party = Column(Integer, nullable=False, default=0)
    tokens_full_analysis  = Column(Integer, nullable=False, default=0)
    tokens_total          = Column(Integer, nullable=False, default=0)

    parts_count = Column(Integer, nullable=False, default=1)
    status      = Column(Text, nullable=False, default="completed")
    feedback_kind = Column(Text, nullable=True)

    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
