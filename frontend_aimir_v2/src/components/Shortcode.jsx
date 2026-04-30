import React from "react";
import { BLOCKS } from "../blocks";

export default function Shortcode({ name, props }) {
    const Cmp = BLOCKS[name];
    if (!Cmp) return null;
    return <Cmp {...(props || {})} />;
}
