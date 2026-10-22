# routers/user.py
from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy.orm import Session
from db import get_db

from models.user import User
from models.verification import PendingRegistration
from models.password_reset import PasswordReset

from schemas.user import (
    UserLogin, TokenPair, RefreshIn,
    RegisterStart, RegisterConfirm, RegisterResend,
    PasswordStart, PasswordResend, PasswordVerify, PasswordComplete,
)

from core.security import hash_password, verify_password, create_token_pair, decode_token
from core.otp import gen_code, now_utc, expires_at
from core.mailer import send_email
from core.config import settings
from core.deps import get_current_user
from schemas.user import TelegramIdUpsert
from sqlalchemy import and_

router = APIRouter(prefix="/users", tags=["users"])

# --- Регистрация: шаг 1 (отправка кода) ----------------------------
@router.post("/register/start", status_code=status.HTTP_200_OK)
def register_start(payload: RegisterStart, db: Session = Depends(get_db)):
    # если пользователь уже создан
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    # удалить предыдущую «ожидающую»
    db.query(PendingRegistration).filter(PendingRegistration.email == payload.email).delete()

    code = gen_code()
    pending = PendingRegistration(
        name=payload.name or "",
        email=payload.email,
        password=hash_password(payload.password),  # сразу хэш
        code=code,
        expires_at=expires_at(),
        created_at=now_utc(),
    )
    db.add(pending)
    db.commit()

    # письмо
    html = f"""
    <div style="font-family:system-ui,Segoe UI,Roboto,Arial">
      <h2>Подтверждение регистрации</h2>
      <p>Ваш код (действует {settings.VERIFICATION_CODE_TTL_MINUTES} минут):</p>
      <div style="font-size:28px;font-weight:700;letter-spacing:6px">{code}</div>
    </div>
    """
    send_email(payload.email, "Aimir: код подтверждения", html, text=f"Код: {code}")
    return {"detail": "Verification code sent"}

# --- Регистрация: повторная отправка кода --------------------------
@router.post("/register/resend", status_code=status.HTTP_200_OK)
def register_resend(payload: RegisterResend, db: Session = Depends(get_db)):
    pr = db.query(PendingRegistration).filter(PendingRegistration.email == payload.email).first()
    if not pr:
        raise HTTPException(status_code=404, detail="No pending registration")

    if pr.resend_count >= settings.MAX_RESEND_PER_HOUR:
        raise HTTPException(status_code=429, detail="Too many resends, try later")

    pr.code = gen_code()
    pr.expires_at = expires_at()
    pr.resend_count += 1
    db.commit()

    html = f"""
    <div style="font-family:system-ui,Segoe UI,Roboto,Arial">
      <h2>Новый код подтверждения</h2>
      <div style="font-size:28px;font-weight:700;letter-spacing:6px">{pr.code}</div>
    </div>
    """
    send_email(pr.email, "Aimir: новый код", html, text=f"Код: {pr.code}")
    return {"detail": "Verification code re-sent"}

# --- Регистрация: шаг 2 (подтверждение кода) -----------------------
@router.post("/register/confirm", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
def register_confirm(payload: RegisterConfirm, db: Session = Depends(get_db)):
    pr = db.query(PendingRegistration).filter(PendingRegistration.email == payload.email).first()
    if not pr:
        raise HTTPException(status_code=404, detail="No pending registration")

    # срок
    if pr.expires_at < now_utc():
        db.delete(pr)
        db.commit()
        raise HTTPException(status_code=400, detail="Code expired")

    # защита от перебора кода
    if pr.attempts >= settings.MAX_CODE_ATTEMPTS:
        db.delete(pr)
        db.commit()
        raise HTTPException(status_code=429, detail="Too many attempts, request a new code")

    # код
    if pr.code != payload.code:
        pr.attempts += 1
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid code")

    # создать пользователя
    user = User(name=pr.name or "", email=pr.email, password=pr.password)
    db.add(user)
    db.delete(pr)
    db.commit()
    db.refresh(user)

    access, refresh = create_token_pair(str(user.id))
    return {"access_token": access, "refresh_token": refresh}

# --- Логин / refresh / me -------------------------
@router.post("/login", response_model=TokenPair)
def login_user(payload: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        raise HTTPException(status_code=401, detail="Неверный e-mail или пароль")

    # Старые Google-аккаунты (google_id есть, пароль так и не задан):
    # вход только по e-mail, пароль не требуется
    if user.google_id and not user.password:
        access, refresh = create_token_pair(str(user.id))
        return {"access_token": access, "refresh_token": refresh}

    if not user.password or not verify_password(payload.password, user.password):
        raise HTTPException(status_code=401, detail="Неверный e-mail или пароль")

    access, refresh = create_token_pair(str(user.id))
    return {"access_token": access, "refresh_token": refresh}

@router.post("/refresh", response_model=TokenPair)
def refresh_tokens(body: RefreshIn, db: Session = Depends(get_db)):
    payload = decode_token(body.refresh_token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    # access-токен нельзя использовать как refresh
    # (старые токены без поля type тоже принимаем — иначе разлогинит всех разом)
    if payload.get("type") not in (None, "refresh"):
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    user_id = payload.get("sub")
    if not user_id or not db.query(User).filter(User.id == user_id).first():
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    access, refresh = create_token_pair(user_id)
    return {"access_token": access, "refresh_token": refresh}

@router.get("/me")
def me(authorization: str = Header(None), db: Session = Depends(get_db)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization.split(" ", 1)[1]
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": str(user.id),
        "name": user.name,
        "email": user.email,
        "telegram_id": user.telegram_id,
    }


@router.post("/password/reset/start", status_code=status.HTTP_200_OK)
def password_reset_start(payload: PasswordStart, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        # не раскрываем, что пользователя нет
        return {"detail": "If account exists, code sent"}

    # удаляем предыдущую запись
    db.query(PasswordReset).filter(PasswordReset.email == payload.email).delete()

    code = gen_code()
    rec = PasswordReset(
        email=payload.email,
        code=code,
        expires_at=expires_at(),
        created_at=now_utc(),
    )
    db.add(rec)
    db.commit()

    html = f"""
    <div style="font-family:system-ui,Segoe UI,Roboto,Arial">
      <h2>Сброс пароля</h2>
      <p>Ваш код (действует {settings.VERIFICATION_CODE_TTL_MINUTES} минут):</p>
      <div style="font-size:28px;font-weight:700;letter-spacing:6px">{code}</div>
    </div>
    """
    send_email(payload.email, "Aimir: код для сброса пароля", html, text=f"Код: {code}")
    return {"detail": "If account exists, code sent"}

@router.post("/password/reset/resend", status_code=status.HTTP_200_OK)
def password_reset_resend(payload: PasswordResend, db: Session = Depends(get_db)):
    rec = db.query(PasswordReset).filter(PasswordReset.email == payload.email).first()
    if not rec:
        # не раскрываем
        return {"detail": "If account exists, code sent"}

    if rec.resend_count >= settings.MAX_RESEND_PER_HOUR:
        raise HTTPException(status_code=429, detail="Too many resends, try later")

    rec.code = gen_code()
    rec.expires_at = expires_at()
    rec.resend_count += 1
    db.commit()

    html = f"""
    <div style="font-family:system-ui,Segoe UI,Roboto,Arial">
      <h2>Новый код для сброса пароля</h2>
      <div style="font-size:28px;font-weight:700;letter-spacing:6px">{rec.code}</div>
    </div>
    """
    send_email(rec.email, "Aimir: новый код для сброса", html, text=f"Код: {rec.code}")
    return {"detail": "Code re-sent"}

@router.post("/password/reset/verify", status_code=status.HTTP_200_OK)
def password_reset_verify(payload: PasswordVerify, db: Session = Depends(get_db)):
    rec = db.query(PasswordReset).filter(PasswordReset.email == payload.email).first()
    if not rec:
        raise HTTPException(status_code=404, detail="No reset request")
    if rec.expires_at < now_utc():
        db.delete(rec); db.commit()
        raise HTTPException(status_code=400, detail="Code expired")
    if rec.attempts >= settings.MAX_CODE_ATTEMPTS:
        db.delete(rec); db.commit()
        raise HTTPException(status_code=429, detail="Too many attempts, request a new code")
    if rec.code != payload.code:
        rec.attempts += 1; db.commit()
        raise HTTPException(status_code=400, detail="Invalid code")
    return {"detail": "ok"}  # фронту достаточно, пароль задаём на следующем шаге

@router.post("/password/reset/complete", status_code=status.HTTP_200_OK)
def password_reset_complete(payload: PasswordComplete, db: Session = Depends(get_db)):
    rec = db.query(PasswordReset).filter(PasswordReset.email == payload.email).first()
    if not rec:
        raise HTTPException(status_code=404, detail="No reset request")
    if rec.expires_at < now_utc():
        db.delete(rec); db.commit()
        raise HTTPException(status_code=400, detail="Code expired")
    if rec.attempts >= settings.MAX_CODE_ATTEMPTS:
        db.delete(rec); db.commit()
        raise HTTPException(status_code=429, detail="Too many attempts, request a new code")
    if rec.code != payload.code:
        rec.attempts += 1; db.commit()
        raise HTTPException(status_code=400, detail="Invalid code")

    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        # редкий случай: пользователь удалён после старта сброса
        db.delete(rec); db.commit()
        return {"detail": "If account exists, password updated"}

    user.password = hash_password(payload.new_password)
    db.delete(rec)
    db.commit()
    return {"detail": "Password updated"}
@router.put("/telegram-id", status_code=200)
def set_telegram_id(
    payload: TelegramIdUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tg = payload.telegram_id.strip()

    # опционально: требуем только цифры (telegram user id обычно числовой)
    if not tg.isdigit():
        raise HTTPException(status_code=400, detail="telegram_id must be numeric")

    # запрет дубликатов: tg не должен принадлежать другому аккаунту
    existing = (
        db.query(User)
        .filter(and_(User.telegram_id == tg, User.id != current_user.id))
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="This telegram_id is already linked to another account")

    current_user.telegram_id = tg
    db.commit()
    db.refresh(current_user)

    return {"detail": "Telegram ID saved", "telegram_id": current_user.telegram_id}
@router.delete("/telegram-id", status_code=200)
def delete_telegram_id(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user.telegram_id = None
    db.commit()
    return {"detail": "Telegram ID removed"}
