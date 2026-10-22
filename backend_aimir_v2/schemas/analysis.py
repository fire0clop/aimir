# schemas/analysis.py
from __future__ import annotations

from typing import List, Optional, Literal, Dict, Any

from pydantic import BaseModel


class PartiesResponse(BaseModel):
    parties: List[str]


class SelectPartyBody(BaseModel):
    document_id: str
    selected_party: str


class AccessInfo(BaseModel):
    """
    Инфо о доступе к аналитике:
    - guest   – гость, только превью;
    - preview – пользователь без оплаты, превью + возможность разблокировать;
    - full    – полный доступ.
    """
    mode: Literal["guest", "preview", "full"]
    has_subscription: bool = False
    credits: int = 0
    can_unlock: bool = False


class SelectPartyResponse(BaseModel):
    analysis_id: Optional[str] = None
    document_id: str
    selected_party: str
    status: str
    analysis: Dict[str, Any]
    # сейчас backend это поле не заполняет → будет null,
    # позже добавим логику paywall’а
    access: Optional[AccessInfo] = None









# schemas/analysis.py — добавить новые модели

class OverallAssessment(BaseModel):
    verdict: str
    danger_score: float

class Issue(BaseModel):
    clause: str
    text: str
    problem: str
    risk: str
    why: str
    fix: str
    # готовая новая формулировка фрагмента text — для функции «Применить правку»
    suggestion: str = ""
    severity: str  # "low" | "medium" | "high"

class ContractAnalysisResponse(BaseModel):
    summary: str
    overall_assessment: OverallAssessment
    issues: List[Issue]
    # сколько проблемных пунктов скрыто пейволом (для превью-режима)
    issues_locked_count: Optional[int] = None

class SelectPartyResponseV2(BaseModel):
    analysis_id: Optional[str] = None
    document_id: str
    selected_party: str
    status: str
    analysis: ContractAnalysisResponse
    access: AccessInfo