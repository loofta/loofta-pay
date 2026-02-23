'use client'

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";

type Tab = 'send' | 'receive';

export interface SendReceiveTabsProps {
    /** Which tab is active; null = neither (e.g. on History page) */
    activeTab: Tab | null;
    onTabChange?: (tab: Tab) => void;
    /** When true, tabs are links to / and /?tab=receive (e.g. on claim or history page) */
    visualOnly?: boolean;
}

function IconBubble({
                        active,
                        children,
                    }: {
    active: boolean;
    children: React.ReactNode;
}) {
    return (
        <span className="relative shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full">
            {/* bg */}
            <span
                aria-hidden="true"
                className={[
                    "absolute inset-0 rounded-full",
                    "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    active
                        ? "bg-gradient-to-br from-[#FF4A26] via-[#FF7A2A] to-[#E1A041] shadow-[0_10px_24px_rgba(255,122,42,0.25)]"
                        : "bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
                    active ? "scale-[1.02]" : "scale-100",
                ].join(" ")}
            />
            {/* halo */}
            <span
                aria-hidden="true"
                className={[
                    "absolute -inset-1 rounded-full blur-md opacity-0",
                    "transition-opacity duration-300",
                    active ? "opacity-60 bg-[radial-gradient(circle,rgba(255,122,42,0.55),transparent_60%)]" : "",
                ].join(" ")}
            />
            {/* icône */}
            <span
                className={[
                    "relative z-10 shrink-0 flex items-center justify-center",
                    "text-white",
                    active ? "text-white" : "text-slate-300",
                    "[&>svg]:h-4 [&>svg]:w-4 [&>svg]:stroke-[2.25]",
                    "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    active ? "translate-y-[-0.5px]" : "translate-y-0",
                ].join(" ")}
            >
        {children}
      </span>
    </span>
    );
}

export function SendReceiveTabs({ activeTab, onTabChange, visualOnly }: SendReceiveTabsProps) {
    const pathname = usePathname();
    const isHistoryPage = pathname === "/history";

    const tabTextClass = (tab: Tab) =>
        [
            "relative z-10",
            "transition-colors duration-300 font-sans font-medium text-lg",
            activeTab === tab ? "text-slate-100" : "text-slate-400 group-hover:text-slate-200",
        ].join(" ");

    const tabBase =
        "group relative z-10 flex-1 min-w-[132px] whitespace-nowrap rounded-xl px-4 py-2.5 " +
        "inline-flex items-center justify-center gap-2 " +
        "font-semibold text-[16px] tracking-[-0.01em] " +
        "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] " +
        "active:scale-[0.99]";

    const sliderX = activeTab === "receive" ? "translate-x-full" : "translate-x-0";

    return (
        <div className="flex items-center justify-between gap-2 mb-6">
            <div
                className={[
                    "relative flex rounded-2xl p-1",
                    "bg-white/[0.05]",
                    "shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
                    "border border-white/[0.06]",
                    "overflow-hidden",
                ].join(" ")}
            >
                <div
                    aria-hidden="true"
                    className={[
                        "absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-xl",
                        "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                        "bg-gradient-to-b from-white/[0.08] to-white/[0.03]",
                        "shadow-[0_8px_24px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)]",
                        "border border-white/[0.08]",
                        activeTab ? sliderX : "opacity-0",
                    ].join(" ")}
                />
                <div
                    aria-hidden="true"
                    className={[
                        "pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-xl",
                        "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                        "opacity-0",
                        activeTab ? "opacity-40" : "opacity-0",
                        "bg-[radial-gradient(80%_140%_at_50%_0%,rgba(255,122,42,0.35),transparent_60%)]",
                        activeTab ? sliderX : "",
                    ].join(" ")}
                />

                {visualOnly ? (
                    <>
                        <Link href="/" className={tabBase}>
                            <IconBubble active={activeTab === 'send'}>
                                <ArrowUp />
                            </IconBubble>
                            <span className={tabTextClass('send')}>Send</span>
                        </Link>

                        <Link href="/?tab=receive" className={tabBase}>
                            <IconBubble active={activeTab === 'receive'}>
                                <ArrowDown />
                            </IconBubble>
                            <span className={tabTextClass('receive')}>Receive</span>
                        </Link>
                    </>
                ) : (
                    <>
                        <button type="button" onClick={() => onTabChange?.('send')} className={tabBase}>
                            <IconBubble active={activeTab === 'send'}>
                                <ArrowUp />
                            </IconBubble>
                            <span className={tabTextClass('send')}>Send</span>
                        </button>

                        <button type="button" onClick={() => onTabChange?.('receive')} className={tabBase}>
                            <IconBubble active={activeTab === 'receive'}>
                                <ArrowDown />
                            </IconBubble>
                            <span className={tabTextClass('receive')}>Receive</span>
                        </button>
                    </>
                )}
            </div>

            {/* History */}
            <Link
                href="/history"
                className={[
                    "p-2.5 rounded-xl transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    "border border-white/[0.06]",
                    isHistoryPage
                        ? "bg-white/10 text-amber-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                        : "bg-white/[0.05] text-slate-400 hover:text-slate-200 hover:bg-white/[0.08]",
                ].join(" ")}
                title="History"
            >
                <span className="sr-only">History</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                </svg>
            </Link>
        </div>
    );
}