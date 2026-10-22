# -*- coding: utf-8 -*-
"""
Приведение исходного документа к .docx для применения правок.

- .docx  → отдаём как есть;
- .doc   → конвертация LibreOffice (soffice --headless --convert-to docx);
- .pdf   → конвертация pdf2docx (восстанавливает абзацы и таблицы).

Результат правки для .doc и .pdf выдаётся пользователю в формате DOCX —
исходные форматы не позволяют точечную правку без пересборки документа.
"""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Tuple


class ConvertError(Exception):
    """Файл не удалось привести к .docx."""


def ensure_docx(bin_path: Path, original_name: str) -> Tuple[bytes, bool]:
    """
    Возвращает (docx_bytes, converted):
      converted=False — исходник уже был .docx;
      converted=True  — сделали конвертацию (.doc или .pdf → .docx).
    Бросает ConvertError с человекочитаемым сообщением.
    """
    ext = Path(original_name or bin_path.name).suffix.lower()

    if ext == ".docx":
        return bin_path.read_bytes(), False

    if ext == ".doc":
        return _doc_to_docx(bin_path), True

    if ext == ".pdf":
        return _pdf_to_docx(bin_path), True

    raise ConvertError(f"Формат «{ext or 'неизвестный'}» не поддерживается для правок")


def _doc_to_docx(src: Path) -> bytes:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise ConvertError("Конвертер DOC недоступен на сервере")
    with tempfile.TemporaryDirectory(prefix="docconv_") as tmp:
        tmp_dir = Path(tmp)
        tmp_src = tmp_dir / ("src" + src.suffix.lower())
        shutil.copyfile(src, tmp_src)
        try:
            subprocess.run(
                [soffice, "--headless", "--convert-to", "docx",
                 "--outdir", str(tmp_dir), str(tmp_src)],
                check=True, timeout=90,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        except subprocess.TimeoutExpired:
            raise ConvertError("Конвертация DOC не уложилась в отведённое время")
        except Exception as e:
            raise ConvertError(f"Не удалось конвертировать DOC: {e}")
        out = tmp_dir / "src.docx"
        if not out.exists():
            raise ConvertError("Конвертация DOC не дала результата")
        return out.read_bytes()


def _pdf_to_docx(src: Path) -> bytes:
    try:
        from pdf2docx import Converter
    except ImportError:
        raise ConvertError("Конвертер PDF недоступен на сервере")
    with tempfile.TemporaryDirectory(prefix="pdfconv_") as tmp:
        out = Path(tmp) / "out.docx"
        try:
            cv = Converter(str(src))
            try:
                cv.convert(str(out))
            finally:
                cv.close()
        except Exception as e:
            raise ConvertError(f"Не удалось конвертировать PDF: {e}")
        if not out.exists():
            raise ConvertError("Конвертация PDF не дала результата")
        return out.read_bytes()
