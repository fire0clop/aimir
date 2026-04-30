import React from "react";
import styles from "./Home.module.css";
import bg from "../assets/images/bg-auth.png";
import logo from "../assets/images/logo.png";
import Shortcode from "../components/Shortcode";
export default function Home() {
    return (
        <>
            <Shortcode name="upload" />
            <Shortcode name="DemoSection" />
            <Shortcode name="howItWorks" />
            <Shortcode name="reviews" />
            <Shortcode name="CapabilitiesSection" />
            <Shortcode name="BenefitsSection" />
            <Shortcode name="AudienceSection" />
            <Shortcode name="FAQSection" />

        </>
    );
}
