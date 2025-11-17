'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useDeals } from '@/hooks/useDeals';
import { Trophy, Users, Clock, CheckCircle, AlertCircle, Twitter, Wallet, Edit2, Package, Check, DollarSign, Bell, User, Loader2, GiftIcon, GraduationCap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { DEALS_ROUTE, DEALS_REFERRAL_ROUTE, JOIN_ROUTE, PROFILE_ROUTE } from '@/app/utils/routes';
import { getReferredUsersCount } from "@/app/actions/freelancers/freelancers";
import LoadingScreen from './LoadingScreen';
import PrimaryBtn from '@/components/PrimaryBtn';
import { Button } from '@/components/ui/button';
import { toFriendlyAddress } from '@/lib/utils';
import { useToast } from "@/components/ui/use-toast";
import { Progress } from "@/components/ui/progress";
import { set } from 'date-fns';
import Link from 'next/link';
import SecondaryBtn from './SecondaryBtn';
import { notifyDealReceived } from '@/services/notificationService';
import { createDeal } from '@/app/actions/deals/deals';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import { useTelegramUser } from '@/context/TelegramUserContext';
import { Badge } from "@/components/ui/badge";
import { getFreelancerById } from "@/app/actions/freelancers/freelancers";
import { useUser } from '@/hooks/useUser';

interface DashboardStats {
  totalEarned: number;
  totalPoints: number;
  completedDeals: number;
  ongoingDeals: number;
  pendingDeals: number;
  referralCount?: number;
}

const pointsNeededForVerification = 300;
const pointsNeededForVIP = 1000;
const CACHE_KEY = 'creatorDashboardStats';
const REFERRAL_CACHE_KEY = 'referralStatus';

interface ReferralCache {
  hasReferralDeal: boolean;
  referredUsersCount: number;
  timestamp: number;
}

// Add status badge colors
const statusColors = {
  verified: "bg-green-100 text-green-800",
  vip: "bg-blue-100 text-blue-800",
  platinium: "bg-purple-100 text-purple-800",
  unverified: "bg-gray-100 text-gray-800"
};

export default function CreatorDashboard({ freelancerProfile }: { freelancerProfile: any }) {
  const { ongoingReceivedDeals, pastReceivedDeals, loading: dealsLoading } = useDeals();
  const { userData } = useTelegramUser();
  const { points } = useUser();
  const [loading, setLoading] = useState(() => !localStorage.getItem(CACHE_KEY));
  const router = useRouter();
  const { toast } = useToast();
  const [freelancerStatus, setFreelancerStatus] = useState<string>("");

  // Add wallet check effect
  useEffect(() => {
    if (!freelancerProfile.walletAddress) {
      router.push('/settings/profile');
      toast({
        title: "Wallet Address Required",
        description: "Please update your payment wallet address to continue. If the error persists, please disconnect and reconnect your wallet.",
        variant: "destructive",
      });
    }
  }, [freelancerProfile.walletAddress, router]);

  const [referralState, setReferralState] = useState<{
    isLoading: boolean;
    hasReferralDeal: boolean;
    referredUsersCount: number | null;
  }>(() => {
    const cached = localStorage.getItem(REFERRAL_CACHE_KEY);
    if (cached) {
      const parsedCache: ReferralCache = JSON.parse(cached);
      if (Date.now() - parsedCache.timestamp < 5 * 60 * 1000) {
        return {
          isLoading: false,
          hasReferralDeal: parsedCache.hasReferralDeal,
          referredUsersCount: parsedCache.referredUsersCount
        };
      }
    }
    return {
      isLoading: true,
      hasReferralDeal: false,
      referredUsersCount: null  // Use null for initial loading state
    };
  });

  // Memoize stats calculations
  const stats = useMemo(() => {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached && (!pastReceivedDeals || dealsLoading)) {
      return JSON.parse(cached);
    }

    if (dealsLoading || !pastReceivedDeals) {
      return {
        totalEarned: 0,
        totalPoints: points || 0,
        completedDeals: 0,
        ongoingDeals: 0,
        pendingDeals: 0,
        unpaidDeals: 0
      };
    }

    const now = new Date();
    const newStats = {
      totalEarned: [...pastReceivedDeals, ...(ongoingReceivedDeals || [])]
        .filter(deal => deal.dealStatus === "done" && deal.paymentStatus === "paid")
        .reduce((sum, deal) => sum + Number(deal.amount), 0),

      totalPoints: points || 0,

      completedDeals: pastReceivedDeals.filter(deal => deal.dealStatus === "done").length +
        (ongoingReceivedDeals?.filter(deal => deal.dealStatus === "done").length || 0),

      ongoingDeals: ongoingReceivedDeals?.filter(deal => {
        if (!deal.expectedDeliveryDate) return false;
        const deliveryDate = new Date(deal.expectedDeliveryDate);
        return deal.dealStatus === "ongoing" && deliveryDate > now;
      })?.length || 0,

      pendingDeals: ongoingReceivedDeals?.filter(deal => {
        if (!deal.expectedDeliveryDate) return false;
        const deliveryDate = new Date(deal.expectedDeliveryDate);
        return deal.dealStatus === "pending" && deliveryDate > now;
      })?.length || 0,

      unpaidDeals: ongoingReceivedDeals?.filter(deal =>
        deal.dealStatus === "done" && deal.paymentStatus === "unpaid"
      )?.length || 0
    };

    localStorage.setItem(CACHE_KEY, JSON.stringify(newStats));
    return newStats;
  }, [dealsLoading, pastReceivedDeals, ongoingReceivedDeals, points]);

  const handleJoinContest = async () => {
    setReferralState({ isLoading: true, hasReferralDeal: false, referredUsersCount: 0 });
    try {
      // Check if user already has a referral-2 deal
      const existingReferralDeal = ongoingReceivedDeals?.find(deal =>
        deal.campaignId === "referral-2"
      ) || pastReceivedDeals?.find(deal =>
        deal.campaignId === "referral-2"
      );

      if (existingReferralDeal) {
        toast({
          title: "Already Joined",
          description: "You have already joined the referral contest!",
          variant: "default",
        });
        setReferralState({ isLoading: false, hasReferralDeal: true, referredUsersCount: 0 });
        return;
      }

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

      setReferralState({ isLoading: false, hasReferralDeal: true, referredUsersCount: 0 });

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

  // Optimize referral check
  const checkReferralStatus = useCallback(async () => {
    if (!freelancerProfile.telegramHandle) {
      setReferralState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    try {
      // Check for referral campaign IDs first
      const referralDeal = ongoingReceivedDeals?.find(deal =>
        deal.campaignId === "referral-2"
      );
      const hasReferral = !!referralDeal;

      // Set initial loading state with hasReferralDeal
      setReferralState(prev => ({
        ...prev,
        hasReferralDeal: hasReferral,
        isLoading: hasReferral, // Keep loading if we have a referral deal
        referredUsersCount: null
      }));

      // Only fetch count if we have a referral deal
      if (hasReferral) {
        const count = await getReferredUsersCount(freelancerProfile.telegramHandle.toLowerCase());

        const cacheData: ReferralCache = {
          hasReferralDeal: hasReferral,
          referredUsersCount: count,
          timestamp: Date.now(),
        };

        localStorage.setItem(REFERRAL_CACHE_KEY, JSON.stringify(cacheData));

        setReferralState({
          isLoading: false,
          hasReferralDeal: hasReferral,
          referredUsersCount: count
        });
      }

    } catch (error) {
      console.error('Error checking referral status:', error);
      setReferralState(prev => ({
        ...prev,
        isLoading: false,
        referredUsersCount: 0
      }));
    }
  }, [ongoingReceivedDeals, freelancerProfile.telegramHandle]);
  useEffect(() => {
    if (!dealsLoading && ongoingReceivedDeals) {
      checkReferralStatus();
    } else {
      setReferralState(prev => ({ ...prev, isLoading: false }));
    }
  }, [checkReferralStatus, dealsLoading, ongoingReceivedDeals]);

  // Memoize progress calculations
  const progress = useMemo(() => {
    return {
      verification: Math.min((stats.totalPoints / pointsNeededForVerification) * 100, 100),
      vip: Math.min((stats.totalPoints / pointsNeededForVIP) * 100, 100)
    };
  }, [stats.totalPoints]);

  // Remove console.log statements in production
  if (process.env.NODE_ENV !== 'development') {
    console.log = () => { };
  }

  const renderReferralSection = () => {
    if (referralState.isLoading || dealsLoading) {
      return (
        <div className="bg-white rounded-lg p-4 shadow-sm border">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-orange-500" />
              <h2 className="text-base font-medium text-gray-800">Referral Challenge</h2>
            </div>
          </div>
          <p className="text-gray-600 text-sm mb-4">
            Join our Referral challenge and earn up to $100 in rewards! Invite creators to Loofta and climb the leaderboard. 🎁
          </p>
          <SecondaryBtn text='Loading...' disabled={true} onClick={() => { }} />
        </div>
      );
    }

    if (referralState.hasReferralDeal) {
      return (
        <div className="bg-white rounded-lg p-4 shadow-sm border">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-gray-600" />
            <h2 className="text-base font-medium text-gray-800">Referrals</h2>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                <Trophy className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <span className="text-sm text-gray-500">Total Referrals</span>
                {referralState.referredUsersCount === null ? (
                  <div className="h-6 w-16 bg-gray-200 rounded animate-pulse mt-1" />
                ) : (
                  <p className="text-xl font-bold text-gray-800">{referralState.referredUsersCount}</p>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const tweetText = encodeURIComponent(
                  "🚀 Join me on @looftaxyz - the Web3 marketplace connecting KOLs & creators with projects!\n\n" +
                  "💫 Get early access & rewards\n" +
                  "🌟 Join a thriving community\n" +
                  "💎 Earn in usdt\n\n" +
                  "Use my referral code by just entering my X username: @" + freelancerProfile?.twitterHandle + "\n\n" +
                  "Join now 👇\n" +
                  "https://t.me/LooftaBot"
                );
                window.open(`https://twitter.com/intent/tweet?text=${tweetText}`, '_blank');
              }}
              className="flex items-center gap-2"
            >
              <Twitter className="w-4 h-4" />
              <span>Share</span>
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="bg-white rounded-lg p-4 shadow-sm border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-orange-500" />
            <h2 className="text-base font-medium text-gray-800">Referral Challenge</h2>
          </div>
        </div>
        <p className="text-gray-600 text-sm mb-4">
          Join our Referral challenge and earn up to $100 in rewards! Invite creators to Loofta and climb the leaderboard. 🎁
        </p>
        <SecondaryBtn text='Join Contest' onClick={handleJoinContest} />
      </div>
    );
  };

  useEffect(() => {
    const fetchFreelancerStatus = async () => {
      if (userData?.id) {
        const freelancer = await getFreelancerById(userData.id.toString());
        if (freelancer) {
          setFreelancerStatus(freelancer.status);
        }
      }
    };

    fetchFreelancerStatus();
  }, [userData?.id]);

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-white to-gray-50">
      <div className="flex-1 p-4 space-y-4 pb-24">
        {/* Profile & Earnings Combined Card */}
        <div className="bg-white rounded-lg p-4 shadow-sm border">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <User className="w-5 h-5 text-gray-600" />
              <h2 className="text-base font-medium text-gray-800">Profile</h2>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push(PROFILE_ROUTE)}
              className="h-8 w-8"
            >
              <Edit2 className="w-4 h-4" />
            </Button>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-blue-600 font-medium">
                    {(freelancerProfile.telegramHandle || freelancerProfile.fullName || "User")[0].toUpperCase()}
                  </span>
                </div>
                <div>
                  <h3 className="font-medium text-gray-800">
                    {freelancerProfile.telegramHandle ? `@${freelancerProfile.telegramHandle}` : freelancerProfile.fullName}
                  </h3>
                  <div className="flex flex-col gap-2">
                    <Badge className={`${statusColors[freelancerProfile.status as keyof typeof statusColors]} w-fit`}>
                      {freelancerProfile.status.charAt(0).toUpperCase() + freelancerProfile.status.slice(1)}
                    </Badge>
                    {/*  <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Wallet className="w-4 h-4" />
                      <code className="font-mono">{toFriendlyAddress(freelancerProfile.walletAddress)}</code>
                    </div> */}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <span className="text-sm text-gray-500">Total Earned</span>
                  <div className="flex items-center gap-1">
                    <div className="w-5 h-5 bg-[#26A17B] rounded-full flex items-center justify-center">
                      <span className="text-white font-bold text-sm">₮</span>
                    </div>
                    <p className="text-lg font-bold text-gray-800">{stats.totalEarned}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-sm text-gray-500">Points</span>
                  <p className="text-lg font-bold text-yellow-600">⭐ {stats.totalPoints}</p>
                </div>
              </div>
            </div>
            {freelancerProfile.status === "unverified" ? (
              <div className="pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between text-sm text-gray-700 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 text-blue-500">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                        <path fillRule="evenodd" d="M8.603 3.799A4.49 4.49 0 0112 2.25c1.357 0 2.573.6 3.397 1.549a4.49 4.49 0 013.498 1.307 4.491 4.491 0 011.307 3.497A4.49 4.49 0 0121.75 12a4.49 4.49 0 01-1.549 3.397 4.491 4.491 0 01-1.307 3.497 4.491 4.491 0 01-3.497 1.307A4.49 4.49 0 0112 21.75a4.49 4.49 0 01-3.397-1.549 4.49 4.49 0 01-3.498-1.306 4.491 4.491 0 01-1.307-3.498A4.49 4.49 0 012.25 12c0-1.357.6-2.573 1.549-3.397a4.49 4.49 0 011.307-3.497 4.49 4.49 0 013.497-1.307z" clipRule="evenodd" />
                      </svg>
                    </span>
                    <span className="font-medium">Verification Progress</span>
                  </div>
                  <span>{stats.totalPoints}/{pointsNeededForVerification} points</span>
                </div>
                <Progress value={progress.verification} className="h-2" />
                {progress.verification >= 100 ? (
                  <button
                    onClick={() => {
                      const message = `Hello Loofta Team!\n\nI would like to request verification for my creator profile.\nI have earned ${stats.totalPoints} points through completed deals.\n\nUser ID: ${freelancerProfile.id}\n\nThank you!`;
                      window.open(`https://t.me/looftaxyz?text=${encodeURIComponent(message)}`, '_blank');
                    }}
                    className="w-full mt-2 bg-primary text-white py-2 px-4 rounded-md hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                  >
                    <span>Request Verification</span>
                    <span className="w-5 h-5">✓</span>
                  </button>
                ) : (
                  <p className="text-xs text-gray-600 mt-2">
                    Complete {pointsNeededForVerification - stats.totalPoints} more points to unlock USDt deals
                  </p>
                )}
              </div>
            ) : (
              <div className="pt-4 border-t border-gray-100">
                {freelancerProfile.status === 'verified' && Number(freelancerProfile.followersCount || 0) < 500 ? (
                  <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4 border border-blue-100">
                    <h3 className="font-semibold text-gray-800 mb-2">
                      Boost Your Earning Potential 🚀
                    </h3>
                    <p className="text-sm text-gray-600 mb-3">
                      Creators with 500+ followers have a higher chance of landing paid deals!
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        className="w-full sm:w-auto flex items-center justify-center gap-2"
                        asChild
                      >
                        <Link href="/store">
                          <Package className="w-4 h-4" />
                          <span>Visit Store</span>
                        </Link>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full sm:w-auto flex items-center justify-center gap-2"
                        asChild
                      >
                        <Link href="/academy">
                          <GraduationCap className="w-4 h-4" />
                          <span>Creator Academy</span>
                        </Link>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-sm text-gray-700 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-4 h-4 text-yellow-500">👑</span>
                        <span className="font-medium">VIP Progress</span>
                      </div>
                      <span>{stats.totalPoints}/{pointsNeededForVIP} points</span>
                    </div>
                    <Progress value={progress.vip} className="h-2" />
                    {stats.totalPoints >= pointsNeededForVIP ? (
                      <button
                        onClick={() => {
                          const message = `Hello Loofta Team!\n\nI would like to request VIP status for my creator profile.\nI have earned ${stats.totalPoints} points through completed deals.\n\nUser ID: ${freelancerProfile.id}\n\nThank you!`;
                          window.open(`https://t.me/looftaxyz?text=${encodeURIComponent(message)}`, '_blank');
                        }}
                        className="w-full mt-2 bg-primary text-white py-2 px-4 rounded-md hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                      >
                        <span>Request VIP Status</span>
                        <span className="w-5 h-5">👑</span>
                      </button>
                    ) : (
                      <p className="text-xs text-gray-600 mt-2">
                        Earn {pointsNeededForVIP - stats.totalPoints} more points to reach VIP status
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Deals Overview and Pending Alerts Combined */}
        <div className="bg-white rounded-lg p-4 shadow-sm border">
          <div className="flex items-center gap-2 mb-4">
            <Package className="w-5 h-5 text-gray-600" />
            <h2 className="text-base font-medium text-gray-800">Deals Overview</h2>
          </div>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 mb-2">
                <Clock className="w-4 h-4 text-blue-500" />
                <span className="text-sm font-medium text-gray-600">Ongoing</span>
              </div>
              <p className="text-xl font-bold text-blue-600">{stats.ongoingDeals}</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 mb-2">
                <AlertCircle className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-medium text-gray-600">Pending</span>
              </div>
              <p className="text-xl font-bold text-amber-600">{stats.pendingDeals}</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 mb-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-sm font-medium text-gray-600">Completed</span>
              </div>
              <p className="text-xl font-bold text-green-600">{stats.completedDeals}</p>
            </div>
          </div>

          {/* Action Required Section */}
          {(stats.ongoingDeals > 0 || stats.pendingDeals > 0) && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mt-4">
              <div className="flex items-center gap-3">
                <Bell className="w-5 h-5 text-amber-500" />
                <div>
                  <h3 className="font-medium text-amber-800">Action Required</h3>
                  <div className="text-sm text-amber-700 space-y-1">
                    {stats.ongoingDeals > 0 && (
                      <p>• {stats.ongoingDeals} ongoing deal{stats.ongoingDeals > 1 ? 's' : ''} to deliver</p>
                    )}
                    {stats.pendingDeals > 0 && (
                      <p>• {stats.pendingDeals} deal{stats.pendingDeals > 1 ? 's' : ''} waiting for you to review</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Separate Section for Unpaid Deals */}
          {stats.unpaidDeals > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-4">
              <div className="flex items-center gap-3">
                <GiftIcon className="w-5 h-5 text-blue-500" />
                <div>
                  <h3 className="font-medium text-blue-800">Reward Status</h3>
                  <p className="text-sm text-blue-700">
                    {stats.unpaidDeals} deal{stats.unpaidDeals > 1 ? 's' : ''} waiting for reward
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Referral Section */}
        {renderReferralSection()}

      </div>

      {/* Fixed Bottom Actions */}
      <div className="fixed bottom-0 left-0 right-0 bg-white p-4 border-t border-gray-100">
        <PrimaryBtn
          text="Enter App"
          onClick={() => router.push(DEALS_ROUTE)}
          customProperties="w-full justify-center"
        />
      </div>
    </div>
  );
}
