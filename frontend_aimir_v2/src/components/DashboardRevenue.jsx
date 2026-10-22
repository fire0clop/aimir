// src/components/DashboardRevenue.jsx
import React, { useEffect, useMemo, useState, useRef } from "react";
import {
    fetchDashboardRevenueTimeseries,
    fetchDashboardRevenueSummary,
} from "../api/dashboard";
import s from "../pages/Dashboard.module.css";

// цвета графика — палитра «Pastel Sky»
const COLOR_SUBSCRIPTION = "#e58a60"; // персиковый (peach-deep)
const COLOR_CREDITS = "#8aa0b8"; // серо-голубой (risk-low)
const COLOR_GRID = "rgba(124, 135, 152, 0.2)";
const COLOR_AXIS = "rgba(124, 135, 152, 0.35)";
const COLOR_AXIS_TEXT = "#7c8798";

export default function DashboardRevenue({ revenue }) {
    // ---------- сводка (верхние карточки) ----------
    const [summaryState, setSummaryState] = useState({
        loading: false,
        error: "",
        data: revenue || null, // стартуем с того, что пришло сверху
    });

    const rev = summaryState.data || revenue || {};
    const revenueByType = rev.by_type || {};

    // ---------- форматирование ----------
    const fmtMoney = (n) =>
        typeof n === "number"
            ? n.toLocaleString("ru-RU", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            })
            : "0.00";

    // ---------- состояние для timeseries ----------
    const [period, setPeriod] = useState("30d"); // 7d / 30d / 90d / custom
    const [groupBy, setGroupBy] = useState("day"); // "day" | "month"
    const [customStart, setCustomStart] = useState("");
    const [customEnd, setCustomEnd] = useState("");

    const [tsState, setTsState] = useState({
        loading: true,
        error: "",
        data: null,
    });

    // hover по бару
    const [hoverInfo, setHoverInfo] = useState(null);
    const chartWrapperRef = useRef(null);

    // вычисляем start/end на основе period
    const computedRange = useMemo(() => {
        if (period !== "custom") {
            const today = new Date();
            const end = today.toISOString().slice(0, 10);

            let days = 30;
            if (period === "7d") days = 7;
            if (period === "90d") days = 90;

            const startDate = new Date(today);
            startDate.setDate(startDate.getDate() - days);
            const start = startDate.toISOString().slice(0, 10);

            return { start, end };
        }
        // custom
        return {
            start: customStart || null,
            end: customEnd || null,
        };
    }, [period, customStart, customEnd]);

    // загрузка timeseries при изменении настроек
    useEffect(() => {
        let cancelled = false;

        async function load() {
            setTsState((s) => ({ ...s, loading: true, error: "" }));

            try {
                const params = { groupBy };

                if (computedRange.start) params.startDate = computedRange.start;
                if (computedRange.end) params.endDate = computedRange.end;

                const data = await fetchDashboardRevenueTimeseries(params);
                if (cancelled) return;

                setTsState({
                    loading: false,
                    error: "",
                    data,
                });
            } catch (e) {
                if (cancelled) return;
                setTsState({
                    loading: false,
                    error: e?.message || "Не удалось загрузить выручку по периодам",
                    data: null,
                });
            }
        }

        // для кастомного периода ждём, пока обе даты заполнены
        if (period === "custom" && (!computedRange.start || !computedRange.end)) {
            setTsState((s) => ({ ...s, loading: false }));
            return;
        }

        load();
        return () => {
            cancelled = true;
        };
    }, [period, groupBy, computedRange.start, computedRange.end]);

    // загрузка сводки (верхние карточки) при изменении диапазона
    useEffect(() => {
        let cancelled = false;

        async function loadSummary() {
            setSummaryState((s) => ({ ...s, loading: true, error: "" }));

            try {
                const params = {};
                if (computedRange.start) params.startDate = computedRange.start;
                if (computedRange.end) params.endDate = computedRange.end;

                const data = await fetchDashboardRevenueSummary(params);
                if (cancelled) return;

                setSummaryState({
                    loading: false,
                    error: "",
                    data,
                });
            } catch (e) {
                if (cancelled) return;
                setSummaryState({
                    loading: false,
                    error: e?.message || "Не удалось загрузить сводку по выручке",
                    data: null,
                });
            }
        }

        // для кастомного периода ждём обе даты
        if (period === "custom" && (!computedRange.start || !computedRange.end)) {
            setSummaryState((s) => ({ ...s, loading: false }));
            return;
        }

        loadSummary();

        return () => {
            cancelled = true;
        };
    }, [period, computedRange.start, computedRange.end]);

    // подготовка данных для графика: агрегируем по bucket
    const chartData = useMemo(() => {
        const src = tsState.data;
        if (!src || !Array.isArray(src.items)) return { buckets: [], totals: null };

        const map = new Map(); // bucket -> { bucket, subscription, credits, total }

        src.items.forEach((item) => {
            const key = item.bucket;
            const current = map.get(key) || {
                bucket: key,
                subscription: 0,
                credits: 0,
                total: 0,
            };

            if (item.kind === "subscription") {
                current.subscription += item.amount_rub || 0;
            } else if (item.kind === "credits") {
                current.credits += item.amount_rub || 0;
            }
            current.total = current.subscription + current.credits;
            map.set(key, current);
        });

        const buckets = Array.from(map.values()).sort((a, b) =>
            a.bucket.localeCompare(b.bucket)
        );

        return {
            buckets,
            totals: tsState.data?.totals || null,
        };
    }, [tsState.data]);

    const { buckets, totals } = chartData;

    // максимальное значение для шкалы
    const maxTotal = useMemo(() => {
        if (!buckets || buckets.length === 0) return 0;
        return buckets.reduce((max, b) => (b.total > max ? b.total : max), 0);
    }, [buckets]);

    // ширина графика (px) — чтобы были адекватные столбики и скролл при большом количестве дней
    const chartWidth = useMemo(() => {
        if (!buckets || buckets.length === 0) return 400;
        const perBucket = 36; // ширина "слота" под один день
        return Math.max(480, buckets.length * perBucket + 60); // + отступы
    }, [buckets]);

    const chartHeight = 180; // высота области с барами

    // формат для подписи даты в тултипе
    const formatBucketLabel = (bucket) => {
        if (!bucket) return "";
        if (groupBy === "month") {
            // YYYY-MM
            const [y, m] = bucket.split("-");
            return `${m}.${y}`;
        }
        // YYYY-MM-DD → DD.MM.YYYY
        const [y, m, d] = bucket.split("-");
        return `${d}.${m}.${y}`;
    };

    // ---------- UI ----------
    return (
        <section className={s.card}>
            {/* Верхний блок — «снимок» состояния по подпискам/балансу */}
            <h2 className={s.cardTitle}>
                Выручка (сводка)
                {summaryState.loading && (
                    <span className={s.loadingInline}>обновляем…</span>
                )}
            </h2>
            {summaryState.error && (
                <p className={s.errorText} style={{ fontSize: 12, marginTop: 0, marginBottom: 8 }}>
                    {summaryState.error}
                </p>
            )}

            <div className={s.kpiGrid}>
                <Card title="Подписка на месяц" note="Активные месячные подписки × цена">
                    {fmtMoney(revenueByType.month)} ₽
                </Card>

                <Card
                    title="Подписка на 6 месяцев"
                    note="Активные 6-месячные подписки × цена"
                >
                    {fmtMoney(revenueByType.six_months)} ₽
                </Card>

                <Card title="Подписка на год" note="Активные годовые подписки × цена">
                    {fmtMoney(revenueByType.year)} ₽
                </Card>

                <Card title="Итого по подпискам" note="Месяц + 6 мес + год">
                    {fmtMoney(rev.total_subscriptions)} ₽
                </Card>

                <Card
                    title="Суммарный баланс"
                    note="Текущие средства на балансах пользователей"
                >
                    {fmtMoney(rev.balance_total)} ₽
                </Card>

                <Card
                    title="Общий итог (оценка)"
                    note="Активные подписки + суммарный баланс"
                    accent
                >
                    {fmtMoney(rev.grand_total_estimated)} ₽
                </Card>
            </div>

            {/* Нижний блок — фактическая выручка по транзакциям с периодом и графиком */}
            <div className={s.subBlock}>
                <div className={s.rowHead}>
                    <h3 className={s.subTitle}>Фактическая выручка по транзакциям</h3>

                    <div className={s.filters}>
                        <div className={s.segmented}>
                            {[
                                { id: "7d", label: "7 дней" },
                                { id: "30d", label: "30 дней" },
                                { id: "90d", label: "90 дней" },
                                { id: "custom", label: "Произвольный" },
                            ].map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => setPeriod(p.id)}
                                    className={period === p.id ? s.segBtnActive : s.segBtn}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>

                        <div className={s.segmented}>
                            {[
                                { id: "day", label: "По дням" },
                                { id: "month", label: "По месяцам" },
                            ].map((g) => (
                                <button
                                    key={g.id}
                                    type="button"
                                    onClick={() => setGroupBy(g.id)}
                                    className={groupBy === g.id ? s.segBtnActive : s.segBtn}
                                >
                                    {g.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {period === "custom" && (
                    <div className={s.customRange}>
                        <label>
                            c{" "}
                            <input
                                type="date"
                                value={customStart}
                                onChange={(e) => setCustomStart(e.target.value)}
                                className={s.dateInput}
                            />
                        </label>
                        <label>
                            по{" "}
                            <input
                                type="date"
                                value={customEnd}
                                onChange={(e) => setCustomEnd(e.target.value)}
                                className={s.dateInput}
                            />
                        </label>
                        <span className={s.mutedText}>
                            Задайте обе даты, чтобы увидеть график
                        </span>
                    </div>
                )}

                {tsState.loading ? (
                    <p className={s.mutedText}>Загружаем данные…</p>
                ) : tsState.error ? (
                    <p className={s.errorText}>{tsState.error}</p>
                ) : !buckets || buckets.length === 0 ? (
                    <p className={s.mutedText}>Нет транзакций за выбранный период.</p>
                ) : (
                    <>
                        {/* График */}
                        <div ref={chartWrapperRef} className={s.chartScroller}>
                            <svg
                                width={chartWidth}
                                height={chartHeight + 30}
                                viewBox={`0 0 ${chartWidth} ${chartHeight + 30}`}
                            >
                                {/* ось Y + сетка */}
                                {maxTotal > 0 &&
                                    [0, 0.25, 0.5, 0.75, 1].map((v, idx) => {
                                        const y = 10 + (1 - v) * chartHeight;
                                        const value = maxTotal * v;
                                        return (
                                            <g key={v}>
                                                <line
                                                    x1={40}
                                                    x2={chartWidth - 10}
                                                    y1={y}
                                                    y2={y}
                                                    stroke={COLOR_GRID}
                                                    strokeWidth={idx === 0 ? 0.8 : 0.3}
                                                    strokeDasharray={idx === 0 ? "0" : "4 4"}
                                                />
                                                {idx > 0 && (
                                                    <text
                                                        x={36}
                                                        y={y + 3}
                                                        fontSize="9"
                                                        fill={COLOR_AXIS_TEXT}
                                                        textAnchor="end"
                                                    >
                                                        {Math.round(value)}
                                                    </text>
                                                )}
                                            </g>
                                        );
                                    })}

                                {/* ось X (линия) */}
                                <line
                                    x1={40}
                                    x2={chartWidth - 10}
                                    y1={10 + chartHeight}
                                    y2={10 + chartHeight}
                                    stroke={COLOR_AXIS}
                                    strokeWidth="0.8"
                                />

                                {/* столбики */}
                                {(() => {
                                    const slotWidth = (chartWidth - 60) / buckets.length;
                                    const barWidth = Math.min(26, slotWidth * 0.7);

                                    return buckets.map((b, idx) => {
                                        const total = b.total || 0;
                                        const sub = b.subscription || 0;
                                        const cred = b.credits || 0;

                                        if (maxTotal <= 0 || total <= 0) return null;

                                        const slotCenter =
                                            40 + slotWidth * idx + slotWidth / 2;
                                        const x = slotCenter - barWidth / 2;

                                        const subH = (sub / maxTotal) * chartHeight;
                                        const credH = (cred / maxTotal) * chartHeight;

                                        const baseY = 10 + chartHeight;
                                        const credY = baseY - credH;
                                        const subY = credY - subH;

                                        const handleHover = (evt) => {
                                            if (!chartWrapperRef.current) return;
                                            const wrapperRect =
                                                chartWrapperRef.current.getBoundingClientRect();
                                            const rect = evt.currentTarget.getBoundingClientRect();
                                            const centerX =
                                                rect.left - wrapperRect.left + rect.width / 2;

                                            setHoverInfo({
                                                bucket: b.bucket,
                                                subscription: sub,
                                                credits: cred,
                                                total: total,
                                                x: centerX,
                                            });
                                        };

                                        const clearHover = () => setHoverInfo(null);

                                        return (
                                            <g
                                                key={b.bucket}
                                                onMouseEnter={handleHover}
                                                onMouseMove={handleHover}
                                                onMouseLeave={clearHover}
                                            >
                                                {/* кредиты */}
                                                {credH > 0 && (
                                                    <rect
                                                        x={x}
                                                        y={credY}
                                                        width={barWidth}
                                                        height={credH}
                                                        fill={COLOR_CREDITS}
                                                        opacity="0.9"
                                                        rx={3}
                                                    />
                                                )}
                                                {/* подписки */}
                                                {subH > 0 && (
                                                    <rect
                                                        x={x}
                                                        y={subY}
                                                        width={barWidth}
                                                        height={subH}
                                                        fill={COLOR_SUBSCRIPTION}
                                                        opacity="0.9"
                                                        rx={3}
                                                    />
                                                )}
                                            </g>
                                        );
                                    });
                                })()}

                                {/* подписи по оси X прямо под барами */}
                                {(() => {
                                    const slotWidth = (chartWidth - 60) / buckets.length;

                                    return buckets.map((b, idx) => {
                                        const slotCenter =
                                            40 + slotWidth * idx + slotWidth / 2;
                                        const label =
                                            groupBy === "month"
                                                ? b.bucket.slice(0, 7)
                                                : b.bucket.slice(5); // MM-DD
                                        return (
                                            <text
                                                key={b.bucket}
                                                x={slotCenter}
                                                y={10 + chartHeight + 12}
                                                fontSize="9"
                                                fill={COLOR_AXIS_TEXT}
                                                textAnchor="middle"
                                            >
                                                {label}
                                            </text>
                                        );
                                    });
                                })()}
                            </svg>

                            {/* тултип по наведению */}
                            {hoverInfo && (
                                <div
                                    className={s.chartTooltip}
                                    style={{ left: hoverInfo.x }}
                                >
                                    <div className={s.chartTooltipTitle}>
                                        {formatBucketLabel(hoverInfo.bucket)}
                                    </div>
                                    <div className={s.chartTooltipRow}>
                                        <div>
                                            <div className={s.chartTooltipLabel}>Подписки</div>
                                            <div className={s.chartTooltipSub}>
                                                {fmtMoney(hoverInfo.subscription)} ₽
                                            </div>
                                        </div>
                                        <div>
                                            <div className={s.chartTooltipLabel}>Кредиты</div>
                                            <div className={s.chartTooltipCred}>
                                                {fmtMoney(hoverInfo.credits)} ₽
                                            </div>
                                        </div>
                                        <div>
                                            <div className={s.chartTooltipLabel}>Итого</div>
                                            <div className={s.chartTooltipTotal}>
                                                {fmtMoney(hoverInfo.total)} ₽
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Легенда + итоги */}
                        <div className={s.legendRow}>
                            <div className={s.legendItems}>
                                <LegendItem
                                    color={COLOR_SUBSCRIPTION}
                                    label="Подписки"
                                />
                                <LegendItem
                                    color={COLOR_CREDITS}
                                    label="Кредиты (разовые запросы)"
                                />
                            </div>

                            {totals && (
                                <div className={s.totalsRow}>
                                    <div>
                                        Подписки:&nbsp;
                                        <b>
                                            {fmtMoney(
                                                totals.by_kind?.subscription ?? 0
                                            )}{" "}
                                            ₽
                                        </b>
                                    </div>
                                    <div>
                                        Кредиты:&nbsp;
                                        <b>
                                            {fmtMoney(totals.by_kind?.credits ?? 0)} ₽
                                        </b>
                                    </div>
                                    <div className={s.totalsStrong}>
                                        Итого:&nbsp;
                                        <b>{fmtMoney(totals.grand_total ?? 0)} ₽</b>
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </section>
    );
}

function Card({ title, note, children, accent = false }) {
    return (
        <div className={accent ? s.kpiAccent : s.kpi}>
            <div className={s.kpiTitle}>{title}</div>
            <div className={s.kpiValue}>{children}</div>
            <div className={s.kpiNote}>{note}</div>
        </div>
    );
}

function LegendItem({ color, label }) {
    return (
        <div className={s.legendItem}>
            <span
                className={s.legendSwatch}
                style={{ backgroundColor: color }}
            />
            <span>{label}</span>
        </div>
    );
}
