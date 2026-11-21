"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuthStore } from "@/store/auth";
import { useAuth } from "@/hooks/useAuth";
import { Btn, Field, Notice, PageHeader, Section, inputCls } from "@/components/partner/ui";
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

function CreateOrg({ onCreated }: { onCreated: () => void }) {
  const call = usePartnerApi();
  const [name, setName] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await call("partners", post({ name: name.trim(), ...(logo ? { logo_url: logo } : {}) }));
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        crumb="Partner portal / Get started"
        title="Create your partner account"
        blurb="Pay your creators, partners or affiliates in bulk. They get paid by email and withdraw from a page with your name and logo."
      />
      {error && <Notice kind="error">{error}</Notice>}
      <Section title="Your business" desc="You can add your team and company details afterwards.">
        <div className="max-w-xl space-y-5">
          <Field label="Company or product name">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme" />
          </Field>
          <Field label="Logo" optional>
            <LogoUpload value={logo} onChange={setLogo} />
          </Field>
          <div className="flex justify-end">
            <Btn onClick={submit} disabled={busy || name.trim().length < 2}>
              {busy ? "Creating..." : "Create account"}
            </Btn>
          </div>
        </div>
      </Section>
    </>
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
      orgs={orgs ?? []}
      current={current}
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
        <p className="text-[15px] text-[#C9C9D0]">Loading...</p>
      ) : !authenticated ? (
        <div className="max-w-md">
          <p className="text-[17px] text-[#C9C9D0]">
            {inviteToken ? "Sign in with the email you were invited at to join the team." : "Sign in with your email to open your partner portal. We send you a code."}
          </p>
          <div className="mt-5">
            <Btn onClick={emailLogin}>Sign in</Btn>
          </div>
        </div>
      ) : orgs === null ? (
        <p className="text-[15px] text-[#C9C9D0]">Loading...</p>
      ) : orgs.length === 0 ? (
        <CreateOrg onCreated={() => void loadOrgs()} />
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
