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

  const load = useCallback(() => {
    if (!allowed) return;
    call<Key[]>(base).then(setKeys).catch((e: Error) => setError(e.message));
  }, [call, base, allowed]);
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

  const html = `<div id="payouts"></div>
<script src="https://unpkg.com/@loofta/portal/dist/loofta-portal.global.js"></script>
<script>
  LooftaPortal.mount("#payouts", {
    getToken: () => fetch("/api/loofta-token").then((r) => r.json()).then((j) => j.token),
  });
</script>`;

  return (
    <>
      <PageHeader crumb="Partner portal / Developers" title="API key and widget" blurb="Show each of your users their balance and payouts inside your own app." />
      {error && (
        <div className="mb-6">
          <Notice kind="error">{error}</Notice>
        </div>
      )}

      <Section
        title="API keys"
        desc="A key only creates widget tokens for your users. It cannot create payouts or move money. Keep it on your server."
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

      <Section
        title="Show payouts inside your app"
        desc="Your user sees their balance and every payout with a Withdraw button. Withdrawing opens a Loofta page with your logo where they sign in with the email address you paid."
      >
        <Snippet title="1. Your server · create a token for the signed-in user" code={server} />
        <Snippet title="2. Your page · show the widget (React)" code={react} />
        <Snippet title="Or without React" code={html} />
        <p className="mt-6 text-[14px] text-[#9C9CA5]">The packages are not on npm yet. Until they are published, use them from the Loofta repository.</p>
      </Section>
    </>
  );
}
