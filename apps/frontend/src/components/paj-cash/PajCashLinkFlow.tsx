"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { ChevronLeft, Loader2 } from "lucide-react";
import { pajLinkInitiate, pajLinkVerify, PajCashApiError } from "@/services/pajCash";

interface PajCashLinkFlowProps {
  dark: boolean;
  prefillEmail?: string | null;
  getAccessToken: () => Promise<string | null>;
  onBack: () => void;
  onLinked: () => void;
}

/** Email/phone -> OTP -> PAJ Cash session linking, shared by the on-ramp and off-ramp flows. */
export function PajCashLinkFlow({ dark, prefillEmail, getAccessToken, onBack, onLinked }: PajCashLinkFlowProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<"recipient" | "otp">("recipient");
  const [recipient, setRecipient] = useState(prefillEmail ?? "");
  const [otp, setOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deviceUuid] = useState(() => `web-${Math.random().toString(36).slice(2)}-${Date.now()}`);

  const inputClass = `mt-1 font-mono text-base ${dark ? "bg-white/10 border-white/20 text-white placeholder:text-slate-400" : ""}`;

  const handleSendOtp = async () => {
    if (!recipient.trim()) return;
    setSubmitting(true);
    try {
      const accessToken = await getAccessToken();
      await pajLinkInitiate(recipient.trim(), accessToken);
      setStep("otp");
    } catch (err: unknown) {
      const msg = err instanceof PajCashApiError ? err.message : "Could not send verification code.";
      toast({ variant: "destructive", title: "PAJ Cash", description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async () => {
    if (!otp.trim()) return;
    setSubmitting(true);
    try {
      const accessToken = await getAccessToken();
      await pajLinkVerify(recipient.trim(), otp.trim(), deviceUuid, accessToken);
      onLinked();
    } catch (err: unknown) {
      const msg = err instanceof PajCashApiError ? err.message : "Could not verify code.";
      toast({ variant: "destructive", title: "PAJ Cash", description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="py-2 space-y-3">
      <button
        type="button"
        onClick={() => (step === "otp" ? setStep("recipient") : onBack())}
        className={`flex items-center gap-1 text-base font-medium transition-colors ${dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900"}`}
      >
        <ChevronLeft className="h-4 w-4" />
        Back
      </button>

      <p className={`text-base font-medium ${dark ? "text-slate-400" : "text-gray-500"}`}>
        {step === "recipient" ? "Connect your PAJ Cash account" : "Enter the code we sent you"}
      </p>

      {step === "recipient" ? (
        <>
          <div>
            <Label htmlFor="paj-recipient" className={dark ? "text-slate-300" : undefined}>Email or phone</Label>
            <Input
              id="paj-recipient"
              placeholder="you@example.com or +234..."
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className={inputClass}
            />
          </div>
          <Button
            onClick={handleSendOtp}
            disabled={submitting || !recipient.trim()}
            className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white disabled:opacity-50"
          >
            {submitting ? (
              <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Sending code…</span>
            ) : "Send code"}
          </Button>
        </>
      ) : (
        <>
          <p className={`text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>
            Sent to {recipient}
          </p>
          <div>
            <Label htmlFor="paj-otp" className={dark ? "text-slate-300" : undefined}>Verification code</Label>
            <Input
              id="paj-otp"
              inputMode="numeric"
              placeholder="123456"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              className={inputClass}
            />
          </div>
          <Button
            onClick={handleVerify}
            disabled={submitting || !otp.trim()}
            className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white disabled:opacity-50"
          >
            {submitting ? (
              <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Verifying…</span>
            ) : "Verify"}
          </Button>
        </>
      )}
    </div>
  );
}
