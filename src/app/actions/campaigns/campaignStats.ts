"use server";

import db from '../../../firebase/firebase';

export interface CampaignDeal {
  dealId: string;
  title?: string;
  description: string;
  dealStatus: string;
  paymentStatus?: string;
  campaignId: string;
  recipientId: string;
  recipientTgId?: number;
  recipientTgUsername?: string;
  senderTgId: number;
  senderTgUsername: string;
  amount: string;
  dateCreated: number;
  expectedDeliveryDate: string;
  submission?: string;
  confirmedDeliveryDate?: number;
  requireSubmission?: boolean;
}

// Cache TTL: 8 hours
const CACHE_TTL_MS = 8 * 60 * 60 * 1000;

export interface CampaignStats {
  doneDeals: number;
  ongoingDeals: number;
  uniqueParticipants: number;
  impressions: number;
  likes: number;
  reposts: number;
  postComments: number;
  engagements: number;
  engagementRate: number; // percentage 0-100
  deals: CampaignDeal[];
}

export async function getDealsByCampaignIds(campaignIds: string[]): Promise<{
  success: boolean;
  stats?: CampaignStats;
  error?: string;
}> {
  try {
    if (!campaignIds || campaignIds.length === 0) {
      return { success: true, stats: { doneDeals: 0, ongoingDeals: 0, uniqueParticipants: 0, impressions: 0, likes: 0, reposts: 0, postComments: 0, engagements: 0, engagementRate: 0, deals: [] } };
    }

    // Normalize and dedupe campaign IDs
    const normalizedIds = Array.from(new Set(campaignIds.filter(Boolean)));
    console.log('[CampaignStats] Requested campaigns:', normalizedIds.join(', '));

    // Read per-campaign caches in parallel
    const cacheSnaps = await Promise.all(
      normalizedIds.map(id => db.collection('campaignStatsCacheByCampaign').doc(id).get())
    );

    // For each campaign, if cache is stale or missing, recompute and write back
    let cacheHits = 0;
    const perCampaignData = await Promise.all(normalizedIds.map(async (id, idx) => {
      const snap = cacheSnaps[idx];
      const isFresh = snap.exists && (Date.now() - ((snap.data() as any)?.updatedAt || 0)) < CACHE_TTL_MS;
      if (isFresh) {
        cacheHits++;
        console.log(`[CampaignStats] Cache hit for campaign ${id}`);
        return snap.data() as any;
      }

      // Recompute for this campaignId only
      console.log(`[CampaignStats] Cache miss/stale for campaign ${id}, recomputing...`);
      const ongoingSnapshot = await db.collection('deals')
        .where('campaignId', '==', id)
        .where('dealStatus', '==', 'ongoing')
        .get();
      const doneSnapshot = await db.collection('deals')
        .where('campaignId', '==', id)
        .where('dealStatus', '==', 'done')
        .get();
      const deals: CampaignDeal[] = [
        ...ongoingSnapshot.docs.map(d => d.data() as CampaignDeal),
        ...doneSnapshot.docs.map(d => d.data() as CampaignDeal),
      ];

      const doneDealsList = deals.filter(d => d.dealStatus === 'done');
      const doneDeals = doneDealsList.length;
      const ongoingDeals = deals.filter(d => d.dealStatus === 'ongoing').length;

      const uniqueParticipantsSet = new Set<string>();
      doneDealsList.forEach(deal => {
        if (deal.recipientId) uniqueParticipantsSet.add(deal.recipientId);
        else if (deal.recipientTgUsername) uniqueParticipantsSet.add(deal.recipientTgUsername);
      });

      const sumNumber = (value: any): number => {
        const num = typeof value === 'string' ? parseFloat(value) : value;
        return Number.isFinite(num) ? num : 0;
      };

      const impressions = doneDealsList.reduce((acc, d: any) => acc + sumNumber(d.impressions), 0);
      const likes = doneDealsList.reduce((acc, d: any) => acc + sumNumber(d.likes), 0);
      const reposts = doneDealsList.reduce((acc, d: any) => acc + sumNumber(d.reposts) + sumNumber(d.retweets), 0);
      const postComments = doneDealsList.reduce((acc, d: any) => acc + sumNumber(d.postComments) + sumNumber((d as any).comments), 0);
      const engagements = likes + reposts + postComments;
      const engagementRate = impressions > 0 ? +(engagements / impressions * 100).toFixed(1) : 0;

      const perCampaign = {
        stats: {
          doneDeals,
          ongoingDeals,
          uniqueParticipants: uniqueParticipantsSet.size,
          impressions,
          likes,
          reposts,
          postComments,
          engagements,
          engagementRate,
        },
        participants: Array.from(uniqueParticipantsSet),
        deals,
        updatedAt: Date.now(),
      };

      try {
        await db.collection('campaignStatsCacheByCampaign').doc(id).set(perCampaign);
      } catch {}

      return perCampaign;
    }));

    // Aggregate across all requested campaigns
    let doneDeals = 0;
    let ongoingDeals = 0;
    let impressions = 0;
    let likes = 0;
    let reposts = 0;
    let postComments = 0;
    let engagements = 0;
    const participantsSet = new Set<string>();
    let allDeals: CampaignDeal[] = [];

    perCampaignData.forEach(entry => {
      doneDeals += entry.stats.doneDeals || 0;
      ongoingDeals += entry.stats.ongoingDeals || 0;
      impressions += entry.stats.impressions || 0;
      likes += entry.stats.likes || 0;
      reposts += entry.stats.reposts || 0;
      postComments += entry.stats.postComments || 0;
      engagements += entry.stats.engagements || 0;
      (entry.participants || []).forEach((p: string) => participantsSet.add(p));
      allDeals = allDeals.concat(entry.deals || []);
    });

    const engagementRate = impressions > 0 ? +(engagements / impressions * 100).toFixed(1) : 0;

    const stats: CampaignStats = {
      doneDeals,
      ongoingDeals,
      uniqueParticipants: participantsSet.size,
      impressions,
      likes,
      reposts,
      postComments,
      engagements,
      engagementRate,
      deals: allDeals,
    };

    console.log('[CampaignStats] Aggregated stats prepared.', {
      campaignsRequested: normalizedIds.length,
      cacheHits,
      recomputed: normalizedIds.length - cacheHits,
      impressions,
      engagements,
      engagementRate,
    });

    return { success: true, stats };
  } catch (error) {
    console.error("Error fetching deals by campaign IDs:", error);
    return { success: false, error: 'Error fetching campaign deals' };
  }
}

export async function exportCampaignDealsToExcel(campaignIds: string[]): Promise<{
  success: boolean;
  data?: any[];
  error?: string;
}> {
  try {
    const result = await getDealsByCampaignIds(campaignIds);
    
    if (!result.success || !result.stats) {
      return { success: false, error: result.error || 'Failed to fetch deals' };
    }

    // Format data for Excel export
    const exportData = result.stats.deals.map(deal => {
      let submissions: string[] = [];
      
      // Parse submissions if they exist
      if (deal.submission) {
        try {
          submissions = JSON.parse(deal.submission);
          if (!Array.isArray(submissions)) {
            submissions = [deal.submission];
          }
        } catch {
          submissions = [deal.submission];
        }
      }

      return {
        'Deal ID': deal.dealId,
        'Campaign ID': deal.campaignId,
        'Recipient ID': deal.recipientId,
        'Recipient Username': deal.recipientTgUsername || '',
        'Deal Title': deal.title || '',
        'Deal Description': deal.description,
        'Deal Status': deal.dealStatus,
        'Date Created': new Date(deal.dateCreated).toISOString(),
        'Expected Delivery': deal.expectedDeliveryDate,
        'Confirmed Delivery': deal.confirmedDeliveryDate ? new Date(deal.confirmedDeliveryDate).toISOString() : '',
        'Submissions': submissions.join(' | '),
      };
    });

    return { success: true, data: exportData };
  } catch (error) {
    console.error("Error preparing export data:", error);
    return { success: false, error: 'Error preparing export data' };
  }
}
