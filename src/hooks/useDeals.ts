import { useState, useEffect } from 'react';
import { 
    getOngoingDeals, 
    getOngoingReceivedDeals, 
    getPastDeals, 
    getPastReceivedDeals, 
    getTotalSpent 
} from "@/app/actions/deals/deals";
import { IOngoingDealCardProps, IPastDealCardProps } from "@/app/utils/interfaces";
import { useTelegramUser } from '@/context/TelegramUserContext';

export function useDeals() {
    const { userData } = useTelegramUser(); // Use Telegram User Context to get userData
    const [ongoingDeals, setOngoingDeals] = useState<IOngoingDealCardProps[] | null>(null);
    const [ongoingReceivedDeals, setOngoingReceivedDeals] = useState<IOngoingDealCardProps[] | null>(null);
    const [pastDeals, setPastDeals] = useState<IPastDealCardProps[] | null>(null);
    const [pastReceivedDeals, setPastReceivedDeals] = useState<IPastDealCardProps[] | null>(null);
    const [totalSpent, setTotalSpent] = useState<number>(0);
    const [totalEarnPoints, setTotalEarnPoints] = useState<number>(0); // New state to store total earned points
    const [initialLoading, setInitialLoading] = useState(true); // For ongoing deals
    const [remainingLoading, setRemainingLoading] = useState(true); // For past deals and total spent
    const [storedProfile, setStoredProfile] = useState<any>(() => {
        if (typeof window !== 'undefined') {
            return  window.Telegram?.WebApp?.storage?.getItem('profile') || localStorage.getItem('profile')
        }
        return null;
    });
    useEffect(() => {
        const fetchInitialData = async () => {
            if (!userData) return;
            console.log('storedProfile', storedProfile);
            try {
                if (storedProfile === 'client' || !storedProfile) {
                    const dealsObj = await getOngoingDeals(userData.id, userData.username?.toLowerCase() || '');
                    const deals = dealsObj?.deals || [];
                    deals.sort((a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime());
                    setOngoingDeals(deals.length > 0 ? deals : null);
                    localStorage.setItem("ongoingDeals", JSON.stringify(deals));
                    window.Telegram?.WebApp?.storage?.setItem("ongoingDeals", JSON.stringify(deals));
                } else {
                    console.log('userData', userData)
                    const dealsObj = await getOngoingReceivedDeals(userData.id, userData.username?.toLowerCase() || '');
                    const deals = dealsObj?.deals || [];
                
                    deals.sort((a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime());
                    setOngoingReceivedDeals(deals.length > 0 ? deals : null);
                    localStorage.setItem("ongoingReceivedDeals", JSON.stringify(deals));
                    window.Telegram?.WebApp?.storage?.setItem("ongoingReceivedDeals", JSON.stringify(deals));
                 
                }
            } catch (error) {
                console.error("Error fetching ongoing deals: ", error);
            } finally {
                setInitialLoading(false);
            }
        };

        const fetchRemainingData = async () => {
            if (!userData) {
                throw new Error("User data is not available");
            }

            try {
                // Client flow
                if (storedProfile === 'client' || !storedProfile) {
                    const [totalSpentObj, pastDealsObj] = await Promise.all([
                        getTotalSpent(userData.id, userData.username?.toLowerCase() || ''),
                        getPastDeals(userData.id, userData.username?.toLowerCase() || '')
                    ]);

                    // Set total spent
                    if ('totalSpent' in totalSpentObj) {
                        setTotalSpent(Number(totalSpentObj.totalSpent) || 0);
                        localStorage.setItem("totalSpent", JSON.stringify(totalSpentObj.totalSpent));
                        window.Telegram?.WebApp?.storage?.setItem("totalSpent", JSON.stringify(totalSpentObj.totalSpent));
                    }

                    // Process past deals with points calculation
                    const pastDealsWithPoints = (pastDealsObj?.deals || []).map(deal => {
                        let earnedPoints = 5 + (Number(deal.amount) * 0.75);
                        if (Number(deal.amount) > 100) {
                            earnedPoints += 10;
                        } else if (Number(deal.amount) > 50) {
                            earnedPoints += 5;
                        }
                        return { ...deal, earnedPoints: Math.round(earnedPoints) };
                    }).sort((a, b) => new Date(b.expectedDeliveryDate).getTime() - new Date(a.expectedDeliveryDate).getTime());

                    setPastDeals(pastDealsWithPoints.length > 0 ? pastDealsWithPoints : null);
                    setTotalEarnPoints(pastDealsWithPoints.reduce((sum, deal) => sum + deal.earnedPoints, 0));
                    localStorage.setItem("pastDeals", JSON.stringify(pastDealsWithPoints));
                    window.Telegram?.WebApp?.storage?.setItem("pastDeals", JSON.stringify(pastDealsWithPoints));
                } 
                // Provider flow
                else {
                    console.log('provider flow');
                    const pastReceivedDealsObj = await getPastReceivedDeals(userData.id, userData.username?.toLowerCase() || '');
                    const sortedPastReceivedDeals = (pastReceivedDealsObj?.deals || [])
                        .sort((a, b) => new Date(b.expectedDeliveryDate).getTime() - new Date(a.expectedDeliveryDate).getTime());

                    setPastReceivedDeals(sortedPastReceivedDeals.length > 0 ? sortedPastReceivedDeals : null);
                    localStorage.setItem("pastReceivedDeals", JSON.stringify(sortedPastReceivedDeals));
                    window.Telegram?.WebApp?.storage?.setItem("pastReceivedDeals", JSON.stringify(sortedPastReceivedDeals));
                }
            } catch (error) {
                console.error("Error fetching additional deals and total spent: ", error);
            } finally {
                setRemainingLoading(false);
            }
        };

        fetchInitialData();
        fetchRemainingData();
    }, [userData, storedProfile]);

    const loading = initialLoading || remainingLoading;

    return { 
        ongoingDeals, 
        ongoingReceivedDeals, 
        pastDeals, 
        pastReceivedDeals, 
        totalSpent, 
        totalEarnPoints, // Expose total earned points
        loading 
    };
}
