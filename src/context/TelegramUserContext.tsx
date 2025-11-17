"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
} from "react";
import { ITelegramUserData } from "@/app/utils/interfaces";
import {
  getFreelancerByTelegramData,
  updateFreelancerTelegramId,
} from "@/app/actions/freelancers/freelancers";
import { toast } from "@/components/ui/use-toast";
import { useRouter } from "next/navigation";
import LoadingScreen from "@/components/LoadingScreen";

interface TelegramUserContextProps {
  userData: ITelegramUserData | null;
  setUserData: (user: ITelegramUserData | null) => void;
}

const TelegramUserContext = createContext<TelegramUserContextProps | undefined>(
  undefined
);

export const useTelegramUser = () => {
  const context = useContext(TelegramUserContext);
  if (context === undefined) {
    throw new Error("useTelegramUser must be used within a TelegramUserProvider");
  }
  return context;
};

// Helper for accessing storage (Telegram or localStorage)
const getFromStorage = (key: string): string | null => {
  try {
    return (
      window.Telegram?.WebApp?.storage?.getItem(key) || localStorage.getItem(key)
    );
  } catch {
    console.warn(`Failed to access storage for key: ${key}`);
    return null;
  }
};

// Helper for setting storage (Telegram and localStorage)
const setToStorage = (key: string, value: string): void => {
  try {
    window.Telegram?.WebApp?.storage?.setItem(key, value);
    localStorage.setItem(key, value);
  } catch {
    console.warn(`Failed to set storage for key: ${key}`);
  }
};

export function TelegramUserProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [userData, setUserData] = useState<ITelegramUserData | null>(null);
  const [profile, setProfile] = useState<string | null>(null);
  const [freelancerProfile, setFreelancerProfile] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true); // Track loading state

  const fetchFreelancerAndUpdateTelegramId = useCallback(
    async (telegramUser: ITelegramUserData) => {
      if (!telegramUser.username) {
        console.log("No username available for Telegram user");
        return;
      }

      try {
        // Get freelancer by telegramId
        const freelancer = await getFreelancerByTelegramData(
          telegramUser.id,
          telegramUser.username.toLowerCase() // Pass normalized username
        );

        if (freelancer) {
          // Always store normalized username in storage
          const normalizedFreelancer = {
            ...freelancer,
            telegramHandle: freelancer.telegramHandle.toLowerCase()
          };

          setToStorage("freelancerProfile", JSON.stringify(normalizedFreelancer));

          // Update telegramId if missing
          if (!freelancer.telegramId) {
            await updateFreelancerTelegramId(freelancer.id, telegramUser.id);
            console.log(`Updated freelancer ${freelancer.fullName}'s telegramId to ${telegramUser.id}`);
          }
        }
      } catch (error) {
        console.error("Error updating freelancer data:", error);
      }
    },
    []
  );

  useEffect(() => {
    const initUser = async () => {
      if (typeof window === "undefined") return;

      const storedProfile = getFromStorage("profile");
      const storedFreelancerProfile = getFromStorage("freelancerProfile");
      const storedUserData = getFromStorage("userData");

      if (storedProfile) setProfile(storedProfile);
      if (storedFreelancerProfile) setFreelancerProfile(JSON.parse(storedFreelancerProfile));
      if (storedUserData) setUserData(JSON.parse(storedUserData));

      // Wait for Telegram WebApp to load data
      const telegramUser = window.Telegram?.WebApp?.initDataUnsafe?.user as ITelegramUserData;

      if (telegramUser) {
        console.log("Telegram user data:", telegramUser);
        setUserData(telegramUser);
        setToStorage("userData", JSON.stringify(telegramUser));
        fetchFreelancerAndUpdateTelegramId(telegramUser);
        setLoading(false);
      } else if (process.env.NODE_ENV === "development") {
        const mockUserData: ITelegramUserData = {
          id: 7815070412,
          username: "looftaXYz",
          first_name: "Loofta",
          last_name: "",
        };
        setUserData(mockUserData);
        setToStorage("userData", JSON.stringify(mockUserData));
        fetchFreelancerAndUpdateTelegramId(mockUserData);
        setLoading(false);
      } else {
        toast({
          title: "No Telegram user data available",
          description: "Please connect your Telegram account to use this app.",
        });
        setLoading(false); // Stop loading after showing the toast
        router.push("/login");
      }
    };

    initUser();
  }, [fetchFreelancerAndUpdateTelegramId, router]);

  if (loading) {
    return <LoadingScreen text="Loading..." isVisible />; // Show a loading state
  }

  return (
    <TelegramUserContext.Provider value={{ userData, setUserData }}>
      {children}
    </TelegramUserContext.Provider>
  );
}
