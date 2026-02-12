"use client";

import { useParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Loader2, ArrowLeft } from "lucide-react";
import Link from "next/link";

/** Invoices: create/update invoices. Placeholder until wired. */
export default function PayrollInvoicesPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const { authenticated, ready } = useAuth();

  if (!ready || !authenticated) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/payroll/${orgId}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Invoices</h1>
          <p className="text-sm text-gray-500">
            Create and manage invoices. Updates and status tracking coming next.
          </p>
        </div>
      </div>

      <Card className="border-gray-200 bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Invoices
          </CardTitle>
          <CardDescription>
            Encrypted invoice data; proof of payment via ZK when available.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button disabled className="opacity-70">
            New invoice (coming soon)
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
