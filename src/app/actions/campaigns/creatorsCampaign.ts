"use server";

import db from '../../../firebase/firebase';
import { CreatorCampaign } from '@/app/utils/interfaces';
import { notifyCampaignCreated } from '@/services/notificationService';
import { v4 as uuidv4 } from 'uuid';

// Add this helper function at the top of the file
const convertToDate = (dateField: any): Date => {
  if (dateField instanceof Date) return dateField;
  if (dateField && typeof dateField.toDate === 'function') return dateField.toDate();
  if (dateField && !isNaN(Date.parse(dateField))) return new Date(dateField);
  return new Date();
};

const convertToISOString = (dateField: any): string => {
  const date = convertToDate(dateField);
  return date.toISOString();
};



export const fetchAllCampaigns = async (currentTgUsername: string): Promise<{ success: boolean; campaigns?: CreatorCampaign[]; error?: string }> => {

  try {
    const campaignsSnapshot = await db.collection('creatorsCampaigns').where('creatorTgHandle', '==', currentTgUsername).get();
    const campaigns = campaignsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        title: data.title || '', // Add this line
        creationDate: convertToISOString(data.creationDate),
        startDate: convertToISOString(data.startDate),
        campaignId: data.campaignId || '',
        description: data.description || '',
        contributorsTgHandles: data.contributorsTgHandles || [],
        creatorTgHandle: data.creatorTgHandle || '',
        paymentStatus: data.paymentStatus || 'pending',
        package: data.package || {},
        linkToPromote: data.linkToPromote || '',
        campaignStatus: data.campaignStatus || 'draft',
        campaignType: data.campaignType || '',
        creatorTgId: data.creatorTgId || undefined
      } as CreatorCampaign;
    });
    return { success: true, campaigns };
  } catch (err) {
    console.error('Error fetching campaigns:', err);
    return { success: false, error: 'Error fetching campaigns' };
  }
};

export const fetchOngoingCampaigns = async (currentTgUsername: string): Promise<{ success: boolean; campaigns?: CreatorCampaign[]; error?: string }> => {
  try {
    const ongoingSnapshot = await db.collection('creatorsCampaigns').where('status', '==', 'ongoing').where('creatorTgHandle', '==', currentTgUsername).get();
    const campaigns = ongoingSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        title: data.title || '', // Add this line
        creationDate: convertToISOString(data.creationDate),
        campaignId: data.campaignId || '',
        description: data.description || '',
        contributorsTgHandles: data.contributorsTgHandles || [],
        creatorTgHandle: data.creatorTgHandle || '',
        paymentStatus: data.paymentStatus || 'pending',
        startDate: convertToISOString(data.startDate),
        package: data.package || {},
        campaignStatus: data.campaignStatus || 'draft',
        campaignType: data.campaignType || '',
        linkToPromote: data.linkToPromote || '',
        creatorTgId: data.creatorTgId || undefined
      } as CreatorCampaign;
    });
    return { success: true, campaigns };
  } catch (err) {
    console.error('Error fetching ongoing campaigns:', err);
    return { success: false, error: 'Error fetching ongoing campaigns' };
  }
};

export const fetchPastCampaigns = async (currentTgUsername: string): Promise<{ success: boolean; campaigns?: CreatorCampaign[]; error?: string }> => {
  try {
    const pastSnapshot = await db.collection('creatorsCampaigns').where('status', '==', 'past').where('creatorTgHandle', '==', currentTgUsername).get();
    const campaigns = pastSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        title: data.title || '', // Add this line
        creationDate: convertToISOString(data.creationDate),
        campaignId: data.campaignId || '',
        description: data.description || '',
        contributorsTgHandles: data.contributorsTgHandles || [],
        creatorTgHandle: data.creatorTgHandle || '',
        creatorTgId: data.creatorTgId || undefined,
        paymentStatus: data.paymentStatus || 'pending',
        startDate: convertToISOString(data.startDate),
        package: data.package || {},
        campaignStatus: data.campaignStatus || 'draft',
        campaignType: data.campaignType || '',
        linkToPromote: data.linkToPromote || ''
      } as CreatorCampaign;
    });
    return { success: true, campaigns };
  } catch (err) {
    console.error('Error fetching past campaigns:', err);
    return { success: false, error: 'Error fetching past campaigns' };
  }
};

export const getCampaignById = async (id: string): Promise<{ success: boolean; campaign?: CreatorCampaign; error?: string }> => {
  try {
    const campaignDoc = await db.collection('creatorsCampaigns').doc(id).get();
    if (!campaignDoc.exists) {
      return { success: false, error: 'Campaign not found' };
    }
    const data = campaignDoc.data();
    const campaign: CreatorCampaign = {
      id: campaignDoc.id,
      ...data,
      title: data?.title || '',
      creationDate: convertToISOString(data?.creationDate),
      campaignId: data?.campaignId || '',
      description: data?.description || '',
      contributorsTgHandles: data?.contributorsTgHandles || [],
      creatorTgHandle: data?.creatorTgHandle || '',
      creatorTgId: data?.creatorTgId || undefined,
      paymentStatus: data?.paymentStatus || 'pending',
      startDate: convertToISOString(data?.startDate),
      package: data?.package || {},
      campaignStatus: data?.campaignStatus || 'draft',
      campaignType: data?.campaignType || '',
      linkToPromote: data?.linkToPromote || ''
    };
    return { success: true, campaign };
  } catch (err) {
    console.error('Error viewing campaign:', err);
    return { success: false, error: 'Error viewing campaign' };
  }
};

export const createCampaign = async (campaign: CreatorCampaign): Promise<{ success: boolean; campaign?: CreatorCampaign; error?: string }> => {
  try {
    await db.collection('creatorsCampaigns').doc(campaign.id).set({
      ...campaign,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // Notify if it's a store campaign
    if (campaign.userId) {
      await notifyCampaignCreated(campaign.id, parseInt(campaign.userId));
    }

    return { success: true, campaign };
  } catch (error) {
    console.error('Error creating campaign:', error);
    return { success: false, error: 'Failed to create campaign' };
  }
};

export const deleteCampaign = async (id: string): Promise<{ success: boolean; error?: string }> => {
  try {
    await db.collection('creatorsCampaigns').doc(id).delete();
    return { success: true };
  } catch (err) {
    console.error('Error deleting campaign:', err);
    return { success: false, error: 'Error deleting campaign' };
  }
};

export async function getActiveCampaign(userId: string): Promise<{ success: boolean; campaign: CreatorCampaign | null; error?: string }> {
  try {
    const snapshot = await db.collection('creatorsCampaigns')
      .where('userId', '==', userId)
      .where('status', 'in', ['pending', 'processing'])
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return { success: true, campaign: null };
    }

    const campaign = {
      id: snapshot.docs[0].id,
      ...snapshot.docs[0].data()
    } as CreatorCampaign;

    return { success: true, campaign };
  } catch (error) {
    console.error('Error getting active campaign:', error);
    return { success: false, campaign: null, error: 'Failed to get active campaign' };
  }
}
