"use client";

// Self-contained (fetches/holds its own state) — same convention as PacksTab.tsx.

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Loader2, Check, X, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

interface AdminOrganization {
  id: string;
  organization_id: string;
  name: string;
  logo_url: string | null;
  bg_color: string | null;
  checkout_status: "active" | "inactive" | "pending";
  org_referral: string;
  recipient_wallet: string | null;
  token_symbol: string | null;
  token_chain: string | null;
  contact_email: string | null;
  website_url: string | null;
  owner_privy_user_id: string | null;
  created_by: string | null;
  created_at: string;
}

export function OrganizationsTab() {
  const { getAccessToken } = usePrivy();
  const { toast } = useToast();
  const [orgs, setOrgs] = useState<AdminOrganization[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"" | "pending" | "active" | "inactive">("pending");

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken().catch(() => null);
    return token ? { authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const fetchOrgs = useCallback(async (status: string) => {
    setLoading(true);
    try {
      const qs = status ? `?status=${status}` : "";
      const res = await fetch(`/api/admin/organizations${qs}`, { headers: await authHeaders() });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setOrgs(data.organizations ?? []);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to load organizations", description: err.message });
    } finally {
      setLoading(false);
    }
  }, [authHeaders, toast]);

  useEffect(() => { fetchOrgs(statusFilter); }, [statusFilter, fetchOrgs]);

  const updateStatus = useCallback(async (id: string, checkout_status: "active" | "inactive") => {
    setUpdatingId(id);
    try {
      const res = await fetch("/api/admin/organizations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ id, checkout_status }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: checkout_status === "active" ? "Organization approved" : "Organization set inactive" });
      fetchOrgs(statusFilter);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to update", description: err.message });
    } finally {
      setUpdatingId(null);
    }
  }, [authHeaders, toast, fetchOrgs, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Building2 className="w-4 h-4 text-gray-400" />
        <span className="text-base md:text-sm font-medium text-gray-300">Organizations</span>
        <div className="flex gap-1 ml-4">
          {(["pending", "active", "inactive", ""] as const).map((s) => (
            <button
              key={s || "all"}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 text-sm rounded ${statusFilter === s ? "bg-gray-700 text-gray-100" : "bg-gray-900 text-gray-500 hover:text-gray-300"}`}
            >
              {s || "all"}
            </button>
          ))}
        </div>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-500 ml-2" />}
      </div>

      <div className="border border-gray-800 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-gray-500 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Organization ID</th>
              <th className="px-3 py-2 font-medium">Contact</th>
              <th className="px-3 py-2 font-medium">Recipient wallet</th>
              <th className="px-3 py-2 font-medium">Token</th>
              <th className="px-3 py-2 font-medium">Owner</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(orgs ?? []).map((org) => (
              <tr key={org.id} className="border-t border-gray-800 text-gray-300">
                <td className="px-3 py-2">{org.name}</td>
                <td className="px-3 py-2 font-mono text-gray-500">{org.organization_id}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-0.5">
                    {org.contact_email ? (
                      <a href={`mailto:${org.contact_email}`} className="text-blue-400 hover:underline">{org.contact_email}</a>
                    ) : (
                      <span className="text-gray-600">no email</span>
                    )}
                    {org.website_url && (
                      <a href={org.website_url} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-gray-300 hover:underline truncate max-w-[200px]">
                        {org.website_url}
                      </a>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-gray-500">
                  {org.recipient_wallet ? `${org.recipient_wallet.slice(0, 6)}…${org.recipient_wallet.slice(-4)}` : "—"}
                </td>
                <td className="px-3 py-2">{org.token_symbol ?? "—"} / {org.token_chain ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-gray-500">
                  {org.owner_privy_user_id ? "self-serve" : "admin-created"}
                </td>
                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-sm ${
                    org.checkout_status === "active" ? "bg-green-900/50 text-green-400" :
                    org.checkout_status === "pending" ? "bg-yellow-900/50 text-yellow-400" :
                    "bg-gray-800 text-gray-500"
                  }`}>
                    {org.checkout_status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1.5">
                    {org.checkout_status !== "active" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updatingId === org.id}
                        onClick={() => updateStatus(org.id, "active")}
                        className="h-7 px-2 border-green-800 text-green-400 hover:bg-green-950"
                      >
                        {updatingId === org.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      </Button>
                    )}
                    {org.checkout_status !== "inactive" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updatingId === org.id}
                        onClick={() => updateStatus(org.id, "inactive")}
                        className="h-7 px-2 border-red-900 text-red-400 hover:bg-red-950"
                      >
                        {updatingId === org.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {orgs && orgs.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-gray-600">No organizations{statusFilter ? ` (${statusFilter})` : ""}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
