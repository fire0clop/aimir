// src/components/DashboardReviewsModeration.jsx
import React, { useEffect, useState } from "react";
import {
    adminListReviews,
    adminUpdateReview,
    adminSetPublish,
    adminDeleteReview,
} from "../api/review";

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
            <section style={sectionStyle}>
                <h2 style={titleStyle}>Отзывы</h2>
                <p>Загружаем…</p>
            </section>
        );
    }

    if (state.forbidden) {
        // не ломаем дашборд, просто показываем текст
        return (
            <section style={sectionStyle}>
                <h2 style={titleStyle}>Отзывы</h2>
                <p style={{ color: "#718096", fontSize: 14 }}>
                    Модерация отзывов доступна только владельцу (owner=true).
                </p>
            </section>
        );
    }

    if (state.error) {
        return (
            <section style={sectionStyle}>
                <h2 style={titleStyle}>Отзывы</h2>
                <p style={{ color: "#c53030" }}>{state.error}</p>
            </section>
        );
    }

    return (
        <section style={sectionStyle}>
            <h2 style={titleStyle}>Отзывы</h2>
            <p style={{ margin: "0 0 12px", color: "#4a5568", fontSize: 14 }}>
                Два списка: опубликованные и ожидающие модерации. Можно публиковать, скрывать,
                редактировать и удалять.
            </p>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
                    gap: 16,
                }}
            >
                {/* Опубликованные */}
                <div style={columnStyle}>
                    <h3 style={subtitleStyle}>Опубликованные</h3>
                    {state.published.length === 0 ? (
                        <p style={{ color: "#718096", fontSize: 13 }}>Нет опубликованных отзывов.</p>
                    ) : (
                        <div style={scrollBox}>
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
                <div style={columnStyle}>
                    <h3 style={subtitleStyle}>Ожидают модерации</h3>
                    {state.drafts.length === 0 ? (
                        <p style={{ color: "#718096", fontSize: 13 }}>
                            Нет отзывов, ожидающих публикации.
                        </p>
                    ) : (
                        <div style={scrollBox}>
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
                <div
                    onClick={closeEdit}
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,0.45)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 1000,
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: "#fff",
                            borderRadius: 12,
                            maxWidth: 520,
                            width: "100%",
                            padding: 20,
                            boxShadow: "0 15px 35px rgba(0,0,0,0.3)",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: 12,
                            }}
                        >
                            <h3 style={{ margin: 0, fontSize: 18 }}>Редактировать отзыв</h3>
                            <button
                                onClick={closeEdit}
                                style={{
                                    border: "none",
                                    background: "transparent",
                                    fontSize: 22,
                                    cursor: "pointer",
                                    lineHeight: 1,
                                }}
                                aria-label="Закрыть"
                            >
                                ×
                            </button>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            <label>
                                <div style={labelText}>Email</div>
                                <input
                                    type="email"
                                    value={editReview.email}
                                    onChange={(e) => onEditChange("email", e.target.value)}
                                    style={inputStyle}
                                />
                            </label>

                            <label>
                                <div style={labelText}>Заголовок</div>
                                <input
                                    type="text"
                                    value={editReview.title}
                                    onChange={(e) => onEditChange("title", e.target.value)}
                                    style={inputStyle}
                                />
                            </label>

                            <label>
                                <div style={labelText}>Текст</div>
                                <textarea
                                    value={editReview.description}
                                    onChange={(e) => onEditChange("description", e.target.value)}
                                    rows={4}
                                    style={{ ...inputStyle, resize: "vertical" }}
                                />
                            </label>

                            <label>
                                <div style={labelText}>Рейтинг (1–5)</div>
                                <input
                                    type="number"
                                    min={1}
                                    max={5}
                                    value={editReview.rating}
                                    onChange={(e) => onEditChange("rating", e.target.value)}
                                    style={inputStyle}
                                />
                            </label>
                        </div>

                        <div
                            style={{
                                marginTop: 16,
                                display: "flex",
                                justifyContent: "flex-end",
                                gap: 8,
                            }}
                        >
                            <button
                                type="button"
                                onClick={closeEdit}
                                style={btnSecondary}
                            >
                                Отмена
                            </button>
                            <button
                                type="button"
                                onClick={onEditSave}
                                disabled={saving}
                                style={btnPrimary}
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
        <div
            style={{
                borderRadius: 10,
                border: "1px solid #e2e8f0",
                padding: 10,
                marginBottom: 10,
                background: "#f7fafc",
            }}
        >
            <div style={{ fontSize: 12, color: "#4a5568", marginBottom: 4 }}>
                #{review.id} • {fmtDate(review.created_at)}
            </div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{review.title}</div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>{review.description}</div>
            <div style={{ fontSize: 12, color: "#4a5568", marginBottom: 6 }}>
                {review.email} • ★ {review.rating}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" onClick={() => onEdit(review)} style={btnXS}>
                    Изменить
                </button>
                <button
                    type="button"
                    onClick={onTogglePublish}
                    style={
                        publishKind === "green"
                            ? btnXSGreen
                            : btnXSGray
                    }
                >
                    {publishLabel}
                </button>
                <button type="button" onClick={onDelete} style={btnXSDanger}>
                    Удалить
                </button>
            </div>
        </div>
    );
}

const sectionStyle = {
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: "#fff",
};

const titleStyle = { margin: "0 0 8px", fontSize: 20 };

const subtitleStyle = { margin: "0 0 8px", fontSize: 16 };

const columnStyle = {};

const scrollBox = {
    maxHeight: "400px",
    overflow: "auto",
    paddingRight: 4,
};

const labelText = { fontSize: 13, marginBottom: 4, color: "#4a5568" };

const inputStyle = {
    width: "100%",
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid #cbd5e0",
    fontSize: 14,
};

const btnPrimary = {
    padding: "6px 14px",
    borderRadius: 999,
    border: "1px solid #3182ce",
    background: "#3182ce",
    color: "#fff",
    cursor: "pointer",
    fontSize: 14,
};

const btnSecondary = {
    padding: "6px 12px",
    borderRadius: 999,
    border: "1px solid #cbd5e0",
    background: "#fff",
    cursor: "pointer",
    fontSize: 14,
};

const btnXSBase = {
    padding: "3px 8px",
    borderRadius: 999,
    border: "1px solid transparent",
    fontSize: 11,
    cursor: "pointer",
};

const btnXS = {
    ...btnXSBase,
    borderColor: "#3182ce",
    background: "#3182ce",
    color: "#fff",
};

const btnXSGray = {
    ...btnXSBase,
    borderColor: "#a0aec0",
    background: "#e2e8f0",
    color: "#1a202c",
};

const btnXSGreen = {
    ...btnXSBase,
    borderColor: "#38a169",
    background: "#38a169",
    color: "#fff",
};

const btnXSDanger = {
    ...btnXSBase,
    borderColor: "#e53e3e",
    background: "#e53e3e",
    color: "#fff",
};
