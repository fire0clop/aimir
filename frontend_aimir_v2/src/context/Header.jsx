import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import css from "./Header.module.css";

const HIDE_ON = new Set(["/login", "/register"]);

export default function Header() {
    const { pathname } = useLocation();
    if (HIDE_ON.has(pathname)) return null;
    return <Bar />;
}

function TgIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path
                d="M21.944 3.143a1 1 0 0 0-1.02-.23L2.427 9.38a1 1 0 0 0 .066 1.913l4.68 1.43 1.804 5.713a1 1 0 0 0 1.64.43l2.628-2.393 4.402 3.23a1 1 0 0 0 1.567-.63l3-15a1 1 0 0 0-.27-.93zM10.12 15.9l-1.1-3.48 7.3-6.05-6.2 9.53zm1.43 1.64-.35-1.1 1.11 0.81zm5.67 1.06-4.74-3.48 7.6-11.67-2.86 15.15z"
                fill="white"
            />
        </svg>
    );
}

/** Лого-знак: тёмный скруглённый квадрат со светящимся «глазом» — как у маскота */
function LogoMark() {
    return (
        <span className={css.logoMark} aria-hidden="true">
            <span className={css.logoEye} />
        </span>
    );
}

function Bar() {
    const { pathname } = useLocation();
    const { user, loading, logout, refreshUser } = useAuth();
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const nav = useNavigate();

    useEffect(() => {
        if (!user && !loading) refreshUser?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e) => {
            if (!ref.current?.contains(e.target)) setOpen(false);
        };
        document.addEventListener("pointerdown", onDoc);
        return () => document.removeEventListener("pointerdown", onDoc);
    }, [open]);

    const initial =
        (user?.name || user?.email || "?").trim()[0]?.toUpperCase() || "?";

    const handleLogoClick = (e) => {
        e.preventDefault();
        if (pathname === "/") {
            const el = document.getElementById("upload");
            el?.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
            nav("/");
        }
    };

    return (
        <>
            <header className={css.bar}>
                <div className={css.container}>
                    {/* Логотип */}
                    <a
                        href="/"
                        className={css.brand}
                        aria-label="Главная"
                        onClick={handleLogoClick}
                    >
                        <LogoMark />
                        <span className={css.brandName}>Ai<i>MIR</i></span>
                    </a>

                    {/* Правая часть */}
                    <div className={css.right}>
                        {loading ? (
                            <div className={css.skel} />
                        ) : user ? (
                            <div className={css.userWrap} ref={ref}>
                                <button
                                    type="button"
                                    className={css.avatar}
                                    onClick={() => setOpen((v) => !v)}
                                    aria-haspopup="menu"
                                    aria-expanded={open}
                                    title={user.email}
                                >
                                    {initial}
                                </button>

                                {open && (
                                    <div className={css.menu} role="menu">
                                        <div className={css.menuHead}>
                                            {user.email}
                                        </div>

                                        {/* Поддержка — только на мобиле */}
                                        <a
                                            href="https://t.me/Adm1n404"
                                            target="_blank"
                                            rel="noreferrer"
                                            className={`${css.menuItem} ${css.menuItemMobile}`}
                                            role="menuitem"
                                            onClick={() => setOpen(false)}
                                        >
                                            Поддержка в Telegram
                                        </a>

                                        <button
                                            className={css.menuItem}
                                            onClick={() => {
                                                setOpen(false);
                                                nav("/documents");
                                            }}
                                        >
                                            Мои документы
                                        </button>
                                        <button
                                            className={css.menuItem}
                                            onClick={() => {
                                                setOpen(false);
                                                nav("/billing");
                                            }}
                                        >
                                            Баланс и подписка
                                        </button>
                                        <button
                                            className={`${css.menuItem} ${css.danger}`}
                                            onClick={() => {
                                                logout();
                                                setOpen(false);
                                                nav("/login");
                                            }}
                                        >
                                            Выйти
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <Link to="/login" className={css.loginBtn}>
                                Войти
                            </Link>
                        )}
                    </div>
                </div>
            </header>

            {/* Плавающая кнопка Telegram — только на десктопе */}
            <a
                href="https://t.me/Adm1n404"
                target="_blank"
                rel="noreferrer"
                className={css.tgFab}
                aria-label="Поддержка в Telegram"
            >
                <TgIcon />
            </a>
        </>
    );
}
