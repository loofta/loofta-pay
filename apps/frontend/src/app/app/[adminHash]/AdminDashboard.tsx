"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  Loader2, RefreshCw, Shield,
  Zap, BarChart2, SendHorizonal,
} from "lucide-react";
import {
  AnalyticsData, EditForm, LIMIT, Payment, PaymentDetail, toLocalDatetime, trunc, WAITLIST_LIMIT,
} from "./admin-shared";

// Each tab is its own chunk, fetched only when that tab is actually opened — the dashboard's
// initial load (and every Fast Refresh of an unrelated tab) no longer has to compile all seven.
const tabLoading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="w-5 h-5 animate-spin text-gray-600" />
  </div>
);
const PaymentsTab = dynamic(() => import("./tabs/PaymentsTab").then((m) => m.PaymentsTab), { loading: tabLoading, ssr: false });
const SparksTab = dynamic(() => import("./tabs/SparksTab").then((m) => m.SparksTab), { loading: tabLoading, ssr: false });
const BlinkTab = dynamic(() => import("./tabs/BlinkTab").then((m) => m.BlinkTab), { loading: tabLoading, ssr: false });
const WaitlistTab = dynamic(() => import("./tabs/WaitlistTab").then((m) => m.WaitlistTab), { loading: tabLoading, ssr: false });
const CashoutTab = dynamic(() => import("./tabs/CashoutTab").then((m) => m.CashoutTab), { loading: tabLoading, ssr: false });
const LotteryTab = dynamic(() => import("./tabs/LotteryTab").then((m) => m.LotteryTab), { loading: tabLoading, ssr: false });
const PacksTab = dynamic(() => import("./tabs/PacksTab").then((m) => m.PacksTab), { loading: tabLoading, ssr: false });
const AnalyticsTab = dynamic(() => import("./tabs/AnalyticsTab").then((m) => m.AnalyticsTab), { loading: tabLoading, ssr: false });
const GiveawaysTab = dynamic(() => import("./tabs/GiveawaysTab").then((m) => m.GiveawaysTab), { loading: tabLoading, ssr: false });

type AdminTab = "payments" | "sparks" | "waitlist" | "analytics" | "blink" | "cashout" | "lottery" | "packs" | "giveaways";
const ADMIN_TAB_STORAGE_KEY = "loofta-admin-active-tab";
const ADMIN_TAB_QUERY_KEY = ["admin-active-tab"];
const VALID_ADMIN_TABS: AdminTab[] = ["payments", "sparks", "waitlist", "analytics", "blink", "cashout", "lottery", "packs", "giveaways"];

function loadStoredAdminTab(): AdminTab {
  if (typeof window === "undefined") return "payments";
  const stored = window.localStorage.getItem(ADMIN_TAB_STORAGE_KEY);
  return (VALID_ADMIN_TABS as string[]).includes(stored ?? "") ? (stored as AdminTab) : "payments";
}

export default function AdminDashboard() {
  const { authenticated, userId, login, ready } = useAuth();
  const { getAccessToken } = usePrivy();
  const { toast } = useToast();
  const pathname = usePathname(); // /app/[adminHash]
  const outreachUrl = `${pathname}/outreach`;

  // Auth
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Data
  const [payments, setPayments] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // Filters — applied state triggers fetch
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [devnetFilter, setDevnetFilter] = useState<"all" | "devnet" | "mainnet">("mainnet");
  const [statusFilter, setStatusFilter] = useState("all");

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<PaymentDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Edit modal
  const [editTarget, setEditTarget] = useState<Payment | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    status: "", expires_at: "", paid_at: "", description: "",
    recipient_address: "", recipient_username: "", recipient_email: "",
    recipient_user_id: "", created_by: "", burner_address: "",
    sender_tx_hash: "", sweep_tx_hash: "", amount: "",
    direction: "", from_chain: "", from_token: "", to_chain: "", to_token: "",
    is_devnet: false,
  });
  const [saving, setSaving] = useState(false);

  // Tabs — persisted via TanStack Query (localStorage-backed) so a reload keeps whatever tab
  // the admin was on, instead of always bouncing back to "payments".
  const queryClient = useQueryClient();
  const { data: activeTab = "payments" } = useQuery({
    queryKey: ADMIN_TAB_QUERY_KEY,
    queryFn: () => loadStoredAdminTab(),
    staleTime: Infinity,
  });
  const setActiveTab = useCallback((tab: AdminTab) => {
    queryClient.setQueryData(ADMIN_TAB_QUERY_KEY, tab);
    if (typeof window !== "undefined") window.localStorage.setItem(ADMIN_TAB_STORAGE_KEY, tab);
  }, [queryClient]);

  // Sparks leaderboard
  const [sparksData, setSparksData] = useState<any[]>([]);
  const [sparksLoading, setSparksLoading] = useState(false);
  const [sparksLoaded, setSparksLoaded] = useState(false);
  const [sparksSearch, setSparksSearch] = useState("");

  // Blink campaign
  const [blinkData, setBlinkData] = useState<any[]>([]);
  const [blinkLoading, setBlinkLoading] = useState(false);
  const [blinkLoaded, setBlinkLoaded] = useState(false);
  const [blinkSearch, setBlinkSearch] = useState("");

  // Waitlist
  const [waitlistData, setWaitlistData] = useState<any[]>([]);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [waitlistLoaded, setWaitlistLoaded] = useState(false);
  const [waitlistTotal, setWaitlistTotal] = useState(0);
  const [waitlistPage, setWaitlistPage] = useState(1);
  const [waitlistSearchInput, setWaitlistSearchInput] = useState("");
  const [waitlistSearch, setWaitlistSearch] = useState("");
  const [waitlistAccessFilter, setWaitlistAccessFilter] = useState<"all" | "granted" | "not_granted">("all");
  const [waitlistSortCol, setWaitlistSortCol] = useState("created_at");
  const [waitlistSortDir, setWaitlistSortDir] = useState<"asc" | "desc">("desc");
  const [grantingAccess, setGrantingAccess] = useState<string | null>(null);
  const [resendingEmail, setResendingEmail] = useState<string | null>(null);
  const [grantEmailInput, setGrantEmailInput] = useState("");
  const [grantingByEmail, setGrantingByEmail] = useState(false);
  const [grantTwitterInput, setGrantTwitterInput] = useState("");
  const [grantingByTwitter, setGrantingByTwitter] = useState(false);

  // Cash Out (Peer offramp / crypto withdrawals / PAJ Cash Naira)
  const [cashoutKind, setCashoutKind] = useState<"peer" | "crypto" | "naira">("peer");

  const [cashoutData, setCashoutData] = useState<any[]>([]);
  const [cashoutLoading, setCashoutLoading] = useState(false);
  const [cashoutLoaded, setCashoutLoaded] = useState(false);
  const [cashoutTotal, setCashoutTotal] = useState(0);
  const [cashoutPage, setCashoutPage] = useState(1);
  const [cashoutStatusFilter, setCashoutStatusFilter] = useState("");

  const [withdrawalsData, setWithdrawalsData] = useState<any[]>([]);
  const [withdrawalsLoading, setWithdrawalsLoading] = useState(false);
  const [withdrawalsLoaded, setWithdrawalsLoaded] = useState(false);
  const [withdrawalsTotal, setWithdrawalsTotal] = useState(0);
  const [withdrawalsPage, setWithdrawalsPage] = useState(1);
  const [withdrawalsTypeFilter, setWithdrawalsTypeFilter] = useState("");

  const [pajCashData, setPajCashData] = useState<any[]>([]);
  const [pajCashLoading, setPajCashLoading] = useState(false);
  const [pajCashLoaded, setPajCashLoaded] = useState(false);
  const [pajCashTotal, setPajCashTotal] = useState(0);
  const [pajCashPage, setPajCashPage] = useState(1);
  const [pajCashStatusFilter, setPajCashStatusFilter] = useState("");
  const [pajCashDirectionFilter, setPajCashDirectionFilter] = useState("");

  const [lotteryData, setLotteryData] = useState<any[]>([]);
  const [lotteryLoading, setLotteryLoading] = useState(false);
  const [lotteryLoaded, setLotteryLoaded] = useState(false);
  const [lotteryTotal, setLotteryTotal] = useState(0);
  const [lotteryActiveTicketsTotal, setLotteryActiveTicketsTotal] = useState(0);
  const [lotteryRevenueToday, setLotteryRevenueToday] = useState(0);
  const [lotteryPage, setLotteryPage] = useState(1);
  const [lotteryStatusFilter, setLotteryStatusFilter] = useState("");
  const [lotteryExpandedId, setLotteryExpandedId] = useState<string | null>(null);

  // Gift a Megapot ticket — one field accepts an email, X handle, or Loofta username, same as Send
  const [giftIdentifierInput, setGiftIdentifierInput] = useState("");
  const [giftNumTicketsInput, setGiftNumTicketsInput] = useState("1");
  const [giftNoteInput, setGiftNoteInput] = useState("");
  const [gifting, setGifting] = useState(false);
  const [lastGiftLink, setLastGiftLink] = useState<string | null>(null);
  const [giftsData, setGiftsData] = useState<any[]>([]);
  const [giftsLoading, setGiftsLoading] = useState(false);
  const [giftsLoaded, setGiftsLoaded] = useState(false);
  const [giftsTotal, setGiftsTotal] = useState(0);
  const [giftsPage, setGiftsPage] = useState(1);

  // Megapot referral fees — read-only balance; claiming is manual (see AdminDashboard UI note)
  const [referralFeesBalance, setReferralFeesBalance] = useState<number | null>(null);
  const [referralFeesLoading, setReferralFeesLoading] = useState(false);
  const [referralFeesLoaded, setReferralFeesLoaded] = useState(false);
  const [referralFeesWallet, setReferralFeesWallet] = useState<string | null>(null);
  const [referralFeesBasescanUrl, setReferralFeesBasescanUrl] = useState<string | null>(null);

  // Analytics
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);
  const [showAbove5List, setShowAbove5List] = useState(false);
  const [showRepeatAbove5List, setShowRepeatAbove5List] = useState(false);

  // Keep userId stable in callbacks via ref
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // Resizable columns for payments table (11 data columns, indices 0–10)
  const [colWidths, setColWidths] = useState([110, 80, 140, 150, 90, 120, 140, 55, 60, 110, 90, 90]);
  const resizeRef = useRef<{ colIdx: number; startX: number; startW: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const { colIdx, startX, startW } = resizeRef.current;
      setColWidths(prev => {
        const next = [...prev];
        next[colIdx] = Math.max(50, startW + e.clientX - startX);
        return next;
      });
    };
    const onUp = () => { resizeRef.current = null; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken().catch(() => null);
    return token ? { authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  // ── Auth check ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !authenticated || !userId) {
      setCheckingAuth(false);
      return;
    }
    authHeaders()
      .then((headers) => fetch("/api/admin/check", { headers }))
      .then((r) => r.json())
      .then((d) => setIsAuthorized(d.isAdmin ?? false))
      .catch(() => setIsAuthorized(false))
      .finally(() => setCheckingAuth(false));
  }, [ready, authenticated, userId, authHeaders]);

  // ── Fetch payments ──────────────────────────────────────────────────────────
  const fetchPayments = useCallback(async (
    page: number,
    opts: { search: string; devnet: "all" | "devnet" | "mainnet"; status: string },
  ) => {
    if (!userIdRef.current) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (opts.search) qs.set("search", opts.search);
      if (opts.devnet !== "all") qs.set("devnet", opts.devnet === "devnet" ? "true" : "false");
      if (opts.status !== "all") qs.set("status", opts.status);

      const res = await fetch(`/api/admin/payments?${qs}`, { headers: await authHeaders() });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setPayments(data.payments ?? []);
      setTotal(data.total ?? 0);
      setCurrentPage(page);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Load failed", description: err.message });
    } finally {
      setLoading(false);
    }
  }, [toast, authHeaders]);

  // Auto-fetch on filter change (but NOT on search input change — only on applied search)
  useEffect(() => {
    if (isAuthorized) {
      fetchPayments(1, { search: appliedSearch, devnet: devnetFilter, status: statusFilter });
    }
  }, [isAuthorized, appliedSearch, devnetFilter, statusFilter, fetchPayments]);

  const applySearch = () => setAppliedSearch(searchInput);
  const refresh = () => fetchPayments(currentPage, { search: appliedSearch, devnet: devnetFilter, status: statusFilter });

  const fetchSparks = useCallback(async () => {
    setSparksLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/rewards", { headers });
      if (!res.ok) throw new Error("Failed to load");
      setSparksData(await res.json());
      setSparksLoaded(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to load Sparks" });
    } finally {
      setSparksLoading(false);
    }
  }, [authHeaders, toast]);

  const fetchBlink = useCallback(async () => {
    setBlinkLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/blink-campaign", { headers });
      if (!res.ok) throw new Error("Failed to load");
      setBlinkData(await res.json());
      setBlinkLoaded(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to load Blink campaign data" });
    } finally {
      setBlinkLoading(false);
    }
  }, [authHeaders, toast]);

  const fetchWaitlist = useCallback(async (
    page = 1,
    opts: { search: string; access: string; sortCol: string; sortDir: "asc" | "desc" } = { search: "", access: "all", sortCol: "created_at", sortDir: "desc" },
  ) => {
    setWaitlistLoading(true);
    try {
      const headers = await authHeaders();
      const qs = new URLSearchParams({ page: String(page), limit: String(WAITLIST_LIMIT) });
      if (opts.search) qs.set("search", opts.search);
      if (opts.access !== "all") qs.set("access", opts.access);
      qs.set("sort_col", opts.sortCol);
      qs.set("sort_dir", opts.sortDir);
      const res = await fetch(`/api/admin/waitlist?${qs}`, { headers });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setWaitlistData(data.entries ?? []);
      setWaitlistTotal(data.total ?? 0);
      setWaitlistPage(page);
      setWaitlistLoaded(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to load waitlist" });
    } finally {
      setWaitlistLoading(false);
    }
  }, [authHeaders, toast]);

  const fetchAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/analytics", { headers });
      if (!res.ok) throw new Error("Failed to load analytics");
      setAnalyticsData(await res.json());
      setAnalyticsLoaded(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to load analytics" });
    } finally {
      setAnalyticsLoading(false);
    }
  }, [authHeaders, toast]);

  const fetchCashOuts = useCallback(async (page = 1, status = "") => {
    setCashoutLoading(true);
    try {
      const headers = await authHeaders();
      const qs = new URLSearchParams({ page: String(page) });
      if (status) qs.set("status", status);
      const res = await fetch(`/api/admin/offramp?${qs}`, { headers });
      if (!res.ok) throw new Error("Failed to load cash outs");
      const data = await res.json();
      setCashoutData(data.data ?? []);
      setCashoutTotal(data.total ?? 0);
      setCashoutPage(page);
      setCashoutLoaded(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to load cash outs" });
    } finally {
      setCashoutLoading(false);
    }
  }, [authHeaders, toast]);

  const fetchWithdrawals = useCallback(async (page = 1, type = "") => {
    setWithdrawalsLoading(true);
    try {
      const headers = await authHeaders();
      const qs = new URLSearchParams({ page: String(page) });
      if (type) qs.set("type", type);
      const res = await fetch(`/api/admin/withdrawals?${qs}`, { headers });
      if (!res.ok) throw new Error("Failed to load withdrawals");
      const data = await res.json();
      setWithdrawalsData(data.data ?? []);
      setWithdrawalsTotal(data.total ?? 0);
      setWithdrawalsPage(page);
      setWithdrawalsLoaded(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to load withdrawals" });
    } finally {
      setWithdrawalsLoading(false);
    }
  }, [authHeaders, toast]);

  const fetchPajCash = useCallback(async (page = 1, status = "", direction = "") => {
    setPajCashLoading(true);
    try {
      const headers = await authHeaders();
      const qs = new URLSearchParams({ page: String(page) });
      if (status) qs.set("status", status);
      if (direction) qs.set("direction", direction);
      const res = await fetch(`/api/admin/paj-cash?${qs}`, { headers });
      if (!res.ok) throw new Error("Failed to load Naira orders");
      const data = await res.json();
      setPajCashData(data.data ?? []);
      setPajCashTotal(data.total ?? 0);
      setPajCashPage(page);
      setPajCashLoaded(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to load Naira orders" });
    } finally {
      setPajCashLoading(false);
    }
  }, [authHeaders, toast]);

  const fetchLottery = useCallback(async (page = 1, status = "") => {
    setLotteryLoading(true);
    try {
      const headers = await authHeaders();
      const qs = new URLSearchParams({ page: String(page) });
      if (status) qs.set("status", status);
      const res = await fetch(`/api/admin/lottery?${qs}`, { headers });
      if (!res.ok) throw new Error("Failed to load lottery tickets");
      const data = await res.json();
      setLotteryData(data.data ?? []);
      setLotteryTotal(data.total ?? 0);
      setLotteryActiveTicketsTotal(data.activeTicketsTotal ?? 0);
      setLotteryRevenueToday(data.revenueToday ?? 0);
      setLotteryPage(page);
      setLotteryLoaded(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to load lottery tickets" });
    } finally {
      setLotteryLoading(false);
    }
  }, [authHeaders, toast]);

  // Ticket win/loss status can go stale between the 15-minute settlement cron ticks (see
  // resolveTicketWin's ground-truth fallback in lottery.service.ts) — re-check everything right
  // now rather than making an admin who's actively looking at this tab wait for the next tick.
  // Fire-and-forget: reconcile failing shouldn't block the list itself from loading.
  const reconcileAndFetchLottery = useCallback(async (page = 1, status = "") => {
    try {
      const headers = await authHeaders();
      await fetch("/api/admin/lottery/reconcile", { method: "POST", headers });
    } catch { /* non-fatal — list below still loads with whatever's currently stored */ }
    await fetchLottery(page, status);
  }, [authHeaders, fetchLottery]);

  const fetchGifts = useCallback(async (page = 1) => {
    setGiftsLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/admin/lottery/gifts?page=${page}`, { headers });
      if (!res.ok) throw new Error("Failed to load gifts");
      const data = await res.json();
      setGiftsData(data.data ?? []);
      setGiftsTotal(data.total ?? 0);
      setGiftsPage(page);
      setGiftsLoaded(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to load gifts" });
    } finally {
      setGiftsLoading(false);
    }
  }, [authHeaders, toast]);

  const fetchReferralFees = useCallback(async () => {
    setReferralFeesLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/lottery/referral-fees", { headers });
      if (!res.ok) throw new Error("Failed to load referral fees");
      const data = await res.json();
      setReferralFeesBalance(data.balanceUsdc ?? 0);
      setReferralFeesWallet(data.referrerWallet ?? null);
      setReferralFeesBasescanUrl(data.basescanWriteUrl ?? null);
      setReferralFeesLoaded(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to load referral fees" });
    } finally {
      setReferralFeesLoading(false);
    }
  }, [authHeaders, toast]);

  const createGiftTicket = useCallback(async () => {
    const recipientIdentifier = giftIdentifierInput.trim().replace(/^@+/, "");
    const numTickets = parseInt(giftNumTicketsInput, 10);
    if (!recipientIdentifier || !numTickets || numTickets < 1 || numTickets > 100) return;
    const recipientType = recipientIdentifier.includes("@") && recipientIdentifier.includes(".") ? "email" : "handle";
    setGifting(true);
    try {
      const res = await fetch("/api/admin/lottery/gift", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          recipientType,
          recipientIdentifier,
          numTickets,
          note: giftNoteInput.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? "Failed");
      }
      const data = await res.json();
      setLastGiftLink(data.claimUrl);
      toast({ title: `Gifted ${numTickets} ticket${numTickets === 1 ? "" : "s"} to ${recipientIdentifier}` });
      setGiftIdentifierInput("");
      setGiftNoteInput("");
      setGiftNumTicketsInput("1");
      fetchGifts(1);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to create gift", description: err.message });
    } finally {
      setGifting(false);
    }
  }, [giftIdentifierInput, giftNumTicketsInput, giftNoteInput, authHeaders, toast, fetchGifts]);

  // ── Grant access by email ────────────────────────────────────────────────────
  const grantAccessByEmail = useCallback(async () => {
    const email = grantEmailInput.trim();
    if (!email) return;
    setGrantingByEmail(true);
    try {
      const res = await fetch("/api/admin/waitlist/grant-by-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? "Failed");
      }
      toast({ title: `Mainnet access granted to ${email}` });
      setGrantEmailInput("");
      fetchWaitlist(waitlistPage, { search: waitlistSearch, access: waitlistAccessFilter, sortCol: waitlistSortCol, sortDir: waitlistSortDir });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed", description: err.message });
    } finally {
      setGrantingByEmail(false);
    }
  }, [grantEmailInput, authHeaders, toast, fetchWaitlist, waitlistPage, waitlistSearch, waitlistAccessFilter, waitlistSortCol, waitlistSortDir]);

  // ── Grant access by Twitter username ────────────────────────────────────────
  const grantAccessByTwitter = useCallback(async () => {
    const handle = grantTwitterInput.trim().replace(/^@/, "");
    if (!handle) return;
    setGrantingByTwitter(true);
    try {
      const res = await fetch("/api/admin/waitlist/grant-by-twitter", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ twitterUsername: handle }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? "Failed");
      }
      toast({ title: `Mainnet access granted to @${handle}` });
      setGrantTwitterInput("");
      fetchWaitlist(waitlistPage, { search: waitlistSearch, access: waitlistAccessFilter, sortCol: waitlistSortCol, sortDir: waitlistSortDir });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed", description: err.message });
    } finally {
      setGrantingByTwitter(false);
    }
  }, [grantTwitterInput, authHeaders, toast, fetchWaitlist, waitlistPage, waitlistSearch, waitlistAccessFilter, waitlistSortCol, waitlistSortDir]);

  // ── Grant / revoke mainnet access ───────────────────────────────────────────
  const grantWaitlistAccess = useCallback(async (id: string, grant: boolean) => {
    setGrantingAccess(id);
    try {
      const res = await fetch(`/api/admin/waitlist/${id}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ grant }),
      });
      if (!res.ok) throw new Error(await res.text());
      setWaitlistData((prev) =>
        prev.map((e) => (e.id === id ? { ...e, mainnet_access: grant } : e))
      );
      toast({ title: grant ? "Mainnet access granted" : "Mainnet access revoked" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed", description: err.message });
    } finally {
      setGrantingAccess(null);
    }
  }, [authHeaders, toast]);

  // ── Resend beta access email ─────────────────────────────────────────────────
  const resendBetaEmail = useCallback(async (id: string) => {
    setResendingEmail(id);
    try {
      const res = await fetch(`/api/admin/waitlist/${id}/resend-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Beta access email resent" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to resend", description: err.message });
    } finally {
      setResendingEmail(null);
    }
  }, [authHeaders, toast]);

  // ── Waitlist sort ────────────────────────────────────────────────────────────
  const handleWaitlistSort = (col: string) => {
    if (waitlistSortCol === col) {
      const next = waitlistSortDir === "asc" ? "desc" : "asc";
      setWaitlistSortDir(next);
      fetchWaitlist(1, { search: waitlistSearch, access: waitlistAccessFilter, sortCol: col, sortDir: next });
    } else {
      setWaitlistSortCol(col);
      setWaitlistSortDir("desc");
      fetchWaitlist(1, { search: waitlistSearch, access: waitlistAccessFilter, sortCol: col, sortDir: "desc" });
    }
  };

  const applyWaitlistSearch = () => {
    setWaitlistSearch(waitlistSearchInput);
    fetchWaitlist(1, { search: waitlistSearchInput, access: waitlistAccessFilter, sortCol: waitlistSortCol, sortDir: waitlistSortDir });
  };

  // ── Expand row ──────────────────────────────────────────────────────────────
  const toggleExpand = useCallback(async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(id);
    setExpandedDetail(null);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/admin/payments/${id}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      setExpandedDetail(await res.json());
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to load details", description: err.message });
    } finally {
      setLoadingDetail(false);
    }
  }, [expandedId, toast]);

  // ── Edit modal ──────────────────────────────────────────────────────────────
  const openEdit = (p: Payment, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditTarget(p);
    setEditForm({
      status:             p.status,
      expires_at:         toLocalDatetime(p.expires_at),
      paid_at:            toLocalDatetime(p.paid_at),
      description:        p.description ?? "",
      recipient_address:  p.recipient_address ?? "",
      recipient_username: p.recipient_username ?? "",
      recipient_email:    p.recipient_email ?? "",
      recipient_user_id:  p.recipient_user_id ?? "",
      created_by:         p.created_by ?? "",
      burner_address:     p.burner_address ?? "",
      sender_tx_hash:     p.sender_tx_hash ?? "",
      sweep_tx_hash:      p.sweep_tx_hash ?? "",
      amount:             String(p.amount ?? ""),
      direction:          p.direction ?? "",
      from_chain:         p.from_chain ?? "",
      from_token:         p.from_token ?? "",
      to_chain:           p.to_chain ?? "",
      to_token:           p.to_token ?? "",
      is_devnet:          p.is_devnet,
    });
  };

  const saveEdit = async () => {
    if (!editTarget || !userIdRef.current) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (editForm.status !== editTarget.status) body.status = editForm.status;
      const newExpiry = editForm.expires_at ? new Date(editForm.expires_at).toISOString() : null;
      if (newExpiry !== editTarget.expires_at) body.expires_at = newExpiry;
      const newPaidAt = editForm.paid_at ? new Date(editForm.paid_at).toISOString() : null;
      if (newPaidAt !== editTarget.paid_at) body.paid_at = newPaidAt;
      if (editForm.description !== (editTarget.description ?? "")) body.description = editForm.description || null;
      if (editForm.recipient_address  !== (editTarget.recipient_address  ?? "")) body.recipient_address  = editForm.recipient_address  || null;
      if (editForm.recipient_username !== (editTarget.recipient_username ?? "")) body.recipient_username = editForm.recipient_username || null;
      if (editForm.recipient_email    !== (editTarget.recipient_email    ?? "")) body.recipient_email    = editForm.recipient_email    || null;
      if (editForm.recipient_user_id  !== (editTarget.recipient_user_id  ?? "")) body.recipient_user_id  = editForm.recipient_user_id  || null;
      if (editForm.created_by         !== (editTarget.created_by         ?? "")) body.created_by         = editForm.created_by         || null;
      if (editForm.burner_address     !== (editTarget.burner_address     ?? "")) body.burner_address     = editForm.burner_address     || null;
      if (editForm.sender_tx_hash     !== (editTarget.sender_tx_hash     ?? "")) body.sender_tx_hash     = editForm.sender_tx_hash     || null;
      if (editForm.sweep_tx_hash      !== (editTarget.sweep_tx_hash      ?? "")) body.sweep_tx_hash      = editForm.sweep_tx_hash      || null;
      if (editForm.direction          !== (editTarget.direction          ?? "")) body.direction          = editForm.direction          || null;
      if (editForm.from_chain         !== (editTarget.from_chain         ?? "")) body.from_chain         = editForm.from_chain         || null;
      if (editForm.from_token         !== (editTarget.from_token         ?? "")) body.from_token         = editForm.from_token         || null;
      if (editForm.to_chain           !== (editTarget.to_chain           ?? "")) body.to_chain           = editForm.to_chain           || null;
      if (editForm.to_token           !== (editTarget.to_token           ?? "")) body.to_token           = editForm.to_token           || null;
      if (editForm.is_devnet !== editTarget.is_devnet) body.is_devnet = editForm.is_devnet;
      const newAmount = parseFloat(editForm.amount);
      if (!isNaN(newAmount) && newAmount !== Number(editTarget.amount)) body.amount = newAmount;
      if (Object.keys(body).length === 0) {
        toast({ title: "No changes" });
        setEditTarget(null);
        return;
      }
      const res = await fetch(`/api/admin/payments/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Saved" });
      setEditTarget(null);
      // Refresh the expanded detail too if open
      if (expandedId === editTarget.id) {
        setExpandedDetail(null);
        setLoadingDetail(true);
        authHeaders().then((h) =>
          fetch(`/api/admin/payments/${editTarget.id}`, { headers: h })
        ).then((r) => r.json()).then(setExpandedDetail).finally(() => setLoadingDetail(false));
      }
      refresh();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Save failed", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const copyText = (s: string) => {
    navigator.clipboard.writeText(s);
    toast({ title: "Copied", description: trunc(s, 40) });
  };

  // ── Auth states ─────────────────────────────────────────────────────────────
  if (!ready || checkingAuth || (authenticated && !userId)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f0f12]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }
  if (!authenticated || !isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f0f12]">
        <div className="text-center space-y-4 text-gray-100">
          <Shield className="w-12 h-12 text-red-500 mx-auto" />
          <h1 className="text-xl font-bold">Access Denied</h1>
          {!authenticated ? (
            <Button onClick={login}>Log In</Button>
          ) : (
            <p className="text-base md:text-sm text-gray-500">Not authorized. UID: {userId}</p>
          )}
        </div>
      </div>
    );
  }

  // ── Stats ───────────────────────────────────────────────────────────────────
  const statusCounts: Record<string, number> = {};
  for (const p of payments) {
    statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;
  }
  const totalPages = Math.ceil(total / LIMIT);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0f0f12] text-gray-100 p-4">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-blue-400 shrink-0" />
          <span className="font-bold text-base">Loofta Admin</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={
            activeTab === "payments" ? refresh :
            activeTab === "sparks" ? fetchSparks :
            activeTab === "blink" ? fetchBlink :
            activeTab === "analytics" ? fetchAnalytics :
            activeTab === "cashout" ? (
              cashoutKind === "peer" ? () => fetchCashOuts(cashoutPage, cashoutStatusFilter) :
              cashoutKind === "crypto" ? () => fetchWithdrawals(withdrawalsPage, withdrawalsTypeFilter) :
              () => fetchPajCash(pajCashPage, pajCashStatusFilter, pajCashDirectionFilter)
            ) :
            activeTab === "lottery" ? () => { reconcileAndFetchLottery(lotteryPage, lotteryStatusFilter); fetchGifts(giftsPage); fetchReferralFees(); } :
            activeTab === "giveaways" || activeTab === "packs" ? () => {} : // self-contained tabs refresh themselves
            () => fetchWaitlist(waitlistPage, { search: waitlistSearch, access: waitlistAccessFilter, sortCol: waitlistSortCol, sortDir: waitlistSortDir })
          }
          disabled={loading || sparksLoading || waitlistLoading || analyticsLoading || blinkLoading || cashoutLoading || withdrawalsLoading || pajCashLoading || lotteryLoading}
          className="border-gray-700 text-gray-300 bg-gray-900 hover:bg-gray-800"
        >
          {(loading || sparksLoading || waitlistLoading || blinkLoading) ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="ml-1.5">Refresh</span>
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-800">
        <button
          type="button"
          onClick={() => setActiveTab("payments")}
          className={`px-4 py-2 text-base md:text-sm font-medium border-b-2 transition-colors ${activeTab === "payments" ? "border-blue-500 text-blue-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          Payments
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab("sparks"); if (!sparksLoaded) fetchSparks(); }}
          className={`px-4 py-2 text-base md:text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === "sparks" ? "border-amber-500 text-amber-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          <Zap className="w-3.5 h-3.5" />
          Sparks
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab("blink"); if (!blinkLoaded) fetchBlink(); }}
          className={`px-4 py-2 text-base md:text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === "blink" ? "border-cyan-500 text-cyan-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          Blink Campaign
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab("waitlist"); if (!waitlistLoaded) fetchWaitlist(1, { search: "", access: "all", sortCol: "created_at", sortDir: "desc" }); }}
          className={`px-4 py-2 text-base md:text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === "waitlist" ? "border-green-500 text-green-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          Waitlist
          {waitlistLoaded && <span className="text-sm bg-green-900/50 text-green-400 rounded px-1.5 py-0.5">{waitlistTotal}</span>}
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab("analytics"); if (!analyticsLoaded) fetchAnalytics(); }}
          className={`px-4 py-2 text-base md:text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === "analytics" ? "border-purple-500 text-purple-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          <BarChart2 className="w-3.5 h-3.5" />
          Analytics
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab("cashout");
            if (cashoutKind === "peer" && !cashoutLoaded) fetchCashOuts(1, "");
            if (cashoutKind === "crypto" && !withdrawalsLoaded) fetchWithdrawals(1, "");
            if (cashoutKind === "naira" && !pajCashLoaded) fetchPajCash(1, "", "");
          }}
          className={`px-4 py-2 text-base md:text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === "cashout" ? "border-orange-500 text-orange-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          Cash Out
          {cashoutLoaded && <span className="text-sm bg-orange-900/50 text-orange-400 rounded px-1.5 py-0.5">{cashoutTotal + withdrawalsTotal + pajCashTotal}</span>}
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab("lottery"); if (!lotteryLoaded) reconcileAndFetchLottery(1, ""); if (!giftsLoaded) fetchGifts(1); if (!referralFeesLoaded) fetchReferralFees(); }}
          className={`px-4 py-2 text-base md:text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === "lottery" ? "border-teal-500 text-teal-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          Lottery Tickets
          {lotteryLoaded && <span className="text-sm bg-teal-900/50 text-teal-400 rounded px-1.5 py-0.5">{lotteryTotal}</span>}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("packs")}
          className={`px-4 py-2 text-base md:text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === "packs" ? "border-teal-500 text-teal-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          Mystery Packs
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("giveaways")}
          className={`px-4 py-2 text-base md:text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === "giveaways" ? "border-pink-500 text-pink-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          Giveaways
        </button>
        <Link
          href={outreachUrl}
          className="px-4 py-2 text-base md:text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-orange-400 hover:border-orange-500/50 transition-colors flex items-center gap-1.5 ml-auto"
        >
          <SendHorizonal className="w-3.5 h-3.5" />
          Outreach
        </Link>
      </div>

      {activeTab === "waitlist" && (
        <WaitlistTab
          searchInput={waitlistSearchInput} setSearchInput={setWaitlistSearchInput} applySearch={applyWaitlistSearch}
          accessFilter={waitlistAccessFilter} setAccessFilter={setWaitlistAccessFilter} fetchWaitlist={fetchWaitlist}
          grantEmailInput={grantEmailInput} setGrantEmailInput={setGrantEmailInput} grantAccessByEmail={grantAccessByEmail} grantingByEmail={grantingByEmail}
          grantTwitterInput={grantTwitterInput} setGrantTwitterInput={setGrantTwitterInput} grantAccessByTwitter={grantAccessByTwitter} grantingByTwitter={grantingByTwitter}
          loading={waitlistLoading} loaded={waitlistLoaded} data={waitlistData}
          sortCol={waitlistSortCol} sortDir={waitlistSortDir} onSort={handleWaitlistSort}
          grantingAccess={grantingAccess} grantAccess={grantWaitlistAccess}
          resendingEmail={resendingEmail} resendBetaEmail={resendBetaEmail}
          page={waitlistPage} total={waitlistTotal} search={waitlistSearch}
        />
      )}

      {activeTab === "cashout" && (
        <CashoutTab
          cashoutKind={cashoutKind} setCashoutKind={setCashoutKind}
          statusFilter={cashoutStatusFilter} setStatusFilter={setCashoutStatusFilter} fetchCashOuts={fetchCashOuts}
          total={cashoutTotal} loading={cashoutLoading} loaded={cashoutLoaded} data={cashoutData} page={cashoutPage}
          withdrawalsData={withdrawalsData} withdrawalsLoading={withdrawalsLoading} withdrawalsLoaded={withdrawalsLoaded}
          withdrawalsTotal={withdrawalsTotal} withdrawalsPage={withdrawalsPage}
          withdrawalsTypeFilter={withdrawalsTypeFilter} setWithdrawalsTypeFilter={setWithdrawalsTypeFilter} fetchWithdrawals={fetchWithdrawals}
          pajCashData={pajCashData} pajCashLoading={pajCashLoading} pajCashLoaded={pajCashLoaded}
          pajCashTotal={pajCashTotal} pajCashPage={pajCashPage}
          pajCashStatusFilter={pajCashStatusFilter} setPajCashStatusFilter={setPajCashStatusFilter}
          pajCashDirectionFilter={pajCashDirectionFilter} setPajCashDirectionFilter={setPajCashDirectionFilter} fetchPajCash={fetchPajCash}
        />
      )}

      {activeTab === "lottery" && (
        <LotteryTab
          giftIdentifierInput={giftIdentifierInput} setGiftIdentifierInput={setGiftIdentifierInput}
          giftNumTicketsInput={giftNumTicketsInput} setGiftNumTicketsInput={setGiftNumTicketsInput}
          giftNoteInput={giftNoteInput} setGiftNoteInput={setGiftNoteInput}
          gifting={gifting} createGiftTicket={createGiftTicket} lastGiftLink={lastGiftLink} copyText={copyText}
          referralFeesLoading={referralFeesLoading} referralFeesLoaded={referralFeesLoaded}
          referralFeesBalance={referralFeesBalance} referralFeesWallet={referralFeesWallet} referralFeesBasescanUrl={referralFeesBasescanUrl}
          giftsLoaded={giftsLoaded} giftsData={giftsData}
          statusFilter={lotteryStatusFilter} setStatusFilter={setLotteryStatusFilter} fetchLottery={fetchLottery}
          total={lotteryTotal} activeTicketsTotal={lotteryActiveTicketsTotal} revenueToday={lotteryRevenueToday}
          loading={lotteryLoading} loaded={lotteryLoaded} data={lotteryData} page={lotteryPage}
          expandedId={lotteryExpandedId} setExpandedId={setLotteryExpandedId}
        />
      )}

      {activeTab === "packs" && <PacksTab />}

      {activeTab === "giveaways" && <GiveawaysTab />}

      {activeTab === "analytics" && (
        <AnalyticsTab
          loading={analyticsLoading} loaded={analyticsLoaded} data={analyticsData}
          showAbove5List={showAbove5List} setShowAbove5List={setShowAbove5List}
          showRepeatAbove5List={showRepeatAbove5List} setShowRepeatAbove5List={setShowRepeatAbove5List}
          sparksData={sparksData} sparksLoaded={sparksLoaded}
        />
      )}

      {activeTab === "sparks" && (
        <SparksTab loading={sparksLoading} loaded={sparksLoaded} data={sparksData} search={sparksSearch} setSearch={setSparksSearch} />
      )}

      {activeTab === "blink" && (
        <BlinkTab loading={blinkLoading} loaded={blinkLoaded} data={blinkData} search={blinkSearch} setSearch={setBlinkSearch} />
      )}

      {activeTab === "payments" && (
        <PaymentsTab
          payments={payments} total={total} loading={loading} currentPage={currentPage} totalPages={totalPages} statusCounts={statusCounts}
          searchInput={searchInput} setSearchInput={setSearchInput} applySearch={applySearch}
          devnetFilter={devnetFilter} setDevnetFilter={setDevnetFilter}
          statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          colWidths={colWidths} resizeRef={resizeRef}
          expandedId={expandedId} expandedDetail={expandedDetail} loadingDetail={loadingDetail} toggleExpand={toggleExpand}
          copyText={copyText} openEdit={openEdit} fetchPayments={fetchPayments} appliedSearch={appliedSearch}
          editTarget={editTarget} setEditTarget={setEditTarget} editForm={editForm} setEditForm={setEditForm}
          saving={saving} saveEdit={saveEdit}
        />
      )}
    </div>
  );
}
