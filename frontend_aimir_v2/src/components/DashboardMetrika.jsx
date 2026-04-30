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
        <section style={{ marginTop: 32 }}>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                    gap: 16,
                    flexWrap: "wrap",
                }}
            >
                <h2 style={{ margin: 0, fontSize: 20 }}>
                    Яндекс.Метрика: посещения и цели
                </h2>

                <form
                    onSubmit={onSubmit}
                    style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        flexWrap: "wrap",
                        fontSize: 13,
                    }}
                >
                    <label>
                        c{" "}
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            style={{
                                fontSize: 13,
                                padding: "4px 6px",
                                borderRadius: 6,
                                border: "1px solid #CBD5E0",
                            }}
                        />
                    </label>
                    <label>
                        по{" "}
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            style={{
                                fontSize: 13,
                                padding: "4px 6px",
                                borderRadius: 6,
                                border: "1px solid #CBD5E0",
                            }}
                        />
                    </label>
                    <button
                        type="submit"
                        style={{
                            padding: "6px 12px",
                            borderRadius: 999,
                            border: "1px solid #4C51BF",
                            background: "#4C51BF",
                            color: "#fff",
                            fontSize: 13,
                            cursor: "pointer",
                        }}
                    >
                        Обновить
                    </button>
                </form>
            </div>

            {loading && <p>Загружаем данные Метрики…</p>}
            {error && <p style={{ color: "#c53030" }}>{error}</p>}

            {!loading && !error && data && (
                <>
                    {/* График посещений */}
                    <div
                        style={{
                            background: "#fff",
                            borderRadius: 12,
                            padding: 16,
                            boxShadow: "0 2px 6px rgba(0,0,0,0.05)",
                            marginBottom: 20,
                        }}
                    >
                        <h3 style={{ marginTop: 0, fontSize: 16, marginBottom: 8 }}>
                            Посещения по дням
                        </h3>
                        {visitsSeries.length === 0 ? (
                            <p style={{ color: "#718096" }}>Нет данных за выбранный период.</p>
                        ) : (
                            <div style={{ width: "100%", height: 260 }}>
                                <ResponsiveContainer>
                                    <LineChart data={visitsSeries}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="date" fontSize={11} />
                                        <YAxis fontSize={11} />
                                        <Tooltip
                                            formatter={(value) => [`${value}`, "Посещений"]}
                                            labelFormatter={(label) => `Дата: ${label}`}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="visits"
                                            dot={false}
                                            strokeWidth={2}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </div>

                    {/* Воронка целей */}
                    <div
                        style={{
                            background: "#fff",
                            borderRadius: 12,
                            padding: 16,
                            boxShadow: "0 2px 6px rgba(0,0,0,0.05)",
                        }}
                    >
                        <h3 style={{ marginTop: 0, fontSize: 16, marginBottom: 8 }}>
                            Воронка целей
                        </h3>
                        <p
                            style={{
                                marginTop: 0,
                                marginBottom: 8,
                                fontSize: 13,
                                color: "#4a5568",
                            }}
                        >
                            Всего визитов за период:{" "}
                            <strong>{funnel.visits_total}</strong>
                        </p>

                        {funnel.steps.length === 0 ? (
                            <p style={{ color: "#718096" }}>Нет данных по целям.</p>
                        ) : (
                            <table
                                style={{
                                    width: "100%",
                                    borderCollapse: "collapse",
                                    fontSize: 13,
                                }}
                            >
                                <thead>
                                <tr>
                                    <th style={thCell}>Шаг</th>
                                    <th style={{ ...thCell, textAlign: "right" }}>
                                        Достигли шага
                                    </th>
                                    <th style={{ ...thCell, textAlign: "right" }}>
                                        Конверсия от предыдущего
                                    </th>
                                    <th style={{ ...thCell, textAlign: "right" }}>
                                        Конверсия от визитов
                                    </th>
                                </tr>
                                </thead>
                                <tbody>
                                {funnel.steps.map((s) => (
                                    <tr key={s.key}>
                                        <td style={tdCell}>{s.name}</td>
                                        <td style={{ ...tdCell, textAlign: "right" }}>
                                            {s.count}
                                        </td>
                                        <td style={{ ...tdCell, textAlign: "right" }}>
                                            {s.conversion_from_prev.toFixed(1)}%
                                        </td>
                                        <td style={{ ...tdCell, textAlign: "right" }}>
                                            {s.conversion_from_first.toFixed(1)}%
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

const thCell = {
    padding: "6px 6px",
    borderBottom: "1px solid #e2e8f0",
    textAlign: "left",
    whiteSpace: "nowrap",
};

const tdCell = {
    padding: "6px 6px",
    borderBottom: "1px solid #edf2f7",
};
