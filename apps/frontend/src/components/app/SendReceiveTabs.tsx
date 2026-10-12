"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { manrope } from "@/components/home-v4/fonts";

type Tab = "send" | "receive";

export interface SendReceiveTabsProps {
  /** Which tab is active; null = neither (e.g. on History page) */
  activeTab: Tab | null;
  onTabChange?: (tab: Tab) => void;
  /** Kept so existing call sites compile. Tabs always navigate to the app routes. */
  visualOnly?: boolean;
}

const pill =
  "inline-flex items-center gap-2 rounded-full px-[18px] py-2.5 text-[15px] font-bold transition-colors";

export function SendReceiveTabs({ activeTab }: SendReceiveTabsProps) {
  const pathname = usePathname() || "";
  const t = useTranslations("BottomNav");
  const onHistory = pathname.startsWith("/app/history") || pathname === "/history";
  const onReceive = activeTab === "receive" || pathname.startsWith("/app/receive");
  const onSend = !onHistory && !onReceive && (activeTab === "send" || pathname.startsWith("/app/send") || pathname.startsWith("/app/c/"));

  return (
    <div className={`${manrope.variable} mx-auto mb-[22px] flex max-w-[560px] items-center justify-between gap-3`} style={{ fontFamily: "var(--font-home-manrope), Manrope, sans-serif" }}>
      <div className="flex gap-1 rounded-full border border-white/[0.07] bg-[#141419] p-[5px]">
        <Link
          href="/app/send"
          className={pill}
          style={
            onSend
              ? { background: "linear-gradient(90deg,#FF2D0A,#F5B70C)", color: "#fff" }
              : { color: "#9A98A3" }
          }
        >
          ↑ {t("send")}
        </Link>
        <Link
          href="/app/receive"
          className={pill}
          style={
            onReceive
              ? { background: "linear-gradient(90deg,#FF2D0A,#F5B70C)", color: "#fff" }
              : { color: "#9A98A3" }
          }
        >
          ↓ {t("receive")}
        </Link>
      </div>
      <Link
        href="/app/history"
        className="inline-flex items-center gap-2 rounded-full border border-white/[0.07] px-4 py-[11px] text-sm font-bold"
        style={{
          background: onHistory ? "#22222A" : "#141419",
          color: onHistory ? "#F2EFE8" : "#9A98A3",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        {t("history")}
      </Link>
    </div>
  );
}
