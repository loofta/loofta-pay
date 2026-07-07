"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import SparksPage from "@/app/app/sparks/page";

export default function RewardsSparksPage() {
  const t = useTranslations("RewardsPage");

  return (
    <>
      <div className="bg-[#0f0f12]">
        <div className="max-w-lg mx-auto px-4 pt-4 pb-2">
          <Link
            href="/rewards"
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={15} />
            <span>{t("backToRewards")}</span>
          </Link>
        </div>
      </div>
      <SparksPage />
    </>
  );
}
