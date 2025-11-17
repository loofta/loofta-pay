"use server"

import { GIVEAWAY__FEE } from '@/lib/utils';
import db from '../../../firebase/firebase';
import { v4 as uuidv4 } from 'uuid';
import { sendPurchaseEmail } from '@/services/notificationService';
import { getUserByPrivyId } from '../users/users';

interface UserData {
  id: string;
  name?: string;
  email?: string;
  socialInfo?: {
    name?: string;
    email?: string;
    twitter?: string;
    telegram?: string;
    website?: string;
    github?: string;
    bio?: string;
  };
}

interface Task {
  type: 'follow' | 'telegram' | 'discord' | 'medium' | 'youtube' | 'boost';
  link: string;
  subType: string;
  commentRequirement?: string;
  actions?: {
    like?: boolean;
    retweet?: boolean;
    comment?: boolean;
  };
}

interface CreateGiveawayData {
  amount: number;
  numberOfWinners: number;
  description: string;
  endDate: Date | string;
  tasks: Task[];
  creatorId: number;
  creatorUsername: string;
  walletAddress: string;
  paymentHash?: string;
  privyUserId: string;
  status?: 'pending' | 'active' | 'completed' | 'rejected';
}

interface GiveawayData {
  id: string;
  dateCreated: number;
  [key: string]: any;
}

export async function createGiveaway(data: CreateGiveawayData) {
  try {
    const giveawayRef = db.collection('giveaways').doc();
    const giveawayId = giveawayRef.id;

    // Convert endDate to proper Date object if it's a string
    const endDate = typeof data.endDate === 'string' 
      ? new Date(data.endDate.replace('$D', ''))
      : data.endDate;

    const now = new Date();
    const giveawayData = {
      ...data,
      id: giveawayId,
      endDate: endDate.toISOString(), // Store as ISO string
      createdAt: now.toISOString(),
      dateCreated: now.getTime(), // Add timestamp for history page
      updatedAt: now.toISOString(),
      status: 'pending',
      tasks: data.tasks.map(task => ({
        type: task.type,
        link: task.link,
        subType: task.subType,
        ...(task.commentRequirement ? { commentRequirement: task.commentRequirement } : {}),
        ...(task.actions ? { actions: task.actions } : {})
      }))
    };

    await giveawayRef.set(giveawayData);
    return { success: true, giveawayId };
  } catch (error) {
    console.error('Error creating giveaway:', error);
    return { success: false, error: 'Failed to create giveaway' };
  }
}

export async function getGiveawayById(giveawayId: string) {
  try {
    const giveaway = await db.collection('giveaways').doc(giveawayId).get();
    if (!giveaway.exists) {
      return null;
    }
    return giveaway.data();
  } catch (error) {
    console.error('Error fetching giveaway:', error);
    return null;
  }
}

export async function updateGiveawayStatus(giveawayId: string, status: 'pending' | 'active' | 'completed' | 'rejected') {
  try {
    await db.collection('giveaways').doc(giveawayId).update({ 
      status, 
      lastUpdated: Date.now() 
    });
    return { success: true };
  } catch (error) {
    console.error('Error updating giveaway status:', error);
    return { success: false, error: 'Failed to update giveaway status' };
  }
}

export async function getGiveaways(privyUserId: string) {
  try {
    const giveawaysSnapshot = await db.collection('giveaways')
      .where('privyUserId', '==', privyUserId)
      .get();

    const giveaways = giveawaysSnapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data()
      } as GiveawayData))
      .sort((a, b) => b.dateCreated - a.dateCreated);

    return { success: true, giveaways };
  } catch (error) {
    console.error('Error fetching giveaways:', error);
    return { success: false, giveaways: [], error: 'Failed to fetch giveaways' };
  }
}

export async function getOngoingGiveaways(privyUserId: string) {
  try {
    const giveawaysSnapshot = await db.collection('giveaways')
      .where('privyUserId', '==', privyUserId)
      .where('status', 'in', ['pending', 'active'])
      .orderBy('dateCreated', 'desc')
      .get();

    const giveaways = giveawaysSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return { success: true, giveaways };
  } catch (error) {
    console.error('Error fetching ongoing giveaways:', error);
    return { success: false, giveaways: [], error: 'Failed to fetch ongoing giveaways' };
  }
}

export async function getPastGiveaways(privyUserId: string) {
  try {
    const giveawaysSnapshot = await db.collection('giveaways')
      .where('privyUserId', '==', privyUserId)
      .where('status', 'in', ['completed', 'rejected'])
      .orderBy('dateCreated', 'desc')
      .get();

    const giveaways = giveawaysSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return { success: true, giveaways };
  } catch (error) {
    console.error('Error fetching past giveaways:', error);
    return { success: false, giveaways: [], error: 'Failed to fetch past giveaways' };
  }
} 