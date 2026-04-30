import React, { useState } from "react";
import s from "./FAQSection.module.css";

const faqs = [
    {
        question: "Насколько безопасен сервис?",
        answer:
            "Мы используем 256-битное шифрование для всех данных. Документы обрабатываются в изолированной среде и автоматически удаляются после анализа. Серверы расположены в России, данные не передаются третьим лицам.",
    },
    {
        question: "Какова точность анализа?",
        answer:
            "ИИ обучен на тысячах договоров и актуальной судебной практике. Средняя точность выявления рисков — 98%. При этом мы рекомендуем использовать AIMIR как помощника, а не замену профессиональной юридической консультации.",
    },
    {
        question: "Как долго хранятся мои документы?",
        answer:
            "По умолчанию документы удаляются сразу после анализа.",
    },
    {
        question: "Какие форматы документов поддерживаются?",
        answer:
            "AIMIR принимает PDF, DOCX, DOC. Максимальный размер файла — 50 МБ. Внимание! Распознавание текстов со сканов не осуществляется.",
    },

];

export default function FAQSection() {
    const [openIndex, setOpenIndex] = useState(null);

    const toggleItem = (index) => {
        setOpenIndex((prev) => (prev === index ? null : index));
    };

    return (
        <section id="faq" className={s.section}>
            <div className={s.wrap}>
                <div className={s.grid}>
                    {/* Левая колонка */}
                    <div className={s.left}>
                        <span className={s.badge}>FAQ</span>
                        <h2 className={s.title}>
                            Частые <span className={s.gradient}>вопросы</span>
                        </h2>
                        <p className={s.subtitle}>
                            Не нашли ответ? Напишите нам, и мы ответим в течение часа.
                        </p>
                        <div className={s.contacts}>
                            <a
                                href="mailto:strong.2026@list.ru"
                                className={s.emailLink}
                            >
                                strong.2026@list.ru
                            </a>
                        </div>
                    </div>

                    {/* Правая колонка: аккордеон */}
                    <div className={s.right}>
                        <div className={s.accordion}>
                            {faqs.map((faq, index) => {
                                const isOpen = openIndex === index;
                                return (
                                    <div key={index} className={s.item}>
                                        <button
                                            type="button"
                                            className={`${s.trigger} ${
                                                isOpen ? s.triggerOpen : ""
                                            }`}
                                            onClick={() => toggleItem(index)}
                                            aria-expanded={isOpen}
                                            aria-controls={`faq-panel-${index}`}
                                        >
                                            <span>{faq.question}</span>
                                            <span
                                                className={`${s.icon} ${
                                                    isOpen ? s.iconOpen : ""
                                                }`}
                                            >
                                                +
                                            </span>
                                        </button>

                                        <div
                                            id={`faq-panel-${index}`}
                                            className={`${s.content} ${
                                                isOpen ? s.contentOpen : ""
                                            }`}
                                        >
                                            <p className={s.answer}>{faq.answer}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
