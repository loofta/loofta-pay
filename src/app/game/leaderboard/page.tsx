'use client';

import { useState, useEffect } from 'react';
import { getWeeklyLeaderboard } from '@/app/actions/wordGame/wordGame';
import MobilePillMenu from '@/components/BottomMenu';
import { LeaderboardEntry } from '@/types/game';
import { useRouter } from 'next/navigation';
import PrimaryBtn from '@/components/PrimaryBtn';



export default function LeaderboardPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const data = await getWeeklyLeaderboard();
        const serializedData = JSON.parse(JSON.stringify(data));
        setEntries(serializedData);
      } catch (error) {
        console.error('Error fetching leaderboard:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
  }, []);

  const formatTime = (timestamp: Date) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="h-screen tg-webview flex flex-col bg-gray-50">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-3xl font-bold text-center text-gray-800 mb-8">
            🏆 Leaderboard 🏆
          </h1>

          {loading ? (
            <div className="text-center">Loading leaderboard...</div>
          ) : (
            <div className="space-y-4">
              {entries.map((entry, index) => (
                <div
                  key={entry.id}
                  className={`
                    rounded-lg p-4 shadow-md transition-transform hover:scale-102
                    ${entry.success
                      ? 'bg-gradient-to-r from-green-500 to-green-600 text-white'
                      : 'bg-gradient-to-r from-red-500 to-red-600 text-white'}
                    ${index === 0 && entry.success ? 'animate-pulse' : ''}
                  `}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <span className="text-2xl">
                        {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : ''}
                      </span>
                      <div>
                        <p className="font-medium">@{entry.telegramUsername}</p>
                        <p className="text-sm opacity-90">
                          {entry.success
                            ? `Solved in ${entry.attempts} attempts`
                            : `Failed after ${entry.attempts} attempts`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm opacity-75">
                        {formatTime(entry.completedAt)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}

              {entries.length === 0 && (
                <div className="text-center p-8 bg-white rounded-lg shadow">
                  <p className="text-gray-600">No entries yet this week!</p>
                  <p className="text-sm text-gray-500 mt-2">Be the first to solve the word!</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="w-full bg-white px-4 py-4 space-y-2">
        <PrimaryBtn
          text='Back to Game'
          onClick={() => router.push('/game')}
        />
      </div>
    </div>
  );
}
