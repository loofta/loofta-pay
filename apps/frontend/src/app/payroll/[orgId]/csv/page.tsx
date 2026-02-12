"use client";

import { useParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, Loader2, ArrowLeft, FileSpreadsheet } from "lucide-react";
import Link from "next/link";

/** Import CSV: wallet, network, token, amount for multi-send. Placeholder until wired. */
export default function PayrollCsvPage() {
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
          <h1 className="text-2xl font-semibold text-gray-900">Import CSV</h1>
          <p className="text-sm text-gray-500">
            Upload a CSV with wallet address, network, token, amount for multi-send.
          </p>
        </div>
      </div>

      <Card className="border-gray-200 bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            CSV format
          </CardTitle>
          <CardDescription>
            Columns: wallet_address, network, token, amount. One row per recipient.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50 py-12">
            <Upload className="mb-3 h-10 w-10 text-gray-400" />
            <p className="text-sm font-medium text-gray-600">Drop your CSV here or click to upload</p>
            <p className="mt-1 text-xs text-gray-500">Coming in next step</p>
            <Button disabled className="mt-4 opacity-70">
              Select file (coming soon)
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
