'use client';

import { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { useRouter } from 'next/navigation';
import { useToast } from "@/components/ui/use-toast";
import Title from "@/components/Title";
import { useTelegramUser } from "@/context/TelegramUserContext";
import { createDeal, getOngoingReceivedDeals } from "@/app/actions/deals/deals";
import { notifyDealReceived } from '@/services/notificationService';
import { getReferredUsersCount } from "@/app/actions/freelancers/freelancers";
import { Users, Trophy, Twitter } from "lucide-react";
import PrimaryBtn from '@/components/PrimaryBtn';
import { DEALS_ROUTE } from "@/app/utils/routes";
import LoadingScreen from '@/components/LoadingScreen';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';

export default function ReferralPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { userData } = useTelegramUser();
  const [hasReferralDeal, setHasReferralDeal] = useState<boolean>(false);
  const [referredUsersCount, setReferredUsersCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!userData?.username) return;

      try {
        // Fetch user's deals
        const deals = await getOngoingReceivedDeals(userData.id, userData.username.toLowerCase());
        const referralDeal = deals.deals?.find(deal => deal.campaignId === "referral-2");
        setHasReferralDeal(!!referralDeal);

        // Fetch referred users if deal exists
        if (referralDeal) {
          const count = await getReferredUsersCount(userData.username.toLowerCase());
          setReferredUsersCount(count);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
        toast({
          title: "Error",
          description: "Failed to load referral data",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [userData?.username]);

  const handleJoinContest = async () => {
    try {
      const freelancerProfile = window.Telegram?.WebApp?.storage?.getItem('freelancerProfile') ||
        localStorage.getItem('freelancerProfile');
      const freelancer = JSON.parse(freelancerProfile);

      if (!freelancerProfile) {
        toast({
          title: "Error",
          description: "Creator profile not found. Please complete your profile first.",
          variant: "destructive",
        });
        return;
      }


      const expectedDeliveryDate = dayjs('2025-02-18');

      const newDealDescription = "Join the Referral Challenge on Loofta and stand a chance to win fantastic USDt prizes! This 2-month-long contest invites you to refer friends to our platform using your Twitter handle, and the top three referrers will win USDt rewards:\n\n 1st Place: $50\n 2nd Place: $30\n 3rd Place: $20\n\n How to Enter:\n To participate and earn points, simply share a tweet encouraging others to join Loofta. New users must enter your Twitter handle at the end of the profile creation form.\n\n Bonus for New Users:\n Every new joiner who uses a referral will receive an additional 5 points on their first completed deal!\n\n Eligibility Requirements:\n To qualify for a prize, you need at least 2 referees who have joined Loofta and completed their welcome deal.\n\n Spread the word, get your friends on board, and let's make this next month a monthof wins! Ready, set, refer!";
      const newDealTitle = "Referral Challenge: Win USDt Prizes!";
      const generatedId = uuidv4();

      const result = await createDeal({
        id: generatedId,
        title: newDealTitle,
        description: newDealDescription,
        amount: 0,
        points: 10,
        expectedDeliveryDate: expectedDeliveryDate?.toISOString() || '',
        paymentStatus: 'unpaid',
        campaignId: 'referral-2',
        walletAddress: 'UQCmXf2tAb63DYnOVSrSWHhxBuze6Nu_z8Qqzkm9f8GJNMtz',
        recipientWalletAddress: freelancer.walletAddress,
        recipientId: freelancer.id,
        recipientTgId: freelancer.telegramId || 0,
        recipientTgUsername: freelancer.telegramHandle,
        senderTgId: 7815070412,
        senderTgUsername: 'looftaxyz',
      });

      setHasReferralDeal(true);

      // Add notification
      await notifyDealReceived(freelancer.id || '', userData?.id || null);

      toast({
        title: "New Deal Received!",
        description: "You've joined the referral contest. Check your deals to get started!",
        variant: "default",
      });
    } catch (error) {
      console.error('Error creating referral deal:', error);
      toast({
        title: "Error",
        description: "Failed to join contest. Please try again.",
        variant: "destructive",
      });
    }
  };

  const freelancerProfile = window.Telegram?.WebApp?.storage?.getItem('freelancerProfile') ||
    localStorage.getItem('freelancerProfile');
  const freelancer = JSON.parse(freelancerProfile);

  const tweetText = encodeURIComponent(
    "🚀 Join me on @looftaxyz - the Web3 marketplace connecting KOLs & creators with projects!\n\n" +
    "💫 Get early access & rewards\n" +
    "🌟 Join a thriving community\n" +
    "💎 Earn in usdt\n\n" +
    "Use my referral code by just entering my X username: @" + freelancer?.twitterHandle + "\n\n" +
    "Join now 👇\n" +
    "https://t.me/LooftaBot"
  );

  if (loading) {
    return <LoadingScreen text="Loading..." isVisible={true} />;
  }

  return (
    <div className="tg-webview h-screen flex flex-col">
      <div className="flex-1 overflow-y-auto space-y-4 mt-8 px-4 mx-0">
        <Title text="Referral Contest" showWallet={false} customProperties="mx-4" />

        {hasReferralDeal ? (
          <div className="p-4 bg-white rounded-lg shadow-md space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Track Your Referrals</h2>
              <Trophy className="w-6 h-6 text-yellow-500" />
            </div>

            <div className="bg-orange-50 p-4 rounded-lg">
              <div className="flex items-center gap-3">
                <Users className="w-8 h-8 text-orange-500" />
                <div>
                  <h3 className="text-lg font-medium">
                    {referredUsersCount > 0
                      ? `Congratulations! 🎉`
                      : `No referrals yet`}
                  </h3>
                  <p className="text-gray-600">
                    {referredUsersCount > 0
                      ? `You've referred ${referredUsersCount} new user${referredUsersCount > 1 ? 's' : ''} to Loofta!`
                      : `Share your handle on X to start earning rewards!`}
                  </p>
                </div>
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full mt-2 flex items-center justify-center space-x-2"
              onClick={() => window.open(`https://twitter.com/intent/tweet?text=${tweetText}`, '_blank')}
            >
              <Twitter className="w-5 h-5" />
              <span>Share on X</span>
            </Button>
          </div>
        ) : (
          <div className="p-4 bg-white rounded-lg shadow-md space-y-4">
            <h2 className="text-xl font-semibold">🏆 Referral Contest</h2>
            <p className="text-gray-700">
              Join our referral contest running until February 18th and earn up to $100!
              Invite new users to Loofta and climb the leaderboard.
            </p>
            <PrimaryBtn
              text="Join Contest"
              onClick={handleJoinContest}
              customProperties="w-full justify-center"
            />
          </div>
        )}

        {/* Contest Rules Section */}
        <div className="p-4 bg-white rounded-lg shadow-md space-y-4">
          <h2 className="text-xl font-semibold">📜 Contest Rules</h2>
          <ul className="list-disc pl-5 space-y-2 text-gray-700">
            <li>Contest runs until December 17th, 2024</li>
            <li>Each valid referral earns you points</li>
            <li>Top referrers win up to $100 in rewards</li>
            <li>Referred users must complete registration</li>
          </ul>
        </div>
      </div>

      {/* Back to Deals Button */}
      <div className="w-full bg-white p-4">
        <PrimaryBtn
          text="Back to Deals"
          onClick={() => router.push(DEALS_ROUTE)}
          customProperties="w-full justify-center mb-4"
        />
      </div>
    </div>
  );
}

