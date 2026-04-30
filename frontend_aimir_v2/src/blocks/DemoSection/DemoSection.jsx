import React from "react";
import s from "./DemoSection.module.css";
import { ArrowRight, FileText, Brain, ClipboardCheck } from "lucide-react";

const steps = [
    {
        icon: FileText,
        title: "Загрузка договора",
        description: "PDF, DOCX, или изображение",
        type: "upload",
    },
    {
        icon: Brain,
        title: "ИИ-анализ",
        description: "20+ критериев проверки",
        type: "analysis",
    },
    {
        icon: ClipboardCheck,
        title: "Готовый отчёт",
        description: "Риски, ошибки, рекомендации",
        type: "report",
    },
];

export default function DemoSection() {
    return (
        <section className={s.section}>
            <div className={s.topLine} />

            <div className={s.wrap}>
                {/* Хедер */}
                <div className={s.header}>
                    <span className={s.badge}>Как это работает</span>
                    <h2 className={s.title}>
                        От документа до готового анализа
                        <span className={s.titleAccent}>за 30 секунд</span>
                    </h2>
                    <p className={s.subtitle}>
                        Загрузите договор, и ИИ мгновенно проверит его по всем ключевым критериям
                    </p>
                </div>

                {/* Шаги */}
                <div className={s.grid}>
                    {steps.map((step, index) => {
                        const Icon = step.icon;
                        return (
                            <div key={index} className={s.stepCol}>
                                {index < steps.length - 1 && (
                                    <div className={s.arrowWrap}>
                                        <ArrowRight className={s.arrowIcon} />
                                    </div>
                                )}

                                <div className={s.card}>
                                    <div className={s.cardHead}>
                                        <div className={s.iconWrap}>
                                            <Icon className={s.icon} />
                                        </div>
                                        <div>
                                            <span className={s.stepLabel}>Шаг {index + 1}</span>
                                            <h3 className={s.stepTitle}>{step.title}</h3>
                                        </div>
                                    </div>

                                    <p className={s.stepText}>{step.description}</p>

                                    <div className={s.visual}>
                                        {step.type === "upload" && <UploadVisual />}
                                        {step.type === "analysis" && <AnalysisVisual />}
                                        {step.type === "report" && <ReportVisual />}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}

/* ===== ВИЗУАЛ №1 ===== */

function UploadVisual() {
    return (
        <div className={s.visualCard}>
            <div className={s.fileRow}>
                <div className={s.fileIconBox}>
                    <FileText className={s.fileIcon} />
                </div>
                <div className={s.fileLines}>
                    <div className={`${s.fileLine} ${s.fileLineWide}`} />
                    <div className={`${s.fileLine} ${s.fileLineNarrow}`} />
                </div>
            </div>
            <div className={s.uploadBox}>
                <p className={s.uploadName}>Договор_поставки.pdf</p>
                <p className={s.uploadStatus}>Загружен</p>
            </div>
        </div>
    );
}

/* ===== ВИЗУАЛ №2 ===== */

const analysisItems = [
    { label: "Анализ сторон", progress: 100 },
    { label: "Проверка обязательств", progress: 100 },
    { label: "Поиск рисков", progress: 100 },
    { label: "Рекомендации", progress: 85 },
];

function AnalysisVisual() {
    return (
        <div className={s.visualCard}>
            <div className={s.analysisList}>
                {analysisItems.map((item, i) => (
                    <div key={i} className={s.analysisRow}>
                        <div className={s.analysisTop}>
                            <span className={s.analysisLabel}>{item.label}</span>
                            <span className={s.analysisValue}>{item.progress}%</span>
                        </div>
                        <div className={s.progressTrack}>
                            <div
                                className={s.progressBar}
                                style={{ width: `${item.progress}%` }}
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ===== ВИЗУАЛ №3 ===== */

function ReportVisual() {
    return (
        <div className={s.visualCard}>
            <div className={s.reportHead}>
                <span className={s.reportTitle}>Результаты анализа</span>
                <span className={s.reportBadge}>Готово</span>
            </div>

            <div className={s.reportStats}>
                <div className={`${s.statCard} ${s.statRed}`}>
                    <p className={s.statValue}>2</p>
                    <p className={s.statLabel}>Риска</p>
                </div>
                <div className={`${s.statCard} ${s.statYellow}`}>
                    <p className={s.statValue}>5</p>
                    <p className={s.statLabel}>Замечаний</p>
                </div>
                <div className={`${s.statCard} ${s.statGreen}`}>
                    <p className={s.statValue}>8</p>
                    <p className={s.statLabel}>ОК</p>
                </div>
            </div>

            <div className={s.reportDownload}>
                <span className={s.reportDownloadText}>Скачать отчёт PDF</span>
            </div>
        </div>
    );
}
