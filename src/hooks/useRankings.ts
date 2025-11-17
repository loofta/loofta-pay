import { useState, useEffect } from 'react';
import { getFreelancerRankings, RankingData } from '@/app/actions/freelancers/rankings';

export function useRankings() {
  const [rankings, setRankings] = useState<RankingData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRankings = async () => {
      try {
        setIsLoading(true);
        const result = await getFreelancerRankings();
        if (result.success && result.rankings) {
          setRankings(result.rankings);
        } else {
          setError(result.error || 'Failed to fetch rankings');
        }
      } catch (err) {
        setError('Failed to load rankings');
      } finally {
        setIsLoading(false);
      }
    };

    fetchRankings();
  }, []);

  return { rankings, isLoading, error };
} 