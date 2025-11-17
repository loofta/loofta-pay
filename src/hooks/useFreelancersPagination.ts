import { useState, useEffect } from 'react';
import { getPaginatedFreelancers } from '@/app/actions/freelancers/freelancers';
import { Freelancer } from '@/app/utils/interfaces';

export function useFreelancersPagination(isAllowed: boolean) {
  const [freelancers, setFreelancers] = useState<Freelancer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadFreelancers = async () => {
      try {
        setIsLoading(true);
        const result = await getPaginatedFreelancers(isAllowed);
        if (result.success && result.freelancers) {
          setFreelancers(result.freelancers);
        }
      } catch (err) {
        setError('Failed to load freelancers');
      } finally {
        setIsLoading(false);
      }
    };

    loadFreelancers();
  }, [isAllowed]);

  return { paginatedFreelancers: freelancers, isLoading, error };
} 