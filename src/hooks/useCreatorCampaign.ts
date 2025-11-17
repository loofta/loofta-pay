import { useState, useCallback, useEffect } from 'react';
import * as campaignActions from '../app/actions/campaigns/creatorsCampaign';
import {  CreatorCampaign } from '@/app/utils/interfaces';
import { useTelegramUser } from '@/context/TelegramUserContext';
import { createCampaign as firebaseCreateCampaign, getActiveCampaign } from '@/app/actions/campaigns/creatorsCampaign';

const CAMPAIGN_CACHE_KEY = 'creatorCampaignCache';

interface CampaignCache {
  campaign: CreatorCampaign | null;
  timestamp: number;
  userId: string;
}

const useCampaigns = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { userData } = useTelegramUser();
  const currentTgUsername = userData?.username?.toLowerCase() || '';
  const [activeCampaign, setActiveCampaign] = useState<CreatorCampaign | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const fetchAllCampaigns = useCallback(async (currentTgUsername: string) => {
    setLoading(true);
    setError(null);
    try {
      const result: { success: boolean; campaigns?: CreatorCampaign[]; error?: string } = await campaignActions.fetchAllCampaigns(currentTgUsername);
      setLoading(false);
      return result.campaigns || [];
    } catch (err) {
      setError('Failed to fetch campaigns');
      setLoading(false);
      return [];
    }
  }, []);

  const fetchOngoingCampaigns = useCallback(async (currentTgUsername: string) => {
    setLoading(true);
    setError(null);
    try {
      const campaigns = await campaignActions.fetchOngoingCampaigns(currentTgUsername);
      setLoading(false);
      return campaigns;
    } catch (err) {
      setError('Failed to fetch ongoing campaigns');
      setLoading(false);
      return [];
    }
  }, []);

  const fetchPastCampaigns = useCallback(async (currentTgUsername: string) => {
    setLoading(true);
    setError(null);
    try {
      const campaigns = await campaignActions.fetchPastCampaigns(currentTgUsername);
      setLoading(false);
      return campaigns;
    } catch (err) {
      setError('Failed to fetch past campaigns');
      setLoading(false);
      return [];
    }
  }, []);

  const getCampaignById = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const campaign = await campaignActions.getCampaignById(id);
      setLoading(false);
      return campaign;
    } catch (err) {
      setError('Failed to fetch campaign');
      setLoading(false);
      return null;
    }
  }, []);

  const createCampaign = useCallback(async (campaignData: Omit<CreatorCampaign, 'id'>) => {
    setLoading(true);
    setError(null);
    try {
      const newCampaign = await campaignActions.createCampaign(campaignData as CreatorCampaign);
      setLoading(false);
      return newCampaign;
    } catch (err) {
      setError('Failed to create campaign');
      setLoading(false);
      return null;
    }
  }, []);

  const deleteCampaign = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      await campaignActions.deleteCampaign(id);
      setLoading(false);
      return true;
    } catch (err) {
      setError('Failed to delete campaign');
      setLoading(false);
      return false;
    }
  }, []);

  useEffect(() => {
    const fetchAndCacheActiveCampaign = async () => {
      if (!userData?.id) return;
      
      setIsLoading(true);
      
      // Check cache first
      const cached = localStorage.getItem(CAMPAIGN_CACHE_KEY);
      if (cached) {
        const { campaign, timestamp, userId }: CampaignCache = JSON.parse(cached);
        // Cache valid for 5 minutes and same user
        if (Date.now() - timestamp < 5 * 60 * 1000 && userId === userData.id.toString()) {
          setActiveCampaign(campaign);
          setIsLoading(false);
          return;
        }
      }

      // Fetch from DB if cache invalid
      const result = await getActiveCampaign(userData.id.toString());
      if (result.success) {
        // Update cache
        const cacheData: CampaignCache = {
          campaign: result.campaign,
          timestamp: Date.now(),
          userId: userData.id.toString()
        };
        localStorage.setItem(CAMPAIGN_CACHE_KEY, JSON.stringify(cacheData));
        setActiveCampaign(result.campaign);
      }
      setIsLoading(false);
    };

    fetchAndCacheActiveCampaign();
  }, [userData?.id]);

  const startNewCampaign = async (itemId: string, paymentType: 'points' | 'usdt', amount: number) => {
    if (!userData?.id) return { success: false, error: 'User not found' };

    const newCampaign: CreatorCampaign = {
      id: crypto.randomUUID(),
      itemId,
      userId: userData.id.toString(),
      status: 'pending',
      createdAt: new Date().toISOString(),
      paymentType,
      pointsSpent: paymentType === 'points' ? amount : 0,
      usdtSpent: paymentType === 'usdt' ? amount : 0,
      creatorsRewarded: 0
    };

    const result = await firebaseCreateCampaign(newCampaign);
    if (result.success) {
      // Update cache with new campaign
      const cacheData: CampaignCache = {
        campaign: newCampaign,
        timestamp: Date.now(),
        userId: userData.id.toString()
      };
      localStorage.setItem(CAMPAIGN_CACHE_KEY, JSON.stringify(cacheData));
      setActiveCampaign(newCampaign);
    }
    return result;
  };

  return {
    loading,
    error,
    fetchAllCampaigns,
    fetchOngoingCampaigns,
    fetchPastCampaigns,
    getCampaignById,
    createCampaign,
    deleteCampaign,
    activeCampaign,
    isLoading,
    startNewCampaign
  };
};

export default useCampaigns;
