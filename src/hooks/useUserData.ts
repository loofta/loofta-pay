import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getUserByPrivyId } from '@/app/actions/users/users';

interface UserData {
  id: string;
  socialInfo?: {
    name?: string;
    email?: string;
  };
}

export function useUserData() {
  const router = useRouter();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkUserProfile = async () => {
      try {
        const storedData = localStorage.getItem('webUserData');
        if (storedData) {
          const parsedData = JSON.parse(storedData);
          setUserData(parsedData);
          
          // Check if profile is complete
          if (!parsedData.socialInfo?.name || !parsedData.socialInfo?.email) {
            router.push('/onboarding/profile');
          }
        } else {
          // If no stored data, try to fetch from server
          const privyId = localStorage.getItem('privyId');
          if (privyId) {
            const result = await getUserByPrivyId(privyId);
            if (result.success && result.user) {
              const user = result.user as UserData;
              localStorage.setItem('webUserData', JSON.stringify(user));
              setUserData(user);
              
              if (!user.socialInfo?.name || !user.socialInfo?.email) {
                router.push('/onboarding/profile');
              }
            }
          }
        }
      } catch (error) {
        console.error('Error checking user profile:', error);
      } finally {
        setLoading(false);
      }
    };

    checkUserProfile();
  }, [router]);

  const updateUserData = (newData: UserData) => {
    localStorage.setItem('webUserData', JSON.stringify(newData));
    setUserData(newData);
  };

  return { userData, loading, updateUserData };
} 