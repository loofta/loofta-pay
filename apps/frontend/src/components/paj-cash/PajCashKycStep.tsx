"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { ChevronLeft, Loader2 } from "lucide-react";
import { pajSubmitKyc, PajCashApiError } from "@/services/pajCash";

interface PajCashKycStepProps {
  dark: boolean;
  getAccessToken: () => Promise<string | null>;
  onBack: () => void;
  onSubmitted: () => void;
}

/** Only shown reactively, after PAJ rejects an order for missing KYC. */
export function PajCashKycStep({ dark, getAccessToken, onBack, onSubmitted }: PajCashKycStepProps) {
  const { toast } = useToast();
  const [idType, setIdType] = useState<"BVN" | "NIN">("BVN");
  const [idNumber, setIdNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const inputClass = `mt-1 font-mono text-base ${dark ? "bg-white/10 border-white/20 text-white placeholder:text-slate-400" : ""}`;

  const handleSubmit = async () => {
    if (!idNumber.trim()) return;
    setSubmitting(true);
    try {
      const accessToken = await getAccessToken();
      await pajSubmitKyc(idNumber.trim(), idType, accessToken);
      onSubmitted();
    } catch (err: unknown) {
      const msg = err instanceof PajCashApiError ? err.message : "Could not submit verification.";
      toast({ variant: "destructive", title: "Verification failed", description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="py-2 space-y-3">
      <button
        type="button"
        onClick={onBack}
        className={`flex items-center gap-1 text-base font-medium transition-colors ${dark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900"}`}
      >
        <ChevronLeft className="h-4 w-4" />
        Back
      </button>

      <p className={`text-base font-medium ${dark ? "text-slate-400" : "text-gray-500"}`}>
        One more step: verify your identity
      </p>
      <p className={`text-base ${dark ? "text-slate-500" : "text-gray-400"}`}>
        PAJ requires ID verification before this transaction can proceed.
      </p>

      <div className="flex gap-2">
        {(["BVN", "NIN"] as const).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setIdType(type)}
            className={`flex-1 rounded-xl border-2 py-2.5 text-base font-medium transition-all ${
              idType === type
                ? "border-orange-500 bg-orange-500/10 text-orange-500"
                : dark ? "border-white/10 text-slate-300" : "border-gray-200 text-gray-600"
            }`}
          >
            {type}
          </button>
        ))}
      </div>

      <div>
        <Label htmlFor="paj-kyc-id" className={dark ? "text-slate-300" : undefined}>{idType} number</Label>
        <Input
          id="paj-kyc-id"
          inputMode="numeric"
          placeholder={idType === "BVN" ? "11-digit BVN" : "11-digit NIN"}
          value={idNumber}
          onChange={(e) => setIdNumber(e.target.value)}
          className={inputClass}
        />
      </div>

      <Button
        onClick={handleSubmit}
        disabled={submitting || !idNumber.trim()}
        className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white disabled:opacity-50"
      >
        {submitting ? (
          <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Submitting…</span>
        ) : "Verify identity"}
      </Button>
    </div>
  );
}
