"use client";

// Mascot.tsx — oofta Pay cartoon mascot icon, ported from react-mascots/Mascot.jsx into a proper
// TSX component (that source file used `module.exports`/`window.Mascot` UMD-style globals, which
// doesn't fit this app's ES module build — logic and markup are otherwise unchanged).
//
// Each SVG in mascots-data.ts carries THREE face variants baked in (.om-face-base/-sad/-win),
// swapped by CSS (mascots.css) based on the wrapper's mood class — not three separate image
// files, so switching mood never re-fetches or flashes.
//
//   <Mascot name="fox" />                          idle: gentle float
//   <Mascot name="raccoon" mood="happy" />         bounce + gold sparks
//   <Mascot name="turtle" mood="sad" size={64} />  droop + tear + rain cloud
//   <Mascot name="shark" mood="winning" />         star eyes + victory bounce + sparks
//   <Mascot name="cat" mood="none" size={24} />    static, e.g. inline icon

import type React from "react";
// mascots.css is imported once from the root layout (Next.js App Router only allows global CSS
// imports there, not from nested components) — see apps/frontend/src/app/layout.tsx.
import { MASCOTS } from "@/lib/mascots-data";

export type MascotMood = "idle" | "happy" | "winning" | "sad" | "none";

export default function Mascot({
  name,
  mood = "idle",
  size = 96,
  title,
  style,
  className,
  ...rest
}: {
  name: string;
  mood?: MascotMood;
  size?: number | string;
  title?: string;
  style?: React.CSSProperties;
  className?: string;
} & React.HTMLAttributes<HTMLSpanElement>) {
  const svg = MASCOTS[name];
  if (!svg) return null;
  return (
    <span
      role="img"
      aria-label={title || name}
      className={`om-mascot om-${mood} ${className ?? ""}`}
      style={{ width: size, height: size, ...style }}
      {...rest}
    >
      <span className="om-mascot-art" dangerouslySetInnerHTML={{ __html: svg }} />
      {(mood === "happy" || mood === "winning") && (
        <>
          <span className="om-spark om-spark-a"><svg viewBox="0 0 24 24"><path d="M12 0l2.6 9.4L24 12l-9.4 2.6L12 24l-2.6-9.4L0 12l9.4-2.6Z" fill="#EAB308" /></svg></span>
          <span className="om-spark om-spark-b"><svg viewBox="0 0 24 24"><path d="M12 0l2.6 9.4L24 12l-9.4 2.6L12 24l-2.6-9.4L0 12l9.4-2.6Z" fill="#FF6A00" /></svg></span>
          {mood === "winning" && <span className="om-spark om-spark-c"><svg viewBox="0 0 24 24"><path d="M12 0l2.6 9.4L24 12l-9.4 2.6L12 24l-2.6-9.4L0 12l9.4-2.6Z" fill="#EAB308" /></svg></span>}
        </>
      )}
      {mood === "sad" && (
        <>
          <svg className="om-tear" viewBox="0 0 20 30"><path d="M10 0 C10 8 18 14 18 21 a8 8 0 1 1 -16 0 C2 14 10 8 10 0Z" fill="#8A99AE" stroke="#0B0B0F" strokeWidth={2} /></svg>
          <svg className="om-cloud" viewBox="0 0 60 32"><path d="M14 26 a10 10 0 0 1 4-19 a12 12 0 0 1 23-2 a9 9 0 0 1 5 21 Z" fill="#B9B9C6" stroke="#0B0B0F" strokeWidth={2.5} /></svg>
        </>
      )}
    </span>
  );
}
