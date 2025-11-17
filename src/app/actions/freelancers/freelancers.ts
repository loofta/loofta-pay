"use server"

import { Freelancer } from '@/app/utils/interfaces';
import db from '../../../firebase/firebase';
import { Timestamp } from 'firebase-admin/firestore';  // Server-side Timestamp

// Add cache implementation at the top
let freelancersCache: {
  data: Freelancer[] | null;
  timestamp: number;
  expiryTime: number;
} = {
  data: null,
  timestamp: 0,
  expiryTime: 5 * 60 * 1000 // Cache expires after 5 minutes
};

// Add cache implementation at the top of the file
interface ReferralCountCache {
  count: number;
  timestamp: number;
  username: string;
}

let referralCountCache: ReferralCountCache = {
  count: 0,
  timestamp: 0,
  username: ''
};

const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Cache for counts
let countCache = {
  count: 0,
  timestamp: 0,
  expiryTime: 5 * 60 * 1000 // 5 minutes
};

// Cache for paginated results
let paginatedCache: {
  [key: string]: {
    data: Freelancer[];
    timestamp: number;
    expiryTime: number;
  };
} = {};

const formatFollowerCount = (count: number): string => {
  if (count >= 1000) {
    return (Math.round(count / 100) / 10) + 'K';
  }
  return count.toString();
};

const convertToFreelancer = async (doc: any): Promise<Freelancer> => {
  const data = doc.data();
  
  // Handle follower count formatting
  let formattedFollowers = data.followersCount || '';
  if (typeof formattedFollowers === 'string' && !formattedFollowers.includes('K')) {
    const numericValue = Number(formattedFollowers);
    if (!isNaN(numericValue) && numericValue >= 1000) {
      formattedFollowers = formatFollowerCount(numericValue);
    }
  } else if (typeof formattedFollowers === 'number' && formattedFollowers >= 1000) {
    formattedFollowers = formatFollowerCount(formattedFollowers);
  }

  return {
    id: doc.id,
    ...data,
    followersCount: formattedFollowers,
    creationDate: data.creationDate instanceof Timestamp ? 
      data.creationDate.toDate().toISOString() 
      : data.creationDate || new Date().toISOString(),
    status: data.status || 'unverified'
  };
};

export async function getAllFreelancers(): Promise<{ success: boolean; freelancers?: Freelancer[]; error?: string }> {
  try {
    // Check if we have valid cached data
    const now = Date.now();
    if (freelancersCache.data && (now - freelancersCache.timestamp) < freelancersCache.expiryTime) {
      return { success: true, freelancers: freelancersCache.data };
    }

    const freelancersSnapshot = await db
      .collection('freelancers')
      .where('status', '!=', 'hidden')
      .get();

    const allFreelancers = await Promise.all(freelancersSnapshot.docs.map(doc => convertToFreelancer(doc)));
    
    // Separate and sort each status group alphabetically
    const platiniumFreelancers = allFreelancers
      .filter(f => f.status === 'platinium')
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    
    const vipFreelancers = allFreelancers
      .filter(f => f.status === 'vip')
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    
    const verifiedFreelancers = allFreelancers
      .filter(f => f.status === 'verified')
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    
    const unverifiedFreelancers = allFreelancers
      .filter(f => f.status === 'unverified')
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    // Combine all groups in the desired order
    const sortedFreelancers = [
      ...platiniumFreelancers,
      ...vipFreelancers,
      ...verifiedFreelancers,
      ...unverifiedFreelancers
    ];

    // Update cache
    freelancersCache = {
      data: sortedFreelancers,
      timestamp: now,
      expiryTime: 5 * 60 * 1000
    };

    return { success: true, freelancers: sortedFreelancers };
  } catch (error) {
    console.error("Error getting all freelancers:", error);
    // If there's an error but we have cached data, return it
    if (freelancersCache.data) {
      return { success: true, freelancers: freelancersCache.data };
    }
    return { success: false, error: 'Error getting all freelancers' };
  }
}

export async function getFreelancerById(id: string): Promise<Freelancer | null> {
  try {
    const freelancerDoc = await db.collection('freelancers').doc(id).get();
    if (freelancerDoc.exists) {
      return convertToFreelancer(freelancerDoc);
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error fetching freelancer:", error);
    throw error;
  }
}

export async function getFreelancerByTelegramData(telegramId: number, telegramHandle?: string): Promise<Freelancer | null> {
  console.log('telegramId', telegramId)
  try {
    const snapshot = await db.collection('freelancers')
      .where('telegramId', '==', telegramId)
      .limit(1)
      .get();
    
    if (!snapshot.empty) { 
      const freelancerDoc = snapshot.docs[0];

      const freelancer = await convertToFreelancer(freelancerDoc);
      if (telegramHandle && freelancer.telegramHandle.toLowerCase() !== telegramHandle.toLowerCase()) {
        await updateFreelancerTelegramHandle(freelancer.id, telegramHandle);
      }
      return freelancer;
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error fetching creator by telegram handle:", error);
    throw error;
  }
}
export async function updateFreelancerTelegramHandle(freelancerId: string, telegramHandle: string): Promise<void> {
  try {
    await db.collection('freelancers').doc(freelancerId).update({
      telegramHandle: telegramHandle
    });
  } catch (error) {
    console.error("Error updating freelancer telegram handle:", error);
    throw error;
  }
}

export const whitelistNewClient = async (userId: number, username: string, walletAddress: string) => {
  try {
    // Check if client is already whitelisted
    const existingClient = await db.collection('whitelistedClients')
      .where('telegramId', '==', userId)
      .limit(1)
      .get();

    if (!existingClient.empty) {
      // Update existing client if needed
      await existingClient.docs[0].ref.update({
        telegramHandle: username,
        walletAddress,
        updatedAt: Timestamp.now()
      });
      return { success: true };
    }

    // Add new client to whitelist
    await db.collection('whitelistedClients').add({
      telegramId: userId,
      telegramHandle: username,
      walletAddress,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    return { success: true };
  } catch (error) {
    console.error("Error whitelisting client:", error);
    return { 
      success: false, 
      error: 'Failed to whitelist client' 
    };
  }
}

export async function isClientWhitelisted(telegramId: number): Promise<boolean> {
  try {
    const snapshot = await db.collection('whitelistedClients')
      .where('telegramId', '==', telegramId)
      .limit(1)
      .get();

    return !snapshot.empty;
  } catch (error) {
    console.error("Error checking client whitelist status:", error);
    return false;
  }
}

export async function updateFreelancerTelegramId(freelancerId: string, telegramId: number): Promise<void> {
  try {
    await db.collection('freelancers').doc(freelancerId).update({
      telegramId: telegramId
    });
  } catch (error) {
    console.error("Error updating freelancer telegramId:", error);
    throw error;
  }
}

export async function updateFreelancerTelegramAndWalletAddress(freelancerId: string, telegramId: number, walletAddress: string): Promise<void> {
  try {
    await db.collection('freelancers').doc(freelancerId).update({
      telegramId: telegramId,
      walletAddress: walletAddress
    });
  } catch (error) {
    console.error("Error updating creator telegramId:", error);
    throw error;
  }
}

export async function addFreelancer(freelancerData: Omit<Freelancer, 'id' | 'creationDate' | 'status'>): Promise<{ success: boolean; error?: string; freelancerId?: string }> {
  try {
    // Check if a freelancer with the same telegramUsername already exists
    const existingFreelancerQuery = await db.collection('freelancers')
      .where('telegramHandle', '==', freelancerData.telegramHandle)
      .get();

    if (!existingFreelancerQuery.empty) {
      const existingFreelancer = existingFreelancerQuery.docs[0];
      await db.collection('freelancers').doc(existingFreelancer.id).update({
        ...freelancerData,
      });
      return { success: true, freelancerId: existingFreelancer.id };
    }

    // If no existing freelancer found, proceed with adding the new freelancer
    const newFreelancer = {
      ...freelancerData,
      creationDate: Timestamp.now(),
      status: 'unverified',
      followersCount: 0,
      engagementRate: 0,
    };

    // Add the new freelancer to the database
    const docRef = await db.collection('freelancers').add(newFreelancer);

    return { success: true, freelancerId: docRef.id };
  } catch (error) {
    console.error("Error adding freelancer:", error);
    return { success: false, error: 'Error adding freelancer' };
  }
}

export async function getReferredUsersCount(username: string): Promise<number> {
  try {
    const normalizedUsername = username.toLowerCase();
    const now = Date.now();

    if (
      referralCountCache.username === normalizedUsername && 
      (now - referralCountCache.timestamp) < CACHE_EXPIRY
    ) {
      return referralCountCache.count;
    }

    const freelancerSnapshot = await db.collection('freelancers')
      .where('telegramHandle', '==', normalizedUsername)
      .limit(1)
      .get();
    
    if (!freelancerSnapshot.empty) {
      const freelancerDoc = freelancerSnapshot.docs[0];
      const freelancerData = freelancerDoc.data();
      const twitterHandle = freelancerData.twitterHandle?.toLowerCase().replace('@', '');
      const telegramHandle = freelancerData.telegramHandle?.toLowerCase();
      
      if (!twitterHandle && !telegramHandle) return 0;

      const possibleReferrals = [
        twitterHandle,
        `@${twitterHandle}`,
        telegramHandle,
        `@${telegramHandle}`
      ].filter(Boolean);

      const cutoffDate = new Date('2024-12-17T00:00:00Z');

      const allFreelancersSnapshot = await db.collection('freelancers').get();
      
      const referredUsers = allFreelancersSnapshot.docs.filter(doc => {
        try {
          const data = doc.data();
          let creationDate;

          // Safely handle different date formats
          if (data.creationDate) {
            if (data.creationDate instanceof Timestamp) {
              creationDate = data.creationDate.toDate();
            } else if (typeof data.creationDate === 'object' && 'seconds' in data.creationDate) {
              creationDate = new Timestamp(data.creationDate.seconds, 0).toDate();
            } else if (typeof data.creationDate === 'string') {
              creationDate = new Date(data.creationDate);
            } else {
              return false;
            }

            if (isNaN(creationDate.getTime())) {
              return false;
            }

            if (creationDate < cutoffDate) return false;

            const referralUser = data.referralUser?.toLowerCase();
            return referralUser && possibleReferrals.includes(referralUser);
          }
          return false;
        } catch (err) {
          console.error('Error processing freelancer:', err);
          return false;
        }
      });

      const count = referredUsers.length;

      referralCountCache = {
        count,
        timestamp: now,
        username: normalizedUsername
      };

      return count;
    }
    
    return 0;
  } catch (error) {
    console.error("Error getting referred users count:", error);
    return 0; // Return 0 instead of throwing
  }
}

export async function updateFreelancerWallet(freelancerId: string, walletAddress: string): Promise<{ 
  success: boolean; 
  error?: string; 
  freelancer?: {
    id: string;
    walletAddress: string;
  }
}> {
  try {
    await db.collection('freelancers').doc(freelancerId).update({
      walletAddress: walletAddress
    });

  
    return { 
      success: true, 
      freelancer: { 
        id: freelancerId,
        walletAddress: walletAddress
      }
    };
  } catch (error) {
    console.error("Error updating freelancer wallet:", error);
    return { 
      success: false, 
      error: 'Error updating wallet address' 
    };
  }
}

// Add a function to manually clear cache if needed
export async function clearFreelancersCache() {
  freelancersCache = {
    data: null,
    timestamp: 0,
    expiryTime: 5 * 60 * 1000
  };
}

// Add a function to manually clear cache if needed
export async function clearReferralCountCache() {
  referralCountCache = {
    count: 0,
    timestamp: 0,
    username: ''
  };
}

// Just get the count - fast query
export async function getFreelancersCount(): Promise<number> {
  try {
    const now = Date.now();
    if (countCache.count && (now - countCache.timestamp) < countCache.expiryTime) {
      return countCache.count;
    }

    const snapshot = await db
      .collection('freelancers')
      .where('status', '!=', 'hidden')
      .count()
      .get();

    countCache = {
      count: snapshot.data().count,
      timestamp: now,
      expiryTime: 5 * 60 * 1000
    };

    return snapshot.data().count;
  } catch (error) {
    console.error("Error getting freelancers count:", error);
    return countCache.count || 0;
  }
}

// Get paginated freelancers with caching and status priority
export async function getPaginatedFreelancers(isAllowed: boolean): Promise<{ 
  success: boolean; 
  freelancers?: Freelancer[]; 
  error?: string 
}> {
  try {
    const limit = isAllowed ? 500 : 100;
    const cacheKey = `freelancers_${limit}`;
    const now = Date.now();

    // Check cache
    if (paginatedCache[cacheKey]?.data && 
        (now - paginatedCache[cacheKey].timestamp) < paginatedCache[cacheKey].expiryTime) {
      return { success: true, freelancers: paginatedCache[cacheKey].data };
    }

    // Query for each status in priority order
    const [platiniumSnapshot, vipSnapshot, verifiedSnapshot, unverifiedSnapshot] = await Promise.all([
      db.collection('freelancers')
        .where('status', '==', 'platinium')
        .orderBy('creationDate', 'desc')
        .get(),
      
      db.collection('freelancers')
        .where('status', '==', 'vip')
        .orderBy('creationDate', 'desc')
        .get(),
      
      db.collection('freelancers')
        .where('status', '==', 'verified')
        .orderBy('creationDate', 'desc')
        .get(),
      
      db.collection('freelancers')
        .where('status', '==', 'unverified')
        .orderBy('creationDate', 'desc')
        .limit(Math.max(0, limit - 300)) // Leave room for priority freelancers
        .get()
    ]);

    // Convert snapshots to freelancers
    const [platiniumFreelancers, vipFreelancers, verifiedFreelancers, unverifiedFreelancers] = await Promise.all([
      Promise.all(platiniumSnapshot.docs.map(doc => convertToFreelancer(doc))),
      Promise.all(vipSnapshot.docs.map(doc => convertToFreelancer(doc))),
      Promise.all(verifiedSnapshot.docs.map(doc => convertToFreelancer(doc))),
      Promise.all(unverifiedSnapshot.docs.map(doc => convertToFreelancer(doc)))
    ]);

    // Combine all groups in priority order
    const freelancers = [
      ...platiniumFreelancers,
      ...vipFreelancers,
      ...verifiedFreelancers,
      ...unverifiedFreelancers
    ].slice(0, limit);

    // Cache the results
    paginatedCache[cacheKey] = {
      data: freelancers,
      timestamp: now,
      expiryTime: 5 * 60 * 1000
    };

    return { success: true, freelancers };
  } catch (error) {
    console.error("Error getting paginated freelancers:", error);
    return { success: false, error: 'Error getting freelancers' };
  }
}
