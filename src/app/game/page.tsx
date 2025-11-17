'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useUser } from '@/hooks/useUser';
import WordGame from '@/components/WordGame';
import MobilePillMenu from '@/components/BottomMenu';
import PrimaryBtn from '@/components/PrimaryBtn';
import SecondaryBtn from '@/components/SecondaryBtn';
import { useRouter } from 'next/navigation';
import { useWordGame } from '@/hooks/useWordGame';

export default function GamePage() {
  const [gameStarted, setGameStarted] = useState(false);
  const { points, spendPoints, userProfile } = useUser();
  const [message, setMessage] = useState('');
  const router = useRouter();
  const { gameState } = useWordGame();

  // Check localStorage first for instant feedback
  const cachedCompletion = typeof window !== 'undefined'
    ? window.Telegram?.WebApp?.storage?.getItem(`wordGame_completed_${userProfile?.id}`)
    || localStorage.getItem(`wordGame_completed_${userProfile?.id}`)
    : null;

  const hasAlreadyCompleted = cachedCompletion === 'true' || gameState?.hasAlreadyCompleted;

  const handleStart = async () => {
    if (points < 5) {
      setMessage('You need at least 5 points to play!');
      return;
    }

    if (hasAlreadyCompleted) {
      setMessage("You've already completed today's word! Come back tomorrow!");
      return;
    }

    try {
      await spendPoints(5);
      setGameStarted(true);
      // setMessage('Game started! 5 points deducted');
    } catch (error) {
      console.error('Error starting game:', error);
      setMessage('Failed to start game');
    }
  };

  const handleGameComplete = async (success: boolean) => {
    if (!success) return;
    //  setMessage('Congratulations! Stay tuned for rewards!');
  };

  return (
    <div className='h-screen tg-webview flex flex-col'>
      <div className='flex-1 overflow-y-auto p-4'>
        {!gameStarted ? (
          <>
            <div className="flex justify-between items-center mb-6">
              <div className="text-lg font-bold text-orange-600">
                🎮 Points: {points}
              </div>
              <SecondaryBtn
                text='🏆 Leaderboard (soon)'
              />
            </div>

            <div className="text-center p-6 bg-white rounded-2xl shadow-lg border border-gray-200">
              <h2 className="text-2xl font-bold mb-4 text-gray-800">🎮 Word Game</h2>

              {hasAlreadyCompleted && (
                <div className="bg-orange-50 p-4 rounded-xl mb-4">
                  <p className="text-gray-800 font-medium">
                    You've already completed today's word! Come back soon for a new challenge.
                  </p>
                </div>
              )}

              <div className="mb-6 space-y-3">
                <div className="p-4 rounded-xl">
                  <p className="text-gray-800 flex items-center gap-2 justify-center font-medium text-lg">
                    <span className="text-xl">⚡️</span>
                    <span>Entry: 5 points</span>
                  </p>
                </div>
                <div className="px-4 rounded-xl">
                  <p className="text-gray-800 flex items-center gap-2 justify-center font-medium text-lg">
                    <span className="text-xl">🎁</span>
                    <span>Secret rewards coming soon!</span>
                  </p>
                </div>

                <div className="bg-gray-50 p-4 rounded-xl text-left">
                  <p className="text-gray-800 font-medium mb-2">How to Play:</p>
                  <ul className="text-gray-700 text-sm space-y-1">
                    <li>The objective is to guess a hidden word. You'll have a limited number of attempts to get it right.</li>
                  </ul>
                </div>
              </div>

              <PrimaryBtn
                text={hasAlreadyCompleted ? "Already Completed" : "Play Now! (5 points)"}
                onClick={handleStart}
                disabled={hasAlreadyCompleted || points < 5}
              />
            </div>
          </>
        ) : (
          <WordGame onGameComplete={handleGameComplete} />
        )}

        {message && (
          <div className={`mt-4 p-3 rounded-lg text-center font-bold animate-fade-in ${message.includes('Congratulations') ? 'bg-green-100 text-green-700' :
            message.includes('need') ? 'bg-red-100 text-red-700' :
              'bg-blue-100 text-blue-700'
            }`}>
            {message}
          </div>
        )}
      </div>

      {!gameStarted && (
        <div className="sticky bottom-0 w-full bg-white px-4 pb-1 border-t">
          <MobilePillMenu />
        </div>
      )}
    </div>
  );
}
