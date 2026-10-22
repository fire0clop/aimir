// src/pages/Dashboard.jsx
import React, { useEffect, useState } from "react";
import { fetchDashboard, fetchDashboardUsersSummary } from "../api/dashboard";
import DashboardReviewsModeration from "../components/DashboardReviewsModeration";
import DashboardSubscriptions from "../components/DashboardSubscriptions";
import DashboardRevenue from "../components/DashboardRevenue";
import DashboardMetrika from "../components/DashboardMetrika";
import s from "./Dashboard.module.css";

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
            <main className={s.page}>
                <h1 className={s.pageTitle}>Дашборд</h1>
                <p className={s.mutedText}>Загружаем данные…</p>
            </main>
        );
    }

    if (state.forbidden) {
        return (
            <main className={s.page}>
                <h1 className={s.pageTitle}>Дашборд</h1>
                <p className={s.errorText}>
                    У вас нет доступа к этому разделу.
                </p>
                <p className={s.mutedText} style={{ marginTop: 8 }}>
                    Если вы считаете, что это ошибка, свяжитесь с владельцем сервиса.
                </p>
            </main>
        );
    }

    if (state.error) {
        return (
            <main className={s.page}>
                <h1 className={s.pageTitle}>Дашборд</h1>
                <p className={s.errorText}>{state.error}</p>
            </main>
        );
    }

    const data = state.data || {};
    const subscriptions = data.subscriptions || {};
    const revenue = data.revenue || {};

    const openUsersModal = () => setUsersModalOpen(true);
    const closeUsersModal = () => setUsersModalOpen(false);

    return (
        <main className={s.page}>
            <div className={s.pageHead}>
                <h1 className={s.pageTitle}>Дашборд</h1>
                <button type="button" onClick={openUsersModal} className={s.btnPeach}>
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
                <div onClick={closeUsersModal} className={s.modalBackdrop}>
                    <div onClick={(e) => e.stopPropagation()} className={s.modalWide}>
                        <div className={s.modalHead}>
                            <h2 className={s.modalTitle}>Пользователи и загрузки</h2>
                            <button
                                onClick={closeUsersModal}
                                className={s.modalClose}
                                aria-label="Закрыть"
                            >
                                ×
                            </button>
                        </div>
                        <p className={s.cardSub}>
                            Здесь только пользователи (не гости), которые загрузили хотя бы один документ.
                        </p>

                        <div className={s.modalScroll}>
                            {usersState.loading ? (
                                <p className={s.mutedText}>Загружаем список пользователей…</p>
                            ) : usersState.error ? (
                                <p className={s.errorText}>{usersState.error}</p>
                            ) : usersState.items.length === 0 ? (
                                <p className={s.mutedText}>
                                    Пока нет пользователей с загруженными документами.
                                </p>
                            ) : (
                                <div className={s.tableScroll}>
                                    <table className={s.table}>
                                        <thead>
                                        <tr>
                                            <th>Email</th>
                                            <th className={s.right}>Документов</th>
                                            <th className={s.center}>Подписка</th>
                                            <th className={s.center}>Старт подписки</th>
                                            <th className={s.center}>Конец подписки</th>
                                            <th className={s.right}>Кредиты (баланс)</th>
                                            <th className={s.right}>Наши расходы на токены (₽)</th>
                                            <th className={s.right}>Выручка от пользователя (₽)</th>
                                            <th className={s.right}>Net (выручка − токены, ₽)</th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {usersState.items.map((u) => (
                                            <tr key={u.id}>
                                                <td className={s.mono}>{u.email}</td>
                                                <td className={`${s.mono} ${s.right}`}>
                                                    {u.documents_count}
                                                </td>
                                                <td className={`${s.mono} ${s.center}`}>
                                                    {u.has_subscription ? "Да" : "Нет"}
                                                </td>
                                                <td className={`${s.mono} ${s.center}`}>
                                                    {u.subscription_start || "—"}
                                                </td>
                                                <td className={`${s.mono} ${s.center}`}>
                                                    {u.subscription_end || "—"}
                                                </td>
                                                <td className={`${s.mono} ${s.right}`}>
                                                    {u.credits_balance}
                                                </td>
                                                <td className={`${s.mono} ${s.right}`}>
                                                    {fmtMoney(u.cost_tokens_rub)}
                                                </td>
                                                <td className={`${s.mono} ${s.right}`}>
                                                    {fmtMoney(u.revenue_total_rub)}
                                                </td>
                                                <td className={`${s.mono} ${s.right}`}>
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
