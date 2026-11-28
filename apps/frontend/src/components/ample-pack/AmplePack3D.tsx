"use client";

import { useEffect, useRef } from "react";

/**
 * The green Ample x Loofta pack in 3D (three.js, from public/ample-pack-3d.js, adapted from the PoolRip pack).
 * phase "open" runs the whole show: the pack charges and shakes, the top tears off, the card rises and flips to show the bonus.
 * Events from the element: charge, tear, cue, flip (the sound hook listens) and "revealed" when it settles.
 */
export default function AmplePack3D({ phase, card, rarity, hideCard, onRevealed, onFlip }: { phase: "idle" | "open"; card?: Record<string, unknown> | null; rarity?: string; hideCard?: boolean; onRevealed?: () => void; onFlip?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLElement | null>(null);
  const cb = useRef(onRevealed);
  cb.current = onRevealed;
  const flipCb = useRef(onFlip);
  flipCb.current = onFlip;
  const latest = useRef({ phase, card, rarity, hideCard });
  latest.current = { phase, card, rarity, hideCard };

  useEffect(() => {
    let cancelled = false;
    // Clash Display is the pack's lettering font.
    if (!document.getElementById("ample-pack-font")) {
      const st = document.createElement("style");
      st.id = "ample-pack-font";
      st.textContent = `@font-face{font-family:"Clash Display";src:url(/fonts/ClashDisplay-Variable.ttf) format("truetype");font-weight:200 700;font-style:normal;font-display:swap}`;
      document.head.appendChild(st);
    }
    const mount = () => {
      if (cancelled || !host.current || el.current) return;
      const e = document.createElement("ample-pack-3d-v9");
      e.setAttribute("theme", "ample");
      e.setAttribute("label", "Free pack");
      e.setAttribute("sub", "");
      e.setAttribute("interactive", "true");
      e.setAttribute("yaw", "0");
      e.setAttribute("distance", "10.2");
      e.setAttribute("phase", "idle");
      e.setAttribute("atmosphere", "true");
      e.setAttribute("card", JSON.stringify({}));
      e.addEventListener("revealed", () => cb.current?.());
      e.addEventListener("flip", () => flipCb.current?.());
      host.current.appendChild(e);
      el.current = e;
      const L = latest.current;
      if (L.card) e.setAttribute("card", JSON.stringify({ ...L.card, rarity: L.rarity ?? "rare" }));
      e.setAttribute("hidecard", String(!!L.hideCard));
      e.setAttribute("phase", L.phase);
    };
    if (customElements.get("ample-pack-3d-v9")) mount();
    else {
      let s = document.querySelector<HTMLScriptElement>('script[data-ample-pack="9"]');
      if (!s) {
        s = document.createElement("script");
        s.src = "/ample-pack-3d.js?v=12";
        s.async = true;
        s.dataset.amplePack = "9";
        document.head.appendChild(s);
      }
      customElements.whenDefined("ample-pack-3d-v9").then(mount);
    }
    return () => { cancelled = true; el.current?.remove(); el.current = null; };
  }, []);

  useEffect(() => {
    const e = el.current;
    if (!e) return;
    if (card) e.setAttribute("card", JSON.stringify({ ...card, rarity: rarity ?? "rare" }));
    e.setAttribute("hidecard", String(!!hideCard));
    e.setAttribute("phase", phase);
  });

  return <div ref={host} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}
