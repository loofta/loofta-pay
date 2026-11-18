"use client";

import { useEffect, useRef, useState } from "react";

/** "up" or "down" for a moment whenever the number changes, so you can see it move. */
export function useFlash(value: number | null | undefined, ms = 700): "up" | "down" | null {
  const prev = useRef(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (value != null && prev.current != null && value !== prev.current) {
      setDir(value > prev.current ? "up" : "down");
      const t = setTimeout(() => setDir(null), ms);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value, ms]);
  return dir;
}
