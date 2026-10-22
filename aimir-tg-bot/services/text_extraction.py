# services/text_extraction.py
from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from pdfminer.high_level import extract_text as pdf_extract_text
from docx import Document as DocxDocument

logger = logging.getLogger(__name__)


def extract_text(path: Path) -> str:
    """
    Возвращает текст из файла .pdf / .docx / .doc.
    Никогда не бросает исключения наружу — возвращает "" при ошибке.
    """
    try:
        return (_extract_text(path) or "").strip()
    except Exception:
        logger.exception("[text-extract] fatal error for %s", path)
        return ""


def _extract_text(path: Path) -> Optional[str]:
    ext = path.suffix.lower()

    try:
        if ext == ".pdf":
            t = _extract_text_from_pdf(path)
            _log_backend(path, "pdfminer" if t.strip() else "pdfminer(empty)")
            return t

        if ext == ".docx":
            t = _extract_text_from_docx(path)
            _log_backend(path, "python-docx" if t.strip() else "python-docx(empty)")
            return t

        if ext == ".doc":
            t = _extract_text_from_doc(path)
            _log_backend(path, "doc-pipeline" if t.strip() else "doc-pipeline(empty)")
            return t

        logger.warning("[text-extract] unsupported ext=%s file=%s", ext, path)
        return ""

    except Exception:
        logger.exception("[text-extract] error while extracting ext=%s file=%s", ext, path)
        return ""


def _extract_text_from_pdf(path: Path) -> str:
    # Основной движок — PyMuPDF (fitz): сохраняет корректный порядок чтения.
    # pdfminer на ряде PDF (двухколоночная верстка, выравнивание по ширине)
    # перемешивает текст, из-за чего пункты выглядят «обрезанными».
    try:
        import fitz  # PyMuPDF
        with fitz.open(str(path)) as doc:
            text = "".join(page.get_text("text") for page in doc)
        if text.strip():
            return text.strip()
    except Exception:
        pass
    # Фолбэк — pdfminer (если PyMuPDF недоступен или не смог прочитать файл).
    return (pdf_extract_text(str(path)) or "").strip()


def _extract_text_from_docx(path: Path) -> str:
    doc = DocxDocument(str(path))
    parts: list[str] = []

    for p in doc.paragraphs:
        t = (p.text or "").strip("\x00").strip()
        if t:
            parts.append(t)

    # таблицы
    for table in doc.tables:
        for row in table.rows:
            cells = [(cell.text or "").strip("\x00").strip() for cell in row.cells]
            if any(cells):
                parts.append("\t".join(cells))

    return "\n".join(parts).strip()


# ---------- .DOC: несколько стратегий ----------
def _extract_text_from_doc(path: Path) -> str:
    # 1) LibreOffice (soffice) -> .docx
    conv = _convert_with_soffice(path, to="docx")
    if conv and conv.exists():
        try:
            text = _extract_text_from_docx(conv)
            _safe_unlink(conv)
            if text.strip():
                return text
        except Exception:
            logger.exception("[text-extract] docx parse failed after soffice convert: %s", conv)
            _safe_unlink(conv)

    # 2) unoconv -> txt
    txt = _convert_with_unoconv(path, to="txt")
    if txt and txt.exists():
        try:
            data = txt.read_text(encoding="utf-8", errors="ignore")
            _safe_unlink(txt)
            if data.strip():
                return data
        except Exception:
            logger.exception("[text-extract] txt read failed after unoconv convert: %s", txt)
            _safe_unlink(txt)

    # 3) antiword (stdout)
    text = _run_tool_capture(["antiword", str(path)])
    if text.strip():
        return text

    # 4) catdoc (stdout)
    text = _run_tool_capture(["catdoc", "-w", str(path)])
    if text.strip():
        return text

    # 5) textract (если установлен)
    try:
        import textract  # type: ignore
        raw = textract.process(str(path))
        text = (raw or b"").decode("utf-8", errors="ignore")
        if text.strip():
            return text
    except Exception:
        pass

    return ""


# ---------- helpers ----------
def _convert_with_soffice(src: Path, to: str) -> Optional[Path]:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        logger.info("[text-extract] soffice not found")
        return None

    out_dir = src.parent
    try:
        subprocess.run(
            [soffice, "--headless", "--nologo", "--nolockcheck", "--norestore",
             "--convert-to", to, "--outdir", str(out_dir), str(src)],
            check=True,
            timeout=60,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        candidate = out_dir / f"{src.stem}.{to}"
        return candidate if candidate.exists() else None
    except Exception:
        logger.exception("[text-extract] soffice convert failed for %s", src)
        return None


def _convert_with_unoconv(src: Path, to: str) -> Optional[Path]:
    unoconv = shutil.which("unoconv")
    if not unoconv:
        logger.info("[text-extract] unoconv not found")
        return None

    out = src.parent / f"{src.stem}.{to}"
    try:
        subprocess.run(
            [unoconv, "-f", to, "-o", str(out), str(src)],
            check=True,
            timeout=60,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return out if out.exists() else None
    except Exception:
        logger.exception("[text-extract] unoconv convert failed for %s", src)
        return None


def _run_tool_capture(cmd: list[str]) -> str:
    if not shutil.which(cmd[0]):
        logger.info("[text-extract] tool not found: %s", cmd[0])
        return ""

    try:
        res = subprocess.run(
            cmd,
            timeout=30,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        out = (res.stdout or b"").decode("utf-8", errors="ignore")
        if res.returncode != 0:
            err = (res.stderr or b"").decode("utf-8", errors="ignore")
            logger.info("[text-extract] tool=%s rc=%s err=%s", cmd[0], res.returncode, err[:300])
            return ""
        return out
    except Exception:
        logger.exception("[text-extract] tool crashed: %s", cmd)
        return ""


def _safe_unlink(p: Path) -> None:
    try:
        p.unlink()
    except Exception:
        pass


def _log_backend(path: Path, backend: str) -> None:
    logger.info("[text-extract] %s via %s", path.suffix.lower(), backend)
