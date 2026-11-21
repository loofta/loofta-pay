"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuthStore } from "@/store/auth";
import { useAuth } from "@/hooks/useAuth";
import { Btn, Field, Notice, inputCls } from "@/components/partner/ui";
import { post, usePartnerApi } from "@/components/partner/usePartnerApi";
import { LogoUpload } from "@/components/partner/LogoUpload";
import { useTreasury } from "@/components/partner/useTreasury";
import { WalletTab } from "@/components/partner/WalletTab";
import { PartnerShell, type Counts, type NavKey, type Org } from "@/components/partner/PartnerShell";
import { OverviewTab } from "@/components/partner/OverviewTab";
import { PayoutsTab } from "@/components/partner/PayoutsTab";
import { ActivityTab } from "@/components/partner/ActivityTab";
import { RecipientsTab } from "@/components/partner/RecipientsTab";
import { TeamTab } from "@/components/partner/TeamTab";
import { DevelopersTab } from "@/components/partner/DevelopersTab";
import { SettingsTab } from "@/components/partner/SettingsTab";

/** Shown while the sign-in state and your companies load: a soft pulse and card skeletons instead of the word "Loading". */
function PortalLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col items-center pt-[clamp(24px,10vh,120px)] text-center" role="status" aria-live="polite">
      <div className="relative flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-[#FF6A1F]/15" />
        <span className="absolute inset-1 rounded-full border-2 border-[#FF6A1F]/25" />
        <span className="absolute inset-1 animate-spin rounded-full border-2 border-transparent border-t-[#FF6A1F]" />
        <span className="h-3 w-3 rounded-full bg-[#FF6A1F]" />
      </div>
      <p className="mt-6 text-[17px] font-medium text-[color:var(--pt-ink,#EDEDEF)]">Opening your partner portal</p>
      <p className="mt-1 text-[15px] text-[color:var(--pt-ink3,#9C9CA5)]">One moment.</p>
      <div className="mt-10 grid w-full grid-cols-3 gap-3 opacity-70" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[88px] animate-pulse rounded-2xl border border-[color:var(--pt-w0p08,rgba(255,255,255,0.08))] bg-[color:var(--pt-surface,#121214)]" style={{ animationDelay: `${i * 150}ms` }} />
        ))}
      </div>
    </div>
  );
}

function CreateOrg({ onCreated, onCancel }: { onCreated: (orgId: string) => void; onCancel?: () => void }) {
  const call = usePartnerApi();
  const [name, setName] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await call<{ org_id: string }>("partners", post({ name: name.trim(), ...(logo ? { logo_url: logo } : {}) }));
      onCreated(created.org_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col items-center pt-[clamp(8px,4vh,48px)] text-center">
      <div className="font-mono text-[12.5px] uppercase tracking-[0.14em] text-[color:var(--pt-ink3,#9C9CA5)]">{onCancel ? "New company" : "Get started"}</div>
      <h1 className="m-0 mt-3 text-[clamp(30px,4vw,40px)] font-semibold leading-[1.1] tracking-[-0.02em] text-[color:var(--pt-ink,#EDEDEF)]">{onCancel ? "Add a company" : "Create your partner account"}</h1>
      <p className="m-0 mt-3 text-[17px] leading-[1.55] text-[color:var(--pt-ink2,#C9C9D0)]">
        Pay your people in bulk. They get paid by email and withdraw from a page with your name and logo.
      </p>
      {error && <div className="mt-6 w-full text-left"><Notice kind="error">{error}</Notice></div>}
      <div className="mt-8 w-full space-y-5 rounded-[18px] border border-[color:var(--pt-w0p08,rgba(255,255,255,0.08))] bg-[color:var(--pt-surface,#121214)] p-6 text-left shadow-[0_24px_50px_-30px_rgba(40,25,15,0.25)]">
        <Field label="Company or product name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme" />
        </Field>
        <Field label="Logo" optional>
          <LogoUpload value={logo} onChange={setLogo} />
        </Field>
        <Btn onClick={submit} disabled={busy || name.trim().length < 2} className="w-full">
          {busy ? "Creating..." : "Create account"}
        </Btn>
      </div>
      <p className="mt-4 text-[14px] text-[color:var(--pt-ink3,#9C9CA5)]">You can add your team and company details afterwards.</p>
      {onCancel && (
        <button type="button" onClick={onCancel} className="mt-2 text-[14px] font-semibold text-[#FF6A1F] hover:underline">Cancel</button>
      )}
    </div>
  );
}

function PartnerContent() {
  const params = useSearchParams();
  const inviteToken = params.get("invite");
  const { ready, authenticated, login, logout, userId, email } = useAuth();
  const call = usePartnerApi();
  const username = useAuthStore((st) => st.username ?? null);
  // Partner accounts sign in with email only, so a team is always reachable by the address it was invited at.
  const emailLogin = useCallback(() => void login({ loginMethods: ["email"], disableSignup: false }), [login]);
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const wantedTab = params.get("tab");
  const openBatchId = params.get("batch");
  const [tab, setTab] = useState<NavKey>(wantedTab === "payouts" && openBatchId ? "payouts" : "overview");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const acceptedRef = useRef(false);
  const [creating, setCreating] = useState(false);
  const autoLoginRef = useRef(false);

  // Nobody lands on a marketing page here: not signed in means the sign-in opens straight away.
  useEffect(() => {
    if (!ready || authenticated || autoLoginRef.current) return;
    autoLoginRef.current = true;
    emailLogin();
  }, [ready, authenticated, emailLogin]);

  const loadOrgs = useCallback(async () => {
    try {
      const r = await call<{ partners: Org[] }>("partners/mine");
      setOrgs(r.partners);
      // A link from the partner's own platform names the org and batch to open.
      const wantedOrg = new URLSearchParams(window.location.search).get("org");
      setOrgId((cur) => cur ?? r.partners.find((o) => o.org_id === wantedOrg)?.org_id ?? r.partners[0]?.org_id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [call]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void (async () => {
      // An invite link is accepted once, as the signed-in user. The server checks the email matches.
      if (inviteToken && !acceptedRef.current) {
        acceptedRef.current = true;
        try {
          await call("partners/invites/accept", post({ token: inviteToken }));
          setNotice("You joined the team.");
          window.history.replaceState(null, "", "/partner/portal");
        } catch (e) {
          setError((e as Error).message);
        }
      }
      await loadOrgs();
    })();
  }, [ready, authenticated, inviteToken, call, loadOrgs]);

  const current = orgs?.find((o) => o.org_id === orgId) ?? null;
  const treasury = useTreasury(current?.org_id ?? null, authenticated && !!current);

  // Sidebar badges refresh whenever you move between screens.
  useEffect(() => {
    if (!current) return;
    call<Counts>(`partners/${encodeURIComponent(current.org_id)}/counts`)
      .then(setCounts)
      .catch(() => undefined);
  }, [call, current, tab]);

  // The header shows the account menu for anyone signed in, even before they have a partner account.
  const signedIn = ready && authenticated;

  return (
    <PartnerShell
      orgs={authenticated ? orgs ?? [] : []}
      current={authenticated ? current : null}
      onAddCompany={authenticated && current ? () => setCreating(true) : undefined}
      centered={!ready || !authenticated || !current || creating}
      onSelectOrg={(id) => {
        setOrgId(id);
        setCounts(null);
        setTab("overview");
      }}
      tab={tab}
      onTab={setTab}
      counts={counts}
      usdc={treasury.state && treasury.state.created ? treasury.state.usdc : null}
      signedIn={signedIn}
      authReady={ready}
      onSignIn={emailLogin}
      onLogout={() => void logout()}
      username={username}
      email={email}
    >
      {error && (
        <div className="mb-6">
          <Notice kind="error">{error}</Notice>
        </div>
      )}
      {notice && (
        <div className="mb-6">
          <Notice kind="ok">{notice}</Notice>
        </div>
      )}

      {!ready ? (
        <PortalLoading />
      ) : !authenticated ? (
        <div className="mx-auto flex w-full max-w-[460px] flex-col items-center pt-[clamp(8px,6vh,72px)] text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FFEDE5] text-[#E8461A]">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 9l9 6 9-6" /></svg>
          </span>
          <h1 className="m-0 mt-6 text-[clamp(28px,4vw,38px)] font-semibold leading-[1.1] tracking-[-0.02em] text-[color:var(--pt-ink,#EDEDEF)]">Sign in to your partner portal</h1>
          <p className="m-0 mt-3 text-[17px] leading-[1.55] text-[color:var(--pt-ink2,#C9C9D0)]">
            {inviteToken ? "Use the email address you were invited at to join the team." : "We email you a code. No password. If this is your first time, signing in is how you create your account."}
          </p>
          <div className="mt-7 w-full rounded-[18px] border border-[color:var(--pt-w0p08,rgba(255,255,255,0.08))] bg-[color:var(--pt-surface,#121214)] p-5 shadow-[0_24px_50px_-30px_rgba(40,25,15,0.25)]">
            <Btn onClick={emailLogin} className="w-full">Continue with email</Btn>
            <div className="mt-4 flex items-center justify-center gap-5 text-[14px]">
              <a href="/partner-tutorial" className="font-semibold text-[#FF6A1F] hover:underline">Watch the tutorial</a>
              <a href="/docs" className="text-[color:var(--pt-ink3,#9C9CA5)] hover:underline">Read the docs</a>
            </div>
          </div>
        </div>
      ) : orgs === null ? (
        <PortalLoading />
      ) : creating ? (
        <CreateOrg
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            void loadOrgs().then(() => {
              setOrgId(id);
              setCounts(null);
              setTab("overview");
              setCreating(false);
            });
          }}
        />
      ) : orgs.length === 0 ? (
        <CreateOrg onCreated={(id) => void loadOrgs().then(() => setOrgId(id))} />
      ) : (
        current && (
          <>
            {tab === "overview" && <OverviewTab orgId={current.org_id} treasury={treasury} counts={counts} go={setTab} />}
            {tab === "wallet" && <WalletTab orgId={current.org_id} myRole={current.role} treasury={treasury} />}
            {tab === "payouts" && <PayoutsTab orgId={current.org_id} myRole={current.role} myUserId={userId} treasury={treasury} goWallet={() => setTab("wallet")} openBatchId={openBatchId} />}
            {tab === "activity" && <ActivityTab orgId={current.org_id} />}
            {tab === "recipients" && <RecipientsTab orgId={current.org_id} myRole={current.role} />}
            {tab === "team" && <TeamTab orgId={current.org_id} myRole={current.role} myUserId={userId} />}
            {tab === "developers" && <DevelopersTab orgId={current.org_id} myRole={current.role} />}
            {tab === "settings" && <SettingsTab orgId={current.org_id} />}
          </>
        )
      )}
    </PartnerShell>
  );
}

export default function PartnerPage() {
  return (
    <Suspense fallback={null}>
      <PartnerContent />
    </Suspense>
  );
}
