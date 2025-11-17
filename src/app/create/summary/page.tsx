"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Summary from '@/components/stepper/Summary/Summary';
import PrimaryBtn from '@/components/PrimaryBtn';
import SecondaryBtn from '@/components/SecondaryBtn';
import LoadingScreen from '@/components/LoadingScreen';
import { notifyDealCreated, notifyDealReceived } from '@/services/notificationService';
import { deleteDeal, createDeal } from '@/app/actions/deals/deals';
import { toast } from '@/components/ui/use-toast';
import { Freelancer } from '@/app/utils/interfaces';
import { v4 as uuidv4 } from 'uuid';
import { CONGRATS_ROUTE, CREATE_DEAL_NEW_ROUTE, CREATE_DEAL_ROUTE, DEALS_ROUTE } from '@/app/utils/routes';

export default function Step3() {
  const router = useRouter();

  const [formData, setFormData] = useState<{
    description: string;
    amount: string;
    freelancer: Freelancer | null;
    walletAddress: string;
    expectedDeliveryDate: Date | undefined;
    generatedId?: string;
    senderTgId?: number;
    senderTgUsername?: string;
  }>({
    description: '',
    amount: '',
    walletAddress: '',
    freelancer: null,
    expectedDeliveryDate: undefined,
    generatedId: '',
    senderTgId: 0,
    senderTgUsername: '',
  });

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const savedFormData = localStorage.getItem('dealFormData') || window.Telegram?.WebApp?.storage?.getItem('dealFormData');
    if (savedFormData) {
      try {
        const parsedData = JSON.parse(savedFormData);

        if (!parsedData.senderTgId) {
          throw new Error("Missing required user data.");
        }

        setFormData({
          ...parsedData,
          expectedDeliveryDate: new Date(parsedData.expectedDeliveryDate), // Convert date back to Date object
        });
      } catch (error) {
        toast({
          title: 'Failed to load deal data',
          description: 'Please go back and try again.',
          variant: 'destructive',
        });
        router.push(CREATE_DEAL_NEW_ROUTE);
      }
    } else {
      router.push(CREATE_DEAL_NEW_ROUTE);
    }
  }, [router]);

  const handleCancel = async () => {

    toast({
      title: 'Deal cancelled successfully',
    });
    router.push(DEALS_ROUTE);
  };

  const handlePayLater = async () => {
    if (!formData.senderTgId) {
      toast({
        title: 'Deal data is missing',
        description: 'Please go back and try again.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    const generatedId = uuidv4();
    await createDeal({
      id: generatedId,
      walletAddress: formData.walletAddress,
      description: formData.description,
      amount: parseFloat(formData.amount),
      paymentStatus: 'unpaid',
      expectedDeliveryDate: formData.expectedDeliveryDate?.toISOString() || '',
      recipientWalletAddress: formData.walletAddress,
      recipientId: formData.freelancer?.id || '',
      recipientTgId: formData.freelancer?.telegramId || null,
      recipientTgUsername: formData.freelancer?.telegramHandle || '',
      senderTgId: formData.senderTgId,
      senderTgUsername: formData.senderTgUsername || '',
    });

    await notifyDealCreated(generatedId, formData.senderTgId);
    await notifyDealReceived(generatedId, formData.freelancer?.telegramId);

    router.push(CONGRATS_ROUTE + `?dealId=${generatedId}&amount=${formData.amount}`);

    toast({
      title: 'Deal created successfully',
    });
  };

  return (
    <div className='tg-webview h-screen'>
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto space-y-4 mt-0 mx-4">
          <Summary
            dealId={formData.generatedId || ''}
            description={formData.description}
            recipient={formData.freelancer}
            recipientWalletAddress={formData.walletAddress}
            amount={formData.amount}
            delivery={formData.expectedDeliveryDate ? formData.expectedDeliveryDate.toDateString() : ''}
            onPayLater={handlePayLater}
          />
        </div>
        <div className="w-full bg-white p-2 pb-1">
          <SecondaryBtn text="Cancel Request" onClick={handleCancel} disabled={loading} />
          <PrimaryBtn
            onClick={handlePayLater}
            text={loading ? "Sending..." : "Send Deal Request"}
            disabled={loading}
          />
        </div>
      </div>
    </div>
  );
}
