"use server"

import db from '../../../firebase/firebase';

// Global cache implementation (shared across all server instances)
let statsCache: {
  data: { activeUsers: number; questsCompleted: number; communities: number } | null;
  timestamp: number;
  expiryTime: number;
} = {
  data: null,
  timestamp: 0,
  expiryTime: 8 * 60 * 60 * 1000 // Cache expires after 8 hours
};

async function fetchStatsFromFirebase() {
  console.log('Fetching stats from Firebase...');
  
  let creatorsCount = 0;
  let completedDealsCount = 0;
  let campaignsCount = 0;
  
  try {
    // Get freelancers count (active creators)
    console.log('Fetching freelancers...');
    const freelancersSnapshot = await db.collection('freelancers').count().get();
    creatorsCount = freelancersSnapshot.data().count;
    console.log('Freelancers count:', creatorsCount);
  } catch (error) {
    console.error('Error fetching freelancers:', error);
  }

  try {
    // Get completed deals count (quests completed) - deals with status == 'done'
    // Use count() to get only the count without fetching all documents
    console.log('Fetching deals...');
    const completedDealsSnapshot = await db.collection('deals')
      .where('dealStatus', '==', 'done')
      .count()
      .get();
    completedDealsCount = completedDealsSnapshot.data().count;
    console.log('Completed deals count:', completedDealsCount);
  } catch (error) {
    console.error('Error fetching deals:', error);
  }

  try {
    // Get campaigns count (communities)
    console.log('Fetching campaigns...');
    const campaignsSnapshot = await db.collection('campaignIds').count().get();
    campaignsCount = campaignsSnapshot.data().count;
    console.log('Campaigns count:', campaignsCount);
  } catch (error) {
    console.error('Error fetching campaigns:', error);
  }

  const stats = {
    activeUsers: creatorsCount,
    questsCompleted: completedDealsCount,
    communities: campaignsCount
  };

  console.log('Final stats object:', stats);
  return stats;
}

export async function getLandingStats() {
  try {
    // Check cache first
    const now = Date.now();
    if (statsCache.data && (now - statsCache.timestamp) < statsCache.expiryTime) {
      console.log('Returning cached stats:', statsCache.data);
      return { success: true, stats: statsCache.data };
    }

    // Fetch from Firebase
    const stats = await fetchStatsFromFirebase();
    
    // Update cache
    statsCache = {
      data: stats,
      timestamp: now,
      expiryTime: 8 * 60 * 60 * 1000
    };

    console.log('Fetched and cached stats:', stats);
    
    return {
      success: true,
      stats
    };
  } catch (error) {
    console.error('Error fetching landing stats:', error);
    // If there's an error but we have cached data, return it
    if (statsCache.data) {
      console.log('Returning stale cached stats due to error');
      return { success: true, stats: statsCache.data };
    }
    return {
      success: false,
      error: 'Failed to fetch stats'
    };
  }
}

