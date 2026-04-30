import React from "react";
import { Upload, Cpu, FileCheck } from "lucide-react";
import s from "./HowItWorks.module.css";

const steps = [
    {
        number: "01",
        icon: Upload,
        title: "Загрузите договор",
        description:
            "Перетащите файл или нажмите для выбора. Поддерживаются PDF, DOCX, изображения.",
    },
    {
        number: "02",
        icon: Cpu,
        title: "ИИ анализирует",
        description:
            "Искусственный интеллект проверяет документ по 20+ критериям за секунды.",
    },
    {
        number: "03",
        icon: FileCheck,
        title: "Получите отчёт",
        description:
            "Скачайте детальный отчёт с рисками, ошибками и рекомендациями.",
    },
];

export default function HowItWorks() {
    return (
        <section id="how-it-works" className={s.section}>
            <div className={s.wrap}>
                {/* Хедер секции */}
                <div className={s.header}>
                    <span className={s.badge}>Процесс работы</span>
                    <h2 className={s.title}>Три простых шага</h2>
                    <p className={s.subtitle}>
                        От загрузки до готового анализа — меньше минуты
                    </p>
                </div>

                {/* Сетка шагов */}
                <div className={s.stepsWrap}>
                    {/* линия-связка как во Vite (только на десктопе) */}
                    <div className={s.connectionLine} />

                    <div className={s.grid}>
                        {steps.map((step, index) => {
                            const Icon = step.icon;
                            return (
                                <div key={step.number} className={s.stepCol}>
                                    <div className={s.card}>
                                        {/* номер сверху в кружке */}
                                        <div className={s.numBadge}>
                                            <span>{index + 1}</span>
                                        </div>

                                        {/* иконка */}
                                        <div className={s.iconWrap}>
                                            <Icon className={s.icon} />
                                        </div>

                                        {/* большой полупрозрачный номер */}
                                        <p className={s.bigNumber}>{step.number}</p>

                                        {/* контент */}
                                        <h3 className={s.cardTitle}>{step.title}</h3>
                                        <p className={s.cardText}>{step.description}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </section>
    );
}
