"use client";

import { useEffect, useState } from "react";

export interface TocItem { id: string; title: string }

/** Right-hand "On this page" list with scroll-spy, GitBook style. */
export function DocsToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) setActive(vis.target.id);
      },
      { rootMargin: "-80px 0px -65% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items]);
  return (
    <nav aria-label="On this page" className="hidden xl:block w-56 shrink-0 sticky top-24 self-start">
      <p className="mb-3 text-base font-semibold text-slate-100">On this page</p>
      <ul className="space-y-1 border-l border-white/10">
        {items.map((i) => (
          <li key={i.id}>
            <a
              href={`#${i.id}`}
              className={[
                "-ml-px block border-l py-1 pl-4 text-base transition-colors",
                active === i.id ? "border-[#FF7A2A] text-[#FF8A3D] font-medium" : "border-transparent text-slate-300 hover:text-white",
              ].join(" ")}
            >
              {i.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
