"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { payrollApi } from "@/services/api/payroll";
import { Button } from "@/components/ui/button";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import {
  Building2,
  Users,
  Send,
  FileText,
  History,
  LogOut,
  Handshake,
  UserCircle,
  Building,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";

/** Payroll area layout: no main site header, minimal nav, subdomain-ready */
export default function PayrollLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { authenticated, userId, email, login, logout, ready } = useAuth();

  const displayLabel = email
    ? (email.length > 24 ? `${email.slice(0, 21)}...` : email)
    : (userId ? `${String(userId).slice(0, 2).toUpperCase()}` : "?");

  const orgId = pathname?.match(/^\/payroll\/([a-f0-9-]{36})(?:\/|$)/)?.[1];
  const isOrgPage = Boolean(orgId);
  const basePath = orgId ? `/payroll/${orgId}` : "/payroll";
  const [orgRole, setOrgRole] = useState<"owner" | "admin" | "member" | "contributor" | null>(null);

  useEffect(() => {
    if (!orgId || !userId) {
      setOrgRole(null);
      return;
    }
    payrollApi.organizations
      .getMyRole(orgId, userId)
      .then((r) => setOrgRole(r.role))
      .catch(() => setOrgRole(null));
  }, [orgId, userId]);

  // Contributors cannot access the Team page (org root); redirect to Deals
  useEffect(() => {
    if (orgId && orgRole === "contributor" && pathname === `/payroll/${orgId}`) {
      router.replace(`/payroll/${orgId}/deals`);
    }
  }, [orgId, orgRole, pathname, router]);

  const isContributor = orgRole === "contributor";
  const navItems = isOrgPage
    ? isContributor
      ? [
        { href: `${basePath}/deals`, label: "Deals", icon: Handshake },
        { href: "/payroll/my-invoices", label: "Invoices", icon: FileText },
        { href: `${basePath}/history`, label: "History", icon: History },
        { href: `${basePath}/your-profile`, label: "Your Profile", icon: UserCircle },
      ]
      : [
        { href: basePath, label: "Team", icon: Users },
        { href: `${basePath}/deals`, label: "Deals", icon: Handshake },
        { href: `${basePath}/pay`, label: "Pay", icon: Send },
        { href: `${basePath}/invoices`, label: "Invoices", icon: FileText },
        { href: `${basePath}/history`, label: "History", icon: History },
        { href: `${basePath}/your-org`, label: "Your org", icon: Building },
      ]
    : [];

  return (
    <div
      className="min-h-screen bg-[#fafbfc] font-sans"
      data-payroll-area
      data-subdomain-ready
    >
      {/* Minimal top bar — no main header */}
      <header className="sticky top-0 z-50 border-b border-gray-200/80 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-8">
            <Link
              href="/payroll"
              className="flex items-center gap-2 text-gray-900 no-underline"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0f172a]">
                <Building2 className="h-4 w-4 text-white" />
              </div>
              <span className="text-lg font-semibold tracking-tight">
                Payroll
              </span>
            </Link>

            {isOrgPage && (
              <nav className="hidden items-center gap-1 md:flex">
                {navItems.map(({ href, label, icon: Icon }) => {
                  const active = pathname === href || (href !== basePath && pathname?.startsWith(href));
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors
                        ${active ? "bg-gray-100 text-gray-900" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}
                      `}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </Link>
                  );
                })}
              </nav>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Home
            </Link>
            {ready && !authenticated && (
              <GradientActionButton onClick={() => login()} className="w-auto shrink-0 px-4 h-9 text-sm">
                Log in
              </GradientActionButton>
            )}
            {ready && authenticated && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="rounded-full gap-2 px-2 py-1.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-semibold">
                      {email ? email.slice(0, 1).toUpperCase() : userId?.slice(0, 1).toUpperCase() ?? "?"}
                    </div>
                    <span className="max-w-[140px] truncate text-sm text-gray-700">
                      {displayLabel}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem asChild>
                    <Link href="/payroll">Organizations</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/payroll/my-invoices">My invoices</Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => logout()} className="text-gray-600">
                    <LogOut className="mr-2 h-4 w-4" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Mobile: show nav as horizontal scroll */}
        {isOrgPage && (
          <div className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
            {navItems.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href !== basePath && pathname?.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium
                    ${active ? "bg-gray-100 text-gray-900" : "text-gray-600"}
                  `}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </Link>
              );
            })}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
