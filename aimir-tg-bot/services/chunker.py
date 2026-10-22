# services/chunker.py
from __future__ import annotations

import os
from typing import List

# грубая оценка: 1 токен ~= 4 символа латиницы и 2–3 кириллицы
# для надёжности берём 3.5 символа на токен
TOK_CHARS = 3.5


def max_tokens_per_chunk() -> int:
    """
    Максимальное количество токенов на чанк.
    Реальный размер в символах = токены * TOK_CHARS.
    """
    try:
        # Делаем адекватный дефолт 3000 токенов, а не 50000
        return max(2000, int(os.getenv("MAX_TOKENS_PER_CHUNK", "3000")))
    except Exception:
        return 3000


def split_text(text: str) -> List[str]:
    """
    Делим по символам с мягкими границами по предложениям/абзацам.
    Это быстро и не тянет лишних зависимостей.
    """
    if not text:
        return []

    target_tokens = max_tokens_per_chunk()
    max_chars = int(target_tokens * TOK_CHARS)

    if len(text) <= max_chars:
        return [text]

    chunks: List[str] = []
    buf: List[str] = []
    cur_len = 0

    # предпочитаем делить по абзацам
    for para in text.split("\n\n"):
        p = para.strip()
        if not p:
            continue
        # если параграф очень длинный — делим дополнительно по точкам
        if len(p) > max_chars:
            sentences = p.split(". ")
            for s in sentences:
                s2 = (s + ". ").strip()
                if cur_len + len(s2) > max_chars and buf:
                    chunks.append("\n".join(buf).strip())
                    buf, cur_len = [], 0
                buf.append(s2)
                cur_len += len(s2)
        else:
            if cur_len + len(p) + 2 > max_chars and buf:
                chunks.append("\n".join(buf).strip())
                buf, cur_len = [], 0
            buf.append(p)
            cur_len += len(p) + 2

    if buf:
        chunks.append("\n\n".join(buf).strip())

    return chunks
