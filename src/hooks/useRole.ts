import { getRoleFromDeal } from '@/app/actions/deals/deals';
import { Role } from '@/app/utils/types';
import { useState, useEffect } from 'react';

export const useRole = ({ dealId, telegramHandle }: { dealId: string, telegramHandle: string | undefined }) => {
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const fetchRole = async () => {
      setLoading(true);
      try {
        if (telegramHandle === undefined || telegramHandle === "") {
          setRole(null);
          return;
        }
        const fetchedRole = await getRoleFromDeal(dealId, telegramHandle);
        setRole(fetchedRole);
      } catch (error) {
        console.error('Error fetching role:', error);
        setRole('unknown');
      } finally {
        setLoading(false);
      }
    };

    fetchRole();
  }, [dealId, telegramHandle]);

  return { role, loading };
};
