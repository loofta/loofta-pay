"use client";

import { useEffect, useState } from "react";

/**
 * The part of the screen that is really visible. When the keyboard opens, the visual viewport shrinks while
 * the page keeps its size, so a bottom bar placed by the page ends up behind the keyboard. Placing it with
 * these numbers keeps it just above the keyboard, which is how a chat in a native app behaves.
 */
export function useVisualViewport(): { top: number; height: number; keyboard: boolean } {
  const [s, setS] = useState(() => ({ top: 0, height: typeof window === "undefined" ? 0 : window.innerHeight, keyboard: false }));
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => {
      const h = vv?.height ?? window.innerHeight;
      setS({ top: vv?.offsetTop ?? 0, height: h, keyboard: window.innerHeight - h > 120 });
    };
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return s;
}
