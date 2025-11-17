"use server"
import db from '@/firebase/firebase';
import { v4 as uuidv4 } from 'uuid';
import { messageNotification, sendPurchaseEmail } from '@/services/notificationService';
import { getUserByPrivyId } from '../users/users';

interface CreatorAccessData {
  privyId: string;
  userId: string;
  amount: number;
  currency: string;
  transactionHash: string;
  timestamp: number;
  network: string;
  telegramHandle?: string;
}

export interface UserData {
  id: string;
  email?: string;
  socialInfo?: {
    email?: string;
    name?: string;
  };
}

const ADMIN_MESSAGE_NEW_CREATOR_ACCESS = (privyId: string, userId: string, amount: number, currency: string, network: string, transactionHash: string, telegramHandle?: string) => 
  `👑 New Creator Access Request!<br><br>User ID: ${userId}<br>Amount: ${amount} ${currency}<br>Network: ${network}<br>Transaction: ${transactionHash}${telegramHandle ? `<br>Telegram: ${telegramHandle}` : ''}<br><br>${transactionHash === 'manual_payment_pending' ? 'Manual payment - please send payment details via Telegram.' : 'Please verify the transaction.'}`;

export async function grantCreatorAccess(data: CreatorAccessData) {
  try {
    const accessId = uuidv4();
    
    const accessRecord = {
      id: accessId,
      privyId: data.privyId,
      userId: data.userId,
      amount: data.amount,
      currency: data.currency,
      network: data.network,
      transactionHash: data.transactionHash,
      startDate: data.timestamp,
      status: data.transactionHash === 'manual_payment_pending' ? 'pending' : 'active',
      type: 'creator_access',
      telegramHandle: data.telegramHandle
    };

    // First, get user data to ensure we have the correct email and name
    const userResult = await getUserByPrivyId(data.privyId);
    if (!userResult.success || !userResult.user) {
      throw new Error('Failed to fetch user data');
    }

    const userData = userResult.user as UserData;
    const email = userData.socialInfo?.email || userData.email;
    const name = userData.socialInfo?.name || 'Creator';

    if (!email) {
      throw new Error('User email not found');
    }

    // Create the access record first
    await db.collection('creatorAccess').doc(accessId).set(accessRecord);

    // Send notification to admin
    const adminMessage = ADMIN_MESSAGE_NEW_CREATOR_ACCESS(
      data.privyId,
      data.userId,
      data.amount,
      data.currency,
      data.network,
      data.transactionHash,
      data.telegramHandle
    );
    await messageNotification(adminMessage, 1574449448);

    // Send purchase email with correct user data
    await sendPurchaseEmail({
      userId: data.userId,
      email: email,
      name: name,
      serviceType: 'creators',
      amount: data.amount.toString(),
      currency: data.currency,
      network: data.network,
      transactionHash: data.transactionHash
    });

    return { success: true, accessId };
  } catch (error) {
    console.error('Error granting creator access:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to grant creator access' };
  }
}

export async function getCreatorAccessByHash(transactionHash: string) {
  try {
    const accessSnapshot = await db.collection('creatorAccess')
      .where('transactionHash', '==', transactionHash)
      .limit(1)
      .get();

    if (accessSnapshot.empty) {
      return { success: false, error: 'Access record not found' };
    }

    const accessDoc = accessSnapshot.docs[0];
    return { 
      success: true, 
      access: {
        id: accessDoc.id,
        ...accessDoc.data()
      }
    };
  } catch (error) {
    console.error('Error fetching creator access:', error);
    return { success: false, error: 'Failed to fetch access record' };
  }
}

export async function isCreatorAccessGranted(privyId: string): Promise<boolean> {
  try {
    const accessSnapshot = await db.collection('creatorAccess')
      .where('privyId', '==', privyId)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    return !accessSnapshot.empty;
  } catch (error) {
    console.error('Error checking creator access:', error);
    return false;
  }
} 