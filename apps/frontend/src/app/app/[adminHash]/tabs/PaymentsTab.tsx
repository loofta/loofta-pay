"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PayLinkCashouts } from "./PayLinkCashouts";
import { ChevronDown, ChevronRight, Loader2, Pencil, Search } from "lucide-react";
import {
  DetailPanel, EditForm, fmtFull, fmtShort, LIMIT, Payment, PaymentDetail,
  PlatformBadge, platformLabel, RECIPIENT_PLATFORMS, RecipientCell, STATUS_STYLE, STATUSES, TxCell, UserChip,
} from "../admin-shared";

export function PaymentsTab({
  payments, total, loading, currentPage, totalPages, statusCounts,
  searchInput, setSearchInput, applySearch,
  devnetFilter, setDevnetFilter,
  statusFilter, setStatusFilter,
  platformFilter, setPlatformFilter,
  colWidths, resizeRef,
  expandedId, expandedDetail, loadingDetail, toggleExpand,
  copyText, openEdit, fetchPayments, appliedSearch,
  editTarget, setEditTarget, editForm, setEditForm, saving, saveEdit, authHeaders,
}: {
  payments: Payment[];
  total: number;
  loading: boolean;
  currentPage: number;
  totalPages: number;
  statusCounts: Record<string, number>;
  searchInput: string;
  setSearchInput: (v: string) => void;
  applySearch: () => void;
  devnetFilter: "all" | "devnet" | "mainnet";
  setDevnetFilter: (v: "all" | "devnet" | "mainnet") => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  platformFilter: string;
  setPlatformFilter: (v: string) => void;
  colWidths: number[];
  resizeRef: React.RefObject<{ colIdx: number; startX: number; startW: number } | null>;
  expandedId: string | null;
  expandedDetail: PaymentDetail | null;
  loadingDetail: boolean;
  toggleExpand: (id: string) => void;
  copyText: (s: string) => void;
  openEdit: (p: Payment, e: React.MouseEvent) => void;
  fetchPayments: (page: number, opts: { search: string; devnet: "all" | "devnet" | "mainnet"; status: string; platform?: string }) => void;
  appliedSearch: string;
  editTarget: Payment | null;
  setEditTarget: (p: Payment | null) => void;
  editForm: EditForm;
  setEditForm: React.Dispatch<React.SetStateAction<EditForm>>;
  saving: boolean;
  saveEdit: () => void;
  authHeaders: () => Promise<Record<string, string>>;
}) {
  return (
    <>
      {/* Stats bar */}
      <div className="flex flex-wrap gap-2 mb-4 text-sm">
        <span className="text-gray-400">
          Loaded <span className="text-white font-semibold">{payments.length}</span>
          {" "}/ total <span className="text-white font-semibold">{total}</span>
        </span>
        {STATUSES.filter((s) => (statusCounts[s] ?? 0) > 0).map((s) => (
          <span key={s} className={`px-2 py-0.5 rounded border ${STATUS_STYLE[s]}`}>
            {s} {statusCounts[s]}
          </span>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-56">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-500 pointer-events-none" />
          <Input
            placeholder="recipient handle · username · email · address · tx hash · payment ID…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applySearch()}
            className="pl-9 bg-gray-900 border-gray-700 text-gray-100 placeholder:text-gray-600 text-base md:text-sm"
          />
        </div>
        <Select value={devnetFilter} onValueChange={(v: "all" | "devnet" | "mainnet") => setDevnetFilter(v)}>
          <SelectTrigger className="w-36 bg-gray-900 border-gray-700 text-gray-100">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-gray-900 border-gray-700 text-gray-100">
            <SelectItem value="all">All networks</SelectItem>
            <SelectItem value="devnet">Devnet only</SelectItem>
            <SelectItem value="mainnet">Mainnet only</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48 bg-gray-900 border-gray-700 text-gray-100">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent className="bg-gray-900 border-gray-700 text-gray-100">
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="w-40 bg-gray-900 border-gray-700 text-gray-100">
            <SelectValue placeholder="All platforms" />
          </SelectTrigger>
          <SelectContent className="bg-gray-900 border-gray-700 text-gray-100">
            <SelectItem value="all">All platforms</SelectItem>
            {RECIPIENT_PLATFORMS.map((pl) => (
              <SelectItem key={pl} value={pl}>{platformLabel(pl)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={applySearch}
          className="bg-blue-700 hover:bg-blue-600 text-white"
        >
          Search
        </Button>
      </div>

      <PayLinkCashouts authHeaders={authHeaders} />

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="text-sm border-collapse" style={{ tableLayout: "fixed", minWidth: 900 }}>
          <thead>
            <tr className="bg-gray-900 text-gray-500 text-[10px] uppercase tracking-wider border-b border-gray-800">
              <th style={{ width: 24 }} className="px-2 py-2" />
              {(["Created","ID","Sender","Recipient","Platform","Amount","Chain","Status","Net","Private","Expires","Sender TX","Sweep TX"] as const).map((label, i) => (
                <th
                  key={label}
                  className="px-3 py-2 text-left"
                  style={{ width: colWidths[i], position: "relative", userSelect: "none" }}
                >
                  {label}
                  <div
                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500 transition-colors"
                    onMouseDown={(e) => { e.preventDefault(); resizeRef.current = { colIdx: i, startX: e.clientX, startW: colWidths[i] }; }}
                  />
                </th>
              ))}
              <th style={{ width: 32 }} className="py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && payments.length === 0 ? (
              <tr>
                <td colSpan={14} className="text-center py-16 text-gray-600">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                </td>
              </tr>
            ) : payments.length === 0 ? (
              <tr>
                <td colSpan={14} className="text-center py-16 text-gray-600">No payments found</td>
              </tr>
            ) : (
              payments.map((p) => (
                <React.Fragment key={p.id}>
                  <tr
                    onClick={() => toggleExpand(p.id)}
                    className={`border-b border-gray-800/60 cursor-pointer transition-colors ${
                      expandedId === p.id ? "bg-gray-900" : "hover:bg-gray-900/50"
                    }`}
                  >
                    {/* Expand toggle */}
                    <td className="px-2 py-2 text-gray-600">
                      {expandedId === p.id
                        ? <ChevronDown className="w-3 h-3" />
                        : <ChevronRight className="w-3 h-3" />}
                    </td>

                    {/* Created */}
                    <td className="px-3 py-2 text-gray-400 whitespace-nowrap" title={fmtFull(p.created_at)}>
                      {fmtShort(p.created_at)}
                    </td>

                    {/* ID */}
                    <td className="px-3 py-2">
                      <span
                        className="font-mono text-gray-400 hover:text-white cursor-pointer"
                        title={p.id}
                        onClick={(e) => { e.stopPropagation(); copyText(p.id); }}
                      >
                        {p.id.slice(0, 8)}
                      </span>
                    </td>

                    {/* Sender */}
                    <td className="px-3 py-2">
                      <UserChip user={p.sender_user} privyId={p.created_by} />
                    </td>

                    {/* Recipient */}
                    <td className="px-3 py-2 overflow-hidden">
                      <RecipientCell p={p} />
                    </td>

                    {/* Platform */}
                    <td className="px-3 py-2">
                      <PlatformBadge platform={p.recipient_platform} />
                    </td>

                    {/* Amount */}
                    <td className="px-3 py-2 font-semibold whitespace-nowrap">
                      {Number(p.amount).toFixed(2)}{" "}
                      <span className="text-gray-400 font-normal">{p.to_token ?? "USDC"}</span>
                    </td>

                    {/* Chain */}
                    <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                      {p.from_chain ?? "?"}<span className="text-gray-700 mx-1">→</span>{p.to_chain ?? "sol"}
                    </td>

                    {/* Status */}
                    <td className="px-3 py-2">
                      <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-medium whitespace-nowrap ${STATUS_STYLE[p.status] ?? "bg-gray-800 text-gray-400 border-gray-600"}`}>
                        {p.status}
                      </span>
                    </td>

                    {/* Network */}
                    <td className="px-3 py-2">
                      {p.is_devnet
                        ? <span className="text-[9px] px-1 py-0.5 rounded border border-orange-800 bg-orange-950 text-orange-400">DEV</span>
                        : <span className="text-[9px] px-1 py-0.5 rounded border border-green-800 bg-green-950 text-green-400">MAIN</span>}
                    </td>

                    {/* Private vs public — is_private flips to true post-creation if a sender
                        pays a non-private link privately anyway, so this reflects what actually
                        happened, not just how the link was originally created. */}
                    <td className="px-3 py-2">
                      {p.is_private !== false
                        ? <span className="text-[9px] px-1 py-0.5 rounded border border-violet-800 bg-violet-950 text-violet-400">PRIVATE</span>
                        : <span className="text-[9px] px-1 py-0.5 rounded border border-gray-700 bg-gray-800 text-gray-400">PUBLIC</span>}
                    </td>

                    {/* Expires */}
                    <td
                      className="px-3 py-2 text-gray-400 whitespace-nowrap"
                      title={fmtFull(p.expires_at)}
                    >
                      {p.expires_at
                        ? <span className={new Date(p.expires_at) < new Date() ? "text-red-400" : ""}>{fmtShort(p.expires_at)}</span>
                        : <span className="text-gray-700">—</span>}
                    </td>

                    {/* Sender TX */}
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <TxCell hash={p.sender_tx_hash} chain={p.from_chain} isDevnet={p.is_devnet} />
                    </td>

                    {/* Sweep TX */}
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <TxCell hash={p.sweep_tx_hash} chain="solana" isDevnet={p.is_devnet} />
                    </td>

                    {/* Edit */}
                    <td className="px-3 py-2">
                      <button
                        onClick={(e) => openEdit(p, e)}
                        className="text-gray-600 hover:text-gray-200 transition-colors"
                        title="Edit payment"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>

                  {/* Expanded detail row */}
                  {expandedId === p.id && (
                    <tr className="bg-gray-900 border-b border-gray-700">
                      <td colSpan={14} className="px-6 py-4">
                        {loadingDetail && !expandedDetail ? (
                          <div className="flex items-center gap-2 text-gray-500 py-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading details…
                          </div>
                        ) : expandedDetail ? (
                          <DetailPanel detail={expandedDetail} onCopy={copyText} />
                        ) : null}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-between mt-4 text-base md:text-sm text-gray-400">
          <span>{total} total payments · page {currentPage} of {totalPages}</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1 || loading}
              onClick={() => fetchPayments(currentPage - 1, { search: appliedSearch, devnet: devnetFilter, status: statusFilter, platform: platformFilter })}
              className="border-gray-700 text-gray-300 bg-gray-900 hover:bg-gray-800"
            >
              ← Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages || loading}
              onClick={() => fetchPayments(currentPage + 1, { search: appliedSearch, devnet: devnetFilter, status: statusFilter, platform: platformFilter })}
              className="border-gray-700 text-gray-300 bg-gray-900 hover:bg-gray-800"
            >
              Next →
            </Button>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="bg-gray-900 border-gray-700 text-gray-100 max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-blue-400" />
              Edit Payment
            </DialogTitle>
            <p className="font-mono text-[10px] text-gray-500 break-all">{editTarget?.id}</p>
          </DialogHeader>

          <div className="max-h-[70vh] overflow-y-auto pr-1 space-y-5 py-2">

            {/* ── Status & timing ── */}
            <div className="space-y-3">
              <p className="text-[10px] uppercase tracking-widest text-gray-600">Status &amp; timing</p>
              <div>
                <Label className="text-gray-400 text-sm mb-1.5 block">Status</Label>
                <Select value={editForm.status} onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger className="bg-gray-800 border-gray-600 text-gray-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700 text-gray-100">
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-gray-400 text-sm mb-1.5 block">Expires at</Label>
                  <Input type="datetime-local" value={editForm.expires_at}
                    onChange={(e) => setEditForm((f) => ({ ...f, expires_at: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-gray-100" />
                </div>
                <div>
                  <Label className="text-gray-400 text-sm mb-1.5 block">Paid at</Label>
                  <Input type="datetime-local" value={editForm.paid_at}
                    onChange={(e) => setEditForm((f) => ({ ...f, paid_at: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-gray-100" />
                </div>
              </div>
            </div>

            {/* ── Amount & chain ── */}
            <div className="space-y-3">
              <p className="text-[10px] uppercase tracking-widest text-gray-600">Amount &amp; chain</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-gray-400 text-sm mb-1.5 block">Amount</Label>
                  <Input type="number" step="any" value={editForm.amount}
                    onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-gray-100 font-mono" />
                </div>
                <div>
                  <Label className="text-gray-400 text-sm mb-1.5 block">Direction</Label>
                  <Input value={editForm.direction}
                    onChange={(e) => setEditForm((f) => ({ ...f, direction: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-gray-100 font-mono" placeholder="e.g. OUT" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-gray-400 text-sm mb-1.5 block">From chain</Label>
                  <Input value={editForm.from_chain}
                    onChange={(e) => setEditForm((f) => ({ ...f, from_chain: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-gray-100 font-mono" placeholder="e.g. sol" />
                </div>
                <div>
                  <Label className="text-gray-400 text-sm mb-1.5 block">From token</Label>
                  <Input value={editForm.from_token}
                    onChange={(e) => setEditForm((f) => ({ ...f, from_token: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-gray-100 font-mono" placeholder="e.g. USDC" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-gray-400 text-sm mb-1.5 block">To chain</Label>
                  <Input value={editForm.to_chain}
                    onChange={(e) => setEditForm((f) => ({ ...f, to_chain: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-gray-100 font-mono" placeholder="e.g. sol" />
                </div>
                <div>
                  <Label className="text-gray-400 text-sm mb-1.5 block">To token</Label>
                  <Input value={editForm.to_token}
                    onChange={(e) => setEditForm((f) => ({ ...f, to_token: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-gray-100 font-mono" placeholder="e.g. USDC" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="is_devnet"
                  type="checkbox"
                  checked={editForm.is_devnet}
                  onChange={(e) => setEditForm((f) => ({ ...f, is_devnet: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-blue-500"
                />
                <Label htmlFor="is_devnet" className="text-gray-400 text-sm cursor-pointer">Devnet</Label>
              </div>
            </div>

            {/* ── Parties ── */}
            <div className="space-y-3">
              <p className="text-[10px] uppercase tracking-widest text-gray-600">Parties</p>
              <div>
                <Label className="text-gray-400 text-sm mb-1.5 block">Sender privy ID (created_by)</Label>
                <Input value={editForm.created_by}
                  onChange={(e) => setEditForm((f) => ({ ...f, created_by: e.target.value }))}
                  className="bg-gray-800 border-gray-600 text-gray-100 font-mono text-sm" placeholder="did:privy:…" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-gray-400 text-sm mb-1.5 block">Recipient username</Label>
                  <Input value={editForm.recipient_username}
                    onChange={(e) => setEditForm((f) => ({ ...f, recipient_username: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-gray-100 font-mono text-sm" placeholder="@handle" />
                </div>
                <div>
                  <Label className="text-gray-400 text-sm mb-1.5 block">Recipient email</Label>
                  <Input type="email" value={editForm.recipient_email}
                    onChange={(e) => setEditForm((f) => ({ ...f, recipient_email: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-gray-100 font-mono text-sm" placeholder="user@example.com" />
                </div>
              </div>
              <div>
                <Label className="text-gray-400 text-sm mb-1.5 block">Recipient privy ID</Label>
                <Input value={editForm.recipient_user_id}
                  onChange={(e) => setEditForm((f) => ({ ...f, recipient_user_id: e.target.value }))}
                  className="bg-gray-800 border-gray-600 text-gray-100 font-mono text-sm" placeholder="did:privy:…" />
              </div>
              <div>
                <Label className="text-gray-400 text-sm mb-1.5 block">Recipient address (Solana)</Label>
                <Input value={editForm.recipient_address}
                  onChange={(e) => setEditForm((f) => ({ ...f, recipient_address: e.target.value }))}
                  className="bg-gray-800 border-gray-600 text-gray-100 font-mono text-sm" placeholder="Solana wallet address" />
              </div>
            </div>

            {/* ── Blockchain ── */}
            <div className="space-y-3">
              <p className="text-[10px] uppercase tracking-widest text-gray-600">Blockchain</p>
              <div>
                <Label className="text-gray-400 text-sm mb-1.5 block">Burner address</Label>
                <Input value={editForm.burner_address}
                  onChange={(e) => setEditForm((f) => ({ ...f, burner_address: e.target.value }))}
                  className="bg-gray-800 border-gray-600 text-gray-100 font-mono text-sm" placeholder="Escrow wallet" />
              </div>
              <div>
                <Label className="text-gray-400 text-sm mb-1.5 block">Sender TX hash</Label>
                <Input value={editForm.sender_tx_hash}
                  onChange={(e) => setEditForm((f) => ({ ...f, sender_tx_hash: e.target.value }))}
                  className="bg-gray-800 border-gray-600 text-gray-100 font-mono text-sm" />
              </div>
              <div>
                <Label className="text-gray-400 text-sm mb-1.5 block">Sweep TX hash</Label>
                <Input value={editForm.sweep_tx_hash}
                  onChange={(e) => setEditForm((f) => ({ ...f, sweep_tx_hash: e.target.value }))}
                  className="bg-gray-800 border-gray-600 text-gray-100 font-mono text-sm" />
              </div>
            </div>

            {/* ── Notes ── */}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-3">Notes</p>
              <Label className="text-gray-400 text-sm mb-1.5 block">Description</Label>
              <Textarea value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                className="bg-gray-800 border-gray-600 text-gray-100 font-mono text-sm"
                rows={2} placeholder="Optional message" />
            </div>

          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}
              className="border-gray-600 text-gray-300 hover:bg-gray-800">
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving} className="bg-blue-700 hover:bg-blue-600 text-white">
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
