"use client";

import { useState } from "react";
import "@zkmelabs/widget/dist/style.css";
import { GradientActionButton } from "@/components/ui/GradientActionButton";

type Start = { access_token: string; email: string; app_id: string; program_no: string | null; chain_id: string };

/**
 * Shown on the withdraw page to a person the partner asked to verify. The zkMe widget runs the check; when it closes we ask our
 * own backend (which asks zkMe), so the result never depends on what the browser says.
 */
export function KycGate({
  orgId,
  partnerName,
  status,
  call,
  onDone,
}: {
  orgId: string;
  partnerName: string;
  status: string;
  call: (path: string, init?: RequestInit) => Promise<any>;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const failed = status === "failed";
  const base = `partner-withdraw/${encodeURIComponent(orgId)}/kyc`;

  const recheck = async () => {
    setMsg(null);
    const r = await call(`${base}/check`, { method: "POST" });
    if (r.passed) onDone();
    else setMsg("Not verified yet. If you just finished, give it a minute and check again.");
  };

  const start = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const s = (await call(`${base}/start`, { method: "POST" })) as Start;
      const { ZkMeWidget } = await import("@zkmelabs/widget");
      const widget = new ZkMeWidget(
        s.app_id,
        partnerName,
        s.chain_id,
        {
          getAccessToken: async () => ((await call(`${base}/start`, { method: "POST" })) as Start).access_token,
          getUserAccounts: async () => [s.email],
        },
        { lv: "zkKYC", theme: "dark", ...(s.program_no ? { programNo: s.program_no } : {}) },
      );
      widget.on("kycFinished", () => void recheck().catch(() => {}));
      widget.on("close", () => void recheck().catch(() => {}));
      widget.launch();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not start the check.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-2xl border border-[color:var(--pt-w10,rgba(255,255,255,0.1))] bg-[color:var(--pt-surface2,#0E0E12)] p-5">
      <p className="text-lg font-semibold text-[color:var(--pt-ink,#fff)]">{failed ? "Your identity check did not pass" : "Verify your identity to withdraw"}</p>
      <p className="mt-2 text-base leading-relaxed text-[color:var(--pt-ink2,#C8C6D0)]">
        {failed
          ? `${partnerName} needs you to pass an identity check before you withdraw. Ask them to review it, or try again.`
          : `${partnerName} asks you to verify who you are before you withdraw. It takes a few minutes. You share proof that you passed, not your documents. Your money is waiting for you.`}
      </p>
      <GradientActionButton className="mt-5" onClick={() => void start()} disabled={busy} loading={busy} loadingText="Opening...">
        {failed ? "Try again" : "Verify my identity"}
      </GradientActionButton>
      <button type="button" className="mt-3 block text-sm text-[color:var(--pt-ink3,#8A8893)] hover:underline" onClick={() => void recheck().catch((e) => setMsg(e.message))}>
        I already verified
      </button>
      {msg && <p className="mt-3 text-base text-[color:var(--pt-ink2,#C8C6D0)]">{msg}</p>}
    </div>
  );
}
