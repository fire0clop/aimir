from sqlalchemy import Column, String, DateTime, Integer
from sqlalchemy.dialects.postgresql import UUID, CITEXT
import uuid
from db import Base

class PendingRegistration(Base):
    __tablename__ = "pending_registrations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=True)
    email = Column(CITEXT, nullable=False, unique=True, index=True)
    password = Column(String, nullable=False)  # уже хэш (bcrypt_sha256)
    code = Column(String(6), nullable=False)
    attempts = Column(Integer, nullable=False, default=0)
    resend_count = Column(Integer, nullable=False, default=0)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
