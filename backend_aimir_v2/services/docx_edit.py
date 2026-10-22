# -*- coding: utf-8 -*-
"""
Точечное редактирование .docx без потери форматирования.

Методика (см. «тестирование документа/МЕТОДИКА.md»): .docx — это zip с XML;
меняем ТОЛЬКО текст внутри тегов <w:t> нужного абзаца, не трогая свойства
абзацев (pPr), прогонов (rPr), стили и таблицы — поэтому форматирование
сохраняется байт-в-байт. Перед поиском склеиваем соседние одинаково
отформатированные прогоны (Word дробит текст из-за проверки орфографии).

Модель никогда не трогает файл: она лишь предлагает пары «старый фрагмент →
новый фрагмент», применяет их этот детерминированный код.
"""
from __future__ import annotations

import io
import re
import zipfile
from typing import List, Optional, Tuple
from xml.sax.saxutils import escape as xml_escape

T_RE = re.compile(r'(<w:t(?:\s[^>]*)?>)(.*?)(</w:t>)', re.S)
P_RE = re.compile(r'<w:p[ >].*?</w:p>', re.S)


class EditError(Exception):
    """Правка не может быть применена (фрагмент не найден / неуникален)."""


def para_text(p_xml: str) -> str:
    """Видимый текст абзаца: конкатенация содержимого всех <w:t>."""
    return ''.join(m.group(2) for m in T_RE.finditer(p_xml))


def merge_runs(xml: str) -> str:
    """Слить соседние прогоны с одинаковым форматированием, чтобы текст
    абзаца лежал в одном <w:t> и его можно было найти как строку."""
    xml = re.sub(r'<w:proofErr[^>]*/>', '', xml)
    run_re = re.compile(r'<w:r(?:\s[^>]*)?>(?:(?!</w:r>).)*</w:r>', re.S)
    rpr_re = re.compile(r'<w:rPr>.*?</w:rPr>', re.S)

    def run_parts(r_xml: str):
        rpr = rpr_re.search(r_xml)
        body_wo_rpr = rpr_re.sub('', r_xml, count=1)
        inner = re.sub(r'^<w:r(?:\s[^>]*)?>|</w:r>$', '', body_wo_rpr, flags=re.S)
        only_text = re.fullmatch(r'(?:<w:t(?:\s[^>]*)?>.*?</w:t>)?', inner, re.S) is not None
        return (rpr.group(0) if rpr else ''), only_text

    def merge_in_paragraph(p_xml: str) -> str:
        runs = list(run_re.finditer(p_xml))
        if len(runs) < 2:
            return p_xml
        pieces, i, last_end = [], 0, 0
        while i < len(runs):
            j = i
            rpr_i, simple_i = run_parts(runs[i].group(0))
            texts = [para_text(runs[i].group(0))]
            while (j + 1 < len(runs) and simple_i
                   and runs[j].end() == runs[j + 1].start()):
                rpr_n, simple_n = run_parts(runs[j + 1].group(0))
                if not simple_n or rpr_n != rpr_i:
                    break
                texts.append(para_text(runs[j + 1].group(0)))
                j += 1
            pieces.append(p_xml[last_end:runs[i].start()])
            if j > i:
                merged = ('<w:r>' + rpr_i +
                          '<w:t xml:space="preserve">' + xml_escape(''.join(texts)) +
                          '</w:t></w:r>')
                pieces.append(merged)
            else:
                pieces.append(runs[i].group(0))
            last_end = runs[j].end()
            i = j + 1
        pieces.append(p_xml[last_end:])
        return ''.join(pieces)

    return P_RE.sub(lambda m: merge_in_paragraph(m.group(0)), xml)


def find_clause_span(xml: str, clause: str):
    """Абзац считается пунктом N, если его текст начинается с 'N.' или 'N '."""
    pat = re.compile(r'^\s*' + re.escape(clause) + r'[.\s]')
    hits = [m for m in P_RE.finditer(xml) if pat.match(para_text(m.group(0)))]
    if not hits:
        raise EditError(f'пункт «{clause}» не найден')
    if len(hits) > 1:
        raise EditError(f'пункт «{clause}» найден {len(hits)} раз')
    return hits[0]


def replace_in_span(xml: str, start: int, end: int, old: str, new: str, where: str) -> str:
    """Заменить фрагмент видимого текста внутри xml[start:end].

    Работает по склеенному тексту всех <w:t>: находит фрагмент, даже если он
    разбит на прогоны с разным форматированием. Перед заменой отсекается общий
    префикс/суффикс старого и нового текста, поэтому меняется только
    различающаяся часть и она наследует форматирование своего прогона.
    Поиск толерантен к виду пробелов (обычный / неразрывный U+00A0)."""
    span = xml[start:end]
    esc_old, esc_new = xml_escape(old), xml_escape(new)

    pieces = list(T_RE.finditer(span))
    full, offsets, pos = [], [], 0
    for idx, m in enumerate(pieces):
        c = m.group(2)
        offsets.append((pos, pos + len(c), idx))
        full.append(c)
        pos += len(c)
    full_text = ''.join(full)

    hits = list(re.finditer(re.escape(esc_old), full_text))
    if not hits:
        tokens = esc_old.split()
        if tokens:
            pat = re.compile(r'\s+'.join(re.escape(t) for t in tokens))
            hits = list(pat.finditer(full_text))
    if not hits:
        raise EditError(f'фрагмент не найден в {where}')
    if len(hits) > 1:
        raise EditError(f'фрагмент встречается в {where} {len(hits)} раз(а)')
    ms, me = hits[0].start(), hits[0].end()

    matched = full_text[ms:me]
    p = 0
    while p < min(len(matched), len(esc_new)) and matched[p] == esc_new[p]:
        p += 1
    s = 0
    while (s < min(len(matched), len(esc_new)) - p
           and matched[len(matched) - 1 - s] == esc_new[len(esc_new) - 1 - s]):
        s += 1
    ms += p
    me -= s
    esc_new = esc_new[p:len(esc_new) - s if s else None]

    replacements, inserted = {}, False
    for fs, fe, idx in offsets:
        if fe <= ms or fs >= me:
            continue
        c = pieces[idx].group(2)
        local_s, local_e = max(ms - fs, 0), min(me - fs, len(c))
        replacements[idx] = c[:local_s] + ('' if inserted else esc_new) + c[local_e:]
        inserted = True

    if not replacements and esc_new:
        for fs, fe, idx in offsets:
            if fs <= ms <= fe:
                c = pieces[idx].group(2)
                replacements[idx] = c[:ms - fs] + esc_new + c[ms - fs:]
                break

    out, cursor = [], 0
    for idx, m in enumerate(pieces):
        if idx not in replacements:
            continue
        open_tag, close = m.group(1), m.group(3)
        if 'xml:space' not in open_tag:
            open_tag = open_tag[:-1] + ' xml:space="preserve">'
        out.append(span[cursor:m.start()])
        out.append(open_tag + replacements[idx] + close)
        cursor = m.end()
    out.append(span[cursor:])
    return xml[:start] + ''.join(out) + xml[end:]


_CLAUSE_NUM_RE = re.compile(r'^\d+(?:\.\d+)*$')


def apply_edits(docx_bytes: bytes, edits: List[dict]) -> Tuple[bytes, List[dict]]:
    """
    Применить список правок [{old, new, clause?}] к .docx.

    Стратегия каждой правки:
      1) если передан номер пункта (clause вида "5.1") и такой пункт находится
         в документе — замена внутри пункта (самый безопасный вариант);
      2) иначе — замена уникального фрагмента по всему документу.

    Возвращает (новые_байты, отчёт). Отчёт — список
    {"index": i, "ok": bool, "reason": str|None} по каждой правке.
    Если хотя бы одна правка не применилась, файл НЕ считается готовым —
    решает вызывающая сторона по отчёту.
    """
    with zipfile.ZipFile(io.BytesIO(docx_bytes)) as z:
        names = z.namelist()
        parts = {n: z.read(n) for n in names}

    xml = merge_runs(parts['word/document.xml'].decode('utf-8'))
    report: List[dict] = []

    for i, e in enumerate(edits):
        old = (e.get('old') or '').strip()
        new = (e.get('new') or '').strip()
        clause: Optional[str] = (e.get('clause') or '').strip() or None
        if not old or not new:
            report.append({'index': i, 'ok': False, 'reason': 'пустой фрагмент правки'})
            continue
        if old == new:
            report.append({'index': i, 'ok': True, 'reason': None})
            continue
        try:
            applied = False
            if clause and _CLAUSE_NUM_RE.match(clause):
                try:
                    m = find_clause_span(xml, clause)
                    xml = replace_in_span(xml, m.start(), m.end(), old, new,
                                          f'пункте {clause}')
                    applied = True
                except EditError:
                    pass  # падаем на поиск по всему документу
            if not applied:
                xml = replace_in_span(xml, 0, len(xml), old, new, 'документе')
            report.append({'index': i, 'ok': True, 'reason': None})
        except EditError as err:
            report.append({'index': i, 'ok': False, 'reason': str(err)})

    parts['word/document.xml'] = xml.encode('utf-8')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for n in names:
            z.writestr(n, parts[n])
    return buf.getvalue(), report
