"use server";

import db from '../../../firebase/firebase';
import { Campaign, CampaignStatus } from '@/app/utils/interfaces';
import { notifyCampaignCreated, sendPurchaseEmail } from '@/services/notificationService';
import { v4 as uuidv4 } from 'uuid';

interface CreateCampaignData {
  userId: string;
  email: string;
  name: string;
  projectDetails: {
    description: string;
    roadmap?: string;
    tvl?: string;
    mau?: string;
    goals?: string;
    cta?: string;
    targetAudience?: string;
  };
  selectedDuration: {
    value: string;
    price: number;
  };
  selectedTasks: Array<{
    id: string;
    link: string;
    options?: string[];
  }>;
  customTasks: Array<{
    description: string;
    link: string;
  }>;
  weeklyTasks?: Record<number, { selectedTasks: any[]; customTasks: any[] }>;
  weeklyStatus?: Record<number, 'pending' | 'started' | 'completed'>;
  selectedKolPackage: string | null;
  kolDetails?: {
    goals: string;
    cta: string;
    targetAudience: string;
  };
  selectedRewardType: string | null;
  rewardPool: string;
  numberOfWinners: string;
  selectedDistributionType: string | null;
  rewardCriteria: string;
  tokenContract: string;
  tokenTicker: string;
  selectedAddons: string[];
  totalPrice: number;
  paymentHash: string;
  telegramHandle: string;
}

export async function createCampaign(data: CreateCampaignData) {
  try {
    // Ensure all task options are properly initialized
    const tasks = data.selectedTasks.map(task => ({
      ...task,
      options: task.options || [] // Initialize empty array if options is undefined
    }));

    // Clean up undefined values for Firestore
    const cleanWeeklyTasks = data.weeklyTasks ? Object.fromEntries(
      Object.entries(data.weeklyTasks).map(([week, weekData]) => [
        week,
        {
          selectedTasks: weekData.selectedTasks || [],
          customTasks: weekData.customTasks || []
        }
      ])
    ) : null;

    // Generate title from date and time if no project description
    const generateTitle = () => {
      if (data.projectDetails?.description) {
        return data.projectDetails.description;
      }
      if (data.projectDetails?.goals) {
        return data.projectDetails.goals;
      }
      const date = new Date();
      const formattedDate = date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      return `Campaign ${formattedDate}`;
    };

    const campaignData = {
      userId: data.userId,
      email: data.email,
      name: data.name,
      title: generateTitle(),
      projectDetails: data.projectDetails,
      duration: data.selectedDuration,
      tasks: tasks,
      customTasks: data.customTasks,
      weeklyTasks: cleanWeeklyTasks,
      weeklyStatus: data.selectedDuration.value === '1month' ? {
        1: 'pending',
        2: 'pending',
        3: 'pending',
        4: 'pending'
      } : null,
      kolPackage: data.selectedKolPackage,
      kolDetails: data.kolDetails || {},
      rewardType: data.selectedRewardType,
      rewardPool: data.rewardPool,
      numberOfWinners: data.numberOfWinners,
      distributionType: data.selectedDistributionType,
      rewardCriteria: data.rewardCriteria,
      tokenContract: data.tokenContract,
      tokenTicker: data.tokenTicker,
      addons: data.selectedAddons,
      totalPrice: data.totalPrice,
      paymentHash: data.paymentHash,
      telegramHandle: data.telegramHandle,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // Remove any remaining undefined values
    const cleanCampaignData = Object.fromEntries(
      Object.entries(campaignData).filter(([_, value]) => value !== undefined)
    );

    const campaignRef = await db.collection('campaigns').add(cleanCampaignData);

    // Send purchase email notification only for manual payments to avoid duplicates
    if (data.paymentHash === 'manual_payment_pending') {
      await sendPurchaseEmail({
        userId: data.userId,
        email: data.email,
        name: data.name,
        serviceType: 'advertise',
        amount: data.totalPrice.toString(),
        currency: 'USDT',
        network: 'taraxa',
        transactionHash: data.paymentHash
      });
    }

    return { success: true, campaignId: campaignRef.id };
  } catch (error) {
    console.error('Error creating campaign:', error);
    return { success: false, error: 'Failed to create campaign' };
  }
}

export async function fetchAdvertiseCampaigns(userId: string) {
  try {
    const snapshot = await db.collection('campaigns')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();
    const campaigns = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
    return { success: true, campaigns };
  } catch (error) {
    console.error('Error fetching advertise campaigns:', error);
    return { success: false, error: 'Failed to fetch campaigns' };
  }
}

export async function updateCampaignTasks(campaignId: string, weeklyTasks: Record<number, { selectedTasks: any[]; customTasks: any[] }>) {
  try {
    // Get the campaign to check if it can be edited
    const campaignDoc = await db.collection('campaigns').doc(campaignId).get();
    if (!campaignDoc.exists) {
      return { success: false, error: 'Campaign not found' };
    }

    const campaignData = campaignDoc.data();
    if (!campaignData) {
      return { success: false, error: 'Campaign data not found' };
    }

    // Check if campaign is within 7 days of creation and status is pending
    const createdAt = new Date(campaignData.createdAt);
    const now = new Date();
    const daysDiff = (now.getTime() - createdAt.getTime()) / (1000 * 3600 * 24);
    
    if (daysDiff > 7) {
      return { success: false, error: 'Campaign can only be edited within 7 days of creation' };
    }

    if (campaignData.status !== 'pending') {
      return { success: false, error: 'Campaign can only be edited when status is pending' };
    }

    // Update the campaign with new weekly tasks
    await db.collection('campaigns').doc(campaignId).update({
      weeklyTasks,
      updatedAt: Date.now()
    });

    return { success: true };
  } catch (error) {
    console.error('Error updating campaign tasks:', error);
    return { success: false, error: 'Failed to update campaign tasks' };
  }
}

export async function updateWeeklyCampaignTasks(campaignId: string, tasks: any[], customTasks: any[]) {
  try {
    // Get the campaign to check if it can be edited
    const campaignDoc = await db.collection('campaigns').doc(campaignId).get();
    if (!campaignDoc.exists) {
      return { success: false, error: 'Campaign not found' };
    }

    const campaignData = campaignDoc.data();
    if (!campaignData) {
      return { success: false, error: 'Campaign data not found' };
    }

    // Check if campaign is within 7 days of creation and status is pending
    const createdAt = new Date(campaignData.createdAt);
    const now = new Date();
    const daysDiff = (now.getTime() - createdAt.getTime()) / (1000 * 3600 * 24);
    
    if (daysDiff > 7) {
      return { success: false, error: 'Campaign can only be edited within 7 days of creation' };
    }

    if (campaignData.status !== 'pending') {
      return { success: false, error: 'Campaign can only be edited when status is pending' };
    }

    // Update the campaign with new tasks and custom tasks
    await db.collection('campaigns').doc(campaignId).update({
      tasks,
      customTasks,
      updatedAt: Date.now()
    });

    return { success: true };
  } catch (error) {
    console.error('Error updating weekly campaign tasks:', error);
    return { success: false, error: 'Failed to update weekly campaign tasks' };
  }
}

export async function updateCampaignTitle(campaignId: string, title: string) {
  try {
    // Get the campaign to check if it exists
    const campaignDoc = await db.collection('campaigns').doc(campaignId).get();
    if (!campaignDoc.exists) {
      return { success: false, error: 'Campaign not found' };
    }

    // Update the campaign title
    await db.collection('campaigns').doc(campaignId).update({
      title,
      updatedAt: Date.now()
    });

    return { success: true };
  } catch (error) {
    console.error('Error updating campaign title:', error);
    return { success: false, error: 'Failed to update campaign title' };
  }
}

export async function updateWeeklyStatus(campaignId: string, week: number, status: 'pending' | 'started' | 'completed') {
  try {
    // Get the campaign to check if it exists
    const campaignDoc = await db.collection('campaigns').doc(campaignId).get();
    if (!campaignDoc.exists) {
      return { success: false, error: 'Campaign not found' };
    }

    const campaignData = campaignDoc.data();
    if (!campaignData) {
      return { success: false, error: 'Campaign data not found' };
    }

    // Check if it's a 1-month campaign
    if (campaignData.duration?.value !== '1month') {
      return { success: false, error: 'Weekly status can only be updated for 1-month campaigns' };
    }

    // Check if week is valid (1-4)
    if (week < 1 || week > 4) {
      return { success: false, error: 'Invalid week number. Must be between 1 and 4' };
    }

    // Update the weekly status
    const weeklyStatus = campaignData.weeklyStatus || {
      1: 'pending',
      2: 'pending',
      3: 'pending',
      4: 'pending'
    };

    weeklyStatus[week] = status;

    await db.collection('campaigns').doc(campaignId).update({
      weeklyStatus,
      updatedAt: Date.now()
    });

    return { success: true };
  } catch (error) {
    console.error('Error updating weekly status:', error);
    return { success: false, error: 'Failed to update weekly status' };
  }
}