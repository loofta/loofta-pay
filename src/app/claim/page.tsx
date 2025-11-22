'use client'

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import { TokenCombobox } from "@/components/TokenCombobox";
import type { TokenSelection } from "@/app/utils/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { findTokenBySelection } from "@/lib/tokens";

async function createClaim(formData: {
  amount: string;
  toSel: TokenSelection;
  recipient: string;
}): Promise<{ id: string; link: string }> {
  const r = await fetch("/api/claims/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formData),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "Failed to create claim");
  return await r.json();
}

export default function ClaimPage() {
  const { authenticated, email: userEmail } = useAuth();
  const { toast } = useToast();
  const { data: tokens = [] } = useTokensQuery();
  const [toSel, setToSel] = useState<TokenSelection | undefined>(undefined);
  const [amount, setAmount] = useState<string>("");
  const [recipient, setRecipient] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<string>("");
  const [notifyChecked, setNotifyChecked] = useState<boolean>(Boolean(userEmail));
  const [notifyEmail, setNotifyEmail] = useState<string>(userEmail || "");

  const selectedTo = findTokenBySelection(tokens, toSel || null);

  async function onCreate() {
    if (!selectedTo || !amount || !recipient) {
      toast({ variant: "destructive", title: "Missing fields", description: "Amount, destination token and recipient are required." });
      return;
    }
    setCreating(true);
    try {
      const res = await createClaim({
        amount,
        toSel: { symbol: selectedTo.symbol, chain: selectedTo.chain },
        recipient,
        // Only include email if user opted in and a valid email is present
        notifyEmailTo: notifyChecked && notifyEmail ? notifyEmail : undefined,
      } as any);
      setLink(res.link);
      toast({ title: "Claim created", description: "Share the payment link with the payer." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to create claim", description: e?.message || "Unknown error" });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold">Create a claim</h1>
      <p className="text-gray-600 mt-2">Specify what you want to receive. We’ll generate a payment link.</p>

      <div className="mt-6 space-y-4">
        <div>
          <label className="text-sm font-medium text-gray-700">Amount</label>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 500" />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700">Destination token</label>
          <div className="mt-1 w-full">
            <TokenCombobox
              tokens={tokens}
              value={toSel}
              onChange={setToSel}
              placeholder="Select token"
              onQuery={async (q) => tokens.filter(t => t.symbol.toLowerCase().includes((q||'').toLowerCase()))}
              className="bg-white text-gray-900 border border-orange-200 hover:bg-orange-50 w-full"
            />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700">Recipient address</label>
          <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Wallet address to receive funds" />
        </div>
        <div className="pt-1 rounded-lg border bg-white p-3">
          <div className="flex items-center gap-2">
            <input id="notify" type="checkbox" className="h-4 w-4" checked={notifyChecked} onChange={(e) => setNotifyChecked(e.target.checked)} />
            <label htmlFor="notify" className="text-sm text-gray-800">Email me claim status updates</label>
          </div>
          {notifyChecked ? (
            <div className="mt-2">
              <Input
                type="email"
                placeholder="your@email.com"
                value={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.value)}
              />
              <div className="mt-1 text-xs text-gray-500">Optional. We’ll only email about this claim’s status.</div>
            </div>
          ) : (
            <div className="mt-1 text-xs text-gray-500">Optional. Add an email if you want notifications. You can skip this.</div>
          )}
        </div>
        <div className="pt-2">
          <Button disabled={creating} onClick={onCreate} className="rounded-xl" style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}>
            {creating ? "Creating…" : "Create claim"}
          </Button>
        </div>
        {link ? (
          <div className="mt-4 p-3 rounded-lg bg-gray-50 border text-sm">
            Payment link: <a className="underline" href={link} target="_blank" rel="noreferrer">{link}</a>
          </div>
        ) : null}
      </div>
    </div>
  );
}


