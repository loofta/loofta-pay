'use client'

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, Clock, Settings } from "lucide-react";

type NavKey = 'send' | 'receive' | 'history' | 'settings';

function IconBubble({
                        active,
                        children,
                    }: {
    active: boolean;
    children: React.ReactNode;
}) {
    return (
        <span className="relative shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-full">
      <span
          className={[
              "absolute inset-0 rounded-full transition-all duration-300",
              active
                  ? "bg-gradient-to-br from-[#FF4A26] via-[#FF7A2A] to-[#E1A041] shadow-[0_10px_24px_rgba(255,122,42,0.22)]"
                  : "bg-white/[0.06]",
          ].join(" ")}
      />
      <span
          className={[
              "relative z-10 flex items-center justify-center",
              "[&>svg]:h-[18px] [&>svg]:w-[18px] [&>svg]:stroke-[2.25]",
              active ? "text-white" : "text-slate-300",
          ].join(" ")}
      >
        {children}
      </span>
    </span>
    );
}

function NavItem({
                     href,
                     label,
                     active,
                     icon,
                 }: {
    href: string;
    label: string;
    active: boolean;
    icon: React.ReactNode;
}) {
    return (
        <Link
            href={href}
            className={[
                "flex flex-col items-center justify-center flex-1 py-2",
                "text-[11px] font-semibold",
                active ? "text-amber-300" : "text-slate-400 hover:text-slate-200",
            ].join(" ")}
        >
            <IconBubble active={active}>{icon}</IconBubble>
            <span className="mt-1">{label}</span>
        </Link>
    );
}

export function BottomNav() {
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const tab = searchParams.get("tab");

    let activeKey: NavKey;

    if (pathname === "/history") {
        activeKey = "history";
    } else if (pathname === "/settings") {
        activeKey = "settings";
    } else if (pathname === "/" && tab === "receive") {
        activeKey = "receive";
    } else {
        activeKey = "send";
    }

    return (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 safe-area-pb bg-[#0f0f12]/70 backdrop-blur-xl border-t border-white/10 shadow-[0_-10px_30px_rgba(0,0,0,0.35)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

            <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
                <NavItem
                    href="/"
                    label="Send"
                    active={activeKey === 'send'}
                    icon={<ArrowUp />}
                />
                <NavItem
                    href="/?tab=receive"
                    label="Receive"
                    active={activeKey === 'receive'}
                    icon={<ArrowDown />}
                />
                <NavItem
                    href="/history"
                    label="History"
                    active={activeKey === 'history'}
                    icon={<Clock />}
                />
                <NavItem
                    href="/settings"
                    label="Profile"
                    active={activeKey === 'settings'}
                    icon={<Settings />}
                />
            </div>
        </nav>
    );
}