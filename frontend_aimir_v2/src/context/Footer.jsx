import React from "react";
import styles from "./Footer.module.css";
import logo from "../assets/images/logo.png";

export default function Footer() {
    return (
        <footer className={styles.footer}>
            <div className={styles.wrap}>
                {/* ---- бренд ---- */}
                <div className={styles.brandBlock}>
                    <img src={logo} alt="AI Mir" className={styles.logo} />
                    <div>
                        <div className={styles.brand}>AI Mir</div>
                        <div className={styles.sub}>ИИ-ассистент для быстрой проверки договоров</div>
                    </div>
                </div>

                {/* ---- контакты ---- */}
                <div className={styles.col}>
                    <div className={styles.head}>Контакты</div>
                    <a className={styles.link} href="mailto:strong.2026@list.ru">strong.2026@list.ru</a>
                    <span className={styles.link}>Москва, ул. Малая Дмитровка, 13</span>
                    <a
                        className={styles.link}
                        href="https://t.me/Adm1n404"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Поддержка
                    </a>
                </div>

                {/* ---- организация ---- */}
                <div className={styles.col}>
                    <div className={styles.head}>Организация</div>
                    <div className={styles.link}>ИП Слешин Алексей Кириллович</div>
                    <div className={styles.link}>
                        Юр. адрес:<br />125171, Москва, проезд 5-й Войковский, д. 2, кв. 37
                    </div>
                    <div className={styles.link}>ИНН: 774335676546</div>
                    <div className={styles.link}>ОГРНИП: 324774600362542</div>
                </div>

                {/* ---- правовое ---- */}
                <div className={styles.col}>
                    <div className={styles.head}>Правовое</div>
                    <a href="/UserAgreement" className={styles.link}>Пользовательское соглашение</a>
                    <a href="/PrivacyPolicy" className={styles.link}>Политика обработки данных</a>
                    <a href="/Offer" className={styles.link}>Публичная оферта</a>
                </div>
            </div>
        </footer>
    );
}
