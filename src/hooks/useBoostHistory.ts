import { useState, useEffect } from 'react';
import { getBoostHistory } from '@/app/actions/boosts/boosts';
import { usePrivy } from '@privy-io/react-auth';

export function useBoostHistory() {
  const { user } = usePrivy();
  const [boosts, setBoosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.id) {
      fetchBoosts();
    }
  }, [user?.id]);

  const fetchBoosts = async () => {
    try {
      setLoading(true);
      const result = await getBoostHistory(user!.id);
      if (result.success) {
        setBoosts(result.boosts || []);
      } else {
        setError(result.error || 'Failed to fetch boost history');
      }
    } catch (err) {
      setError('An error occurred while fetching boost history');
    } finally {
      setLoading(false);
    }
  };

  const getNewBoostsCount = () => {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    return boosts.filter(boost => 
      new Date(boost.createdAt) > oneDayAgo
    ).length;
  };

  return {
    boosts,
    loading,
    error,
    refresh: fetchBoosts,
    newBoostsCount: getNewBoostsCount()
  };
} 