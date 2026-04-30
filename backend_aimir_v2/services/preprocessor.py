from __future__ import annotations

import re
from typing import Tuple, List


def number_paragraphs(text: str) -> Tuple[str, List[str]]:
    """
    Splits contract text into logical units and numbers them [1], [2], ...
    Returns (numbered_text, list_of_paragraphs).

    The numbered_text is what goes to GPT — model is told to cite [N] when quoting.
    The list_of_paragraphs is used for citation verification.
    """
    if not text or not text.strip():
        return text, []

    # Pattern: a line that starts a new clause/section
    clause_start = re.compile(
        r'^\s*('
        r'\d+\.\s|'              # 1. (with space)
        r'\d+\.\d[\d\.]*\s|'    # 1.1 or 1.1.2 (with space)
        r'\d+\)\s|'             # 1)
        r'п\.?\s*\d|'           # п.1 or п. 1
        r'пункт\s+\d|'          # пункт 1
        r'раздел\s+\w|'         # раздел 1 / раздел I
        r'статья\s+\d|'         # статья 1
        r'глава\s+\d|'          # глава 1
        r'§\s*\d'               # § 1
        r')',
        re.IGNORECASE,
    )

    raw_lines = text.split('\n')
    paragraphs: List[str] = []
    current_parts: List[str] = []

    for line in raw_lines:
        stripped = line.strip()

        if not stripped:
            if current_parts:
                combined = ' '.join(current_parts)
                if len(combined) >= 20:
                    paragraphs.append(combined)
                current_parts = []
            continue

        # New clause → flush buffer and start fresh
        if clause_start.match(stripped) and current_parts:
            combined = ' '.join(current_parts)
            if len(combined) >= 20:
                paragraphs.append(combined)
            current_parts = [stripped]
        else:
            current_parts.append(stripped)

    if current_parts:
        combined = ' '.join(current_parts)
        if len(combined) >= 20:
            paragraphs.append(combined)

    # Fallback: if clause detection found nothing, split by double newlines
    if not paragraphs:
        raw_paras = [p.strip() for p in text.split('\n\n') if len(p.strip()) >= 20]
        paragraphs = raw_paras if raw_paras else [text.strip()]

    # Build numbered output
    numbered_lines = [f'[{i}] {p}' for i, p in enumerate(paragraphs, 1)]
    return '\n\n'.join(numbered_lines), paragraphs


def verify_citations(issues: list, paragraphs: List[str]) -> list:
    """
    For each issue, checks if the quoted text actually appears in the contract.
    If the citation is wrong, tries to find the correct paragraph.
    Keeps the issue even if citation can't be verified (analysis itself may still be valid).
    """
    if not issues or not paragraphs:
        return issues

    para_lower = [p.lower() for p in paragraphs]
    result = []

    for issue in issues:
        if not isinstance(issue, dict):
            continue

        quote = (issue.get('text') or '').strip()

        if not quote or len(quote) < 15:
            result.append(issue)
            continue

        quote_lower = quote.lower()

        # Extract ref number like [42]
        ref = (issue.get('clause') or '')
        ref_num = None
        m = re.search(r'\[(\d+)\]', ref)
        if m:
            ref_num = int(m.group(1))

        # Check if quote appears in the referenced paragraph
        if ref_num and 1 <= ref_num <= len(paragraphs):
            target = para_lower[ref_num - 1]
            if _text_overlap(quote_lower, target) >= 0.4:
                result.append(issue)
                continue

        # Try to find the quote in any paragraph
        best_para = _find_best_paragraph(quote_lower, para_lower)

        if best_para is not None:
            issue = dict(issue)
            issue['clause'] = f'[{best_para + 1}]'

        result.append(issue)

    return result


def _text_overlap(a: str, b: str) -> float:
    """Rough overlap score between two strings using 4-gram sliding windows."""
    words_a = a.split()
    if len(words_a) < 4:
        return 1.0 if a in b else 0.0

    windows = [' '.join(words_a[i:i + 4]) for i in range(0, len(words_a) - 3, 2)]
    if not windows:
        return 0.0

    hits = sum(1 for w in windows if w in b)
    return hits / len(windows)


def _find_best_paragraph(quote_lower: str, para_lower: List[str]) -> int | None:
    """Returns index of the paragraph with the best overlap, or None if no match."""
    best_score = 0.3  # minimum threshold
    best_idx = None

    for i, para in enumerate(para_lower):
        score = _text_overlap(quote_lower, para)
        if score > best_score:
            best_score = score
            best_idx = i

    return best_idx
