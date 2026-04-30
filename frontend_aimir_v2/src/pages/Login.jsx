// src/pages/Login.jsx
/* global google */
import React, { useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
    login,
    loginWithGoogle,
    resetStart,
    resetResend,
    resetVerify,
    resetComplete,
    loginWithTelegram,   // ← добавили
} from "../api/users";
import { useAuth } from "../context/AuthContext";
import styles from "./Login.module.css";

import bgUrl from "../assets/images/bg-auth.png";
import logoUrl from "../assets/images/logo.png";

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;
const TELEGRAM_BOT_USERNAME = process.env.REACT_APP_TELEGRAM_BOT_USERNAME; // ← username бота, НЕ токен

/** Универсальное поле ввода */
function InputField({
                        label, name, type = "text", value, onChange, placeholder,
                        error, withEye = false,
                    }) {
    const [show, setShow] = useState(false);
    const effectiveType = withEye ? (show ? "text" : "password") : type;

    return (
        <div className={styles.group}>
            {label && <label className={styles.label} htmlFor={name}>{label}</label>}

            <div className={`${styles.control} ${error ? styles.controlError : ""}`}>
                <input
                    id={name}
                    name={name}
                    className={styles.input}
                    type={effectiveType}
                    value={value}
                    onChange={onChange}
                    placeholder={placeholder}
                    aria-invalid={!!error}
                />
                {withEye && (
                    <button
                        type="button"
                        className={styles.eye}
                        aria-label={show ? "Скрыть пароль" : "Показать пароль"}
                        onClick={() => setShow(s => !s)}
                    >
                        {show ? (
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C5 20 1 12 1 12a21.8 21.8 0 0 1 6.06-7.94"></path>
                                <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.8 21.8 0 0 1-3.37 4.18"></path>
                                <line x1="1" y1="1" x2="23" y2="23"></line>
                            </svg>
                        ) : (
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                        )}
                    </button>
                )}
            </div>

            {error && <div className={styles.msgError}>{error}</div>}
        </div>
    );
}

export default function Login() {
    const [email, setEmail] = useState("");
    const [pwd, setPwd] = useState("");
    const [remember, setRemember] = useState(true);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const [googleLoading, setGoogleLoading] = useState(false);
    const [googleInitError, setGoogleInitError] = useState("");

    const [telegramLoading, setTelegramLoading] = useState(false);          // ← новое
    const [telegramInitError, setTelegramInitError] = useState("");         // ← новое

    const nav = useNavigate();
    const { refreshUser } = useAuth(); // <-- чтобы обновить контекст после логина

    const googleBtnRef = useRef(null);
    const telegramBtnRef = useRef(null);                                    // ← новое

    // --- reset modal state ---
    const [showReset, setShowReset] = useState(false);
    const [step, setStep] = useState(1); // 1-email → 2-code → 3-new pass
    const [rEmail, setREmail] = useState("");
    const [rCode, setRCode] = useState("");
    const [rPwd1, setRPwd1] = useState("");
    const [rPwd2, setRPwd2] = useState("");
    const [rErr, setRErr] = useState("");
    const [rInfo, setRInfo] = useState("");
    const [resendCd, setResendCd] = useState(60);
    const [rLoading, setRLoading] = useState(false);

    useEffect(() => {
        let t;
        if (showReset && step === 2 && resendCd > 0) {
            t = setTimeout(() => setResendCd(s => s - 1), 1000);
        }
        return () => clearTimeout(t);
    }, [showReset, step, resendCd]);

    useEffect(() => {
        const last = localStorage.getItem("last_email");
        if (last) setEmail(last);
    }, []);

    // ---- Инициализация Google Identity Services ----
    useEffect(() => {
        if (!GOOGLE_CLIENT_ID) {
            setGoogleInitError("Google client ID не настроен");
            return;
        }

        function initGoogle() {
            try {
                if (!window.google || !googleBtnRef.current) return;

                window.google.accounts.id.initialize({
                    client_id: GOOGLE_CLIENT_ID,
                    callback: handleCredentialResponse,
                });

                window.google.accounts.id.renderButton(googleBtnRef.current, {
                    type: "standard",
                    theme: "outline",
                    size: "large",
                    text: "continue_with",
                    shape: "pill",
                    logo_alignment: "left",
                });

                // One Tap можно не вызывать, если не нужно:
                // window.google.accounts.id.prompt();
            } catch (e) {
                console.error(e);
                setGoogleInitError("Не удалось инициализировать Google вход");
            }
        }

        const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
        if (!existing) {
            const script = document.createElement("script");
            script.src = "https://accounts.google.com/gsi/client";
            script.async = true;
            script.defer = true;
            script.onload = initGoogle;
            script.onerror = () => setGoogleInitError("Не удалось загрузить скрипт Google");
            document.body.appendChild(script);
        } else {
            if (window.google) initGoogle();
            else existing.addEventListener("load", initGoogle);
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- Инициализация Telegram Login Widget ----
    useEffect(() => {
        if (!TELEGRAM_BOT_USERNAME) {
            setTelegramInitError("Telegram бот не настроен");
            return;
        }

        // Глобальный callback, который вызывается виджетом Telegram после успешного логина
        window.onTelegramAuth = async function (user) {
            console.log("🔥 Telegram onAuth payload:", user);
            try {
                setError("");
                setTelegramLoading(true);
                // user = { id, first_name, last_name?, username?, photo_url?, auth_date, hash }
                await loginWithTelegram(user);
                await refreshUser();
                nav("/billing");
            } catch (err) {
                const msg = parseErr(err);
                setError(msg || "Не удалось войти через Telegram");
            } finally {
                setTelegramLoading(false);
            }
        };

        function renderTelegramButton() {
            if (!telegramBtnRef.current) return;

            // очищаем контейнер на всякий случай (горячая перезагрузка и т.п.)
            telegramBtnRef.current.innerHTML = "";

            const script = document.createElement("script");
            script.src = "https://telegram.org/js/telegram-widget.js?22";
            script.async = true;
            script.setAttribute("data-telegram-login", TELEGRAM_BOT_USERNAME);
            script.setAttribute("data-size", "large");
            script.setAttribute("data-userpic", "false");
            script.setAttribute("data-onauth", "onTelegramAuth(user)");
            script.setAttribute("data-request-access", "write");
            telegramBtnRef.current.appendChild(script);
        }

        renderTelegramButton();

        return () => {
            try {
                // чистим глобальную функцию при размонтировании
                // eslint-disable-next-line no-undef
                delete window.onTelegramAuth;
            } catch (_) {}
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function handleCredentialResponse(response) {
        try {
            setError("");
            setGoogleLoading(true);
            const idToken = response?.credential;
            if (!idToken) {
                setError("Не удалось получить токен Google");
                return;
            }
            await loginWithGoogle(idToken);
            await refreshUser();
            nav("/billing");
        } catch (err) {
            const msg = parseErr(err);
            setError(msg || "Не удалось войти через Google");
        } finally {
            setGoogleLoading(false);
        }
    }

    const onSubmit = async (e) => {
        e.preventDefault();
        setError("");
        try {
            setLoading(true);
            await login({ email: email.trim(), password: pwd });
            await refreshUser();                    // <-- обновляем пользователя в контексте
            remember
                ? localStorage.setItem("last_email", email.trim())
                : localStorage.removeItem("last_email");
            nav("/billing");
        } catch (err) {
            const msg = parseErr(err);
            // локализуем
            setError(/invalid credentials/i.test(msg) ? "Неверный e-mail или пароль" : msg);
        } finally {
            setLoading(false);
        }
    };

    // --------- reset: step1 send code -----------
    const openReset = () => {
        setShowReset(true);
        setStep(1);
        setREmail(email || "");
        setRCode(""); setRPwd1(""); setRPwd2("");
        setRErr(""); setRInfo(""); setResendCd(60);
    };

    const onResetStart = async () => {
        setRErr(""); setRInfo("");
        const em = rEmail.trim();
        if (!em) { setRErr("Укажите e-mail"); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { setRErr("Некорректный e-mail"); return; }
        try {
            setRLoading(true);
            await resetStart({ email: em });
            setStep(2);
            setRInfo("Мы отправили 6-значный код на почту. Введите его ниже.");
            setResendCd(60);
        } catch (e) {
            setRErr(parseErr(e) || "Не удалось отправить код");
        } finally {
            setRLoading(false);
        }
    };

    const onResetResend = async () => {
        if (resendCd > 0) return;
        try {
            setRLoading(true);
            await resetResend({ email: rEmail.trim() });
            setRInfo("Новый код отправлен.");
            setResendCd(60);
        } catch (e) {
            const t = parseErr(e);
            setRErr(t.includes("Too many") ? "Слишком часто. Попробуйте позже." : "Не удалось отправить код");
        } finally {
            setRLoading(false);
        }
    };

    const onResetVerify = async () => {
        setRErr(""); setRInfo("");
        const six = rCode.replace(/\D/g, "");
        if (!/^\d{6}$/.test(six)) { setRErr("Введите 6-значный код"); return; }
        try {
            setRLoading(true);
            await resetVerify({ email: rEmail.trim(), code: six });
            setStep(3);
            setRInfo("Код подтверждён. Задайте новый пароль.");
        } catch (e) {
            const t = parseErr(e);
            if (t.includes("Invalid code")) setRErr("Неверный код");
            else if (t.includes("Code expired")) setRErr("Срок действия кода истёк");
            else setRErr("Не удалось подтвердить код");
        } finally {
            setRLoading(false);
        }
    };

    const onResetComplete = async () => {
        setRErr(""); setRInfo("");
        if (!rPwd1) { setRErr("Введите новый пароль"); return; }
        if (rPwd1.length < 6) { setRErr("Минимум 6 символов"); return; }
        if (rPwd1 !== rPwd2) { setRErr("Пароли не совпадают"); return; }
        try {
            setRLoading(true);
            await resetComplete({
                email: rEmail.trim(),
                code: rCode.replace(/\D/g, ""),
                newPassword: rPwd1,
            });
            setRInfo("Пароль обновлён. Теперь вы можете войти.");
            setEmail(rEmail.trim());
            setPwd(rPwd1);
            setTimeout(() => setShowReset(false), 900);
        } catch (e) {
            const t = parseErr(e);
            setRErr(t || "Не удалось обновить пароль");
        } finally {
            setRLoading(false);
        }
    };

    return (
        <div className={styles.page} style={{ backgroundImage: `url(${bgUrl})` }}>
            <main className={styles.card} role="main">
                <div className={styles.top}>
                    <Link to="/" className={styles.back}>
                        <span className={styles.arr}>←</span> На главную
                    </Link>
                </div>

                <header className={styles.header}>
                    <img src={logoUrl} alt="Aimir" className={styles.logo} />
                    <div>
                        <h1 className={styles.title}>Вход в аккаунт</h1>
                        <div className={styles.subtitle}>Используйте e-mail, пароль, Google или Telegram</div>
                    </div>
                </header>

                <nav className={styles.tabs} aria-label="Переключение форм">
                    <span className={`${styles.tab} ${styles.tabActive}`}>Вход</span>
                    <Link to="/register" className={styles.tab}>Регистрация</Link>
                </nav>

                <form className={styles.form} onSubmit={onSubmit} noValidate>
                    <InputField
                        name="email"
                        label="Email"
                        type="email"
                        value={email}
                        onChange={(e)=>setEmail(e.target.value)}
                        placeholder="you@example.com"
                    />

                    <InputField
                        name="pwd"
                        label="Пароль"
                        value={pwd}
                        onChange={(e)=>setPwd(e.target.value)}
                        placeholder="Пароль"
                        withEye
                    />

                    <label className={styles.check}>
                        <input
                            type="checkbox"
                            checked={remember}
                            onChange={(e)=>setRemember(e.target.checked)}
                        />
                        <span>Запомнить меня</span>
                    </label>

                    {error && <div className={styles.alert}>{error}</div>}
                    {googleInitError && <div className={styles.alert}>{googleInitError}</div>}
                    {telegramInitError && <div className={styles.alert}>{telegramInitError}</div>}

                    <button className={styles.primary} type="submit" disabled={loading}>
                        {loading ? "Входим..." : "Войти"}
                    </button>

                    <div className={styles.centerRow}>
                        <button type="button" className={styles.linkBtn} onClick={openReset}>
                            Забыли пароль?
                        </button>
                    </div>

                    <div className={styles.divider}>
                        <span>или</span>
                    </div>

                    {/* Кнопка Google */}
                    <div className={styles.googleStub}>
                        <div ref={googleBtnRef} />
                        {googleLoading && (
                            <div className={styles.googleTextSmall}>
                                Входим через Google...
                            </div>
                        )}
                    </div>

                    {/* Кнопка Telegram */}
                    <div className={styles.telegramStub}>
                        <div ref={telegramBtnRef} />
                        {telegramLoading && (
                            <div className={styles.googleTextSmall}>
                                Входим через Telegram...
                            </div>
                        )}
                    </div>
                </form>
            </main>

            {/* ----- МОДАЛКА СБРОСА ПАРОЛЯ ----- */}
            {showReset && (
                <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
                    <div className={styles.modal}>
                        <div className={styles.modalHeader}>
                            <h2 className={styles.modalTitle}>Сброс пароля</h2>
                            <button className={styles.modalClose} onClick={()=>setShowReset(false)} aria-label="Закрыть">×</button>
                        </div>

                        {step === 1 && (
                            <div className={styles.modalBody}>
                                <p className={styles.modalSubtitle}>Укажите e-mail, на который зарегистрирован аккаунт.</p>
                                <div className={styles.control}>
                                    <input
                                        className={styles.input}
                                        type="email"
                                        placeholder="you@example.com"
                                        value={rEmail}
                                        onChange={(e)=>setREmail(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                                {rErr && <div className={styles.msgError}>{rErr}</div>}
                                {rInfo && <div className={styles.info}>{rInfo}</div>}
                                <button className={styles.primary} onClick={onResetStart} disabled={rLoading}>
                                    {rLoading ? "Отправляем..." : "Отправить код"}
                                </button>
                            </div>
                        )}

                        {step === 2 && (
                            <div className={styles.modalBody}>
                                <p className={styles.modalSubtitle}>Мы отправили 6-значный код на <b>{rEmail}</b>.</p>
                                <input
                                    className={styles.codeInput}
                                    inputMode="numeric"
                                    pattern="\d*"
                                    maxLength={6}
                                    placeholder="••••••"
                                    value={rCode}
                                    onChange={(e)=>setRCode(e.target.value.replace(/\D/g, ""))}
                                    autoFocus
                                />
                                {rErr && <div className={styles.msgError}>{rErr}</div>}
                                {rInfo && <div className={styles.info}>{rInfo}</div>}
                                <button
                                    className={styles.primary}
                                    onClick={onResetVerify}
                                    disabled={rLoading || rCode.length !== 6}
                                >
                                    {rLoading ? "Проверяем..." : "Подтвердить код"}
                                </button>
                                <button
                                    type="button"
                                    className={styles.linkBtn}
                                    onClick={onResetResend}
                                    disabled={resendCd > 0 || rLoading}
                                >
                                    {resendCd > 0 ? `Отправить снова (${resendCd}s)` : "Отправить код снова"}
                                </button>
                            </div>
                        )}

                        {step === 3 && (
                            <div className={styles.modalBody}>
                                <p className={styles.modalSubtitle}>Задайте новый пароль.</p>
                                <div className={styles.control}>
                                    <input
                                        className={styles.input}
                                        type="password"
                                        placeholder="Новый пароль"
                                        value={rPwd1}
                                        onChange={(e)=>setRPwd1(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                                <div className={styles.control}>
                                    <input
                                        className={styles.input}
                                        type="password"
                                        placeholder="Повторите пароль"
                                        value={rPwd2}
                                        onChange={(e)=>setRPwd2(e.target.value)}
                                    />
                                </div>
                                {rErr && <div className={styles.msgError}>{rErr}</div>}
                                {rInfo && <div className={styles.info}>{rInfo}</div>}
                                <button className={styles.primary} onClick={onResetComplete} disabled={rLoading}>
                                    {rLoading ? "Сохраняем..." : "Сохранить пароль"}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function parseErr(e) {
    try {
        const t = e?.message || "";
        if (t.startsWith("{")) { const j = JSON.parse(t); return j.detail || t; }
        return t || "Request failed";
    } catch { return "Request failed"; }
}
