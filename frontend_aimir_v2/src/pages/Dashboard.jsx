// src/pages/Dashboard.jsx
import React, { useEffect, useState } from "react";
import { fetchDashboard, fetchDashboardUsersSummary } from "../api/dashboard";
import DashboardReviewsModeration from "../components/DashboardReviewsModeration";
import DashboardSubscriptions from "../components/DashboardSubscriptions";
import DashboardRevenue from "../components/DashboardRevenue";
import DashboardMetrika from "../components/DashboardMetrika";

export default function Dashboard() {
    const [state, setState] = useState({
        loading: true,
        error: "",
        forbidden: false,
        data: null,
    });

    const [usersState, setUsersState] = useState({
        loading: true,
        error: "",
        items: [],
    });

    const [usersModalOpen, setUsersModalOpen] = useState(false);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            try {
                const data = await fetchDashboard();
                if (cancelled) return;

                setState({
                    loading: false,
                    error: "",
                    forbidden: false,
                    data,
                });

                // после успешного общего дашборда грузим сводку по пользователям
                try {
                    const usersData = await fetchDashboardUsersSummary();
                    if (cancelled) return;
                    setUsersState({
                        loading: false,
                        error: "",
                        items: usersData.items || [],
                    });
                } catch (e) {
                    if (cancelled) return;
                    setUsersState({
                        loading: false,
                        error: e?.message || "Не удалось загрузить список пользователей",
                        items: [],
                    });
                }
            } catch (e) {
                if (cancelled) return;
                const status = e?.status;
                if (status === 403) {
                    setState({
                        loading: false,
                        error: "",
                        forbidden: true,
                        data: null,
                    });
                } else {
                    setState({
                        loading: false,
                        error: e?.message || "Не удалось загрузить дашборд",
                        forbidden: false,
                        data: null,
                    });
                }
                setUsersState({
                    loading: false,
                    error: "",
                    items: [],
                });
            }
        }

        load();
        return () => {
            cancelled = true;
        };
    }, []);

    const fmtMoney = (n) =>
        typeof n === "number"
            ? n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : "0.00";

    if (state.loading) {
        return (
            <main style={{ maxWidth: 960, margin: "40px auto", padding: "0 16px" }}>
                <h1>Дашборд</h1>
                <p>Загружаем данные…</p>
            </main>
        );
    }

    if (state.forbidden) {
        return (
            <main style={{ maxWidth: 960, margin: "40px auto", padding: "0 16px" }}>
                <h1>Дашборд</h1>
                <p style={{ color: "#c53030", marginTop: 8 }}>
                    У вас нет доступа к этому разделу.
                </p>
                <p style={{ marginTop: 8 }}>
                    Если вы считаете, что это ошибка, свяжитесь с владельцем сервиса.
                </p>
            </main>
        );
    }

    if (state.error) {
        return (
            <main style={{ maxWidth: 960, margin: "40px auto", padding: "0 16px" }}>
                <h1>Дашборд</h1>
                <p style={{ color: "#c53030", marginTop: 8 }}>{state.error}</p>
            </main>
        );
    }

    const data = state.data || {};
    const subscriptions = data.subscriptions || {};
    const revenue = data.revenue || {};

    const renderSubscriptionTypeShort = (t) => {
        switch (t) {
            case "month":
                return "Месяц";
            case "six_months":
                return "6 мес";
            case "year":
                return "Год";
            case "other":
                return "Другая";
            case "none":
            default:
                return "—";
        }
    };

    const openUsersModal = () => setUsersModalOpen(true);
    const closeUsersModal = () => setUsersModalOpen(false);

    return (
        <main style={{ maxWidth: 960, margin: "40px auto", padding: "0 16px" }}>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 24,
                }}
            >
                <h1 style={{ margin: 0 }}>Дашборд</h1>
                <button
                    type="button"
                    onClick={openUsersModal}
                    style={{
                        padding: "8px 14px",
                        borderRadius: 999,
                        border: "1px solid #4C51BF",
                        background: "#4C51BF",
                        color: "#fff",
                        fontSize: 14,
                        cursor: "pointer",
                    }}
                >
                    Пользователи и загрузки
                </button>
            </div>

            {/* Подписки (распределение) */}
            <DashboardSubscriptions subscriptions={subscriptions} />

            {/* Выручка */}
            <DashboardRevenue revenue={revenue} />

            {/* Метрика: посещения + воронка */}
            <DashboardMetrika />

            {/* Модерация отзывов */}
            <DashboardReviewsModeration />

            {/* Модальное окно с таблицей пользователей */}
            {usersModalOpen && (
                <div
                    onClick={closeUsersModal}
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
                            maxWidth: "1600px",
                            width: "100%",
                            maxHeight: "80vh",
                            padding: 20,
                            boxShadow: "0 15px 35px rgba(0,0,0,0.3)",
                            display: "flex",
                            flexDirection: "column",
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
                            <h2 style={{ margin: 0, fontSize: 18 }}>Пользователи и загрузки</h2>
                            <button
                                onClick={closeUsersModal}
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
                        <p style={{ margin: "0 0 12px", color: "#4a5568", fontSize: 14 }}>
                            Здесь только пользователи (не гости), которые загрузили хотя бы один документ.
                        </p>

                        <div style={{ flex: 1, overflow: "auto" }}>
                            {usersState.loading ? (
                                <p>Загружаем список пользователей…</p>
                            ) : usersState.error ? (
                                <p style={{ color: "#c53030" }}>{usersState.error}</p>
                            ) : usersState.items.length === 0 ? (
                                <p style={{ color: "#718096" }}>
                                    Пока нет пользователей с загруженными документами.
                                </p>
                            ) : (
                                <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
                                    <table
                                        style={{
                                            width: "100%",
                                            borderCollapse: "collapse",
                                            fontSize: 13,
                                        }}
                                    >
                                        <thead>
                                        <tr>
                                            <th style={thCell}>Email</th>
                                            <th style={{ ...thCell, textAlign: "right" }}>
                                                Документов
                                            </th>
                                            <th style={{ ...thCell, textAlign: "center" }}>
                                                Подписка
                                            </th>
                                            <th style={{ ...thCell, textAlign: "center" }}>
                                                Старт подписки
                                            </th>
                                            <th style={{ ...thCell, textAlign: "center" }}>
                                                Конец подписки
                                            </th>
                                            <th style={{ ...thCell, textAlign: "right" }}>
                                                Кредиты (баланс)
                                            </th>
                                            <th style={{ ...thCell, textAlign: "right" }}>
                                                Наши расходы на токены (₽)
                                            </th>
                                            <th style={{ ...thCell, textAlign: "right" }}>
                                                Выручка от пользователя (₽)
                                            </th>
                                            <th style={{ ...thCell, textAlign: "right" }}>
                                                Net (выручка − токены, ₽)
                                            </th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {usersState.items.map((u) => (
                                            <tr key={u.id}>
                                                <td style={tdCell}>{u.email}</td>
                                                <td
                                                    style={{
                                                        ...tdCell,
                                                        textAlign: "right",
                                                    }}
                                                >
                                                    {u.documents_count}
                                                </td>
                                                <td
                                                    style={{
                                                        ...tdCell,
                                                        textAlign: "center",
                                                    }}
                                                >
                                                    {u.has_subscription ? "Да" : "Нет"}
                                                </td>
                                                <td
                                                    style={{
                                                        ...tdCell,
                                                        textAlign: "center",
                                                    }}
                                                >
                                                    {u.subscription_start || "—"}
                                                </td>
                                                <td
                                                    style={{
                                                        ...tdCell,
                                                        textAlign: "center",
                                                    }}
                                                >
                                                    {u.subscription_end || "—"}
                                                </td>
                                                <td
                                                    style={{
                                                        ...tdCell,
                                                        textAlign: "right",
                                                    }}
                                                >
                                                    {u.credits_balance}
                                                </td>
                                                <td
                                                    style={{
                                                        ...tdCell,
                                                        textAlign: "right",
                                                    }}
                                                >
                                                    {fmtMoney(u.cost_tokens_rub)}
                                                </td>
                                                <td
                                                    style={{
                                                        ...tdCell,
                                                        textAlign: "right",
                                                    }}
                                                >
                                                    {fmtMoney(u.revenue_total_rub)}
                                                </td>
                                                <td
                                                    style={{
                                                        ...tdCell,
                                                        textAlign: "right",
                                                    }}
                                                >
                                                    {fmtMoney(u.net_rub)}
                                                </td>
                                            </tr>
                                        ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                    </div>
                </div>
            )}
        </main>
    );
}

const thCell = {
    padding: "8px 6px",
    borderBottom: "1px solid #e2e8f0",
    textAlign: "left",
    whiteSpace: "nowrap",
};

const tdCell = {
    padding: "6px 6px",
    borderBottom: "1px solid #edf2f7",
    fontFamily: "monospace",
    fontSize: 12,
};
