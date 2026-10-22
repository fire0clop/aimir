// src/pages/Documents.jsx
import React, { useEffect, useState } from "react";
import s from "./Documents.module.css";
import { listMyDocuments } from "../api/documents";
import { unlockAnalysis } from "../api/analysis";
import { getBillingStatus } from "../api/billing";
import {
    Document as DocxDocument,
    Packer,
    Paragraph,
    TextRun,
    ImageRun,
    AlignmentType,
} from "docx";

// ─── Helpers ──────────────────────────────────────────────────

function scoreColor(score) {
    if (score == null) return "";
    if (score <= 40) return s.scoreDanger;
    if (score <= 70) return s.scoreWarn;
    return s.scoreOk;
}
function barClass(score) {
    if (score == null) return "";
    if (score <= 40) return s.scoreBarDanger;
    if (score <= 70) return s.scoreBarWarn;
    return s.scoreBarOk;
}
function scoreTitle(score) {
    if (score == null) return "";
    if (score <= 25) return "Критически опасный договор";
    if (score <= 40) return "Высокий уровень риска";
    if (score <= 60) return "Умеренный риск — нужна доработка";
    if (score <= 80) return "Небольшие замечания";
    return "Договор в целом безопасен";
}

const SEV_LABEL = { high: "Критично", medium: "Средний риск", low: "Незначительно" };
const SEV_CLASS = { high: s.sevHigh, medium: s.sevMedium, low: s.sevLow };
const CARD_CLASS = { high: s.issueCardHigh, medium: s.issueCardMedium, low: s.issueCardLow };
// eslint-disable-next-line no-unused-vars
const PILL_CLASS = { high: s.pillHigh, medium: s.pillMedium, low: s.pillLow };

// ─── IssueCard accordion ───────────────────────────────────────
function IssueCard({ issue, defaultOpen }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className={[s.issueCard, CARD_CLASS[issue.severity] || s.issueCardLow].join(" ")}>
            <div
                className={s.issueHeader}
                onClick={() => setOpen(o => !o)}
                role="button"
                tabIndex={0}
                onKeyDown={e => (e.key === "Enter" || e.key === " ") && setOpen(o => !o)}
            >
                <span className={s.issueClauseTag}>{issue.clause}</span>
                <span className={s.issueProblem}>{issue.problem}</span>
                <span className={[s.issueSevBadge, SEV_CLASS[issue.severity] || s.sevLow].join(" ")}>
                    {SEV_LABEL[issue.severity] || issue.severity}
                </span>
                <svg
                    className={[s.issueChevron, open ? s.issueChevronOpen : ""].join(" ")}
                    width="16" height="16" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2"
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </div>
            <div className={[s.issueBody, open ? s.issueBodyOpen : ""].join(" ")}>
                <div className={s.issueBodyInner}>
                    {issue.text && (
                        <blockquote className={s.issueQuote}>«{issue.text}»</blockquote>
                    )}
                    {issue.risk && (
                        <div className={[s.detailBlock, s.detailBlockRisk].join(" ")}>
                            <div className={s.detailLabel}>Что может случиться</div>
                            {issue.risk}
                        </div>
                    )}
                    {issue.why && (
                        <div className={[s.detailBlock, s.detailBlockWhy].join(" ")}>
                            <div className={s.detailLabel}>Почему это проблема</div>
                            {issue.why}
                        </div>
                    )}
                    {issue.fix && (
                        <div className={[s.detailBlock, s.detailBlockFix].join(" ")}>
                            <div className={s.detailLabel}>Как исправить</div>
                            {issue.fix}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Main component ────────────────────────────────────────────
export default function Documents() {
    const [docs, setDocs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState("");

    const [billing, setBilling] = useState(null);

    // модалка
    const [modalDoc, setModalDoc] = useState(null);
    const [modalAnalysis, setModalAnalysis] = useState(null);
    const [modalBusy, setModalBusy] = useState(false);
    const [modalErr, setModalErr] = useState("");
    const [copied, setCopied] = useState(false);
    const [scoreAnimated, setScoreAnimated] = useState(false);
    const [activeFilter, setActiveFilter] = useState("all");

    // ---------- helpers ----------

    function extractAnalysisFromDoc(doc) {
        if (!doc) return null;
        const base = doc.last_analysis || doc.analysis;
        if (!base) return null;

        const inner =
            base.analysis && typeof base.analysis === "object"
                ? base.analysis
                : base;

        const isV2 = !!(inner.overall_assessment || Array.isArray(inner.issues));

        return {
            id:
                base.id ||
                base.analysis_id ||
                base.analysisId ||
                inner.id ||
                null,
            selected_party:
                base.selected_party ||
                inner.selected_party ||
                base.party ||
                inner.party ||
                null,
            is_paid:
                typeof base.is_paid === "boolean"
                    ? base.is_paid
                    : typeof inner.is_paid === "boolean"
                        ? inner.is_paid
                        : !!base.paid,
            isV2,
            summary: inner.summary || "",
            // v1 fields
            key_terms: inner.key_terms || "",
            risks: inner.risks || "",
            ambiguities: inner.ambiguities || "",
            fixes: inner.fixes || "",
            questions: inner.questions || "",
            // verdict & score: support both v1 and v2
            verdict: inner.verdict || inner.overall_assessment?.verdict || "",
            danger_score:
                typeof inner.danger_score === "number"
                    ? inner.danger_score
                    : typeof inner.overall_assessment?.danger_score === "number"
                        ? inner.overall_assessment.danger_score
                        : null,
            // v2 fields
            issues: Array.isArray(inner.issues) ? inner.issues : [],
        };
    }

    // ---------- загрузка ----------

    const load = async () => {
        try {
            setLoading(true);
            setErr("");
            setModalDoc(null);
            setModalAnalysis(null);

            const [docsData, billingData] = await Promise.all([
                listMyDocuments(),
                getBillingStatus().catch(() => null),
            ]);

            const arr = Array.isArray(docsData) ? docsData : [];

            const sorted = [...arr].sort((a, b) => {
                const da = a.created_at ? new Date(a.created_at).getTime() : 0;
                const db = b.created_at ? new Date(b.created_at).getTime() : 0;
                return db - da;
            });

            setDocs(sorted);
            if (billingData) setBilling(billingData);
        } catch (e) {
            setErr(parseErr(e));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    // score animation trigger
    useEffect(() => {
        if (modalAnalysis) {
            setScoreAnimated(false);
            setTimeout(() => setScoreAnimated(true), 80);
        } else {
            setScoreAnimated(false);
        }
    }, [modalAnalysis]);

    // ---------- модалка ----------

    const openModal = (doc) => {
        const norm = extractAnalysisFromDoc(doc);
        if (!norm) {
            setModalErr("Для этого документа ещё нет аналитики.");
            setModalDoc(null);
            setModalAnalysis(null);
            return;
        }
        setModalDoc(doc);
        setModalAnalysis(norm);
        setModalErr("");
        setCopied(false);
        setActiveFilter("all");
    };

    const closeModal = () => {
        setModalDoc(null);
        setModalAnalysis(null);
        setModalErr("");
        setCopied(false);
        setActiveFilter("all");
    };

    // биллинг / доступ
    const hasSub = billing?.active && billing?.has_subscription;
    const credits = billing?.credits ?? 0;

    const currentIsPaid = !!modalAnalysis?.is_paid;
    const showFull = hasSub || currentIsPaid;
    const canUnlock =
        !showFull && billing && !hasSub && credits > 0 && !!modalAnalysis?.id;

    // ---------- разблокировка ----------

    const handleUnlock = async () => {
        if (!modalAnalysis?.id) return;
        setModalBusy(true);
        setModalErr("");

        try {
            const res = await unlockAnalysis(modalAnalysis.id);
            const inner = res.analysis || {};
            const isV2 = !!(inner.overall_assessment || Array.isArray(inner.issues));

            const newAnalysis = {
                id: res.analysis_id,
                selected_party: res.selected_party,
                is_paid: true,
                isV2,
                summary: inner.summary || "",
                key_terms: inner.key_terms || "",
                risks: inner.risks || "",
                ambiguities: inner.ambiguities || "",
                fixes: inner.fixes || "",
                questions: inner.questions || "",
                verdict: inner.verdict || inner.overall_assessment?.verdict || "",
                danger_score:
                    typeof inner.danger_score === "number"
                        ? inner.danger_score
                        : typeof inner.overall_assessment?.danger_score === "number"
                            ? inner.overall_assessment.danger_score
                            : null,
                issues: Array.isArray(inner.issues) ? inner.issues : [],
            };

            setModalAnalysis(newAnalysis);

            setDocs((prev) =>
                prev.map((d) => {
                    if (d.id !== res.document_id) return d;
                    const la = d.last_analysis || d.analysis || {};
                    const updatedLA = {
                        ...la,
                        id: newAnalysis.id,
                        selected_party: newAnalysis.selected_party,
                        is_paid: true,
                        analysis: { ...(la.analysis || {}), ...newAnalysis },
                    };
                    return { ...d, last_analysis: updatedLA };
                })
            );

            if (res.access && typeof res.access.credits === "number") {
                setBilling((prev) =>
                    prev
                        ? { ...prev, credits: res.access.credits }
                        : { credits: res.access.credits }
                );
            }
        } catch (e) {
            setModalErr(parseErr(e));
        } finally {
            setModalBusy(false);
        }
    };

    // ---------- копирование / скачивание ----------

    const buildFullText = () => {
        if (!modalAnalysis) return "";
        const parts = [];

        const pushBlock = (title, field) => {
            if (!field) return;
            parts.push(`${title}:\n${field}\n`);
        };

        pushBlock("Краткое резюме", modalAnalysis.summary);
        pushBlock("Ключевые условия", modalAnalysis.key_terms);
        pushBlock("Риски и уязвимости", modalAnalysis.risks);
        pushBlock("Неоднозначные формулировки", modalAnalysis.ambiguities);
        pushBlock("Что стоит исправить", modalAnalysis.fixes);
        pushBlock("Вопросы к контрагенту", modalAnalysis.questions);
        if (modalAnalysis.verdict) {
            let verdictText = modalAnalysis.verdict;
            if (modalAnalysis.danger_score != null) {
                verdictText += `\nРиск: ${modalAnalysis.danger_score}/100`;
            }
            pushBlock("Вывод и оценка риска", verdictText);
        } else if (modalAnalysis.danger_score != null) {
            pushBlock("Оценка риска", `Риск: ${modalAnalysis.danger_score}/100`);
        }

        return parts.join("\n");
    };

    const handleCopy = async () => {
        try {
            const text = buildFullText();
            if (!text) return;
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 5000);
        } catch {
            setModalErr("Не удалось скопировать текст.");
        }
    };

    const handleDownload = async () => {
        try {
            const text = buildFullText();
            if (!text) return;

            const logoUrl = `${process.env.PUBLIC_URL || ""}/logo.png`;
            const logoRes = await fetch(logoUrl, { cache: "no-store" });
            if (!logoRes.ok) throw new Error(`logo.png не найден: ${logoRes.status}`);

            const logoBlob = await logoRes.blob();
            const ct = (logoBlob.type || "").toLowerCase();
            if (!ct.includes("png")) throw new Error(`logo.png вернул не PNG: ${ct}`);

            const bmp = await createImageBitmap(logoBlob);
            const w0 = bmp.width || 1;
            const h0 = bmp.height || 1;
            const targetW = 140;
            const targetH = Math.round((targetW * h0) / w0);
            const logoData = new Uint8Array(await logoBlob.arrayBuffer());

            const paragraphs = text.split("\n").map((line) =>
                new Paragraph({
                    children: [new TextRun(line === "" ? " " : line)],
                })
            );

            const doc = new DocxDocument({
                sections: [
                    {
                        properties: {},
                        children: [
                            new Paragraph({
                                alignment: AlignmentType.LEFT,
                                children: [
                                    new ImageRun({
                                        data: logoData,
                                        type: "png",
                                        transformation: { width: targetW, height: targetH },
                                    }),
                                ],
                                spacing: { after: 240 },
                            }),
                            new Paragraph({ children: [new TextRun(" ")] }),
                            ...paragraphs,
                        ],
                    },
                ],
            });

            const blob = await Packer.toBlob(doc);
            const baseName = modalDoc?.original_name || "analysis";
            const safeName = baseName.replace(/\.[^/.]+$/, "");
            const url = URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;
            a.download = `${safeName}-analysis.docx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e) {
            setModalErr(e?.message || "Не удалось скачать файл.");
        }
    };

    // ---------- filter tabs for v2 issues ----------

    const issues = modalAnalysis?.issues || [];
    const highCount = issues.filter(i => i.severity === "high").length;
    const medCount  = issues.filter(i => i.severity === "medium").length;
    const lowCount  = issues.filter(i => i.severity === "low").length;

    const tabs = [
        { id: "all",    label: `Все (${issues.length})` },
        ...(highCount > 0 ? [{ id: "high",   label: `Критично (${highCount})` }] : []),
        ...(medCount  > 0 ? [{ id: "medium", label: `Средние (${medCount})` }] : []),
        ...(lowCount  > 0 ? [{ id: "low",    label: `Незначительные (${lowCount})` }] : []),
    ];

    const filteredIssues = activeFilter === "all"
        ? issues
        : issues.filter(i => i.severity === activeFilter);

    // ---------- UI ----------

    return (
        <div className={s.page}>
            <div className={s.wrap}>
                {/* top row */}
                <div className={s.top}>
                    <h1 className={s.title}>Мои документы</h1>
                    <button className={s.refresh} onClick={load} disabled={loading}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M23 4v6h-6" />
                            <path d="M1 20v-6h6" />
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                        Обновить
                    </button>
                </div>

                {err && <div className={s.alert}>{err}</div>}

                {/* billing info */}
                {billing && (
                    <div className={s.billingInfo}>
                        {billing.active && billing.has_subscription ? (
                            <span className={s.ok}>
                                Активна подписка
                                {billing.subscription_end
                                    ? ` до ${fmtDate(billing.subscription_end)}`
                                    : ""}
                                . Все анализы доступны.
                            </span>
                        ) : (
                            <span className={s.muted}>
                                Подписки нет. Кредиты: {billing.credits ?? 0}.
                            </span>
                        )}
                    </div>
                )}

                {/* list */}
                {loading ? (
                    <div className={s.skel}>Загружаем документы…</div>
                ) : docs.length === 0 ? (
                    <div className={s.empty}>
                        <div style={{ marginBottom: 8, fontSize: 32 }}>📄</div>
                        Пока нет загруженных документов.
                    </div>
                ) : (
                    <ul className={s.list}>
                        {docs.map((doc) => {
                            const a = extractAnalysisFromDoc(doc);
                            let statusText;
                            let badgeClass;

                            if (!a) {
                                statusText = "Нет аналитики";
                                badgeClass = s.badgeNone;
                            } else if (hasSub) {
                                statusText = "Аналитика открыта";
                                badgeClass = s.badgePaid;
                            } else if (a.is_paid) {
                                statusText = "Аналитика разблокирована";
                                badgeClass = s.badgePaid;
                            } else {
                                statusText = "Только превью";
                                badgeClass = s.badgeLocked;
                            }

                            return (
                                <li
                                    key={doc.id}
                                    className={[s.item, a ? s.itemClickable : ""].join(" ")}
                                    onClick={a ? () => openModal(doc) : undefined}
                                    role={a ? "button" : undefined}
                                    tabIndex={a ? 0 : undefined}
                                    onKeyDown={a ? (e) => (e.key === "Enter" || e.key === " ") && openModal(doc) : undefined}
                                >
                                    <div className={s.itemLeft}>
                                        <div className={s.docIcon}>
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                                                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                                <polyline points="14 2 14 8 20 8" />
                                                <line x1="16" y1="13" x2="8" y2="13" />
                                                <line x1="16" y1="17" x2="8" y2="17" />
                                                <polyline points="10 9 9 9 8 9" />
                                            </svg>
                                        </div>
                                        <div className={s.meta}>
                                            <div className={s.name} title={doc.original_name}>
                                                {doc.original_name}
                                            </div>
                                            {doc.created_at && (
                                                <div className={s.date}>{fmtDate(doc.created_at)}</div>
                                            )}
                                        </div>
                                    </div>
                                    <div className={s.analysisBadge}>
                                        <span className={badgeClass}>{statusText}</span>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {/* ─── Modal ─── */}
            {modalDoc && modalAnalysis && (
                <div className={s.modalBackdrop} onClick={closeModal}>
                    <div className={s.modal} onClick={(e) => e.stopPropagation()}>

                        {/* header */}
                        <div className={s.modalHeader}>
                            <div>
                                <h2 className={s.modalTitle}>Аналитика по документу</h2>
                                <div className={s.modalSub}>
                                    {modalDoc.original_name}
                                    {modalAnalysis.selected_party
                                        ? ` · сторона: ${modalAnalysis.selected_party}`
                                        : ""}
                                </div>
                            </div>
                            <button className={s.modalClose} onClick={closeModal} aria-label="Закрыть">
                                ×
                            </button>
                        </div>

                        {modalErr && <div className={s.alert}>{modalErr}</div>}
                        {modalBusy && <div className={s.modalBusy}>Обновляем доступ…</div>}

                        <div className={s.modalBody}>

                            {/* Score hero */}
                            {modalAnalysis.danger_score != null && (
                                <div className={s.scoreHero}>
                                    <div className={s.scoreHeroTop}>
                                        <div className={s.scoreBlock}>
                                            <div className={[s.scoreNumber, scoreColor(modalAnalysis.danger_score)].join(" ")}>
                                                {modalAnalysis.danger_score}
                                            </div>
                                            <div className={s.scoreNumLabel}>из 100 — безопасность</div>
                                        </div>
                                        <div className={s.scoreRight}>
                                            <h3 className={s.scoreTitle}>{scoreTitle(modalAnalysis.danger_score)}</h3>
                                            {modalAnalysis.verdict && (
                                                <p className={s.scoreVerdict}>{modalAnalysis.verdict}</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className={s.scoreBar}>
                                        <div
                                            className={[s.scoreBarFill, barClass(modalAnalysis.danger_score)].join(" ")}
                                            style={{ width: scoreAnimated ? `${modalAnalysis.danger_score}%` : "0%" }}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Summary */}
                            {modalAnalysis.summary && (
                                <div className={s.summaryCard}>
                                    <div className={s.sectionLabel}>О договоре</div>
                                    <p className={s.summaryText}>{modalAnalysis.summary}</p>
                                </div>
                            )}

                            {/* V2: issues accordion */}
                            {modalAnalysis.isV2 ? (
                                showFull ? (
                                    issues.length > 0 ? (
                                        <div>
                                            <div className={s.issuesHeadRow}>
                                                <span className={s.issuesCount}>
                                                    {issues.length}{" "}
                                                    {issues.length === 1 ? "риск" : issues.length < 5 ? "риска" : "рисков"}
                                                </span>
                                                <div className={s.severityPills}>
                                                    {highCount > 0 && <span className={[s.pill, s.pillHigh].join(" ")}>{highCount} критических</span>}
                                                    {medCount  > 0 && <span className={[s.pill, s.pillMedium].join(" ")}>{medCount} средних</span>}
                                                    {lowCount  > 0 && <span className={[s.pill, s.pillLow].join(" ")}>{lowCount} незначительных</span>}
                                                </div>
                                            </div>

                                            {tabs.length > 2 && (
                                                <div className={s.filterTabs}>
                                                    {tabs.map(tab => (
                                                        <button
                                                            key={tab.id}
                                                            type="button"
                                                            className={[s.filterTab, activeFilter === tab.id ? s.filterTabActive : ""].join(" ")}
                                                            onClick={() => setActiveFilter(tab.id)}
                                                        >
                                                            {tab.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}

                                            <div className={s.issueList}>
                                                {filteredIssues.map((issue, idx) => (
                                                    <IssueCard
                                                        key={`${activeFilter}-${idx}`}
                                                        issue={issue}
                                                        defaultOpen={issue.severity === "high"}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className={s.summaryCard}>
                                            <div className={s.sectionLabel}>Анализ рисков</div>
                                            <p className={s.summaryText}>
                                                Договор не содержит явных проблемных пунктов.
                                            </p>
                                        </div>
                                    )
                                ) : (
                                    <div className={[s.block, s.blurred].join(" ")}>
                                        <div className={s.blockTitle}>Проблемные пункты</div>
                                        <div className={s.blockBody}>
                                            Детальный разбор пунктов договора доступен после разблокировки.
                                        </div>
                                        <div className={s.blurOverlay}>Доступно после разблокировки</div>
                                    </div>
                                )
                            ) : (
                                /* V1: flat fields */
                                <>
                                    {modalAnalysis.key_terms && (
                                        <V1Block title="Ключевые условия">
                                            {modalAnalysis.key_terms}
                                        </V1Block>
                                    )}
                                    <V1Block title="Риски и уязвимости" locked={!showFull}>
                                        {showFull ? modalAnalysis.risks : "Риски доступны после разблокировки анализа."}
                                    </V1Block>
                                    <V1Block title="Неоднозначные формулировки" locked={!showFull}>
                                        {showFull ? modalAnalysis.ambiguities : "Полный перечень доступен после разблокировки."}
                                    </V1Block>
                                    <V1Block title="Что стоит исправить" locked={!showFull}>
                                        {showFull ? modalAnalysis.fixes : "Рекомендации по доработке доступны после разблокировки."}
                                    </V1Block>
                                    <V1Block title="Вопросы к контрагенту" locked={!showFull}>
                                        {showFull ? modalAnalysis.questions : "Список уточняющих вопросов доступен после разблокировки."}
                                    </V1Block>
                                </>
                            )}
                        </div>

                        {/* footer */}
                        <div className={s.modalFooter}>
                            {showFull ? (
                                <>
                                    <button
                                        className={copied ? [s.btnGhost, s.btnGhostDone].join(" ") : s.btnGhost}
                                        onClick={handleCopy}
                                        disabled={modalBusy}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                        </svg>
                                        {copied ? "Скопировано!" : "Копировать"}
                                    </button>
                                    <button
                                        className={s.btnGhost}
                                        onClick={handleDownload}
                                        disabled={modalBusy}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                            <polyline points="7 10 12 15 17 10" />
                                            <line x1="12" y1="15" x2="12" y2="3" />
                                        </svg>
                                        Скачать .docx
                                    </button>
                                </>
                            ) : (
                                canUnlock ? (
                                    <button
                                        className={s.btnPrimary}
                                        onClick={handleUnlock}
                                        disabled={modalBusy}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                        </svg>
                                        Разблокировать за 1 запрос
                                        {typeof credits === "number" ? ` (осталось: ${credits})` : ""}
                                    </button>
                                ) : (
                                    <div className={s.noAccessMsg}>
                                        Недостаточно прав для разблокировки.{" "}
                                        <a href="/billing">Оформите подписку или пополните запросы</a>.
                                    </div>
                                )
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── V1 block ──────────────────────────────────────────────────
function V1Block({ title, children, locked = false }) {
    return (
        <div className={locked ? [s.block, s.blurred].join(" ") : s.block}>
            <div className={s.blockTitle}>{title}</div>
            <div className={s.blockBody}>
                {typeof children === "string"
                    ? children.split("\n").map((line, i) => <p key={i}>{line}</p>)
                    : children}
            </div>
            {locked && (
                <div className={s.blurOverlay}>Доступно после разблокировки анализа</div>
            )}
        </div>
    );
}

// ─── Helpers ──────────────────────────────────────────────────
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

function fmtDate(iso) {
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return "";
        return d.toLocaleString("ru-RU", {
            day: "2-digit", month: "2-digit", year: "numeric",
            hour: "2-digit", minute: "2-digit",
        });
    } catch {
        return "";
    }
}
