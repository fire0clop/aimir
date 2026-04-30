/* global google */
import React, { useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
    registerStart,
    registerConfirm,
    resendVerification,
    loginWithGoogle,
    loginWithTelegram,
} from "../api/users";
import { useAuth } from "../context/AuthContext";
import styles from "./Register.module.css";

import bgUrl from "../assets/images/bg-auth.png";
import logoUrl from "../assets/images/logo.png";

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;
const TELEGRAM_BOT_USERNAME = process.env.REACT_APP_TELEGRAM_BOT_USERNAME;

/** Универсальное текстовое поле */
function InputField({
                        label,
                        type = "text",
                        value,
                        onChange,
                        placeholder,
                        hint,
                        error,
                        withEye = false,
                        name,
                    }) {
    const [show, setShow] = useState(false);
    const effectiveType = withEye ? (show ? "text" : "password") : type;

    return (
        <div className={styles.group}>
            {label && (
                <label className={styles.label} htmlFor={name}>
                    {label}
                </label>
            )}

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
                    aria-describedby={
                        hint && !error ? `${name}-hint` : error ? `${name}-err` : undefined
                    }
                />

                {withEye && (
                    <button
                        type="button"
                        className={styles.eye}
                        aria-label={show ? "Скрыть пароль" : "Показать пароль"}
                        onClick={() => setShow((s) => !s)}
                        title={show ? "Скрыть пароль" : "Показать пароль"}
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

            {error ? (
                <div className={styles.msgError} id={`${name}-err`}>{error}</div>
            ) : hint ? (
                <div className={styles.msgHint} id={`${name}-hint`}>{hint}</div>
            ) : null}
        </div>
    );
}

export default function Register() {
    const [name, setName] = useState("Иван");
    const [email, setEmail] = useState("");
    const [pwd, setPwd] = useState("");
    const [pwd2, setPwd2] = useState("");
    const [remember, setRemember] = useState(true);

    const [errors, setErrors] = useState({ email: "", pwd: "", pwd2: "", common: "" });

    // модалка подтверждения
    const [showModal, setShowModal] = useState(false);
    const [code, setCode] = useState("");
    const [codeErr, setCodeErr] = useState("");

    const [infoMsg, setInfoMsg] = useState("");
    const [resendCd, setResendCd] = useState(60);
    const [loading, setLoading] = useState(false);

    const [googleLoading, setGoogleLoading] = useState(false);
    const [googleInitError, setGoogleInitError] = useState("");

    const [telegramLoading, setTelegramLoading] = useState(false);
    const [telegramInitError, setTelegramInitError] = useState("");

    const googleBtnRef = useRef(null);
    const telegramBtnRef = useRef(null);

    const nav = useNavigate();
    const { refreshUser } = useAuth();

    useEffect(() => {
        let t;
        if (showModal && resendCd > 0) t = setTimeout(() => setResendCd((s) => s - 1), 1000);
        return () => clearTimeout(t);
    }, [showModal, resendCd]);

    // втащим email из localStorage, если уже сохраняли
    useEffect(() => {
        const last = localStorage.getItem("last_email");
        if (last) setEmail(last);
    }, []);

    // --- инициализация Google-кнопки (как на Login) ---
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
                    text: "signup_with",
                    shape: "pill",
                    logo_alignment: "left",
                });
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

    // --- инициализация Telegram Login Widget (как на Login) ---
    useEffect(() => {
        if (!TELEGRAM_BOT_USERNAME) {
            setTelegramInitError("Telegram бот не настроен");
            return;
        }

        // глобальный callback, который вызывается виджетом Telegram после успешного логина/регистрации
        window.onTelegramAuth = async function (user) {
            console.log("🔥 Telegram onAuth payload:", user);
            try {
                setErrors({ email: "", pwd: "", pwd2: "", common: "" });
                setTelegramLoading(true);
                // user = { id, first_name, last_name?, username?, photo_url?, auth_date, hash }
                await loginWithTelegram(user);
                await refreshUser();
                nav("/billing");
            } catch (err) {
                const msg = parseErr(err);
                setErrors((prev) => ({
                    ...prev,
                    common: msg || "Не удалось войти через Telegram",
                }));
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
            setErrors({ email: "", pwd: "", pwd2: "", common: "" });
            setGoogleLoading(true);

            const idToken = response?.credential;
            if (!idToken) {
                setErrors((p) => ({ ...p, common: "Не удалось получить токен Google" }));
                return;
            }

            await loginWithGoogle(idToken);
            await refreshUser();
            nav("/billing");
        } catch (err) {
            const msg = parseErr(err);
            setErrors((p) => ({ ...p, common: msg || "Не удалось войти через Google" }));
        } finally {
            setGoogleLoading(false);
        }
    }

    const validate = () => {
        const e = { email: "", pwd: "", pwd2: "", common: "" };
        if (!email) e.email = "Укажите e-mail";
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Некорректный e-mail";

        if (!pwd) e.pwd = "Введите пароль";
        else if (pwd.length < 6) e.pwd = "Минимум 6 символов";

        if (!pwd2) e.pwd2 = "Повторите пароль";
        else if (pwd && pwd2 && pwd !== pwd2) e.pwd2 = "Пароли не совпадают";

        setErrors(e);
        return !e.email && !e.pwd && !e.pwd2;
    };

    const onSubmit = async (e) => {
        e.preventDefault();
        setErrors({ email: "", pwd: "", pwd2: "", common: "" });
        if (!validate()) return;

        try {
            setLoading(true);
            await registerStart({ name: name.trim(), email: email.trim(), password: pwd });
            if (remember) localStorage.setItem("last_email", email.trim());
            setShowModal(true);
            setResendCd(60);
            setCode("");
            setCodeErr("");
            setInfoMsg("Мы отправили 6-значный код на почту. Введите его ниже.");
        } catch (err) {
            const msg = parseErr(err);
            if (/email already registered/i.test(msg)) {
                setErrors((p) => ({ ...p, email: "Такой e-mail уже зарегистрирован" }));
            } else {
                setErrors((p) => ({ ...p, common: msg || "Не удалось отправить код" }));
            }
        } finally {
            setLoading(false);
        }
    };

    const onConfirm = async () => {
        setCodeErr("");
        setInfoMsg("");
        const six = code.replace(/\D/g, "");
        if (!/^\d{6}$/.test(six)) {
            setCodeErr("Введите 6-значный код");
            return;
        }

        try {
            setLoading(true);
            await registerConfirm({ email: email.trim(), code: six });
            await refreshUser();                   // сразу подтянем пользователя в шапку
            setShowModal(false);
            nav("/billing");
        } catch (e) {
            const t = parseErr(e);
            if (/invalid code/i.test(t)) setCodeErr("Неверный код");
            else if (/code expired/i.test(t)) setCodeErr("Срок действия кода истёк");
            else setCodeErr("Не удалось подтвердить код");
        } finally {
            setLoading(false);
        }
    };

    const onResend = async () => {
        if (resendCd > 0) return;
        try {
            setLoading(true);
            await resendVerification({ email: email.trim() });
            setResendCd(60);
            setInfoMsg("Новый код отправлен на почту");
        } catch (e) {
            const t = parseErr(e);
            setCodeErr(/too many/i.test(t) ? "Слишком часто. Попробуйте позже." : "Не удалось отправить код");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.page} style={{ backgroundImage: `url(${bgUrl})` }}>
            <main className={styles.card} role="main">
                <div className={styles.top}>
                    <Link to="/login" className={styles.back}>
                        <span className={styles.arr}>←</span> На главную
                    </Link>
                </div>

                <header className={styles.header}>
                    <img src={logoUrl} alt="Aimir" className={styles.logo} />
                    <div><h1 className={styles.title}>Создать аккаунт</h1></div>
                </header>

                <nav className={styles.tabs} aria-label="Переключение форм">
                    <Link to="/login" className={styles.tab}>Вход</Link>
                    <span className={`${styles.tab} ${styles.tabActive}`}>Регистрация</span>
                </nav>

                <form className={styles.form} onSubmit={onSubmit} noValidate>
                    <InputField
                        name="name"
                        label="Имя (опционально)"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Иван"
                    />

                    <InputField
                        name="email"
                        label="Email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        error={errors.email}
                    />

                    <InputField
                        name="pwd"
                        label="Пароль"
                        value={pwd}
                        onChange={(e) => setPwd(e.target.value)}
                        placeholder="Пароль"
                        hint={!errors.pwd ? "Минимум 6 символов" : ""}
                        error={errors.pwd}
                        withEye
                    />

                    <InputField
                        name="pwd2"
                        label="Повторите пароль"
                        value={pwd2}
                        onChange={(e) => setPwd2(e.target.value)}
                        placeholder="Ещё раз пароль"
                        error={errors.pwd2}
                        withEye
                    />

                    <label className={styles.check}>
                        <input
                            type="checkbox"
                            checked={remember}
                            onChange={(e) => setRemember(e.target.checked)}
                        />
                        <span>Запомнить меня (сохранить e-mail)</span>
                    </label>

                    {errors.common && <div className={styles.alert}>{errors.common}</div>}
                    {googleInitError && <div className={styles.alert}>{googleInitError}</div>}
                    {telegramInitError && <div className={styles.alert}>{telegramInitError}</div>}

                    <button className={styles.primary} type="submit" disabled={loading}>
                        {loading ? "Отправляем..." : "Зарегистрироваться"}
                    </button>

                    <div className={styles.divider}>
                        <span>или</span>
                    </div>

                    {/* Кнопка Google (рендерится скриптом Google внутрь этого div) */}
                    <div className={styles.googleStub}>
                        <div ref={googleBtnRef} />
                        {googleLoading && (
                            <div className={styles.googleTextSmall}>
                                Регистрируем через Google...
                            </div>
                        )}
                    </div>

                    {/* Кнопка Telegram (рендерится Telegram Login Widget внутрь этого div) */}
                    <div className={styles.telegramStub}>
                        <div ref={telegramBtnRef} />
                        {telegramLoading && (
                            <div className={styles.googleTextSmall}>
                                Регистрируем через Telegram...
                            </div>
                        )}
                    </div>

                </form>
            </main>

            {showModal && (
                <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
                    <div className={styles.modal}>
                        <div className={styles.modalHeader}>
                            <h2 className={styles.modalTitle}>Подтверждение e-mail</h2>
                            <button
                                className={styles.modalClose}
                                onClick={() => setShowModal(false)}
                                aria-label="Закрыть"
                            >
                                ×
                            </button>
                        </div>

                        <p className={styles.modalSubtitle}>
                            Мы отправили 6-значный код на <b>{email}</b>
                        </p>

                        <div className={styles.modalBody}>
                            <input
                                className={`${styles.codeInput} ${codeErr ? styles.controlError : ""}`}
                                inputMode="numeric"
                                pattern="\d*"
                                maxLength={6}
                                placeholder="••••••"
                                value={code}
                                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                                autoFocus
                            />

                            {codeErr && <div className={styles.msgError}>{codeErr}</div>}
                            {infoMsg && <div className={styles.info}>{infoMsg}</div>}

                            <button
                                className={styles.primary}
                                onClick={onConfirm}
                                disabled={loading || code.length !== 6}
                            >
                                {loading ? "Проверяем..." : "Подтвердить"}
                            </button>

                            <button
                                type="button"
                                className={styles.linkBtn}
                                onClick={onResend}
                                disabled={resendCd > 0 || loading}
                            >
                                {resendCd > 0 ? `Отправить снова (${resendCd}s)` : "Отправить код снова"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function parseErr(err) {
    try {
        const t = err?.message || "";
        if (t.startsWith("{")) {
            const j = JSON.parse(t);
            return j?.detail || (typeof j === "string" ? j : JSON.stringify(j));
        }
        return t || "Request failed";
    } catch {
        return "Request failed";
    }
}
