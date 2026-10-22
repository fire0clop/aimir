// src/pages/Login.jsx
import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
    login,
    resetStart,
    resetResend,
    resetVerify,
    resetComplete,
} from "../api/users";
import { useAuth } from "../context/AuthContext";
import Mascot from "../components/Mascot";
import styles from "./Login.module.css";

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

            <div className={styles.control}>
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
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C5 20 1 12 1 12a21.8 21.8 0 0 1 6.06-7.94" />
                                <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.8 21.8 0 0 1-3.37 4.18" />
                                <line x1="1" y1="1" x2="23" y2="23" />
                            </svg>
                        ) : (
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                                <circle cx="12" cy="12" r="3" />
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

    const nav = useNavigate();
    const { refreshUser } = useAuth();

    // --- reset modal state ---
    const [showReset, setShowReset] = useState(false);
    const [step, setStep] = useState(1);
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

    const onSubmit = async (e) => {
        e.preventDefault();
        setError("");
        try {
            setLoading(true);
            await login({ email: email.trim(), password: pwd });
            await refreshUser();
            remember
                ? localStorage.setItem("last_email", email.trim())
                : localStorage.removeItem("last_email");
            nav("/billing");
        } catch (err) {
            const msg = parseErr(err);
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
        <div className={styles.page}>
            <div className={styles.layout}>
            <div className={styles.cardWrap}>
            <Link to="/" className={styles.brand} aria-label="AiMIR — на главную">
                <span className={styles.logoMark} aria-hidden="true">
                    <span className={styles.logoEye} />
                </span>
                <span className={styles.brandName}>Ai<i>MIR</i></span>
            </Link>
            <main className={styles.card} role="main">
                <h1 className={styles.cardTitle}>Вход</h1>
                <p className={styles.cardSubtitle}>
                    Используйте e-mail и пароль. Если раньше входили через Google —
                    просто введите свой e-mail, пароль не нужен.
                </p>

                <form className={styles.form} onSubmit={onSubmit} noValidate>
                    <InputField
                        name="email"
                        label="Email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                    />

                    <InputField
                        name="pwd"
                        label="Пароль"
                        value={pwd}
                        onChange={(e) => setPwd(e.target.value)}
                        placeholder="Пароль"
                        withEye
                    />

                    <label className={styles.check}>
                        <input
                            type="checkbox"
                            checked={remember}
                            onChange={(e) => setRemember(e.target.checked)}
                        />
                        <span>Запомнить меня</span>
                    </label>

                    {error && <div className={styles.alert}>{error}</div>}

                    <button className={styles.primary} type="submit" disabled={loading}>
                        {loading ? "Входим..." : "Войти"}
                    </button>

                    <div className={styles.centerRow}>
                        <button type="button" className={styles.linkBtn} onClick={openReset}>
                            Забыли пароль?
                        </button>
                    </div>
                </form>

                <div className={styles.switchLink}>
                    Нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
                </div>
            </main>
            <Link to="/" className={styles.backLink}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M19 12H5" />
                    <path d="M12 19l-7-7 7-7" />
                </svg>
                На главную
            </Link>
            </div>
            <aside className={styles.mascotCol} aria-hidden="true">
                <Mascot bubble="С возвращением! Рад видеть вас снова" size={260} />
            </aside>
            </div>

            {/* ----- МОДАЛКА СБРОСА ПАРОЛЯ ----- */}
            {showReset && (
                <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
                    <div className={styles.modal}>
                        <div className={styles.modalHeader}>
                            <h2 className={styles.modalTitle}>Сброс пароля</h2>
                            <button
                                className={styles.modalClose}
                                onClick={() => setShowReset(false)}
                                aria-label="Закрыть"
                            >
                                ×
                            </button>
                        </div>

                        {step === 1 && (
                            <div className={styles.modalBody}>
                                <p className={styles.modalSubtitle}>
                                    Укажите e-mail, на который зарегистрирован аккаунт.
                                </p>
                                <div className={styles.group}>
                                    <input
                                        className={styles.input}
                                        type="email"
                                        placeholder="you@example.com"
                                        value={rEmail}
                                        onChange={(e) => setREmail(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                                {rErr && <div className={styles.alert}>{rErr}</div>}
                                {rInfo && <div className={styles.info}>{rInfo}</div>}
                                <button className={styles.primary} onClick={onResetStart} disabled={rLoading}>
                                    {rLoading ? "Отправляем..." : "Отправить код"}
                                </button>
                            </div>
                        )}

                        {step === 2 && (
                            <div className={styles.modalBody}>
                                <p className={styles.modalSubtitle}>
                                    Мы отправили 6-значный код на <b>{rEmail}</b>.
                                </p>
                                <input
                                    className={styles.codeInput}
                                    inputMode="numeric"
                                    pattern="\d*"
                                    maxLength={6}
                                    placeholder="••••••"
                                    value={rCode}
                                    onChange={(e) => setRCode(e.target.value.replace(/\D/g, ""))}
                                    autoFocus
                                />
                                {rErr && <div className={styles.alert}>{rErr}</div>}
                                {rInfo && <div className={styles.info}>{rInfo}</div>}
                                <button
                                    className={styles.primary}
                                    onClick={onResetVerify}
                                    disabled={rLoading || rCode.length !== 6}
                                >
                                    {rLoading ? "Проверяем..." : "Подтвердить код"}
                                </button>
                                <div className={styles.centerRow}>
                                    <button
                                        type="button"
                                        className={styles.linkBtn}
                                        onClick={onResetResend}
                                        disabled={resendCd > 0 || rLoading}
                                    >
                                        {resendCd > 0 ? `Отправить снова (${resendCd}s)` : "Отправить код снова"}
                                    </button>
                                </div>
                            </div>
                        )}

                        {step === 3 && (
                            <div className={styles.modalBody}>
                                <p className={styles.modalSubtitle}>Задайте новый пароль.</p>
                                <div className={styles.group}>
                                    <input
                                        className={styles.input}
                                        type="password"
                                        placeholder="Новый пароль"
                                        value={rPwd1}
                                        onChange={(e) => setRPwd1(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                                <div className={styles.group}>
                                    <input
                                        className={styles.input}
                                        type="password"
                                        placeholder="Повторите пароль"
                                        value={rPwd2}
                                        onChange={(e) => setRPwd2(e.target.value)}
                                    />
                                </div>
                                {rErr && <div className={styles.alert}>{rErr}</div>}
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
