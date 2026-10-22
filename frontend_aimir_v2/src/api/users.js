// src/api/users.js
import { http } from "./http";

/* ==================== РЕГИСТРАЦИЯ (2 шага) ==================== */

/** Шаг 1: запрос кода на e-mail */
export async function registerStart({ name, email, password }) {
    const res = await http.post("/users/register/start", { name, email, password });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { detail: "Verification code sent" }
}

/** Шаг 2: подтверждение кода → получаем токены и сразу сохраняем */
export async function registerConfirm({ email, code }) {
    const res = await http.post("/users/register/confirm", { email, code });
    if (!res.ok) throw new Error(await res.text());
    const tokens = await res.json();
    http.setTokens(tokens);
    return tokens;
}

/** Повторная отправка кода (регистрация) */
export async function resendVerification({ email }) {
    const res = await http.post("/users/register/resend", { email });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { detail: "Verification code re-sent" }
}

/* ==================== АВТОРИЗАЦИЯ ==================== */

export async function login({ email, password }) {
    const res = await http.post("/users/login", { email, password });
    if (!res.ok) throw new Error(await res.text());
    const tokens = await res.json();
    http.setTokens(tokens);
    return tokens;
}

export async function me() {
    const res = await http.get("/users/me");
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

/* ------------------------------------------------------------------
   (необязательный) Шорткат для старого кода:
   register(...) теперь делает только ШАГ 1 и возвращает detail.
------------------------------------------------------------------- */
export async function register({ name, email, password }) {
    return registerStart({ name, email, password });
}

/* ==================== СБРОС ПАРОЛЯ (3 шага) ==================== */

/** Шаг 1: пользователь вводит e-mail → отправляем код */
export async function resetStart({ email }) {
    const res = await http.post("/users/password/reset/start", { email });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { detail: "If account exists, code sent" }
}

/** Повторная отправка кода (сброс пароля) */
export async function resetResend({ email }) {
    const res = await http.post("/users/password/reset/resend", { email });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { detail: "Code re-sent" } или тот же "If account exists..."
}

/** Шаг 2: проверяем 6-значный код (без смены пароля) */
export async function resetVerify({ email, code }) {
    const res = await http.post("/users/password/reset/verify", { email, code });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { detail: "ok" }
}

/** Шаг 3: задаём новый пароль (код обязателен повторно) */
export async function resetComplete({ email, code, newPassword }) {
    const res = await http.post("/users/password/reset/complete", {
        email,
        code,
        new_password: newPassword,
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { detail: "Password updated" }
}

export function logout() {
    http.setTokens(null);
}


/** Установить / изменить telegram_id */
export async function setTelegramId(telegramId) {
    const res = await http.put("/users/telegram-id", {
        telegram_id: String(telegramId).trim(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { detail, telegram_id } или что ты возвращаешь
}

/** Удалить telegram_id */
export async function deleteTelegramId() {
    const res = await http.del("/users/telegram-id");
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { detail: "Telegram ID removed" }
}

