"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import {
  Icon3DArrowUser,
  Icon3DBolt,
  Icon3DStar,
} from "@/components/ui/icons3d";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "/app";
const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";

type LaunchDeckProps = {
  /** When true, "Send" scrolls to #send on the same page instead of leaving for /app. */
  sendHref?: string;
  /** Compact strip for /app (no bot, tighter padding). */
  compact?: boolean;
  className?: string;
};

/**
 * Easy launch deck — hush-style chrome 3D tiles for Send / Giveaway / Get paid.
 * Visual language from loofta-pay-private step cards + LooftaBot mascot.
 */
export function LaunchDeck({
  sendHref = `${APP_URL}?tab=send`,
  compact = false,
  className = "",
}: LaunchDeckProps) {
  const t = useTranslations("LaunchDeck");

  const actions = [
    {
      id: "send",
      title: t("sendTitle"),
      body: t("sendBody"),
      href: sendHref,
      rot: "-6deg",
      Icon: Icon3DBolt,
    },
    {
      id: "giveaway",
      title: t("giveawayTitle"),
      body: t("giveawayBody"),
      href: "/rewards-rail",
      rot: "5deg",
      Icon: Icon3DStar,
    },
    {
      id: "receive",
      title: t("receiveTitle"),
      body: t("receiveBody"),
      href: `${APP_URL}?tab=receive`,
      rot: "-4deg",
      Icon: Icon3DArrowUser,
    },
  ] as const;

  return (
    <section
      id="launch"
      className={`px-5 md:px-10 ${compact ? "py-6" : "py-16 md:py-20"} ${className}`}
    >
      <div className={`mx-auto max-w-[1240px] ${compact ? "" : ""}`}>
        {!compact && (
          <div className="mb-8 text-center sm:mb-10">
            <p className="font-grotesk text-sm font-semibold uppercase tracking-[0.22em] text-[#FF6A00]">
              {t("eyebrow")}
            </p>
            <h2 className="mt-2 font-display text-[clamp(32px,4.5vw,48px)] font-medium leading-[1.05] tracking-[-0.03em] text-[#F4F2EC]">
              {t("title")}
            </h2>
            <p className="mx-auto mt-3 max-w-[480px] font-grotesk text-lg text-[#A9A7A0]">
              {t("subtitle")}
            </p>
          </div>
        )}

        {compact && (
          <p className="mb-4 font-grotesk text-sm font-semibold uppercase tracking-[0.18em] text-[#7D7B76]">
            {t("eyebrow")}
          </p>
        )}

        <div
          className={`grid grid-cols-1 gap-4 ${compact ? "sm:grid-cols-3" : "md:grid-cols-3 md:gap-5"}`}
        >
          {actions.map((a) => (
            <Link
              key={a.id}
              href={a.href}
              className="group relative flex min-h-[200px] flex-col justify-between overflow-hidden rounded-[24px] bg-[#17171E] p-6 shadow-[0_28px_60px_-36px_rgba(0,0,0,0.75)] transition-transform duration-300 hover:-translate-y-1 sm:min-h-[240px] sm:p-7"
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  className="flex h-[72px] w-[72px] items-center justify-center rounded-[30%] shadow-[inset_0_-6px_12px_rgba(0,0,0,.45),inset_0_3px_4px_rgba(255,255,255,.35),0_24px_40px_-16px_rgba(255,106,0,.45)] transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)] group-hover:scale-105"
                  style={{
                    background:
                      "radial-gradient(circle at 30% 22%,#ffffff 0%,#e6e6ec 18%,#a3a3ad 48%,#4a4a52 80%,#8a8a94 100%)",
                    transform: `rotate(${a.rot})`,
                  }}
                >
                  <a.Icon size={44} />
                </span>
                <ArrowRight className="h-5 w-5 shrink-0 text-white/30 transition-colors group-hover:text-[#FF6A00]" />
              </div>
              <div className="mt-8">
                <h3 className="font-display text-[26px] font-medium leading-none tracking-[-0.02em] text-[#F4F2EC]">
                  {a.title}
                </h3>
                <p className="mt-2 font-grotesk text-base leading-[1.5] text-[#A9A7A0]">{a.body}</p>
              </div>
              <span
                className={`mt-5 inline-flex w-fit items-center gap-1.5 rounded-full px-4 py-2 font-display text-sm font-medium text-white ${BRAND_GRADIENT} opacity-90 transition-opacity group-hover:opacity-100`}
              >
                {t("cta")}
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
