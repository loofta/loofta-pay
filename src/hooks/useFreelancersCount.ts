import { useState, useEffect } from 'react';
import { getFreelancersCount } from '@/app/actions/freelancers/freelancers';

export function useFreelancersCount() {
  const [count, setCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCount = async () => {
      try {
        const total = await getFreelancersCount();
        setCount(total);
      } catch (err) {
        setError('Failed to get freelancers count');
      } finally {
        setIsLoading(false);
      }
    };

    fetchCount();
  }, []);

  return { count, isLoading, error };
} 