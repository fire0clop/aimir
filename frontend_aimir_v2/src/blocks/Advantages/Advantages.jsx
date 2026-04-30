import React from "react";
import s from "./Advantages.module.css";

export default function Advantages() {
    return (
        <section id="advantages" className={s.section}>
            <div className={s.wrap}>
                <h2 className={s.h2}>Преимущества</h2>
                <div className={s.grid}>
                    <div className={s.card}>
                        <div className={s.head}>Скорость</div>
                        <div className={s.txt}>Через 1–2 минуты — структурированный вывод.</div>
                    </div>
                    <div className={s.card}>
                        <div className={s.head}>Точность</div>
                        <div className={s.txt}>Цитаты и ссылки на пункты договора — без воды.</div>
                    </div>
                    <div className={s.card}>
                        <div className={s.head}>Понятность</div>
                        <div className={s.txt}>Человеческий язык, короткие абзацы, практичные советы.</div>
                    </div>
                    <div className={s.card}>
                        <div className={s.head}>Конфиденциальность</div>
                        <div className={s.txt}>Файлы не публикуются, используются только для анализа.</div>
                    </div>
                </div>
            </div>
        </section>
    );
}
