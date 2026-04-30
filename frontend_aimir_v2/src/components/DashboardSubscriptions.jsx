// src/components/DashboardSubscriptions.jsx
import React from "react";

export default function DashboardSubscriptions({ subscriptions }) {
    const subs = subscriptions || {};
    const counts = subs.by_type || {};
    const totalUsers = subs.total_users || 0;

    const segmentsRaw = [
        { key: "month",        label: "Подписка на месяц",           value: counts.month || 0 },
        { key: "six_months",   label: "Подписка на 6 месяцев",       value: counts.six_months || 0 },
        { key: "year",         label: "Подписка на год",             value: counts.year || 0 },
        { key: "other",        label: "Другая длительность",         value: counts.other || 0 },
        { key: "balance_only", label: "Только баланс, без подписки", value: counts.balance_only || 0 },
        { key: "none",         label: "Без подписки и баланса",      value: counts.none || 0 },
    ];

    const segments = segmentsRaw.filter((s) => s.value > 0);
    const totalForChart = segments.reduce((sum, s) => sum + s.value, 0);

    const formatPercent = (value) => {
        if (!totalForChart) return "0%";
        const p = (value / totalForChart) * 100;
        return `${p.toFixed(1)}%`;
    };

    // ---------- данные для "пончик"-диаграммы (SVG) ----------
    const radius = 40;
    const circumference = 2 * Math.PI * radius;

    const palette = [
        "#4C51BF", // фиолетовый
        "#3182CE", // синий
        "#38A169", // зелёный
        "#DD6B20", // оранжевый
        "#D53F8C", // розовый
        "#718096", // серый
    ];

    let offsetAcc = 0;
    const chartSegments = segments.map((s, idx) => {
        const fraction = totalForChart ? s.value / totalForChart : 0;
        const length = fraction * circumference;
        const dasharray = `${length} ${circumference}`;
        const dashoffset = -offsetAcc * circumference;
        offsetAcc += fraction;

        return {
            ...s,
            color: palette[idx % palette.length],
            dasharray,
            dashoffset,
            percent: formatPercent(s.value),
        };
    });

    return (
        <section
            style={{
                padding: 16,
                borderRadius: 12,
                border: "1px solid #e2e8f0",
                marginBottom: 24,
                background: "#fff",
            }}
        >
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 24,
                    flexWrap: "wrap",
                }}
            >
                {/* Левая часть — заголовок + диаграмма */}
                <div
                    style={{
                        flex: "0 0 260px",
                        minWidth: 260,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                    }}
                >
                    <h2
                        style={{
                            margin: "0 0 4px",
                            fontSize: 20,
                            alignSelf: "flex-start",
                        }}
                    >
                        Подписки (распределение)
                    </h2>
                    <p
                        style={{
                            margin: "0 0 16px",
                            color: "#4a5568",
                            fontSize: 14,
                            alignSelf: "flex-start",
                        }}
                    >
                        Всего пользователей: <b>{totalUsers}</b>
                    </p>

                    {segments.length === 0 ? (
                        <p style={{ color: "#718096", fontSize: 14 }}>
                            Пока нет данных по подпискам.
                        </p>
                    ) : (
                        <div
                            style={{
                                position: "relative",
                                width: 220,
                                height: 220,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            {/* donut chart */}
                            <svg
                                width="220"
                                height="220"
                                viewBox="0 0 100 100"
                                style={{ transform: "rotate(-90deg)" }}
                            >
                                {/* фон-круг (серый, как базовый) */}
                                <circle
                                    cx="50"
                                    cy="50"
                                    r={radius}
                                    fill="transparent"
                                    stroke="#EDF2F7"
                                    strokeWidth="14"
                                />

                                {/* сегменты */}
                                {chartSegments.map((seg) => (
                                    <circle
                                        key={seg.key}
                                        cx="50"
                                        cy="50"
                                        r={radius}
                                        fill="transparent"
                                        stroke={seg.color}
                                        strokeWidth="14"
                                        strokeDasharray={seg.dasharray}
                                        strokeDashoffset={seg.dashoffset}
                                        strokeLinecap="butt"
                                    />
                                ))}
                            </svg>

                            {/* центр пончика — суммарная инфа */}
                            <div
                                style={{
                                    position: "absolute",
                                    inset: 0,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexDirection: "column",
                                    pointerEvents: "none",
                                }}
                            >
                                <div
                                    style={{
                                        fontSize: 26,
                                        fontWeight: 700,
                                        color: "#2D3748",
                                        lineHeight: 1.1,
                                    }}
                                >
                                    {totalForChart || 0}
                                </div>
                                <div
                                    style={{
                                        fontSize: 11,
                                        color: "#A0AEC0",
                                        textAlign: "center",
                                        marginTop: 2,
                                    }}
                                >
                                    учтённых
                                    <br />
                                    пользователей
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Правая часть — легенда / таблица */}
                {segments.length > 0 && (
                    <div
                        style={{
                            flex: "1 1 260px",
                            minWidth: 260,
                            fontSize: 13,
                        }}
                    >
                        <table
                            style={{
                                width: "100%",
                                borderCollapse: "collapse",
                                fontSize: 13,
                            }}
                        >
                            <thead>
                            <tr>
                                <th
                                    style={{
                                        textAlign: "left",
                                        padding: "6px 4px",
                                        borderBottom: "1px solid #e2e8f0",
                                    }}
                                >
                                    Категория
                                </th>
                                <th
                                    style={{
                                        textAlign: "right",
                                        padding: "6px 4px",
                                        borderBottom: "1px solid #e2e8f0",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    Пользователей
                                </th>
                                <th
                                    style={{
                                        textAlign: "right",
                                        padding: "6px 4px",
                                        borderBottom: "1px solid #e2e8f0",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    Доля
                                </th>
                            </tr>
                            </thead>
                            <tbody>
                            {chartSegments.map((s) => (
                                <tr key={s.key}>
                                    <td
                                        style={{
                                            padding: "6px 4px",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                        }}
                                    >
                                            <span
                                                style={{
                                                    width: 10,
                                                    height: 10,
                                                    borderRadius: 3,
                                                    backgroundColor: s.color,
                                                    flexShrink: 0,
                                                }}
                                            />
                                        <span>{s.label}</span>
                                    </td>
                                    <td
                                        style={{
                                            padding: "6px 4px",
                                            textAlign: "right",
                                            fontVariantNumeric: "tabular-nums",
                                        }}
                                    >
                                        {s.value}
                                    </td>
                                    <td
                                        style={{
                                            padding: "6px 4px",
                                            textAlign: "right",
                                            fontVariantNumeric: "tabular-nums",
                                            color: "#4A5568",
                                        }}
                                    >
                                        {s.percent}
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>

                        <p
                            style={{
                                marginTop: 8,
                                fontSize: 11,
                                color: "#A0AEC0",
                            }}
                        >
                            Диаграмма отражает только категории с ненулевым количеством
                            пользователей.
                        </p>
                    </div>
                )}
            </div>
        </section>
    );
}
