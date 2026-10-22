import React, {
    useEffect,
    useMemo,
    useState,
    useCallback,
    useRef,
} from "react";
import styles from "./Billing.module.css";
import {
    getPrices,
    getBillingStatus,
    subscribe,
    addCredits,
    subscribePay,
    creditsPay,
} from "../api/billing";
import { setTelegramId, deleteTelegramId } from "../api/users";

// ─── Метрика ──────────────────────────────────────────────────
const METRIKA_ID = 104333423;

function trackGoal(name, params) {
    if (typeof window === "undefined") return;
    if (!window.ym) return;
    window.ym(METRIKA_ID, "reachGoal", name, params);
}

// ─── Резервные цены из .env ───────────────────────────────────
const FE_SUB_MONTH = Number(process.env.REACT_APP_SUB_PRICE_MONTH || process.env.SUB_PRICE_MONTH || 0);
const FE_SUB_6M    = Number(process.env.REACT_APP_SUB_PRICE_6M    || process.env.SUB_PRICE_6M    || 0);
const FE_SUB_YEAR  = Number(process.env.REACT_APP_SUB_PRICE_YEAR  || process.env.SUB_PRICE_YEAR  || 0);
const FE_REQ_PRICE = Number(process.env.REACT_APP_REQUEST_PRICE   || process.env.REQUEST_PRICE   || 0);

const TBANK_TERMINAL_KEY = process.env.REACT_APP_TBANK_TERMINAL_KEY || "";

// ─── Загрузка скрипта T-Банка ─────────────────────────────────
function loadTbankScript() {
    return new Promise((resolve, reject) => {
        if (window.PaymentIntegration) return resolve();
        const s = document.createElement("script");
        s.src = "https://integrationjs.tbank.ru/integration.js";
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Не удалось загрузить скрипт оплаты"));
        document.body.appendChild(s);
    });
}

// ─── CheckIcon ────────────────────────────────────────────────
function CheckIcon() {
    return (
        <svg className={styles.checkIcon} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    );
}

// ─── Plan card ────────────────────────────────────────────────
function Plan({ title, price, note, features, onClick, disabled, best }) {
    return (
        <div className={[styles.plan, best ? styles.planBest : ""].join(" ")}>
            {best && <div className={styles.ribbon}>Популярный</div>}
            <div className={styles.planTitle}>{title}</div>
            <div className={styles.planPrice}>{price || 0} <span className={styles.priceCur}>₽</span></div>
            <div className={styles.planNote}>{note}</div>
            {features && features.length > 0 && (
                <ul className={styles.planFeatures}>
                    {features.map((f, i) => (
                        <li key={i} className={styles.planFeature}>
                            <CheckIcon />
                            {f}
                        </li>
                    ))}
                </ul>
            )}
            <div className={styles.planCta}>
                <button
                    className={[styles.primary, styles.planCtaFull, !best ? styles.planBtnGhost : ""].join(" ")}
                    onClick={() => {
                        trackGoal("go_billing");
                        onClick();
                    }}
                    disabled={disabled}
                >
                    Оформить
                </button>
            </div>
        </div>
    );
}

// ─── Main component ────────────────────────────────────────────
export default function Billing() {
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState(null);
    const [prices, setPrices] = useState(null);
    const [err, setErr] = useState("");

    const [qty, setQty] = useState(1);

    const [frameOpen, setFrameOpen] = useState(false);
    const iframeContainerRef = useRef(null);

    const [tgOpen, setTgOpen] = useState(false);
    const [tgId, setTgId] = useState("");
    const [tgBusy, setTgBusy] = useState(false);
    const [tgErr, setTgErr] = useState("");

    const hasTbank = Boolean(TBANK_TERMINAL_KEY);

    const loadAll = async () => {
        try {
            setLoading(true);
            setErr("");
            const [p, s] = await Promise.all([getPrices(), getBillingStatus()]);
            setPrices(p);
            setStatus(s);
        } catch (e) {
            setErr(parseErr(e));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadAll();
    }, []);

    useEffect(() => {
        if (!tgOpen) return;
        setTgErr("");
        setTgId(status?.telegram_id ? String(status.telegram_id) : "");
    }, [tgOpen, status?.telegram_id]);

    const totalCreditsCost = useMemo(() => {
        const price = prices?.request_price ?? FE_REQ_PRICE;
        return Math.max(1, Number(qty || 1)) * Number(price || 0);
    }, [qty, prices]);

    // ─── Init iframe оплаты ───────────────────────────────────
    const initIframePayment = useCallback(async (paymentStartCallback) => {
        if (!TBANK_TERMINAL_KEY) {
            throw new Error("Не задан REACT_APP_TBANK_TERMINAL_KEY");
        }

        await loadTbankScript();

        // контейнер рендерится в той же итерации, что и setFrameOpen(true) —
        // даём React время смонтировать модалку
        let container = iframeContainerRef.current;
        for (let i = 0; i < 20 && !container; i++) {
            await new Promise((r) => setTimeout(r, 50));
            container = iframeContainerRef.current;
        }
        if (!container) throw new Error("Не найден контейнер платёжной формы");
        container.innerHTML = "";

        await window.PaymentIntegration.init({
            terminalKey: TBANK_TERMINAL_KEY,
            product: "eacq",
            features: {
                iframe: {
                    container,
                    paymentStartCallback,
                },
            },
        });
    }, []);

    // ─── Подписка ─────────────────────────────────────────────
    const onSubscribe = async (plan) => {
        if (!hasTbank) {
            try {
                setBusy(true);
                setErr("");
                const s = await subscribe(plan);
                setStatus(s);
                trackGoal("payment_success", { kind: "sub", plan, source: "fallback" });
            } catch (e) {
                setErr(parseErr(e));
            } finally {
                setBusy(false);
            }
            return;
        }

        try {
            setBusy(true);
            setErr("");
            sessionStorage.removeItem("pendingPayment"); // не тащим хвост прошлой попытки
            setFrameOpen(true);

            await initIframePayment(async () => {
                const data = await subscribePay(plan);

                if (data?.ok && !data?.payment_url) {
                    setFrameOpen(false);
                    await loadAll();
                    return "about:blank";
                }

                if (!data?.payment_url) throw new Error("payment_url не получен");

                sessionStorage.setItem(
                    "pendingPayment",
                    JSON.stringify({ kind: "sub", plan, ts: Date.now() })
                );

                return data.payment_url;
            });
        } catch (e) {
            setErr(parseErr(e));
            setFrameOpen(false);
        } finally {
            setBusy(false);
        }
    };

    // ─── Кредиты ──────────────────────────────────────────────
    const onAddCredits = async () => {
        const n = Math.max(1, Math.floor(Number(qty || 1)));

        if (!hasTbank) {
            try {
                setBusy(true);
                setErr("");
                const s = await addCredits(n);
                setStatus(s);
                setQty(1);
                trackGoal("payment_success", { kind: "credits", qty: n, source: "fallback" });
            } catch (e) {
                setErr(parseErr(e));
            } finally {
                setBusy(false);
            }
            return;
        }

        try {
            setBusy(true);
            setErr("");
            sessionStorage.removeItem("pendingPayment"); // не тащим хвост прошлой попытки
            setFrameOpen(true);

            await initIframePayment(async () => {
                const data = await creditsPay(n);

                if (data?.ok && !data?.payment_url) {
                    setFrameOpen(false);
                    await loadAll();
                    return "about:blank";
                }

                if (!data?.payment_url) throw new Error("payment_url не получен");

                sessionStorage.setItem(
                    "pendingPayment",
                    JSON.stringify({ kind: "credits", qty: n, ts: Date.now() })
                );

                return data.payment_url;
            });
        } catch (e) {
            setErr(parseErr(e));
            setFrameOpen(false);
        } finally {
            setBusy(false);
        }
    };

    // ─── Период подписки ──────────────────────────────────────
    const periodText = (() => {
        const start = status?.subscription_start;
        const end = status?.subscription_end;
        if (!end) return "—";
        if (!start) return `до ${fmtDate(end)}`;
        return `${fmtDate(start)} — ${fmtDate(end)}`;
    })();

    // ─── Пуллинг статуса при открытом iframe ─────────────────
    // Важно: pendingPayment записывается ПОЗЖЕ открытия модалки (внутри
    // paymentStartCallback), поэтому читаем его на каждом тике, а не один раз.
    useEffect(() => {
        if (!frameOpen) return;

        let timer = null;
        let aborted = false;

        (async () => {
            // базовый статус фиксируем сразу — до того, как платёж мог пройти
            let baseStatus = null;
            try { baseStatus = await getBillingStatus(); } catch {}
            const baseCredits = Number(baseStatus?.credits ?? 0);
            const baseEnd = baseStatus?.subscription_end || null;

            const startedAt = Date.now();
            const deadlineMs = 10 * 60 * 1000; // ввод карты + 3DS занимают время

            const tick = async () => {
                if (aborted) return;
                if (Date.now() - startedAt > deadlineMs) {
                    clearInterval(timer);
                    return;
                }

                const pendingRaw = sessionStorage.getItem("pendingPayment");
                if (!pendingRaw) return; // платёж ещё не инициирован

                let pending;
                try { pending = JSON.parse(pendingRaw); } catch { return; }

                try {
                    const cur = await getBillingStatus();
                    const curCredits = Number(cur?.credits ?? 0);
                    const curEnd = cur?.subscription_end || null;

                    let done = false;
                    if (pending.kind === "credits" && curCredits > baseCredits) done = true;
                    if (pending.kind === "sub" && curEnd && curEnd !== baseEnd) done = true;

                    if (done) {
                        clearInterval(timer);
                        if (pending.kind === "sub") {
                            trackGoal("payment_success", { kind: "sub", plan: pending.plan, source: "tbank" });
                        } else if (pending.kind === "credits") {
                            trackGoal("payment_success", { kind: "credits", qty: pending.qty, source: "tbank" });
                        }
                        sessionStorage.removeItem("pendingPayment");
                        setFrameOpen(false);
                        setStatus(cur);
                    }
                } catch {}
            };

            timer = setInterval(tick, 2000);
        })();

        return () => {
            aborted = true;
            if (timer) clearInterval(timer);
        };
    }, [frameOpen]);

    // блокировка скролла при открытой модалке
    useEffect(() => {
        if (!frameOpen) return;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = prevOverflow; };
    }, [frameOpen]);

    // закрытие по Escape
    useEffect(() => {
        if (!frameOpen) return;
        const onKeyDown = (e) => { if (e.key === "Escape") setFrameOpen(false); };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [frameOpen]);

    // ─── Render ───────────────────────────────────────────────
    return (
        <div className={styles.page}>
            <div className={styles.wrap}>

                {/* top row */}
                <div className={styles.topRow}>
                    <h1 className={styles.title}>Биллинг</h1>
                    <button
                        className={styles.ghost}
                        type="button"
                        onClick={() => setTgOpen(true)}
                        disabled={loading || busy}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13" />
                            <polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                        Привязать Telegram
                    </button>
                </div>

                {err && <div className={styles.alert}>{err}</div>}

                {loading ? (
                    <div className={styles.skel}>Загружаем цены и статус…</div>
                ) : (
                    <>
                        {/* ── 1. Статус ── */}
                        <section className={styles.card}>
                            <h2 className={styles.h2}>Ваш статус</h2>
                            <div className={styles.grid2}>
                                <div>
                                    <div className={styles.kv}>
                                        <div className={styles.k}>Подписка</div>
                                        <div className={styles.v}>
                                            {status?.active ? (
                                                <span className={styles.badgeOk}>Активна</span>
                                            ) : status?.has_subscription ? (
                                                <span className={styles.badgeWarn}>Неактивна</span>
                                            ) : (
                                                <span className={styles.badge}>Нет</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className={styles.kv}>
                                        <div className={styles.k}>Период</div>
                                        <div className={styles.v}>{periodText}</div>
                                    </div>
                                </div>
                                <div>
                                    <div className={styles.kv}>
                                        <div className={styles.k}>Кредиты</div>
                                        <div className={styles.v}>
                                            <span className={styles.creditsCount}>{status?.credits ?? 0}</span>
                                            <span className={styles.creditsUnit}>запросов</span>
                                        </div>
                                    </div>
                                    <div className={styles.kv}>
                                        <div className={styles.k}>Telegram ID</div>
                                        <div className={styles.v}>
                                            {status?.telegram_id
                                                ? <b>{status.telegram_id}</b>
                                                : <span style={{ color: "var(--muted)" }}>не привязан</span>}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* ── 2. Тарифы ── */}
                        <section className={styles.card}>
                            <h2 className={styles.h2}>Подписка</h2>
                            <div className={styles.plans}>
                                <Plan
                                    title="1 месяц"
                                    price={prices?.sub_month ?? FE_SUB_MONTH}
                                    note="Полный доступ на 30 дней"
                                    features={["Все анализы без ограничений", "Скачивание в .docx", "Приоритетная поддержка"]}
                                    onClick={() => onSubscribe("month")}
                                    disabled={busy}
                                />
                                <Plan
                                    title="6 месяцев"
                                    price={prices?.sub_6m ?? FE_SUB_6M}
                                    note="Экономия по сравнению с помесячной оплатой"
                                    features={["Все анализы без ограничений", "Скачивание в .docx", "Приоритетная поддержка", "Экономия ~15%"]}
                                    onClick={() => onSubscribe("6m")}
                                    disabled={busy}
                                />
                                <Plan
                                    title="12 месяцев"
                                    price={prices?.sub_year ?? FE_SUB_YEAR}
                                    note="Лучшее предложение — максимальная экономия"
                                    features={["Все анализы без ограничений", "Скачивание в .docx", "Приоритетная поддержка", "Экономия ~30%"]}
                                    onClick={() => onSubscribe("year")}
                                    disabled={busy}
                                    best
                                />
                            </div>
                        </section>

                        {/* ── 3. Кредиты ── */}
                        <section className={styles.card}>
                            <h2 className={styles.h2}>Кредиты — разовые запросы</h2>
                            <div className={styles.creditsRow}>
                                <div className={styles.qtyBlock}>
                                    <label className={styles.lbl}>Количество</label>
                                    <div className={styles.qtyLine}>
                                        {[1, 5, 10].map(n => (
                                            <button
                                                key={n}
                                                type="button"
                                                className={styles.qtyBtn}
                                                onClick={() => setQty(n)}
                                                disabled={busy}
                                            >
                                                {n}
                                            </button>
                                        ))}
                                        <input
                                            className={styles.qtyInput}
                                            type="number"
                                            min={1}
                                            step={1}
                                            value={qty}
                                            onChange={(e) => setQty(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className={styles.costBlock}>
                                    <div className={styles.costLine}>
                                        <span>За 1 запрос:</span>
                                        <b>{(prices?.request_price ?? FE_REQ_PRICE) || 0} ₽</b>
                                    </div>
                                    <div className={styles.costLine}>
                                        <span>Итого:</span>
                                        <b>{totalCreditsCost} ₽</b>
                                    </div>
                                </div>

                                <div className={styles.buyBlock}>
                                    <button
                                        className={styles.primary}
                                        onClick={() => {
                                            trackGoal("go_billing");
                                            onAddCredits();
                                        }}
                                        disabled={busy}
                                    >
                                        Купить кредиты
                                    </button>
                                </div>
                            </div>
                            <div className={styles.hintRow}>
                                <span className={styles.hint}>
                                    Оплата через T-Банк. Кредиты начисляются автоматически после подтверждения оплаты.
                                </span>
                            </div>
                        </section>
                    </>
                )}
            </div>

            {/* ── Платёжный iframe ── */}
            {frameOpen && (
                <div
                    className={styles.iframeOverlay}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Платёжная форма"
                    onMouseDown={(e) => { if (e.target === e.currentTarget) setFrameOpen(false); }}
                >
                    <div className={styles.iframeCard}>
                        <button
                            className={styles.iframeClose}
                            aria-label="Закрыть"
                            onClick={() => setFrameOpen(false)}
                        >
                            ×
                        </button>
                        <div ref={iframeContainerRef} className={styles.iframeContainer} />
                    </div>
                </div>
            )}

            {/* ── Telegram модалка ── */}
            {tgOpen && (
                <div
                    className={styles.iframeOverlay}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Привязка Telegram"
                    onMouseDown={(e) => { if (e.target === e.currentTarget) setTgOpen(false); }}
                >
                    <div className={styles.iframeCard}>
                        <button
                            className={styles.iframeClose}
                            aria-label="Закрыть"
                            onClick={() => setTgOpen(false)}
                            type="button"
                        >
                            ×
                        </button>

                        <h2 className={styles.h2} style={{ marginBottom: 16 }}>Привязка Telegram</h2>

                        <div className={styles.hintRow} style={{ marginBottom: 16 }}>
                            <div className={styles.hint}>
                                1) Открой бота:{" "}
                                <a href="https://t.me/AIMir_Tech_bot" target="_blank" rel="noreferrer">
                                    @AIMir_Tech_bot
                                </a>
                                <br />
                                2) Нажми <b>/start</b> — бот пришлёт твой Telegram ID
                                <br />
                                3) Вставь ID сюда и нажми «Сохранить»
                            </div>
                        </div>

                        <label className={styles.lbl}>Telegram ID</label>
                        <input
                            className={[styles.qtyInput, styles.fullInput].join(" ")}
                            value={tgId}
                            onChange={(e) => setTgId(e.target.value)}
                            placeholder="например: 123456789"
                            inputMode="numeric"
                        />

                        <div className={styles.hintRow}>
                            <span className={styles.hint}>
                                Текущий:{" "}
                                <b>{status?.telegram_id ? String(status.telegram_id) : "не привязан"}</b>
                            </span>
                        </div>

                        {tgErr && (
                            <div className={styles.alert} style={{ marginTop: 12 }}>
                                {tgErr}
                            </div>
                        )}

                        <div className={styles.tgActions}>
                            <button
                                className={styles.ghost}
                                type="button"
                                disabled={tgBusy || !status?.telegram_id}
                                onClick={async () => {
                                    try {
                                        setTgBusy(true);
                                        setTgErr("");
                                        await deleteTelegramId();
                                        await loadAll();
                                        setTgId("");
                                        setTgOpen(false);
                                    } catch (e) {
                                        setTgErr(parseErr(e));
                                    } finally {
                                        setTgBusy(false);
                                    }
                                }}
                            >
                                Удалить
                            </button>

                            <button
                                className={styles.primary}
                                type="button"
                                disabled={tgBusy || !String(tgId || "").trim()}
                                onClick={async () => {
                                    try {
                                        setTgBusy(true);
                                        setTgErr("");
                                        await setTelegramId(tgId);
                                        await loadAll();
                                        setTgOpen(false);
                                    } catch (e) {
                                        setTgErr(parseErr(e));
                                    } finally {
                                        setTgBusy(false);
                                    }
                                }}
                            >
                                Сохранить
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Utils ────────────────────────────────────────────────────
function fmtDate(d) {
    try {
        const dt = new Date(d);
        return dt.toLocaleDateString("ru-RU");
    } catch {
        return d || "—";
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
