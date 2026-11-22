"use client";

import { useEffect, useState } from "react";
import { Notice } from "./ui";
import { usePartnerApi } from "./usePartnerApi";
import { GuideContent } from "./GuideTab";
import type { Org } from "./PartnerShell";

type Settings = { status: string; use_case: string | null; review_note: string | null; website: string | null; contact_email: string | null };

/** What a company sees until Loofta approves it: where its application stands, and how the product works while it waits. */
export function ReviewStatus({ org }: { org: Org }) {
  const call = usePartnerApi();
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    call<Settings>(`partners/${encodeURIComponent(org.org_id)}`).then(setS).catch(() => setS(null));
  }, [call, org.org_id]);

  const status = org.status;
  const head =
    status === "pending"
      ? { title: "Your application is being reviewed", body: "We review every company by hand. Once you are approved, your company wallet, API keys, recipients and payouts open here. We will email you." }
      : status === "rejected"
        ? { title: "We could not approve this company", body: "You can fix the details below and write to support to ask us to look again." }
        : { title: "This company is paused", body: "Nothing can be sent while it is paused. Contact support and we will help." };

  return (
    <div className="flex flex-col gap-8">
      <div className="rounded-[18px] bg-[#FFF6F1] p-6 shadow-[0_0_0_1px_#FFE1D2]">
        <div className="font-mono text-[12.5px] uppercase tracking-[0.14em] text-[#E8461A]">{status === "pending" ? "Under review" : status === "rejected" ? "Not approved" : "Paused"}</div>
        <h1 className="m-0 mt-2 text-[clamp(26px,3.4vw,34px)] font-bold leading-[1.1] tracking-[-0.025em] text-[#1D1D1F]">{head.title}</h1>
        <p className="m-0 mt-3 max-w-[640px] text-[16px] leading-[1.55] text-[#4F4F57]">{head.body}</p>
        {s?.review_note && (
          <div className="mt-4 max-w-[640px]">
            <Notice kind="info">{s.review_note}</Notice>
          </div>
        )}
        {s && (
          <dl className="m-0 mt-5 grid max-w-[640px] grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-[15px]">
            <dt className="text-[#86868B]">Company</dt><dd className="m-0 text-[#1D1D1F]">{org.name}</dd>
            {s.website && (<><dt className="text-[#86868B]">Website</dt><dd className="m-0 break-all text-[#1D1D1F]">{s.website}</dd></>)}
            {s.contact_email && (<><dt className="text-[#86868B]">Contact</dt><dd className="m-0 text-[#1D1D1F]">{s.contact_email}</dd></>)}
            {s.use_case && (<><dt className="text-[#86868B]">What you pay for</dt><dd className="m-0 text-[#1D1D1F]">{s.use_case}</dd></>)}
          </dl>
        )}
      </div>
      <div>
        <h2 className="m-0 mb-4 text-[24px] font-bold tracking-[-0.025em] text-[#1D1D1F]">While you wait: how it works</h2>
        <GuideContent />
      </div>
    </div>
  );
}
