from pydantic import BaseModel, EmailStr, Field


class TelegramIdUpsert(BaseModel):
    telegram_id: str = Field(min_length=1, max_length=64)

class UserLogin(BaseModel):
    email: EmailStr
    # пустой пароль допустим: старые Google-аккаунты входят только по e-mail
    password: str = ""

class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"

class RefreshIn(BaseModel):
    refresh_token: str


class RegisterStart(BaseModel):
    name: str | None = None
    email: EmailStr
    password: str

class RegisterResend(BaseModel):
    email: EmailStr

class RegisterConfirm(BaseModel):
    email: EmailStr
    code: str

class PasswordStart(BaseModel):
    email: EmailStr

class PasswordResend(BaseModel):
    email: EmailStr

class PasswordVerify(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)

class PasswordComplete(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)
    new_password: str = Field(min_length=6)

