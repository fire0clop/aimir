# schemas/documents.py
from __future__ import annotations

from datetime import datetime
from typing import Optional, Any, Dict

from pydantic import BaseModel
from uuid import UUID


class UploadResult(BaseModel):
    id: UUID
    original_name: str


class GuestStartOut(BaseModel):
    guest_token: str


class DocumentOut(BaseModel):
    id: UUID
    original_name: str
    file_ext: str
    file_size: int
    created_at: Optional[datetime] = None

    # новое поле: информация о последней аналитике документа
    # сюда мы кладём dict вида:
    # {
    #   "id": <analysis_id | None>,
    #   "selected_party": <str | None>,
    #   "is_paid": <bool>,
    #   "analysis": { summary, key_terms, ... }  # то что лежит в result.json
    # }
    last_analysis: Optional[Dict[str, Any]] = None
