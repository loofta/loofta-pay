"use client";

import { useCallback, useEffect, useState } from "react";
import { Btn, CodeBox, Notice, PageHeader, Section } from "./ui";
import { post, usePartnerApi, type PartnerRole } from "./usePartnerApi";

type Key = { id: string; prefix: string; created_at: string };

function Snippet({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-6 first:mt-0">
      <CodeBox
        title={title}
        value={code}
        copied={copied}
        mono
        onCopy={() => {
          void navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      />
    </div>
  );
}

/** API keys for the partner's own server, and the snippets to show a user's payouts inside the partner's app. */
export function DevelopersTab({ orgId, myRole }: { orgId: string; myRole: PartnerRole }) {
  const call = usePartnerApi();
  const base = `partners/${encodeURIComponent(orgId)}/api-keys`;
  const allowed = myRole === "owner" || myRole === "admin";
  const [keys, setKeys] = useState<Key[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [batchesOn, setBatchesOn] = useState<boolean | null>(null);
  const accessBase = `partners/${encodeURIComponent(orgId)}/api-access`;

  const load = useCallback(() => {
    if (!allowed) return;
    call<Key[]>(base).then(setKeys).catch((e: Error) => setError(e.message));
    call<{ payout_batches: boolean }>(accessBase).then((a) => setBatchesOn(a.payout_batches)).catch(() => undefined);
  }, [call, base, accessBase, allowed]);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const server = `import { LooftaPayClient } from "@loofta/pay-sdk";

const loofta = new LooftaPayClient({ apiKey: process.env.LOOFTA_API_KEY });

// In the route your page calls, for the signed-in user:
const { token } = await loofta.portal.createToken({ email: user.email });
// or { platform: "twitter", handle: "bob" }, or { externalUserId: user.id }
return Response.json({ token });`;

  const react = `import { Payouts } from "@loofta/portal";

<Payouts
  getToken={() => fetch("/api/loofta-token").then((r) => r.json()).then((j) => j.token)}
/>`;

  const bulk = `import { LooftaPayClient } from "@loofta/pay-sdk";

const loofta = new LooftaPayClient({ apiKey: process.env.LOOFTA_API_KEY });

// When your admin clicks "Pay creators":
const batch = await loofta.partner.createBatch({
  idempotencyKey: \`payout-\${cycleId}\`, // the same key never creates a second batch
  label: "November creators",
  rows: creators.map((c) => ({ email: c.email, amount: c.owed, externalRef: c.id })),
});

// Send your admin to approve and pay it from the company wallet.
redirect(batch.approveUrl);

// Later, to show progress in your own admin:
const status = await loofta.partner.getBatch(batch.batchId);`;

  const html = `<div id="payouts"></div>
<script src="https://unpkg.com/@loofta/portal/dist/loofta-portal.global.js"></script>
<script>
  LooftaPortal.mount("#payouts", {
    getToken: () => fetch("/api/loofta-token").then((r) => r.json()).then((j) => j.token),
  });
</script>`;

  return (
    <>
      <PageHeader crumb="Partner portal / Developers" title="API keys and widget" blurb="Pay many people from your own platform, and show each user their balance and payouts inside your app." />
      {error && (
        <div className="mb-6">
          <Notice kind="error">{error}</Notice>
        </div>
      )}

      <Section
        title="API keys"
        desc="A key shows your users their payouts in the widget. It can never move money. Keep it on your server."
        right={
          allowed ? (
            <Btn
              disabled={busy || keys.length >= 3}
              onClick={() =>
                void run(async () => {
                  const r = await call<{ api_key: string }>(base, post());
                  setFresh(r.api_key);
                })
              }
            >
              {busy ? "Creating..." : "Create API key"}
            </Btn>
          ) : undefined
        }
      >
        {!allowed ? (
          <p className="text-[15px] text-[#C9C9D0]">Only an owner or admin can manage API keys.</p>
        ) : (
          <div className="space-y-5">
            {fresh && (
              <>
                <Notice kind="ok">Copy this key now. It is shown once and we cannot show it again.</Notice>
                <CodeBox
                  title="New API key"
                  value={fresh}
                  copied={copied}
                  onCopy={() => {
                    void navigator.clipboard.writeText(fresh).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                />
              </>
            )}
            {keys.length === 0 ? (
              <p className="text-[15px] text-[#C9C9D0]">No keys yet.</p>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#101012]">
                <div className="divide-y divide-white/10">
                  {keys.map((k) => (
                    <div key={k.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                      <div>
                        <div className="font-mono text-[15px] text-[#EDEDEF]">{k.prefix}...</div>
                        <div className="text-[14px] text-[#9C9CA5]">Created {new Date(k.created_at).toLocaleDateString()}</div>
                      </div>
                      <Btn kind="danger" disabled={busy} onClick={() => void run(() => call(`${base}/${k.id}`, { method: "DELETE" }).then(() => undefined))}>
                        Revoke
                      </Btn>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      {allowed && (
        <Section
          title="Pay in bulk from your platform"
          desc="Your server drafts a batch with its API key and sends your admin to approve it. The key cannot approve or fund anything: your team approves the batch and your company wallet's signers sign it."
          right={
            myRole === "owner" && batchesOn !== null ? (
              <Btn
                kind={batchesOn ? "ghost" : "primary"}
                disabled={busy || (!batchesOn && keys.length === 0)}
                onClick={() => void run(async () => setBatchesOn((await call<{ payout_batches: boolean }>(accessBase, post({ payout_batches: !batchesOn }))).payout_batches))}
              >
                {batchesOn ? "Turn off" : "Turn on"}
              </Btn>
            ) : undefined
          }
        >
          <p className="text-[15px] text-[#C9C9D0]">
            {batchesOn ? "On. Your API keys can draft payout batches." : "Off. Create an API key first, then an owner can turn this on."}
            {myRole !== "owner" ? " Only an owner can change this." : ""}
          </p>
          <Snippet title="Your server · draft a batch and send your admin to approve it" code={bulk} />
        </Section>
      )}

      <Section
        title="Show payouts inside your app"
        desc="Your user sees their balance and every payout with a Withdraw button. Withdrawing opens a Loofta page with your logo where they sign in with the email address you paid."
      >
        <Snippet title="1. Your server · create a token for the signed-in user" code={server} />
        <Snippet title="2. Your page · show the widget (React)" code={react} />
        <Snippet title="Or without React" code={html} />
        <p className="mt-6 text-[14px] text-[#9C9CA5]">Install with <span className="font-mono text-[#C9C9D0]">npm install @loofta/pay-sdk @loofta/portal</span>. Full guide in the developer docs.</p>
      </Section>
    </>
  );
}
