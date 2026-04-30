import React, { useEffect, useMemo, useState } from "react";
import s from "./Reviews.module.css";
import { Quote } from "lucide-react";
import { listPublishedReviews, createReview } from "../../api/review";

const PAGE = 6;

export default function Reviews() {
    const [items, setItems] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState("");
    const [offset, setOffset] = useState(0);

    // carousel
    const [currentIndex, setCurrentIndex] = useState(0);
    const [visibleCount, setVisibleCount] = useState(3);

    // modal state
    const [open, setOpen] = useState(false);
    const [email, setEmail] = useState("");
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [rating, setRating] = useState(5);
    const [formErr, setFormErr] = useState("");
    const [formOk, setFormOk] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const hasMore = useMemo(() => items.length < total, [items, total]);

    const stats = [
        { value: "10,000+", label: "Проверенных договоров" },
        { value: "500+", label: "Активных пользователей" },
        { value: "98%", label: "Точность анализа" },
        { value: "4.9/5", label: "Средняя оценка" },
    ];

    const load = async (nextOffset = 0) => {
        try {
            setLoading(true);
            setErr("");
            const res = await listPublishedReviews({ limit: PAGE, offset: nextOffset });
            if (nextOffset === 0) {
                setItems(res.items || []);
            } else {
                setItems((prev) => [...prev, ...(res.items || [])]);
            }
            setTotal(res.total || 0);
            setOffset(nextOffset);
        } catch (e) {
            setErr(parseErr(e));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load(0);
    }, []);

    const onMore = () => load(offset + PAGE);

    const openModal = () => {
        setOpen(true);
        setEmail("");
        setTitle("");
        setDescription("");
        setRating(5);
        setFormErr("");
        setFormOk("");
    };

    const onSubmit = async (e) => {
        e?.preventDefault();
        setFormErr("");
        setFormOk("");

        if (!email.trim()) return setFormErr("Укажите e-mail");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
            return setFormErr("Некорректный e-mail");
        if (!title.trim()) return setFormErr("Введите заголовок");
        const r = Number(rating);
        if (!(r >= 1 && r <= 5)) return setFormErr("Рейтинг от 1 до 5");

        try {
            setSubmitting(true);
            await createReview({
                email: email.trim(),
                title: title.trim(),
                description: description.trim(),
                rating: r,
            });
            setFormOk("Спасибо! Отзыв отправлен на модерацию.");
            setTimeout(() => {
                setOpen(false);
                load(0);
            }, 900);
        } catch (e2) {
            setFormErr(parseErr(e2) || "Не удалось отправить отзыв");
        } finally {
            setSubmitting(false);
        }
    };

    // ====== КОЛ-ВО КАРТОЧЕК НА ЭКРАН ======
    useEffect(() => {
        const updateVisible = () => {
            const w = window.innerWidth;
            if (w <= 640) setVisibleCount(1);
            else if (w <= 960) setVisibleCount(2);
            else setVisibleCount(3);
        };
        updateVisible();
        window.addEventListener("resize", updateVisible);
        return () => window.removeEventListener("resize", updateVisible);
    }, []);

    // следим, чтобы currentIndex был в диапазоне
    useEffect(() => {
        setCurrentIndex((idx) => {
            if (!items.length) return 0;
            const maxIndex = Math.max(0, items.length - visibleCount);
            return Math.min(idx, maxIndex);
        });
    }, [items.length, visibleCount]);

    const canSlide = items.length > visibleCount;
    const maxIndex = Math.max(0, items.length - visibleCount);

    // авто-прокрутка
    useEffect(() => {
        if (!canSlide) return;
        const id = setInterval(() => {
            setCurrentIndex((idx) => (idx >= maxIndex ? 0 : idx + 1));
        }, 7000);
        return () => clearInterval(id);
    }, [canSlide, maxIndex]);

    const slidePrev = () => {
        if (!canSlide) return;
        setCurrentIndex((idx) => (idx <= 0 ? maxIndex : idx - 1));
    };

    const slideNext = () => {
        if (!canSlide) return;
        setCurrentIndex((idx) => (idx >= maxIndex ? 0 : idx + 1));
    };

    const slideTo = (idx) => {
        if (!canSlide) return;
        const safe = Math.max(0, Math.min(idx, maxIndex));
        setCurrentIndex(safe);
    };

    const visibleItems = useMemo(
        () => items.slice(currentIndex, currentIndex + visibleCount),
        [items, currentIndex, visibleCount]
    );

    const pagesCount = Math.max(1, items.length - visibleCount + 1);

    return (
        <section id="reviews" className={s.section} aria-label="Отзывы пользователей">
            {/* центральное голубое свечение как в Benefits */}
            <div className={s.bgGlow} />

            {/* боковые размытия */}
            <div className={s.bgDecor}>
                <div className={s.circleOne} />
                <div className={s.circleTwo} />
            </div>

            <div className={s.wrap}>
                {/* Хедер как в Vite */}
                <div className={s.head}>
                    <div className={s.headMain}>
                        <span className={s.badge}>Отзывы клиентов</span>
                        <h2 className={s.h2}>
                            Нам доверяют
                        </h2>
                        <p className={s.sub}>Что говорят пользователи о сервисе.</p>
                    </div>

                    <button className={s.addBtn} onClick={openModal}>
                        + Добавить отзыв
                    </button>
                </div>

                {/* Статистика над отзывами */}
                <div className={s.statsGrid}>
                    {stats.map((st, i) => (
                        <div key={i} className={s.statCard}>
                            <p className={s.statValue}>{st.value}</p>
                            <p className={s.statLabel}>{st.label}</p>
                        </div>
                    ))}
                </div>

                {err && <div className={s.alert}>{err}</div>}

                {loading ? (
                    <div className={s.skel}>Загружаем отзывы…</div>
                ) : items.length === 0 ? (
                    <div className={s.empty}>Пока нет опубликованных отзывов.</div>
                ) : (
                    <>
                        {/* Карточки-отзывы (карусель, но в виде трёх больших карт) */}
                        <div className={s.carousel}>
                            {canSlide && (
                                <button
                                    type="button"
                                    className={s.navBtn}
                                    onClick={slidePrev}
                                    aria-label="Предыдущие отзывы"
                                >
                                    ‹
                                </button>
                            )}

                            <ul className={s.list}>
                                {visibleItems.map((it) => (
                                    <li key={it.id} className={s.item}>
                                        <div className={s.quoteIcon}>
                                            <Quote className={s.quoteSvg} />
                                        </div>

                                        <div className={s.starsRow}>
                                            <Stars value={it.rating} />
                                        </div>

                                        {it.description && (
                                            <p className={s.text}>«{it.description}»</p>
                                        )}

                                        <div className={s.authorRow}>
                                            <div className={s.avatar}>
                                                {makeInitials(it.title, it.email)}
                                            </div>
                                            <div className={s.authorMeta}>
                                                <div className={s.title}>{it.title}</div>
                                                <div className={s.meta}>{maskEmail(it.email)}</div>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>

                            {canSlide && (
                                <button
                                    type="button"
                                    className={s.navBtn}
                                    onClick={slideNext}
                                    aria-label="Следующие отзывы"
                                >
                                    ›
                                </button>
                            )}
                        </div>

                        <div className={s.carouselFooter}>
                            {canSlide && (
                                <div className={s.dots} aria-hidden="true">
                                    {Array.from({ length: pagesCount }).map((_, i) => (
                                        <button
                                            key={i}
                                            type="button"
                                            className={`${s.dot} ${
                                                i === currentIndex ? s.dotActive : ""
                                            }`}
                                            onClick={() => slideTo(i)}
                                        />
                                    ))}
                                </div>
                            )}

                            {hasMore && (
                                <button
                                    type="button"
                                    className={s.moreLink}
                                    onClick={onMore}
                                >
                                    Показать ещё отзывы
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>

            {open && (
                <div className={s.modalBackdrop} role="dialog" aria-modal="true">
                    <div className={s.modal}>
                        <div className={s.modalHeader}>
                            <div className={s.modalTitle}>Новый отзыв</div>
                            <button
                                className={s.modalClose}
                                aria-label="Закрыть"
                                onClick={() => setOpen(false)}
                            >
                                ×
                            </button>
                        </div>

                        <form className={s.form} onSubmit={onSubmit}>
                            <div className={s.field}>
                                <label className={s.label}>E-mail*</label>
                                <input
                                    className={s.input}
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="you@example.com"
                                    autoFocus
                                    required
                                />
                            </div>

                            <div className={s.field}>
                                <label className={s.label}>Заголовок*</label>
                                <input
                                    className={s.input}
                                    type="text"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="Коротко о впечатлениях"
                                    required
                                />
                            </div>

                            <div className={s.field}>
                                <label className={s.label}>Описание</label>
                                <textarea
                                    className={s.textarea}
                                    rows={4}
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Расскажите подробнее (необязательно)"
                                />
                            </div>

                            <div className={s.field}>
                                <label className={s.label}>Рейтинг*</label>
                                <div className={s.rateRow}>
                                    {[1, 2, 3, 4, 5].map((n) => (
                                        <button
                                            key={n}
                                            type="button"
                                            className={`${s.starBtn} ${
                                                Number(rating) >= n ? s.starOn : ""
                                            }`}
                                            onClick={() => setRating(n)}
                                            aria-label={`${n} из 5`}
                                        >
                                            ★
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {formErr && <div className={s.alert}>{formErr}</div>}
                            {formOk && <div className={s.success}>{formOk}</div>}

                            <div className={s.actions}>
                                <button
                                    type="button"
                                    className={s.secondary}
                                    onClick={() => setOpen(false)}
                                >
                                    Отмена
                                </button>
                                <button
                                    type="submit"
                                    className={s.primary}
                                    disabled={submitting}
                                >
                                    {submitting ? "Отправляем…" : "Отправить"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </section>
    );
}

function Stars({ value = 0 }) {
    const v = Math.max(0, Math.min(5, Number(value) || 0));
    return (
        <div className={s.stars} aria-label={`${v} из 5`}>
            {"★".repeat(v)}
            <span className={s.dim}>{"★".repeat(5 - v)}</span>
        </div>
    );
}

function makeInitials(title = "", email = "") {
    const src = (title || email || "").trim();
    if (!src) return "?";
    const words = title.trim().split(/\s+/).filter(Boolean);
    if (words.length) {
        return (words[0][0] + (words[1]?.[0] || "")).toUpperCase();
    }
    const userPart = (email.split("@")[0] || "").trim();
    if (userPart.length >= 2) {
        return (userPart[0] + userPart[userPart.length - 1]).toUpperCase();
    }
    return src[0].toUpperCase();
}

function maskEmail(email = "") {
    try {
        const [u, d] = email.split("@");
        if (!u || !d) return email;
        const m =
            u.length <= 2 ? u[0] + "*" : u[0] + "*".repeat(u.length - 2) + u[u.length - 1];
        return `${m}@${d}`;
    } catch {
        return email;
    }
}

function parseErr(e) {
    try {
        const t = e?.message || "";
        if (t.startsWith("{")) {
            const j = JSON.parse(t);
            return j.detail || t;
        }
        return t || "Request failed";
    } catch {
        return "Request failed";
    }
}
