'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import NewDeal from '@/components/stepper/CreateADeal/NewDeal';
import PrimaryBtn from '@/components/PrimaryBtn';
import LoadingScreen from '@/components/LoadingScreen';
import { toast } from '@/components/ui/use-toast';
import { useWallet } from '@/hooks/useWallet';
import { useTonAddress } from '@tonconnect/ui-react';
import { Freelancer } from '@/app/utils/interfaces';
import { useFreelancers } from '@/hooks/useFreelancers';
import { useTelegramUser } from '@/context/TelegramUserContext';
import { getFreelancerById } from '@/app/actions/freelancers/freelancers';
import { DEAL_SUMMARY_ROUTE } from '@/app/utils/routes';

function NewDealContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isWalletConnected, isLoading } = useWallet();
  const userFriendlyAddress = useTonAddress();

  const freelancerIdFromURL = searchParams.get('freelancerId');
  const { userData } = useTelegramUser();

  const [formData, setFormData] = useState<{
    description: string;
    amount: string;
    walletAddress: string;
    freelancerId: string;
    freelancer: Freelancer | null;
    expectedDeliveryDate: Date | undefined;
    valid: boolean;
  }>({
    description: '',
    amount: '',
    walletAddress: '',
    freelancerId: freelancerIdFromURL || '',
    freelancer: null,
    expectedDeliveryDate: undefined,
    valid: false,
  });

  const { freelancers, isLoading: isFreelancersLoading, error } = useFreelancers();
  const [isFreelancerLoading, setIsFreelancerLoading] = useState(false);

  const loadFreelancerById = async (freelancerId: string) => {
    setIsFreelancerLoading(true);
    try {
      const freelancer = await getFreelancerById(freelancerId);
      if (freelancer) {
        setFormData((prevData) => ({
          ...prevData,
          freelancerId: freelancer.id,
          walletAddress: freelancer.walletAddress,
          freelancer: freelancer,
          valid: true,
        }));
      } else {
        toast({ description: 'Creator not found', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Error loading freelancer:', error);
      toast({ description: 'Failed to load creator information', variant: 'destructive' });
    } finally {
      setIsFreelancerLoading(false);
    }
  };

  useEffect(() => {
    if (!isWalletConnected && !isLoading) {
      router.push('/');
    }
  }, [isWalletConnected, isLoading, router]);

  useEffect(() => {
    if (freelancerIdFromURL) {
      loadFreelancerById(freelancerIdFromURL);
    }
  }, [freelancerIdFromURL]);

  const handleConfirm = () => {
    if (!userData) {
      toast({
        description: 'User data is missing. Make sure you are using the app from Telegram.',
        variant: 'destructive',
      });
      return;
    }

    if (formData.description && formData.amount && formData.walletAddress && formData.freelancerId && formData.expectedDeliveryDate) {

      localStorage.setItem('dealFormData', JSON.stringify({
        ...formData,
        expectedDeliveryDate: formData.expectedDeliveryDate.toISOString(), // Save date as ISO string
        senderTgId: userData.id,
        senderTgUsername: userData.username || '',
      }));
      window.Telegram?.WebApp?.storage?.setItem('dealFormData', JSON.stringify({
        ...formData,
        expectedDeliveryDate: formData.expectedDeliveryDate.toISOString(), // Save date as ISO string
        senderTgId: userData.id,
        senderTgUsername: userData.username || '',
      }));

      router.push(DEAL_SUMMARY_ROUTE);
    } else {
      toast({ description: 'Form data is incomplete', variant: 'destructive' });
    }
  };

  if (isLoading || isFreelancersLoading || isFreelancerLoading) {
    return <LoadingScreen text="Loading..." isVisible={true} />;
  }

  if (error) {
    toast({ description: error, variant: 'destructive' });
    return null;
  }

  return (
    <div className='tg-webview h-screen'>
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto space-y-4 mt-0 mx-4">
          <NewDeal
            formData={formData}
            setFormData={setFormData}
            freelancers={freelancers}
          />
        </div>
        <div className="w-full bg-white p-2 pb-1">
          <PrimaryBtn
            onClick={handleConfirm}
            text="Confirm Deal Terms"
            disabled={!formData.valid || !userData}
          />
        </div>
      </div>
    </div>
  );
}

export default function Step2() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <NewDealContent />
    </Suspense>
  );
}
