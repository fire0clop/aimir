// src/components/DashboardSubscriptions.jsx
import React from "react";
import s from "../pages/Dashboard.module.css";

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

    // палитра «Pastel Sky»
    const palette = [
        "#e58a60", // персиковый (peach-deep)
        "#8aa0b8", // серо-голубой (risk-low)
        "#6fae8f", // зелёный (ok)
        "#dfa14f", // янтарный (risk-mid)
        "#d96b6b", // красный (risk-hi)
        "#7c8798", // серый (muted)
    ];

    let offsetAcc = 0;
    const chartSegments = segments.map((seg, idx) => {
        const fraction = totalForChart ? seg.value / totalForChart : 0;
        const length = fraction * circumference;
        const dasharray = `${length} ${circumference}`;
        const dashoffset = -offsetAcc * circumference;
        offsetAcc += fraction;

        return {
            ...seg,
            color: palette[idx % palette.length],
            dasharray,
            dashoffset,
            percent: formatPercent(seg.value),
        };
    });

    return (
        <section className={s.card}>
            <div className={s.subsRow}>
                {/* Левая часть — заголовок + диаграмма */}
                <div className={s.subsChartCol}>
                    <h2 className={s.cardTitle}>Подписки (распределение)</h2>
                    <p className={s.cardSub}>
                        Всего пользователей: <b>{totalUsers}</b>
                    </p>

                    {segments.length === 0 ? (
                        <p className={s.mutedText}>Пока нет данных по подпискам.</p>
                    ) : (
                        <div className={s.donutWrap}>
                            {/* donut chart */}
                            <svg
                                width="220"
                                height="220"
                                viewBox="0 0 100 100"
                                style={{ transform: "rotate(-90deg)" }}
                            >
                                {/* фон-круг (светлый серо-голубой, как базовый) */}
                                <circle
                                    cx="50"
                                    cy="50"
                                    r={radius}
                                    fill="transparent"
                                    stroke="#eaf0f6"
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
                            <div className={s.donutCenter}>
                                <div className={s.donutNum}>{totalForChart || 0}</div>
                                <div className={s.donutLabel}>
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
                    <div className={s.subsLegendCol}>
                        <table className={s.table}>
                            <thead>
                            <tr>
                                <th>Категория</th>
                                <th className={s.right}>Пользователей</th>
                                <th className={s.right}>Доля</th>
                            </tr>
                            </thead>
                            <tbody>
                            {chartSegments.map((seg) => (
                                <tr key={seg.key}>
                                    <td>
                                        <span className={s.legendCell}>
                                            <span
                                                className={s.legendSwatch}
                                                style={{ backgroundColor: seg.color }}
                                            />
                                            <span>{seg.label}</span>
                                        </span>
                                    </td>
                                    <td className={`${s.right} ${s.mono}`}>{seg.value}</td>
                                    <td className={`${s.right} ${s.mono}`}>{seg.percent}</td>
                                </tr>
                            ))}
                            </tbody>
                        </table>

                        <p className={s.footnote}>
                            Диаграмма отражает только категории с ненулевым количеством
                            пользователей.
                        </p>
                    </div>
                )}
            </div>
        </section>
    );
}
