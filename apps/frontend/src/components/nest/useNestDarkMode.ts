"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "nest_dark_mode";

/** nest-splash.css already ships a full dark-green palette (`.ns-dark`) — this persists whether
 *  it's on, per-viewer, via localStorage. Defaults to the OS/browser preference
 *  (`prefers-color-scheme`) until the user explicitly toggles it — once they do, that explicit
 *  choice is stored and wins over system preference from then on, and live OS-theme changes are
 *  only followed automatically while no explicit choice has been made. */
export function useNestDarkMode(): [boolean, () => void] {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* private browsing / storage blocked */
    }
    if (stored === "true" || stored === "false") {
      setDark(stored === "true");
      return;
    }
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const toggle = () => {
    setDark(prev => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return [dark, toggle];
}

export function nestRootClass(dark: boolean): string {
  return dark ? "ns-root ns-dark" : "ns-root";
}
