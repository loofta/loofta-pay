"use client";

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation'; // Use to extract URL params
import Title from "@/components/Title";
import { ClipboardCopy } from "lucide-react";
import { useRouter } from "next/navigation";
import PrimaryBtn from "@/components/PrimaryBtn";
import LinkToDeal from "@/components/stepper/Congrats/LinkToDeal";
import { DEALS_ROUTE } from '@/app/utils/routes';

function CongratsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Extract dealId and amount from URL parameters
  const dealId = searchParams.get('dealId');
  const amount = searchParams.get('amount');

  const handleClose = () => {
    router.push(DEALS_ROUTE);
  };

  if (!dealId || !amount) {
    return (
      <div className="text-center text-red-500">
        Error: Missing deal information.
      </div>
    );
  }

  return (
    <div className='tg-webview h-screen'>
      <div className="flex flex-col h-full">
        <div className="flex-1 h-full overflow-y-auto space-y-4 mt-8 mx-0">
          {/* Title indicating the deal was sent */}
          <Title text="Your Deal Has Been Sent!" showWallet={false} customProperties="mx-4" />

          <div className="flex justify-center pt-24">
            {/* Celebrate with an emoji */}
            <span className="text-8xl">🚀</span>
          </div>

          <div className="text-center mt-8">
            <p className="text-lg font-semibold">We&apos;re waiting for the freelancer&apos;s confirmation.</p>
            <p className="text-md mt-2">You&apos;ll be notified as soon as they accept the deal.</p>
          </div>

          {/* Display the deal link and copy-to-clipboard functionality */}
          <div className="w-full p-4 bg-white mt-8">
            <LinkToDeal isCensored={false} dealId={dealId} />
          </div>

          {/* Display some contextual information */}
          <div className="text-center mt-8">
            <p className="text-lg">You sent a deal worth</p>
            <p className="font-bold text-3xl">{amount} USDT</p>
          </div>


        </div>
        <div className="w-full bg-white p-2 pb-1">
          <PrimaryBtn onClick={handleClose} text="Back to Dashboard" />
        </div>
      </div>
    </div>
  );
}

export default function CongratsPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <CongratsContent />
    </Suspense>
  );
}
