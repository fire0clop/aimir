// src/components/DashboardReviewsModeration.jsx
import React, { useEffect, useState } from "react";
import {
    adminListReviews,
    adminUpdateReview,
    adminSetPublish,
    adminDeleteReview,
} from "../api/review";
import s from "../pages/Dashboard.module.css";

export default function DashboardReviewsModeration() {
    const [state, setState] = useState({
        loading: true,
        error: "",
        forbidden: false,
        published: [],
        drafts: [],
    });

    const [editReview, setEditReview] = useState(null); // {id,email,title,description,rating}
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            try {
                const [pub, unpub] = await Promise.all([
                    adminListReviews({ published: true }),
                    adminListReviews({ published: false }),
                ]);
                if (cancelled) return;

                setState({
                    loading: false,
                    error: "",
                    forbidden: false,
                    published: pub.items || [],
                    drafts: unpub.items || [],
                });
            } catch (e) {
                if (cancelled) return;
                const st = e?.status;
                // бэкенд вернёт 403, если user.owner == False
                if (st === 403) {
                    setState({
                        loading: false,
                        error: "",
                        forbidden: true,
                        published: [],
                        drafts: [],
                    });
                } else {
                    setState({
                        loading: false,
                        error: e?.message || "Не удалось загрузить отзывы",
                        forbidden: false,
                        published: [],
                        drafts: [],
                    });
                }
            }
        }

        load();
        return () => {
            cancelled = true;
        };
    }, []);

    const fmtDate = (iso) => {
        if (!iso) return "";
        const d = new Date(iso);
        return d.toLocaleString("ru-RU");
    };

    const onTogglePublish = async (review, targetPublished) => {
        try {
            const updated = await adminSetPublish(review.id, targetPublished);
            setState((prev) => {
                const removeFrom = targetPublished ? "drafts" : "published";
                const addTo = targetPublished ? "published" : "drafts";

                const removed = prev[removeFrom].filter((r) => r.id !== review.id);
                const addedList = [...prev[addTo].filter((r) => r.id !== review.id), updated];

                return {
                    ...prev,
                    [removeFrom]: removed,
                    [addTo]: addedList.sort((a, b) => b.id - a.id),
                };
            });
        } catch (e) {
            alert(e?.message || "Не удалось изменить статус публикации");
        }
    };

    const onDelete = async (review) => {
        if (!window.confirm(`Удалить отзыв #${review.id} от ${review.email}?`)) return;
        try {
            await adminDeleteReview(review.id);
            setState((prev) => ({
                ...prev,
                published: prev.published.filter((r) => r.id !== review.id),
                drafts: prev.drafts.filter((r) => r.id !== review.id),
            }));
        } catch (e) {
            alert(e?.message || "Не удалось удалить отзыв");
        }
    };

    const openEdit = (review) => {
        setEditReview({
            id: review.id,
            email: review.email || "",
            title: review.title || "",
            description: review.description || "",
            rating: review.rating ?? 5,
        });
    };

    const closeEdit = () => setEditReview(null);

    const onEditChange = (field, value) => {
        setEditReview((prev) => ({ ...prev, [field]: value }));
    };

    const onEditSave = async () => {
        if (!editReview) return;
        const { id, email, title, description, rating } = editReview;

        if (!email.trim() || !title.trim()) {
            alert("Email и заголовок обязательны");
            return;
        }
        const numRating = Number(rating);
        if (numRating < 1 || numRating > 5) {
            alert("Рейтинг должен быть от 1 до 5");
            return;
        }

        try {
            setSaving(true);
            const updated = await adminUpdateReview(id, {
                email: email.trim(),
                title: title.trim(),
                description: description.trim(),
                rating: numRating,
            });

            setState((prev) => ({
                ...prev,
                published: prev.published.map((r) => (r.id === id ? updated : r)),
                drafts: prev.drafts.map((r) => (r.id === id ? updated : r)),
            }));
            setSaving(false);
            setEditReview(null);
        } catch (e) {
            setSaving(false);
            alert(e?.message || "Не удалось сохранить изменения");
        }
    };

    if (state.loading) {
        return (
            <section className={s.card}>
                <h2 className={s.cardTitle}>Отзывы</h2>
                <p className={s.mutedText}>Загружаем…</p>
            </section>
        );
    }

    if (state.forbidden) {
        // не ломаем дашборд, просто показываем текст
        return (
            <section className={s.card}>
                <h2 className={s.cardTitle}>Отзывы</h2>
                <p className={s.mutedText}>
                    Модерация отзывов доступна только владельцу (owner=true).
                </p>
            </section>
        );
    }

    if (state.error) {
        return (
            <section className={s.card}>
                <h2 className={s.cardTitle}>Отзывы</h2>
                <p className={s.errorText}>{state.error}</p>
            </section>
        );
    }

    return (
        <section className={s.card}>
            <h2 className={s.cardTitle}>Отзывы</h2>
            <p className={s.cardSub}>
                Два списка: опубликованные и ожидающие модерации. Можно публиковать, скрывать,
                редактировать и удалять.
            </p>

            <div className={s.reviewsGrid}>
                {/* Опубликованные */}
                <div>
                    <h3 className={s.colTitle}>Опубликованные</h3>
                    {state.published.length === 0 ? (
                        <p className={s.mutedText}>Нет опубликованных отзывов.</p>
                    ) : (
                        <div className={s.scrollBox}>
                            {state.published.map((r) => (
                                <ReviewCard
                                    key={r.id}
                                    review={r}
                                    fmtDate={fmtDate}
                                    onEdit={openEdit}
                                    onTogglePublish={() => onTogglePublish(r, false)}
                                    onDelete={() => onDelete(r)}
                                    publishLabel="Скрыть"
                                    publishKind="gray"
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* Не опубликованные */}
                <div>
                    <h3 className={s.colTitle}>Ожидают модерации</h3>
                    {state.drafts.length === 0 ? (
                        <p className={s.mutedText}>
                            Нет отзывов, ожидающих публикации.
                        </p>
                    ) : (
                        <div className={s.scrollBox}>
                            {state.drafts.map((r) => (
                                <ReviewCard
                                    key={r.id}
                                    review={r}
                                    fmtDate={fmtDate}
                                    onEdit={openEdit}
                                    onTogglePublish={() => onTogglePublish(r, true)}
                                    onDelete={() => onDelete(r)}
                                    publishLabel="Опубликовать"
                                    publishKind="green"
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Модалка редактирования */}
            {editReview && (
                <div onClick={closeEdit} className={s.modalBackdrop}>
                    <div onClick={(e) => e.stopPropagation()} className={s.modal}>
                        <div className={s.modalHead}>
                            <h3 className={s.modalTitle}>Редактировать отзыв</h3>
                            <button
                                onClick={closeEdit}
                                className={s.modalClose}
                                aria-label="Закрыть"
                            >
                                ×
                            </button>
                        </div>

                        <div className={s.formCol}>
                            <label>
                                <div className={s.label}>Email</div>
                                <input
                                    type="email"
                                    value={editReview.email}
                                    onChange={(e) => onEditChange("email", e.target.value)}
                                    className={s.input}
                                />
                            </label>

                            <label>
                                <div className={s.label}>Заголовок</div>
                                <input
                                    type="text"
                                    value={editReview.title}
                                    onChange={(e) => onEditChange("title", e.target.value)}
                                    className={s.input}
                                />
                            </label>

                            <label>
                                <div className={s.label}>Текст</div>
                                <textarea
                                    value={editReview.description}
                                    onChange={(e) => onEditChange("description", e.target.value)}
                                    rows={4}
                                    className={s.input}
                                    style={{ resize: "vertical" }}
                                />
                            </label>

                            <label>
                                <div className={s.label}>Рейтинг (1–5)</div>
                                <input
                                    type="number"
                                    min={1}
                                    max={5}
                                    value={editReview.rating}
                                    onChange={(e) => onEditChange("rating", e.target.value)}
                                    className={s.input}
                                />
                            </label>
                        </div>

                        <div className={s.modalActions}>
                            <button
                                type="button"
                                onClick={closeEdit}
                                className={s.btnGhost}
                            >
                                Отмена
                            </button>
                            <button
                                type="button"
                                onClick={onEditSave}
                                disabled={saving}
                                className={s.btnPeach}
                            >
                                {saving ? "Сохраняем..." : "Сохранить"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}

function ReviewCard({
                        review,
                        fmtDate,
                        onEdit,
                        onTogglePublish,
                        onDelete,
                        publishLabel,
                        publishKind,
                    }) {
    return (
        <div className={s.reviewCard}>
            <div className={s.reviewMeta}>
                #{review.id} • {fmtDate(review.created_at)}
            </div>
            <div className={s.reviewTitle}>{review.title}</div>
            <div className={s.reviewText}>{review.description}</div>
            <div className={s.reviewMeta}>
                {review.email} • ★ {review.rating}
            </div>
            <div className={s.btnRow}>
                <button type="button" onClick={() => onEdit(review)} className={s.btnXSPeach}>
                    Изменить
                </button>
                <button
                    type="button"
                    onClick={onTogglePublish}
                    className={publishKind === "green" ? s.btnXSGreen : s.btnXSGray}
                >
                    {publishLabel}
                </button>
                <button type="button" onClick={onDelete} className={s.btnXSDanger}>
                    Удалить
                </button>
            </div>
        </div>
    );
}
