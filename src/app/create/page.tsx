'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { useWallet } from '@/hooks/useWallet';
import LoadingScreen from '@/components/LoadingScreen';
import HowWorks from '@/components/stepper/HowWorks';
import PrimaryBtn from '@/components/PrimaryBtn';
import { useTelegramUser } from '@/context/TelegramUserContext'; // Import the useTelegramUser hook
import { toast } from '@/components/ui/use-toast'; // Import toast for notifications

function CreatePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams(); // Hook to access URL params
  const { isWalletConnected, isLoading } = useWallet();
  const { userData } = useTelegramUser(); // Get userData from the context

  // Extract freelancerId from the URL if it exists
  const freelancerId = searchParams.get('freelancerId');

  // Keep wallet checking behavior without redirecting to a wallet connection page
  useEffect(() => {
    if (!isWalletConnected && !isLoading) {
      router.push('/');
    }
  }, [isWalletConnected, isLoading, router]);

  const handleNext = () => {
    // Check if user data is available
    if (!userData) {
      toast({
        description: 'User data is missing. Make sure you are using the app from Telegram!',
        variant: 'destructive',
      });
      return;
    }

    // Pass freelancerId to the next page if it's available
    const nextUrl = freelancerId ? `/create/newDeal?freelancerId=${freelancerId}` : '/create/newDeal';
    router.push(nextUrl);
  };

  if (isLoading) {
    return <LoadingScreen text="Checking wallet connection..." isVisible={true} />;
  }

  return (
    <div className='tg-webview h-screen'>
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto space-y-4 mt-0 mx-4">
          <HowWorks />
        </div>
        <div className="w-full bg-white p-2 pb-1">
          <PrimaryBtn onClick={handleNext} text="Got it!" />
        </div>
      </div>
    </div>
  );
}

export default function Step1() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <CreatePageContent />
    </Suspense>
  );
}
