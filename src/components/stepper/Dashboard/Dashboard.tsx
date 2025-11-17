import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import OngoingDealCard from "./OngoingDealCard";
import PastDealCard from "./PastDealCard";
import { useDeals } from "@/hooks/useDeals";
import Title from "@/components/Title";
import Subtitle from "@/components/Subtitle";
import SkeletonOngoingDealCard from "./SkeletonOngoingDealCard";
import { useTonAddress } from "@tonconnect/ui-react";
import OngoingDealCardFreelancer from './OngoingDealCardFreelancer';
import PastDealCardFreelancer from './PastDealCardFreelancer';
import { Trophy, ChevronDown, ChevronUp } from "lucide-react";
import { DEALS_REFERRAL_ROUTE } from "@/app/utils/routes";
import { useRouter } from 'next/navigation';
import { Freelancer } from '@/app/utils/interfaces';
import { IOngoingDealCardProps as OngoingDeal } from '@/app/utils/interfaces';

export default function Dashboard() {
  const {
    ongoingDeals,
    ongoingReceivedDeals,
    pastDeals,
    pastReceivedDeals,
    totalSpent,
    totalEarnPoints, // Added totalEarnPoints here
    loading
  } = useDeals();

  const [activeTab, setActiveTab] = useState("ongoing");
  const walletAddress = useTonAddress(true);
  const [userProfile, setUserProfile] = useState(undefined); // Assume default profile is "client"
  const router = useRouter();
  const [storedFreelancerProfile, setStoredFreelancerProfile] = useState<Freelancer | null>(null);
  const [showMissedDeals, setShowMissedDeals] = useState(false);

  useEffect(() => {
    if (walletAddress) {
      const storedProfile = window.Telegram?.WebApp?.storage?.getItem('profile') || localStorage.getItem('profile');
      setUserProfile(storedProfile || "client");
    }
  }, [walletAddress]);

  useEffect(() => {
    const profileData = window.Telegram?.WebApp?.storage?.getItem('freelancerProfile') || localStorage.getItem('freelancerProfile');
    if (profileData) {
      try {
        const parsedProfile = JSON.parse(profileData);
        setStoredFreelancerProfile(parsedProfile);
      } catch (e) {
        console.error('Error parsing creator profile:', e);
      }
    }
  }, []);

  const calculateTotalReceived = () => {
    return pastReceivedDeals?.reduce((total, deal) => total + parseFloat(deal.amount), 0).toFixed(0) || 0;
  };
  const calculateTotalPointsReceived = () => {
    return pastReceivedDeals?.reduce((total, deal) => total + (Number(deal.points) || 0), 0) || 0;
  };

  const separateMissedDeals = (deals: OngoingDeal[]) => {
    if (!deals) return { active: [], missed: [] };

    const now = new Date();
    return deals.reduce((acc: { active: OngoingDeal[], missed: OngoingDeal[] }, deal: OngoingDeal) => {
      const expectedDate = deal.expectedDeliveryDate ? new Date(deal.expectedDeliveryDate) : now;
      const isMissed = expectedDate < now &&
        (deal.dealStatus === "ongoing" || deal.dealStatus === "pending");

      if (isMissed) {
        acc.missed.push(deal);
      } else {
        acc.active.push(deal);
      }
      return acc;
    }, { active: [], missed: [] });
  };

  const renderPastFreelancerDeals = () => {
    if (!pastReceivedDeals || pastReceivedDeals.length === 0) {
      return <CardContent className="flex justify-center items-center h-32">
        <Subtitle text="You have no past deals." />
      </CardContent>;
    }

    const { active, missed } = separateMissedDeals(ongoingReceivedDeals || []);

    return (
      <CardContent className="space-y-4">
        {/* Completed Deals */}
        <div className="space-y-2">
          {pastReceivedDeals.map((deal, index) => (
            <PastDealCardFreelancer
              key={index}
              {...deal}
            />
          ))}
        </div>

        {/* Missed Deals Section */}
        {missed.length > 0 && (
          <div className="space-y-2 mt-6">
            <button
              onClick={() => setShowMissedDeals(!showMissedDeals)}
              className="w-full flex items-center justify-between p-3 bg-amber-50 rounded-lg text-amber-700 hover:bg-amber-100 transition-colors"
            >
              <span className="font-medium">
                Missed Deadlines ({missed.length})
              </span>
              {showMissedDeals ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>

            {showMissedDeals && (
              <div className="space-y-2 mt-2">
                {missed.map((deal, index) => (
                  <OngoingDealCardFreelancer
                    key={index}
                    {...deal}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    );
  };

  const renderFreelancerDeals = () => {
    const { active } = separateMissedDeals(ongoingReceivedDeals || []);

    if (!active || active.length === 0) {
      return (
        <CardContent className="flex justify-center items-center h-32">
          <Subtitle text="You have no ongoing deals." />
        </CardContent>
      );
    }

    return (
      <CardContent className="space-y-2">
        {active.map((deal, index) => (
          <OngoingDealCardFreelancer
            key={index}
            {...deal}
          />
        ))}
      </CardContent>
    );
  };

  const renderHeaderText = () => {
    if (activeTab === "past") {
      if (userProfile === "freelancer" && (parseFloat(calculateTotalReceived().toString()) > 0 || calculateTotalPointsReceived() > 0)) {
        return (
          <div className="w-full bg-gradient-to-r from-green-50 to-blue-50 p-3 rounded-lg border border-green-100 shadow-sm">
            <div className="flex flex-col gap-2">
              <p className="font-medium text-gray-800">
                🎉 You&apos;ve earned:
              </p>
              <div className="grid grid-cols-2 gap-2 w-full">
                {parseFloat(calculateTotalReceived().toString()) > 0 && (
                  <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-md shadow-sm w-full">
                    <div className="w-6 h-6 bg-teal-500 rounded-full flex items-center justify-center">
                      <span className="text-white font-bold text-sm">₮</span>
                    </div>
                    <span className="font-bold text-gray-800">
                      {calculateTotalReceived().toString()} USDt
                    </span>
                  </div>
                )}
                {calculateTotalPointsReceived() > 0 && (
                  <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-md shadow-sm w-full">
                    <div className="w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center">
                      <span className="text-white text-sm">⭐</span>
                    </div>
                    <span className="font-bold text-gray-800">
                      {calculateTotalPointsReceived()} points
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      } else if (userProfile === "client" && totalSpent > 0) {
        return (
          <div className="flex justify-between items-center">
            <p className="font-medium text-lg text-gray-800 opacity-80 mr-2">
              You spent:
            </p>
            <p className="font-bold text-xl mr-1">
              {totalSpent.toString()} USDt
            </p>
            <p className='font-normal italic text-md'>
              ({totalEarnPoints} points)
            </p>
          </div>
        );
      }
    }
    return <p></p>;
  };

  return (
    <div className="flex flex-col">
      <section className="flex flex-col flex-1 overflow-hidden">
        <Title text="Deals" customProperties="mx-4" />
        {userProfile == 'client' ? (
          <Subtitle
            text="Connect with top KOLs and creators! Easily set up custom p2p deals, outline your project, and start collaborating in minutes."
            customProperties="mt-4 mx-4"
          />
        ) : (
          <Subtitle
            text="Check out the deals you've received and completed, earn Loofta's points for future rewards!"
            customProperties="mt-4 mx-4"
          />
        )}


        <Tabs defaultValue="ongoing" onValueChange={setActiveTab} className="w-full flex flex-col h-full mt-4">
          <TabsList className="grid w-full h-auto grid-cols-2 shadow-md">
            <TabsTrigger className="font-sans font-medium text-md md:text-3xl lg:text-4xl" value="ongoing">
              ONGOING DEALS
            </TabsTrigger>
            <TabsTrigger className="font-sans font-medium text-md md:text-3xl lg:text-4xl" value="past">
              PAST DEALS
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center justify-between mt-4 mx-4">
            {renderHeaderText()}
          </div>

          <div className="overflow-y-auto w-auto flex-1 mb-[72px]">
            {loading ? (
              <div className="w-full items-center h-full">
                <SkeletonOngoingDealCard />
              </div>
            ) : (
              <>
                <TabsContent value="ongoing">
                  <Card className="border-none shadow-none">
                    <CardHeader></CardHeader>
                    {userProfile === "client" ? (
                      !ongoingDeals || ongoingDeals.length === 0 ? (
                        <CardContent className="flex justify-center items-center h-32">
                          <Subtitle text="You have no ongoing deals." />
                        </CardContent>
                      ) : (
                        <CardContent className="space-y-2">
                          {ongoingDeals.map((deal, index) => (
                            <OngoingDealCard
                              key={index}
                              title={deal.title}
                              dealId={deal.dealId}
                              dateCreated={deal.dateCreated}
                              description={deal.description}
                              amount={deal.amount}
                              recipientId={deal.recipientId}
                              senderTgUsername={deal.senderTgUsername}
                              paymentStatus={deal.paymentStatus}
                              recipientWalletAddress={deal.recipientWalletAddress}
                              dealStatus={deal.dealStatus}
                            />
                          ))}
                        </CardContent>
                      )
                    ) : renderFreelancerDeals()}
                  </Card>
                </TabsContent>

                <TabsContent value="past">
                  <Card className="border-none shadow-none">
                    <CardHeader></CardHeader>
                    {userProfile === "client" ? (
                      !pastDeals || pastDeals.length === 0 ? (
                        <CardContent className="flex justify-center items-center h-32">
                          <Subtitle text="You have no past deals." />
                        </CardContent>
                      ) : (
                        <CardContent className="space-y-2">
                          {pastDeals.map((deal, index) => (
                            <PastDealCard
                              key={index}
                              title={deal.title}
                              isReceived={false}
                              dealId={deal.dealId}
                              amount={deal.amount}
                              description={deal.description}
                              recipientWalletAddress={deal.recipientWalletAddress}
                              expectedDeliveryDate={deal.expectedDeliveryDate}
                              earnedPoints={deal.earnedPoints}
                              recipientId={deal.recipientId}
                              senderTgUsername={deal.senderTgUsername} />
                          ))}
                        </CardContent>
                      )
                    ) : renderPastFreelancerDeals()}
                  </Card>
                </TabsContent>
              </>
            )}
          </div>
        </Tabs>
      </section>
    </div>
  );
}
