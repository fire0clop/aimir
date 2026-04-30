# routers/documents.py
from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import List, Literal, Optional, Tuple

from fastapi import (
    APIRouter,
    Depends,
    File,
    Header,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.config import settings
from core.security import decode_token
from db import get_db
from models.document import Document
from models.guest import GuestDocument, GuestUser
from models.user import User
from models.contract_analysis import ContractAnalysis
from schemas.documents import DocumentOut, GuestStartOut, UploadResult
from services.text_extraction import extract_text_to_file

router = APIRouter(prefix="/documents", tags=["documents"])

# ---------- Настройки ----------
ALLOWED_EXTS = {".pdf", ".doc", ".docx"}
MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024  # 50 MB

DOCS_ROOT = Path(getattr(settings, "DOCUMENTS_DIR", "./storage/documents")).resolve()
DOCS_ROOT.mkdir(parents=True, exist_ok=True)

ANALYTICS_FILENAME = getattr(settings, "ANALYTICS_FILENAME_RESULT", None) or "result.json"


# ---------- Утилиты ----------
def _sanitize_filename(name: str) -> str:
    name = (name or "").strip().replace("\\", "/").split("/")[-1]
    safe = "".join(ch for ch in name if ch.isalnum() or ch in " ._-()[]{}")
    safe = safe.strip()
    return safe or "file"


def _ext_of(name: str) -> str:
    return Path(name or "").suffix.lower()


def _current_user(authorization: Optional[str], db: Session) -> Optional[User]:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1]
    payload = decode_token(token)
    if not payload:
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    return db.query(User).filter(User.id == user_id).first()


def _resolve_scope(
    authorization: Optional[str],
    x_guest_token: Optional[str],
    request: Request,
    db: Session,
) -> Tuple[Literal["user", "guest"], User | GuestUser]:
    user = _current_user(authorization, db)
    if user:
        return "user", user

    token = x_guest_token or request.cookies.get("guest_token")
    if not token:
        raise HTTPException(status_code=401, detail="Guest token required")

    gu = db.execute(select(GuestUser).where(GuestUser.label == token)).scalar_one_or_none()
    if not gu:
        raise HTTPException(status_code=401, detail="Invalid guest token")
    return "guest", gu


def _save_stream_to_disk(dest: Path, up: UploadFile) -> int:
    size = 0
    with dest.open("wb") as out:
        for chunk in iter(lambda: up.file.read(1024 * 1024), b""):
            size += len(chunk)
            if size > MAX_FILE_SIZE_BYTES:
                out.close()
                try:
                    dest.unlink(missing_ok=True)
                except Exception:
                    pass
                raise HTTPException(status_code=413, detail="File too large")
            out.write(chunk)
    return size


def _load_result_json(storage_key: str) -> dict:
    """
    Ищем result.json рядом с бинарником документа.
    storage_key — относительный путь к файлу (Document.storage_key / GuestDocument.storage_key).
    """
    try:
        bin_path = DOCS_ROOT / storage_key
        storage_dir = bin_path.parent
        path = storage_dir / ANALYTICS_FILENAME
        if not path.exists():
            return {}
        raw = path.read_text(encoding="utf-8", errors="ignore").strip()
        if not raw:
            return {}
        data = json.loads(raw)
        if isinstance(data, dict):
            return data
        # если там список или что-то ещё — тоже вернём, но обернём в dict
        return {"data": data}
    except Exception:
        return {}


# ---------- Гость: старт ----------
@router.post("/guest/start", response_model=GuestStartOut, status_code=201)
def guest_start(response: Response, db: Session = Depends(get_db)):
    gu = GuestUser()
    db.add(gu)
    db.flush()
    db.refresh(gu)
    if not gu.label:
        raise HTTPException(status_code=500, detail="Guest label not generated")
    db.commit()

    response.set_cookie(
        key="guest_token",
        value=gu.label,
        httponly=True,
        samesite="Lax",
        secure=False,  # прод: True
        path="/",
        max_age=7 * 24 * 3600,
    )
    return GuestStartOut(guest_token=gu.label)


# ---------- Загрузка файла ----------
@router.post("/upload", response_model=UploadResult, status_code=201)
def upload_document(
    request: Request,
    response: Response,
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(None, convert_underscores=False),
    x_guest_token: Optional[str] = Header(None, alias="X-Guest-Token"),
    db: Session = Depends(get_db),
):
    ext = _ext_of(file.filename)
    if ext not in ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    # быстрый check размера по content-length (если есть)
    try:
        content_len = int(request.headers.get("content-length", "0"))
        if content_len > MAX_FILE_SIZE_BYTES:
            raise HTTPException(status_code=413, detail="File too large")
    except ValueError:
        pass

    scope, subj = _resolve_scope(authorization, x_guest_token, request, db)

    # Папка документа: DOCS_ROOT/<users|guests>/<owner_id>/<doc_id>/
    new_id = uuid.uuid4()
    owner_id = subj.id
    base = DOCS_ROOT / ("users" if scope == "user" else "guests") / str(owner_id) / str(new_id)
    base.mkdir(parents=True, exist_ok=True)

    safe_name = _sanitize_filename(file.filename)
    physical_name = f"file{ext}"
    abs_path = base / physical_name

    # запись на диск
    size = _save_stream_to_disk(abs_path, file)

    # storage_key — путь к бинарнику
    storage_key = str(abs_path.relative_to(DOCS_ROOT))

    # извлечение текста (тихо, для будущих функций)
    try:
        extract_text_to_file(abs_path)
    except Exception:
        pass

    # запись в БД
    if scope == "user":
        doc = Document(
            id=new_id,
            user_id=subj.id,
            original_name=safe_name,
            storage_key=storage_key,
            file_ext=ext,
            file_size=size,
        )
        db.add(doc)
        db.commit()
        return UploadResult(id=doc.id, original_name=doc.original_name)
    else:
        gdoc = GuestDocument(
            id=new_id,
            guest_id=subj.id,
            original_name=safe_name,
            storage_key=storage_key,
            file_ext=ext,
            file_size=size,
        )
        db.add(gdoc)
        db.commit()

        # синхронизируем cookie, если токен пришёл заголовком
        if x_guest_token:
            response.set_cookie(
                key="guest_token",
                value=subj.label,  # type: ignore[attr-defined]
                httponly=True,
                samesite="Lax",
                secure=False,
                path="/",
                max_age=7 * 24 * 3600,
            )
        return UploadResult(id=gdoc.id, original_name=gdoc.original_name)


# ---------- Список документов ----------
@router.get("/list", response_model=List[DocumentOut])
def list_documents(
    request: Request,
    authorization: Optional[str] = Header(None, convert_underscores=False),
    x_guest_token: Optional[str] = Header(None, alias="X-Guest-Token"),
    db: Session = Depends(get_db),
):
    scope, subj = _resolve_scope(authorization, x_guest_token, request, db)

    if scope == "user":
        rows = (
            db.query(Document)
            .filter(Document.user_id == subj.id)
            .order_by(Document.created_at.desc())
            .all()
        )
    else:
        rows = (
            db.query(GuestDocument)
            .filter(GuestDocument.guest_id == subj.id)
            .order_by(GuestDocument.created_at.desc())
            .all()
        )

    docs: List[DocumentOut] = []

    for r in rows:
        last_analysis = None

        # Пытаемся прочитать result.json
        analysis_json = _load_result_json(r.storage_key)

        if analysis_json:
            analysis_id = None
            selected_party = None
            is_paid = True  # по умолчанию считаем оплаченным, если нет записи в БД

            if scope == "user":
                ca = (
                    db.query(ContractAnalysis)
                        .filter(ContractAnalysis.document_id == r.id)
                        .order_by(ContractAnalysis.created_at.desc())
                        .first()
                )
                if ca:
                    analysis_id = str(ca.id)
                    selected_party = ca.selected_party
                    is_paid = bool(ca.is_paid)

            last_analysis = {
                "id": analysis_id,
                "selected_party": selected_party,
                "is_paid": is_paid,
                "analysis": analysis_json,
            }

        docs.append(
            DocumentOut(
                id=r.id,
                original_name=r.original_name,
                file_ext=r.file_ext,
                file_size=int(r.file_size or 0),
                created_at=r.created_at,
                last_analysis=last_analysis,
            )
        )

    return docs


# ---------- Скачать бинарный файл ----------
@router.get("/{doc_id}/download")
def download_document(
    doc_id: uuid.UUID,
    request: Request,
    authorization: Optional[str] = Header(None, convert_underscores=False),
    x_guest_token: Optional[str] = Header(None, alias="X-Guest-Token"),
    db: Session = Depends(get_db),
):
    scope, subj = _resolve_scope(authorization, x_guest_token, request, db)

    if scope == "user":
        r = db.query(Document).filter(Document.id == doc_id).first()
        if not r or r.user_id != subj.id:
            raise HTTPException(status_code=404, detail="Not found")
    else:
        r = db.query(GuestDocument).filter(GuestDocument.id == doc_id).first()
        if not r or r.guest_id != subj.id:
            raise HTTPException(status_code=404, detail="Not found")

    path = DOCS_ROOT / r.storage_key
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing")
    return FileResponse(str(path), filename=r.original_name, media_type="application/octet-stream")


# ---------- Удаление ----------
@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    doc_id: uuid.UUID,
    request: Request,
    authorization: Optional[str] = Header(None, convert_underscores=False),
    x_guest_token: Optional[str] = Header(None, alias="X-Guest-Token"),
    db: Session = Depends(get_db),
):
    scope, subj = _resolve_scope(authorization, x_guest_token, request, db)

    if scope == "user":
        r = db.query(Document).filter(Document.id == doc_id).first()
        if not r or r.user_id != subj.id:
            raise HTTPException(status_code=404, detail="Not found")
    else:
        r = db.query(GuestDocument).filter(GuestDocument.id == doc_id).first()
        if not r or r.guest_id != subj.id:
            raise HTTPException(status_code=404, detail="Not found")

    # удаляем всю папку doc_id (и text.txt/result.json тоже)
    bin_path = DOCS_ROOT / r.storage_key
    doc_dir = bin_path.parent
    try:
        shutil.rmtree(doc_dir, ignore_errors=True)
    except Exception:
        try:
            bin_path.unlink(missing_ok=True)
        except Exception:
            pass

    db.delete(r)
    db.commit()
    return Response(status_code=204)


# ---------- Claim: перенос гостевых документов на пользователя ----------
@router.post("/guest/claim")
def guest_claim(
    body: dict,
    authorization: Optional[str] = Header(None, convert_underscores=False),
    db: Session = Depends(get_db),
):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing token")
    user = _current_user(authorization, db)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")

    guest_token = (body or {}).get("guest_token")
    if not guest_token:
        raise HTTPException(status_code=400, detail="guest_token required")

    guest = db.execute(select(GuestUser).where(GuestUser.label == guest_token)).scalar_one_or_none()
    if not guest:
        return {"moved": 0}

    gdocs = db.query(GuestDocument).filter(GuestDocument.guest_id == guest.id).all()
    moved = 0
    for gd in gdocs:
        g_bin = Path(settings.DOCUMENTS_DIR).resolve() / gd.storage_key
        g_dir = g_bin.parent

        new_dir = Path(settings.DOCUMENTS_DIR).resolve() / "users" / str(user.id) / str(gd.id)
        new_dir.mkdir(parents=True, exist_ok=True)

        # переносим всё содержимое гостевой папки (включая text.txt и result.json)
        try:
            for p in g_dir.iterdir():
                try:
                    shutil.move(str(p), str(new_dir / p.name))
                except Exception:
                    pass
        except FileNotFoundError:
            pass

        # найдём бинарник в новой папке
        new_bin = None
        try:
            for p in new_dir.iterdir():
                if p.name.startswith("file.") or p.name.startswith("file"):
                    new_bin = p
                    break
        except Exception:
            pass
        if new_bin is None:
            continue

        new_storage_key = str(new_bin.relative_to(Path(settings.DOCUMENTS_DIR).resolve()))

        doc = Document(
            id=gd.id,
            user_id=user.id,
            original_name=gd.original_name,
            storage_key=new_storage_key,
            file_ext=gd.file_ext,
            file_size=gd.file_size,
            created_at=gd.created_at,
        )
        db.add(doc)
        moved += 1

        try:
            if g_dir.exists() and not any(g_dir.iterdir()):
                g_dir.rmdir()
        except Exception:
            pass

    db.delete(guest)  # каскадом удалит guest_documents
    db.commit()
    return {"moved": moved}
