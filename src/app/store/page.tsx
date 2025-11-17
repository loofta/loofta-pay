'use client';

import { useState, useEffect } from 'react';
import { Users, Rocket, Lock, Star, Clock, Check } from 'lucide-react';
import Title from '@/components/Title';
import { Card } from '@/components/ui/card';
import PrimaryBtn from '@/components/PrimaryBtn';
import SecondaryBtn from '@/components/SecondaryBtn';
import MobilePillMenu from '@/components/BottomMenu';
import { useUser } from '@/hooks/useUser';
import { POINTS_FOLLOW_COST, POINTS_PAYMENT_MIN_AMOUNT, USDT_FOLLOW_COST } from '@/lib/utils';
import { useToast } from "@/components/ui/use-toast";
import useSendPayment from "@/hooks/useSendPayment";
import { v4 as uuidv4 } from 'uuid';
import useCampaigns from '@/hooks/useCreatorCampaign';
import { CreatorCampaign } from '@/app/utils/interfaces';

interface StoreItem {
  id: string;
  title: string;
  description: string;
  icon: any;
  price: { points: number; usdt: number };
  isComingSoon?: boolean;
}

const storeItems: StoreItem[] = [
  {
    id: 'followers',
    title: 'Get Followers',
    description: 'Get followed by our community members',
    icon: Users,
    price: { points: POINTS_FOLLOW_COST, usdt: USDT_FOLLOW_COST },
    isComingSoon: true
  },
  {
    id: 'academy',
    title: 'Creator Academy',
    description: 'Join Loofta Creator Academy for mentorship on viral content creation',
    icon: Star,
    price: { points: 1000, usdt: 50 },
    isComingSoon: true
  },
  {
    id: 'boost',
    title: 'Boost Post',
    description: 'Increase visibility of your content',
    icon: Rocket,
    price: { points: 300, usdt: 15 },
    isComingSoon: true
  }
];

const isItemAvailable = (item: StoreItem, activeCampaign: CreatorCampaign | null) => {
  if (!activeCampaign) return true;
  if (activeCampaign.itemId !== item.id) return true;

  // If campaign is pending, processing, or completed, check the 1-month cooldown
  if (activeCampaign.status === 'pending' ||
    activeCampaign.status === 'processing' ||
    activeCampaign.status === 'completed') {
    const purchaseDate = new Date(activeCampaign.createdAt || '');
    const oneMonthLater = new Date(purchaseDate.setMonth(purchaseDate.getMonth() + 1));
    const now = new Date();
    return now > oneMonthLater;
  }

  return true;
};

const getCampaignStatusDisplay = (status?: string) => {
  switch (status) {
    case 'pending':
      return {
        text: 'Campaign pending approval',
        color: 'text-amber-600',
        icon: Clock
      };
    case 'processing':
      return {
        text: 'Campaign in progress',
        color: 'text-blue-600',
        icon: Clock
      };
    case 'completed':
      return {
        text: 'Campaign completed',
        color: 'text-green-600',
        icon: Check
      };
    default:
      return {
        text: 'Campaign status unknown',
        color: 'text-gray-600',
        icon: Clock
      };
  }
};

export default function Store() {
  const [selectedItem, setSelectedItem] = useState<StoreItem | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const { points, spendPoints } = useUser();
  const { toast } = useToast();
  const { sendStorePayment } = useSendPayment();
  const [isLoading, setIsLoading] = useState(false);
  const { activeCampaign, isLoading: campaignLoading, startNewCampaign } = useCampaigns();

  const handleItemClick = (item: StoreItem) => {
    if (!item.isComingSoon) {
      setSelectedItem(item);
      setShowPaymentModal(true);
    }
  };

  const handlePointsPayment = async () => {
    if (!selectedItem) return;

    try {
      setIsLoading(true);
      await spendPoints(selectedItem.price.points);

      const result = await startNewCampaign(
        selectedItem.id,
        'points',
        selectedItem.price.points
      );
      if (!result.success) {
        throw new Error(result.error || 'Failed to start campaign');
      }

      // Update points cache
      const newPoints = points - selectedItem.price.points;
      const cachedStats = localStorage.getItem('creatorDashboardStats');
      if (cachedStats) {
        const stats = JSON.parse(cachedStats);
        stats.totalPoints = newPoints;
        localStorage.setItem('creatorDashboardStats', JSON.stringify(stats));
      }

      toast({
        title: "Campaign Started!",
        description: "Your campaign has been initiated and will be processed soon.",
      });

      setShowPaymentModal(false);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to process payment. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleUsdtPayment = async () => {
    if (!selectedItem) return;

    try {
      setIsLoading(true);
      const txBoc = await sendStorePayment(selectedItem.price.usdt);

      if (txBoc) {
        const result = await startNewCampaign(
          selectedItem.id,
          'usdt',
          selectedItem.price.usdt
        );
        if (!result.success) {
          throw new Error(result.error || 'Failed to start campaign');
        }

        toast({
          title: "Payment Successful!",
          description: "Your purchase has been processed.",
        });
        setShowPaymentModal(false);
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to process USDT payment. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      <div className="flex-1 p-4 pb-[72px]">
        <div className="flex items-center justify-between">
          <Title text="Store" showWallet={false} />
          <div className="flex items-center gap-2 bg-blue-50 px-3 py-1.5 rounded-lg">
            <Star className="w-4 h-4 text-blue-500" />
            <span className="font-medium text-blue-700">{points ? points + ' points' : 'Loading...'} </span>
          </div>
        </div>

        <div className="mt-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4 border border-blue-100">
          <h2 className="font-semibold text-gray-800 mb-2">
            Grow with Loofta's Creator Network
          </h2>
          <p className="text-sm text-gray-600 mb-3">
            Unlock opportunities in Web3 by expanding your reach. Our store is designed for active Loofta contributors to grow their presence organically through our creator network.
          </p>
          <div className="bg-white/80 rounded-lg p-3 space-y-2 text-sm">
            <p className="font-medium text-gray-700">Requirements:</p>
            <ul className="space-y-1 text-gray-600">
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                Minimum {POINTS_PAYMENT_MIN_AMOUNT} points required to use USDT payments
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                {POINTS_FOLLOW_COST} points needed for points-based purchases
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                Points earned through active participation
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-6 grid gap-4">
          {storeItems.map((item) => {
            const isActiveCampaign = activeCampaign?.itemId === item.id;
            const available = isItemAvailable(item, activeCampaign);
            const cooldownEnds = activeCampaign?.createdAt ?
              new Date(new Date(activeCampaign.createdAt).setMonth(new Date(activeCampaign.createdAt).getMonth() + 1)) :
              null;

            return (
              <Card
                key={item.id}
                className={`p-4 cursor-pointer transition ${item.isComingSoon || !available ? 'opacity-50' :
                  isActiveCampaign ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                onClick={() => available && !isActiveCampaign && handleItemClick(item)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                    <item.icon className="w-6 h-6 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-semibold">{item.title}</h2>
                      {item.isComingSoon && (
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                          Coming Soon
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">{item.description}</p>
                  </div>
                </div>
                {!available && cooldownEnds && (
                  <div className="mt-3 text-sm">
                    <div className="flex items-center gap-2 text-amber-600">
                      <Clock className="w-4 h-4" />
                      <span>Available again on {cooldownEnds.toLocaleDateString()}</span>
                    </div>
                  </div>
                )}
                {isActiveCampaign && (
                  <div className="mt-3 text-sm">
                    {(() => {
                      const status = getCampaignStatusDisplay(activeCampaign?.status);
                      return (
                        <div className="flex items-center gap-2 mb-1">
                          <div className={`flex items-center gap-2 ${status.color}`}>
                            <status.icon className="w-4 h-4" />
                            <span>{status.text}</span>
                          </div>
                        </div>
                      );
                    })()}
                    <p className="text-gray-500 mt-1">
                      Started on {activeCampaign?.createdAt ? new Date(activeCampaign.createdAt).toLocaleDateString() : ''}
                    </p>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      <MobilePillMenu />

      {/* Payment Modal */}
      {showPaymentModal && selectedItem && (
        <>
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[50]"
            onClick={() => setShowPaymentModal(false)}
          />
          <div className="fixed bottom-0 left-0 right-0 z-[51] p-6 bg-white rounded-t-2xl shadow-xl animate-slide-up">
            <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mb-6" />

            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold mb-2">{selectedItem.title}</h2>
                <p className="text-gray-600">{selectedItem.description}</p>
              </div>

              <div className="space-y-3">
                <PrimaryBtn
                  text={`Pay with Points (${selectedItem.price.points})`}
                  customProperties={`w-full justify-center ${points < POINTS_FOLLOW_COST ? 'opacity-50' : ''}`}
                  onClick={handlePointsPayment}
                  disabled={points < POINTS_FOLLOW_COST || isLoading}
                />
                {points < POINTS_FOLLOW_COST && (
                  <p className="text-xs text-amber-600">
                    You need {POINTS_FOLLOW_COST - points} points to use points payment
                  </p>
                )}
                <PrimaryBtn
                  text={`Pay with USDT (${selectedItem.price.usdt})`}
                  customProperties={`w-full justify-center ${points < POINTS_PAYMENT_MIN_AMOUNT ? 'opacity-50' : ''}`}
                  onClick={handleUsdtPayment}
                  disabled={points < POINTS_PAYMENT_MIN_AMOUNT || isLoading}
                />
                {points < POINTS_PAYMENT_MIN_AMOUNT && (
                  <p className="text-xs text-amber-600">
                    Minimum {POINTS_PAYMENT_MIN_AMOUNT} points required to use USDT payment
                  </p>
                )}
                <SecondaryBtn
                  text="Cancel"
                  customProperties="w-full justify-center"
                  onClick={() => setShowPaymentModal(false)}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
} 