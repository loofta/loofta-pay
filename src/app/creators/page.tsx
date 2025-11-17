'use client';
import { useRouter } from 'next/navigation';
import PrimaryBtn from "@/components/PrimaryBtn";
import WebApp from '@twa-dev/sdk';
import { useWallet } from '@/hooks/useWallet';
import InvalidAccess from '@/components/InvalidAccess';
import LoadingScreen from '@/components/LoadingScreen';
import MobilePillMenu from '@/components/BottomMenu';
import { useEffect, useState, useCallback, useMemo } from 'react';
import Title from '@/components/Title';
import Subtitle from '@/components/Subtitle';
import { getAllFreelancers } from '@/app/actions/freelancers/freelancers';
import { Freelancer } from '../utils/interfaces';
import { Input } from '@/components/ui/input';
import { SearchIcon } from 'lucide-react';
import { FREELANCER_DETAILS_ROUTE } from '../utils/routes';
import { CheckCircle } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { isUserAllowed } from '@/config/access';
import { useUnlockCreators } from "@/hooks/useUnlockCreators";
import { UnlockModal } from '@/components/UnlockModal';
import { useFreelancers } from '@/hooks/useFreelancers';
import { useFreelancersCount } from '@/hooks/useFreelancersCount';
import { useFreelancersPagination } from '@/hooks/useFreelancersPagination';
import { UNLOCK_CREATORS_ACCESS_AMOUNT } from '@/lib/utils';
import DashboardLayout from '@/components/layouts/DashboardLayout';
import { usePrivy } from '@privy-io/react-auth';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Wallet, CreditCard, Copy, Check } from "lucide-react";
import { PAYMENT_ADDRESSES } from '@/lib/constants';
import { grantCreatorAccess } from '@/app/actions/creators/creators';
import PaymentMethod from '@/components/PaymentMethod';
import { Button } from '@/components/ui/button';

export default function FreelancerListPage() {
  if (typeof window !== "undefined") {
    WebApp.expand();
  }
  const router = useRouter();
  const { user } = usePrivy();
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showUnlock, setShowUnlock] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isAllowedUser, setIsAllowedUser] = useState<boolean>(false);
  const [accessChecked, setAccessChecked] = useState(false);
  const { handleUnlock, showConfirmModal, setShowConfirmModal, handleConfirmPayment } = useUnlockCreators();
  const { count } = useFreelancersCount();
  const { paginatedFreelancers, isLoading: isPaginationLoading } = useFreelancersPagination(isAllowedUser);
  const [selectedNetwork, setSelectedNetwork] = useState<'taraxa' | 'eth'>('taraxa');
  const [showNetworkModal, setShowNetworkModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedToken, setSelectedToken] = useState<'USDT'>('USDT');
  const [paymentHash, setPaymentHash] = useState<string>('');
  const [showManualPayment, setShowManualPayment] = useState(false);
  const [telegramHandle, setTelegramHandle] = useState<string>('');
  const [isProcessingManualPayment, setIsProcessingManualPayment] = useState<boolean>(false);

  useEffect(() => {
    if (!isPaginationLoading) {
      setIsLoading(false);
    }
  }, [isPaginationLoading]);

  // Single access check
  useEffect(() => {
    const checkAccess = async () => {
      if (!accessChecked && user?.id) {
        const allowed = await isUserAllowed(user.id);
        setIsAllowedUser(allowed);
        setAccessChecked(true);
      }
    };

    checkAccess();
  }, [user?.id, accessChecked]);

  // Show unlock message after 3 seconds
  useEffect(() => {
    // Only show unlock message for non-allowed users
    if (!isAllowedUser) {
      const timer = setTimeout(() => {
        setShowUnlock(true);
      }, 2000);

      const handleScroll = (e: any) => {
        if (e.target.scrollTop > 300) {
          setShowUnlock(true);
        }
      };

      const scrollContainer = document.querySelector('.scroll-container');
      if (scrollContainer) {
        scrollContainer.addEventListener('scroll', handleScroll);
      }

      return () => {
        clearTimeout(timer);
        if (scrollContainer) {
          scrollContainer.removeEventListener('scroll', handleScroll);
        }
      };
    }
  }, [isAllowedUser]);

  const handleCardClick = (id: string): void => {
    router.push(FREELANCER_DETAILS_ROUTE(id));
  };

  // Memoize the filter and sort function
  const filterAndSortFreelancers = useCallback((freelancers: Freelancer[]) => {
    const query = searchQuery.toLowerCase();
    return freelancers.filter((freelancer) => (
      freelancer.fullName.toLowerCase().includes(query) ||
      freelancer.jobTitle.toLowerCase().includes(query) ||
      freelancer.services.toLowerCase().includes(query)
    ));
  }, [searchQuery]);

  // Memoize the filtered results
  const filteredFreelancers = useMemo(() =>
    filterAndSortFreelancers(paginatedFreelancers || []),
    [filterAndSortFreelancers, paginatedFreelancers]
  );

  const handleNetworkSelect = (network: 'taraxa' | 'eth', token: 'USDT') => {
    setSelectedNetwork(network);
    setSelectedToken(token);
    setShowNetworkModal(false);
    setShowPaymentModal(true);
  };

  const handleManualPayment = async () => {
    if (!telegramHandle || !user?.id) return;

    setIsProcessingManualPayment(true);
    try {
      // Create manual payment record with pending status
      const result = await grantCreatorAccess({
        privyId: user.id,
        userId: user.id,
        network: 'taraxa',
        amount: UNLOCK_CREATORS_ACCESS_AMOUNT,
        currency: 'USDT',
        timestamp: Date.now(),
        transactionHash: 'manual_payment_pending',
        telegramHandle: telegramHandle
      });

      if (result.success) {
        setShowPaymentModal(false);
        setTelegramHandle('');
        toast({
          title: "Payment Details Sent!",
          description: "We've sent payment details to your Telegram. Please complete the payment to activate your access.",
        });
      } else {
        throw new Error(result.error || 'Failed to process manual payment');
      }
    } catch (error) {
      console.error('Manual payment error:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to process manual payment",
        variant: "destructive",
      });
    } finally {
      setIsProcessingManualPayment(false);
    }
  };

  // Optimize blur rendering
  const renderFreelancer = (freelancer: Freelancer, index: number) => {
    if (isAllowedUser) {
      return (
        <FreelancerCard
          key={freelancer.id}
          freelancer={freelancer}
          onCardClick={handleCardClick}
        />
      );
    }

    return (
      <div key={freelancer.id}
        className="relative"
        style={{
          filter: 'blur(4px)',
          transform: 'translate3d(0, 0, 0)', // Force GPU acceleration
          willChange: 'filter' // Hint to browser about animation
        }}>
        <FreelancerCard
          freelancer={freelancer}
          onCardClick={() => { }}
        />
      </div>
    );
  };

  if (isPaginationLoading) {
    return <LoadingScreen text="Loading..." isVisible={true} />;
  }

  return (
    <DashboardLayout>
      <div className='h-screen tg-webview flex flex-col relative'>
        <div className='flex-1 overflow-y-auto p-4'>
          <div className="mb-6">
            <Title text="Browse Creators" showWallet={false} showPrevious={true} />
            <Subtitle text="Find the perfect KOL for your project, start a chat, and create a deal!" customProperties="mt-4" />
          </div>

          <div className="max-w-4xl mx-auto">
            {/* Search Input */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold text-gray-900">Search Creators</h3>
                <span className="text-sm text-gray-500">
                  {filteredFreelancers.length} {filteredFreelancers.length === 1 ? 'creator' : 'creators'} found
                </span>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <SearchIcon className="h-5 w-5 text-gray-400" />
                </div>
                <Input
                  placeholder="Search by name, job title, or services..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 text-lg w-full bg-gray-50 border-gray-200 focus:border-orange-500 focus:ring-orange-500"
                  disabled={!isAllowedUser}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    }
                  }}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-0 top-0 h-full px-3 text-gray-500 hover:text-gray-700"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Freelancer list section */}
            <div className="relative mt-8">
              <div className="grid grid-cols-1 gap-4">
                {filteredFreelancers.map((freelancer, index) =>
                  renderFreelancer(freelancer, index)
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Unlock Section */}
        {!isAllowedUser && showUnlock && count > 0 && (
          <div className="w-full bg-white border-t border-gray-100">
            <div className="max-w-2xl mx-auto p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1">
                  <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-r from-orange-500 via-pink-500 to-purple-500 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/20">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>

                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900">
                      {count} Creators Available
                    </h3>
                    <p className="text-sm text-gray-600 ">1-Year Access</p>
                  </div>

                  <PrimaryBtn
                    text={`Unlock for ${UNLOCK_CREATORS_ACCESS_AMOUNT} USDT`}
                    onClick={() => setShowNetworkModal(true)}
                    customProperties="!w-auto bg-gradient-to-r from-orange-500 via-pink-500 to-purple-500 hover:from-orange-600 hover:via-pink-600 hover:to-purple-600 shadow-lg shadow-orange-500/20 text-sm py-2 font-medium"
                  />
                </div>
              </div>

              <div className="flex items-center text-sm whitespace-nowrap text-gray-600">
                <span className="inline-flex items-center gap-0.5">
                  <span>👑</span>
                  <span className="font-medium">KOLs</span>
                </span>
                <span className="text-gray-300 mx-1">•</span>
                <span className="inline-flex items-center gap-0.5">
                  <span>🎯</span>
                  <span className="font-medium">Creators</span>
                </span>
                <span className="text-gray-300 mx-1">•</span>
                <span className="inline-flex items-center gap-0.5">
                  <span>💎</span>
                  <span className="font-medium">Ambassadors</span>
                </span>
              </div>
              <div className="flex flex-col gap-1.5 text-xs mt-0 pb-4 pt-2 border-b border-gray-100">
                <div className="flex gap-3">
                  <span className="inline-flex items-center gap-1 text-gray-600">
                    <CheckCircle className="w-3 h-3 text-green-500" />
                    Verified
                  </span>
                  <span className="inline-flex items-center gap-1 text-gray-600">
                    <CheckCircle className="w-3 h-3 text-green-500" />
                    Direct Deals
                  </span>
                  <span className="inline-flex items-center gap-1 text-gray-600">
                    <CheckCircle className="w-3 h-3 text-green-500" />
                    Telegram Chat
                  </span>
                  <span className="inline-flex items-center gap-1 text-gray-600">
                    <CheckCircle className="w-3 h-3 text-green-500" />
                    Analytics
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        <UnlockModal
          isOpen={showConfirmModal}
          onClose={() => setShowConfirmModal(false)}
          userData={user}
        />

        {/* Network Selection Modal */}
        <Dialog open={showNetworkModal} onOpenChange={setShowNetworkModal}>
          <DialogContent className="sm:max-w-[425px] fixed animate-in fade-in-0 zoom-in-95 duration-200">
            <DialogHeader>
              <DialogTitle>Select Network</DialogTitle>
              <DialogDescription>
                Choose your preferred network for payment
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <button
                onClick={() => handleNetworkSelect('taraxa', 'USDT')}
                className="flex items-center justify-between p-4 rounded-lg border border-gray-200 hover:border-orange-200 hover:bg-orange-50 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="bg-orange-50 p-2 rounded-lg">
                    <img src="/images/taraxa.png" alt="Taraxa" className="w-6 h-6" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium">Taraxa (USDT)</p>
                    <p className="text-sm text-gray-500">Pay with MetaMask</p>
                  </div>
                </div>
                <div className="text-orange-600">→</div>
              </button>

              <button
                onClick={() => handleNetworkSelect('eth', 'USDT')}
                className="flex items-center justify-between p-4 rounded-lg border border-gray-200 hover:border-orange-200 hover:bg-orange-50 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="bg-orange-50 p-2 rounded-lg">
                    <img src="/images/eth.png" alt="Ethereum" className="w-6 h-6" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium">Ethereum (USDT)</p>
                    <p className="text-sm text-gray-500">Pay with MetaMask</p>
                  </div>
                </div>
                <div className="text-orange-600">→</div>
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Payment Modal */}
        <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
          <DialogContent className="sm:max-w-[425px] fixed animate-in fade-in-0 zoom-in-95 duration-200">
            <DialogHeader>
              <DialogTitle>Payment Details</DialogTitle>
              <DialogDescription>
                Complete your payment to unlock 1-Year Access to {count} Creators
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-600">Amount</span>
                  <span className="font-medium">{UNLOCK_CREATORS_ACCESS_AMOUNT} {selectedToken}</span>
                </div>
              </div>

              {/* Payment Method Toggle */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Payment Method</span>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setShowManualPayment(false)}
                      className={`px-3 py-1 text-xs rounded-md transition-colors ${!showManualPayment
                        ? 'bg-orange-500 text-white'
                        : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                        }`}
                    >
                      Automated
                    </button>
                    <button
                      onClick={() => setShowManualPayment(true)}
                      className={`px-3 py-1 text-xs rounded-md transition-colors ${showManualPayment
                        ? 'bg-orange-500 text-white'
                        : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                        }`}
                    >
                      Manual
                    </button>
                  </div>
                </div>

                {!showManualPayment ? (
                  <PaymentMethod
                    amount={UNLOCK_CREATORS_ACCESS_AMOUNT}
                    currency={selectedToken}
                    onSuccess={(paymentHash, network) => {
                      setPaymentHash(paymentHash);
                      // Update creatorAccess DB
                      grantCreatorAccess({
                        privyId: user?.id || '',
                        userId: user?.id || '',
                        network: network,
                        amount: UNLOCK_CREATORS_ACCESS_AMOUNT,
                        currency: selectedToken,
                        timestamp: Date.now(),
                        transactionHash: paymentHash
                      }).then((accessResult) => {
                        if (accessResult.success) {
                          setIsAllowedUser(true);
                          setShowPaymentModal(false);
                          toast({
                            title: "Success",
                            description: "Access granted successfully! Please wait while we update your access...",
                          });

                          // Give a small delay before refreshing to ensure the toast is seen
                          setTimeout(() => {
                            window.location.reload();
                          }, 1500);
                        } else {
                          toast({
                            title: "Error",
                            description: accessResult.error || "Failed to grant access",
                            variant: "destructive",
                          });
                        }
                      });
                    }}
                    onError={(error) => {
                      toast({
                        title: "Error",
                        description: error,
                        variant: "destructive",
                      });
                    }}
                  />
                ) : (
                  <div className="space-y-4">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <CreditCard className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                        <div className="text-sm text-blue-800">
                          <p className="font-medium mb-1">Manual Payment via Telegram</p>
                          <p>We'll send you payment details via Telegram. Please provide your Telegram handle below.</p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="text-sm font-medium text-gray-700">Telegram Handle</label>
                        <Input
                          placeholder="@your_telegram_handle"
                          value={telegramHandle}
                          onChange={(e) => setTelegramHandle(e.target.value)}
                          className="mt-1"
                        />
                      </div>

                      <Button
                        onClick={handleManualPayment}
                        disabled={!telegramHandle || isProcessingManualPayment}
                        className="w-full bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50"
                      >
                        {isProcessingManualPayment ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                            Processing...
                          </>
                        ) : (
                          "Send Payment Details via Telegram"
                        )}
                      </Button>

                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                        <p className="text-sm text-yellow-800">
                          <strong>Note:</strong> We'll send you the payment details via Telegram. After completing the payment, your access will be activated automatically.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

const FreelancerCard = ({
  freelancer,
  onCardClick
}: {
  freelancer: Freelancer;
  onCardClick: (id: string) => void;
}) => {
  const isPlatinium = freelancer.status === 'platinium';
  const isUnverified = freelancer.status === 'unverified';

  return (
    <div
      onClick={() => onCardClick(freelancer.id)}
      className={`
        relative rounded-lg transition cursor-pointer p-4
        ${isPlatinium
          ? 'bg-gradient-to-r from-orange-50/50 to-white border-2 border-orange-400 shadow-lg hover:shadow-xl'
          : isUnverified
            ? 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
            : 'bg-white border border-gray-200 hover:bg-gray-50'
        }
      `}
    >
      {/* Platinium Badge */}
      {isPlatinium && (
        <div className="absolute -top-3 -right-px bg-orange-600 text-white text-sm px-3 py-1 rounded-full font-medium shadow-md">
          Top Creator
        </div>
      )}

      <div className="flex items-center justify-between">
        {/* Left side: Name and badges */}
        <div className="flex items-center gap-1">
          <span className={`font-semibold text-xl ${isUnverified ? 'text-gray-500' : 'text-gray-900'}`}>
            {freelancer.fullName}
          </span>
          <span className={`w-6 h-6 ${isUnverified ? 'text-gray-300' :
            isPlatinium ? 'text-orange-500' :
              freelancer.status === 'vip' ? 'text-yellow-500' :
                'text-blue-500'
            }`}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path fillRule="evenodd" d="M8.603 3.799A4.49 4.49 0 0112 2.25c1.357 0 2.573.6 3.397 1.549a4.49 4.49 0 013.498 1.307 4.491 4.491 0 011.307 3.497A4.49 4.49 0 0121.75 12a4.49 4.49 0 01-1.549 3.397 4.491 4.491 0 01-1.307 3.497 4.491 4.491 0 01-3.497 1.307A4.49 4.49 0 0112 21.75a4.49 4.49 0 01-3.397-1.549 4.49 4.49 0 01-3.498-1.306 4.491 4.491 0 01-1.307-3.498A4.49 4.49 0 012.25 12c0-1.357.6-2.573 1.549-3.397a4.49 4.49 0 011.307-3.497 4.49 4.49 0 013.497-1.307zm7.007 6.387a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
            </svg>
          </span>
        </div>

        {/* Right side: Followers count */}
        {freelancer.followersCount !== undefined && +freelancer.followersCount !== 0 && (
          <div className={`flex items-center gap-1 text-base ${isUnverified ? 'text-gray-400' : 'text-gray-500'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M7.5 6.5C7.5 8.981 9.519 11 12 11s4.5-2.019 4.5-4.5S14.481 2 12 2 7.5 4.019 7.5 6.5zM20 21h1v-1c0-3.859-3.141-7-7-7h-4c-3.86 0-7 3.141-7 7v1h17z" />
            </svg>
            {freelancer.followersCount.toLocaleString()}
          </div>
        )}
      </div>

      {/* Job Title */}
      <div className={`mt-2 text-lg ${isUnverified ? 'text-gray-400' :
        isPlatinium ? 'text-gray-700' :
          'text-gray-600'
        }`}>
        {freelancer.jobTitle}
      </div>

      {/* Engagement Rate */}
      {freelancer.engagementRate && (
        <div className={`mt-2 flex items-center gap-2 ${isUnverified ? 'text-gray-400' :
          isPlatinium ? 'text-orange-500' :
            'text-gray-500'
          }`}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 0 1 2.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 0 0 .322-1.672V2.75a.75.75 0 0 1 .75-.75 2.25 2.25 0 0 1 2.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282m0 0h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 0 1-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 0 0-1.423-.23H5.904m10.598-9.75H14.25M5.904 18.5c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 0 1-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 9.953 4.167 9.5 5 9.5h1.053c.472 0 .745.556.5.96a8.958 8.958 0 0 0-1.302 4.665c0 1.194.232 2.333.654 3.375Z" />
          </svg>
          <span className="font-medium">{(freelancer.engagementRate * 100).toFixed(1)}% Engagement Rate</span>
        </div>
      )}
    </div>
  );
};

// Add this CSS to your global styles or component
const styles = `
  @keyframes fade-up {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .animate-fade-up {
    animation: fade-up 0.3s ease-out forwards;
  }
`;
