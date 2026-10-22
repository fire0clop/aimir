// src/components/DashboardMetrika.jsx
import React, { useCallback, useEffect, useState } from "react";
import { fetchDashboardMetrika } from "../api/dashboard";
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";
import s from "../pages/Dashboard.module.css";

// цвета графика — палитра «Pastel Sky»
const COLOR_LINE = "#e58a60"; // персиковый (peach-deep)
const COLOR_GRID = "rgba(124, 135, 152, 0.2)";
const COLOR_AXIS_TEXT = "#7c8798";

const tooltipStyle = {
    background: "#fff",
    border: "1px solid rgba(124, 135, 152, 0.25)",
    borderRadius: 12,
    boxShadow: "0 12px 30px -10px rgba(63, 82, 110, 0.35)",
    fontSize: 12,
    color: "#2c3442",
};

export default function DashboardMetrika() {
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d.toISOString().slice(0, 10);
    });

    const [endDate, setEndDate] = useState(() => {
        const d = new Date();
        return d.toISOString().slice(0, 10);
    });

    const [state, setState] = useState({
        loading: false,
        error: "",
        data: null,
    });

    const loadData = useCallback(async () => {
        // простая валидация диапазона
        if (startDate && endDate && startDate > endDate) {
            setState({
                loading: false,
                error: "Дата начала не может быть позже даты окончания",
                data: null,
            });
            return;
        }

        setState((s) => ({ ...s, loading: true, error: "" }));
        try {
            const data = await fetchDashboardMetrika({
                startDate,
                endDate,
            });
            setState({ loading: false, error: "", data });
        } catch (e) {
            setState({
                loading: false,
                error: e?.message || "Не удалось загрузить данные Метрики",
                data: null,
            });
        }
    }, [startDate, endDate]);

    useEffect(() => {
        // начальная загрузка
        loadData();
    }, [loadData]);

    const onSubmit = (e) => {
        e.preventDefault();
        loadData();
    };

    const { loading, error, data } = state;
    const visitsSeries = data?.visits_timeseries || [];
    const funnel = data?.funnel || { visits_total: 0, steps: [] };

    return (
        <section className={s.card}>
            <div className={s.rowHead}>
                <h2 className={s.cardTitle} style={{ marginBottom: 0 }}>
                    Яндекс.Метрика: посещения и цели
                </h2>

                <form onSubmit={onSubmit} className={s.filterForm}>
                    <label>
                        c{" "}
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className={s.dateInput}
                        />
                    </label>
                    <label>
                        по{" "}
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className={s.dateInput}
                        />
                    </label>
                    <button type="submit" className={s.btnPeachSm}>
                        Обновить
                    </button>
                </form>
            </div>

            {loading && <p className={s.mutedText}>Загружаем данные Метрики…</p>}
            {error && <p className={s.errorText}>{error}</p>}

            {!loading && !error && data && (
                <>
                    {/* График посещений */}
                    <div className={s.innerCard} style={{ marginBottom: 18 }}>
                        <h3 className={s.subTitle} style={{ marginBottom: 10 }}>
                            Посещения по дням
                        </h3>
                        {visitsSeries.length === 0 ? (
                            <p className={s.mutedText}>Нет данных за выбранный период.</p>
                        ) : (
                            <div style={{ width: "100%", height: 260 }}>
                                <ResponsiveContainer>
                                    <LineChart data={visitsSeries}>
                                        <CartesianGrid
                                            strokeDasharray="3 3"
                                            stroke={COLOR_GRID}
                                        />
                                        <XAxis
                                            dataKey="date"
                                            fontSize={11}
                                            stroke={COLOR_AXIS_TEXT}
                                        />
                                        <YAxis fontSize={11} stroke={COLOR_AXIS_TEXT} />
                                        <Tooltip
                                            formatter={(value) => [`${value}`, "Посещений"]}
                                            labelFormatter={(label) => `Дата: ${label}`}
                                            contentStyle={tooltipStyle}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="visits"
                                            dot={false}
                                            strokeWidth={2}
                                            stroke={COLOR_LINE}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </div>

                    {/* Воронка целей */}
                    <div className={s.innerCard}>
                        <h3 className={s.subTitle} style={{ marginBottom: 8 }}>
                            Воронка целей
                        </h3>
                        <p className={s.cardSub} style={{ marginBottom: 8 }}>
                            Всего визитов за период:{" "}
                            <strong>{funnel.visits_total}</strong>
                        </p>

                        {funnel.steps.length === 0 ? (
                            <p className={s.mutedText}>Нет данных по целям.</p>
                        ) : (
                            <table className={s.table}>
                                <thead>
                                <tr>
                                    <th>Шаг</th>
                                    <th className={s.right}>Достигли шага</th>
                                    <th className={s.right}>Конверсия от предыдущего</th>
                                    <th className={s.right}>Конверсия от визитов</th>
                                </tr>
                                </thead>
                                <tbody>
                                {funnel.steps.map((step) => (
                                    <tr key={step.key}>
                                        <td>{step.name}</td>
                                        <td className={`${s.right} ${s.mono}`}>
                                            {step.count}
                                        </td>
                                        <td className={`${s.right} ${s.mono}`}>
                                            {step.conversion_from_prev.toFixed(1)}%
                                        </td>
                                        <td className={`${s.right} ${s.mono}`}>
                                            {step.conversion_from_first.toFixed(1)}%
                                        </td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </>
            )}
        </section>
    );
}
