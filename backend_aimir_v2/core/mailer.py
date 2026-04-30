# core/mailer.py
import smtplib
import threading
from email.message import EmailMessage
from core.config import settings

def _send(msg: EmailMessage):
    try:
        # короткие таймауты, чтобы не висло
        timeout = 8
        host = settings.SMTP_HOST
        port = settings.SMTP_PORT

        # 465 — чистый SSL; иначе обычный SMTP + STARTTLS (если включён)
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=timeout) as s:
                if settings.SMTP_USER:
                    s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                s.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=timeout) as s:
                if settings.SMTP_TLS:
                    s.starttls()
                if settings.SMTP_USER:
                    s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                s.send_message(msg)
    except Exception as e:
        print(f"[MAILER] fail to send to {msg['To']}: {e}\n---HTML---\n{msg.get_body(preferencelist=('html','plain')).get_content()}\n----------")

def send_email(to: str, subject: str, html: str, text: str | None = None):
    """
    Отправка письма асинхронно (fire-and-forget), чтобы HTTP-ответ не ждал SMTP.
    """
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to
    if text:
        msg.set_content(text)
    else:
        msg.set_content(" ")

    msg.add_alternative(html, subtype="html")

    # отправляем в отдельном потоке, чтобы не блокировать эндпоинт
    t = threading.Thread(target=_send, args=(msg,), daemon=True)
    t.start()
