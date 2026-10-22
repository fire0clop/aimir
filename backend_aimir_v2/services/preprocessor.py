from __future__ import annotations

import re
from typing import Tuple, List


_CLAUSE_NUM_RE = re.compile(
    r'^\s*(\d+(?:\.\d+)+)[\.\s]|'   # 1.1 / 1.1.2 (многоуровневый)
    r'^\s*(\d+)\.\s',                 # 5. (одноуровневый)
    re.IGNORECASE,
)

_CLAUSE_START_RE = re.compile(
    r'^\s*('
    r'\d+\.\s|'
    r'\d+\.\d[\d\.]*[\.\s]|'
    r'\d+\)\s|'
    r'п\.?\s*\d|'
    r'пункт\s+\d|'
    r'раздел\s+\w|'
    r'статья\s+\d|'
    r'глава\s+\d|'
    r'§\s*\d'
    r')',
    re.IGNORECASE,
)


def _extract_clause_label(text: str) -> str | None:
    """Extract the actual clause number (e.g. '2.12', '5') from start of paragraph."""
    m = re.match(r'^\s*(\d+(?:\.\d+)+)', text)
    if m:
        return m.group(1)
    m = re.match(r'^\s*(\d+)\.\s', text)
    if m:
        return m.group(1)
    return None


def number_paragraphs(text: str) -> Tuple[str, List[str]]:
    """
    Splits contract text into logical units and numbers them.
    Uses real clause numbers as labels when detected (e.g. [2.12]),
    falls back to sequential [N] for unlabelled paragraphs.
    Returns (numbered_text, list_of_paragraphs).
    """
    if not text or not text.strip():
        return text, []

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

        if _CLAUSE_START_RE.match(stripped) and current_parts:
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

    if not paragraphs:
        raw_paras = [p.strip() for p in text.split('\n\n') if len(p.strip()) >= 20]
        paragraphs = raw_paras if raw_paras else [text.strip()]

    # Build numbered output — use real clause number if available
    numbered_lines = []
    for i, p in enumerate(paragraphs, 1):
        label = _extract_clause_label(p) or str(i)
        numbered_lines.append(f'[{label}] {p}')

    return '\n\n'.join(numbered_lines), paragraphs


def verify_citations(issues: list, paragraphs: List[str]) -> list:
    """
    Grounds every citation in the ACTUAL contract text.

    Strategy per issue:
      1. If the model's quote appears verbatim in the referenced paragraph — keep it.
      2. If it appears verbatim in some other paragraph — keep it, relabel the clause.
      3. Otherwise the quote is hallucinated / paraphrased / mis-ordered →
         replace `text` with the real paragraph text (source of truth), so the
         user never sees a fabricated or "truncated"-looking quote.

    The displayed quote thus always comes from the document, not the model.
    """
    if not issues or not paragraphs:
        return issues

    norm_paras = [_normalize_ws(p) for p in paragraphs]

    # Build label→index map for real clause numbers
    label_to_idx: dict[str, int] = {}
    for i, p in enumerate(paragraphs):
        label = _extract_clause_label(p)
        if label:
            label_to_idx[label] = i

    def _label_for(idx: int) -> str:
        return _extract_clause_label(paragraphs[idx]) or str(idx + 1)

    result = []

    for issue in issues:
        if not isinstance(issue, dict):
            continue

        issue = dict(issue)  # never mutate caller's dict
        quote = (issue.get('text') or '').strip()
        nquote = _normalize_ws(quote)

        # Resolve the paragraph the model referenced via [label]
        ref_idx = None
        m = re.search(r'\[([^\]]+)\]', issue.get('clause') or '')
        if m:
            ref_label = m.group(1).strip()
            if ref_label in label_to_idx:
                ref_idx = label_to_idx[ref_label]
            else:
                try:
                    n = int(ref_label)
                    if 1 <= n <= len(paragraphs):
                        ref_idx = n - 1
                except ValueError:
                    pass

        # Quote too short to verify — leave as is (rare)
        if len(nquote) < 12:
            result.append(issue)
            continue

        # 1) Genuine quote inside the referenced paragraph — trust it
        if ref_idx is not None and nquote in norm_paras[ref_idx]:
            result.append(issue)
            continue

        # 2) Genuine quote found in a different paragraph — keep, fix the label
        found_idx = next((i for i, np_ in enumerate(norm_paras) if nquote in np_), None)
        if found_idx is not None:
            issue['clause'] = f'[{_label_for(found_idx)}]'
            result.append(issue)
            continue

        # 3) Quote not present verbatim anywhere → ground it to real paragraph text
        target_idx = ref_idx
        if target_idx is None:
            target_idx = _find_best_paragraph(nquote, norm_paras)
        if target_idx is not None:
            issue['text'] = paragraphs[target_idx].strip()
            issue['clause'] = f'[{_label_for(target_idx)}]'
            result.append(issue)
        # else: quote references no real clause and matches no paragraph →
        # treat as a fabricated citation and drop it (never show invented quotes).

    return result


def _normalize_ws(s: str) -> str:
    """Lowercase and collapse all whitespace — for robust substring matching."""
    return re.sub(r'\s+', ' ', (s or '')).strip().lower()


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
