// src/components/Upload/Upload.jsx
import React, { useEffect, useRef, useState } from "react";
import s from "./Upload.module.css";
import { useAuth } from "../../context/AuthContext";
import {
    ensureGuest,
    uploadUserDocument,
    uploadGuestDocument,
    claimGuestDocuments,
    loadGuestToken,
    clearGuest,
} from "../../api/documents";
import {
    analyzeParties,
    selectParty,
    unlockAnalysis,
    sendAnalysisFeedback,
    getSeverityInfo,
    getDangerScoreColor,
    getDangerScoreText,
} from "../../api/analysis";
import demoReport from "../../assets/Договор_аренды_анализ.docx";

// ID счётчика Яндекс.Метрики
const METRIKA_ID = 104333423;

function trackGoal(name, params) {
    if (typeof window === "undefined") return;
    if (!window.ym) return;
    window.ym(METRIKA_ID, "reachGoal", name, params);
}

export default function Upload() {
    const { user } = useAuth();

    useEffect(() => {
        trackGoal("visit_upload");
    }, []);

    // UI state
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [ok, setOk] = useState("");
    const [dragOver, setDragOver] = useState(false);
    const fileRef = useRef(null);

    // Документ/аналитика
    const [docId, setDocId] = useState(null);
    const [parties, setParties] = useState([]);
    const [partiesLoading, setPartiesLoading] = useState(false);
    const [selectedParty, setSelectedParty] = useState("");
    const [selectBusy, setSelectBusy] = useState(false);
    const [analysisId, setAnalysisId] = useState(null);
    const [analysis, setAnalysis] = useState(null);
    const [access, setAccess] = useState(null);

    // Фидбек по аналитике
    const [feedbackKind, setFeedbackKind] = useState(null);
    const [feedbackBusy, setFeedbackBusy] = useState(false);

    // Модалка оплаты / доступа
    const [showPayModal, setShowPayModal] = useState(false);

    // Состояние раскрытых issue
    const [expandedIssues, setExpandedIssues] = useState({});

    const toggleIssue = (index) => {
        setExpandedIssues(prev => ({
            ...prev,
            [index]: !prev[index]
        }));
    };

    // Гостю — гарантируем guest_token
    useEffect(() => {
        if (!user) ensureGuest().catch(() => {});
    }, [user]);

    // После логина переносим гостевые документы
    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!user) return;
            const token = loadGuestToken();
            if (!token) return;
            try {
                const res = await claimGuestDocuments();
                if (!cancelled && res?.moved > 0) {
                    setOk(`Перенесено документов: ${res.moved}`);
                    clearGuest();
                }
            } catch (e) {
                if (!cancelled) setErr(parseErr(e));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [user]);

    const resetState = () => {
        setDocId(null);
        setParties([]);
        setPartiesLoading(false);
        setSelectedParty("");
        setSelectBusy(false);
        setAnalysisId(null);
        setAnalysis(null);
        setAccess(null);
        setFeedbackKind(null);
        setFeedbackBusy(false);
        setExpandedIssues({});
    };

    const onPick = () => fileRef.current?.click();

    const handleFiles = async (files) => {
        if (!files?.length) return;
        const file = files[0];

        try {
            setBusy(true);
            setErr("");
            setOk("");
            resetState();

            let uploadRes;
            if (user) {
                uploadRes = await uploadUserDocument(file);
            } else {
                await ensureGuest();
                uploadRes = await uploadGuestDocument(file);
            }

            const newDocId = uploadRes?.id;
            if (!newDocId) throw new Error("Не получили id документа от сервера.");
            setDocId(newDocId);
            setOk(`Файл "${file.name}" успешно загружен.`);

            trackGoal("upload_doc", {
                is_auth: !!user,
                file_ext: file.name.split(".").pop()?.toLowerCase(),
                file_size: file.size,
            });

            setPartiesLoading(true);
            const res = await analyzeParties({ documentId: newDocId, force: true });
            const found = Array.isArray(res?.parties) ? res.parties : [];
            setParties(found);

            if (found.length === 0) {
                setOk((prev) => (prev ? prev + " · " : "") + "Стороны не найдены.");
            } else {
                setOk((prev) => (prev ? prev + " · " : "") + "Выберите сторону для анализа.");
            }
        } catch (e) {
            setErr(parseErr(e));
        } finally {
            setBusy(false);
            setPartiesLoading(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    const onInputChange = (e) => handleFiles(e.target.files);

    const onDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
    };

    const onSelectParty = async (party) => {
        if (selectedParty) return;

        setSelectedParty(party);
        trackGoal("select_party", {
            party,
            is_auth: !!user,
        });
        setErr("");
        setOk("");
        setAnalysis(null);
        setAnalysisId(null);
        setAccess(null);
        setFeedbackKind(null);
        setExpandedIssues({});

        if (!docId) {
            setErr("Сначала загрузите документ.");
            return;
        }

        try {
            setSelectBusy(true);
            const res = await selectParty({ documentId: docId, selectedParty: party });

            const newAnalysis = res?.analysis || null;
            const newAccess = res?.access || null;

            setAnalysisId(res?.analysis_id || null);
            setAnalysis(newAnalysis);
            setAccess(newAccess);
            setFeedbackKind(res?.feedback_kind || null);

            if (user) {
                setOk("Сторона зафиксирована и аналитика выполнена.");
            } else {
                setOk("Аналитика по выбранной стороне выполнена в гостевом режиме.");
            }

            const isGuestNow = !user;
            const modeNow = newAccess?.mode || (isGuestNow ? "guest" : null);
            if (newAnalysis && (isGuestNow || modeNow === "preview")) {
                setShowPayModal(true);
            }
        } catch (e) {
            setErr(parseErr(e));
        } finally {
            setSelectBusy(false);
        }
    };

    const onUnlock = async () => {
        if (!analysisId) {
            setErr("Нет ID аналитики для разблокировки.");
            return;
        }
        try {
            setSelectBusy(true);
            setErr("");
            setOk("");

            const res = await unlockAnalysis(analysisId);
            setAnalysis(res?.analysis || null);
            setAccess(res?.access || null);
            setAnalysisId(res?.analysis_id || analysisId);
            setFeedbackKind(res?.feedback_kind || null);

            setOk("Полная аналитика разблокирована.");
            setShowPayModal(false);
        } catch (e) {
            const msg = parseErr(e);
            setErr(msg);
        } finally {
            setSelectBusy(false);
        }
    };

    const onFeedback = async (kind) => {
        if (!analysisId) return;
        if (!user) return;
        if (!access || access.mode !== "full") return;

        try {
            setFeedbackBusy(true);
            setErr("");

            const res = await sendAnalysisFeedback({
                analysisId,
                feedbackKind: kind,
            });

            setAnalysis(res?.analysis || analysis);
            setAccess(res?.access || access);
            setAnalysisId(res?.analysis_id || analysisId);
            setFeedbackKind(kind);

            setOk("Спасибо за вашу оценку!");
            setTimeout(() => {
                setOk((prev) =>
                    prev === "Спасибо за вашу оценку!" ? "" : prev
                );
            }, 3000);
        } catch (e) {
            setErr(parseErr(e));
        } finally {
            setFeedbackBusy(false);
        }
    };

    const disabled = busy || partiesLoading || selectBusy;

    const isGuest = !user;
    const mode = access?.mode || (isGuest ? "guest" : null);
    const hasSubscription = !!access?.has_subscription;
    const credits = access?.credits ?? 0;
    const canUnlock = !!access?.can_unlock;

    const showLockCta = !!analysis && (isGuest || mode === "preview");
    const showModal = showPayModal && !!analysis && (isGuest || mode === "preview");

    const canShowFeedback =
        !!analysis && !!analysisId && !isGuest && mode === "full";
    const showFeedbackButtons = canShowFeedback && !feedbackKind;

    const dangerScore = analysis?.overall_assessment?.danger_score ?? null;
    const verdict = analysis?.overall_assessment?.verdict ?? "";
    const summary = analysis?.summary ?? "";
    const issues = analysis?.issues ?? [];

    const showInitialHero = !docId && !analysis;

    const headerBlock = (
        <header className={s.header}>
            <h2 className={s.h2}>Загрузка документов</h2>
            <p className={s.sub}>
                Поддерживаются PDF, DOC, DOCX.{" "}
                {user
                    ? "Файл привяжется к вашему аккаунту. После загрузки определим стороны и выполним аналитику по выбранной."
                    : "Загрузка как гость: определим стороны и выполним аналитику, данные можно будет перенести в аккаунт при регистрации."}
            </p>
        </header>
    );

    const statusBlock = (
        <div className={s.statusRow}>
            {err && <div className={s.alert}>{err}</div>}
            {ok && <div className={s.okMuted}>{ok}</div>}
        </div>
    );

    const uploadBlock = (
        <div className={s.uploadArea}>
            <div
                className={`${s.drop} ${dragOver ? s.over : ""} ${
                    disabled ? s.disabled : ""
                }`}
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                role="button"
                tabIndex={0}
                aria-disabled={disabled}
                aria-busy={busy || partiesLoading}
                onKeyDown={(e) => {
                    if (!disabled && (e.key === "Enter" || e.key === " ")) onPick();
                }}
            >
                <div className={s.dropInner}>
                    <div className={s.dropIcon}>⬆</div>
                    <div className={s.dropText}>
                        Перетащите файл сюда или{" "}
                        <button
                            className={s.linkBtn}
                            onClick={onPick}
                            disabled={disabled}
                            type="button"
                        >
                            выберите
                        </button>
                    </div>
                    <div className={s.dropHint}>
                        Максимальный размер и другие ограничения вы можете уточнить в тарифах.
                    </div>
                </div>
                <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className={s.input}
                    onChange={onInputChange}
                    disabled={disabled}
                />
            </div>
        </div>
    );

    return (
        <section id="upload" className={s.section}>
            <div className={s.wrap}>
                {showInitialHero ? (
                    <div className={s.initialLayout}>
                        <div className={s.initialLeft}>
                            {headerBlock}
                            {statusBlock}
                            {uploadBlock}

                            <ul className={s.initialFeatures}>
                                <li className={s.initialFeatureItem}>
                                    <span className={s.initialFeatureDot} />
                                    Анализ за 30 секунд
                                </li>
                                <li className={s.initialFeatureItem}>
                                    <span className={s.initialFeatureDot} />
                                    20+ критериев проверки
                                </li>
                                <li className={s.initialFeatureItem}>
                                    <span className={s.initialFeatureDot} />
                                    100% конфиденциальность
                                </li>
                            </ul>
                        </div>

                        <div className={s.initialRight}>
                            <div className={s.demoCard}>
                                <div className={s.demoCardHeader}>
                                    <div className={s.demoCardDoc}>
                                        <div className={s.demoCardIcon}>📄</div>
                                        <div className={s.demoCardDocText}>
                                            <div className={s.demoCardTitle}>Пример_аналитики.word</div>
                                            <div className={s.demoCardSubtitle}>Анализ завершён</div>
                                        </div>
                                    </div>
                                    <div className={s.demoCardBadge}>3 риска</div>
                                </div>

                                <div className={s.demoCardList}>
                                    <div className={s.demoItemDanger}>
                                        <div className={s.demoItemIcon}>!</div>
                                        <div className={s.demoItemContent}>
                                            <div className={s.demoItemTitle}>Критический риск</div>
                                            <div className={s.demoItemText}>
                                                Неопределённые сроки расторжения договора (п. 8.2)
                                            </div>
                                        </div>
                                    </div>

                                    <div className={s.demoItemWarning}>
                                        <div className={s.demoItemIcon}>⚠</div>
                                        <div className={s.demoItemContent}>
                                            <div className={s.demoItemTitle}>Средний риск</div>
                                            <div className={s.demoItemText}>
                                                Отсутствует индексация арендной платы
                                            </div>
                                        </div>
                                    </div>

                                    <div className={s.demoItemInfo}>
                                        <div className={s.demoItemIcon}>i</div>
                                        <div className={s.demoItemContent}>
                                            <div className={s.demoItemTitle}>Рекомендация</div>
                                            <div className={s.demoItemText}>
                                                Добавить акт приёма-передачи помещения
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className={s.demoCardFooter}>
                                    <a
                                        href={demoReport}
                                        download="Полный_отчет_по_договору.docx"
                                        className={s.demoButton}
                                    >
                                        Скачать демо отчет-пример
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        {headerBlock}
                        {statusBlock}
                        {uploadBlock}
                    </>
                )}

                {/* Стороны договора */}
                {docId && (
                    <div className={s.analysisWrapper}>
                        <div className={s.analysisBlock}>
                            <div className={s.listHead}>
                                <div className={s.headL}>Стороны договора</div>
                                <div className={s.headR}>
                                    {partiesLoading && (
                                        <span className={s.muted}>Ищем стороны…</span>
                                    )}
                                    {!partiesLoading && selectedParty && (
                                        <span className={s.selectedBadge}>
                                            Выбрана сторона: {selectedParty}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {partiesLoading ? (
                                <NeuralLoader />
                            ) : parties.length === 0 ? (
                                <div className={s.empty}>
                                    Стороны не найдены или документ пустой.
                                </div>
                            ) : (
                                <ul className={s.partyList} role="list">
                                    {parties.map((p) => (
                                        <li key={p} className={s.partyItem}>
                                            <button
                                                className={`${s.btn} ${
                                                    selectedParty === p ? s.btnActive : ""
                                                }`}
                                                onClick={() => onSelectParty(p)}
                                                disabled={selectBusy || !!selectedParty}
                                                type="button"
                                                title="Запустить аналитику от лица выбранной стороны"
                                            >
                                                {p}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}

                            {analysisId && user && (
                                <div className={s.metaInfo}>
                                    Аналитика сохранена для дальнейшего доступа.
                                </div>
                            )}

                            {selectBusy && (
                                <div className={s.selectLoader}>
                                    <NeuralLoader />
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Итоговая аналитика (новая структура) */}
                {analysis && (
                    <div className={s.analysisResultWrapper}>
                        <div className={s.analysisResult}>
                            <div className={s.analysisHeaderRow}>
                                <h3 className={s.h3}>
                                    Итоги аналитики
                                    {selectedParty ? ` (сторона: ${selectedParty})` : ""}
                                </h3>

                                {dangerScore != null && !Number.isNaN(dangerScore) && (
                                    <div
                                        className={s.riskBadge}
                                        style={{ backgroundColor: getDangerScoreColor(dangerScore) }}
                                    >
                                        <div className={s.riskLabel}>Оценка риска</div>
                                        <div className={s.riskScore}>
                                            {dangerScore}
                                            <span className={s.riskScoreDim}>/100</span>
                                        </div>
                                        <div className={s.riskText}>
                                            {getDangerScoreText(dangerScore)}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {showLockCta && (
                                <div className={s.lockCtaRow}>
                                    <button
                                        type="button"
                                        className={s.lockCtaButton}
                                        onClick={() => setShowPayModal(true)}
                                    >
                                        {isGuest
                                            ? "Полная аналитика доступна после регистрации и оплаты — нажмите, чтобы узнать подробности."
                                            : "Полная аналитика заблокирована. Нажмите, чтобы разблокировать или оформить подписку."}
                                    </button>
                                </div>
                            )}

                            {/* Summary - всегда доступен */}
                            {summary && (
                                <Block title="Краткое резюме" tone="info" wide>
                                    {summary}
                                </Block>
                            )}

                            {/* Verdict - всегда доступен */}
                            {verdict && (
                                <Block title="Вывод и общая оценка" tone="info" wide>
                                    <>
                                        {verdict}
                                        {dangerScore != null && !Number.isNaN(dangerScore) && (
                                            <div className={s.metaLine}>
                                                Риск по договору: {dangerScore}/100 — {getDangerScoreText(dangerScore)}
                                            </div>
                                        )}
                                    </>
                                </Block>
                            )}

                            {/* Issues - проблемные пункты с выпадающими блоками */}
                            {issues && issues.length > 0 && (
                                <div className={s.issuesSection}>
                                    <div className={s.issuesHeader}>
                                        <h4 className={s.issuesTitle}>
                                            Найдены проблемные пункты ({issues.length})
                                        </h4>
                                        <div className={s.issuesStats}>
                                            {issues.filter(i => i.severity === "high").length > 0 && (
                                                <span className={s.highCount}>
                                                    🔴 Высоких: {issues.filter(i => i.severity === "high").length}
                                                </span>
                                            )}
                                            {issues.filter(i => i.severity === "medium").length > 0 && (
                                                <span className={s.mediumCount}>
                                                    🟠 Средних: {issues.filter(i => i.severity === "medium").length}
                                                </span>
                                            )}
                                            {issues.filter(i => i.severity === "low").length > 0 && (
                                                <span className={s.lowCount}>
                                                    🟢 Низких: {issues.filter(i => i.severity === "low").length}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className={s.issuesList}>
                                        {issues.map((issue, idx) => {
                                            const severityInfo = getSeverityInfo(issue.severity);
                                            const isExpanded = expandedIssues[idx];

                                            return (
                                                <div
                                                    key={idx}
                                                    className={`${s.issueItem} ${s[`severity_${issue.severity}`]}`}
                                                >
                                                    <div
                                                        className={s.issueHeader}
                                                        onClick={() => toggleIssue(idx)}
                                                        role="button"
                                                        tabIndex={0}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter" || e.key === " ") {
                                                                toggleIssue(idx);
                                                            }
                                                        }}
                                                    >
                                                        <div className={s.issueLeft}>
                                                            <div className={s.issueClause}>
                                                                <span className={s.clauseIcon}>📌</span>
                                                                {issue.clause}
                                                            </div>
                                                            <div className={s.issueProblem}>
                                                                {issue.problem}
                                                            </div>
                                                        </div>
                                                        <div className={s.issueRight}>
                                                            <span
                                                                className={s.severityBadge}
                                                                style={{ backgroundColor: severityInfo.color }}
                                                            >
                                                                {severityInfo.label}
                                                            </span>
                                                            <span className={s.expandIcon}>
                                                                {isExpanded ? "▲" : "▼"}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {isExpanded && (
                                                        <div className={s.issueDetails}>
                                                            {issue.text && (
                                                                <div className={s.issueDetailBlock}>
                                                                    <div className={s.detailTitle}>📄 Текст пункта</div>
                                                                    <div className={s.detailContent}>
                                                                        <code>{issue.text}</code>
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {issue.risk && (
                                                                <div className={s.issueDetailBlock}>
                                                                    <div className={s.detailTitle}>⚠️ Риск</div>
                                                                    <div className={s.detailContent}>
                                                                        {issue.risk}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {issue.why && (
                                                                <div className={s.issueDetailBlock}>
                                                                    <div className={s.detailTitle}>❓ Почему это плохо</div>
                                                                    <div className={s.detailContent}>
                                                                        {issue.why}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {issue.fix && (
                                                                <div className={s.issueDetailBlock}>
                                                                    <div className={s.detailTitle}>🔧 Как исправить</div>
                                                                    <div className={s.detailContent}>
                                                                        {issue.fix}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Если нет проблемных пунктов */}
                            {issues && issues.length === 0 && (
                                <Block title="Анализ рисков" tone="success" wide>
                                    🎉 Договор не содержит явных проблемных пунктов. Однако рекомендуем внимательно ознакомиться со всеми условиями перед подписанием.
                                </Block>
                            )}

                            {showLockCta && (
                                <div className={s.bottomCtaRow}>
                                    <button
                                        type="button"
                                        className={s.bottomCtaButton}
                                        onClick={() => setShowPayModal(true)}
                                    >
                                        Разблокировать полный разбор договора
                                    </button>
                                </div>
                            )}

                            {showFeedbackButtons && (
                                <div className={s.feedbackRow}>
                                    <div className={s.feedbackTitle}>
                                        Помогите улучшить аналитику:
                                    </div>
                                    <div className={s.feedbackButtons}>
                                        <button
                                            type="button"
                                            className={s.btnSecondary}
                                            onClick={() => onFeedback("clear")}
                                            disabled={feedbackBusy}
                                        >
                                            <span className={s.feedbackEmoji}>👍</span>
                                            Аналитика понятна
                                        </button>
                                        <button
                                            type="button"
                                            className={s.btnSecondary}
                                            onClick={() => onFeedback("inaccurate")}
                                            disabled={feedbackBusy}
                                        >
                                            <span className={s.feedbackEmoji}>⚠️</span>
                                            Есть неточности
                                        </button>
                                        <button
                                            type="button"
                                            className={s.btnSecondary}
                                            onClick={() => onFeedback("not_expected")}
                                            disabled={feedbackBusy}
                                        >
                                            <span className={s.feedbackEmoji}>🙁</span>
                                            Не получил, что хотел
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <PaywallModal
                    open={showModal}
                    onClose={() => setShowPayModal(false)}
                    isGuest={isGuest}
                    mode={mode}
                    hasSubscription={hasSubscription}
                    credits={credits}
                    canUnlock={canUnlock}
                    onUnlock={onUnlock}
                    selectBusy={selectBusy}
                />
            </div>
        </section>
    );
}

function Block({ title, children, tone = "neutral", wide = false }) {
    let toneClass = "";
    switch (tone) {
        case "info":
            toneClass = s.block_info;
            break;
        case "danger":
            toneClass = s.block_danger;
            break;
        case "warning":
            toneClass = s.block_warning;
            break;
        case "success":
            toneClass = s.block_success;
            break;
        case "neutral":
        default:
            toneClass = s.block_neutral || "";
            break;
    }

    const wideClass = wide ? s.blockWide : "";

    return (
        <article className={`${s.block} ${toneClass} ${wideClass}`}>
            <div className={s.blockHeader}>
                <div className={s.blockTitle}>{title}</div>
            </div>
            <div className={s.blockBody}>
                {typeof children === "string"
                    ? children.split("\n").map((line, i) => <p key={i}>{line}</p>)
                    : children}
            </div>
        </article>
    );
}

function PaywallModal({
                          open,
                          onClose,
                          isGuest,
                          mode,
                          hasSubscription,
                          credits,
                          canUnlock,
                          onUnlock,
                          selectBusy,
                      }) {
    if (!open) return null;

    const isPreview = !isGuest && mode === "preview";

    return (
        <div className={s.modalBackdrop} onClick={onClose}>
            <div
                className={s.modal}
                onClick={(e) => {
                    e.stopPropagation();
                }}
            >
                <div className={s.modalHeader}>
                    <div>
                        <div className={s.modalTitle}>
                            {isGuest
                                ? "Полная аналитика договора"
                                : "Полная аналитика заблокирована"}
                        </div>
                        <div className={s.modalBadge}>
                            {isGuest
                                ? "Гостевой режим"
                                : hasSubscription
                                    ? "Подписка активна"
                                    : "Без подписки"}
                        </div>
                    </div>
                    <button
                        type="button"
                        className={s.modalClose}
                        aria-label="Закрыть"
                        onClick={onClose}
                    >
                        ×
                    </button>
                </div>

                <p className={s.modalText}>
                    {isGuest
                        ? "Сейчас вы видите только краткий обзор. После регистрации и оплаты вы получите полный разбор договора: детальный анализ каждого проблемного пункта, конкретные риски и рекомендации по исправлению."
                        : "Доступна только краткая часть анализа. Вы можете разблокировать полный разбор договора за 1 запрос или оформить подписку и получать расширенную аналитику по каждому договору."}
                </p>

                {isPreview && (
                    <div className={s.modalMeta}>
                        Подписка: {hasSubscription ? "активна" : "нет активной подписки"} ·
                        Запросов: {credits}
                    </div>
                )}

                <div className={s.modalActions}>
                    {isGuest && (
                        <>
                            <a className={s.btnPrimary} href="/register">
                                Зарегистрироваться и получить доступ
                            </a>
                            <a className={s.btnSecondary} href="/login">
                                У меня уже есть аккаунт
                            </a>
                        </>
                    )}

                    {isPreview && (
                        <>
                            {canUnlock && (
                                <button
                                    type="button"
                                    className={s.btnPrimary}
                                    onClick={onUnlock}
                                    disabled={selectBusy}
                                >
                                    Разблокировать за 1 запрос
                                </button>
                            )}
                            <a
                                className={s.btnSecondary}
                                href="/billing"
                                onClick={() => {
                                    trackGoal("go_billing", {
                                        is_auth: !isGuest,
                                        from: "paywall_modal",
                                    });
                                }}
                            >
                                Тарифы и оплата
                            </a>
                        </>
                    )}

                    {!isGuest && mode === "full" && (
                        <div className={s.modalMeta}>
                            Полная аналитика уже доступна вашему аккаунту.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function NeuralLoader({ text }) {
    const canvasRef = React.useRef(null);

    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;

        const state = {
            width: 0,
            height: 0,
            points: [],
            animationId: null,
        };

        const createPoints = () => {
            const count = 32;
            const points = [];
            const margin = 14 * dpr;

            for (let i = 0; i < count; i++) {
                points.push({
                    x: margin + Math.random() * (state.width - margin * 2),
                    y: margin + Math.random() * (state.height - margin * 2),
                    vx: (Math.random() - 0.5) * 0.4,
                    vy: (Math.random() - 0.5) * 0.4,
                });
            }
            state.points = points;
        };

        const resize = () => {
            const rect = canvas.parentElement.getBoundingClientRect();
            const w = rect.width;
            const h = rect.height * 0.55 || 90;

            canvas.width = w * dpr;
            canvas.height = h * dpr;
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;

            state.width = canvas.width;
            state.height = canvas.height;

            createPoints();
        };

        resize();
        window.addEventListener("resize", resize);

        const maxDist = 180 * dpr;
        const pointRadius = 3 * dpr;

        const draw = () => {
            const { width, height, points } = state;
            ctx.clearRect(0, 0, width, height);

            for (let i = 0; i < points.length; i++) {
                for (let j = i + 1; j < points.length; j++) {
                    const p1 = points[i];
                    const p2 = points[j];
                    const dx = p1.x - p2.x;
                    const dy = p1.y - p2.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < maxDist) {
                        const alpha = 1 - dist / maxDist;
                        ctx.strokeStyle = `rgba(0, 164, 255, ${0.45 * alpha})`;
                        ctx.beginPath();
                        ctx.moveTo(p1.x, p1.y);
                        ctx.lineTo(p2.x, p2.y);
                        ctx.stroke();
                    }
                }
            }

            for (const p of points) {
                ctx.beginPath();
                ctx.fillStyle = "rgba(0, 140, 220, 0.9)";
                ctx.arc(p.x, p.y, pointRadius, 0, Math.PI * 2);
                ctx.fill();
            }
        };

        const update = () => {
            const { width, height, points } = state;
            const margin = 14 * dpr;

            for (const p of points) {
                p.x += p.vx * dpr * 1.3;
                p.y += p.vy * dpr * 1.3;

                if (p.x < margin) {
                    p.x = margin;
                    p.vx *= -1;
                } else if (p.x > width - margin) {
                    p.x = width - margin;
                    p.vx *= -1;
                }

                if (p.y < margin) {
                    p.y = margin;
                    p.vy *= -1;
                } else if (p.y > height - margin) {
                    p.y = height - margin;
                    p.vy *= -1;
                }
            }
        };

        const loop = () => {
            update();
            draw();
            state.animationId = requestAnimationFrame(loop);
        };

        loop();

        return () => {
            cancelAnimationFrame(state.animationId);
            window.removeEventListener("resize", resize);
        };
    }, []);

    return (
        <div className={s.neuralLoader}>
            <canvas ref={canvasRef} className={s.neuralCanvas} />
            {text && <div className={s.neuralText}>{text}</div>}
        </div>
    );
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