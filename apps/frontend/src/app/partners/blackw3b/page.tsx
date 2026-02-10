"use client";

import Link from "next/link";
import { ArrowLeft, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

const BLKW3B_ORG_ID = "BLKW3B";

export default function BlackW3BPartnerPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-12 md:py-20">
        <Link
          href="/partners"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Partners
        </Link>

        <div className="flex items-center gap-3 mb-8">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(to right, rgba(255,15,0,0.1), rgba(234,179,8,0.1))" }}
          >
            <Zap className="w-6 h-6 text-orange-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl md:text-3xl font-semibold text-slate-900">BlackW3B</h1>
            <p className="text-slate-600">Gold For Everyone.</p>
            <p className="mt-1 text-sm text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
              <a
                href="https://www.w3bs.fun/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-600 hover:text-orange-700 font-medium underline"
              >
                w3bs.fun
              </a>
              <a
                href="https://x.com/blkw3_b"
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-600 hover:text-orange-700 font-medium underline"
              >
                X @blkw3_b
              </a>
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 md:p-8 shadow-sm space-y-6">
          <p className="text-slate-700 text-lg leading-relaxed">
            Gold Backed Directly In Your Pocket.
          </p>
          <p className="text-slate-600 leading-relaxed">
            In the heart of blockchain innovation, we&apos;re building tomorrow&apos;s digital gold standard today.
          </p>
          <p className="text-slate-600 text-sm">
            Pay with any supported token and network via Loofta Pay. Funds go to BlackW3B.
          </p>
          <Link href={`/checkout?organizationId=${BLKW3B_ORG_ID}`} className="block">
            <Button
              className="w-full"
              style={{ background: "linear-gradient(to right, #FF0F00, #EAB308)", color: "#fff" }}
            >
              Pay with Loofta
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
