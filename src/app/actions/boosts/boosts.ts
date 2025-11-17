'use server';

import db from '../../../firebase/firebase';
import { messageNotification, sendPurchaseEmail } from '@/services/notificationService';
import { getUserByPrivyId } from '../users/users';

export type BoostStatus = 'pending' | 'paid' | 'failed' | 'completed';

export interface CreateBoostParams {
  postLink: string;
  userId: string;
  amount: number;
  currency: 'USDT';
  status: BoostStatus;
  paymentHash?: string;
  email?: string;
  name?: string;
}

export interface BoostHistory {
  id: string;
  postLink: string;
  amount: number;
  currency: 'USDT';
  status: BoostStatus;
  paymentHash?: string;
  createdAt: string;
  updatedAt: string;
}

export async function getBoostHistory(userId: string) {
  try {
    const snapshot = await db.collection('boosts')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const boosts = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as BoostHistory[];

    return { success: true, boosts };
  } catch (error) {
    console.error('Error fetching boost history:', error);
    return { success: false, error: 'Failed to fetch boost history' };
  }
}

const ADMIN_MESSAGE_NEW_BOOST = (postLink: string, amount: number, currency: string) => 
  `🎯 New Boost Request!\n\nPost: ${postLink}\nAmount: ${amount} ${currency}\n\nPlease review and process.`;

export async function createBoost(params: CreateBoostParams) {
  try {
    console.log('Creating boost with params:', params);
    
    if (!db) {
      throw new Error('Firebase database not initialized');
    }

    const boostData = {
      postLink: params.postLink,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      paymentStatus: params.status,
      processingStatus: 'pending',
      paymentHash: params.paymentHash || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    console.log('Attempting to add boost:', boostData);
    const boostRef = await db.collection('boosts').add(boostData);
    console.log('Boost created with ID:', boostRef.id);

    const boostDoc = await boostRef.get();
    const boost = { id: boostRef.id, ...boostDoc.data() };
    console.log('Retrieved boost:', boost);

    // Send notification to admin
    const adminMessage = ADMIN_MESSAGE_NEW_BOOST(params.postLink, params.amount, params.currency);
    await messageNotification(adminMessage.replace(/\n/g, '<br>'), 1574449448);

    return { success: true, boost };
  } catch (error) {
    console.error('Detailed error creating boost:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create boost' };
  }
}

export async function deleteBoost(id: string) {
  try {
    await db.collection('boosts').doc(id).delete();
    return { success: true };
  } catch (error) { 
    console.error('Error deleting boost:', error);
    return { success: false, error: 'Failed to delete boost' };
  }
}


export async function updateBoostStatus(id: string, status: BoostStatus, paymentHash?: string) {
  try {
    const updateData: any = {
      status,
      updatedAt: new Date().toISOString()
    };
    
    if (paymentHash) {
      updateData.paymentHash = paymentHash;
    }

    await db.collection('boosts').doc(id).update(updateData);
    
    const boostDoc = await db.collection('boosts').doc(id).get();
    const boostData = boostDoc.data() as {
      userId: string;
      amount: number;
      currency: string;
      postLink: string;
    };
    const boost = { id: boostDoc.id, ...boostData };

    // Send email only when status is updated to 'paid'
    if (status === 'paid' && paymentHash) {
      const userResult = await getUserByPrivyId(boost.userId);
      if (userResult.success && userResult.user) {
        const userData = userResult.user as UserData;
        const email = userData.socialInfo?.email || userData.email;
        const name = userData.socialInfo?.name || userData.name || 'User';

        if (email) {
          await sendPurchaseEmail({
            userId: boost.userId,
            email,
            name,
            serviceType: 'boost',
            amount: boost.amount.toString(),
            currency: boost.currency,
            network: 'USDT',
            postLink: boost.postLink,
            transactionHash: paymentHash
          });
        }
      }
    }
    
    return { success: true, boost };
  } catch (error) {
    console.error('Error updating boost:', error);
    return { success: false, error: 'Failed to update boost' };
  }
}

export async function getUnreadBoostsCount(userId: string) {
  try {
    const snapshot = await db.collection('boosts')
      .where('userId', '==', userId)
      .where('isRead', '==', false)
      .get();

    return snapshot.size;
  } catch (error) {
    console.error('Error getting unread boosts count:', error);
    return 0;
  }
}

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

interface BoostParams {
  userId: string;
  postLink: string;
  amount: string;
  currency: string;
}

interface PurchaseEmailParams {
  userId: string;
  email: string;
  name: string;
  serviceType: string;
  amount: string;
  currency: string;
  network: string;
  postLink: string;
}

export async function purchaseBoost(params: BoostParams) {
  try {
    // Get user data from database
    const userResult = await getUserByPrivyId(params.userId);
    if (!userResult.success || !userResult.user) {
      throw new Error('Failed to fetch user data');
    }

    const userData = userResult.user as UserData;
    const userEmail = userData.socialInfo?.email || userData.email;
    const userName = userData.socialInfo?.name || userData.name || 'User';

    if (!userEmail) {
      throw new Error('User email not found');
    }

    // Send purchase email
    await sendPurchaseEmail({
      userId: params.userId,
      email: userEmail,
      name: userName,
      serviceType: 'boost',
      amount: params.amount,
      currency: params.currency,
      network: 'USDT',
      postLink: params.postLink
    });

    return { success: true };
  } catch (error) {
    console.error('Error purchasing boost:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to purchase boost' 
    };
  }
}

export interface Transaction {
  userId: string;
  amount: number;
  currency: 'USDT';
  postLink: string;
  transactionHash?: string;
}

export async function createBoostFromTransaction(transaction: Transaction) {
  try {
    const userResult = await getUserByPrivyId(transaction.userId);
    if (!userResult.success || !userResult.user) {
      throw new Error('Failed to fetch user data');
    }

    const userData = userResult.user as UserData;
    const email = userData.socialInfo?.email || userData.email;
    const name = userData.socialInfo?.name || userData.name || 'User';

    if (!email) {
      throw new Error('User email not found');
    }

    // Send purchase email
    await sendPurchaseEmail({
      userId: transaction.userId,
      email,
      name,
      serviceType: 'boost',
      amount: transaction.amount.toString(),
      currency: transaction.currency,
      network: 'USDT',
      postLink: transaction.postLink,
      transactionHash: transaction.transactionHash
    });

    return { success: true };
  } catch (error) {
    console.error('Error creating boost from transaction:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to create boost from transaction' 
    };
  }
} 