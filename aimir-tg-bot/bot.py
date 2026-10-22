# bot.py
import os
import uuid
import json
import logging
import shutil
from pathlib import Path
import tempfile
from typing import Dict, List, Tuple, Any, Optional
from datetime import date
from decimal import Decimal
from calendar import monthrange

import requests
from dotenv import load_dotenv
from telegram import (
    Update,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    ReplyKeyboardMarkup,
    KeyboardButton,
)
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    ContextTypes,
    filters,
)

from fpdf import FPDF

from services.text_extraction import extract_text
from services import analysis_v2
from db import SessionLocal
from models.user import User

# ================== ЛОГИ ==================
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ================== ОКРУЖЕНИЕ ==================
load_dotenv()

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "./storage")).resolve()
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)


PDF_FONT_PATH = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
PDF_FONT_BOLD_PATH = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
PDF_FONT_NAME = "DejaVu"
BOT_BACKEND_URL = os.getenv("BOT_BACKEND_URL", "http://127.0.0.1:8088").rstrip("/")

# базовый URL для bot_backend (FastAPI)
# пример: https://aimir.tech/tg-bot
BOT_BACKEND_BASE_URL = (os.getenv("BOT_BACKEND_BASE_URL") or "").rstrip("/")

# кэш: (chat_id, doc_id) -> список сторон
PARTY_CACHE: Dict[Tuple[int, str], List[dict]] = {}

# ================== BILLING: цены (для текста кнопок) ==================
PRICE_SUB_MONTH = Decimal(os.getenv("SUB_PRICE_MONTH", "450.00"))
PRICE_SUB_6M = Decimal(os.getenv("SUB_PRICE_6M", "1750.00"))
PRICE_SUB_YEAR = Decimal(os.getenv("SUB_PRICE_YEAR", "3150.00"))
PRICE_REQUEST = Decimal(os.getenv("REQUEST_PRICE", "39.00"))

# ================== STATE KEYS ==================
UD_AWAITING_CREDITS_QTY = "awaiting_credits_qty"

# ================== PDF НАСТРОЙКИ ==================
PDF_SECTION_TITLES = {
    "Краткое резюме",
    "Ключевые условия",
    "Риски",
    "Неоднозначные формулировки",
    "Что стоит поправить",
    "Вопросы к контрагенту",
    "Вердикт",
}
PDF_KEY_TRANSLATIONS = {
    "services": "Услуги",
    "payment": "Оплата",
    "responsibilities": "Обязанности",
    "termination": "Расторжение",
    "non_payment": "Риск неоплаты",
    "responsibility_for_defects": "Ответственность за недостатки",
    "intellectual_property": "Интеллектуальная собственность",
    "unclear_scope": "Неясный объём услуг",
    "defining_defects": "Определение недостатков",
    "payment_terms": "Условия оплаты/возврата",
    "defects_clause": "Пункт про недостатки",
    "service_details": "Детали оказания услуг",
    "payment_clarity": "Уточнение по оплате",
}


# ================== УТИЛИТЫ ==================
def add_months(d: date, months: int) -> date:
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    day = min(d.day, monthrange(y, m)[1])
    return date(y, m, day)


def _strip_md_fence(raw: str) -> str:
    if not raw:
        return ""
    s = raw.strip()
    if not s.startswith("```"):
        return s
    lines = s.splitlines()
    if lines and lines[0].lstrip().startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def call_gpt_identify_parties(full_text: str) -> List[dict]:
    # Логика сайта: Claude вместо OpenAI (services/analysis_v2.py)
    return analysis_v2.identify_parties(full_text)


def call_gpt_full_analysis(full_text: str, party_name: str) -> dict:
    # Логика сайта: Claude, нумерация абзацев, чанкинг длинных договоров,
    # проверка цитат, структурные issues (services/analysis_v2.py)
    return analysis_v2.run_full_analysis(full_text, party_name)


def escape_html(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def format_section_html(value: Any, indent: int = 0) -> List[str]:
    prefix = "&nbsp;" * 2 * indent

    if isinstance(value, str):
        return [escape_html(value.strip())]

    if isinstance(value, list):
        lines = []
        for item in value:
            lines.extend(format_section_html(item, indent))
        return lines

    if isinstance(value, dict):
        lines = []
        for k, v in value.items():
            lines.append(f"{prefix}• <b>{escape_html(str(k))}:</b>")
            for sub in format_section_html(v, indent + 1):
                lines.append(prefix + sub)
        return lines

    return [escape_html(str(value))]


def _danger_emoji(score: float) -> str:
    if score >= 70:
        return "🟢"
    if score >= 40:
        return "🟡"
    return "🔴"


def format_preview_for_telegram(analysis: dict, has_credits: bool) -> str:
    parts: List[str] = []

    summary = analysis.get("summary")
    if summary:
        parts.append("<b>Краткое резюме:</b>")
        parts.extend(format_section_html(summary))
        parts.append("")

    # Новая структура (v2): overall_assessment + issues
    oa = analysis.get("overall_assessment") or {}
    if isinstance(oa, dict) and (oa.get("verdict") or oa.get("danger_score") is not None):
        try:
            score = float(oa.get("danger_score") or 0)
        except Exception:
            score = 0.0
        parts.append(f"<b>Оценка безопасности:</b> {_danger_emoji(score)} {score:.0f}/100")
        verdict = str(oa.get("verdict") or "").strip()
        if verdict:
            parts.append(f"<b>Вердикт:</b> {escape_html(verdict)}")
        parts.append("")

    issues = analysis.get("issues")
    if isinstance(issues, list) and issues:
        sev_count = {"high": 0, "medium": 0, "low": 0}
        for it in issues:
            if isinstance(it, dict):
                sev_count[it.get("severity", "low") if it.get("severity") in sev_count else "low"] += 1
        found = []
        if sev_count["high"]:
            found.append(f"🔴 серьёзных: {sev_count['high']}")
        if sev_count["medium"]:
            found.append(f"🟡 средних: {sev_count['medium']}")
        if sev_count["low"]:
            found.append(f"⚪ мелких: {sev_count['low']}")
        parts.append(f"<b>Найдено проблемных пунктов: {len(issues)}</b> ({', '.join(found)})")
        parts.append("")

    # Старая структура (для совместимости с ранее сохранёнными анализами)
    key_terms = analysis.get("key_terms")
    if key_terms:
        parts.append("<b>Ключевые условия:</b>")
        parts.extend(format_section_html(key_terms))
        parts.append("")

    if has_credits:
        parts.append(
            "Детальный разбор каждого пункта (цитаты, риски, что просить изменить) — по подписке "
            "или разово за 1 запрос."
        )
    else:
        parts.append("Детальный разбор каждого пункта доступен по подписке.")

    return "\n".join(parts).strip()


def format_section(value: Any, indent: int = 0) -> List[str]:
    """
    Печатает секции аккуратно:
    - dict: старается делать "- ключ: значение" в одну строку, если значение простое
    - list: элементы списком
    """
    prefix = "  " * indent

    if value is None:
        return []

    if isinstance(value, str):
        s = value.strip()
        return [prefix + s] if s else []

    if isinstance(value, (int, float, bool, Decimal)):
        return [prefix + str(value)]

    if isinstance(value, list):
        lines: List[str] = []
        for item in value:
            if isinstance(item, (dict, list)):
                lines.extend(format_section(item, indent))
            else:
                s = str(item).strip()
                if s:
                    lines.append(f"{prefix}- {s}")
        return lines

    if isinstance(value, dict):
        lines: List[str] = []
        for k, v in value.items():
            key = str(k).strip()
            key_ru = PDF_KEY_TRANSLATIONS.get(key, key)

            # --- если значение простое -> печатаем в одной строке
            if isinstance(v, str):
                vs = v.strip()
                if vs:
                    lines.append(f"{prefix}- {key_ru}: {vs}")
                else:
                    lines.append(f"{prefix}- {key_ru}:")
                continue

            if isinstance(v, (int, float, bool, Decimal)):
                lines.append(f"{prefix}- {key_ru}: {v}")
                continue

            # --- иначе: ключ строкой, значение ниже с отступом
            lines.append(f"{prefix}- {key_ru}:")
            lines.extend(format_section(v, indent + 1))

        return lines

    return [prefix + str(value)]


_SEVERITY_RU = {"high": "СЕРЬЁЗНЫЙ РИСК", "medium": "СРЕДНИЙ РИСК", "low": "НА ЗАМЕТКУ"}


def analysis_to_plaintext_v2(party_name: str, party_role: str, analysis: dict) -> str:
    """Отчёт по новой структуре (summary + overall_assessment + issues) — как на сайте."""
    lines: List[str] = []
    lines.append(f"Анализ договора для стороны: {party_name}")
    if party_role:
        lines.append(f"Роль: {party_role}")
    lines.append("")

    summary = str(analysis.get("summary") or "").strip()
    if summary:
        lines.append("Краткое резюме:")
        lines.append(summary)
        lines.append("")

    oa = analysis.get("overall_assessment") or {}
    if isinstance(oa, dict):
        try:
            score = float(oa.get("danger_score") or 0)
            lines.append(f"Оценка безопасности: {score:.0f}/100 (100 — безопасно, 0 — крайне опасно)")
        except Exception:
            pass
        verdict = str(oa.get("verdict") or "").strip()
        if verdict:
            lines.append(f"Вердикт: {verdict}")
        lines.append("")

    issues = analysis.get("issues")
    if isinstance(issues, list) and issues:
        lines.append(f"Проблемные пункты ({len(issues)}):")
        lines.append("")
        for i, it in enumerate(issues, start=1):
            if not isinstance(it, dict):
                continue
            sev = _SEVERITY_RU.get(it.get("severity", "low"), "НА ЗАМЕТКУ")
            clause = str(it.get("clause") or "").strip()
            title = str(it.get("problem") or "").strip() or "Проблема"
            head = f"{i}. [{sev}] {title}"
            if clause:
                head += f" (абзац {clause})"
            lines.append(head)

            quote = str(it.get("text") or "").strip()
            if quote:
                lines.append(f"   Цитата: «{quote}»")
            risk = str(it.get("risk") or "").strip()
            if risk:
                lines.append(f"   Риск: {risk}")
            why = str(it.get("why") or "").strip()
            if why:
                lines.append(f"   Почему это важно: {why}")
            fix = str(it.get("fix") or "").strip()
            if fix:
                lines.append(f"   Что просить изменить: {fix}")
            lines.append("")
    else:
        lines.append("Существенных проблемных пунктов не найдено.")
        lines.append("")

    return "\n".join(lines).strip()


def analysis_to_plaintext(party_name: str, party_role: str, analysis: dict) -> str:
    # Новая структура → новый отчёт; старая (ранее сохранённые анализы) → прежний формат
    if isinstance(analysis, dict) and isinstance(analysis.get("issues"), list):
        return analysis_to_plaintext_v2(party_name, party_role, analysis)

    lines: List[str] = []
    lines.append(f"Анализ договора для стороны: {party_name}")
    if party_role:
        lines.append(f"Роль: {party_role}")
    lines.append("")

    def section(title: str):
        lines.append(title + ":")

    def blank():
        lines.append("")

    def _get(item: dict, *keys: str) -> str:
        for k in keys:
            v = item.get(k)
            if v is not None:
                s = str(v).strip()
                if s:
                    return s
        return ""

    def compact_risks(items: Any):
        if not isinstance(items, list):
            return
        for it in items:
            if not isinstance(it, dict):
                continue
            desc = _get(it, "описание", "риск", "description", "risk")
            p = _get(it, "пункт", "reference", "Пункт")
            if desc and p:
                lines.append(f"- {desc} (п. {p})")
            elif desc:
                lines.append(f"- {desc}")

    def compact_ambiguities(items: Any):
        if not isinstance(items, list):
            return
        for it in items:
            if not isinstance(it, dict):
                continue
            text = _get(it, "формулировка", "text", "Формулировка")
            why = _get(it, "почему_опасно", "concern", "Почему_опасно")
            p = _get(it, "пункт", "reference", "Пункт")
            s = f"- {text}" if text else "-"
            if why:
                s += f" — {why}"
            if p:
                s += f" (п. {p})"
            lines.append(s)

    def compact_fixes(items: Any):
        if not isinstance(items, list):
            return
        for it in items:
            if not isinstance(it, dict):
                continue
            what = _get(it, "что_изменить", "what_to_change")
            how = _get(it, "как_сформулировать", "how_to_phrase")
            p = _get(it, "пункт", "reference", "Пункт")
            s = f"- {what}" if what else "-"
            if how:
                s += f". {how}"
            if p:
                s += f" (п. {p})"
            lines.append(s)

    def simple_list(title: str, key: str):
        val = analysis.get(key)
        if not val:
            return
        section(title)
        lines.extend(format_section(val))
        blank()

    simple_list("Краткое резюме", "summary")
    simple_list("Ключевые условия", "key_terms")

    if analysis.get("risks"):
        section("Риски")
        compact_risks(analysis.get("risks"))
        blank()

    if analysis.get("ambiguities"):
        section("Неоднозначные формулировки")
        compact_ambiguities(analysis.get("ambiguities"))
        blank()

    if analysis.get("fixes"):
        section("Что стоит поправить")
        compact_fixes(analysis.get("fixes"))
        blank()

    simple_list("Вопросы к контрагенту", "questions")
    simple_list("Вердикт", "verdict")

    danger_score = analysis.get("danger_score")
    if danger_score is not None and danger_score != "":
        lines.append(f"Оценка безопасности: {danger_score}/100")

    return "\n".join(lines).strip()


def _pdf_write_wrapped(pdf: FPDF, text: str, width: float, line_h: float) -> None:
    """
    Пишет текст в PDF с переносом строк по словам, БЕЗ multi_cell (чтобы не было justify-разъезда).
    """
    if text is None:
        pdf.ln(line_h)
        return

    # нормализуем пробелы/табы
    raw_lines = str(text).replace("\t", "    ").splitlines() or [""]

    for raw in raw_lines:
        line = raw.rstrip("\r")

        # пустая строка
        if not line.strip():
            pdf.ln(line_h)
            continue

        words = line.split(" ")
        cur = ""

        for w in words:
            if cur == "":
                candidate = w
            else:
                candidate = cur + " " + w

            if pdf.get_string_width(candidate) <= width:
                cur = candidate
            else:
                # печатаем накопленное и начинаем новую строку
                pdf.cell(width, line_h, cur, ln=1, align="L")
                cur = w

        if cur != "":
            pdf.cell(width, line_h, cur, ln=1, align="L")


def generate_analysis_pdf(doc_id: str, idx: int, party_name: str, party_role: str, analysis: dict) -> Path:
    doc_dir = STORAGE_ROOT / doc_id
    doc_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = doc_dir / f"analysis_{idx}.pdf"

    text = analysis_to_plaintext(party_name, party_role, analysis)

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.set_margins(15, 15, 15)
    pdf.add_page()

    # --- шрифты ---
    base_font = "Arial"
    has_bold = False

    if PDF_FONT_PATH.exists():
        pdf.add_font(PDF_FONT_NAME, "", str(PDF_FONT_PATH), uni=True)
        base_font = PDF_FONT_NAME

        if PDF_FONT_BOLD_PATH.exists():
            pdf.add_font(PDF_FONT_NAME, "B", str(PDF_FONT_BOLD_PATH), uni=True)
            has_bold = True

    base_size = 12
    header_size = base_size + 1

    usable_width = pdf.w - pdf.l_margin - pdf.r_margin
    if usable_width <= 0:
        usable_width = 180

    line_h = 7.0
    header_h = 8.0

    # ВАЖНО: перед расчётом ширины текста должен быть установлен шрифт
    pdf.set_font(base_font, "", base_size)

    for line in text.split("\n"):
        line = (line or "").replace("\t", "    ")
        stripped = line.strip().rstrip(":")

        if stripped in PDF_SECTION_TITLES:
            pdf.ln(2)

            if has_bold:
                pdf.set_font(base_font, "B", header_size)
            else:
                pdf.set_font(base_font, "", header_size)

            _pdf_write_wrapped(pdf, line, usable_width, header_h)

            pdf.set_font(base_font, "", base_size)
        else:
            _pdf_write_wrapped(pdf, line, usable_width, line_h)

    pdf.output(str(pdf_path))
    return pdf_path


# ================== DB: USERS / BILLING ==================
def _get_or_create_user_for_telegram(telegram_id: str, tg_name: str | None) -> User:
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.telegram_id == telegram_id).first()
        if user:
            return user

        technical_email = f"tg_{telegram_id}@example.local"
        user = User(
            name=tg_name or "",
            email=technical_email,
            password=None,
            google_id=None,
            telegram_id=telegram_id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        logger.info("Created telegram-only user id=%s telegram_id=%s", user.id, telegram_id)
        return user
    finally:
        db.close()


def _get_user_by_telegram(telegram_id: str) -> Optional[User]:
    db = SessionLocal()
    try:
        return db.query(User).filter(User.telegram_id == telegram_id).first()
    finally:
        db.close()


def _is_subscription_active(u: User) -> bool:
    today = date.today()
    return bool((u.subscription_end and u.subscription_end >= today) or u.has_subscription)


def _credits_int(u: User) -> int:
    val = u.balance or Decimal(0)
    if not isinstance(val, Decimal):
        val = Decimal(val)
    return int(val)


def _format_balance_text(u: User) -> str:
    active = _is_subscription_active(u)
    sub_until = u.subscription_end.strftime("%d.%m.%Y") if u.subscription_end else "—"
    credits = _credits_int(u)

    return "\n".join(
        [
            "💳 Баланс аккаунта",
            "",
            f"Подписка активна: {'да' if active else 'нет'}",
            f"Подписка до: {sub_until if active else 'подписка не активна'}",
            f"Разовые запросы (кредиты): {credits}",
        ]
    )


def _deduct_one_credit(telegram_id: str) -> tuple[Optional[User], bool]:
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.telegram_id == telegram_id).first()
        if not user:
            return None, False

        bal = user.balance or Decimal(0)
        if not isinstance(bal, Decimal):
            bal = Decimal(bal)

        credits = int(bal)
        if credits <= 0:
            return user, False

        user.balance = bal - Decimal(1)
        db.add(user)
        db.commit()
        db.refresh(user)
        return user, True
    finally:
        db.close()


def _save_analysis_to_disk(doc_id: str, idx: int, party_name: str, party_role: str, analysis: dict) -> None:
    doc_dir = STORAGE_ROOT / doc_id
    doc_dir.mkdir(parents=True, exist_ok=True)
    payload = {"selected_party": {"name": party_name, "role": party_role}, "analysis": analysis}
    path = doc_dir / f"results_{idx}.json"
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def _backend_post(path: str, payload: dict) -> dict:
    if not BOT_BACKEND_BASE_URL:
        raise RuntimeError("BOT_BACKEND_BASE_URL не задан в .env (пример: https://aimir.tech/tg-bot)")

    url = f"{BOT_BACKEND_BASE_URL}{path}"

    s = requests.Session()
    s.trust_env = False  # <-- игнорируем HTTP_PROXY/HTTPS_PROXY для этого запроса

    r = s.post(url, json=payload, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"bot_backend error {r.status_code}: {r.text}")
    return r.json() if r.content else {}


def _create_payment_subscribe(telegram_id: str, plan: str) -> dict:
    return _backend_post("/pay/subscribe", {"telegram_id": telegram_id, "plan": plan})


def _create_payment_credits(telegram_id: str, quantity: int) -> dict:
    return _backend_post("/pay/credits", {"telegram_id": telegram_id, "quantity": int(quantity)})


# ================== UI KEYBOARDS ==================
def _main_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton("Баланс"), KeyboardButton("➕ Пополнить")],
        ],
        resize_keyboard=True
    )


def _topup_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton(f"1 месяц — {int(PRICE_SUB_MONTH)}₽")],
            [KeyboardButton(f"6 месяцев — {int(PRICE_SUB_6M)}₽")],
            [KeyboardButton(f"1 год — {int(PRICE_SUB_YEAR)}₽")],
            [KeyboardButton(f"Запросы ({int(PRICE_REQUEST)}₽/шт)")],
            [KeyboardButton("⬅️ Назад")],
        ],
        resize_keyboard=True
    )


def _credits_qty_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton("1"), KeyboardButton("2"), KeyboardButton("5"), KeyboardButton("10")],
            [KeyboardButton("⬅️ Назад")],
        ],
        resize_keyboard=True
    )


# ================== HANDLERS ==================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    tg = update.effective_user
    if tg:
        _get_or_create_user_for_telegram(str(tg.id), tg.first_name)

    telegram_id = str(tg.id) if tg else "—"

    await update.message.reply_text(
        "Привет! Пришли мне договор в формате PDF, DOC или DOCX.\n"
        "Я сохраню файл, извлеку текст, определю стороны и проанализирую договор.\n\n"
        f"🆔 Ваш Telegram ID: <code>{telegram_id}</code>\n"
        "Можете вставить этот ID на сайте, чтобы связать аккаунты.",
        reply_markup=_main_keyboard(),
        parse_mode="HTML",
    )


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    1) Кнопка "Баланс"
    2) Кнопка "➕ Пополнить"
    3) Кнопки меню пополнения
    4) Ожидание ввода количества запросов
    """
    msg = update.message
    if not msg or not msg.text:
        return

    tg = update.effective_user
    if not tg:
        return

    text = msg.text.strip()

    # --- режим ожидания количества кредитов ---
    if context.user_data.get(UD_AWAITING_CREDITS_QTY):
        # дать выйти назад
        if text == "⬅️ Назад":
            context.user_data[UD_AWAITING_CREDITS_QTY] = False
            await msg.reply_text("Ок, вернулся в меню.", reply_markup=_main_keyboard())
            return

        try:
            qty = int(text)
        except Exception:
            await msg.reply_text(
                "Нужно ввести целое число (например 3) или нажать кнопку 1/2/5/10.",
                reply_markup=_credits_qty_keyboard(),
            )
            return

        if qty <= 0 or qty > 100000:
            await msg.reply_text("Количество должно быть больше 0. Попробуй ещё раз.", reply_markup=_credits_qty_keyboard())
            return

        context.user_data[UD_AWAITING_CREDITS_QTY] = False

        try:
            resp = _create_payment_credits(str(tg.id), qty)
            pay_url = resp.get("payment_url")
            amount = resp.get("amount_rub")
        except Exception as e:
            logger.exception("create credits payment failed")
            await msg.reply_text(f"Ошибка создания оплаты: {e}", reply_markup=_main_keyboard())
            return

        if not pay_url:
            await msg.reply_text("Не удалось получить ссылку на оплату.", reply_markup=_main_keyboard())
            return

        await msg.reply_text(
            f"💳 Ссылка на оплату запросов: {qty} шт.\n"
            f"Сумма: {amount} ₽\n\n"
            f"{pay_url}\n\n"
            "После успешной оплаты баланс обновится автоматически.",
            reply_markup=_main_keyboard(),
        )
        return

    # --- обработка reply-кнопок ---

    # Кнопка "Баланс"
    if text.lower() == "баланс":
        user = _get_or_create_user_for_telegram(str(tg.id), tg.first_name)
        await msg.reply_text(_format_balance_text(user), reply_markup=_main_keyboard())
        return

    # Кнопка "➕ Пополнить"
    if text == "➕ Пополнить":
        context.user_data[UD_AWAITING_CREDITS_QTY] = False
        await msg.reply_text("Выбери вариант пополнения:", reply_markup=_topup_keyboard())
        return

    # Кнопка "⬅️ Назад"
    if text == "⬅️ Назад":
        context.user_data[UD_AWAITING_CREDITS_QTY] = False
        await msg.reply_text("Ок, вернулся в меню.", reply_markup=_main_keyboard())
        return

    # Кнопка "1 месяц — X₽"
    if text == f"1 месяц — {int(PRICE_SUB_MONTH)}₽":
        try:
            resp = _create_payment_subscribe(str(tg.id), "month")
            pay_url = resp.get("payment_url")
            amount = resp.get("amount_rub")
        except Exception as e:
            logger.exception("create subscribe payment failed")
            await msg.reply_text(f"Ошибка создания оплаты: {e}", reply_markup=_main_keyboard())
            return

        if not pay_url:
            await msg.reply_text("Не удалось получить ссылку на оплату.", reply_markup=_main_keyboard())
            return

        await msg.reply_text(
            f"💳 Ссылка на оплату подписки: 1 месяц\n"
            f"Сумма: {amount} ₽\n\n"
            f"{pay_url}\n\n"
            "После успешной оплаты подписка активируется автоматически.",
            reply_markup=_main_keyboard(),
        )
        return

    # Кнопка "6 месяцев — X₽"
    if text == f"6 месяцев — {int(PRICE_SUB_6M)}₽":
        try:
            resp = _create_payment_subscribe(str(tg.id), "6m")
            pay_url = resp.get("payment_url")
            amount = resp.get("amount_rub")
        except Exception as e:
            logger.exception("create subscribe payment failed")
            await msg.reply_text(f"Ошибка создания оплаты: {e}", reply_markup=_main_keyboard())
            return

        if not pay_url:
            await msg.reply_text("Не удалось получить ссылку на оплату.", reply_markup=_main_keyboard())
            return

        await msg.reply_text(
            f"💳 Ссылка на оплату подписки: 6 месяцев\n"
            f"Сумма: {amount} ₽\n\n"
            f"{pay_url}\n\n"
            "После успешной оплаты подписка активируется автоматически.",
            reply_markup=_main_keyboard(),
        )
        return

    # Кнопка "1 год — X₽"
    if text == f"1 год — {int(PRICE_SUB_YEAR)}₽":
        try:
            resp = _create_payment_subscribe(str(tg.id), "year")
            pay_url = resp.get("payment_url")
            amount = resp.get("amount_rub")
        except Exception as e:
            logger.exception("create subscribe payment failed")
            await msg.reply_text(f"Ошибка создания оплаты: {e}", reply_markup=_main_keyboard())
            return

        if not pay_url:
            await msg.reply_text("Не удалось получить ссылку на оплату.", reply_markup=_main_keyboard())
            return

        await msg.reply_text(
            f"💳 Ссылка на оплату подписки: 1 год\n"
            f"Сумма: {amount} ₽\n\n"
            f"{pay_url}\n\n"
            "После успешной оплаты подписка активируется автоматически.",
            reply_markup=_main_keyboard(),
        )
        return

    # Кнопка "Запросы (X₽/шт)"
    if text == f"Запросы ({int(PRICE_REQUEST)}₽/шт)":
        context.user_data[UD_AWAITING_CREDITS_QTY] = True
        await msg.reply_text(
            f"Сколько запросов купить? Можно нажать кнопку или написать число.\n"
            f"1 запрос = {int(PRICE_REQUEST)}₽.",
            reply_markup=_credits_qty_keyboard(),
        )
        return


async def handle_document(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.message
    if not message or not message.document:
        return

    tg = update.effective_user
    if tg:
        _get_or_create_user_for_telegram(str(tg.id), tg.first_name)

    doc = message.document
    file_name = doc.file_name or "document"
    lower_name = file_name.lower()

    if not (lower_name.endswith(".pdf") or lower_name.endswith(".doc") or lower_name.endswith(".docx")):
        await message.reply_text("Поддерживаю только файлы .pdf, .doc, .docx.", reply_markup=_main_keyboard())
        return

    await message.reply_text("Файл получил, извлекаю текст...", reply_markup=_main_keyboard())

    tg_file = await doc.get_file()

    suffix = Path(file_name).suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp_path = Path(tmp.name)

    try:
        await tg_file.download_to_drive(custom_path=str(tmp_path))
        text = extract_text(tmp_path)

        if not text.strip():
            await message.reply_text("Не удалось извлечь текст из файла 😔", reply_markup=_main_keyboard())
            return

        doc_id = str(uuid.uuid4())
        doc_dir = STORAGE_ROOT / doc_id
        doc_dir.mkdir(parents=True, exist_ok=True)

        orig_ext = tmp_path.suffix or Path(file_name).suffix
        orig_path = doc_dir / f"file{orig_ext}"
        # shutil.move вместо rename: /tmp может быть на другой файловой системе
        shutil.move(str(tmp_path), str(orig_path))

        (doc_dir / "text.txt").write_text(text, encoding="utf-8")

        await message.reply_text(
            "Текст успешно извлечён и сохранён.\n"
            f"ID документа: {doc_id}\n"
            "Определяю стороны договора...",
            reply_markup=_main_keyboard(),
        )

        parties = call_gpt_identify_parties(text)
        if not parties:
            await message.reply_text("Не удалось определить стороны договора.", reply_markup=_main_keyboard())
            return

        PARTY_CACHE[(message.chat_id, doc_id)] = parties

        keyboard_rows: List[List[InlineKeyboardButton]] = []
        for idx, p in enumerate(parties):
            display_name = p.get("name") or p.get("role") or f"Сторона {idx + 1}"
            keyboard_rows.append([InlineKeyboardButton(text=display_name, callback_data=f"party|{doc_id}|{idx}")])

        await message.reply_text(
            "Выбери сторону, от имени которой будем анализировать договор:",
            reply_markup=InlineKeyboardMarkup(keyboard_rows),
        )

    except Exception as e:
        logger.exception("Error while processing document")
        await message.reply_text(f"Произошла ошибка при обработке файла: {e}", reply_markup=_main_keyboard())
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except Exception:
            pass


async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query:
        return
    await query.answer()
    data = query.data or ""

    # ================== ВЫБОР СТОРОНЫ / АНАЛИТИКА ==================
    if data.startswith("party|"):
        try:
            _, doc_id, idx_str = data.split("|", 2)
            idx = int(idx_str)
        except Exception:
            await query.edit_message_text("Некорректные данные кнопки.")
            return

        chat_id = query.message.chat_id if query.message else None
        if chat_id is None:
            await query.edit_message_text("Ошибка: не найден чат.")
            return

        parties = PARTY_CACHE.get((chat_id, doc_id))
        if not parties or not (0 <= idx < len(parties)):
            await query.edit_message_text("Не удалось найти выбранную сторону. Попробуй отправить файл заново.")
            return

        selected = parties[idx]
        name = selected.get("name") or selected.get("role") or f"Сторона {idx + 1}"
        role = selected.get("role") or ""

        await query.edit_message_text(f"Вы выбрали сторону: {name}\nЗапускаю анализ...")

        text_path = STORAGE_ROOT / doc_id / "text.txt"
        if not text_path.exists():
            await query.message.reply_text("Не удалось найти сохранённый текст договора.",
                                           reply_markup=_main_keyboard())
            return

        full_text = text_path.read_text(encoding="utf-8", errors="ignore")
        try:
            analysis = call_gpt_full_analysis(full_text, name)
        except Exception as e:
            logger.exception("Full analysis failed")
            await query.message.reply_text(
                f"Не удалось выполнить анализ: {e}\nПопробуйте ещё раз чуть позже.",
                reply_markup=_main_keyboard(),
            )
            return
        _save_analysis_to_disk(doc_id, idx, name, role, analysis)

        tg_user = update.effective_user
        if not tg_user:
            preview_text = format_preview_for_telegram(analysis, has_credits=False)
            await query.message.reply_text(preview_text, parse_mode="HTML", reply_markup=_main_keyboard())
            return

        telegram_id = str(tg_user.id)
        user = _get_or_create_user_for_telegram(telegram_id, tg_user.first_name)

        has_sub = _is_subscription_active(user)
        credits = _credits_int(user)

        if has_sub:
            try:
                pdf_path = generate_analysis_pdf(doc_id, idx, name, role, analysis)
            except Exception:
                logger.exception("PDF generation failed")
                await query.message.reply_text(
                    "Анализ готов, но не удалось сформировать PDF. Попробуйте ещё раз позже.",
                    reply_markup=_main_keyboard(),
                )
                return
            await query.message.reply_text("Подписка активна — отправляю полный отчёт PDF.",
                                           reply_markup=_main_keyboard())
            with pdf_path.open("rb") as f:
                await query.message.reply_document(document=f, filename=f"analysis_{idx + 1}.pdf")
            return

        if credits <= 0:
            preview_text = format_preview_for_telegram(analysis, has_credits=False)
            await query.message.reply_text(preview_text, parse_mode="HTML", reply_markup=_main_keyboard())
            return

        preview_text = format_preview_for_telegram(analysis, has_credits=True)
        unlock_keyboard = InlineKeyboardMarkup(
            [[InlineKeyboardButton("🔓 Разблокировать полный анализ (−1 запрос)",
                                   callback_data=f"unlock|{doc_id}|{idx}")]]
        )
        await query.message.reply_text(preview_text, parse_mode="HTML", reply_markup=unlock_keyboard)
        return

    if data.startswith("unlock|"):
        try:
            _, doc_id, idx_str = data.split("|", 2)
            idx = int(idx_str)
        except Exception:
            await query.edit_message_text("Некорректные данные кнопки разблокировки.")
            return

        tg_user = update.effective_user
        if not tg_user:
            await query.message.reply_text("Не удалось определить пользователя Telegram.",
                                           reply_markup=_main_keyboard())
            return

        user, ok = _deduct_one_credit(str(tg_user.id))
        if not user:
            await query.message.reply_text("Не удалось найти аккаунт. Отправь документ ещё раз.",
                                           reply_markup=_main_keyboard())
            return
        if not ok:
            await query.message.reply_text(
                "Недостаточно запросов. Пополни баланс: Баланс → Пополнить.",
                reply_markup=_main_keyboard(),
            )
            return

        results_path = STORAGE_ROOT / doc_id / f"results_{idx}.json"
        if not results_path.exists():
            await query.message.reply_text("Не найден сохранённый анализ. Загрузите договор заново.",
                                           reply_markup=_main_keyboard())
            return

        saved = json.loads(results_path.read_text(encoding="utf-8"))
        selected_party = saved.get("selected_party") or {}
        name = selected_party.get("name") or f"Сторона {idx + 1}"
        role = selected_party.get("role") or ""
        analysis = saved.get("analysis", saved)

        try:
            pdf_path = generate_analysis_pdf(doc_id, idx, name, role, analysis)
        except Exception:
            logger.exception("PDF generation failed (unlock)")
            await query.message.reply_text(
                "Не удалось сформировать PDF. Напишите в поддержку — запрос не потерян.",
                reply_markup=_main_keyboard(),
            )
            return
        await query.message.reply_text("✅ Разблокировано. Отправляю PDF.", reply_markup=_main_keyboard())
        with pdf_path.open("rb") as f:
            await query.message.reply_document(document=f, filename=f"analysis_{idx + 1}.pdf")
        return


# ================== RUN ==================
def main() -> None:
    if not TELEGRAM_BOT_TOKEN:
        raise RuntimeError("TELEGRAM_BOT_TOKEN не найден в окружении (.env)")
    if not (os.getenv("ANTHROPIC_API_KEY_1") or os.getenv("ANTHROPIC_API_KEY")):
        logger.warning("ANTHROPIC_API_KEY_1 не найден — AI-вызовы не будут работать")
    if not BOT_BACKEND_BASE_URL:
        logger.warning("BOT_BACKEND_BASE_URL не задан — оплата работать не будет")

    logger.info("Starting bot...")
    app = Application.builder().token(TELEGRAM_BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    app.add_handler(MessageHandler(filters.Document.ALL, handle_document))
    app.add_handler(CallbackQueryHandler(handle_callback))

    app.run_polling()


if __name__ == "__main__":
    main()
