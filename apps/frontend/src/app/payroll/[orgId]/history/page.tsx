"use client";

import { useParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { History, Loader2, ArrowLeft } from "lucide-react";
import Link from "next/link";

/** Payment history for this org. Placeholder until wired to payroll runs. */
export default function PayrollHistoryPage() {
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
          <h1 className="text-2xl font-semibold text-gray-900">Payment history</h1>
          <p className="text-sm text-gray-500">
            All payments made from this organization. Spending by category coming next.
          </p>
        </div>
      </div>

      <Card className="border-gray-200 bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Payments
          </CardTitle>
          <CardDescription>
            Runs and per-recipient status will appear here after we wire payroll runs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-gray-200 bg-gray-50/50 py-8 text-center text-sm text-gray-500">
            No payments yet. Run a payroll or import a CSV to see history here.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
