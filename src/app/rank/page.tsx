'use client';

import { useEffect } from 'react';
import { useRankings } from '@/hooks/useRankings';
import LoadingScreen from '@/components/LoadingScreen';
import Title from '@/components/Title';
import { Badge } from '@/components/ui/badge';
import { Crown, Trophy, Medal } from 'lucide-react';
import WebApp from '@twa-dev/sdk';
import { useTelegramUser } from '@/context/TelegramUserContext';
import MobilePillMenu from '@/components/BottomMenu';

function maskUsername(username: string, isCurrentUser: boolean): string {
  if (isCurrentUser) return username;

  if (username.length <= 4) {
    return username[0] + '***';
  }

  return username.slice(0, 2) + '***' + username.slice(-2);
}

export default function RankPage() {
  const { userData } = useTelegramUser();
  const { rankings, isLoading, error } = useRankings();

  useEffect(() => {
    if (typeof window !== "undefined") {
      WebApp.expand();
    }
  }, []);

  if (isLoading) {
    return <LoadingScreen text="Loading rankings..." isVisible={true} />;
  }


  // Find current user's rank using multiple matching methods
  const userRank = rankings.findIndex(rank =>
    // Try matching by telegramId first
    (userData?.id && rank.telegramId === userData.id) ||
    // Fall back to matching by telegram handle
    (userData?.username && rank.telegramHandle?.toLowerCase() === userData?.username?.toLowerCase())
  );

  console.log('Found userRank:', userRank);
  const currentUserData = userRank !== -1 ? rankings[userRank] : null;
  console.log('CurrentUserData:', currentUserData);

  const getRankBadge = (index: number) => {
    switch (index) {
      case 0:
        return <Crown className="h-6 w-6 text-yellow-500" />;
      case 1:
        return <Trophy className="h-6 w-6 text-gray-400" />;
      case 2:
        return <Medal className="h-6 w-6 text-amber-600" />;
      default:
        return <span className="text-gray-500 font-medium">#{index + 1}</span>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'platinium':
        return <Badge className="bg-purple-100 text-purple-800">Platinum</Badge>;
      case 'vip':
        return <Badge className="bg-blue-100 text-blue-800">VIP</Badge>;
      case 'verified':
        return <Badge className="bg-green-100 text-green-800">Verified</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      <div className="p-4">
        <Title text="Creator Rankings" showWallet={false} />

        <div className="relative">
          <div className="mt-6 space-y-4 mb-24">
            {rankings.map((rank, index) => {
              const isCurrentUser = rank.telegramId === userData?.id;

              return (
                <div
                  key={rank.freelancerId}
                  className={`bg-white rounded-lg p-4 shadow-sm border ${index < 3 ? 'border-orange-200' : 'border-gray-100'
                    } ${isCurrentUser ? 'bg-orange-50 ring-2 ring-orange-200' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex-shrink-0">
                        {getRankBadge(index)}
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">
                          {isCurrentUser ? 'You' : rank.fullName}
                        </h3>
                        <p className="text-sm text-gray-500">
                          @{maskUsername(rank.telegramHandle, isCurrentUser)}
                        </p>
                      </div>
                    </div>
                    {getStatusBadge(rank.status)}
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div className="text-center p-2 bg-orange-50 rounded-lg">
                      <p className="text-orange-600 font-semibold">{rank.points}</p>
                      <p className="text-gray-600">Points</p>
                    </div>
                    <div className="text-center p-2 bg-green-50 rounded-lg">
                      <p className="text-green-600 font-semibold">${rank.usdtEarned}</p>
                      <p className="text-gray-600">Earned</p>
                    </div>
                    <div className="text-center p-2 bg-blue-50 rounded-lg">
                      <p className="text-blue-600 font-semibold">{rank.completedDeals}</p>
                      <p className="text-gray-600">Deals</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-gray-50 to-transparent pointer-events-none" />
        </div>
      </div>

      {currentUserData && (
        <div className="fixed bottom-16 left-0 right-0 bg-transparent  pt-4">
          <div className="p-4">
            <div className={`
              bg-white 
              rounded-lg 
              p-4 
              shadow-lg 
              border-2 
              border-orange-200
              relative
              z-10
              transform
              transition-all
              duration-200
              hover:shadow-xl
              hover:-translate-y-0.5
            `}>
              <div className="absolute inset-0 bg-gradient-to-br from-orange-50 to-transparent rounded-lg opacity-50" />

              <div className="relative">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0">
                      <span className="text-orange-500 font-semibold">#{userRank + 1}</span>
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900">You</h3>
                      <p className="text-sm text-gray-500">@{currentUserData.telegramHandle}</p>
                    </div>
                  </div>
                  {getStatusBadge(currentUserData.status)}
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div className="text-center p-2 bg-orange-50 rounded-lg">
                    <p className="text-orange-600 font-semibold">{currentUserData.points}</p>
                    <p className="text-gray-600">Points</p>
                  </div>
                  <div className="text-center p-2 bg-green-50 rounded-lg">
                    <p className="text-green-600 font-semibold">${currentUserData.usdtEarned}</p>
                    <p className="text-gray-600">Earned</p>
                  </div>
                  <div className="text-center p-2 bg-blue-50 rounded-lg">
                    <p className="text-blue-600 font-semibold">{currentUserData.completedDeals}</p>
                    <p className="text-gray-600">Deals</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0">
        <MobilePillMenu />
      </div>
    </div>
  );
} 