'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getUserByPrivyId } from '@/app/actions/users/users';
import { usePrivy } from '@privy-io/react-auth';

interface UserData {
  id: string;
  socialInfo?: {
    name?: string;
    email?: string;
  };
}

interface UserContextType {
  userData: UserData | null;
  loading: boolean;
  updateUserData: (data: UserData) => void;
  checkProfile: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user } = usePrivy();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  const checkProfile = async () => {
    try {
      const storedData = localStorage.getItem('webUserData');
      if (storedData) {
        const parsedData = JSON.parse(storedData);
        setUserData(parsedData);
        console.log('user web data', parsedData);

        // Check if profile is complete
        if (!parsedData.socialInfo?.name || !parsedData.socialInfo?.email) {
          router.push('/onboarding/profile');
        }
      } else {
        // If no stored data, try to fetch from server using Privy user ID
        console.log('user', user);
        if (user?.id) {
          const result = await getUserByPrivyId(user.id);
          if (result.success && result.user) {
            const user = result.user as UserData;
            localStorage.setItem('webUserData', JSON.stringify(user));
            setUserData(user);
            console.log('user web data', user);
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

  useEffect(() => {
    checkProfile();
  }, []);

  const updateUserData = (newData: UserData) => {
    localStorage.setItem('webUserData', JSON.stringify(newData));
    setUserData(newData);
  };

  return (
    <UserContext.Provider value={{ userData, loading, updateUserData, checkProfile }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
} 