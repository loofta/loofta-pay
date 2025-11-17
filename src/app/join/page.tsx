"use client";
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTelegramUser } from '@/context/TelegramUserContext';
import { getFreelancerByTelegramData } from '@/app/actions/freelancers/freelancers';

const JoinPage = () => {
  const router = useRouter();
  const { userData } = useTelegramUser();

  useEffect(() => {
    const checkExistingProfile = async () => {
      // First check local storage
      const storedProfile = window.Telegram?.WebApp?.storage?.getItem('freelancerProfile') ||
        localStorage.getItem('freelancerProfile');
      const storedProfileType = window.Telegram?.WebApp?.storage?.getItem('profile') ||
        localStorage.getItem('profile');

      if (storedProfile && storedProfileType === 'freelancer') {
        router.replace('/profile');
        return;
      }

      // If no local storage but we have userData, check DB
      if (userData?.id) {
        try {
          const freelancer = await getFreelancerByTelegramData(userData.id);
          // This is where the issue might be - not normalizing handle comparison
          if (freelancer) {
            const freelancerProfile = JSON.stringify(freelancer);
            window.Telegram?.WebApp?.storage?.setItem('freelancerProfile', freelancerProfile);
            localStorage.setItem('freelancerProfile', freelancerProfile);
            window.Telegram?.WebApp?.storage?.setItem('profile', 'freelancer');
            localStorage.setItem('profile', 'freelancer');
            router.replace('/profile');
            return;
          }
        } catch (error) {
          console.error('Error checking freelancer existence:', error);
        }
      }
    };

    checkExistingProfile();
  }, [userData?.id, router]);

  return (
    <div>
      {/* Render your component content here */}
    </div>
  );
};

export default JoinPage;