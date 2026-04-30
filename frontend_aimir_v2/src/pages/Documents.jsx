// src/components/Documents.jsx
import React, { useEffect, useState } from "react";
import s from "./Documents.module.css";
import { listMyDocuments } from "../api/documents";
import { unlockAnalysis, getSeverityInfo } from "../api/analysis";
import { getBillingStatus } from "../api/billing";
import {
    Document as DocxDocument,
    Packer,
    Paragraph,
    TextRun,
    ImageRun,
    AlignmentType,
} from "docx";



export default function Documents() {
    const [docs, setDocs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState("");

    const [billing, setBilling] = useState(null); // { has_subscription, active, credits, ... }

    // модалка
    const [modalDoc, setModalDoc] = useState(null);
    const [modalAnalysis, setModalAnalysis] = useState(null);
    const [modalBusy, setModalBusy] = useState(false);
    const [modalErr, setModalErr] = useState("");
    const [copied, setCopied] = useState(false);

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

            // сортируем по created_at по убыванию (сверху — новые)
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
    };

    const closeModal = () => {
        setModalDoc(null);
        setModalAnalysis(null);
        setModalErr("");
        setCopied(false);
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
            // res: { analysis_id, document_id, selected_party, analysis, access }

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

            // обновляем список документов
            setDocs((prev) =>
                prev.map((d) => {
                    if (d.id !== res.document_id) return d;
                    const la = d.last_analysis || d.analysis || {};
                    const updatedLA = {
                        ...la,
                        id: newAnalysis.id,
                        selected_party: newAnalysis.selected_party,
                        is_paid: true,
                        analysis: {
                            ...(la.analysis || {}),
                            ...newAnalysis,
                        },
                    };
                    return { ...d, last_analysis: updatedLA };
                })
            );

            // обновляем биллинг по кредитам (если пришёл access)
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

            // реальные размеры -> правильная высота
            const bmp = await createImageBitmap(logoBlob);
            const w0 = bmp.width || 1;
            const h0 = bmp.height || 1;

            const targetW = 140; // подстрой
            const targetH = Math.round((targetW * h0) / w0);

            const logoData = new Uint8Array(await logoBlob.arrayBuffer());

            // текст -> параграфы
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
                            // ЛОГО как обычный первый блок
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

                            // небольшой отступ
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




    // ---------- UI ----------

    return (
        <div className={s.page}>
            <div className={s.wrap}>
                <div className={s.top}>
                    <h1 className={s.title}>Мои документы</h1>
                    <button className={s.refresh} onClick={load} disabled={loading}>
                        Обновить
                    </button>
                </div>

                {err && <div className={s.alert}>{err}</div>}

                {billing && (
                    <div className={s.billingInfo}>
                        {billing.active && billing.has_subscription ? (
                            <span className={s.ok}>
                                Активна подписка
                                {billing.subscription_end
                                    ? ` до ${fmtDate(billing.subscription_end)}`
                                    : ""}
                                . Доступ ко всем анализам открыт.
                            </span>
                        ) : (
                            <span className={s.muted}>
                                Подписки нет. Кредиты: {billing.credits ?? 0}.
                            </span>
                        )}
                    </div>
                )}

                {loading ? (
                    <div className={s.skel}>Загружаем…</div>
                ) : docs.length === 0 ? (
                    <div className={s.empty}>Пока нет загруженных документов.</div>
                ) : (
                    <ul className={s.list} role="list">
                        {docs.map((doc) => {
                            const a = extractAnalysisFromDoc(doc);
                            let statusText = "Аналитика ещё не выполнена";
                            let statusClass = s.badgeLocked;

                            if (a) {
                                if (hasSub) {
                                    statusText = "Аналитика доступна (подписка)";
                                    statusClass = s.badgePaid;
                                } else if (a.is_paid) {
                                    statusText = "Аналитика разблокирована";
                                    statusClass = s.badgePaid;
                                } else {
                                    statusText = "Аналитика: только превью";
                                    statusClass = s.badgeLocked;
                                }
                            }

                            return (
                                <li
                                    key={doc.id}
                                    className={s.item}
                                    onClick={a ? () => openModal(doc) : undefined}
                                >
                                    <div className={s.meta}>
                                        <div
                                            className={s.name}
                                            title={doc.original_name}
                                        >
                                            {doc.original_name}
                                        </div>
                                        {doc.created_at && (
                                            <div className={s.size}>
                                                {fmtDate(doc.created_at)}
                                            </div>
                                        )}
                                    </div>
                                    <div className={s.analysisBadge}>
                                        <span className={statusClass}>
                                            {statusText}
                                        </span>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {modalDoc && modalAnalysis && (
                <div className={s.modalBackdrop} onClick={closeModal}>
                    <div
                        className={s.modal}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className={s.modalHeader}>
                            <div>
                                <h2 className={s.modalTitle}>
                                    Аналитика по документу
                                </h2>
                                <div className={s.modalSub}>
                                    {modalDoc.original_name} · сторона:{" "}
                                    {modalAnalysis.selected_party || "не указана"}
                                </div>
                            </div>
                            <button
                                className={s.modalClose}
                                onClick={closeModal}
                            >
                                ×
                            </button>
                        </div>

                        {modalErr && (
                            <div className={s.alert} style={{ marginBottom: 8 }}>
                                {modalErr}
                            </div>
                        )}

                        {modalBusy && (
                            <div className={s.muted} style={{ marginBottom: 8 }}>
                                Обновляем доступ…
                            </div>
                        )}

                        <div className={s.modalBody}>
                            {modalAnalysis.summary && (
                                <Block title="Краткое резюме">
                                    {modalAnalysis.summary}
                                </Block>
                            )}

                            {/* Вывод и оценка — всегда видны (v1 и v2) */}
                            {(modalAnalysis.verdict || modalAnalysis.danger_score != null) && (
                                <Block title="Вывод и оценка риска">
                                    <>
                                        {modalAnalysis.verdict && <p>{modalAnalysis.verdict}</p>}
                                        {modalAnalysis.danger_score != null && (
                                            <p className={s.metaLine}>
                                                Риск: {modalAnalysis.danger_score}/100
                                            </p>
                                        )}
                                    </>
                                </Block>
                            )}

                            {/* V2: issues */}
                            {modalAnalysis.isV2 ? (
                                showFull ? (
                                    modalAnalysis.issues && modalAnalysis.issues.length > 0 ? (
                                        <div>
                                            <div className={s.issuesHeader}>
                                                Найдены проблемные пункты ({modalAnalysis.issues.length})
                                                <span className={s.issuesMeta}>
                                                    {modalAnalysis.issues.filter(i=>i.severity==="high").length > 0 && <span className={s.sevHigh}>● Высоких: {modalAnalysis.issues.filter(i=>i.severity==="high").length}</span>}
                                                    {modalAnalysis.issues.filter(i=>i.severity==="medium").length > 0 && <span className={s.sevMedium}>● Средних: {modalAnalysis.issues.filter(i=>i.severity==="medium").length}</span>}
                                                    {modalAnalysis.issues.filter(i=>i.severity==="low").length > 0 && <span className={s.sevLow}>● Низких: {modalAnalysis.issues.filter(i=>i.severity==="low").length}</span>}
                                                </span>
                                            </div>
                                            <div className={s.issuesList}>
                                                {modalAnalysis.issues.map((issue, idx) => {
                                                    const sev = getSeverityInfo(issue.severity);
                                                    return (
                                                        <div key={idx} className={`${s.issueCard} ${s[`sev_${issue.severity}`]}`}>
                                                            <div className={s.issueCardHead}>
                                                                <span className={s.issueClause}>{issue.clause}</span>
                                                                <span className={s.issueProblem}>{issue.problem}</span>
                                                                <span className={s.issueSevBadge} style={{color: sev.color}}>{sev.label}</span>
                                                            </div>
                                                            {issue.text && (
                                                                <blockquote className={s.issueQuote}>«{issue.text}»</blockquote>
                                                            )}
                                                            {issue.risk && <p className={s.issueField}><span className={s.issueFieldLabel}>Что может случиться</span>{issue.risk}</p>}
                                                            {issue.why && <p className={s.issueField}><span className={s.issueFieldLabel}>Почему это плохо</span>{issue.why}</p>}
                                                            {issue.fix && <p className={s.issueField}><span className={s.issueFieldLabel}>Как исправить</span>{issue.fix}</p>}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ) : (
                                        <Block title="Анализ рисков">
                                            Договор не содержит явных проблемных пунктов.
                                        </Block>
                                    )
                                ) : (
                                    <Block title="Проблемные пункты" blurred>
                                        Детальный разбор пунктов договора доступен после разблокировки.
                                    </Block>
                                )
                            ) : (
                                /* V1: flat fields */
                                <>
                                    {modalAnalysis.key_terms && (
                                        <Block title="Ключевые условия">
                                            {modalAnalysis.key_terms}
                                        </Block>
                                    )}
                                    <Block title="Риски и уязвимости" blurred={!showFull}>
                                        {showFull ? modalAnalysis.risks : "Риски доступны после разблокировки анализа."}
                                    </Block>
                                    <Block title="Неоднозначные формулировки" blurred={!showFull}>
                                        {showFull ? modalAnalysis.ambiguities : "Полный перечень доступен после разблокировки."}
                                    </Block>
                                    <Block title="Что стоит исправить" blurred={!showFull}>
                                        {showFull ? modalAnalysis.fixes : "Рекомендации по доработке доступны после разблокировки анализа."}
                                    </Block>
                                    <Block title="Вопросы к контрагенту" blurred={!showFull}>
                                        {showFull ? modalAnalysis.questions : "Список уточняющих вопросов доступен после разблокировки."}
                                    </Block>
                                </>
                            )}
                        </div>

                        <div className={s.modalFooter}>
                            {showFull ? (
                                <>
                                    <button
                                        className={s.primary}
                                        onClick={handleCopy}
                                        disabled={modalBusy}
                                    >
                                        {copied ? "Скопировано" : "Скопировать"}
                                    </button>
                                    <button
                                        className={s.secondary}
                                        onClick={handleDownload}
                                        disabled={modalBusy}
                                    >
                                        Скачать
                                    </button>
                                </>
                            ) : (
                                <>
                                    {canUnlock ? (
                                        <button
                                            className={s.primary}
                                            onClick={handleUnlock}
                                            disabled={modalBusy}
                                        >
                                            Разблокировать за 1 запрос
                                            {typeof credits === "number"
                                                ? ` (осталось: ${credits})`
                                                : ""}
                                        </button>
                                    ) : (
                                        <div className={s.muted}>
                                            Недостаточно прав для разблокировки.
                                            Оформите подписку или пополните
                                            запросы на странице{" "}
                                            <a href="/billing">биллинга</a>.
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function Block({ title, children, blurred = false }) {
    return (
        <div className={s.block}>
            <div className={s.blockTitle}>{title}</div>
            <div className={`${s.blockBody} ${blurred ? s.blurred : ""}`}>
                {typeof children === "string"
                    ? children.split("\n").map((line, i) => (
                        <p key={i}>{line}</p>
                    ))
                    : children}
            </div>
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

function fmtDate(iso) {
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return "";
        return d.toLocaleString();
    } catch {
        return "";
    }
}
