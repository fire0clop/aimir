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
    subscribe,      // старый способ (без оплаты) — будем использовать как fallback
    addCredits,     // старый способ (без оплаты) — fallback
    subscribePay,   // новый init через T-Банк
    creditsPay,     // новый init через T-Банк
} from "../api/billing";
import { setTelegramId, deleteTelegramId } from "../api/users";

// ID счётчика Яндекс.Метрики
const METRIKA_ID = 104333423;

function trackGoal(name, params) {
    if (typeof window === "undefined") return;
    if (!window.ym) return;
    window.ym(METRIKA_ID, "reachGoal", name, params);
}
// Резервные цены из фронтового .env (если сервер не даст)
const FE_SUB_MONTH = Number(process.env.REACT_APP_SUB_PRICE_MONTH || process.env.SUB_PRICE_MONTH || 0);
const FE_SUB_6M = Number(process.env.REACT_APP_SUB_PRICE_6M || process.env.SUB_PRICE_6M || 0);
const FE_SUB_YEAR = Number(process.env.REACT_APP_SUB_PRICE_YEAR || process.env.SUB_PRICE_YEAR || 0);
const FE_REQ_PRICE = Number(process.env.REACT_APP_REQUEST_PRICE || process.env.REQUEST_PRICE || 0);

// Ключ терминала для integration.js (как в старом проекте)
const TBANK_TERMINAL_KEY = process.env.REACT_APP_TBANK_TERMINAL_KEY || "";

/* динамическая загрузка скрипта T-Банка */
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

export default function Billing() {
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState(null);
    const [prices, setPrices] = useState(null);
    const [err, setErr] = useState("");

    const [qty, setQty] = useState(1);

    // === состояние модалки с iframe оплаты ===
    const [frameOpen, setFrameOpen] = useState(false);
    const iframeContainerRef = useRef(null);

    // === состояния для Telegram-модалки ===
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

    // При открытии модалки Telegram — подставлять текущий telegram_id
    useEffect(() => {
        if (!tgOpen) return;
        setTgErr("");
        setTgId(status?.telegram_id ? String(status.telegram_id) : "");
    }, [tgOpen, status?.telegram_id]);

    const totalCreditsCost = useMemo(() => {
        const price = prices?.request_price ?? FE_REQ_PRICE;
        return Math.max(1, Number(qty || 1)) * Number(price || 0);
    }, [qty, prices]);

    // ----------------- init iframe оплаты (T-Банк) -----------------
    const initIframePayment = useCallback(async (paymentStartCallback) => {
        if (!TBANK_TERMINAL_KEY) {
            throw new Error("Не задан REACT_APP_TBANK_TERMINAL_KEY (T-Банк не сконфигурирован на фронте)");
        }

        await loadTbankScript();

        const container = iframeContainerRef.current;
        if (!container) throw new Error("Не найден контейнер платежной формы");
        container.innerHTML = "";

        const initConfig = {
            terminalKey: TBANK_TERMINAL_KEY,
            product: "eacq",
            features: {
                iframe: {
                    container,
                    paymentStartCallback, // должен вернуть PaymentURL (string)
                },
            },
        };

        await window.PaymentIntegration.init(initConfig);
    }, []);

    // ----------------- Подписка -----------------
    const onSubscribe = async (plan) => {
        // fallback: если T-Банк на фронте не настроен — работаем по старой схеме
        if (!hasTbank) {
            try {
                setBusy(true);
                setErr("");
                const s = await subscribe(plan);
                setStatus(s);
                // метрика: успешная подписка (fallback)
                trackGoal("payment_success", {
                    kind: "sub",
                    plan,
                    source: "fallback",
                });
            } catch (e) {
                setErr(parseErr(e));
            } finally {
                setBusy(false);
            }
            return;
        }

        // новая схема: init через T-Банк + iframe
        try {
            setBusy(true);
            setErr("");
            setFrameOpen(true);

            await initIframePayment(async () => {
                const data = await subscribePay(plan); // { payment_url, ... }

                if (data?.ok && !data?.payment_url) {
                    // теоретический мок-режим — на всякий случай
                    setFrameOpen(false);
                    await loadAll();
                    return "about:blank";
                }

                if (!data?.payment_url) {
                    throw new Error("payment_url не получен");
                }

                // запоминаем, что ждём подписку
                sessionStorage.setItem(
                    "pendingPayment",
                    JSON.stringify({
                        kind: "sub",
                        plan,
                        ts: Date.now(),
                    })
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

    // ----------------- Кредиты -----------------
    const onAddCredits = async () => {
        const n = Math.max(1, Math.floor(Number(qty || 1)));

        // fallback: старый способ без оплаты
        if (!hasTbank) {
            try {
                setBusy(true);
                setErr("");
                const s = await addCredits(n);
                setStatus(s);
                setQty(1);
                // метрика: успешная покупка кредитов (fallback)
                trackGoal("payment_success", {
                    kind: "credits",
                    qty: n,
                    source: "fallback",
                });
            } catch (e) {
                setErr(parseErr(e));
            } finally {
                setBusy(false);
            }
            return;
        }

        // новая схема: через T-Банк
        try {
            setBusy(true);
            setErr("");
            setFrameOpen(true);

            await initIframePayment(async () => {
                const data = await creditsPay(n); // { payment_url, quantity, ... }

                if (data?.ok && !data?.payment_url) {
                    // моковый сценарий
                    setFrameOpen(false);
                    await loadAll();
                    return "about:blank";
                }

                if (!data?.payment_url) {
                    throw new Error("payment_url не получен");
                }

                sessionStorage.setItem(
                    "pendingPayment",
                    JSON.stringify({
                        kind: "credits",
                        qty: n,
                        ts: Date.now(),
                    })
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

    // -------- представление периода подписки --------
    const periodText = (() => {
        const start = status?.subscription_start;
        const end = status?.subscription_end;
        if (!end) return "—";
        if (!start) return `до ${fmtDate(end)}`;
        return `${fmtDate(start)} — ${fmtDate(end)}`;
    })();

    // ----------------- Пуллинг статуса при открытом iframe -----------------
    useEffect(() => {
        if (!frameOpen) return;

        let timer = null;
        let aborted = false;

        (async () => {
            const pendingRaw = sessionStorage.getItem("pendingPayment");
            if (!pendingRaw) return;

            let pending;
            try {
                pending = JSON.parse(pendingRaw);
            } catch {
                return;
            }

            let baseStatus = null;
            try {
                baseStatus = await getBillingStatus();
            } catch {
                // если не получилось — просто будем проверять только текущее
            }
            const baseCredits = Number(baseStatus?.credits ?? 0);
            const baseEnd = baseStatus?.subscription_end || null;

            const startedAt = Date.now();
            const deadlineMs = 2 * 60 * 1000; // 2 минуты

            const tick = async () => {
                if (aborted) return;
                if (Date.now() - startedAt > deadlineMs) {
                    clearInterval(timer);
                    return;
                }
                try {
                    const cur = await getBillingStatus();
                    const curCredits = Number(cur?.credits ?? 0);
                    const curEnd = cur?.subscription_end || null;

                    let done = false;

                    if (pending.kind === "credits" && curCredits > baseCredits) {
                        done = true;
                    }
                    if (pending.kind === "sub" && curEnd && curEnd !== baseEnd) {
                        done = true;
                    }

                    if (done) {
                        clearInterval(timer);
                        // метрика: успешная оплата через T-Банк
                        if (pending.kind === "sub") {
                            trackGoal("payment_success", {
                                kind: "sub",
                                plan: pending.plan,
                                source: "tbank",
                            });
                        } else if (pending.kind === "credits") {
                            trackGoal("payment_success", {
                                kind: "credits",
                                qty: pending.qty,
                                source: "tbank",
                            });
                        }
                        sessionStorage.removeItem("pendingPayment");
                        setFrameOpen(false);
                        setStatus(cur); // обновим статус на странице
                    }
                } catch {
                    // просто игнорируем ошибку при одном тике
                }
            };

            await tick();
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
        return () => {
            document.body.style.overflow = prevOverflow;
        };
    }, [frameOpen]);

    // закрытие модалки по Escape
    useEffect(() => {
        if (!frameOpen) return;
        const onKeyDown = (e) => {
            if (e.key === "Escape") setFrameOpen(false);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [frameOpen]);

    return (
        <div className={styles.page}>
            <div className={styles.wrap}>
                {/* Кнопка привязки Telegram над заголовком */}
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
                    <button
                        className={styles.primary}
                        type="button"
                        onClick={() => setTgOpen(true)}
                        disabled={loading || busy}
                    >
                        Привязать Telegram
                    </button>
                </div>

                <h1 className={styles.title}>Биллинг</h1>

                {err && <div className={styles.alert}>{err}</div>}

                {loading ? (
                    <div className={styles.skel}>Загружаем цены и статус…</div>
                ) : (
                    <>
                        {/* Статус */}
                        <section className={styles.card}>
                            <h2 className={styles.h2}>Ваш статус</h2>
                            <div className={styles.grid2}>
                                <div>
                                    <div className={styles.kv}>
                                        <div className={styles.k}>Подписка:</div>
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
                                        <div className={styles.k}>Период:</div>
                                        <div className={styles.v}>{periodText}</div>
                                    </div>
                                </div>
                                <div>
                                    <div className={styles.kv}>
                                        <div className={styles.k}>Кредиты (запросы):</div>
                                        <div className={styles.v}>
                                            <b>{status?.credits ?? 0}</b>
                                        </div>
                                    </div>
                                    <div className={styles.kv}>
                                        <div className={styles.k}>Telegram ID:</div>
                                        <div className={styles.v}>
                                            <b>{status?.telegram_id || "не привязан"}</b>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Подписка */}
                        <section className={styles.card}>
                            <h2 className={styles.h2}>Подписка</h2>
                            <div className={styles.plans}>
                                <Plan
                                    title="1 месяц"
                                    price={prices?.sub_month ?? FE_SUB_MONTH}
                                    note="Доступ ко всем функциям"
                                    onClick={() => onSubscribe("month")}
                                    disabled={busy}
                                />
                                <Plan
                                    title="6 месяцев"
                                    price={prices?.sub_6m ?? FE_SUB_6M}
                                    note="Экономия по сравнению с месяцем"
                                    onClick={() => onSubscribe("6m")}
                                    disabled={busy}
                                />
                                <Plan
                                    title="12 месяцев"
                                    price={prices?.sub_year ?? FE_SUB_YEAR}
                                    note="Лучшее предложение"
                                    onClick={() => onSubscribe("year")}
                                    disabled={busy}
                                    best
                                />
                            </div>
                            <div className={styles.hintRow}>
                            </div>
                        </section>

                        {/* Кредиты */}
                        <section className={styles.card}>
                            <h2 className={styles.h2}>Кредиты (разовые запросы)</h2>
                            <div className={styles.creditsRow}>
                                <div className={styles.qtyBlock}>
                                    <label className={styles.lbl}>Количество</label>
                                    <div className={styles.qtyLine}>
                                        <button type="button" className={styles.qtyBtn} onClick={() => setQty(1)}>
                                            1
                                        </button>
                                        <button type="button" className={styles.qtyBtn} onClick={() => setQty(5)}>
                                            5
                                        </button>
                                        <button type="button" className={styles.qtyBtn} onClick={() => setQty(10)}>
                                            10
                                        </button>
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
                                        <span>Стоимость за 1 запрос:</span>
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
                                    Оплата происходит через T-Банк; после успешной оплаты кредиты начислятся автоматически.
                                </span>
                            </div>
                        </section>
                    </>
                )}
            </div>

            {/* Модалка с iframe платёжной формы T-Банк */}
            {frameOpen && (
                <div
                    className={styles.iframeOverlay}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Платёжная форма"
                    onMouseDown={(e) => {
                        if (e.target === e.currentTarget) setFrameOpen(false);
                    }}
                >
                    <div className={styles.iframeCard}>
                        <button
                            className={styles.iframeClose}
                            aria-label="Закрыть"
                            onClick={() => setFrameOpen(false)}
                        >
                            ×
                        </button>
                        <div
                            ref={iframeContainerRef}
                            className={styles.iframeContainer}
                        />
                    </div>
                </div>
            )}

            {/* Модалка привязки Telegram */}
            {tgOpen && (
                <div
                    className={styles.iframeOverlay}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Привязка Telegram"
                    onMouseDown={(e) => {
                        if (e.target === e.currentTarget) setTgOpen(false);
                    }}
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

                        <h2 className={styles.h2}>Привязка Telegram</h2>

                        <div className={styles.hintRow}>
                            <div className={styles.hint}>
                                1) Открой бота:{" "}
                                <a href="https://t.me/AIMir_Tech_bot" target="_blank" rel="noreferrer">
                                    @AIMir_Tech_bot
                                </a>
                                <br />
                                2) Нажми <b>/start</b>, бот пришлёт твой Telegram ID
                                <br />
                                3) Вставь Telegram ID сюда и нажми «Сохранить»
                            </div>
                        </div>

                        <div style={{ marginTop: 14 }}>
                            <label className={styles.lbl}>Telegram ID</label>
                            <input
                                className={`${styles.qtyInput} ${styles.fullInput}`}
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
                        </div>

                        {tgErr && <div className={styles.alert} style={{ marginTop: 12 }}>{tgErr}</div>}

                        <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "flex-end" }}>
                            <button
                                className={styles.qtyBtn}
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

function Plan({ title, price, note, onClick, disabled, best }) {
    return (
        <div className={`${styles.plan} ${best ? styles.planBest : ""}`}>
            {best && <div className={styles.ribbon}>хит</div>}
            <div className={styles.planTitle}>{title}</div>
            <div className={styles.planPrice}>{price || 0} ₽</div>
            <div className={styles.planNote}>{note}</div>
            <button
                className={styles.primary}
                onClick={() => {
                    trackGoal("go_billing");
                    onClick();
                }}
                disabled={disabled}
            >
                Оформить
            </button>


        </div>
    );
}

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