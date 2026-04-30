import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import css from "./Header.module.css";
import logoUrl from "../assets/images/logo.png";
import tgIcon from "../assets/images/Telegram_logo.svg.webp";
const HIDE_ON = new Set(["/login", "/register"]);

export default function Header() {
    const { pathname } = useLocation();
    if (HIDE_ON.has(pathname)) return null;
    return <Bar />;
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

    const scrollToSection = (id) => {
        if (typeof window === "undefined") return;
        const el = document.getElementById(id);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const handleLogoClick = (e) => {
        e.preventDefault();
        if (pathname === "/") {
            scrollToSection("upload");
        } else {
            nav("/");
        }
    };

    const handleNavClick = (id) => {
        if (pathname === "/") {
            scrollToSection(id);
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
                        <img src={logoUrl} alt="Aimir" className={css.logo} />
                    </a>

                    {/* Десктоп-навигация */}
                    <nav className={css.nav} aria-label="Основная навигация">
                        <button
                            type="button"
                            className={css.navItem}
                            onClick={() => handleNavClick("benefits")}
                        >
                            Преимущества
                        </button>
                        <button
                            type="button"
                            className={css.navItem}
                            onClick={() => handleNavClick("how-it-works")}
                        >
                            Как это работает
                        </button>
                        <button
                            type="button"
                            className={css.navItem}
                            onClick={() => handleNavClick("reviews")}
                        >
                            Отзывы
                        </button>
                    </nav>

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

                                        {/* Пункт поддержки в Telegram — показывается только на мобиле (через CSS) */}
                                        <button
                                            href="https://t.me/Adm1n404"
                                            target="_blank"
                                            rel="noreferrer"
                                            className={`${css.menuItem} ${css.menuItemMobile}`}
                                            role="menuitem"
                                            onClick={() => setOpen(false)}
                                        >
                                            Поддержка в Telegram
                                        </button>

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

            {/* Плавающая кнопка Telegram — показывается только на десктопе (через CSS) */}
            <a
                href="https://t.me/Adm1n404"
                target="_blank"
                rel="noreferrer"
                className={css.tgFab}
                style={{ backgroundImage: `url(${tgIcon})` }}
            >
            </a>

        </>
    );
}
