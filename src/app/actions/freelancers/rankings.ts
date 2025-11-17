"use server"

import db from '../../../firebase/firebase';
import { Freelancer } from '@/app/utils/interfaces';

// Cache implementation
let rankingsCache: {
  data: RankingData[] | null;
  timestamp: number;
  expiryTime: number;
} = {
  data: null,
  timestamp: 0,
  expiryTime: 5 * 60 * 1000 // 5 minutes cache
};

export interface RankingData {
  freelancerId: string;
  fullName: string;
  telegramHandle: string;
  telegramId?: number;
  points: number;
  usdtEarned: number;
  completedDeals: number;
  status: string;
}

async function batchGetFreelancers(freelancerIds: string[]): Promise<any[]> {
  const batches = [];
  const batchSize = 30; // Firebase 'in' query limit
  
  // Split ids into batches of 30
  for (let i = 0; i < freelancerIds.length; i += batchSize) {
    const batch = freelancerIds.slice(i, i + batchSize);
    batches.push(
      db.collection('freelancers')
        .where('id', 'in', batch)
        .get()
    );
  }

  // Execute all batches in parallel
  const snapshots = await Promise.all(batches);
  
  // Combine results
  return snapshots.flatMap(snapshot => snapshot.docs);
}

export async function getFreelancerRankings(): Promise<{ 
  success: boolean; 
  rankings?: RankingData[];
  error?: string;
}> {
  try {
    // Check cache first
    const now = Date.now();
    if (rankingsCache.data && (now - rankingsCache.timestamp) < rankingsCache.expiryTime) {
      return { success: true, rankings: rankingsCache.data };
    }

    // Get all completed and paid deals
    const dealsSnapshot = await db
      .collection('deals')
      .where('dealStatus', '==', 'done')
      .where('paymentStatus', '==', 'paid')
      .get();

    // Create a map to aggregate freelancer stats
    const freelancerStats = new Map<string, {
      points: number;
      usdtEarned: number;
      completedDeals: number;
    }>();

    // Calculate totals for each freelancer
    dealsSnapshot.docs.forEach(doc => {
      const deal = doc.data();
      // Get recipientId from deal
      const recipientId = deal.recipientId?.toString();
      
      if (!recipientId) return;

      const currentStats = freelancerStats.get(recipientId) || {
        points: 0,
        usdtEarned: 0,
        completedDeals: 0
      };

      // Only increment stats if this deal belongs to this freelancer
      if (deal.recipientId?.toString() === recipientId) { 
        currentStats.completedDeals++;
        currentStats.points += Number(deal.points || 0);
        currentStats.usdtEarned += Number(deal.amount || 0);
      }

      freelancerStats.set(recipientId, currentStats);
      if (currentStats.points > 700) {
        console.log('Freelancer ID:', recipientId);
        console.log('Current Stats:', currentStats);
        console.log('Deal:', {
          recipientId: deal.recipientId,
          points: deal.points,
          amount: deal.amount
        });
      }
    });

    // Get freelancer details for those with completed deals
    const freelancerIds = Array.from(freelancerStats.keys());
    const rankings: RankingData[] = [];

    if (freelancerIds.length > 0) {
      // Use batched queries instead of single query
      const freelancerDocs = await batchGetFreelancers(freelancerIds);

      freelancerDocs.forEach(doc => {
        const freelancer = doc.data();
        const stats = freelancerStats.get(doc.id);
        
        if (stats) {
          rankings.push({
            freelancerId: doc.id,
            fullName: freelancer.fullName,
            telegramHandle: freelancer.telegramHandle.toLowerCase(),
            telegramId: freelancer.telegramId,
            points: stats.points,
            usdtEarned: stats.usdtEarned,
            completedDeals: stats.completedDeals,
            status: freelancer.status
          });
        }
      });
    }

    // Sort by points (primary) and USDT earned (secondary)
    const sortedRankings = rankings.sort((a, b) => {
      if (b.points !== a.points) {
        return b.points - a.points;
      }
      return b.usdtEarned - a.usdtEarned;
    });

    // Update cache
    rankingsCache = {
      data: sortedRankings,
      timestamp: now,
      expiryTime: 5 * 60 * 1000
    };

    return { success: true, rankings: sortedRankings };
  } catch (error) {
    console.error("Error getting rankings:", error);
    return { success: false, error: 'Failed to fetch rankings' };
  }
} 