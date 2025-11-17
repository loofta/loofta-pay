'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { ArrowRight } from 'lucide-react';
import Image from 'next/image';
import { RetroGrid } from "@/components/ui/retro-grid";

export default function LoginPage() {
  const router = useRouter();
  const { login, authenticated, ready } = usePrivy();

  useEffect(() => {
    if (authenticated && ready) {
      router.push('/');
    }
  }, [authenticated, ready, router]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 relative min-h-screen">
      <RetroGrid className="opacity-30" />
      <div className="w-full max-w-lg mx-auto space-y-8 relative">
        <div className="text-center space-y-4">
          <Image
            src="/loofta.svg"
            alt="Loofta"
            width={140}
            height={50}
            className="mx-auto mb-8"
            style={{ filter: 'brightness(0.95) contrast(1.1)' }}
          />
          <h1 className="text-3xl font-semibold">Welcome to Loofta</h1>
          <p className="text-gray-600 text-lg">
            Sign in to start exploring Web3 marketing tools
          </p>
        </div>

        <div className="bg-white rounded-2xl p-8 shadow-sm border">
          <Button
            className="w-full py-6 text-base font-medium"
            onClick={() => login()}
          >
            Continue with Email
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}


