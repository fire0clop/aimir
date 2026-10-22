import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
    registerStart,
    registerConfirm,
    resendVerification,
} from "../api/users";
import { useAuth } from "../context/AuthContext";
import Mascot from "../components/Mascot";
import styles from "./Register.module.css";

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

    const nav = useNavigate();
    const { refreshUser } = useAuth();

    useEffect(() => {
        let t;
        if (showModal && resendCd > 0) t = setTimeout(() => setResendCd((s) => s - 1), 1000);
        return () => clearTimeout(t);
    }, [showModal, resendCd]);

    useEffect(() => {
        const last = localStorage.getItem("last_email");
        if (last) setEmail(last);
    }, []);

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
            await refreshUser();
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
                <h1 className={styles.cardTitle}>Регистрация</h1>
                <p className={styles.cardSubtitle}>Создайте аккаунт: e-mail и пароль</p>

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

                    <button className={styles.primary} type="submit" disabled={loading}>
                        {loading ? "Отправляем..." : "Зарегистрироваться"}
                    </button>
                </form>

                <div className={styles.switchLink}>
                    Уже есть аккаунт? <Link to="/login">Войти</Link>
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
                <Mascot bubble="Привет! Создадим аккаунт — это займёт минуту" size={260} />
            </aside>
            </div>

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
                                className={styles.codeInput}
                                inputMode="numeric"
                                pattern="\d*"
                                maxLength={6}
                                placeholder="••••••"
                                value={code}
                                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                                autoFocus
                            />

                            {codeErr && <div className={styles.alert}>{codeErr}</div>}
                            {infoMsg && <div className={styles.info}>{infoMsg}</div>}

                            <button
                                className={styles.primary}
                                onClick={onConfirm}
                                disabled={loading || code.length !== 6}
                            >
                                {loading ? "Проверяем..." : "Подтвердить"}
                            </button>

                            <div className={styles.centerRow}>
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
