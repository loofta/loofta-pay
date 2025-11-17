import { Freelancer } from '@/app/utils/interfaces';
import { useState, useEffect } from 'react';

import { GameEntry } from '@/types/game';
import { createGameEntry, fetchGameEntries } from '@/app/actions/wordGame/wordGame';
import { useDeals } from './useDeals';

export const useUser = () => {
  const [userProfile, setUserProfile] = useState<Freelancer | null>(null);
  const [loading, setLoading] = useState(true);
  const [gameEntries, setGameEntries] = useState<GameEntry[]>([]);
  const [points, setPoints] = useState(0);
  const { pastReceivedDeals, loading: dealsLoading } = useDeals();

  // First effect: Load user profile
  useEffect(() => {
    const fetchUserProfile = () => {
      try {
        const profileData = window.Telegram?.WebApp?.storage?.getItem('freelancerProfile')
          || localStorage.getItem('freelancerProfile');
        if (profileData) {
          setUserProfile(JSON.parse(profileData));
        }
      } catch (error) {
        console.error('Error fetching user profile:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchUserProfile();
  }, []);

  // Combined effect: Calculate points from deals and subtract game entries
  useEffect(() => {
    if (!userProfile?.id || !pastReceivedDeals) return;

    const calculatePoints = async () => {
      try {
        // Calculate total points from deals
        const totalPoints = pastReceivedDeals.reduce(
          (total, deal) => total + (Number(deal.points) || 0),
          0
        );

        // Fetch and calculate spent points
        const entries = await fetchGameEntries(userProfile.id);

        // Store only the necessary data
        const simplifiedEntries = entries.map(entry => ({
          id: entry.id,
          userId: entry.userId,
          telegramId: entry.telegramId,
          pointsSpent: Number(entry.pointsSpent),
          timestamp: Number(entry.timestamp)
        }));

        setGameEntries(simplifiedEntries);

        const spentPoints = simplifiedEntries.reduce(
          (total, entry) => total + entry.pointsSpent,
          0
        );

        // Set final points balance
        setPoints(totalPoints - spentPoints);
      } catch (error) {
        console.error('Error calculating points:', error);
      }
    };

    calculatePoints();
  }, [userProfile?.id, pastReceivedDeals]);

  const spendPoints = async (pointsToSpend: number) => {
    if (!userProfile?.id) return;

    const entry = {
      id: crypto.randomUUID(),
      userId: String(userProfile.id),
      telegramId: String(userProfile.telegramId),
      pointsSpent: pointsToSpend,
      timestamp: Date.now()
    };

    try {
      const result = await createGameEntry(entry);
      setGameEntries(prev => [...prev, result]);
      setPoints(prev => prev - pointsToSpend);
    } catch (error) {
      console.error('Error spending points:', error);
      throw error;
    }
  };

  return {
    userProfile,
    loading: loading || dealsLoading,
    points,
    spendPoints,
  };
};
