import { useState, useEffect } from 'react';
import { getAllFreelancers } from '@/app/actions/freelancers/freelancers';
import { Freelancer } from '@/app/utils/interfaces';

export function useFreelancers() {
  const [freelancers, setFreelancers] = useState<Freelancer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchFreelancers = async () => {
      try {
        const result = await getAllFreelancers();
        if (!mounted) return;
        
        if (result.success && result.freelancers) {
          setFreelancers(result.freelancers);
        } else {
          setError(result.error || 'Failed to load freelancers');
        }
      } catch (err) {
        if (!mounted) return;
        setError('Failed to load freelancers');
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    fetchFreelancers();

    return () => {
      mounted = false;
    };
  }, []);

  return { freelancers, isLoading, error };
}
