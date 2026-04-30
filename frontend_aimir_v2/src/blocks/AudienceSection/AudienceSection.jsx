import React from "react";
import s from "./AudienceSection.module.css";
import { Scale, Building2, Rocket, ShoppingCart, Users } from "lucide-react";

const audiences = [
    {
        icon: Scale,
        title: "Юристы",
        description:
            "Экономьте время на рутинных проверках. Сосредоточьтесь на стратегии.",
        useCases: [
            "Проверка входящих договоров",
            "Аудит документов клиентов",
            "Подготовка заключений",
        ],
    },
    {
        icon: Building2,
        title: "Бизнес",
        description:
            "Минимизируйте юридические риски без дорогих консультаций.",
        useCases: [
            "Договоры с поставщиками",
            "Арендные соглашения",
            "Контракты с партнёрами",
        ],
    },
    {
        icon: Rocket,
        title: "Стартапы",
        description:
            "Быстро проверяйте документы без штатного юриста.",
        useCases: [
            "Инвестиционные документы",
            "Договоры с клиентами",
            "NDA и оферты",
        ],
    },
    {
        icon: ShoppingCart,
        title: "Закупки",
        description: "Ускорьте процесс согласования контрактов.",
        useCases: [
            "Тендерная документация",
            "Договоры поставки",
            "Рамочные соглашения",
        ],
    },
    {
        icon: Users,
        title: "HR",
        description:
            "Проверяйте трудовые договоры и внутренние документы.",
        useCases: [
            "Трудовые договоры",
            "NDA сотрудников",
            "Локальные акты",
        ],
    },
];

export default function AudienceSection() {
    return (
        <section id="audience" className={s.section}>
            <div className={s.wrap}>
                {/* Хедер секции */}
                <div className={s.header}>
                    <span className={s.badge}>Для кого</span>
                    <h2 className={s.title}>
                        Кому подходит <span className={s.gradient}>AIMIR</span>
                    </h2>
                    <p className={s.subtitle}>
                        Инструмент для всех, кто работает с договорами
                    </p>
                </div>

                {/* Карточки аудиторий */}
                <div className={s.grid}>
                    {audiences.map((audience, index) => {
                        const Icon = audience.icon;
                        return (
                            <div
                                key={index}
                                className={`${s.card} ${
                                    index === 4 ? s.cardLast : ""
                                }`}
                            >
                                <div className={s.head}>
                                    <div className={s.iconWrap}>
                                        <Icon className={s.icon} />
                                    </div>
                                    <h3 className={s.cardTitle}>{audience.title}</h3>
                                </div>

                                <p className={s.cardText}>{audience.description}</p>

                                <div className={s.useCases}>
                                    {audience.useCases.map((useCase, ucIndex) => (
                                        <div key={ucIndex} className={s.useCaseRow}>
                                            <span className={s.dot} />
                                            <span className={s.useCaseText}>{useCase}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
