import React from "react";
import s from "./CapabilitiesSection.module.css";

import {
    AlertTriangle,
    FileSearch,
    Scale,
    Lightbulb,
    GitCompare,
    ShieldCheck,
} from "lucide-react";

const capabilities = [
    {
        icon: AlertTriangle,
        title: "Поиск рисков",
        description:
            "Выявляет скрытые риски, невыгодные условия и потенциальные проблемы в договоре",
        color: "#f87171",      /* red-400 */
        bg: "rgba(239,68,68,.12)", /* red-500/10 */
    },
    {
        icon: FileSearch,
        title: "Обнаружение ошибок",
        description:
            "Находит опечатки, неточности в датах, суммах и реквизитах сторон",
        color: "#facc15",
        bg: "rgba(234,179,8,.12)",
    },
    {
        icon: Scale,
        title: "Анализ противоречий",
        description:
            "Проверяет логическую согласованность пунктов и выявляет конфликты условий",
        color: "#fb923c",
        bg: "rgba(251,146,60,.12)",
    },
    {
        icon: Lightbulb,
        title: "Рекомендации",
        description:
            "Предлагает улучшения и дополнения для защиты ваших интересов",
        color: "#38bdf8",
        bg: "rgba(56,189,248,.12)",
    },
    {
        icon: GitCompare,
        title: "Сравнение версий",
        description:
            "Сравнивает редакции договора и показывает все изменения",
        color: "#c084fc",
        bg: "rgba(168,85,247,.12)",
    },
    {
        icon: ShieldCheck,
        title: "Соответствие законодательству",
        description:
            "Проверяет на соответствие актуальным нормам и требованиям ГК РФ",
        color: "#4ade80",
        bg: "rgba(74,222,128,.12)",
    },
];

export default function CapabilitiesSection() {
    return (
        <section id="capabilities" className={s.section}>
            {/* Паттерн */}
            <div className={s.pattern} />

            <div className={s.wrap}>
                {/* Заголовок */}
                <div className={s.header}>
                    <span className={s.badge}>Возможности ИИ</span>
                    <h2 className={s.title}>
                        Что умеет <span className={s.gradient}>AIMIR</span>
                    </h2>
                    <p className={s.subtitle}>
                        Полный анализ договора по 20+ критериям за считанные секунды
                    </p>
                </div>

                {/* Сетка */}
                <div className={s.grid}>
                    {capabilities.map((cap, i) => {
                        const Icon = cap.icon;
                        return (
                            <div key={i} className={s.card} style={{ animationDelay: `${i * 100}ms` }}>
                                <div
                                    className={s.iconWrap}
                                    style={{ backgroundColor: cap.bg }}
                                >
                                    <Icon className={s.icon} style={{ color: cap.color }} />
                                </div>

                                <h3 className={s.cardTitle}>{cap.title}</h3>
                                <p className={s.cardText}>{cap.description}</p>
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
