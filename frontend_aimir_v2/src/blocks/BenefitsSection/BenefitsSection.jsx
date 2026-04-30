import React from "react";
import s from "./BenefitsSection.module.css";
import { Clock, Target, Lock, BarChart3 } from "lucide-react";

const benefits = [
    {
        icon: Clock,
        stat: "30 сек",
        title: "Скорость анализа",
        description: "Вместо часов ручной проверки — мгновенный результат",
    },
    {
        icon: Target,
        stat: "98%",
        title: "Точность",
        description: "ИИ обучен на тысячах договоров и судебной практике",
    },
    {
        icon: Lock,
        stat: "100%",
        title: "Конфиденциальность",
        description: "Данные шифруются и не хранятся после анализа",
    },
    {
        icon: BarChart3,
        stat: "20+",
        title: "Критериев проверки",
        description: "Комплексный анализ всех аспектов договора",
    },
];

export default function BenefitsSection() {
    return (
        <section id="benefits" className={s.section}>
            {/* фоновые размытия */}
            <div className={s.bgDecor}>
                <div className={s.circleOne} />
                <div className={s.circleTwo} />
            </div>

            <div className={s.wrap}>
                {/* Хедер секции */}
                <div className={s.header}>
                    <span className={s.badge}>Преимущества</span>
                    <h2 className={s.title}>
                        Почему выбирают <span className={s.gradient}>AIMIR</span>
                    </h2>
                    <p className={s.subtitle}>
                        Надёжный инструмент для профессионалов и бизнеса
                    </p>
                </div>

                {/* Сетка преимуществ */}
                <div className={s.grid}>
                    {benefits.map((benefit, index) => {
                        const Icon = benefit.icon;
                        return (
                            <div key={index} className={s.card}>
                                <div className={s.iconWrap}>
                                    <Icon className={s.icon} />
                                </div>

                                <p className={s.stat}>{benefit.stat}</p>

                                <h3 className={s.cardTitle}>{benefit.title}</h3>
                                <p className={s.cardText}>{benefit.description}</p>
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
